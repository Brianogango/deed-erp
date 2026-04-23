import 'server-only'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import type { PublicUser } from './types'
import type { ServerSession } from './types'
import { findAuthUserById, toPublicAuthUser } from './users-repository'
import { createSessionToken, readSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './session'

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

export const getServerSession = async () => {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value ?? null
  const sessionPayload = await readSessionToken(token)

  if (!sessionPayload) return null

  const authUser = await findAuthUserById(sessionPayload.userId)

  if (!authUser || !authUser.active) return null

  const session: ServerSession = {
    user: toPublicAuthUser(authUser),
    issuedAt: sessionPayload.issuedAt,
    expiresAt: sessionPayload.expiresAt,
  }

  return session
}

export const attachSessionCookie = async (response: NextResponse, user: PublicUser) => {
  const token = await createSessionToken(user)

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: SESSION_TTL_SECONDS,
    expires: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  })

  return response
}

export const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...cookieOptions,
    maxAge: 0,
    expires: new Date(0),
  })

  return response
}
