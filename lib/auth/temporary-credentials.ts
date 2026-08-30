import crypto from 'node:crypto'

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%&*+-_?'
const ALL = UPPER + LOWER + DIGITS + SYMBOLS

function pick(alphabet: string): string {
  return alphabet[crypto.randomInt(0, alphabet.length)]
}

export function generateTemporaryPassword(length = 20): string {
  const target = Math.max(16, Math.min(64, Math.floor(length)))
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < target) chars.push(pick(ALL))

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export function isStrongBootstrapPassword(password: unknown): password is string {
  if (typeof password !== 'string' || password.length < 16 || password.length > 128) return false
  return (
    /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password)
  )
}
