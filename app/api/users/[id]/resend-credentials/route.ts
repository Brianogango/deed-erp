import { NextResponse } from 'next/server'
import { requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { hashPassword } from '@/lib/auth/password'
import { findAuthUserById, updateAuthUser, toPublicAuthUser } from '@/lib/auth/users-repository'
import { sendEmail } from '@/lib/integrations/email'

/**
 * POST /api/users/[id]/resend-credentials
 *
 * Regenerates a temporary password for the user, marks mustChangePassword=true,
 * and re-sends the welcome / credentials email through the HR mailbox.
 *
 * Requires `manageUsers` permission. Returns the email send result so the UI can
 * warn the admin when delivery fails (e.g. mailbox doesn't yet exist on the mail
 * server). When delivery fails, the temporary password is included in the
 * response so the admin can communicate it through another channel.
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
    if (!user.email) {
      throw Object.assign(new Error('This user has no email address on file'), { status: 400 })
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

    const emailResult = await sendEmail({
      to: user.email,
      mailbox: 'hr',
      from: process.env.HR_EMAIL || 'hr@deed.co.ke',
      subject: 'Your Deed ERP credentials have been reset',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <h2 style="color: #1B2762; margin-top: 0;">Deed ERP Credentials Reset</h2>
          <p>Hi ${user.name},</p>
          <p>Your Deed ERP credentials have been reset by an administrator.</p>
          <p><strong>Username:</strong> ${user.username}<br/><strong>Temporary password:</strong> ${temporaryPassword}</p>
          <p>You will be asked to change this temporary password after signing in.</p>
          <p>If you did not request this reset, please contact HR immediately.</p>
          <p style="margin-top: 28px;">Best regards,<br/><strong>HR Department</strong><br/>Deed Technologies Limited</p>
        </div>
      `,
      text: `Hi ${user.name},

Your Deed ERP credentials have been reset by an administrator.

Username: ${user.username}
Temporary password: ${temporaryPassword}

You will be asked to change this temporary password after signing in.

If you did not request this reset, please contact HR immediately.

Best regards,
HR Department
Deed Technologies Limited`,
    })

    if (!emailResult.success) {
      console.error('[users] Resend-credentials email failed', { userId: user.id, to: user.email, error: emailResult.error })
    } else {
      console.log('[users] Resend-credentials email sent', { userId: user.id, to: user.email, messageId: emailResult.messageId })
    }

    return NextResponse.json({
      user: toPublicAuthUser(updated),
      email: {
        sent: emailResult.success,
        to: user.email,
        error: emailResult.success ? undefined : emailResult.error,
        temporaryPassword: emailResult.success ? undefined : temporaryPassword,
      },
      audit: {
        action: 'resend_credentials',
        actor: sanitizeActor(actor),
        targetId: user.id,
      },
    })
  })
}
