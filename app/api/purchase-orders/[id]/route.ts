import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { PurchaseOrder } from '@/lib/store'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'
import { writeFinancialAudit } from '@/lib/finance-audit'

const STORE_KEY = 'deed_purchaseOrders'
const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

/** PO statuses that must never be removed from the blob (audit FIN-003). */
const PROTECTED_PO_STATUSES = new Set(['partial', 'received', 'billed', 'partially_received'])

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
  const idx = items.findIndex(po => po.id === params.id)
  if (idx === -1) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const existing = items[idx] as PurchaseOrder & { receiptIds?: string[]; billIds?: string[] }
  const status = String(existing.status || '').toLowerCase()

  if (status === 'cancelled') {
    return NextResponse.json({ ok: true, item: existing })
  }

  const hasReceipts = Array.isArray(existing.receiptIds) && existing.receiptIds.length > 0
  const hasBills = Array.isArray(existing.billIds) && existing.billIds.length > 0
  if (PROTECTED_PO_STATUSES.has(status) || hasReceipts || hasBills) {
    return NextResponse.json({
      error: 'Received or billed purchase orders cannot be deleted',
    }, { status: 409 })
  }

  // Soft-cancel draft/sent/confirmed POs — keep the record for audit (FIN-003).
  const cancelled = {
    ...existing,
    status: 'cancelled' as const,
    lockVersion: nextLockVersion((existing as any).lockVersion),
  }
  items[idx] = cancelled
  await saveStoreKeys({ [STORE_KEY]: JSON.stringify(items) })

  await writeFinancialAudit({
    userId: gate.session!.user.id,
    action: 'cancel_purchase_order',
    entityType: 'purchase_order',
    entityId: existing.id,
    oldValues: { status: existing.status, ref: existing.ref },
    newValues: { status: 'cancelled' },
  })

  return NextResponse.json({ ok: true, item: cancelled })
}
