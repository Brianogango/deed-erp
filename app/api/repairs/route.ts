import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getNextRepairRef } from '@/lib/repair-ref-counter'
import type { RepairOrder } from '@/lib/store'

/**
 * GET /api/repairs
 * Retrieve all repairs with optional filtering by status or search query.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    return NextResponse.json(repairs, { status: 200 })
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

    // Create the new repair
    const repair: RepairOrder = {
      id: `rep_${Date.now()}`,
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
