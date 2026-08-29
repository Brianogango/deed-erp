import 'server-only'
import { createHash } from 'crypto'
import prisma from './prisma'
import { loadAppState, saveStoreKeys } from './server-store'
import { resolveClientId } from './legacy-compat'

/**
 * Repairs migration — phase 1 (write-through mirror).
 *
 * The operational source of truth for repairs is still the deed_repairs_v2
 * JSON blob. This module mirrors the CORE fields of every repair into the
 * relational `repairs` table whenever the blob is saved, so that:
 *   - invoices/sale orders can hold real foreign keys to repairs,
 *   - reporting can run on SQL instead of parsing JSON blobs,
 *   - phase 2 (moving reads + writes to the table) starts from a full dataset.
 *
 * A fingerprint per repair (stored in app_state) keeps the mirror cheap:
 * only repairs whose mapped fields actually changed are written.
 */

const MIRROR_STATE_KEY = 'repair_mirror_hashes_v1'

// Blob statuses → relational repair_status enum
const STATUS_MAP: Record<string, string> = {
  pending_verification: 'intake',
  received: 'intake',
  assigned: 'intake',
  diagnosed: 'diagnosis',
  awaiting_approval: 'diagnosis',
  approved: 'diagnosis',
  awaiting_parts: 'awaiting_parts',
  in_repair: 'in_repair',
  qc: 'qc',
  ready: 'ready',
  invoiced: 'ready',
  verified_released: 'verified_released',
  delivered: 'collected',
  collected: 'collected',
  closed: 'collected',
  declined: 'cancelled',
  returned: 'cancelled',
  retained: 'cancelled',
  cancelled: 'cancelled',
  unrepairable: 'unrepairable',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function asDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null
  const d = new Date(value.includes('T') ? value : `${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function mapRepair(r: any) {
  const partsCost = Array.isArray(r.partsUsed)
    ? r.partsUsed.reduce((sum: number, p: any) => sum + Number(p.qty ?? 0) * Number(p.price ?? 0), 0)
    : 0
  return {
    status: (STATUS_MAP[String(r.status ?? '')] ?? 'intake') as any,
    deviceType: String(r.productName ?? 'Device').slice(0, 80),
    deviceModel: r.deviceColor ? String(r.deviceColor).slice(0, 100) : null,
    serialNumber: r.serialNumber ? String(r.serialNumber).slice(0, 100) : null,
    reportedFault: String(r.issueDescription ?? 'Not specified'),
    observedFault: r.diagnosis?.faultDescription ? String(r.diagnosis.faultDescription) : null,
    conditionOnIntake: r.deviceCondition ? String(r.deviceCondition) : null,
    accessoriesIn: Array.isArray(r.accessories) ? r.accessories.map((a: any) => String(a?.name ?? '')).filter(Boolean) : [],
    estimatedCost: r.quote?.total != null ? Number(r.quote.total) : null,
    labourCost: Number(r.laborCost ?? 0),
    partsCost,
    intakeDate: asDate(r.intakeDate) ?? new Date(),
    completedDate: asDate(r.repairCompletedDate),
    collectedDate: asDate(r.deliveryActualDate) ?? asDate(r.closedDate),
    resolutionNotes: r.workNotes ? String(r.workNotes).slice(0, 4000) : null,
    isUnrepairable: r.status === 'unrepairable',
    priority: String(r.priority ?? 'normal').slice(0, 20),
    source: String(r.intakeChannel ?? 'walkin').slice(0, 30),
    notes: r.intakeNotes ? String(r.intakeNotes).slice(0, 4000) : null,
  }
}

function fingerprint(r: any, mapped: ReturnType<typeof mapRepair>): string {
  return createHash('md5').update(JSON.stringify({
    m: mapped,
    customer: [r.customerId, r.customerName, r.customerPhone, r.customerEmail],
    invoiceId: r.invoiceId ?? r.linkedInvoiceId ?? null,
    assignedTo: r.assignedTechnicianId ?? null,
  })).digest('hex')
}

let _mirrorRunning = false

/**
 * Mirror repairs from the blob into the relational table.
 * Fire-and-forget safe: never throws; logs failures per repair.
 * Pass `force: true` to rewrite every repair regardless of fingerprints.
 */
export async function mirrorRepairsToPrisma(repairsInput: unknown, opts: { force?: boolean } = {}): Promise<{ mirrored: number; skipped: number; failed: number }> {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_mirrorRunning) return result
  _mirrorRunning = true
  try {
    const repairs: any[] = typeof repairsInput === 'string' ? JSON.parse(repairsInput) : (repairsInput as any[])
    if (!Array.isArray(repairs) || repairs.length === 0) return result

    const state = await loadAppState([MIRROR_STATE_KEY])
    const hashes: Record<string, string> = (!opts.force && state[MIRROR_STATE_KEY] && typeof state[MIRROR_STATE_KEY] === 'object')
      ? state[MIRROR_STATE_KEY] as Record<string, string>
      : {}

    const systemUser = await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    if (!systemUser) return result

    const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map(u => u.id))
    const nextHashes: Record<string, string> = { ...hashes }
    let dirty = false

    for (const r of repairs) {
      const ref = String(r?.ref ?? '').trim()
      if (!ref) continue
      try {
        const mapped = mapRepair(r)
        const hash = fingerprint(r, mapped)
        if (!opts.force && hashes[ref] === hash) { result.skipped++; continue }

        const clientId = await resolveClientId(prisma as any, r.customerId, {
          name: r.customerName, phone: r.customerPhone, email: r.customerEmail,
        })

        const assignedToId = UUID_RE.test(String(r.assignedTechnicianId ?? '')) && userIds.has(r.assignedTechnicianId)
          ? r.assignedTechnicianId : null

        // Only link invoices that actually exist in the relational table
        const candidateInvoiceId = [r.invoiceId, r.linkedInvoiceId].find(id => UUID_RE.test(String(id ?? '')))
        let invoiceId: string | null = null
        if (candidateInvoiceId) {
          const inv = await prisma.invoice.findUnique({ where: { id: candidateInvoiceId }, select: { id: true } })
          invoiceId = inv?.id ?? null
        }

        const createdById = UUID_RE.test(String(r.createdBy ?? '')) && userIds.has(r.createdBy) ? r.createdBy : systemUser.id
        const data = { ...mapped, clientId, assignedToId, invoiceId }

        // A repair renumbered after its first mirror (REP-445447 → REP/0306)
        // otherwise deadlocks the upsert: jobNumber misses, id collides.
        const blobId = UUID_RE.test(String(r.id ?? '')) ? String(r.id) : null
        const existingById = blobId
          ? await prisma.repair.findUnique({ where: { id: blobId }, select: { id: true } })
          : null
        if (existingById) {
          await prisma.repair.update({ where: { id: existingById.id }, data: { ...data, jobNumber: ref } })
        } else {
          await prisma.repair.upsert({
            where: { jobNumber: ref },
            create: {
              ...(blobId ? { id: blobId } : {}),
              jobNumber: ref,
              createdById,
              ...data,
            },
            update: data,
          })
        }
        nextHashes[ref] = hash
        dirty = true
        result.mirrored++
      } catch (err) {
        result.failed++
        console.error(`[repair-mirror] Failed to mirror ${ref}:`, err instanceof Error ? err.message : err)
      }
    }

    if (dirty) await saveStoreKeys({ [MIRROR_STATE_KEY]: JSON.stringify(nextHashes) })
    return result
  } catch (err) {
    console.error('[repair-mirror] mirror run failed:', err)
    return result
  } finally {
    _mirrorRunning = false
  }
}
