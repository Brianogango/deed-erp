import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { runNotificationWorker } from '@/lib/notifications/worker'
import { scanOperationalNotificationEvents } from '@/lib/notifications/operational-scanner'
import { processDepartmentEmailReplies } from '@/lib/notifications/email-inbox'

function secretOk(request: NextRequest) {
  const expected = String(process.env.CRON_SECRET || '').trim()
  const auth = String(request.headers.get('authorization') || '').trim()
  const supplied = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : String(request.headers.get('x-cron-secret') || '').trim()
  if (!expected || !supplied || expected.length !== supplied.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)) } catch { return false }
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    if (!secretOk(request)) await requireRole(['director', 'admin_officer', 'super_admin'])
    const scan = await scanOperationalNotificationEvents()
    const emailInbox = await processDepartmentEmailReplies().catch(error => ({ error: error instanceof Error ? error.message : 'email inbox processing failed' }))
    const worker = await runNotificationWorker()
    return NextResponse.json({ ok: true, scan, emailInbox, worker })
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
