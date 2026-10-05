/**
 * Two values hold the same data, whatever order their object keys are in.
 * JSON.stringify comparisons treat `{a,b}` and `{b,a}` as different, which
 * turned harmless re-merges into "edits" that were saved to the server.
 */
export function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return Number.isNaN(a) && Number.isNaN(b)
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((v, i) => sameContent(v, other[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  // undefined fields vanish in JSON; treat them as absent.
  const ak = Object.keys(ao).filter(k => ao[k] !== undefined)
  const bk = Object.keys(bo).filter(k => bo[k] !== undefined)
  return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(bo, k) && sameContent(ao[k], bo[k]))
}

/**
 * `next` with every element that holds the same data as the element at the
 * same id in `prev` replaced by that previous object — and `prev` itself when
 * nothing changed — so React and the save path see no change.
 */
export function keepUnchangedRows<T extends { id?: unknown }>(prev: T[], next: T[]): T[] {
  const byId = new Map(prev.map(row => [String(row?.id), row]))
  let changed = prev.length !== next.length
  const out = next.map((row, i) => {
    const old = byId.get(String(row?.id))
    if (old && sameContent(old, row)) {
      if (prev[i] !== old) changed = true
      return old
    }
    changed = true
    return row
  })
  return changed ? out : prev
}
