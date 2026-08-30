import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { getServerSession } from '@/lib/auth/server'
import { sql } from '@/lib/auth/db'
import { invalidateUserSessions } from '@/lib/auth/session-validity'

const COOKIE_NAME = 'deed-session'

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'director') {
    return NextResponse.json({ error: 'Only the Director can revoke user sessions.' }, { status: 403 })
  }

  const { rows } = await sql`
    SELECT id, user_id, token_hash
    FROM user_sessions
    WHERE id = ${params.id}
    LIMIT 1
  `
  const target = rows[0]
  if (!target) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const currentJwt = request.cookies.get(COOKIE_NAME)?.value || ''
  const currentHash = currentJwt ? crypto.createHash('sha256').update(currentJwt).digest('hex') : ''
  if (currentHash && String(target.token_hash) === currentHash) {
    return NextResponse.json({ error: 'Use Sign out to close your current Director session.' }, { status: 400 })
  }

  const userId = String(target.user_id)
  const updated = await sql`
    UPDATE users
    SET session_version = COALESCE(session_version, 1) + 1,
        updated_at = NOW()
    WHERE id = ${userId}
    RETURNING role, acts_as_technician
  `
  if (!updated.rows.length) return NextResponse.json({ error: 'Session user not found' }, { status: 404 })

  const user = updated.rows[0]
  await invalidateUserSessions(userId, {
    isActive: false,
    role: String(user.role || ''),
    actsAsTechnician: Boolean(user.acts_as_technician),
  })
  await sql`DELETE FROM user_sessions WHERE user_id = ${userId}`

  return NextResponse.json(
    { ok: true, message: 'User sessions revoked. A fresh password/MFA sign-in is required.' },
    { headers: { 'Cache-Control': 'no-store, private' } },
  )
}
