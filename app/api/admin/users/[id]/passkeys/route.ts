import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/authorization'
import { findAuthUserById } from '@/lib/auth/users-repository'
import { auditPasskey, deletePasskeys, listPasskeys } from '@/lib/auth/passkeys'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

async function guard(ctx: Ctx) {
  const session = await getServerSession()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!hasPermission(session.user, 'manageUsers')) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const targetId = String((await ctx.params).id || '').trim()
  if (!targetId || targetId.length > 128) return { error: NextResponse.json({ error: 'Invalid user id' }, { status: 400 }) }
  const target = await findAuthUserById(targetId)
  if (!target) return { error: NextResponse.json({ error: 'User not found' }, { status: 404 }) }
  return { session, target }
}

/** How many passkeys a user has (Settings → Users). */
export async function GET(_request: NextRequest, ctx: Ctx) {
  const g = await guard(ctx)
  if ('error' in g) return g.error
  const passkeys = await listPasskeys(g.target.id)
  return NextResponse.json({ passkeys: passkeys.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })) })
}

/** Lost or changed phone: remove all of a user's passkeys. Their password still works. */
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const g = await guard(ctx)
  if ('error' in g) return g.error
  const removed = await deletePasskeys(g.target.id)
  await auditPasskey('passkey.removed', g.session.user.id, g.target.id, { all: true, removed, targetName: g.target.name ?? g.target.username })
  return NextResponse.json({ ok: true, removed })
}
