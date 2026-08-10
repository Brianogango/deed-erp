import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { processSalesInboxLeads, salesInboxConfigured } from '@/lib/crm/sales-inbox-process'

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
 * Poll sales@ IMAP → create CRM leads (round-robin when crmAutoAssignLeads).
 * Auth: Bearer CRON_SECRET, or director/admin session.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const cronOk = cronAuthorized(req)
    if (!cronOk) {
      const user = await requireRole(['director', 'admin_officer', 'super_admin'])
      void user
    }

    if (!salesInboxConfigured()) {
      return NextResponse.json({
        ok: false,
        error: 'Sales IMAP not configured',
        hint: 'Set SALES_IMAP_PASS (or reuse SALES_SMTP_PASS) and ensure mail.deed.co.ke:993 is reachable',
      }, { status: 503 })
    }

    const body = await req.json().catch(() => ({})) as {
      limit?: number
      includeRecentSeen?: boolean
      lookbackHours?: number
      dryRun?: boolean
    }

    const result = await processSalesInboxLeads({
      limit: body.limit,
      includeRecentSeen: body.includeRecentSeen,
      lookbackHours: body.lookbackHours,
      dryRun: body.dryRun,
    })

    return NextResponse.json({ ok: result.errors.length === 0 || result.created > 0, ...result })
  })
}

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const cronOk = cronAuthorized(req)
    if (!cronOk) {
      await getRequiredSession()
    }
    return NextResponse.json({
      configured: salesInboxConfigured(),
      mailbox: process.env.SALES_EMAIL || process.env.SALES_IMAP_USER || 'sales@deed.co.ke',
      host: process.env.SALES_IMAP_HOST || process.env.SMTP_HOST || 'mail.deed.co.ke',
      port: Number(process.env.SALES_IMAP_PORT || 993),
    })
  })
}
