// Move binary payloads (expense receipts, repair photos, payment proofs) out
// of the app_state table onto the filesystem blob store. Idempotent: rows are
// deleted only after the file is written and verified. Run AFTER deploying the
// blob-store code, with the DB backed up:
//
//   node scripts/migrate-blobs-to-disk.mjs            # apply
//   node scripts/migrate-blobs-to-disk.mjs --dry-run  # report only
import 'dotenv/config'
import { Pool } from 'pg'
import { promises as fs } from 'fs'
import path from 'path'

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No database URL found. Set DATABASE_URL.')
  process.exit(1)
}

const DRY = process.argv.includes('--dry-run')
const BLOB_DIR = process.env.BLOB_STORE_DIR || '/var/lib/deed-erp/blobs'
const fileFor = key => path.join(BLOB_DIR, `${key.replace(/[^A-Za-z0-9_.-]/g, '_')}.blob`)

const pool = new Pool({ connectionString, ssl: false })
const client = await pool.connect()
try {
  const { rows } = await client.query(
    `SELECT key, value FROM app_state
     WHERE key LIKE 'expense_receipt_%' OR key LIKE 'repair_photos_%' OR key LIKE 'repair_payment_proof_%'`,
  )
  console.log(`${DRY ? '[DRY RUN] ' : ''}Found ${rows.length} blob row(s) in app_state (dir: ${BLOB_DIR})`)

  let moved = 0
  let bytes = 0
  for (const row of rows) {
    bytes += row.value.length
    if (DRY) { moved++; continue }
    const file = fileFor(row.key)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, row.value, 'utf8')
    const written = await fs.readFile(file, 'utf8')
    if (written !== row.value) throw new Error(`Verification failed for ${row.key}`)
    await client.query('DELETE FROM app_state WHERE key = $1', [row.key])
    moved++
  }
  console.log(`${DRY ? '[DRY RUN] ' : ''}Moved ${moved} blob(s), ${(bytes / 1024 / 1024).toFixed(1)} MB total`)
} catch (error) {
  console.error('Blob migration failed:', error)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
