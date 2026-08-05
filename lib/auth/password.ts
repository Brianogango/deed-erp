import 'server-only'
import bcrypt from 'bcryptjs'

export { MIN_PASSWORD_LENGTH } from './password-policy'
export type VerifyPasswordResult = {
  verified: boolean
  /** True when the stored hash is legacy SHA-256 and should be upgraded to bcrypt. */
  needsRehash: boolean
}

/**
 * Hashes a password using bcrypt with a secure salt.
 * bcrypt is preferred over plain SHA-256 for passwords as it is
 * computationally expensive, making brute-force attacks much harder.
 */
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12
  return bcrypt.hash(password, saltRounds)
}

const sha256Hex = async (password: string): Promise<string> => {
  const encoder = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password))
  return Array.from(new Uint8Array(digest))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}

const isBcryptHash = (hash: string) => hash.startsWith('$2')

/**
 * Verifies a password against a stored hash.
 * Legacy SHA-256 hashes are accepted and flagged with `needsRehash: true`
 * so callers can silently upgrade to bcrypt after a successful login.
 */
export const verifyPassword = async (
  password: string,
  expectedHash: string,
): Promise<VerifyPasswordResult> => {
  if (!password || !expectedHash) {
    return { verified: false, needsRehash: false }
  }

  if (!isBcryptHash(expectedHash)) {
    const actualHash = await sha256Hex(password)
    if (actualHash === expectedHash) {
      return { verified: true, needsRehash: true }
    }
    return { verified: false, needsRehash: false }
  }

  const verified = await bcrypt.compare(password, expectedHash)
  return { verified, needsRehash: false }
}

/**
 * Returns true when `password` matches the current hash or any entry in
 * `history` (last N password hashes). Used to block password reuse.
 */
export const passwordMatchesHistory = async (
  password: string,
  currentHash: string | null | undefined,
  history: string[] = [],
): Promise<boolean> => {
  const hashes = Array.from(new Set([currentHash, ...history].filter(Boolean))) as string[]
  for (const oldHash of hashes) {
    const { verified } = await verifyPassword(password, oldHash)
    if (verified) return true
  }
  return false
}
