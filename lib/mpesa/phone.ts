/** Normalize a Kenyan phone number to Daraja's 2547XXXXXXXX form. */
export function normalizeMpesaPhone(input: string | number | null | undefined): string | null {
  const digits = String(input ?? '').replace(/\D/g, '')
  if (!digits) return null
  let n = digits
  if (n.startsWith('254')) n = n.slice(3)
  else if (n.startsWith('0')) n = n.slice(1)
  if (n.length !== 9 || !n.startsWith('7')) return null
  return `254${n}`
}

export function isMpesaPhone(input: string | number | null | undefined): boolean {
  return Boolean(normalizeMpesaPhone(input))
}
