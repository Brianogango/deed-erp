import 'server-only'
import { createHash } from 'crypto'
import prisma from './prisma'
import { loadAppState, saveStoreKeys } from './server-store'
import { resolveClientId } from './legacy-compat'

/**
 * Repairs migration — phase 2c (table is authoritative).
 *
 * The `repairs` table is the operational source of truth: every repair write
 * upserts synchronously (fingerprinted — only changed rows), and every read
 * surface (store hydration, repairs API, portal) is served the full job from
 * the row's payload. The deed_repairs_v2 blob is still written as a backup
 * copy but nothing reads it; removing that write is the final cleanup.
 *
 * A fingerprint per repair (stored in app_state) keeps the upsert cheap.
 */

const MIRROR_STATE_KEY = 'repair_mirror_hashes_v1'
const MIRROR_FINGERPRINT_VERSION = 2

let repairsPayloadCache: { at: number; data: any[] } | null = null
// Short TTL so GET /api/repairs does not serve a 15s-stale list after another
// user's write while still coalescing the boot fan-out on one worker.
const REPAIRS_PAYLOAD_CACHE_MS = 3_000

export function invalidateRepairsPayloadCache() {
  repairsPayloadCache = null
}

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

/**
 * The relational row stores the entire repair object in `payload`, so the
 * fingerprint must cover that same payload. Fingerprinting only selected
 * mapped fields allowed business-critical changes such as billingExempt,
 * quote approval metadata and workflow flags to be skipped while Prisma
 * remained the authoritative read surface.
 *
 * Version 2 intentionally invalidates the old partial hashes once so existing
 * stale repair payloads are rewritten on the next mirror pass.
 */
function fingerprint(r: any): string {
  return createHash('md5').update(JSON.stringify({
    v: MIRROR_FINGERPRINT_VERSION,
    payload: r,
  })).digest('hex')
}

let _mirrorRunning = false
// Set when a repair write arrives mid-pass. The pass then re-runs once from
// the freshest blob state instead of dropping that write — dropping it was
// the drift behind "customer approved but the ERP never showed it" (the blob
// moved on while the relational payload that all read surfaces use stayed
// stale until some later, uncontended write happened to re-mirror the row).
let _mirrorPendingRerun = false

/**
 * Phase 2a read path: full repairs from the relational table (payload first).
 * Returns null when the table is empty/unmirrored — callers fall back to the
 * blob. Never throws.
 */
export async function loadRepairsFromPrisma(): Promise<any[] | null> {
  try {
    if (repairsPayloadCache && Date.now() - repairsPayloadCache.at < REPAIRS_PAYLOAD_CACHE_MS) {
      return repairsPayloadCache.data
    }
    // Deterministic order: an unordered findMany returns rows in physical
    // order, which changes every time the mirror updates a row — the visible
    // list then re-sorted itself mid-click whenever a poll re-hydrated.
    const rows = await prisma.repair.findMany({
      select: { payload: true },
      orderBy: [{ intakeDate: 'desc' }, { jobNumber: 'desc' }],
    })
    const withPayload = rows.filter(r => r.payload && typeof r.payload === 'object')
    if (!withPayload.length) return null
    const data = withPayload.map(r => r.payload)
    repairsPayloadCache = { at: Date.now(), data }
    return data
  } catch {
    return null
  }
}

/** Single repair by current ref, prisma id, or blob payload id. */
export async function findRepairInPrisma(refOrId: string): Promise<any | null> {
  try {
    const or: Array<Record<string, unknown>> = [
      { jobNumber: refOrId },
      { payload: { path: ['id'], equals: refOrId } },
    ]
    if (UUID_RE.test(refOrId)) or.unshift({ id: refOrId })
    const row = await prisma.repair.findFirst({
      where: { OR: or },
      select: { payload: true },
    })
    return row?.payload ?? null
  } catch {
    return null
  }
}

/**
 * Mirror repairs from the blob into the relational table.
 * Fire-and-forget safe: never throws; logs failures per repair.
 * Pass `force: true` to rewrite every repair regardless of fingerprints.
 */
export async function mirrorRepairsToPrisma(repairsInput: unknown, opts: { force?: boolean } = {}): Promise<{ mirrored: number; skipped: number; failed: number }> {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_mirrorRunning) {
    _mirrorPendingRerun = true
    return result
  }
  _mirrorRunning = true
  try {
    invalidateRepairsPayloadCache()
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
        const hash = fingerprint(r)
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
        // Phase 2a: carry the full blob repair so relational reads are lossless.
        const data = { ...mapped, clientId, assignedToId, invoiceId, payload: r }

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

    const activeRefs = new Set(repairs.map((r: any) => String(r?.ref ?? '').trim()).filter(Boolean))
    for (const ref of Object.keys(nextHashes)) {
      if (!activeRefs.has(ref)) { delete nextHashes[ref]; dirty = true }
    }

    if (dirty) await saveStoreKeys({ [MIRROR_STATE_KEY]: JSON.stringify(nextHashes) })
  } catch (err) {
    console.error('[repair-mirror] mirror run failed:', err)
  } finally {
    _mirrorRunning = false
  }

  if (_mirrorPendingRerun) {
    _mirrorPendingRerun = false
    try {
      // Re-read the freshest blob — the write that queued this rerun carried
      // a newer array than the one this pass just mirrored.
      const fresh = await loadAppState(['deed_repairs_v2'])
      const rows = fresh['deed_repairs_v2']
      if (Array.isArray(rows) && rows.length > 0) await mirrorRepairsToPrisma(rows)
    } catch (err) {
      console.error('[repair-mirror] trailing rerun failed:', err)
    }
  }
  return result
}
