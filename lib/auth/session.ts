import type { PublicUser, SessionPayload } from './types'

export const SESSION_COOKIE_NAME = 'deed_erp_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 12

const encoder = new TextEncoder()

/**
 * Fail closed when AUTH_SECRET is missing — never fall back to a known demo value.
 * (Audit SEC-001)
 */
export const getSessionSecret = (): string => {
  const secret = String(process.env.AUTH_SECRET ?? '').trim()
  if (!secret) {
    throw new Error('AUTH_SECRET is not configured — refusing to sign or verify sessions')
  }
  return secret
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')

const constantTimeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false

  let mismatch = 0

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return mismatch === 0
}

const signPayload = async (value: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return toHex(signature)
}

export const buildSessionPayload = (user: PublicUser): SessionPayload => ({
  userId: user.id,
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
})

export const createSessionToken = async (user: PublicUser) => {
  const payload = encodeURIComponent(JSON.stringify(buildSessionPayload(user)))
  const signature = await signPayload(payload)
  return `${payload}.${signature}`
}

export const readSessionToken = async (
  token: string | null | undefined,
): Promise<SessionPayload | null> => {
  if (!token) return null

  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expectedSignature = await signPayload(payload)

  if (!constantTimeEqual(signature, expectedSignature)) return null

  try {
    const session = JSON.parse(decodeURIComponent(payload)) as SessionPayload

    if (!session?.userId) return null
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null

    return session
  } catch {
    return null
  }
}
