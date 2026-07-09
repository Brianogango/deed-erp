import 'server-only'
import { promises as fs } from 'fs'
import path from 'path'

// Filesystem storage for binary payloads (base64 expense receipts, repair
// photos, payment-proof screenshots). These used to live as multi-megabyte
// rows inside the app_state table, where every write inflated the sync path
// and change-feed. They are written/read here instead; app_state keeps only
// small collaborative JSON state. Reads fall back to app_state for rows that
// predate the migration (scripts/migrate-blobs-to-disk.mjs moves them over).

const BLOB_KEY_PATTERNS = [/^expense_receipt_/, /^repair_photos_/, /^repair_payment_proof_/]

export const isBlobKey = (key: string) => BLOB_KEY_PATTERNS.some(re => re.test(key))

const blobDir = () => process.env.BLOB_STORE_DIR || '/var/lib/deed-erp/blobs'

// Blob keys are app-generated (uuid / repair ref based), but sanitize anyway so
// a hostile key can never traverse out of the blob directory.
const fileFor = (key: string) => path.join(blobDir(), `${key.replace(/[^A-Za-z0-9_.-]/g, '_')}.blob`)

/** Read a blob. Returns null when no file exists (caller may fall back to app_state). */
export async function readBlob(key: string): Promise<string | null> {
  try {
    return await fs.readFile(fileFor(key), 'utf8')
  } catch {
    return null
  }
}

/** Write a blob (empty string is a valid "deleted" marker that shadows legacy rows). */
export async function writeBlob(key: string, value: string): Promise<void> {
  const file = fileFor(key)
  await fs.mkdir(path.dirname(file), { recursive: true })
  // Write-then-rename so a crash mid-write never leaves a truncated blob.
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, value, 'utf8')
  await fs.rename(tmp, file)
}
