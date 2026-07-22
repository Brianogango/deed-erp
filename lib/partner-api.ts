import 'server-only'
import { createHash, randomBytes } from 'crypto'
import prisma from '@/lib/prisma'

// ── Partner (reseller) API keys ───────────────────────────────────────────────
// Keys look like `deed_pk_<32 url-safe chars>`. Only the SHA-256 hash is stored;
// the plaintext is returned exactly once, at creation time. The `prefix`
// (first 12 characters) is kept so keys can be identified in the admin UI.

export const PARTNER_KEY_PREFIX = 'deed_pk_'

export function hashPartnerApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generatePartnerApiKey(): { key: string; prefix: string; keyHash: string } {
  const key = `${PARTNER_KEY_PREFIX}${randomBytes(24).toString('base64url')}`
  return { key, prefix: key.slice(0, 12), keyHash: hashPartnerApiKey(key) }
}

export function extractPartnerApiKey(request: Request): string | null {
  const auth = request.headers.get('authorization')
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null
  const headerKey = request.headers.get('x-api-key')
  return headerKey?.trim() || null
}

export type PartnerAuthResult =
  | { ok: true; keyId: string; keyName: string }
  | { ok: false; status: number; error: string }

/**
 * Authenticate a public API request via its partner key. Invalid, missing,
 * and revoked keys all fail with 401 (no distinction is leaked to callers).
 */
export async function authenticatePartnerRequest(request: Request): Promise<PartnerAuthResult> {
  const key = extractPartnerApiKey(request)
  if (!key || !key.startsWith(PARTNER_KEY_PREFIX)) {
    return { ok: false, status: 401, error: 'A valid API key is required. Send it as "Authorization: Bearer <key>" or "X-API-Key: <key>".' }
  }
  const record = await prisma.partnerApiKey.findUnique({ where: { keyHash: hashPartnerApiKey(key) } }).catch(() => null)
  if (!record || !record.isActive) {
    return { ok: false, status: 401, error: 'Invalid or revoked API key.' }
  }
  // Touch last_used_at at most once a minute — fire and forget.
  const now = Date.now()
  if (!record.lastUsedAt || now - new Date(record.lastUsedAt).getTime() > 60_000) {
    prisma.partnerApiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date(now) } }).catch(() => {})
  }
  return { ok: true, keyId: record.id, keyName: record.name }
}

// ── CORS for the public endpoints ────────────────────────────────────────────
// Partner sites may call from the browser during development; production
// integrations should proxy through their own backend so the key stays secret.
export const PUBLIC_API_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-API-Key, Content-Type',
  'Access-Control-Max-Age': '86400',
}
