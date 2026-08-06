/** Same-origin relative path only — blocks open redirects (P0-DEED-001). */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('://')) return null
  if (decoded.startsWith('/login')) return null
  return decoded
}
