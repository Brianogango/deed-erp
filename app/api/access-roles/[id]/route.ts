/**
 * PUT    — change a custom role. Everyone on it gets the change at once.
 * DELETE — remove a custom role nobody is on.
 * Directors only (manageUsers). Built-in roles cannot be changed here.
 */
import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { validateRoleInput } from '@/lib/auth/access-roles'
import {
  countUsersOnRoles, deleteCustomRole, getCustomRole, nameIsTaken, updateCustomRole,
} from '@/lib/auth/access-roles.server'
import { recordRoleChange } from '@/lib/auth/access-audit.server'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')
    const { id } = await params
    const before = await getCustomRole(id)
    if (!before) return NextResponse.json({ error: 'Role not found. Built-in roles cannot be changed.' }, { status: 404 })
    const body = await request.json().catch(() => ({}))
    const checked = validateRoleInput(body)
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 422 })
    if (await nameIsTaken(checked.value.name, id)) {
      return NextResponse.json({ error: `A role called “${checked.value.name}” already exists` }, { status: 409 })
    }
    const role = await updateCustomRole(id, checked.value)
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    const userCount = (await countUsersOnRoles())[id] ?? 0
    await recordRoleChange({ action: 'role.updated', actor, role, before, after: role, affectedUsers: userCount })
    return NextResponse.json({ role: { ...role, userCount } })
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')
    const { id } = await params
    const before = await getCustomRole(id)
    if (!before) return NextResponse.json({ error: 'Role not found. Built-in roles cannot be deleted.' }, { status: 404 })
    const result = await deleteCustomRole(id)
    if (!result.deleted) {
      return NextResponse.json({
        error: `${result.inUse} ${result.inUse === 1 ? 'person is' : 'people are'} still on “${before.name}”. Move them to another role first.`,
      }, { status: 409 })
    }
    await recordRoleChange({ action: 'role.deleted', actor, role: before, before, after: null })
    return NextResponse.json({ ok: true })
  })
}
