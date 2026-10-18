/**
 * Custom roles.
 *
 * GET  — the built-in roles (read-only) and every custom role, with how many
 *        people are on each. Directors and Admin Officers (viewUsers).
 * POST — create a custom role. Directors only (manageUsers).
 */
import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { BUILT_IN_ROLES, validateRoleInput } from '@/lib/auth/access-roles'
import { countUsersOnRoles, createCustomRole, listCustomRoles, nameIsTaken } from '@/lib/auth/access-roles.server'
import { recordRoleChange } from '@/lib/auth/access-audit.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('viewUsers')
    const [custom, counts] = await Promise.all([listCustomRoles(), countUsersOnRoles()])
    return NextResponse.json({
      builtIn: BUILT_IN_ROLES,
      custom: custom.map(role => ({ ...role, userCount: counts[role.id] ?? 0 })),
    })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageUsers')
    const body = await request.json().catch(() => ({}))
    const checked = validateRoleInput(body)
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 422 })
    if (await nameIsTaken(checked.value.name)) {
      return NextResponse.json({ error: `A role called “${checked.value.name}” already exists` }, { status: 409 })
    }
    const role = await createCustomRole(checked.value, actor.id)
    await recordRoleChange({ action: 'role.created', actor, role, before: null, after: role })
    return NextResponse.json({ role: { ...role, userCount: 0 } }, { status: 201 })
  })
}
