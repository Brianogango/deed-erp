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
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1`,
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

    // Accounting routes deliberately reject unknown journals/accounts. Seed the
    // same minimum approved ledger used by these business workflows so E2E
    // exercises real posting instead of bypassing financial validation.
    // prisma db push does not install DB defaults for @default(uuid()) / @updatedAt,
    // so E2E inserts must supply ids and timestamps.
    await pool.query(`
      INSERT INTO journals (id, code, name, journal_type, is_active, created_at)
      VALUES
        (gen_random_uuid(), 'SAL', 'Sales Journal', 'sale', TRUE, NOW()),
        (gen_random_uuid(), 'PUR', 'Purchase Journal', 'purchase', TRUE, NOW()),
        (gen_random_uuid(), 'BNK', 'Bank Journal', 'bank', TRUE, NOW()),
        (gen_random_uuid(), 'CSH', 'Cash Journal', 'cash', TRUE, NOW()),
        (gen_random_uuid(), 'STK', 'Stock Journal', 'stock', TRUE, NOW()),
        (gen_random_uuid(), 'GEN', 'Miscellaneous', 'general', TRUE, NOW())
      ON CONFLICT (code) DO UPDATE SET is_active = TRUE
    `)
    await pool.query(`
      INSERT INTO account_codes (id, code, name, account_type, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), '1150', 'VAT Input', 'asset', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '1200', 'Inventory', 'asset', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '1800', 'Accounts Receivable', 'asset', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '2201', 'ABSA Bank', 'asset', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '2211', 'Petty Cash / Mobile Money', 'asset', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '3000', 'Accounts Payable', 'liability', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '3201', 'Accruals', 'liability', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '3301', 'Output VAT Payable', 'liability', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '5000', 'Sales Revenue', 'income', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '5121', 'Hardware Support', 'income', TRUE, NOW(), NOW()),
        (gen_random_uuid(), '6001', 'Cost of Goods Sold', 'expense', TRUE, NOW(), NOW())
      ON CONFLICT (code) DO UPDATE SET is_active = TRUE
    `)
  } finally {
    await pool.end()
  }
}
