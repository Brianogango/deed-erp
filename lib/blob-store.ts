import 'server-only'

import { getObjectStore } from '@/lib/infra/object-store'

const BLOB_KEY_PATTERNS = [/^expense_receipt_/, /^repair_photos_/, /^repair_payment_proof_/, /^product_photos_/]

export const isBlobKey = (key: string) => BLOB_KEY_PATTERNS.some(re => re.test(key))

function blobObjectKey(key: string) {
  return key.replace(/[^A-Za-z0-9_.-]/g, '_')
}

/** Read a blob. Returns null when no object exists (caller may fall back to app_state). */
export async function readBlob(key: string): Promise<string | null> {
  const body = await getObjectStore().get('blobs', blobObjectKey(key))
  return body ? body.toString('utf8') : null
}

/** Write a blob (empty string is a valid "deleted" marker that shadows legacy rows). */
export async function writeBlob(key: string, value: string): Promise<void> {
  await getObjectStore().put({
    bucket: 'blobs',
    key: blobObjectKey(key),
    body: value,
    contentType: 'application/octet-stream',
  })
}
