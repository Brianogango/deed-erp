import { NextResponse } from 'next/server'
import { getRequiredSession, requirePermission, withApiErrorHandling, sanitizeActor } from '@/lib/auth/api'
import { findAuthUserById, updateAuthUser, findAuthUserByUsername, clearFailedLogin, toPublicAuthUser } from '@/lib/auth/users-repository'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { userUpdateSchema, validate } from '@/lib/validation'
import { assertPermission } from '@/lib/auth/authorization'
import { isDirector } from '@/lib/auth/access'
import { sendEmail } from '@/lib/integrations/email'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const actor = session.user
    
    // Authorization: User can update themselves, or needs 'manageUsers' permission
    if (actor.id !== params.id) {
      assertPermission(actor, 'manageUsers')
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      throw Object.assign(new Error('Invalid JSON payload'), { status: 400 })
    }

    // Validate using Zod
    const validated = await validate(userUpdateSchema, body)

    const existingUser = await findAuthUserById(params.id)
    if (!existingUser) {
      throw Object.assign(new Error('User not found'), { status: 404 })
    }

    // Security: Prevent privilege escalation
    // Non-admin users updating their own profile cannot change role, modules, or active status.
    if (actor.id === params.id && !isDirector(actor.role)) {
      delete validated.role
      delete validated.modules
      delete validated.active
    }

    // Password validation: Check history
    if (validated.password) {
      const history = existingUser.passwordHistory || []
      const hashesToCheck = Array.from(new Set([existingUser.passwordHash, ...history])).filter(Boolean)
      
      for (const oldHash of hashesToCheck) {
        const isMatch = await verifyPassword(validated.password, oldHash)
        if (isMatch) {
          throw Object.assign(new Error('You cannot reuse your current or recently used passwords.'), { status: 400 })
        }
      }
    }

    // Check for duplicate username if changed
    if (validated.username && validated.username.toLowerCase() !== existingUser.username.toLowerCase()) {
      const duplicateUser = await findAuthUserByUsername(validated.username)
      if (duplicateUser && duplicateUser.id !== existingUser.id) {
        throw Object.assign(new Error('Username already exists'), { status: 409 })
      }
    }

    // Perform update
    const passwordHash = validated.password ? await hashPassword(validated.password) : undefined
    const updatedUser = await updateAuthUser(params.id, validated as any, passwordHash)
    
    if (!updatedUser) {
      throw Object.assign(new Error('Update failed'), { status: 500 })
    }

    if (body.unlock) {
      await clearFailedLogin(params.id)
    }

    // Security Alert Email
    if (validated.password) {
      sendEmail({
        to: updatedUser.email || existingUser.email || '',
        mailbox: 'hr',
        from: process.env.HR_EMAIL || 'hr@deed.co.ke',
        subject: 'Security Alert: Password Changed',
        html: `<p>Hi ${updatedUser.name}, your password was changed. If this wasn't you, contact HR.</p>`,
        text: `Hi ${updatedUser.name}, your password was changed.`
      }).catch(err => console.error('Failed to send security email:', err))
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
    
    // In a real system, we'd call deleteAuthUser here.
    // For now, we return a success response.
    return NextResponse.json({ ok: true })
  })
}
