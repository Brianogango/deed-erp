import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getNextRepairRef } from '@/lib/repair-ref-counter'
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
    // Get the next unique repair reference from the atomic counter
    const ref = await getNextRepairRef()

    // Load existing repairs
    const state = await loadAppState()
    const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []

    // Always persist a full ISO datetime (date + time). Date-only strings get
    // upgraded to "now" so booking never silently stores midnight-only values.
    const intakeDate = ensureRepairIntakeTimestamp(body.intakeDate)

    // Create the new repair
    const repair: RepairOrder = {
      id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `rep_${Date.now()}`,
      ref,
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
      accessories: [],
      ...(body as Partial<RepairOrder>),
      // Force full timestamp after body spread (body may carry date-only).
      intakeDate,
    } as RepairOrder

    const dateErr = repairDatesWriteError(repair)
    if (dateErr) {
      return NextResponse.json({
        error: dateErr,
        field: dateErr.startsWith('date ') ? 'date' : 'intakeDate',
      }, { status: 422 })
    }

    // Save the updated repairs list
    const updatedRepairs = [repair, ...repairs]
    await saveStoreKeys({ 'deed_repairs_v2': JSON.stringify(updatedRepairs) })

    return NextResponse.json(repair, { status: 201 })
  } catch (err) {
    console.error('[repairs POST] Error:', err)
    return NextResponse.json({ error: 'Failed to create repair' }, { status: 500 })
  }
}
