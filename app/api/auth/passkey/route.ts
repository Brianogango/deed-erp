import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { auditPasskey, deletePasskeys, listPasskeys } from '@/lib/auth/passkeys'

export const dynamic = 'force-dynamic'

/** Your own passkeys: the list in Account → Security. */
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ message: 'Sign in first' }, { status: 401 })
  const passkeys = await listPasskeys(session.user.id)
  return NextResponse.json(
    { passkeys: passkeys.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/** Remove one of your own passkeys (?id=…). */
export async function DELETE(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ message: 'Sign in first' }, { status: 401 })
  const id = request.nextUrl.searchParams.get('id') || ''
  if (!id || id.length > 1024) return NextResponse.json({ message: 'Which passkey?' }, { status: 400 })
  const removed = await deletePasskeys(session.user.id, id)
  if (!removed) return NextResponse.json({ message: 'Passkey not found' }, { status: 404 })
  await auditPasskey('passkey.removed', session.user.id, session.user.id, { id: id.slice(0, 24) })
  return NextResponse.json({ ok: true })
}
