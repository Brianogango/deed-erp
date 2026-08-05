import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

export const E2E_USER = {
  username: process.env.E2E_USERNAME || 'e2edirector',
  // Override in CI / local .env — do not reuse this default outside test DBs.
  password: process.env.E2E_PASSWORD || 'E2e-Test-2026!',
  name: 'E2E Director',
  role: 'director',
}
const E2E_USER_ID = '9e2e0000-0000-4000-8000-000000000001'

const ALL_MODULES = JSON.stringify([
  'dashboard', 'sales', 'crm', 'inventory', 'contacts', 'purchase', 'pos', 'repair',
  'refurbishment', 'delivery', 'ecommerce', 'kilimall', 'accounting', 'hr', 'outsource',
  'sops', 'after_sales', 'expenses', 'leave', 'my_documents',
])

/**
 * Seeds the e2e database with a director account.
 *
 * The app's session layer reads a legacy-shaped `users` table (name,
 * modules_json, active, ...) while `prisma db push` creates the relational
 * shape — production has both sets of columns through additive migrations.
 * Mirror that here by adding the legacy columns before seeding.
 */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) throw new Error('E2E setup requires DATABASE_URL')

  const pool = new Pool({ connectionString: url, ssl: false })
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      )
    `)
    for (const ddl of [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS modules_json TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TEXT`,
    ]) {
      await pool.query(ddl)
    }

    const hash = await bcrypt.hash(E2E_USER.password, 10)
    await pool.query(
      `INSERT INTO users (id, username, email, name, role, modules_json, active, created_at, updated_at, password_hash, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW(), $7, 0)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = 0, active = 1, locked_until = NULL, failed_login_attempts = 0`,
      [E2E_USER_ID, E2E_USER.username, 'e2e@deed.test', E2E_USER.name, E2E_USER.role, ALL_MODULES, hash],
    )
  } finally {
    await pool.end()
  }
}
