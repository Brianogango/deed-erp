/**
 * KRA PINs are a letter, nine digits and a letter: A… for individuals,
 * P… for companies and other non-individuals. A soft check only — it warns
 * on a likely typo and never blocks saving.
 */
export function kraPinWarning(pin: string | undefined, type: 'company' | 'individual'): string | null {
  const v = String(pin ?? '').trim().toUpperCase()
  if (!v) return null
  if (!/^[AP]\d{9}[A-Z]$/.test(v)) return 'Usually a letter, 9 digits and a letter (e.g. A012345678B) — check for a typo'
  if (type === 'individual' && v[0] === 'P') return 'P… PINs belong to companies; individual PINs start with A'
  if (type === 'company' && v[0] === 'A') return 'A… PINs belong to individuals; company PINs start with P'
  return null
}
