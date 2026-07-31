import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { PurchaseOrder } from '@/lib/store'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'

const STORE_KEY = 'deed_purchaseOrders'
const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

async function requireWrite() {
  const session = await getServerSession()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) {
    return { error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }) }
  }
  return { session }
}

async function readPurchaseOrders(): Promise<PurchaseOrder[]> {
  const state = await loadAppState([STORE_KEY])
  const raw = state[STORE_KEY]
  return Array.isArray(raw) ? (raw as PurchaseOrder[]) : []
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireWrite()
  if (gate.error) return gate.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const items = await readPurchaseOrders()
  const idx = items.findIndex(po => po.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existing = items[idx] as PurchaseOrder & { lockVersion?: number }
  const expectedVersion = readExpectedVersion(body)
  if (lockVersionMismatch(existing.lockVersion, expectedVersion)) {
    return NextResponse.json(
      { error: 'Record was modified by another user', lockVersion: existing.lockVersion ?? 0 },
      { status: 409 },
    )
  }

  const updated = {
    ...existing,
    ...body,
    id: params.id,
    lockVersion: nextLockVersion(existing.lockVersion),
  } as PurchaseOrder & { lockVersion: number }

  items[idx] = updated
  await saveStoreKeys({ [STORE_KEY]: JSON.stringify(items) })
  return NextResponse.json({ item: updated })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireWrite()
  if (gate.error) return gate.error

  const items = await readPurchaseOrders()
  const filtered = items.filter(po => po.id !== params.id)
  if (filtered.length === items.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await saveStoreKeys({ [STORE_KEY]: JSON.stringify(filtered) })
  return NextResponse.json({ ok: true })
}
