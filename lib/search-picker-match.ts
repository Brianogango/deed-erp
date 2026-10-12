/** Text fields SearchPicker uses to match a typed query. */
export function searchPickerItemText(item: unknown): string {
  if (!item || typeof item !== 'object') return String(item ?? '')
  const rec = item as Record<string, unknown>
  return [
    rec.name, rec.sku, rec.barcode, rec.label, rec.ref, rec.email, rec.phone, rec.companyName,
    // Jobs and documents: who it is for and which device (repairs, outsourcing, deliveries …).
    rec.customerName, rec.customerPhone, rec.productName, rec.serialNumber, rec.deviceDescription, rec.vendorName,
  ]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

export function searchPickerMatches(item: unknown, query: string, text?: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  // Every word somewhere in the item: "hp mike" finds Mike's HP.
  const haystack = (text ?? searchPickerItemText(item)).toLowerCase()
  return words.every(word => haystack.includes(word))
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
