import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/authorization'
import { appendInventoryAuditLog } from '@/lib/inventory/audit'

/**
 * Server-authored commercial audit append (P0-SEC-002).
 * Replaces client writes to deed_auditLogs via store sync.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPermission(session.user, 'appendAuditLog')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { action?: string; documentRef?: string; details?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = String(body.action ?? '').trim()
  const documentRef = String(body.documentRef ?? '').trim()
  const details = String(body.details ?? '').trim()
  if (!action || !documentRef) {
    return NextResponse.json({ error: 'action and documentRef are required' }, { status: 400 })
  }

  await appendInventoryAuditLog({
    action,
    documentRef,
    details,
    userId: session.user.id,
    username: session.user.username || session.user.name,
  })

  return NextResponse.json({ ok: true })
}
