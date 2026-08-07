import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'

const connectionString =
  process.env.deed_erp_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL

if (!connectionString) {
  console.error('No database URL found. Set deed_erp_POSTGRES_URL, POSTGRES_URL, or DATABASE_URL.')
  process.exit(1)
}

const sqlPath = resolve(process.cwd(), 'database/migrations/20260807_sales_integrity_safe.sql')
const sql = await readFile(sqlPath, 'utf8')
const pool = new Pool({ connectionString, ssl: false })

try {
  console.log(`Applying sales integrity hardening from ${sqlPath}`)
  console.log('NON-DESTRUCTIVE: adds a column + indexes only; never deletes app_state.')
  await pool.query(sql)
  console.log('Sales integrity hardening applied successfully.')
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    console.error('Migration failed: database user lacks ownership/ALTER privileges.')
    console.error('On Contabo, apply as the postgres OS role instead:')
    console.error('  install -m 644 database/migrations/20260807_sales_integrity_safe.sql /tmp/sales_integrity_safe.sql')
    console.error('  sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/sales_integrity_safe.sql')
  }
  console.error('Sales integrity hardening failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
