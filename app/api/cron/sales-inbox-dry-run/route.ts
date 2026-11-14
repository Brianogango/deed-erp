import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { generateSalesInboxDryRunReport } from '@/lib/crm/inbox/dry-run-report'
import { salesInboxConfigured } from '@/lib/crm/sales-inbox-imap'
import { cronAuthorized } from '@/lib/cron-auth'

/**
 * Historical mailbox dry-run report (no CRM writes).
 * Auth: Bearer CRON_SECRET, or director/admin session.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const cronOk = cronAuthorized(req)
    if (!cronOk) {
      await requirePermission('admin.jobs')
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
