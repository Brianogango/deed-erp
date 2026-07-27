import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { SerialNumber } from '@/lib/store'
import { appendInventoryAuditLog } from '@/lib/inventory/audit'
import { validateSerialEdit } from '@/lib/inventory/serial-edit'

async function requireSerialEditRole() {
  const session = await getServerSession()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!hasPermission(session.user, 'editSerialNumber')) {
    return { error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }) }
  }
  return { session }
}

async function updateSerial(request: NextRequest, id: string) {
  const auth = await requireSerialEditRole()
  if (auth.error) return auth.error
  const session = auth.session

  const body = await request.json().catch(() => null) as (Partial<SerialNumber> & { reason?: string }) | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState(['deed_serials'])
  const serials = Array.isArray(state.deed_serials) ? state.deed_serials as SerialNumber[] : []
  const idx = serials.findIndex(item => item.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const current = serials[idx]
  const validated = validateSerialEdit({
    current,
    next: {
      serial: body.serial ?? current.serial,
      barcode: body.barcode ?? current.barcode,
      specs: body.specs ?? current.specs,
      conditionNotes: body.accessoryNotes ?? current.accessoryNotes,
      notes: undefined,
    },
    existing: serials,
    reason: body.reason,
  })
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 422 })

  const next: SerialNumber = {
    ...current,
    serial: validated.patch.serial,
    barcode: validated.patch.barcode || validated.patch.serial,
    specs: validated.patch.specs,
    accessoryNotes: validated.patch.conditionNotes,
  }
  serials[idx] = next
  await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
  await appendInventoryAuditLog({
    action: 'serial_edit',
    documentRef: next.serial,
    details: `Serial ${current.serial} → ${next.serial} (product ${current.productId}). Reason: ${body.reason || 'n/a'}`,
    userId: session.user.id,
    username: session.user.username || session.user.name,
  })
  return NextResponse.json({ item: next })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return updateSerial(request, params.id)
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return updateSerial(request, params.id)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireSerialEditRole()
  if (auth.error) return auth.error
  const session = auth.session

  const state = await loadAppState(['deed_serials'])
  const serials = Array.isArray(state.deed_serials) ? state.deed_serials as SerialNumber[] : []
  const existing = serials.find(item => item.id === params.id)
  const filtered = serials.filter(item => item.id !== params.id)
  if (filtered.length === serials.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await saveStoreKeys({ deed_serials: JSON.stringify(filtered) })
  await appendInventoryAuditLog({
    action: 'serial_delete',
    documentRef: existing?.serial || params.id,
    details: `Deleted serial ${existing?.serial || params.id}`,
    userId: session.user.id,
    username: session.user.username || session.user.name,
  })
  return NextResponse.json({ ok: true })
}
