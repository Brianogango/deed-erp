import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'

const connectionString =
  process.env.deed_erp_POSTGRES_URL
  || process.env.POSTGRES_URL
  || process.env.DATABASE_URL

if (!connectionString) {
  console.error('No database URL found. Set deed_erp_POSTGRES_URL, POSTGRES_URL, or DATABASE_URL.')
  process.exit(1)
}

const sqlPath = resolve(process.cwd(), 'database/migrations/20260920_erp_state_prisma_cutover.sql')
const sql = await readFile(sqlPath, 'utf8')
const pool = new Pool({ connectionString, ssl: false })

try {
  console.log(`Applying Prisma state cutover migration from ${sqlPath}`)
  console.log('NON-DESTRUCTIVE: creates row-based Prisma tables; legacy app_state is retained read-only.')
  await pool.query(sql)
  console.log('Prisma state cutover tables created successfully.')
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    console.error('Migration failed: database user lacks CREATE privileges.')
    console.error('On Contabo, apply as the postgres OS role instead:')
    console.error('  install -m 644 database/migrations/20260920_erp_state_prisma_cutover.sql /tmp/erp_state_cutover.sql')
    console.error('  sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/erp_state_cutover.sql')
  }
  console.error('Prisma state cutover migration failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
