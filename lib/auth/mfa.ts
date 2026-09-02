import 'server-only'

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { shouldUseSecureCookie } from '@/lib/auth/session-issuer'
import { requiresPrivilegedMfa } from '@/lib/auth/mfa-policy'
import { revokeAllTrustedBrowsers } from '@/lib/auth/trusted-browser'

export type MfaChallengeMode = 'enroll' | 'verify'

type ChallengePayload = {
  uid: string
  mode: MfaChallengeMode
  exp: number
  nonce: string
}

const CHALLENGE_COOKIE = 'deed-mfa-challenge'
const CHALLENGE_TTL_SECONDS = 5 * 60
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6
function secretForChallenges(): string {
  const dedicated = process.env.MFA_CHALLENGE_SECRET || ''
  if (dedicated) return dedicated
  if (process.env.MFA_ENFORCE_PRIVILEGED === 'true') {
    throw new Error('MFA_CHALLENGE_SECRET is required when privileged MFA is enforced')
  }
  const fallback = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || ''
  if (!fallback) throw new Error('MFA challenge secret is not configured')
  return fallback
}

function encryptionKey(): Buffer {
  const source = process.env.MFA_ENCRYPTION_KEY || ''
  if (!source || source.length < 32) throw new Error('MFA_ENCRYPTION_KEY must contain at least 32 characters of high-entropy secret material')
  return crypto.createHash('sha256').update(source, 'utf8').digest()
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

function signPayload(payload: ChallengePayload): string {
  const encoded = base64url(JSON.stringify(payload))
  const signature = crypto.createHmac('sha256', secretForChallenges()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

function safeEqualString(a: string, b: string): boolean {
  const aa = Buffer.from(a)
  const bb = Buffer.from(b)
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb)
}

export function parseMfaChallenge(token: string | undefined | null): ChallengePayload | null {
  if (!token) return null
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return null
  const expected = crypto.createHmac('sha256', secretForChallenges()).update(encoded).digest('base64url')
  if (!safeEqualString(signature, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ChallengePayload
    if (!parsed.uid || !['enroll', 'verify'].includes(parsed.mode)) return null
    if (!Number.isFinite(parsed.exp) || parsed.exp < Math.floor(Date.now() / 1000)) return null
    return parsed
  } catch {
    return null
  }
}

export const mfaRequiredForRole = requiresPrivilegedMfa

export function setMfaChallengeCookie(
  response: NextResponse,
  request: NextRequest,
  userId: string,
  mode: MfaChallengeMode,
) {
  const token = signPayload({
    uid: userId,
    mode,
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString('hex'),
  })
  response.cookies.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureCookie(request),
    path: '/api/auth/mfa',
    maxAge: CHALLENGE_TTL_SECONDS,
  })
}

export function challengeFromRequest(request: NextRequest): ChallengePayload | null {
  return parseMfaChallenge(request.cookies.get(CHALLENGE_COOKIE)?.value)
}

function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map(v => v.toString('base64url')).join('.')
}

function decryptSecret(value: string): string {
  const [ivRaw, tagRaw, ciphertextRaw] = value.split('.')
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new Error('Invalid encrypted MFA secret')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function toBase32(buffer: Buffer): string {
  let bits = ''
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0')
    out += BASE32_ALPHABET[parseInt(chunk, 2)]
  }
  return out
}

function fromBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) throw new Error('Invalid base32 secret')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function totpForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = crypto.createHmac('sha1', fromBase32(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const value = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) % (10 ** TOTP_DIGITS)
  return String(value).padStart(TOTP_DIGITS, '0')
}

export async function getMfaState(userId: string): Promise<{ configured: boolean; enabled: boolean }> {
  const { rows } = await sql`SELECT enabled FROM user_mfa WHERE user_id = ${userId}`
  if (!rows.length) return { configured: false, enabled: false }
  return { configured: true, enabled: Boolean(rows[0].enabled) }
}

export async function prepareMfaEnrollment(userId: string, username: string) {
  const secret = toBase32(crypto.randomBytes(20))
  const encrypted = encryptSecret(secret)
  const now = new Date().toISOString()
  await sql`
    INSERT INTO user_mfa (user_id, secret_enc, enabled, enrolled_at, last_used_step, updated_at)
    VALUES (${userId}, ${encrypted}, false, NULL, NULL, ${now})
    ON CONFLICT (user_id) DO UPDATE
    SET secret_enc = EXCLUDED.secret_enc,
        enabled = false,
        enrolled_at = NULL,
        last_used_step = NULL,
        updated_at = EXCLUDED.updated_at
  `
  const issuer = encodeURIComponent(process.env.NEXT_PUBLIC_COMPANY_NAME || 'Deed Technologies')
  const account = encodeURIComponent(username)
  const uri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`
  return { secret, uri }
}

export async function verifyMfaCode(userId: string, code: string, enableOnSuccess = false): Promise<boolean> {
  const normalized = String(code || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  const { rows } = await sql`SELECT secret_enc, enabled, last_used_step FROM user_mfa WHERE user_id = ${userId}`
  if (!rows.length) return false
  const secret = decryptSecret(String(rows[0].secret_enc))
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS)
  const lastUsedStep = rows[0].last_used_step == null ? null : Number(rows[0].last_used_step)

  let matchedStep: number | null = null
  for (const delta of [-1, 0, 1]) {
    const step = currentStep + delta
    const expected = totpForStep(secret, step)
    if (safeEqualString(normalized, expected)) {
      matchedStep = step
      break
    }
  }
  if (matchedStep == null) return false
  if (lastUsedStep != null && matchedStep <= lastUsedStep) return false

  const now = new Date().toISOString()
  const updated = await sql`
    UPDATE user_mfa
    SET enabled = ${enableOnSuccess ? true : Boolean(rows[0].enabled)},
        enrolled_at = CASE WHEN ${enableOnSuccess} THEN COALESCE(enrolled_at, ${now}) ELSE enrolled_at END,
        last_used_step = ${matchedStep},
        updated_at = ${now}
    WHERE user_id = ${userId}
      AND (last_used_step IS NULL OR last_used_step < ${matchedStep})
    RETURNING user_id
  `
  return updated.rows.length === 1
}

export async function resetUserMfa(userId: string) {
  await revokeAllTrustedBrowsers(userId)
  await sql`DELETE FROM user_mfa WHERE user_id = ${userId}`
}
