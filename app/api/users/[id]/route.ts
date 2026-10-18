import { NextResponse } from 'next/server'
import { getRequiredSession, requirePermission, withApiErrorHandling, sanitizeActor } from '@/lib/auth/api'
import { listAuthUsers, findAuthUserById, updateAuthUser, findAuthUserByUsername, clearFailedLogin, toPublicAuthUser, deleteAuthUser, deactivateAuthUser, reactivateAuthUser } from '@/lib/auth/users-repository'
import { hashPassword, passwordMatchesHistory } from '@/lib/auth/password'
import { userUpdateSchema, validate } from '@/lib/validation'
import { assertPermission, normalizePermissionRole } from '@/lib/auth/authorization'
import { lastDirectorViolation, diffAccess, snapshotAccess } from '@/lib/auth/access-control'
import { recordAccessChange } from '@/lib/auth/access-audit.server'
import { isDirector } from '@/lib/auth/access'
import { getAccessRoleMap } from '@/lib/auth/access-roles.server'
import { USER_ROLES } from '@/lib/auth/types'
import { sendEmail } from '@/lib/integrations/email'

/** Refuses a change that would leave no active Director. Only looks at the users when it could matter. */
async function refuseIfLastDirector(
  existing: { id: string; role: string },
  next: { role?: string; active?: boolean; removed?: boolean },
) {
  if (normalizePermissionRole(existing.role) !== 'director') return
  const leaving = next.removed === true || next.active === false || (next.role !== undefined && normalizePermissionRole(next.role) !== 'director')
  if (!leaving) return
  const users = (await listAuthUsers()).map(u => ({ id: u.id, role: String(u.role), active: u.active !== false }))
  const message = lastDirectorViolation(users, existing.id, next)
  if (message) throw Object.assign(new Error(message), { status: 409 })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const actor = session.user
    
    // Authorization: User can update themselves, or needs 'manageUsers' permission
    if (actor.id !== resolvedParams.id) {
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

    const existingUser = await findAuthUserById(resolvedParams.id)
    if (!existingUser) {
      throw Object.assign(new Error('User not found'), { status: 404 })
    }

    // Security: Prevent privilege escalation
    // Non-admin users updating their own profile cannot change role, modules, or active status.
    if (actor.id === resolvedParams.id && !isDirector(actor.role)) {
      delete validated.role
      delete validated.modules
      delete validated.active
      delete validated.accessRoleId
    }

    // The role must be one the app knows; anything else used to be written as-is.
    if (validated.role !== undefined && !(USER_ROLES as readonly string[]).includes(String(normalizePermissionRole(validated.role)))) {
      throw Object.assign(new Error('Role is invalid'), { status: 400 })
    }

    // Moving someone onto a custom role changes their role to that role's base role.
    let nextRole = validated.role
    if (validated.accessRoleId) {
      const customRole = (await getAccessRoleMap()).get(validated.accessRoleId)
      if (!customRole) throw Object.assign(new Error('That role no longer exists'), { status: 400 })
      nextRole = customRole.baseRole
    }
    await refuseIfLastDirector(existingUser, { role: nextRole, active: validated.active })
    const accessBefore = snapshotAccess(existingUser)

    // Password validation: reject reuse of current or last 5 hashes (SEC-009).
    if (validated.password) {
      const reused = await passwordMatchesHistory(
        validated.password,
        existingUser.passwordHash,
        existingUser.passwordHistory || [],
      )
      if (reused) {
        throw Object.assign(new Error('You cannot reuse your current or recently used passwords.'), { status: 400 })
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
    const updatedUser = await updateAuthUser(resolvedParams.id, validated as any, passwordHash)
    
    if (!updatedUser) {
      throw Object.assign(new Error('Update failed'), { status: 500 })
    }

    if (body.unlock) {
      await clearFailedLogin(resolvedParams.id)
    }

    const accessAfter = snapshotAccess(updatedUser)
    if (diffAccess(accessBefore, accessAfter).changed) {
      await recordAccessChange({
        action: 'user.access_changed',
        actor,
        target: { id: updatedUser.id, name: updatedUser.name, username: updatedUser.username },
        before: accessBefore,
        after: accessAfter,
      })
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

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')
    if (actor.id === resolvedParams.id) {
      throw Object.assign(new Error('You cannot delete your own account'), { status: 400 })
    }
    
    const target = await findAuthUserById(resolvedParams.id)
    if (target) await refuseIfLastDirector(target, { removed: true })
    const before = target ? snapshotAccess(target) : null

    const deleted = await deleteAuthUser(resolvedParams.id)
    if (!deleted) {
      throw Object.assign(new Error('User not found or already deleted'), { status: 404 })
    }
    await recordAccessChange({
      action: 'user.deleted',
      actor,
      target: { id: deleted.id, name: deleted.name, username: deleted.username },
      before: before ?? snapshotAccess(deleted),
      after: null,
    })
    
    return NextResponse.json({ ok: true })
  })
}

// POST /api/users/[id]  body: { action: 'deactivate' | 'reactivate' }
// Soft-delete (deactivate) or re-enable a user without removing the record.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')
    if (actor.id === resolvedParams.id) {
      throw Object.assign(new Error('You cannot deactivate your own account'), { status: 400 })
    }
    let body: any = {}
    try { body = await request.json() } catch { /* no body */ }
    const action = body?.action as string | undefined

    if (action === 'deactivate') {
      const target = await findAuthUserById(resolvedParams.id)
      if (target) await refuseIfLastDirector(target, { active: false })
      const before = target ? snapshotAccess(target) : null
      const result = await deactivateAuthUser(resolvedParams.id)
      if (!result) throw Object.assign(new Error('User not found'), { status: 404 })
      await recordAccessChange({
        action: 'user.deactivated',
        actor,
        target: { id: result.id, name: result.name, username: result.username },
        before: before ?? snapshotAccess({ ...result, active: true }),
        after: snapshotAccess({ ...result, active: false }),
      })
      return NextResponse.json({
        ok: true,
        user: { id: result.id, active: false },
        audit: { action: 'deactivate_user', actor: sanitizeActor(actor), targetId: resolvedParams.id },
      })
    }

    if (action === 'reactivate') {
      const current = await findAuthUserById(resolvedParams.id)
      const before = current ? snapshotAccess(current) : null
      const result = await reactivateAuthUser(resolvedParams.id)
      if (!result) throw Object.assign(new Error('User not found'), { status: 404 })
      await recordAccessChange({
        action: 'user.reactivated',
        actor,
        target: { id: result.id, name: result.name, username: result.username },
        before: before ?? snapshotAccess({ ...result, active: false }),
        after: snapshotAccess({ ...result, active: true }),
      })
      return NextResponse.json({
        ok: true,
        user: { id: result.id, active: true },
        audit: { action: 'reactivate_user', actor: sanitizeActor(actor), targetId: resolvedParams.id },
      })
    }

    throw Object.assign(
      new Error('Unknown action. Use { action: "deactivate" } or { action: "reactivate" }'),
      { status: 400 }
    )
  })
}
