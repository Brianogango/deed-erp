import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { getEmailConfigStatus } from '@/lib/integrations/email'

/**
 * GET /api/integrations/email-status
 * Director/admin diagnostics for outbound email (no secrets).
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('admin.email')
    return NextResponse.json({ success: true, status: getEmailConfigStatus() })
  })
}
