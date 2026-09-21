import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { cleanupOrphanedBlobs } from '@/lib/blob-cleanup'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function requireDirector(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = req.headers.get('x-internal-secret')
  if (internalSecret && providedSecret === internalSecret) return { ok: true as const }
  const session = await getServerSession()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isRoleAllowed(session.user.role, ['director'])) {
    return { error: NextResponse.json({ error: 'Forbidden — director only' }, { status: 403 }) }
  }
  return { ok: true as const }
}

export async function GET(req: NextRequest) {
  const auth = await requireDirector(req)
  if ('error' in auth) return auth.error
  const result = await cleanupOrphanedBlobs({ dryRun: true })
  return NextResponse.json({ dryRun: true, ...result })
}

export async function POST(req: NextRequest) {
  const auth = await requireDirector(req)
  if ('error' in auth) return auth.error
  const body = await req.json().catch(() => ({}))
  const dryRun = (body as { dryRun?: boolean }).dryRun !== false
  const result = await cleanupOrphanedBlobs({ dryRun })
  return NextResponse.json({ dryRun, ...result })
}
