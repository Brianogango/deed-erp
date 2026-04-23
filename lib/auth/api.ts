import 'server-only'

import { NextResponse } from 'next/server'

import type { PublicUser } from './types'
import { getServerSession } from './server'
import { assertPermission } from './authorization'

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

export const jsonError = (message: string, status = 400) => NextResponse.json({ message }, { status })

export const withApiErrorHandling = async <T>(handler: () => Promise<T>) => {
  try {
    return await handler()
  } catch (error) {
    const status = typeof error === 'object' && error && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return jsonError(message, status)
  }
}

export const sanitizeActor = (user: PublicUser) => ({
  id: user.id,
  username: user.username,
  role: user.role,
})
