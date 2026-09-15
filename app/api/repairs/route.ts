import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { getNextRepairRef } from '@/lib/repair-ref-counter'
import { isOfficialRepairRef, isTemporaryRepairRef, takenRepairRefs, uniqueRepairRefs } from '@/lib/repair-ref'
import type { RepairOrder } from '@/lib/store'
import { parsePaginationParams, paginateArray } from '@/lib/api-pagination'
import { repairDatesWriteError } from '@/lib/data-validation'
import { ensureRepairIntakeTimestamp } from '@/lib/repair-datetime'
import { hasModuleAccess } from '@/lib/auth/access'
import { filterStoreValueForRole } from '@/lib/auth/authorization'
import { loadRepairsFromPrisma } from '@/lib/repair-mirror'
import { overlayRepairNoChargeFromBlob } from '@/lib/repair-store-merge'
import { DIRECT_REPAIR_WAIVER_TEXT } from '@/lib/repair-path'
import { resolveDiagnosisFee, normalizeDeviceTier } from '@/lib/diagnosis-fee'
import { publishNotificationEvent } from '@/lib/notifications/service'
import { findOpenRepairWithSerial, resolveRepairWarranty, warrantyPatchFromDecision } from '@/lib/repair-warranty'

function publicPhotoUrl(ref: string, index: number) {
  return `/api/portal/repair/${encodeURIComponent(ref)}/photos/${index}`
}

function stripInlinePhotoPayloads(repair: RepairOrder): RepairOrder {
  if (!Array.isArray((repair as any).issuePhotos)) return repair
  return {
    ...repair,
    issuePhotos: (repair as any).issuePhotos.map((photo: any, index: number) => ({
      ...photo,
      url: typeof photo?.url === 'string' && photo.url.startsWith('data:image/')
        ? publicPhotoUrl(repair.ref, index)
        : photo?.url,
    })),
  } as RepairOrder
}

