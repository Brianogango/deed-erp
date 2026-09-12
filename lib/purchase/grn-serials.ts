import { parseScanPayload } from '@/lib/barcode-scan'
import { parseSerialList } from '@/lib/inventory/serial-intake'

/** Manufacturer serial from a typed/pasted/scanned GRN token (plain or QR). */
export function normalizeGrnSerialToken(raw: string): string {
  const parsed = parseScanPayload(raw)
  return (parsed.serial || parsed.normalized).toUpperCase()
}

/** Split a pasted block and normalize each token the same way a single scan is stored. */
export function parseGrnSerialList(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of parseSerialList(raw)) {
    const val = normalizeGrnSerialToken(token)
    if (!val || seen.has(val)) continue
    seen.add(val)
    out.push(val)
  }
  return out
}

export function mergeGrnSerials(opts: {
  existing: string[]
  incoming: string[]
  qtyReceived: number
}): {
  next: string[]
  added: string[]
  duplicates: string[]
  overflow: string[]
} {
  const have = new Set(opts.existing.map(s => s.toUpperCase()))
  const added: string[] = []
  const duplicates: string[] = []
  const overflow: string[] = []
  const next = [...opts.existing]
  const cap = Math.max(0, Number(opts.qtyReceived) || 0)

  for (const raw of opts.incoming) {
    const val = normalizeGrnSerialToken(raw)
    if (!val) continue
    if (have.has(val)) {
      duplicates.push(val)
      continue
    }
    if (next.length >= cap) {
      overflow.push(val)
      continue
    }
    have.add(val)
    next.push(val)
    added.push(val)
  }
  return { next, added, duplicates, overflow }
}

export function describeGrnSerialMerge(result: {
  added: string[]
  duplicates: string[]
  overflow: string[]
}): { kind: 'error' | 'success' | 'info'; message: string } | null {
  const added = result.added.length
  const duplicates = result.duplicates.length
  const overflow = result.overflow.length

  if (added === 0 && duplicates === 0 && overflow === 0) return null
  if (added === 0 && overflow > 0 && duplicates === 0) {
    return { kind: 'error', message: 'All serials entered for this line' }
  }
  if (added === 0 && duplicates > 0 && overflow === 0) {
    return {
      kind: 'error',
      message: duplicates === 1
        ? `${result.duplicates[0]} already added`
        : `${duplicates} serials already added`,
    }
  }
  if (added === 1 && duplicates === 0 && overflow === 0) return null

  const parts = [`Added ${added} serial${added === 1 ? '' : 's'}`]
  if (duplicates) parts.push(`${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped`)
  if (overflow) parts.push(`${overflow} over the received qty ignored`)
  return {
    kind: duplicates || overflow ? 'info' : 'success',
    message: parts.join(' · '),
  }
}
