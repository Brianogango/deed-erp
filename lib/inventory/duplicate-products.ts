/**
 * Detect product-master duplicates by normalized name, SKU, or barcode.
 * Variant rows that share a parent may keep the same display name.
 */

export type DuplicateProductMember = {
  id: string
  name: string
  sku: string
  barcode: string
  parentId?: string | null
  isActive: boolean
  createdAt?: string | null
  refCount: number
}

export type DuplicateProductGroup = {
  key: string
  kind: 'name' | 'sku' | 'barcode'
  members: DuplicateProductMember[]
}

export function normalizeProductIdentity(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function productIdentityKeys(row: {
  name?: unknown
  sku?: unknown
  barcode?: unknown
  parentId?: unknown
}): { kind: DuplicateProductGroup['kind']; key: string }[] {
  const name = normalizeProductIdentity(row.name)
  const sku = normalizeProductIdentity(row.sku)
  const barcode = normalizeProductIdentity(row.barcode)
  const parent = String(row.parentId ?? '').trim()
  const keys: { kind: DuplicateProductGroup['kind']; key: string }[] = []
  if (sku) keys.push({ kind: 'sku', key: `sku:${sku}` })
  if (barcode) keys.push({ kind: 'barcode', key: `bc:${barcode}` })
  if (name && !parent) keys.push({ kind: 'name', key: `name:${name}` })
  return keys
}

export function findDuplicateProductGroups(
  products: DuplicateProductMember[],
): DuplicateProductGroup[] {
  const buckets = new Map<string, { kind: DuplicateProductGroup['kind']; members: DuplicateProductMember[] }>()
  for (const product of products) {
    for (const { kind, key } of productIdentityKeys(product)) {
      const bucket = buckets.get(key) ?? { kind, members: [] }
      if (!bucket.members.some(m => m.id === product.id)) bucket.members.push(product)
      buckets.set(key, bucket)
    }
  }
  const groups: DuplicateProductGroup[] = []
  const seen = new Set<string>()
  for (const [key, bucket] of buckets) {
    if (bucket.members.length < 2) continue
    const memberIds = bucket.members.map(m => m.id).sort().join('|')
    const dedupe = `${bucket.kind}:${memberIds}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    groups.push({
      key,
      kind: bucket.kind,
      members: [...bucket.members].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        return (b.refCount - a.refCount) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
      }),
    })
  }
  return groups.sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key))
}

const BLOB_ID_FIELDS = ['productId', 'parentId'] as const

export function rewriteProductIdsInRecords(
  records: unknown,
  fromId: string,
  toId: string,
): unknown {
  if (!Array.isArray(records)) return records
  return records.flatMap(item => {
    if (!item || typeof item !== 'object') return [item]
    const row = { ...(item as Record<string, unknown>) }
    if (row.id === fromId && typeof row.name === 'string') return []
    for (const field of BLOB_ID_FIELDS) {
      if (row[field] === fromId) row[field] = toId
    }
    return [row]
  })
}

export function pickKeepProduct(members: DuplicateProductMember[]): DuplicateProductMember {
  return [...members].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    if (a.refCount !== b.refCount) return b.refCount - a.refCount
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  })[0]
}
