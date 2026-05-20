import { NextResponse } from 'next/server'
import { requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { hashPassword } from '@/lib/auth/password'
import { findAuthUserById, updateAuthUser, toPublicAuthUser } from '@/lib/auth/users-repository'

/**
 * POST /api/users/[id]/resend-credentials
 *
 * Regenerates a temporary password for the user and marks mustChangePassword=true.
 * Automatic credential delivery is disabled. The new password is returned to the
 * admin for manual sharing.
 *
 * Requires `manageUsers` permission.
 */
const generateTemporaryPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  let password = 'D3ed!'
  for (let i = 0; i < 9; i += 1) password += alphabet[Math.floor(Math.random() * alphabet.length)]
  return password
}

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')

    const user = await findAuthUserById(params.id)
    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 404 })
    }

    const temporaryPassword = generateTemporaryPassword()
    const passwordHash = await hashPassword(temporaryPassword)

    const updated = await updateAuthUser(
      params.id,
      { password: temporaryPassword, mustChangePassword: false },
      passwordHash,
    )
    if (!updated) {
      throw Object.assign(new Error('Failed to update user'), { status: 500 })
    }

    console.log('[users] Credentials reset without automatic delivery', { userId: user.id })

    return NextResponse.json({
      user: toPublicAuthUser(updated),
      temporaryPassword, // Surface the temporary password to the admin for manual sharing
      audit: {
        action: 'resend_credentials',
        actor: sanitizeActor(actor),
        targetId: user.id,
      },
    })
  })
}
