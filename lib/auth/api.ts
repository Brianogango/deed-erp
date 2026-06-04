import 'server-only'

import { NextResponse } from 'next/server'

import type { PublicUser } from './types'
import { getServerSession } from './server'
import { assertPermission, normalizePermissionRole } from './authorization'

export const getRequiredSession = async () => {
  const session = await getServerSession()

  if (!session?.user) {
    const error = new Error('Unauthorized')
    ;(error as Error & { status?: number }).status = 401
    throw error
  }

  return session
}

export const requirePermission = async (action: Parameters<typeof assertPermission>[1]) => {
  const session = await getRequiredSession()
  assertPermission(session.user, action)
  return session.user
}

export const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

export const withApiErrorHandling = async <T>(handler: () => Promise<T>) => {
  try {
    return await handler()
  } catch (error) {
    const status =
      typeof error === 'object' && error && 'status' in error &&
      typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 500

    // Always log server-side so the error is visible in deployment logs
    if (status >= 500) {
      console.error('[API Error]', error)
    }

    // For client errors (4xx), return the specific message so the caller can act on it.
    // For server errors (5xx), return a generic message — never expose Prisma internals.
    const message =
      status < 500
        ? (error instanceof Error ? error.message : 'Bad request')
        : 'Internal server error'

    return jsonError(message, status)
  }
}

export const requireRole = async (allowed: string[]) => {
  const session = await getRequiredSession()
  const role = normalizePermissionRole(session.user.role)
  const normalizedAllowedRoles = allowed.map(allowedRole => normalizePermissionRole(allowedRole)).filter(Boolean)
  if (!role || !normalizedAllowedRoles.includes(role)) {
    const error = new Error('Forbidden — insufficient role')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }
  return session.user
}

export const sanitizeActor = (user: PublicUser) => ({
  id: user.id,
  username: user.username,
  role: user.role,
})
