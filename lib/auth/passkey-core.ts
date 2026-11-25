/**
 * Passkeys (Face ID, Touch ID, fingerprint, Windows Hello): the parts that do
 * not touch the database, so they can be tested on their own.
 *
 * The relying party is this site: a passkey made on erp.deed.co.ke only ever
 * signs in to erp.deed.co.ke, so a look-alike page cannot use it.
 */
import crypto from 'crypto'

/** 'clock': a Face ID / fingerprint check when clocking in or out (attendance). */
export type PasskeyChallengeMode = 'register' | 'login' | 'clock'
export type PasskeyChallenge = { c: string; m: PasskeyChallengeMode; u?: string; exp: number }

export const PASSKEY_CHALLENGE_COOKIE = 'deed-passkey-challenge'
export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60

type HeaderSource = { get(name: string): string | null }

const hostOf = (value: string | undefined | null): string | null => {
  if (!value) return null
  try { return new URL(value).hostname } catch { return null }
}
const originOf = (value: string | undefined | null): string | null => {
  if (!value) return null
  try { return new URL(value).origin } catch { return null }
}

/** The site's domain, as passkeys are bound to it. */
export function passkeyRpId(headers: HeaderSource, env: Record<string, string | undefined> = process.env): string {
  const configured = env.WEBAUTHN_RP_ID?.trim()
  if (configured) return configured
  const host = (headers.get('x-forwarded-host') || headers.get('host') || '').split(',')[0].trim()
  const fromHost = host.replace(/:\d+$/, '')
  return fromHost || hostOf(env.NEXT_PUBLIC_APP_URL) || hostOf(env.NEXTAUTH_URL) || 'localhost'
}

/** Origins a passkey response may come from (the page the person is on). */
export function passkeyOrigins(headers: HeaderSource, env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>()
  const configured = originOf(env.WEBAUTHN_ORIGIN)
  if (configured) out.add(configured)
  const host = (headers.get('x-forwarded-host') || headers.get('host') || '').split(',')[0].trim()
  const proto = (headers.get('x-forwarded-proto') || '').split(',')[0].trim() || (host.startsWith('localhost') ? 'http' : 'https')
  if (host) out.add(`${proto}://${host}`)
  for (const v of [env.NEXT_PUBLIC_APP_URL, env.NEXTAUTH_URL]) {
    const o = originOf(v)
    if (o) out.add(o)
  }
  return [...out]
}

const b64url = (buf: Buffer) => buf.toString('base64url')

function sign(body: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', `passkey:${secret}`).update(body).digest())
}

/** A short-lived, signed record of the challenge the browser must answer. */
export function sealPasskeyChallenge(challenge: Omit<PasskeyChallenge, 'exp'>, secret: string, now = Date.now()): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...challenge, exp: now + PASSKEY_CHALLENGE_TTL_SECONDS * 1000 })))
  return `${body}.${sign(body, secret)}`
}

export function openPasskeyChallenge(value: string | undefined | null, secret: string, now = Date.now()): PasskeyChallenge | null {
  if (!value || !secret) return null
  const [body, mac, extra] = value.split('.')
  if (!body || !mac || extra) return null
  const expected = sign(body, secret)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PasskeyChallenge
    if (!parsed || typeof parsed.c !== 'string' || (parsed.m !== 'register' && parsed.m !== 'login' && parsed.m !== 'clock')) return null
    if (typeof parsed.exp !== 'number' || parsed.exp <= now) return null
    return parsed
  } catch {
    return null
  }
}

/** A name a person recognises in their list: "iPhone", "Android phone", "Mac"… */
export function passkeyDeviceName(userAgent: string | null | undefined): string {
  const ua = String(userAgent || '')
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  if (/Linux/i.test(ua)) return 'Linux computer'
  return 'This device'
}
