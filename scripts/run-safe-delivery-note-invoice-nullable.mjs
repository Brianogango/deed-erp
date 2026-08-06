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

const sqlPath = resolve(process.cwd(), 'database/migrations/20260806_delivery_note_invoice_nullable_safe.sql')
const sql = await readFile(sqlPath, 'utf8')
const pool = new Pool({ connectionString, ssl: false })

try {
  console.log(`Applying DeliveryNote.invoiceId nullable migration from ${sqlPath}`)
  await pool.query(sql)
  console.log('DeliveryNote.invoiceId nullable migration applied successfully.')
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    console.error('Migration failed: database user lacks ownership/ALTER privileges.')
    console.error('Re-run using the Postgres role that owns the ERP tables.')
  }
  console.error('DeliveryNote.invoiceId nullable migration failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
