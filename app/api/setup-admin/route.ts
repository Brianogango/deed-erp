import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { createAuthUser } from '@/lib/auth/users-repository'
import { ROLE_DEFAULT_MODULES } from '@/lib/auth/types'
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

    // Bootstrap is not a migration mechanism. Require the real production
    // schema so this endpoint cannot create an incompatible legacy users table.
    const { rows: schemaRows } = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name IN (
          'id', 'username', 'email', 'role', 'password_hash',
          'is_active', 'must_reset_pw', 'created_at', 'updated_at',
          'modules_json', 'active', 'must_change_password', 'session_version'
        )
    `
    const requiredColumns = new Set([
      'id', 'username', 'email', 'role', 'password_hash',
      'is_active', 'must_reset_pw', 'created_at', 'updated_at',
      'modules_json', 'active', 'must_change_password', 'session_version',
    ])
    for (const row of schemaRows) requiredColumns.delete(String(row.column_name))
    if (requiredColumns.size > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Database schema is not ready for secure bootstrap. Apply migrations first.',
          missingColumns: [...requiredColumns].sort(),
        },
        { status: 503 },
      )
    }
    steps.push('User schema: OK')

    const { rows: countRows } = await sql`SELECT COUNT(*) as count FROM users`
    if (Number(countRows[0].count) > 0) {
      return NextResponse.json(
        { ok: false, steps: [...steps, 'Refusing to run: users already exist. Manage accounts from the Users admin UI instead.'] },
        { status: 409 }
      )
    }

    const hash = await hashPassword(initialPassword)
    await createAuthUser({
      username: 'admin',
      name: 'Administrator',
      email: 'admin@deed.africa',
      role: 'director',
      modules: [...ROLE_DEFAULT_MODULES.director],
      active: true,
      mustChangePassword: true,
    }, hash)
    steps.push('Initial Director account "admin" created — password change required at first login')

    return NextResponse.json({ ok: true, steps })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, steps, error: msg }, { status: 500 })
  }
}
