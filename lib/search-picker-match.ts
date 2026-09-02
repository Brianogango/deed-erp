/** Text fields SearchPicker uses to match a typed query. */
export function searchPickerItemText(item: unknown): string {
  if (!item || typeof item !== 'object') return String(item ?? '')
  const rec = item as Record<string, unknown>
  return [rec.name, rec.sku, rec.barcode, rec.label, rec.ref, rec.email, rec.phone, rec.companyName]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

export function searchPickerMatches(item: unknown, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return searchPickerItemText(item).toLowerCase().includes(q)
}

/** Unique exact name or SKU match so typing a full label can select without a click. */
export function searchPickerExactMatch<T>(items: T[], query: string): T | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const exact = items.filter(item => {
    if (!item || typeof item !== 'object') return false
    const rec = item as Record<string, unknown>
    const name = String(rec.name ?? rec.label ?? rec.ref ?? '').trim().toLowerCase()
    const sku = String(rec.sku ?? '').trim().toLowerCase()
    return name === q || (sku.length > 0 && sku === q)
  })
  return exact.length === 1 ? exact[0] : null
}
