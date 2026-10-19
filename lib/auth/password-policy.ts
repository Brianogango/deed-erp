/** Shared password policy constants (safe for client + server). */
export const MIN_PASSWORD_LENGTH = 12
export const PASSWORD_HISTORY_COUNT = 5
export const REQUIRE_PASSWORD_UPPERCASE = true
export const REQUIRE_PASSWORD_LOWERCASE = true
export const REQUIRE_PASSWORD_NUMBER = true
export const REQUIRE_PASSWORD_SPECIAL = true

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
