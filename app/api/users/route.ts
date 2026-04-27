import { NextResponse } from 'next/server'

import { requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { hashPassword } from '@/lib/auth/password'
import { createAuthUser, findAuthUserByUsername, listPublicUsers, toPublicAuthUser } from '@/lib/auth/users-repository'
import { normalizeCreateUserInput } from '@/lib/auth/validation'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('viewUsers')
    const users = await listPublicUsers()
    return NextResponse.json({ users })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw Object.assign(new Error('Invalid request payload'), { status: 400 })
    }

    const input = normalizeCreateUserInput(body)
    
    // Inject the mustChangePassword flag (defaulting to true for new accounts)
    Object.assign(input, { mustChangePassword: (body as Record<string, any>).mustChangePassword ?? true })

    const existingUser = await findAuthUserByUsername(input.username)

    if (existingUser) {
      throw Object.assign(new Error('Username already exists'), { status: 409 })
    }

    const passwordHash = await hashPassword(input.password)
    const user = await createAuthUser(input, passwordHash)

    return NextResponse.json({
      user: toPublicAuthUser(user),
      audit: {
        action: 'create_user',
        actor: sanitizeActor(actor),
        targetId: user.id,
      },
    }, { status: 201 })
  })
}
