import 'server-only'
import bcrypt from 'bcryptjs'

/**
 * Hashes a password using bcrypt with a secure salt.
 * bcrypt is preferred over plain SHA-256 for passwords as it is 
 * computationally expensive, making brute-force attacks much harder.
 */
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12
  return bcrypt.hash(password, saltRounds)
}

/**
 * Verifies a password against a bcrypt hash.
 * This is resistant to timing attacks.
 */
export const verifyPassword = async (password: string, expectedHash: string): Promise<boolean> => {
  if (!password || !expectedHash) return false
  
  // Support legacy SHA-256 hashes for migration if necessary, 
  // but here we enforce bcrypt for new/updated passwords.
  // bcrypt hashes usually start with $2a$, $2b$, or $2y$.
  if (!expectedHash.startsWith('$2')) {
    // Legacy fallback (SHA-256) - only if you have existing users with SHA-256
    const encoder = new TextEncoder()
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password))
    const actualHash = Array.from(new Uint8Array(digest))
      .map(value => value.toString(16).padStart(2, '0'))
      .join('')
    
    if (actualHash === expectedHash) return true
  }

  return bcrypt.compare(password, expectedHash)
}
