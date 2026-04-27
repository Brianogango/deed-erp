import { NextResponse } from 'next/server'

import { getRequiredSession, requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { assertPermission } from '@/lib/auth/authorization'
import { hashPassword } from '@/lib/auth/password'
import { deleteAuthUser, findAuthUserById, findAuthUserByUsername, toPublicAuthUser, updateAuthUser } from '@/lib/auth/users-repository'
import { normalizeUpdateUserInput } from '@/lib/auth/validation'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    // Self-updates are allowed for any authenticated user.
    // Updating another user requires manageUsers permission (admin only).
    const session = await getRequiredSession()
    const actor = session.user
    if (actor.id !== params.id) {
      assertPermission(actor, 'manageUsers')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw Object.assign(new Error('Invalid request payload'), { status: 400 })
    }

    const existingUser = await findAuthUserById(params.id)
    if (!existingUser) {
      throw Object.assign(new Error('User not found'), { status: 404 })
    }

    const input = normalizeUpdateUserInput(body)

    // Non-admin users updating their own profile cannot change role, modules, or active status.
    if (actor.id === params.id && !['director', 'admin_officer'].includes(actor.role)) {
      delete (input as Record<string, unknown>).role
      delete (input as Record<string, unknown>).modules
      delete (input as Record<string, unknown>).active
    }

    if (input.username && input.username.toLowerCase() !== existingUser.username.toLowerCase()) {
      const duplicateUser = await findAuthUserByUsername(input.username)
      if (duplicateUser && duplicateUser.id !== existingUser.id) {
        throw Object.assign(new Error('Username already exists'), { status: 409 })
      }
    }

    const passwordHash = input.password ? await hashPassword(input.password) : undefined
    const updatedUser = await updateAuthUser(params.id, input, passwordHash)

    if (!updatedUser) {
      throw Object.assign(new Error('User not found'), { status: 404 })
    }

    return NextResponse.json({
      user: toPublicAuthUser(updatedUser),
      audit: {
        action: 'update_user',
        actor: sanitizeActor(actor),
        targetId: updatedUser.id,
      },
    })
  })
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')

    if (actor.id === params.id) {
      throw Object.assign(new Error('You cannot delete your own account'), { status: 400 })
    }

    const deletedUser = await deleteAuthUser(params.id)

    if (!deletedUser) {
      throw Object.assign(new Error('User not found'), { status: 404 })
    }

    return NextResponse.json({
      user: toPublicAuthUser(deletedUser),
      audit: {
        action: 'delete_user',
        actor: sanitizeActor(actor),
        targetId: deletedUser.id,
      },
    })
  })
}
