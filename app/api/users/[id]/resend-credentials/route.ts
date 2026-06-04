import { NextResponse } from 'next/server'
import { requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { hashPassword } from '@/lib/auth/password'
import { findAuthUserById, updateAuthUser, toPublicAuthUser } from '@/lib/auth/users-repository'
import { buildCredentialMessage, sendMultiChannelMessage } from '@/lib/integrations/messaging'

/**
 * POST /api/users/[id]/resend-credentials
 *
 * Regenerates a temporary password for the user, marks mustChangePassword=true,
 * and sends the temporary credentials to the user's email address through the HR
 * mailbox. If email delivery fails, the password is returned to the admin for
 * secure manual sharing as a fallback.
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

    console.log('[users] Credentials reset', { userId: user.id, credentialDelivery: credentialDelivery.results.email })

    return NextResponse.json({
      user: toPublicAuthUser(updated),
      temporaryPassword: credentialDelivery.success ? undefined : temporaryPassword,
      credentialDelivery,
      audit: {
        action: 'resend_credentials',
        actor: sanitizeActor(actor),
        targetId: user.id,
      },
    })
  })
}
