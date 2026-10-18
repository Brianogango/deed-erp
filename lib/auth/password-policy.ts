/** Shared password policy constants (safe for client + server). */
export const MIN_PASSWORD_LENGTH = 12
export const PASSWORD_HISTORY_COUNT = 5
export const REQUIRE_PASSWORD_UPPERCASE = true
export const REQUIRE_PASSWORD_LOWERCASE = true
export const REQUIRE_PASSWORD_NUMBER = true
export const REQUIRE_PASSWORD_SPECIAL = true

/** The rules in plain words, in the order they are checked — shown wherever a password is chosen. */
export const PASSWORD_RULES: Array<{ label: string; test: (password: string) => boolean }> = [
  { label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: p => p.length >= MIN_PASSWORD_LENGTH },
  ...(REQUIRE_PASSWORD_UPPERCASE ? [{ label: 'One uppercase letter (A–Z)', test: (p: string) => /[A-Z]/.test(p) }] : []),
  ...(REQUIRE_PASSWORD_LOWERCASE ? [{ label: 'One lowercase letter (a–z)', test: (p: string) => /[a-z]/.test(p) }] : []),
  ...(REQUIRE_PASSWORD_NUMBER ? [{ label: 'One number (0–9)', test: (p: string) => /\d/.test(p) }] : []),
  ...(REQUIRE_PASSWORD_SPECIAL ? [{ label: 'One symbol, such as ! @ # $ %', test: (p: string) => /[^A-Za-z0-9]/.test(p) }] : []),
]

/**
 * New/reset passwords must satisfy this policy. Existing hashes remain valid
 * until a password change is requested; the UI does not force-expire users.
 */
export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (REQUIRE_PASSWORD_UPPERCASE && !/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter.'
  }
  if (REQUIRE_PASSWORD_LOWERCASE && !/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter.'
  }
  if (REQUIRE_PASSWORD_NUMBER && !/\d/.test(password)) {
    return 'Password must contain at least one number.'
  }
  if (REQUIRE_PASSWORD_SPECIAL && !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least one special character.'
  }
  return null
}
