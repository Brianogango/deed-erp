import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
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
    return contacts.find(contact => {
      const contactPhone = digits(contact.phone)
      const contactMobile = digits(contact.mobile)
      return contactPhone === phone || contactMobile === phone ||
        (contactPhone.length >= 9 && contactPhone.endsWith(phone.slice(-9))) ||
        (contactMobile.length >= 9 && contactMobile.endsWith(phone.slice(-9)))
    })
  }
  return undefined
}

async function requireRepairRole() {
  try {
    await requireRole(REPAIR_ROLES)
    return null
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Unauthorized' }, { status })
  }
}

async function updateRepair(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await requireRepairRole()
  if (authError) return authError

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState(['deed_repairs_v2', 'deed_contacts'])
  const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []
  const contacts = Array.isArray(state['deed_contacts']) ? state['deed_contacts'] as any[] : []
  const idx = repairs.findIndex(repair => repair.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const contact = findContact(contacts, body)
  const contactPatch = contact ? {
    customerId: contact.id,
    customerName: contact.name,
    customerPhone: contact.phone ?? contact.mobile ?? '',
    customerEmail: contact.email ?? undefined,
  } : {}

  const updated = {
    ...repairs[idx],
    ...body,
    ...contactPatch,
    id: params.id,
    updatedAt: new Date().toISOString(),
  } as unknown as RepairOrder

  repairs[idx] = updated
  await saveStoreKeys({ deed_repairs_v2: JSON.stringify(repairs) })
  return NextResponse.json(updated)
}

export const PATCH = updateRepair
export const PUT = updateRepair

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const authError = await requireRepairRole()
  if (authError) return authError

  const state = await loadAppState(['deed_repairs_v2'])
  const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] as RepairOrder[] : []
  const remaining = repairs.filter(repair => repair.id !== params.id)
  if (remaining.length === repairs.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await saveStoreKeys({ deed_repairs_v2: JSON.stringify(remaining) })
  return NextResponse.json({ ok: true })
}
