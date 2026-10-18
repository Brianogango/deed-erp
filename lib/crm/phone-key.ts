const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** Last nine digits: 0712 345 678, +254712345678 and 712345678 are one number. */
export function phoneKey(v: unknown): string | null {
  const d = digits(v)
  return d.length >= 9 ? d.slice(-9) : null
}
