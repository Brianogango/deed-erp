import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getNextRepairRef } from '@/lib/repair-ref-counter'
import { isOfficialRepairRef, isTemporaryRepairRef, uniqueRepairRefs } from '@/lib/repair-ref'
import type { RepairOrder } from '@/lib/store'
import { parsePaginationParams, paginateArray } from '@/lib/api-pagination'
import { repairDatesWriteError } from '@/lib/data-validation'
import { ensureRepairIntakeTimestamp } from '@/lib/repair-datetime'

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

  try {
    const state = await loadAppState()
    let repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []

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
    const repairId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `rep_${Date.now()}`

    const state = await loadAppState()
    const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []
    const existingIdx = repairs.findIndex(r => r.id === repairId)
    const existing = existingIdx >= 0 ? repairs[existingIdx] : null
    const existingByRef = repairs.find(r => r.ref.toLowerCase() === requestedRef.toLowerCase())

    // Never replace a sequential ticket, and never mint a second number on retry.
    const keepExisting = existing && isOfficialRepairRef(existing.ref) ? existing.ref : null
    const keepRequested = isOfficialRepairRef(requestedRef)
      && (!existingByRef || existingByRef.id === repairId)
      ? requestedRef
      : null
    const ref = keepExisting || keepRequested || await getNextRepairRef()
    const previousRefs = uniqueRepairRefs([
      ...(Array.isArray(existing?.previousRefs) ? existing!.previousRefs : []),
      ...(Array.isArray(body.previousRefs) ? body.previousRefs as unknown[] : []),
      isTemporaryRepairRef(requestedRef) ? requestedRef : null,
      existing?.ref && existing.ref !== ref ? existing.ref : null,
    ].filter(value => value && String(value) !== ref))

    // Always persist a full ISO datetime (date + time). Date-only strings keep
    // that calendar day at local midnight; empty values become now.
    const intakeDate = ensureRepairIntakeTimestamp(body.intakeDate)

    // Create the new repair — body may include full intake (path, warranty, waiver).
    // Spread body after defaults so booking fields are not dropped by a thin client.
    const repair = {
      status: String(body.status ?? 'received') as RepairOrder['status'],
      customerId: String(body.customerId ?? ''),
      customerName: String(body.customerName),
      customerPhone: String(body.customerPhone ?? ''),
      productId: String(body.productId ?? ''),
      productName: String(body.productName),
      serialNumber: String(body.serialNumber ?? ''),
      intakeChannel: (body.intakeChannel === 'website' || body.intakeChannel === 'whatsapp' || body.intakeChannel === 'call' || body.intakeChannel === 'email' || body.intakeChannel === 'rider_pickup') ? body.intakeChannel as RepairOrder['intakeChannel'] : 'walk_in',
      intakeNotes: '',
      issueDescription: String(body.issueDescription ?? ''),
      accessories: [] as RepairOrder['accessories'],
      ...(body as Partial<RepairOrder>),
      // Force server-owned identity + full timestamp after body spread.
      id: repairId,
      ref,
      previousRefs,
      intakeDate,
    } as RepairOrder

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
            underWarranty: existing.underWarranty,
            warrantyCoverage: existing.warrantyCoverage,
            warrantyId: existing.warrantyId,
            warrantyVerificationStatus: existing.warrantyVerificationStatus,
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

    return NextResponse.json(mergedRepair, { status: 201 })
  } catch (err) {
    console.error('[repairs POST] Error:', err)
    return NextResponse.json({ error: 'Failed to create repair' }, { status: 500 })
  }
}
