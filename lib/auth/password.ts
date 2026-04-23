import 'server-only'

const encoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')

export const hashPassword = async (password: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password))
  return toHex(digest)
}

export const verifyPassword = async (password: string, expectedHash: string) => {
  const actualHash = await hashPassword(password)

  if (actualHash.length !== expectedHash.length) return false

  let mismatch = 0

  for (let index = 0; index < actualHash.length; index += 1) {
    mismatch |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index)
  }

  return mismatch === 0
}
