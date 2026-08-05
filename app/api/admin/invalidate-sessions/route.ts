import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { findAuthUserById } from '@/lib/auth/users-repository'
import { invalidateUserSessions, publishSessionStatus } from '@/lib/auth/session-validity'

/**
 * POST /api/admin/invalidate-sessions
 * Body: { userId: string } — force-refresh/revoke cached session status for a user.
 * Directors and admin officers only (SEC-002).
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!isRoleAllowed(session.user.role, ['director', 'admin_officer'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body: { userId?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const target = await findAuthUserById(userId)
    if (!target) {
      // Still mark inactive so any lingering JWT is denied.
      await invalidateUserSessions(userId, { isActive: false })
      return NextResponse.json({ ok: true, userId, isActive: false, note: 'user not found — marked inactive' })
    }

    await publishSessionStatus(userId, {
      isActive: Boolean(target.active),
      role: target.role,
      invalidatedAt: Date.now(),
    })

    return NextResponse.json({
      ok: true,
      userId,
      isActive: Boolean(target.active),
      role: target.role,
    })
  })
}
