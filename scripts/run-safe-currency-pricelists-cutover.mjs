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

const sqlPath = resolve(process.cwd(), 'database/migrations/20260731_currency_pricelists_cutover_safe.sql')
const sql = await readFile(sqlPath, 'utf8')
const pool = new Pool({ connectionString, ssl: false })

const GRANT_TABLES = [
  'exchange_rates',
  'price_lists',
  'price_list_items',
  'blob_cutover_certificates',
]

try {
  console.log(`Applying currency/pricelists/cutover foundation from ${sqlPath}`)
  console.log('NON-DESTRUCTIVE: creates tables/columns/indexes only; never deletes app_state.')
  await pool.query(sql)
  console.log('Currency/pricelists/cutover foundation applied successfully.')
  console.log('If Contabo deed_user needs privileges, run as postgres:')
  console.log(
    `  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${GRANT_TABLES.join(', ')} TO deed_user;`,
  )
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    console.error('Migration failed: database user lacks ownership/ALTER privileges.')
    console.error('On Contabo, apply as the postgres OS role:')
    console.error('  install -m 644 database/migrations/20260731_currency_pricelists_cutover_safe.sql /tmp/currency_pricelists_cutover_safe.sql')
    console.error('  sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/currency_pricelists_cutover_safe.sql')
    console.error(
      `  sudo -u postgres psql -d deed_erp -c "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${GRANT_TABLES.join(', ')} TO deed_user;"`,
    )
  }
  console.error('Currency/pricelists/cutover foundation failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
