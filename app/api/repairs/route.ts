import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getNextRepairRef } from '@/lib/repair-ref-counter'
import type { RepairOrder } from '@/lib/store'

const REPAIR_ROLES = ['director', 'admin_officer', 'technical_lead', 'technician']

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
 * Retrieve all repairs with optional filtering by status or search query.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(REPAIR_ROLES)
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }

  try {
    const state = await loadAppState()
    let repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []

    // Apply filters
    const status = request.nextUrl.searchParams.get('status')
    const q = request.nextUrl.searchParams.get('q')?.toLowerCase()

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

    return NextResponse.json(repairs.map(stripInlinePhotoPayloads), { status: 200 })
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
  try {
    await requireRole(REPAIR_ROLES)
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
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
      intakeDate: new Date().toISOString().slice(0, 10),
      intakeNotes: '',
      issueDescription: String(body.issueDescription ?? ''),
      accessories: [],
      ...(body as Partial<RepairOrder>),
    } as RepairOrder

    // Save the updated repairs list
    const updatedRepairs = [repair, ...repairs]
    await saveStoreKeys({ 'deed_repairs_v2': JSON.stringify(updatedRepairs) })

    return NextResponse.json(repair, { status: 201 })
  } catch (err) {
    console.error('[repairs POST] Error:', err)
    return NextResponse.json({ error: 'Failed to create repair' }, { status: 500 })
  }
}
