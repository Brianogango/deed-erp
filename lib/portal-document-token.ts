import * as crypto from 'crypto'
import { generateQuoteToken, verifyQuoteToken } from '@/lib/quote-token'

const secret = () => process.env.CUSTOMER_PORTAL_SECRET ?? process.env.AUTH_SECRET ?? ''

export type PortalDocKind = 'quote' | 'invoice' | 'order'

/**
 * Signed portal token for invoices / sale orders (quotes keep legacy helper).
 * Format: base64url(kind:id:ts:hmac)
 */
export function generatePortalDocToken(kind: Exclude<PortalDocKind, 'quote'>, id: string): string {
  const ts = Date.now()
  const hmac = crypto.createHmac('sha256', secret()).update(`${kind}:${id}:${ts}`).digest('hex')
  return Buffer.from(`${kind}:${id}:${ts}:${hmac}`).toString('base64url')
}

export function verifyPortalDocToken(
  kind: Exclude<PortalDocKind, 'quote'>,
  id: string,
  token: string,
): boolean {
  const s = secret()
  if (!s || !token) return false
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')
    if (parts.length !== 4) return false
    const [k, docId, tsStr, sig] = parts
    if (k !== kind || docId !== id) return false
    const ts = Number(tsStr)
    if (Number.isNaN(ts) || Date.now() - ts > 30 * 24 * 60 * 60 * 1000) return false
    const expected = crypto.createHmac('sha256', s).update(`${kind}:${id}:${tsStr}`).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/** Back-compat wrappers for quote portal. */
export { generateQuoteToken, verifyQuoteToken }

export function portalDocUrl(kind: PortalDocKind, id: string, token: string, baseUrl?: string): string {
  const base = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  const path =
    kind === 'quote' ? `/portal/quotes/${id}`
    : kind === 'invoice' ? `/portal/invoices/${id}`
    : `/portal/orders/${id}`
  const q = `?token=${encodeURIComponent(token)}`
  return base ? `${base}${path}${q}` : `${path}${q}`
}
