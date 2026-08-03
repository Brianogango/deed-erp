/**
 * In-app bell inbox helpers.
 *
 * Rules:
 * - Recipients are always explicit user ids (never “everyone”).
 * - Never notify the actor who performed the action.
 * - Once read (read / readAt), merge never flips back to unread.
 * - Deduplicate open unread rows by entityKey per recipient.
 */

import type { ModuleId } from '@/lib/auth/types'

export type NotifType = 'assignment' | 'leave' | 'asset' | 'expense' | 'system' | 'repair'

export interface AppNotification {
  id: string
  userId: string
  type: NotifType
  title: string
  body: string
  module?: ModuleId
  path?: string
  read: boolean
  /** Set once when marked read; sticky across sync merges. */
  readAt?: string | null
  createdAt: string
  icon: string
  /** Dedupe key, e.g. `repair:{id}:parts_arrived`. */
  entityKey?: string
}

export interface NotifyUsersInput {
  recipients: Array<string | null | undefined>
  type: NotifType
  title: string
  body: string
  module?: ModuleId
  path?: string
  icon?: string
  entityKey?: string
  /** Actor who caused the event — never receives the notification. */
  excludeUserId?: string | null
}

const DEFAULT_ICON: Record<NotifType, string> = {
  assignment: '🔧',
  leave: '🌴',
  asset: '💻',
  expense: '💰',
  system: '⚠️',
  repair: '🔧',
}

export function defaultNotifIcon(type: NotifType): string {
  return DEFAULT_ICON[type] ?? '🔔'
}

export function normalizeNotification(n: AppNotification): AppNotification {
  const read = Boolean(n.read || n.readAt)
  return {
    ...n,
    read,
    readAt: read ? (n.readAt || n.createdAt || null) : null,
    icon: n.icon || defaultNotifIcon(n.type),
  }
}

function pickEarliestReadAt(a?: string | null, b?: string | null): string | null {
  if (a && b) return new Date(a).getTime() <= new Date(b).getTime() ? a : b
  return a || b || null
}

/** Prefer sticky read: if either side is read, result stays read. */
export function stickyReadMerge(remote: AppNotification, local: AppNotification): AppNotification {
  const base = normalizeNotification({ ...remote, ...local, id: local.id || remote.id })
  const read = Boolean(remote.read || local.read || remote.readAt || local.readAt)
  const readAt = read
    ? (pickEarliestReadAt(remote.readAt, local.readAt) || local.readAt || remote.readAt || local.createdAt || remote.createdAt)
    : null
  return {
    ...base,
    // Content: prefer whichever side is newer by createdAt when they differ.
    title: local.title || remote.title,
    body: local.body || remote.body,
    module: local.module ?? remote.module,
    path: local.path ?? remote.path,
    icon: local.icon || remote.icon || defaultNotifIcon(base.type),
    entityKey: local.entityKey ?? remote.entityKey,
    type: local.type || remote.type,
    userId: local.userId || remote.userId,
    createdAt: local.createdAt || remote.createdAt,
    read,
    readAt,
  }
}

/**
 * Union by id with sticky read. Used for poll + remote SSE overwrites so a
 * local mark-as-read cannot be undone by an older remote snapshot.
 */
export function mergeNotificationsSticky(
  local: AppNotification[],
  remote: AppNotification[],
): AppNotification[] {
  const byId = new Map<string, AppNotification>()
  for (const n of remote) {
    if (!n?.id) continue
    byId.set(n.id, normalizeNotification(n))
  }
  for (const n of local) {
    if (!n?.id) continue
    const existing = byId.get(n.id)
    byId.set(n.id, existing ? stickyReadMerge(existing, n) : normalizeNotification(n))
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export function uniqueRecipientIds(
  recipients: Array<string | null | undefined>,
  excludeUserId?: string | null,
): string[] {
  const exclude = excludeUserId || null
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of recipients) {
    if (!id || id === exclude || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function userIdsWithRoles(
  users: Array<{ id: string; role: string }>,
  roles: string[],
  excludeUserId?: string | null,
): string[] {
  const roleSet = new Set(roles)
  return uniqueRecipientIds(
    users.filter(u => roleSet.has(u.role)).map(u => u.id),
    excludeUserId,
  )
}

export interface BuiltNotification extends AppNotification {}

/**
 * Build notification rows for recipients (pure). Caller prepends into state.
 * Dedupes against existing unread rows with the same entityKey + userId.
 */
export function buildNotifyRows(
  existing: AppNotification[],
  input: NotifyUsersInput,
  makeId: () => string,
  nowIso: () => string = () => new Date().toISOString(),
): { next: AppNotification[]; created: number; updated: number } {
  const recipients = uniqueRecipientIds(input.recipients, input.excludeUserId)
  if (recipients.length === 0) {
    return { next: existing, created: 0, updated: 0 }
  }

  const createdAt = nowIso()
  const icon = input.icon || defaultNotifIcon(input.type)
  let next = [...existing]
  let created = 0
  let updated = 0

  for (const userId of recipients) {
    if (input.entityKey) {
      const dupIdx = next.findIndex(
        n => n.userId === userId && n.entityKey === input.entityKey && !n.read,
      )
      if (dupIdx >= 0) {
        next[dupIdx] = {
          ...next[dupIdx],
          title: input.title,
          body: input.body,
          module: input.module ?? next[dupIdx].module,
          path: input.path ?? next[dupIdx].path,
          icon,
          type: input.type,
          createdAt,
        }
        updated += 1
        continue
      }
    }

    next.unshift({
      id: makeId(),
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      module: input.module,
      path: input.path,
      icon,
      entityKey: input.entityKey,
      read: false,
      readAt: null,
      createdAt,
    })
    created += 1
  }

  return { next, created, updated }
}

export function markNotificationReadInList(
  list: AppNotification[],
  id: string,
  readAtIso: string = new Date().toISOString(),
): AppNotification[] {
  return list.map(n => {
    if (n.id !== id) return n
    if (n.read && n.readAt) return n
    return { ...n, read: true, readAt: n.readAt || readAtIso }
  })
}

export function markAllNotificationsReadForUser(
  list: AppNotification[],
  userId: string,
  readAtIso: string = new Date().toISOString(),
): AppNotification[] {
  return list.map(n => {
    if (n.userId !== userId) return n
    if (n.read && n.readAt) return n
    return { ...n, read: true, readAt: n.readAt || readAtIso }
  })
}

/** Remove read notifications for one user only (Clear read). */
export function clearReadNotificationsForUser(
  list: AppNotification[],
  userId: string,
): AppNotification[] {
  return list.filter(n => !(n.userId === userId && n.read))
}
