// Product-level on-hand serial intake (opening balance / stock count).
// Pure helpers — safe for client validation and server enforcement.

export type OnHandLocation = 'warehouse' | 'shop' | 'repair_unit'

export const ON_HAND_LOCATIONS: OnHandLocation[] = ['warehouse', 'shop', 'repair_unit']

export type SerialIntakeKind = 'opening_balance' | 'stock_intake'

const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase()

/** Split a pasted block into unique-order-preserving serial tokens. */
export function parseSerialList(raw: string): string[] {
  const parts = String(raw ?? '')
    .split(/[\n,;\t]+/)
    .map(s => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const key = normalize(part)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(part.trim())
  }
  return out
}

export function validateSerialIntakeInput(opts: {
  productId?: string
  serials: string[]
  location?: string
  reason?: string
  existingSerials: Array<{ serial?: string | null }>
}): { ok: true; serials: string[]; location: OnHandLocation; reason: string } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!opts.productId) errors.push('productId is required')

  const location = String(opts.location ?? 'warehouse').trim() as OnHandLocation
  if (!ON_HAND_LOCATIONS.includes(location)) {
    errors.push('location must be warehouse, shop, or repair_unit')
  }

  const reason = String(opts.reason ?? '').trim()
  if (!reason) errors.push('reason is required (e.g. Opening balance / physical count)')

  const serials = opts.serials.map(s => String(s).trim()).filter(Boolean)
  if (serials.length === 0) errors.push('Enter at least one serial number')

  const existing = new Set(
    opts.existingSerials.map(s => normalize(s.serial)).filter(Boolean),
  )
  const seen = new Set<string>()
  for (const serial of serials) {
    const key = normalize(serial)
    if (seen.has(key)) {
      errors.push(`Duplicate serial in list: ${serial}`)
      continue
    }
    seen.add(key)
    if (existing.has(key)) {
      errors.push(`Serial already exists: ${serial}`)
    }
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, serials, location, reason }
}

export function resolveIntakeKind(openingStockPosted: boolean, requested?: string | null): SerialIntakeKind {
  if (requested === 'opening_balance' || requested === 'stock_intake') return requested
  return openingStockPosted ? 'stock_intake' : 'opening_balance'
}

export function nextIntakeDocumentRef(existingRefs: string[]): string {
  let max = 0
  for (const ref of existingRefs) {
    const m = String(ref).match(/^INTK\/(\d+)$/i)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `INTK/${String(max + 1).padStart(4, '0')}`
}
