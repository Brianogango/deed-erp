import 'server-only'
import * as crypto from 'crypto'
import { NextRequest } from 'next/server'
import { getServerSession } from '@/lib/auth/server'

const secret = () => process.env.CUSTOMER_PORTAL_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ''
const TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

export function generateRepairToken(ref: string): string {
  const normalizedRef = decodeURIComponent(ref).toUpperCase()
  const ts = Date.now()
  const key = secret()
  if (!key) throw new Error('CUSTOMER_PORTAL_SECRET or AUTH_SECRET is required to generate repair links')
  const hmac = crypto.createHmac('sha256', key).update(`${normalizedRef}:${ts}`).digest('hex')
  return Buffer.from(`${normalizedRef}:${ts}:${hmac}`).toString('base64url')
}

export function verifyRepairToken(ref: string, token: string): boolean {
  const key = secret()
  if (!key || !token) return false
  try {
    const normalizedRef = decodeURIComponent(ref).toUpperCase()
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const [tokenRef, tsStr, sig] = decoded.split(':')
    if (!tokenRef || !tsStr || !sig || tokenRef !== normalizedRef) return false
    const ts = Number(tsStr)
    if (!Number.isFinite(ts) || Date.now() - ts > TOKEN_MAX_AGE_MS) return false
    const expected = crypto.createHmac('sha256', key).update(`${tokenRef}:${tsStr}`).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export function repairPortalTokenRequired() {
  return process.env.REQUIRE_REPAIR_PORTAL_TOKEN === 'true'
}

export async function authorizeRepairPortalRequest(req: NextRequest, ref: string) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (verifyRepairToken(ref, token)) return true

  // Staff sessions may still inspect portal artifacts during support.
  const session = await getServerSession().catch(() => null)
  if (session?.user) return true

  // Compatibility mode lets old customer links keep working until token links are fully rolled out.
  return !repairPortalTokenRequired()
}

export function buildRepairPortalUrl(ref: string, baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke') {
  const token = generateRepairToken(ref)
  return `${baseUrl.replace(/\/$/, '')}/portal/repair/${encodeURIComponent(ref)}?token=${encodeURIComponent(token)}`
}
