import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { getNextRepairRef } from '@/lib/repair-ref-counter'
import { paginateArray, paginationParams } from '@/lib/api/pagination'
import type { RepairOrder } from '@/lib/store'

const REPAIR_ROLES = ['director', 'admin_officer', 'technical_lead', 'technician']

function digits(value?: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

function findContact(contacts: any[], body: Record<string, unknown>) {
  if (typeof body.customerId === 'string' && body.customerId) {
    const byId = contacts.find(contact => contact.id === body.customerId)
    if (byId) return byId
  }

  const phone = digits(body.customerPhone)
  if (phone.length >= 9) {
    const byPhone = contacts.find(contact => {
      const contactPhone = digits(contact.phone)
      const contactMobile = digits(contact.mobile)
      return contactPhone === phone || contactMobile === phone ||
        (contactPhone.length >= 9 && contactPhone.endsWith(phone.slice(-9))) ||
        (contactMobile.length >= 9 && contactMobile.endsWith(phone.slice(-9)))
    })
    if (byPhone) return byPhone
  }

  const name = String(body.customerName ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (name) return contacts.find(contact => String(contact.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === name)
  return undefined
}

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
    const { page, limit, q, status, requested } = paginationParams(request.url)
    const state = await loadAppState()
    let repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []

    // Apply filters
    if (status) {
      repairs = repairs.filter(r => r.status === status)
    }
    if (q) {
      const needle = q.toLowerCase()
      repairs = repairs.filter(r =>
        r.ref.toLowerCase().includes(needle) ||
        r.customerName.toLowerCase().includes(needle) ||
        (r.customerPhone ?? '').toLowerCase().includes(needle) ||
        r.productName.toLowerCase().includes(needle) ||
        (r.serialNumber ?? '').toLowerCase().includes(needle)
      )
    }

    const sanitized = repairs.map(stripInlinePhotoPayloads)
    if (!requested) return NextResponse.json(sanitized, { status: 200 })
    return NextResponse.json(paginateArray(sanitized, page, limit), { status: 200 })
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
    const contacts = Array.isArray(state['deed_contacts']) ? state['deed_contacts'] as any[] : []
    const contact = findContact(contacts, body)
    const now = new Date().toISOString()

    // Create the new repair
    const repair: RepairOrder = {
      ...(body as Partial<RepairOrder>),
      id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `rep_${Date.now()}`,
      ref,
      status: String(body.status ?? 'received') as RepairOrder['status'],
      customerId: String(contact?.id ?? body.customerId ?? ''),
      customerName: String(contact?.name ?? body.customerName),
      customerPhone: String(contact?.phone ?? contact?.mobile ?? body.customerPhone ?? ''),
      customerEmail: String(contact?.email ?? body.customerEmail ?? '') || undefined,
      productId: String(body.productId ?? ''),
      productName: String(body.productName),
      serialNumber: String(body.serialNumber ?? ''),
      intakeChannel: (body.intakeChannel === 'website' || body.intakeChannel === 'whatsapp' || body.intakeChannel === 'call' || body.intakeChannel === 'email' || body.intakeChannel === 'rider_pickup') ? body.intakeChannel as RepairOrder['intakeChannel'] : 'walk_in',
      intakeDate: new Date().toISOString().slice(0, 10),
      intakeNotes: '',
      issueDescription: String(body.issueDescription ?? ''),
      accessories: Array.isArray((body as any).accessories) ? (body as any).accessories : [],
      createdAt: typeof body.createdAt === 'string' ? body.createdAt : now,
      updatedAt: now,
    } as unknown as RepairOrder

    // Save the updated repairs list
    const updatedRepairs = [repair, ...repairs.filter(item => item.id !== repair.id && item.ref !== repair.ref)]
    await saveStoreKeys({ 'deed_repairs_v2': JSON.stringify(updatedRepairs) })

    return NextResponse.json(repair, { status: 201 })
  } catch (err) {
    console.error('[repairs POST] Error:', err)
    return NextResponse.json({ error: 'Failed to create repair' }, { status: 500 })
  }
}
