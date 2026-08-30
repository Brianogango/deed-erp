import { NextResponse } from 'next/server'
import { requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { hashPassword } from '@/lib/auth/password'
import { findAuthUserById, updateAuthUser, toPublicAuthUser } from '@/lib/auth/users-repository'
import { buildCredentialMessage, sendMultiChannelMessage } from '@/lib/integrations/messaging'
import { generateTemporaryPassword } from '@/lib/auth/temporary-credentials'

/**
 * POST /api/users/[id]/resend-credentials
 *
 * Rotates a user's temporary password and delivers it only through the
 * configured HR email channel. No credential is returned by this API.
 * Delivery failure rolls the password change back.
 */
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
      { password: temporaryPassword, mustChangePassword: true },
      passwordHash,
    )
    if (!updated) {
      throw Object.assign(new Error('Failed to update user'), { status: 500 })
    }

    const credentialDelivery = await sendMultiChannelMessage({
      purpose: 'credentials',
      recipient: { name: updated.name || user.name, email: updated.email || user.email },
      channels: ['email'],
      mailbox: 'hr',
      from: process.env.HR_EMAIL || 'hr@deed.co.ke',
      content: buildCredentialMessage({
        name: updated.name || user.name || updated.username,
        username: updated.username,
        temporaryPassword,
        mode: 'reset',
        loginUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://erp.deed.co.ke',
      }),
      metadata: { userId: user.id, action: 'resend_credentials' },
    })

    if (!credentialDelivery.success) {
      // Restore the previous credential rather than returning the new password
      // to an administrator or leaving the user locked out without delivery.
      await updateAuthUser(
        params.id,
        { mustChangePassword: Boolean(user.mustChangePassword) },
        user.passwordHash,
      )
      throw Object.assign(
        new Error('Credential delivery failed; password reset was rolled back. Fix HR email delivery and retry.'),
        { status: 503 },
      )
    }

    console.log('[users] Credentials reset', { userId: user.id, credentialDelivered: true })

    return NextResponse.json({
      user: toPublicAuthUser(updated),
      credentialDelivery,
      audit: {
        action: 'resend_credentials',
        actor: sanitizeActor(actor),
        targetId: user.id,
      },
    })
  })
}
