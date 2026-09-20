import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { transferBlobsToPrisma, countLiveAppStateKeys } from '@/lib/blob-transfer'
import { storeBackend, countStoreRecords } from '@/lib/prisma-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function forbidden() {
  return NextResponse.json({ error: 'Forbidden — director only' }, { status: 403 })
}

async function requireDirectorOrSecret(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = req.headers.get('x-internal-secret')
  if (internalSecret && providedSecret === internalSecret) return { ok: true as const }
  const session = await getServerSession()
  if (!session) return { error: unauthorized() }
  if (!isRoleAllowed(session.user.role, ['director'])) return { error: forbidden() }
  return { ok: true as const }
}

/**
 * GET /api/admin/blob-transfer
 * Status of Prisma store_records vs legacy app_state.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirectorOrSecret(req)
  if ('error' in auth) return auth.error
  const prismaCount = await countStoreRecords().catch(() => null)
  const appStateCount = await countLiveAppStateKeys().catch(() => null)
  return NextResponse.json({
    ok: true,
    backend: storeBackend(),
    storeRecords: prismaCount,
    liveAppStateKeys: appStateCount,
    retireRequires: 'RETIRE_APP_STATE',
    note: 'JSON collections live in Prisma store_records. Binary files stay in the object store. Retire deletes live app_state only after a Prisma copy exists.',
  })
}

/**
 * POST /api/admin/blob-transfer
 * Copy every JSON app_state collection into Prisma store_records and upsert
 * dedicated relational tables (POs, serials, stock moves, deliveries, GRNs, …).
 * Binary files stay in the object store.
 *
 * Body: { retire?: boolean, confirm?: "RETIRE_APP_STATE" }
 * retire deletes live app_state keys only after a Prisma copy exists and
 * archive: copies are written.
 */
export async function POST(req: NextRequest) {
  const auth = await requireDirectorOrSecret(req)
  if ('error' in auth) return auth.error

  let body: { retire?: boolean; confirm?: string } = {}
  try { body = await req.json() } catch { body = {} }

  const retire = Boolean(body.retire)
  if (retire && body.confirm !== 'RETIRE_APP_STATE') {
    return NextResponse.json({
      error: 'Retiring app_state requires confirm: "RETIRE_APP_STATE"',
    }, { status: 400 })
  }

  const result = await transferBlobsToPrisma({ retire })
  return NextResponse.json(result, { status: result.ok ? 200 : 207 })
}
