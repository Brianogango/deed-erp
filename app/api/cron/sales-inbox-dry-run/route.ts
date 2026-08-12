import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { generateSalesInboxDryRunReport } from '@/lib/crm/inbox/dry-run-report'
import { salesInboxConfigured } from '@/lib/crm/sales-inbox-imap'

function cronAuthorized(req: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  const header = (req.headers.get('authorization') || '').trim()
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const alt = (req.headers.get('x-cron-secret') || '').trim()
  const provided = bearer || alt
  if (!provided || provided.length !== secret.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  } catch {
    return false
  }
}

/**
 * Historical mailbox dry-run report (no CRM writes).
 * Auth: Bearer CRON_SECRET, or director/admin session.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const cronOk = cronAuthorized(req)
    if (!cronOk) {
      await requireRole(['director', 'admin_officer', 'super_admin'])
    }

    if (!salesInboxConfigured()) {
      return NextResponse.json({
        ok: false,
        error: 'Sales IMAP not configured',
      }, { status: 503 })
    }

    const body = await req.json().catch(() => ({})) as {
      limit?: number
      lookbackHours?: number
    }

    const report = await generateSalesInboxDryRunReport({
      limit: body.limit,
      lookbackHours: body.lookbackHours,
    })

    return NextResponse.json({ ok: true, report })
  })
}

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const cronOk = cronAuthorized(req)
    if (!cronOk) await getRequiredSession()
    return NextResponse.json({
      configured: salesInboxConfigured(),
      hint: 'POST with { lookbackHours, limit } for a dry-run disposition report',
    })
  })
}
