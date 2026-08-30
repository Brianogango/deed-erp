import { randomBytes, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { hashPassword } from '@/lib/auth/password'

// One-time bootstrap endpoint for provisioning the first director account on
// a fresh database. It intentionally sits outside session auth (there is no
// admin yet to log in as), so it is locked down by a strong setup secret and
// permanently refuses to run after the first user exists.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function POST(request: NextRequest) {
  const setupSecret = process.env.SETUP_ADMIN_SECRET
  if (!setupSecret || setupSecret.length < 32) {
    return NextResponse.json(
      { error: 'Setup endpoint disabled or SETUP_ADMIN_SECRET is too weak.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const provided = request.headers.get('x-setup-secret') ?? ''
  if (!provided || !safeEqual(provided, setupSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
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
        { ok: false, steps: [...steps, 'Refusing to run: users already exist. Remove SETUP_ADMIN_SECRET from production and manage accounts from the Users admin UI.'] },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const allModules = JSON.stringify([
      'dashboard','sales','crm','inventory','contacts','purchase','pos','repair',
      'refurbishment','delivery','ecommerce','kilimall','accounting','hr','outsource',
      'sops','after_sales','expenses','leave','my_documents',
    ])

    const tempPassword = randomBytes(24).toString('base64url')
    const hash = await hashPassword(tempPassword)
    await sql`
      INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash, must_change_password)
      VALUES ('u_admin', 'admin', 'Administrator', 'director', ${allModules}, 1, ${new Date().toISOString().slice(0, 10)}, ${hash}, 1)
      ON CONFLICT (username) DO NOTHING
    `
    steps.push('Initial director account "admin" created — password change required at first login')

    // The temporary credential is returned exactly once over the authenticated
    // bootstrap response and is never printed to process/system logs.
    return NextResponse.json(
      {
        ok: true,
        steps,
        bootstrap: {
          username: 'admin',
          temporaryPassword: tempPassword,
          action: 'Store this password securely, sign in once, change it immediately, then remove SETUP_ADMIN_SECRET from the server environment.',
        },
      },
      { headers: { 'Cache-Control': 'no-store, private', Pragma: 'no-cache' } },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, steps, error: msg }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
