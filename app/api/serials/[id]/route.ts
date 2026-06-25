import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { normalizePermissionRole } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { SerialNumber } from '@/lib/store'

const ALLOWED_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

async function requireWriteRole() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = normalizePermissionRole(session.user.role)
  const allowed = ALLOWED_ROLES.map(item => normalizePermissionRole(item)).filter(Boolean)
  if (!role || !allowed.includes(role)) {
    return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
  }
  return null
}

async function updateSerial(request: NextRequest, id: string) {
  const authError = await requireWriteRole()
  if (authError) return authError

  const body = await request.json().catch(() => null) as Partial<SerialNumber> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState(['deed_serials'])
  const serials = Array.isArray(state.deed_serials) ? state.deed_serials as SerialNumber[] : []
  const idx = serials.findIndex(item => item.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const next = { ...serials[idx], ...body, id }
  const serialValue = String(next.serial ?? '').trim()
  if (!serialValue) return NextResponse.json({ error: 'serial is required' }, { status: 422 })

  const serialConflict = serials.find(item => item.id !== id && normalize(item.serial) === normalize(serialValue))
  if (serialConflict) return NextResponse.json({ error: `Serial "${serialValue}" already exists` }, { status: 422 })

  const barcodeValue = String(next.barcode ?? '').trim()
  if (barcodeValue) {
    const barcodeConflict = serials.find(item => item.id !== id && normalize(item.barcode) === normalize(barcodeValue))
    if (barcodeConflict) return NextResponse.json({ error: `Inventory barcode "${barcodeValue}" already exists` }, { status: 422 })
  }

  serials[idx] = next
  await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
  return NextResponse.json({ item: next })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return updateSerial(request, params.id)
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return updateSerial(request, params.id)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const authError = await requireWriteRole()
  if (authError) return authError

  const state = await loadAppState(['deed_serials'])
  const serials = Array.isArray(state.deed_serials) ? state.deed_serials as SerialNumber[] : []
  const filtered = serials.filter(item => item.id !== params.id)
  if (filtered.length === serials.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await saveStoreKeys({ deed_serials: JSON.stringify(filtered) })
  return NextResponse.json({ ok: true })
}
