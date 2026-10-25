/**
 * Same-origin relative path only — blocks open redirects (P0-DEED-001).
 * Browsers read '/\host' and '/<TAB>/host' as '//host' (another site), so
 * the path is resolved the way the browser would and must stay on this
 * origin; backslashes and control characters are refused outright.
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001F\u007F]/.test(decoded)) return null
  const base = 'https://return-to.invalid'
  let url: URL
  try { url = new URL(decoded, base) } catch { return null }
  if (url.origin !== base) return null
  const path = `${url.pathname}${url.search}${url.hash}`
  if (path.startsWith('/login') || path.startsWith('//')) return null
  return path
}
