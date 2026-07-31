import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { sql } from '@/lib/auth/db'
import { uncertifiedProtectedKeys } from '@/lib/blob-cutover'
import { listCutoverCertificates } from '@/lib/blob-cutover.server'

const RESET_CONFIRMATION = 'RESET DEED ERP PRODUCTION DATA'
const FORCE_UNCERTIFIED = 'FORCE UNCERTIFIED BLOB WIPE'

async function ensureAdminAuditLog() {
  await sql`CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
}

async function writeAdminAuditLog(req: NextRequest, session: Awaited<ReturnType<typeof getServerSession>>, action: string, details: Record<string, unknown>) {
  if (!session) return
  try {
    await ensureAdminAuditLog()
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? null
    const userAgent = req.headers.get('user-agent') ?? null
    await sql`INSERT INTO admin_audit_log (user_id, username, role, action, details, ip_address, user_agent)
      VALUES (${session.user.id}, ${session.user.username}, ${session.user.role}, ${action}, ${JSON.stringify(details)}, ${ip}, ${userAgent})`
  } catch (err) {
    console.error('[admin-audit] logging failed:', err)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, ['director'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Typed confirmation is required' }, { status: 400 })
  }

  const confirmation = body && typeof body === 'object' && 'confirmation' in body
    ? String((body as { confirmation?: unknown }).confirmation ?? '').trim()
    : ''
  const forceUncertified = body && typeof body === 'object' && 'forceUncertifiedConfirmation' in body
    ? String((body as { forceUncertifiedConfirmation?: unknown }).forceUncertifiedConfirmation ?? '').trim()
    : ''

  if (confirmation !== RESET_CONFIRMATION) {
    await writeAdminAuditLog(req, session, 'reset_all_data_rejected', { reason: 'invalid_confirmation' })
    return NextResponse.json({ error: `Type ${RESET_CONFIRMATION} to confirm reset` }, { status: 400 })
  }

  try {
    const certificates = await listCutoverCertificates()
    const uncertified = uncertifiedProtectedKeys(
      certificates.map(c => ({
        blobKey: c.blobKey,
        status: c.status as 'pending' | 'verified' | 'certified' | 'archived' | 'blocked',
        parityOk: c.parityOk,
      })),
    )

    if (uncertified.length > 0 && forceUncertified !== FORCE_UNCERTIFIED) {
      await writeAdminAuditLog(req, session, 'reset_all_data_blocked_uncertified', {
        uncertified,
      })
      return NextResponse.json({
        error: 'Protected blob keys are not certified for cutover. Certify via /api/admin/blob-cutover or send forceUncertifiedConfirmation.',
        uncertifiedProtectedKeys: uncertified,
        forceUncertifiedConfirmation: FORCE_UNCERTIFIED,
        hint: 'Prefer verify → certify → archive → retire per key instead of wiping uncertified dual-write blobs.',
      }, { status: 409 })
    }

    await writeAdminAuditLog(req, session, 'reset_all_data_started', {
      confirmation: true,
      forceUncertified: forceUncertified === FORCE_UNCERTIFIED,
      uncertifiedAtStart: uncertified,
    })

    // Clear app_state (all ERP localStorage-synced data)
    await sql`DELETE FROM app_state`

    // Clear all structured Prisma tables in dependency order (children first)
    await sql`DELETE FROM invoice_lines`
    await sql`DELETE FROM invoices`
    await sql`DELETE FROM sale_order_lines`
    await sql`DELETE FROM sale_orders`
    await sql`DELETE FROM po_lines`
    await sql`DELETE FROM purchase_orders`
    await sql`DELETE FROM repair_orders`
    await sql`DELETE FROM serials`
    await sql`DELETE FROM warranties`
    await sql`DELETE FROM kilimall_orders`
    await sql`DELETE FROM employees`
    await sql`DELETE FROM contacts`
    await sql`DELETE FROM products`
    await sql`DELETE FROM app_settings`

    await writeAdminAuditLog(req, session, 'reset_all_data_completed', { ok: true })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[reset] error:', err)
    await writeAdminAuditLog(req, session, 'reset_all_data_failed', { error: String(err) })
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 })
  }
}
