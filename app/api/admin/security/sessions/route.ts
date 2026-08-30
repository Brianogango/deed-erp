import { NextResponse } from 'next/server'

import { getServerSession } from '@/lib/auth/server'
import { sql } from '@/lib/auth/db'
import { invalidateUserSessions } from '@/lib/auth/session-validity'

export async function DELETE() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'director') return NextResponse.json({ error: 'Only the Director can revoke all sessions.' }, { status: 403 })

  const { rows } = await sql`
    UPDATE users
    SET session_version = COALESCE(session_version, 1) + 1
    WHERE id <> ${session.user.id}
    RETURNING id, role, acts_as_technician
  `

  for (const row of rows) {
    await invalidateUserSessions(String(row.id), {
      isActive: false,
      role: String(row.role || ''),
      actsAsTechnician: Boolean(row.acts_as_technician),
    })
  }

  try {
    await sql`DELETE FROM user_sessions WHERE user_id <> ${session.user.id}`
  } catch {
    // JWT session_version invalidation above is authoritative; legacy
    // user_sessions cleanup is best-effort because not every install uses it.
  }

  return NextResponse.json({
    ok: true,
    revokedUsers: rows.length,
    message: rows.length
      ? `${rows.length} user session${rows.length === 1 ? '' : 's'} revoked. Your current Director session was kept.`
      : 'No other active user sessions were found.',
  }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
