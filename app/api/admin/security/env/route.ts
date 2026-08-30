import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { NextRequest, NextResponse } from 'next/server'

import { getServerSession } from '@/lib/auth/server'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  applyEnvUpdates,
  readEnvFile,
  summarizeEnv,
} from '@/lib/security/production-env'

const execFileAsync = promisify(execFile)
const CONFIRM_PHRASE = 'SAVE DEED ERP ENV'

type DirectorGate =
  | { session: NonNullable<Awaited<ReturnType<typeof getServerSession>>> }
  | { error: NextResponse }

async function requireDirector(): Promise<DirectorGate> {
  const session = await getServerSession()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (session.user.role !== 'director') {
    return { error: NextResponse.json({ error: 'Only the Director can manage production environment secrets.' }, { status: 403 }) }
  }
  return { session }
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, private' },
  })
}

export async function GET() {
  const gate = await requireDirector()
  if ('error' in gate) return gate.error

  try {
    const file = readEnvFile()
    return noStore({
      ok: true,
      path: file.path,
      fields: summarizeEnv(file.values),
      confirmPhrase: CONFIRM_PHRASE,
    })
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 500
    return noStore({ error: error instanceof Error ? error.message : 'Could not read environment file' }, status >= 400 ? status : 500)
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireDirector()
  if ('error' in gate) return gate.error

  const rl = await checkRateLimit(`env-settings:${gate.session.user.id}`, 20, 60 * 60)
  if (!rl.success) return noStore({ error: 'Too many environment updates. Try again later.' }, 429)

  let body: {
    updates?: Record<string, string>
    generate?: string[]
    add?: { key: string; value: string }
    reload?: boolean
    confirm?: string
  }
  try {
    body = await request.json()
  } catch {
    return noStore({ error: 'Invalid payload' }, 400)
  }

  if (body.confirm !== CONFIRM_PHRASE) {
    return noStore({ error: `Type ${CONFIRM_PHRASE} to save environment changes.` }, 400)
  }

  const updates = body.updates && typeof body.updates === 'object' ? body.updates : {}
  const generate = Array.isArray(body.generate) ? body.generate.filter(key => typeof key === 'string') : []
  if (!Object.keys(updates).length && !generate.length && !body.add) {
    return noStore({ error: 'No environment changes were provided.' }, 400)
  }

  try {
    const result = applyEnvUpdates({
      updates: Object.fromEntries(
        Object.entries(updates).filter(([key, value]) => typeof key === 'string' && typeof value === 'string'),
      ),
      generate,
      add: body.add && typeof body.add.key === 'string' && typeof body.add.value === 'string'
        ? { key: body.add.key, value: body.add.value }
        : undefined,
    })

    let reloaded = false
    let reloadError: string | null = null
    if (body.reload && process.env.NODE_ENV === 'production' && process.env.DEED_SKIP_PM2_RELOAD !== 'true') {
      try {
        await execFileAsync('pm2', ['reload', 'deed-erp', '--update-env'], { timeout: 30_000 })
        reloaded = true
      } catch (error) {
        reloadError = error instanceof Error ? error.message : 'PM2 reload failed'
      }
    }

    return noStore({
      ok: true,
      changed: result.changed,
      fields: summarizeEnv(result.nextValues),
      reloaded,
      reloadError,
      message: reloaded
        ? 'Environment saved and the app is reloading. Privileged sessions may need MFA again.'
        : 'Environment saved. Reload the app for secrets and NEXT_PUBLIC_ values to take effect.',
    })
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status: number }).status) : 400
    return noStore({ error: error instanceof Error ? error.message : 'Could not save environment file' }, status >= 400 ? status : 500)
  }
}
