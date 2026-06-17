import { NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { hashPassword } from '@/lib/auth/password'

function isAuthorized(request: Request) {
  const enabled = process.env.ENABLE_SETUP_ADMIN === 'true'
  const token = process.env.SETUP_ADMIN_TOKEN
  const provided = request.headers.get('x-setup-token') || new URL(request.url).searchParams.get('token')
  return enabled && !!token && provided === token
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Setup endpoint disabled.' },
      { status: 404 },
    )
  }

  const steps: string[] = []

  try {
    // 1. Test DB connection
    await sql`SELECT 1`
    steps.push('DB connection: OK')

    // 2. Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        modules_json TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        password_hash TEXT NOT NULL
      )
    `
    steps.push('Table: OK')

    // 3. Upsert Brian only when an explicit one-time setup password is supplied.
    const setupPassword = process.env.SETUP_ADMIN_PASSWORD
    if (!setupPassword) {
      return NextResponse.json(
        { ok: false, steps, error: 'SETUP_ADMIN_PASSWORD is required.' },
        { status: 500 },
      )
    }

    const allModules = JSON.stringify([
      'dashboard','sales','crm','inventory','contacts','purchase','pos','repair',
      'refurbishment','delivery','ecommerce','kilimall','accounting','hr','outsource',
      'sops','after_sales','expenses','leave','my_documents',
    ])
    const hash = await hashPassword(setupPassword)
    await sql`
      INSERT INTO users (id, username, name, role, modules_json, active, created_at, password_hash)
      VALUES ('u_brian', 'brian', 'Brian', 'director', ${allModules}, 1, '2026-04-25', ${hash})
      ON CONFLICT (username) DO UPDATE
        SET name        = EXCLUDED.name,
            role        = EXCLUDED.role,
            modules_json = EXCLUDED.modules_json,
            active      = EXCLUDED.active,
            password_hash = EXCLUDED.password_hash
    `
    steps.push('User brian: upserted')

    // 4. Verify users
    const { rows } = await sql`SELECT id, username, name, role, active FROM users ORDER BY created_at`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps.push(`Users in DB (${rows.length}): ${rows.map((r: any) => r.username as string).join(', ')}`)

    // 5. Check app_state table (ERP data sync)
    try {
      await sql`CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`
      const { rows: stateRows } = await sql`SELECT key, updated_at, length(value) as bytes FROM app_state ORDER BY updated_at DESC`
      if (stateRows.length === 0) {
        steps.push('app_state: EMPTY — ERP data has never been synced to DB')
        steps.push('FIX: Use the app on any device, wait 2 seconds, then reload another device')
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        steps.push(`app_state: ${stateRows.length} keys synced (latest: ${(stateRows[0] as any).updated_at})`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        steps.push(`Keys: ${stateRows.map((r: any) => `${r.key}(${Math.round(r.bytes/1024)}kb)`).join(', ')}`)
      }
    } catch (e2) {
      steps.push(`app_state check failed: ${e2 instanceof Error ? e2.message : String(e2)}`)
    }

    return NextResponse.json({ ok: true, steps })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, steps, error: msg }, { status: 500 })
  }
}
