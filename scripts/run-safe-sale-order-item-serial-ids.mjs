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

const file = 'database/migrations/20261022_sale_order_item_serial_ids_safe.sql'
const sql = await readFile(resolve(process.cwd(), file), 'utf8')
const pool = new Pool({ connectionString, ssl: false })

try {
  console.log(`Applying sale_order_items.serial_ids from ${file}`)
  console.log('NON-DESTRUCTIVE: adds one column and fills it from existing serial links.')
  const results = await pool.query(sql)
  const last = Array.isArray(results) ? results[results.length - 1] : results
  console.log('Done.', last?.rows?.[0] ?? '')
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    console.error('The database user cannot ALTER this table. Apply it as the postgres OS role:')
    console.error(`  install -m 644 ${file} /tmp/so_serial_ids.sql`)
    console.error('  sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/so_serial_ids.sql')
  }
  console.error('Migration failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
