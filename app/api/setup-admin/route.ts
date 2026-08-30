import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { hashPassword } from '@/lib/auth/password'
import { isStrongBootstrapPassword } from '@/lib/auth/temporary-credentials'
import { InputSecurityError, readSafeJson } from '@/lib/input-security'

// One-time bootstrap endpoint for provisioning the first director account on
// a fresh database. It requires SETUP_ADMIN_SECRET, refuses to run once a user
// exists, and never generates, logs, or returns a password. The caller must
// supply a strong initial password over the protected HTTPS setup request.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function POST(request: NextRequest) {
  const setupSecret = process.env.SETUP_ADMIN_SECRET
  if (!setupSecret) {
    return NextResponse.json(
      { error: 'Setup endpoint disabled. Set SETUP_ADMIN_SECRET to enable one-time bootstrap.' },
      { status: 503 }
    )
  }

  const provided = request.headers.get('x-setup-secret') ?? ''
  if (!provided || !safeEqual(provided, setupSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await readSafeJson(request, {
      maxBytes: 4096,
      limits: { maxDepth: 3, maxNodes: 20, maxObjectKeys: 4, maxArrayLength: 0, maxStringLength: 256 },
    })
  } catch (error) {
    if (error instanceof InputSecurityError) {
      return NextResponse.json({ error: 'Invalid setup payload' }, { status: error.status })
    }
    throw error
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected setup object' }, { status: 400 })
  }
  const fields = Object.keys(body as Record<string, unknown>)
  if (fields.length !== 1 || fields[0] !== 'password') {
    return NextResponse.json({ error: 'Expected exactly { password }' }, { status: 400 })
  }
  const initialPassword = (body as Record<string, unknown>).password
  if (!isStrongBootstrapPassword(initialPassword)) {
    return NextResponse.json(
      { error: 'Initial password must be 16–128 characters with uppercase, lowercase, number, and symbol.' },
      { status: 400 },
    )
  }

  const steps: string[] = []

  try {
    await sql`SELECT 1`
    steps.push('DB connection: OK')

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        modules_json TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER DEFAULT 1
      )
    `
    steps.push('Table: OK')

    const { rows: countRows } = await sql`SELECT COUNT(*) as count FROM users`
    if (Number(countRows[0].count) > 0) {
      return NextResponse.json(
        { ok: false, steps: [...steps, 'Refusing to run: users already exist. Manage accounts from the Users admin UI instead.'] },
        { status: 409 }
      )
    }

    const allModules = JSON.stringify([
      'dashboard','sales','crm','inventory','contacts','purchase','pos','repair',
      'refurbishment','delivery','ecommerce','kilimall','accounting','hr','outsource',
      'sops','after_sales','expenses','leave','my_documents',
    ])

    const hash = await hashPassword(initialPassword)
    await sql`
      INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash, must_change_password)
      VALUES ('u_admin', 'admin', 'Administrator', 'director', ${allModules}, 1, ${new Date().toISOString().slice(0, 10)}, ${hash}, 1)
      ON CONFLICT (username) DO NOTHING
    `
    steps.push('Initial director account "admin" created — must change password at first login')

    return NextResponse.json({ ok: true, steps })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, steps, error: msg }, { status: 500 })
  }
}
