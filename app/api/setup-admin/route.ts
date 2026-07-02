import { randomBytes, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { hashPassword } from '@/lib/auth/password'

// One-time bootstrap endpoint for provisioning the first director account on
// a fresh database. It intentionally sits outside session auth (there is no
// admin yet to log in as), so it is locked down instead by:
//   - requiring SETUP_ADMIN_SECRET to be set and matched via a header
//   - refusing to run once any user already exists (no repeatable reset)
//   - never hardcoding a password — a random one is generated and logged
//     server-side only, never returned in the HTTP response
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

    const tempPassword = randomBytes(18).toString('base64url')
    const hash = await hashPassword(tempPassword)
    await sql`
      INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash, must_change_password)
      VALUES ('u_admin', 'admin', 'Administrator', 'director', ${allModules}, 1, ${new Date().toISOString().slice(0, 10)}, ${hash}, 1)
      ON CONFLICT (username) DO NOTHING
    `
    steps.push('Initial director account "admin" created — must change password at first login')

    // Logged server-side only; never included in the HTTP response.
    console.warn(`[setup-admin] Temporary password for "admin": ${tempPassword}`)

    return NextResponse.json({ ok: true, steps })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, steps, error: msg }, { status: 500 })
  }
}
