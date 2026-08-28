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

const sqlPath = resolve(process.cwd(), 'database/migrations/20260828_notification_platform_safe.sql')
const sql = await readFile(sqlPath, 'utf8')
const pool = new Pool({ connectionString, ssl: false })

try {
  console.log(`Applying safe notification platform foundation from ${sqlPath}`)
  console.log('NON-DESTRUCTIVE: legacy app_state notifications remain intact for backfill/rollback.')
  await pool.query(sql)
  console.log('Notification platform foundation applied successfully.')
} catch (error) {
  console.error('Notification platform migration failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
