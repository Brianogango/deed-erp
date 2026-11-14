import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { processSalesInboxLeads, salesInboxConfigured } from '@/lib/crm/sales-inbox-process'
import { cronAuthorized } from '@/lib/cron-auth'

/**
 * Poll sales@ IMAP → create CRM leads (round-robin when crmAutoAssignLeads).
 * Auth: Bearer CRON_SECRET, or director/admin session.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const cronOk = cronAuthorized(req)
    if (!cronOk) {
      const user = await requirePermission('admin.jobs')
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
