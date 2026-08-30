import { NextRequest, NextResponse } from 'next/server'

import { getServerSession } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/authorization'
import { resetUserMfa } from '@/lib/auth/mfa'
import { findAuthUserById } from '@/lib/auth/users-repository'
import { invalidateUserSessions } from '@/lib/auth/session-validity'
import { checkRateLimit } from '@/lib/rate-limit'

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPermission(session.user, 'manageUsers')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const targetId = String(params.id || '').trim()
  if (!targetId || targetId.length > 128) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })

  // A privileged user must not be able to remove their own second factor from
  // an already-authenticated browser session. Recovery requires another director.
  if (targetId === session.user.id) {
    return NextResponse.json({ error: 'A different director must reset your MFA.' }, { status: 409 })
  }

  const rl = await checkRateLimit(`mfa-admin-reset:${session.user.id}`, 5, 60 * 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many MFA reset requests.' }, { status: 429 })

  const target = await findAuthUserById(targetId)
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  await resetUserMfa(target.id)
  await invalidateUserSessions(target.id, {
    isActive: target.active,
    role: target.role,
    actsAsTechnician: Boolean(target.actsAsTechnician),
  })

  return NextResponse.json(
    {
      ok: true,
      message: 'MFA reset. The user has been signed out and must enroll a new authenticator on next privileged sign-in.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
