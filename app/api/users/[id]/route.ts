import { NextResponse } from 'next/server'

import { getRequiredSession, requirePermission, sanitizeActor, withApiErrorHandling } from '@/lib/auth/api'
import { assertPermission } from '@/lib/auth/authorization'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { deleteAuthUser, findAuthUserById, findAuthUserByUsername, toPublicAuthUser, updateAuthUser, clearFailedLogin } from '@/lib/auth/users-repository'
import { normalizeUpdateUserInput } from '@/lib/auth/validation'
import { sendEmail } from '@/lib/integrations/email'

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

    // Inject the mustChangePassword flag if it is provided in the request
    if (typeof (body as Record<string, unknown>).mustChangePassword === 'boolean') {
      Object.assign(input, { mustChangePassword: (body as Record<string, unknown>).mustChangePassword })
    }

    if ((input as Record<string, unknown>).unlock) {
      await clearFailedLogin(params.id)
    }

    // Non-admin users updating their own profile cannot change role, modules, or active status.
    if (actor.id === params.id && actor.role !== 'admin') {
      delete (input as Record<string, unknown>).role
      delete (input as Record<string, unknown>).modules
      delete (input as Record<string, unknown>).active
    }

  if (input.password) {
    const history = existingUser.passwordHistory || []
    // Check current hash + last 5 historic hashes to prevent reuse
    const hashesToCheck = Array.from(new Set([existingUser.passwordHash, ...history])).filter(Boolean)
    
    for (const oldHash of hashesToCheck) {
      try {
        const isMatch = await verifyPassword(input.password, oldHash)
        if (isMatch) {
          throw Object.assign(new Error('You cannot reuse your current or recently used passwords. Please choose a different password.'), { status: 400 })
        }
      } catch (e: any) {
        if (e.status === 400) throw e // Rethrow our custom validation error
      }
    }
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

    // Automatically trigger a notification if the password was changed
    if (input.password) {
      sendEmail({
        to: updatedUser.username.includes('@') ? updatedUser.username : existingUser.username.includes('@') ? existingUser.username : '', // Fallback to email if stored in username
        from: process.env.HR_EMAIL || 'hr@deed.co.ke',
        subject: 'Security Alert: Password Changed',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #1B2762;">Password Changed</h2>
            <p>Hi ${updatedUser.name},</p>
            <p>This is a confirmation that the password for your Deed ERP account (<strong>${updatedUser.username}</strong>) has been successfully changed.</p>
            <p>If you did not perform this action, please contact the HR department immediately at <a href="mailto:hr@deed.co.ke">hr@deed.co.ke</a>.</p>
            <br/>
            <p>Best regards,</p>
            <p><strong>HR Department</strong><br/>Deed Technologies Limited</p>
          </div>
        `,
        text: `Hi ${updatedUser.name},\n\nThis is a confirmation that the password for your Deed ERP account (${updatedUser.username}) has been successfully changed.\n\nIf you did not perform this action, please contact the HR department immediately at hr@deed.co.ke.\n\nBest regards,\nHR Department\nDeed Technologies Limited`
      }).catch(err => console.error('Failed to send password change email:', err))
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