/**
 * GET /api/repairs
 * Paginated repair list (blob SoT). Defaults: page=1, limit=50 (max 200).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The repair ledger carries customer PII + commercial detail — require the
  // repair module, and scope technicians to their assigned jobs (same rule as
  // the store hydration path).
  const user = session.user as any
  if (!hasModuleAccess(user, 'repair')) {
    return NextResponse.json({ error: 'Forbidden — no repair module access' }, { status: 403 })
  }

  try {
    // Phase 2a: read from the relational table when mirrored (payload carries
    // the full job); fall back to the blob otherwise.
    const fromPrisma = await loadRepairsFromPrisma()
    const state = await loadAppState(['deed_repairs_v2'])
    const blob = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []
    let repairs: RepairOrder[]
    if (fromPrisma) {
      repairs = overlayRepairNoChargeFromBlob(fromPrisma as RepairOrder[], blob) as RepairOrder[]
    } else {
      repairs = blob
    }
    repairs = filterStoreValueForRole(
      { id: user?.id, role: user?.role, modules: user?.modules, actsAsTechnician: user?.actsAsTechnician },
      'deed_repairs_v2',
      repairs,
    ) as RepairOrder[]

    const status = request.nextUrl.searchParams.get('status')
    const q = request.nextUrl.searchParams.get('q')?.toLowerCase()
    const { page, limit, sort, order } = parsePaginationParams(request.nextUrl.searchParams, {
      defaultSort: 'intakeDate',
      allowedSorts: ['intakeDate', 'createdDate', 'ref', 'status', 'customerName'],
    })

    if (status) {
      repairs = repairs.filter(r => r.status === status)
    }
    if (q) {
      repairs = repairs.filter(r =>
        r.ref.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q)
      )
    }

    const sortKey = (sort ?? 'intakeDate') as keyof RepairOrder
    repairs = [...repairs].sort((a, b) => {
      if (sortKey === 'ref') {
        const cmp = String(a.ref || '').localeCompare(String(b.ref || ''), undefined, { numeric: true })
        return order === 'asc' ? cmp : -cmp
      }
      const aKey = String((a as any)[sortKey] || a.intakeDate || a.createdDate || '')
      const bKey = String((b as any)[sortKey] || b.intakeDate || b.createdDate || '')
      const byField = aKey.localeCompare(bKey)
      if (byField !== 0) return order === 'asc' ? byField : -byField
      return String(b.ref || '').localeCompare(String(a.ref || ''), undefined, { numeric: true })
    })

    const pagePayload = paginateArray(repairs.map(stripInlinePhotoPayloads), page, limit)
    return NextResponse.json(pagePayload, { status: 200 })
  } catch (err) {
    console.error('[repairs GET] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch repairs' }, { status: 500 })
  }
}

/**
 * POST /api/repairs
 * Create a new repair with a server-generated unique reference number.
 * Staff only (director, admin_officer, technical_lead, technician).
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as any
  const allowedRoles = ['director', 'admin_officer', 'technical_lead', 'technician']
  if (!allowedRoles.includes(user?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.customerName) {
    return NextResponse.json({ error: 'customerName is required' }, { status: 422 })
  }
  if (!body.productName) {
    return NextResponse.json({ error: 'productName is required' }, { status: 422 })
  }

  try {
    const requestedRef = String(body.ref ?? '').trim()
    const submittedId = typeof body.id === 'string' ? body.id.trim() : ''
    const repairId = /^[A-Za-z0-9_-]{1,80}$/.test(submittedId) ? submittedId : `rep_${Date.now()}`

    // Serialize the read-modify-write on the repairs ledger, and fail rather
    // than overwrite it when the load itself failed (loadAppState swallows
    // errors into {} — a save after that would wipe every other repair).
    return await withAppStateKeyLock('deed_repairs_v2', async () => {
    const state = await loadAppStateForWrite()
    const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []
    const existingIdx = repairs.findIndex(r => r.id === repairId)
    const existing = existingIdx >= 0 ? repairs[existingIdx] : null
    const existingByRef = repairs.find(r => r.ref.toLowerCase() === requestedRef.toLowerCase())
    const submittedSerial = (
      'serialNumber' in body ? String(body.serialNumber ?? '') : String(existing?.serialNumber ?? '')
    ).normalize('NFKC').trim().slice(0, 160)
    const serialWarrantyException = body.serialWarrantyException === true
      || (!('serialWarrantyException' in body) && existing?.serialWarrantyException === true)
    const clientCausedDamage = body.clientCausedDamage === true
      || (!('clientCausedDamage' in body) && existing?.clientCausedDamage === true)
    const warranties = Array.isArray(state.deed_warranties) ? state.deed_warranties as any[] : []
    const warrantyDecision = resolveRepairWarranty(warranties, submittedSerial, {
      serialException: serialWarrantyException,
      clientCausedDamage,
    })
    const warrantyPatch = warrantyPatchFromDecision(warrantyDecision)
    const duplicate = findOpenRepairWithSerial(repairs, submittedSerial, repairId)
    if (duplicate) {
      return NextResponse.json({
        error: `This device already has an open repair: ${duplicate.ref}`,
        repairId: duplicate.id,
        repairRef: duplicate.ref,
      }, { status: 409 })
    }

    // Never replace an official ticket, and never mint a second number on retry.
    const keepExisting = existing && isOfficialRepairRef(existing.ref) ? existing.ref : null
    const keepRequested = isOfficialRepairRef(requestedRef)
      && (!existingByRef || existingByRef.id === repairId)
      ? requestedRef
      : null
    const ref = keepExisting || keepRequested || await getNextRepairRef(takenRepairRefs(repairs))
    const previousRefs = uniqueRepairRefs([
      ...(Array.isArray((existing as { previousRefs?: unknown } | null)?.previousRefs)
        ? (existing as { previousRefs: unknown[] }).previousRefs
        : []),
      isTemporaryRepairRef(requestedRef) ? requestedRef : null,
      existing?.ref && existing.ref !== ref ? existing.ref : null,
    ].filter(value => value && String(value) !== ref))

    // Always persist a full ISO datetime (date + time). Date-only strings keep
    // that calendar day at local midnight; empty values become now.
    const intakeDate = ensureRepairIntakeTimestamp(body.intakeDate)

    const cleanText = (value: unknown, max: number) => String(value ?? '').normalize('NFKC').trim().slice(0, max)
    const optionalText = (value: unknown, max: number) => {
      const text = cleanText(value, max)
      return text || undefined
    }
    const accessories: RepairOrder['accessories'] = Array.isArray(body.accessories)
      ? body.accessories.slice(0, 100).map((item: any) => ({
          name: cleanText(item?.name ?? item, 160),
          received: item?.received !== false,
          notes: optionalText(item?.notes, 500),
        })).filter(item => item.name)
      : []
    const repairPath = body.repairPath === 'direct_repair' ? 'direct_repair' : 'diagnosis_first'
    const waiverAccepted = repairPath === 'direct_repair' && body.liabilityWaiverAccepted === true
    const serialWarrantyExceptionReason = [
      'device_cannot_power_on', 'label_unreadable', 'sticker_missing', 'customer_unable_to_confirm', 'other',
    ].includes(String(body.serialWarrantyExceptionReason))
      ? body.serialWarrantyExceptionReason as RepairOrder['serialWarrantyExceptionReason']
      : undefined

    // Create from an explicit intake allowlist. Workflow, assignment, billing,
    // costs, QA, audit, invoice, delivery and posting fields are server-owned.
    const repair = {
      id: repairId,
      ref,
      previousRefs,
      status: 'received',
      customerId: cleanText(body.customerId, 80),
      customerName: cleanText(body.customerName, 200),
      customerPhone: cleanText(body.customerPhone, 50),
      customerEmail: optionalText(body.customerEmail, 254),
      contactPersonId: optionalText(body.contactPersonId, 80),
      contactPersonName: optionalText(body.contactPersonName, 200),
      contactPersonPhone: optionalText(body.contactPersonPhone, 50),
      contactPersonEmail: optionalText(body.contactPersonEmail, 254),
      contactPersonTitle: optionalText(body.contactPersonTitle, 120),
      productId: cleanText(body.productId, 80),
      productName: cleanText(body.productName, 240),
      serialNumber: submittedSerial,
      serialId: optionalText(body.serialId, 80),
      deviceCondition: ['good', 'fair', 'poor', 'damaged'].includes(String(body.deviceCondition))
        ? body.deviceCondition as RepairOrder['deviceCondition']
        : undefined,
      clientLaptopPassword: optionalText(body.clientLaptopPassword, 500),
      deviceColor: optionalText(body.deviceColor, 80),
      priority: ['low', 'normal', 'high', 'urgent'].includes(String(body.priority))
        ? body.priority as RepairOrder['priority']
        : 'normal',
      intakeChannel: ['website', 'whatsapp', 'call', 'email', 'rider_pickup', 'walk_in'].includes(String(body.intakeChannel))
        ? body.intakeChannel as RepairOrder['intakeChannel']
        : 'walk_in',
      intakeDate,
      intakeNotes: cleanText(body.intakeNotes, 5_000),
      issueDescription: cleanText(body.issueDescription, 10_000),
      accessories,
      repairPath,
      liabilityWaiverAccepted: waiverAccepted,
      liabilityWaiverText: waiverAccepted ? DIRECT_REPAIR_WAIVER_TEXT : undefined,
      liabilityWaiverAcceptedAt: waiverAccepted ? new Date().toISOString() : undefined,
      liabilityWaiverSignature: waiverAccepted ? optionalText(body.liabilityWaiverSignature, 200) : undefined,
      deviceTier: normalizeDeviceTier(body.deviceTier) ?? undefined,
      deviceType: optionalText(body.deviceType, 120),
      deviceBrand: optionalText(body.deviceBrand, 120),
      deviceModel: optionalText(body.deviceModel, 160),
      customerBillingType: body.customerBillingType === 'corporate' ? 'corporate' : 'walk_in',
      ...warrantyPatch,
      serialWarrantyException,
      serialWarrantyExceptionReason,
      serialWarrantyExceptionNotes: optionalText(body.serialWarrantyExceptionNotes, 2_000),
      clientCausedDamage,
      clientDamageReason: optionalText(body.clientDamageReason, 2_000),
      estimatedCompletionDate: optionalText(body.estimatedCompletionDate, 40),
      partsUsed: [] as RepairOrder['partsUsed'],
      laborCost: 0,
      logisticsCost: 0,
      total: 0,
      qcItems: [] as RepairOrder['qcItems'],
      createdByUserId: cleanText(user?.id, 80),
      createdBy: cleanText(user?.username ?? user?.id ?? 'system', 160),
      bookedByName: cleanText(user?.name ?? 'System', 200),
      createdDate: new Date().toISOString(),
      notes: cleanText(body.notes, 10_000),
      slaMissed: false,
      date: intakeDate,
      description: cleanText(body.issueDescription, 10_000),
      technicianName: '',
    } as RepairOrder

    const fee = resolveDiagnosisFee(repair, state.deed_systemSettings as any)
    repair.diagnosisFee = fee.amount
    repair.diagnosisFeeStatus = fee.status
    repair.diagnosisFeeBilling = fee.billing
    repair.customerBillingType = fee.customerType

    const dateErr = repairDatesWriteError(repair)
    if (dateErr) {
      return NextResponse.json({
        error: dateErr,
        field: dateErr.startsWith('date ') ? 'date' : 'intakeDate',
      }, { status: 422 })
    }

    // If a same-id draft already landed via store sync, merge so we never
    // clobber richer intake (repairPath / warranty) with a thinner write.
    const incomingHasPath =
      body.repairPath === 'direct_repair' || body.repairPath === 'diagnosis_first'
    const mergedRepair = {
      ...(existing ?? {}),
      ...repair,
      id: repairId,
      ref,
      previousRefs,
      intakeDate,
      // Thin creates (no repairPath) must not wipe intake applied by a parallel
      // updateRepair / store sync before this POST finished.
      ...(!incomingHasPath && existing
        ? {
            repairPath: existing.repairPath,
            serialWarrantyException: existing.serialWarrantyException,
            serialWarrantyExceptionReason: existing.serialWarrantyExceptionReason,
            serialWarrantyExceptionNotes: existing.serialWarrantyExceptionNotes,
            liabilityWaiverAccepted: existing.liabilityWaiverAccepted,
            liabilityWaiverText: existing.liabilityWaiverText,
            liabilityWaiverAcceptedAt: existing.liabilityWaiverAcceptedAt,
            liabilityWaiverSignature: existing.liabilityWaiverSignature,
            diagnosisFee: existing.diagnosisFee,
            diagnosisFeeStatus: existing.diagnosisFeeStatus,
            diagnosisFeeBilling: existing.diagnosisFeeBilling,
            accessories: existing.accessories?.length ? existing.accessories : repair.accessories,
            notes: existing.notes || repair.notes,
          }
        : {}),
    } as RepairOrder

    const updatedRepairs = existingIdx >= 0
      ? repairs.map((r, i) => (i === existingIdx ? mergedRepair : r))
      : [mergedRepair, ...repairs]
    await saveStoreKeys({ 'deed_repairs_v2': JSON.stringify(updatedRepairs) })

    if (!existing && mergedRepair.customerPhone) {
      await publishNotificationEvent({
        eventType: 'repair.received',
        entityType: 'repair',
        entityId: mergedRepair.id,
        actorUserId: user?.id || null,
        externalRecipients: [{
          name: mergedRepair.customerName,
          phone: mergedRepair.customerPhone,
          email: mergedRepair.customerEmail || null,
          channels: ['sms'],
        }],
        channels: ['sms'],
        severity: 'success',
        title: `Repair received — ${mergedRepair.ref}`,
        body: `Deed Technologies: We have received your ${mergedRepair.productName}. Repair reference: ${mergedRepair.ref}. Track progress using the secure link below.`,
        actionUrl: `/portal/repair/${encodeURIComponent(mergedRepair.ref)}`,
        metadata: {
          repairRef: mergedRepair.ref,
          customerName: mergedRepair.customerName,
          productName: mergedRepair.productName,
        },
        idempotencyKey: `repair-received-sms:${mergedRepair.id}`,
      }).catch(error => console.error('[repairs POST] could not queue repair received SMS', error))
    }

    return NextResponse.json(mergedRepair, { status: 201 })
    })
  } catch (err) {
    console.error('[repairs POST] Error:', err)
    return NextResponse.json({ error: 'Failed to create repair' }, { status: 500 })
  }
}
