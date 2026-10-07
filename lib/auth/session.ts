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
