import 'server-only'

import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import type { PublicUser } from './types'
import { getServerSession } from './server'
import { assertPermission } from './authorization'
import { recordHttpMetric } from '@/lib/http-metrics'

export const getRequiredSession = async () => {
  const session = await getServerSession()

  if (!session?.user) {
    const error = new Error('Unauthorized')
    ;(error as Error & { status?: number }).status = 401
    throw error
  }

  return session
}

/**
 * Refuses (403) unless the signed-in person holds this permission — a named
 * action or a module part from the permission catalog. Built-in roles keep
 * the rights they have always had; the Director holds every permission; a
 * person on a custom role needs it in their role.
 */
export const requirePermission = async (permission: string) => {
  const session = await getRequiredSession()
  assertPermission(session.user, permission)
  return session.user
}

const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

export const withApiErrorHandling = async <T>(handler: () => Promise<T>) => {
  const t0 = Date.now()
  try {
    return await handler()
  } catch (error) {
    const status =
      typeof error === 'object' && error && 'status' in error &&
      typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 500

    try {
      const h = await headers()
      const path = h.get('next-url') || h.get('x-matched-path') || h.get('x-invoke-path') || '/api'
      recordHttpMetric({ path, status, ms: Date.now() - t0 })
    } catch {
      recordHttpMetric({ path: '/api', status, ms: Date.now() - t0 })
    }

    // Always log server-side so the error is visible in deployment logs
    if (status >= 500) {
      console.error('[API Error]', error)
    }

    // For client errors (4xx), return the specific message so the caller can act on it.
    // For server errors (5xx), return a generic message — never expose Prisma internals.
    // A message written for the user (`expose: true`) is shown whatever the status.
    const exposed = typeof error === 'object' && error !== null && (error as { expose?: unknown }).expose === true
    const message =
      status < 500 || exposed
        ? (error instanceof Error ? error.message : 'Bad request')
        : 'Internal server error'

    return jsonError(message, status)
  }
}

export const sanitizeActor = (user: PublicUser) => ({
  id: user.id,
  username: user.username,
  role: user.role,
})
