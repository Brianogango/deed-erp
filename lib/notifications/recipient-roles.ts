import { normalizePermissionRole } from '@/lib/auth/authorization'

/**
 * Turn "notify the technical leads and inventory officers" into user ids.
 *
 * This has to happen on the server. Browsers used to do it by filtering their
 * own list of users by role, but only directors and admin officers may load
 * that list — a technician's browser knows only the technician. So a parts
 * request, an outsource job or a QC hand-off raised by anyone else resolved to
 * no recipients and was silently dropped. The server can always see every user.
 */
export function resolveRoleRecipients(
  users: Array<{ id: string; role: string | null; isActive?: boolean | null }>,
  roles: unknown,
  opts: { excludeUserId?: string | null; limit?: number } = {},
): string[] {
  if (!Array.isArray(roles) || roles.length === 0) return []
  const wanted = new Set(
    roles
      .filter((r): r is string => typeof r === 'string' && r.length > 0)
      .map(r => normalizePermissionRole(r) ?? r),
  )
  const ids: string[] = []
  for (const user of users ?? []) {
    if (!user?.id || user.isActive === false || user.id === opts.excludeUserId) continue
    const role = normalizePermissionRole(user.role) ?? user.role
    if (role && wanted.has(role) && !ids.includes(user.id)) ids.push(user.id)
  }
  return ids.slice(0, opts.limit ?? 50)
}
