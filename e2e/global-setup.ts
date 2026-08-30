import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const TEST_PASSWORD = process.env.E2E_PASSWORD || 'E2e-Test-2026!'

export const E2E_USERS = {
  director: {
    id: '9e2e0000-0000-4000-8000-000000000001',
    username: process.env.E2E_USERNAME || 'e2edirector',
    password: TEST_PASSWORD,
    name: 'E2E Director',
    role: 'director',
    modules: ['dashboard','sales','crm','inventory','contacts','purchase','pos','repair','refurbishment','delivery','ecommerce','kilimall','accounting','hr','outsource','sops','after_sales','expenses','leave','my_documents'],
  },
  salesA: {
    id: '9e2e0000-0000-4000-8000-000000000002',
    username: 'e2esalesa',
    password: TEST_PASSWORD,
    name: 'E2E Sales A',
    role: 'sales_rep',
    modules: ['dashboard','sales','crm','contacts','delivery','after_sales','expenses','leave','my_documents'],
  },
  salesB: {
    id: '9e2e0000-0000-4000-8000-000000000003',
    username: 'e2esalesb',
    password: TEST_PASSWORD,
    name: 'E2E Sales B',
    role: 'sales_rep',
    modules: ['dashboard','sales','crm','contacts','delivery','after_sales','expenses','leave','my_documents'],
  },
  technician: {
    id: '9e2e0000-0000-4000-8000-000000000004',
    username: 'e2etechnician',
    password: TEST_PASSWORD,
    name: 'E2E Technician',
    role: 'technician',
    modules: ['dashboard','repair','reconfiguration','expenses','leave','my_documents'],
  },
  inventory: {
    id: '9e2e0000-0000-4000-8000-000000000005',
    username: 'e2einventory',
    password: TEST_PASSWORD,
    name: 'E2E Inventory',
    role: 'inventory_officer',
    modules: ['dashboard','inventory','delivery','purchase','holdovers','reconfiguration','expenses','leave','my_documents'],
  },
  finance: {
    id: '9e2e0000-0000-4000-8000-000000000006',
    username: 'e2efinance',
    password: TEST_PASSWORD,
    name: 'E2E Finance',
    role: 'finance_officer',
    modules: ['dashboard','accounting','sales','crm','contacts','purchase','inventory','deposits','expenses','leave','my_documents'],
  },
  sessionProbe: {
    id: '9e2e0000-0000-4000-8000-000000000007',
    username: 'e2esessionprobe',
    password: TEST_PASSWORD,
    name: 'E2E Session Probe',
    role: 'technician',
    modules: ['dashboard','repair','reconfiguration','expenses','leave','my_documents'],
  },
} as const

export const E2E_USER = E2E_USERS.director

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

    const hash = await bcrypt.hash(TEST_PASSWORD, 10)
    for (const user of Object.values(E2E_USERS)) {
      const modulesJson = user.role === 'director' ? ALL_MODULES : JSON.stringify(user.modules)
      await pool.query(
        `INSERT INTO users (id, username, email, name, role, modules_json, active, created_at, updated_at, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW(), $7, 0)
         ON CONFLICT (username) DO UPDATE SET
           role = EXCLUDED.role,
           modules_json = EXCLUDED.modules_json,
           password_hash = EXCLUDED.password_hash,
           must_change_password = 0,
           active = 1,
           locked_until = NULL,
           failed_login_attempts = 0`,
        [user.id, user.username, `${user.username}@deed.test`, user.name, user.role, modulesJson, hash],
      )
    }
  } finally {
    await pool.end()
  }
}
