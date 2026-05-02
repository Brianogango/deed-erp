import * as crypto from 'crypto'

const secret = () => process.env.CUSTOMER_PORTAL_SECRET ?? process.env.AUTH_SECRET ?? ''

export function generateQuoteToken(quoteId: string): string {
  const ts   = Date.now()
  const hmac = crypto.createHmac('sha256', secret()).update(`${quoteId}:${ts}`).digest('hex')
  return Buffer.from(`${quoteId}:${ts}:${hmac}`).toString('base64url')
}

export function verifyQuoteToken(quoteId: string, token: string): boolean {
  const s = secret()
  if (!s || !token) return false
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts   = decoded.split(':')
    if (parts.length !== 3) return false
    const [id, tsStr, sig] = parts
    if (id !== quoteId) return false
    const ts = Number(tsStr)
    if (isNaN(ts) || Date.now() - ts > 30 * 24 * 60 * 60 * 1000) return false
    const expected = crypto.createHmac('sha256', s).update(`${id}:${tsStr}`).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
