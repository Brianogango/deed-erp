import 'server-only'

import { findAuthUserById } from './users-repository'
import {
  getCachedSessionStatus,
  publishSessionStatus,
  type SessionStatus,
} from './session-validity'

/**
 * Resolve the live active/role status for a user.
 * Uses the shared cache when fresh; otherwise reads Postgres and publishes.
 * On DB failure: fail-open (treat as active, keep JWT role).
 */
export async function resolveUserSessionStatus(userId: string): Promise<SessionStatus> {
  const cached = getCachedSessionStatus(userId)
  if (cached) return cached

  try {
    const user = await findAuthUserById(userId)
    if (!user) {
      const missing: SessionStatus = {
        isActive: false,
        role: '',
        invalidatedAt: Date.now(),
      }
      await publishSessionStatus(userId, missing)
      return missing
    }
    const status: SessionStatus = {
      isActive: Boolean(user.active),
      role: String(user.role ?? ''),
      actsAsTechnician: Boolean(user.actsAsTechnician),
      invalidatedAt: Date.now(),
    }
    await publishSessionStatus(userId, status)
    return status
  } catch (err) {
    console.error('[session-validity] DB lookup failed — fail-open:', err)
    return {
      isActive: true,
      role: '',
      invalidatedAt: 0,
    }
  }
}
