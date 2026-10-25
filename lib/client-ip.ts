/**
 * The client address behind the reverse proxy. nginx appends the address it
 * saw to X-Forwarded-For ($proxy_add_x_forwarded_for), so the LAST hop is the
 * one it vouches for; the first hop is whatever the client sent and must not
 * key a rate limit. Works in the edge middleware and in Node routes.
 */
export function clientIpFromHeaders(headers: Pick<Headers, 'get'>): string {
  const hops = headers.get('x-forwarded-for')?.split(',').map(s => s.trim()).filter(Boolean)
  if (hops?.length) return hops[hops.length - 1]
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

/** clientIpFromHeaders, or null when no address is known (for stored columns). */
export function clientIpOrNull(headers: Pick<Headers, 'get'>): string | null {
  const ip = clientIpFromHeaders(headers)
  return ip === 'unknown' ? null : ip
}
