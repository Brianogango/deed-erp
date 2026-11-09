import 'server-only'
import { randomUUID } from 'node:crypto'
import { sql } from '@/lib/auth/db'

/**
 * Internal chat: one-to-one and group conversations between ERP users, with
 * text, a linked record (repair, quote, invoice…) and a photo or file.
 *
 * Every read and write checks membership here, so the routes stay thin. A
 * change is announced on Postgres NOTIFY `deed_chat_changed` with the user id
 * of each member (lib/chat/realtime.server.ts), which reaches both workers.
 */

export type ChatRecordLink = { type: string; id: string; title: string; subtitle?: string; href: string }
export type ChatAttachment = { key: string; name: string; contentType: string; size: number }

export type ChatMessage = {
  id: string
  conversationId: string
  senderId: string
  body: string
  record: ChatRecordLink | null
  attachment: Omit<ChatAttachment, 'key'> | null
  createdAt: string
  deleted: boolean
}

export type ChatConversation = {
  id: string
  kind: 'direct' | 'group'
  name: string | null
  createdBy: string
  memberIds: string[]
  admins: string[]
  /** When each member last read the conversation (read ticks). */
  readAt: Record<string, string>
  lastMessageAt: string
  lastMessage: { senderId: string; preview: string; createdAt: string } | null
  unread: number
}

export const CHAT_LIMITS = { body: 4000, groupName: 80, groupMembers: 60, fileBytes: 10 * 1024 * 1024 }

let ready: Promise<void> | null = null

/** The tables, created on first use (also in database/migrations/20261110_internal_chat.sql). */
export function ensureChatTables(): Promise<void> {
  if (ready && process.env.NODE_ENV !== 'test') return ready
  ready = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
        name TEXT,
        direct_key TEXT UNIQUE,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`
      CREATE TABLE IF NOT EXISTS chat_members (
        conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_read_at TIMESTAMPTZ,
        PRIMARY KEY (conversation_id, user_id)
      )`
    await sql`CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members (user_id)`
    await sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        record JSONB,
        attachment JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )`
    await sql`CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages (conversation_id, created_at)`
    // Last time each person had the chat connection open ("online" / "last seen").
    await sql`CREATE TABLE IF NOT EXISTS chat_presence (user_id TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  })().catch(err => { ready = null; throw err })
  return ready
}

export class ChatError extends Error {
  status: number
  expose = true
  constructor(message: string, status = 400) { super(message); this.status = status }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''))

async function notifyMembers(userIds: string[]) {
  for (const id of new Set(userIds)) {
    await sql`SELECT pg_notify('deed_chat_changed', ${id})`.catch(() => null)
  }
}

async function memberIdsOf(conversationId: string): Promise<string[]> {
  const { rows } = await sql`SELECT user_id FROM chat_members WHERE conversation_id = ${conversationId}`
  return rows.map(r => String(r.user_id))
}

/** The conversation, or a 404 when the user is not in it (it is not revealed to exist). */
export async function requireMember(conversationId: string, userId: string): Promise<{ kind: string; role: string; createdBy: string }> {
  await ensureChatTables()
  const { rows } = await sql`
    SELECT c.kind, c.created_by, m.role FROM chat_conversations c
    JOIN chat_members m ON m.conversation_id = c.id AND m.user_id = ${userId}
    WHERE c.id = ${conversationId}`
  if (!rows.length) throw new ChatError('Conversation not found', 404)
  return { kind: String(rows[0].kind), role: String(rows[0].role), createdBy: String(rows[0].created_by) }
}

export async function listConversations(userId: string): Promise<ChatConversation[]> {
  await ensureChatTables()
  const { rows } = await sql`
    SELECT c.id, c.kind, c.name, c.created_by, c.last_message_at,
      (SELECT json_agg(json_build_object('id', mm.user_id, 'role', mm.role, 'readAt', mm.last_read_at)) FROM chat_members mm WHERE mm.conversation_id = c.id) AS members,
      (SELECT json_build_object('senderId', lm.sender_id, 'body', lm.body, 'deleted', lm.deleted_at IS NOT NULL,
              'hasFile', lm.attachment IS NOT NULL, 'hasRecord', lm.record IS NOT NULL, 'createdAt', lm.created_at)
         FROM chat_messages lm WHERE lm.conversation_id = c.id ORDER BY lm.created_at DESC LIMIT 1) AS last,
      (SELECT count(*) FROM chat_messages um
         WHERE um.conversation_id = c.id AND um.sender_id <> ${userId} AND um.deleted_at IS NULL
           AND um.created_at > coalesce(me.last_read_at, me.joined_at - interval '1 second'))::int AS unread
    FROM chat_conversations c
    JOIN chat_members me ON me.conversation_id = c.id AND me.user_id = ${userId}
    ORDER BY c.last_message_at DESC
    LIMIT 200`
  return rows.map(r => {
    const members = (Array.isArray(r.members) ? r.members : []) as Array<{ id: string; role: string; readAt: string | null }>
    const last = r.last as null | { senderId: string; body: string; deleted: boolean; hasFile: boolean; hasRecord: boolean; createdAt: string }
    const preview = !last ? '' : last.deleted ? 'Message deleted' : last.body?.trim() ? last.body.trim().slice(0, 120) : last.hasFile ? '📎 File' : last.hasRecord ? '🔗 Linked record' : ''
    return {
      id: String(r.id),
      kind: r.kind === 'group' ? 'group' : 'direct',
      name: r.name ? String(r.name) : null,
      createdBy: String(r.created_by),
      memberIds: members.map(m => String(m.id)),
      admins: members.filter(m => m.role === 'admin').map(m => String(m.id)),
      readAt: Object.fromEntries(members.filter(m => m.readAt).map(m => [String(m.id), iso(m.readAt)])),
      lastMessageAt: iso(r.last_message_at),
      lastMessage: last ? { senderId: String(last.senderId), preview, createdAt: iso(last.createdAt) } : null,
      unread: Number(r.unread) || 0,
    }
  })
}

/** The direct conversation between two people: found, or started. */
export async function openDirect(userId: string, otherId: string): Promise<string> {
  await ensureChatTables()
  if (!otherId || otherId === userId) throw new ChatError('Choose someone else to chat with')
  const key = [userId, otherId].sort().join(':')
  const found = await sql`SELECT id FROM chat_conversations WHERE direct_key = ${key}`
  if (found.rows.length) return String(found.rows[0].id)
  const id = randomUUID()
  const inserted = await sql`
    INSERT INTO chat_conversations (id, kind, direct_key, created_by) VALUES (${id}, 'direct', ${key}, ${userId})
    ON CONFLICT (direct_key) DO NOTHING RETURNING id`
  if (!inserted.rows.length) {
    const again = await sql`SELECT id FROM chat_conversations WHERE direct_key = ${key}`
    return String(again.rows[0].id)
  }
  await sql`INSERT INTO chat_members (conversation_id, user_id, role) VALUES (${id}, ${userId}, 'member'), (${id}, ${otherId}, 'member') ON CONFLICT DO NOTHING`
  return id
}

export async function createGroup(userId: string, name: string, memberIds: string[]): Promise<string> {
  await ensureChatTables()
  const title = String(name ?? '').trim().slice(0, CHAT_LIMITS.groupName)
  if (title.length < 2) throw new ChatError('Give the group a name')
  const members = [...new Set([userId, ...memberIds.map(String).filter(Boolean)])]
  if (members.length < 2) throw new ChatError('Add at least one other person')
  if (members.length > CHAT_LIMITS.groupMembers) throw new ChatError(`A group can have up to ${CHAT_LIMITS.groupMembers} people`)
  const id = randomUUID()
  await sql`INSERT INTO chat_conversations (id, kind, name, created_by) VALUES (${id}, 'group', ${title}, ${userId})`
  for (const m of members) {
    await sql`INSERT INTO chat_members (conversation_id, user_id, role) VALUES (${id}, ${m}, ${m === userId ? 'admin' : 'member'}) ON CONFLICT DO NOTHING`
  }
  await notifyMembers(members)
  return id
}

/** Rename, add or remove people (group admins), or leave (anyone). */
export async function updateGroup(userId: string, conversationId: string, change: { name?: string; add?: string[]; remove?: string; leave?: boolean }): Promise<void> {
  const me = await requireMember(conversationId, userId)
  if (me.kind !== 'group') throw new ChatError('Only groups can be changed')
  const before = await memberIdsOf(conversationId)
  if (change.leave) {
    await sql`DELETE FROM chat_members WHERE conversation_id = ${conversationId} AND user_id = ${userId}`
    // A group without an admin hands it to the longest-standing member.
    const admins = await sql`SELECT 1 FROM chat_members WHERE conversation_id = ${conversationId} AND role = 'admin'`
    if (!admins.rows.length) {
      await sql`UPDATE chat_members SET role = 'admin' WHERE conversation_id = ${conversationId} AND user_id =
        (SELECT user_id FROM chat_members WHERE conversation_id = ${conversationId} ORDER BY joined_at LIMIT 1)`
    }
    await notifyMembers(before)
    return
  }
  if (me.role !== 'admin') throw new ChatError('Only the group admin can change the group', 403)
  if (change.name !== undefined) {
    const title = String(change.name).trim().slice(0, CHAT_LIMITS.groupName)
    if (title.length < 2) throw new ChatError('Give the group a name')
    await sql`UPDATE chat_conversations SET name = ${title} WHERE id = ${conversationId}`
  }
  if (change.add?.length) {
    if (before.length + change.add.length > CHAT_LIMITS.groupMembers) throw new ChatError(`A group can have up to ${CHAT_LIMITS.groupMembers} people`)
    for (const m of change.add.map(String).filter(Boolean)) {
      await sql`INSERT INTO chat_members (conversation_id, user_id, role, last_read_at) VALUES (${conversationId}, ${m}, 'member', now()) ON CONFLICT DO NOTHING`
    }
  }
  if (change.remove && change.remove !== userId) {
    await sql`DELETE FROM chat_members WHERE conversation_id = ${conversationId} AND user_id = ${change.remove}`
  }
  await notifyMembers([...before, ...(change.add ?? [])])
}

function toMessage(r: Record<string, unknown>): ChatMessage {
  const deleted = r.deleted_at != null
  const att = r.attachment as ChatAttachment | null
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    senderId: String(r.sender_id),
    body: deleted ? '' : String(r.body ?? ''),
    record: deleted ? null : (r.record as ChatRecordLink | null) ?? null,
    attachment: deleted || !att ? null : { name: att.name, contentType: att.contentType, size: att.size },
    createdAt: iso(r.created_at),
    deleted,
  }
}

/** Newest messages first-loaded; `before` pages back, `after` fetches what is new. */
export async function listMessages(userId: string, conversationId: string, opts: { before?: string; after?: string; limit?: number } = {}): Promise<ChatMessage[]> {
  await requireMember(conversationId, userId)
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50))
  if (opts.after) {
    const { rows } = await sql`SELECT * FROM chat_messages WHERE conversation_id = ${conversationId} AND created_at > ${opts.after}::timestamptz ORDER BY created_at ASC LIMIT 200`
    return rows.map(toMessage)
  }
  const { rows } = opts.before
    ? await sql`SELECT * FROM chat_messages WHERE conversation_id = ${conversationId} AND created_at < ${opts.before}::timestamptz ORDER BY created_at DESC LIMIT ${limit}`
    : await sql`SELECT * FROM chat_messages WHERE conversation_id = ${conversationId} ORDER BY created_at DESC LIMIT ${limit}`
  return rows.map(toMessage).reverse()
}

export async function sendMessage(userId: string, conversationId: string, input: { body?: string; record?: ChatRecordLink | null; attachment?: ChatAttachment | null }): Promise<ChatMessage> {
  await requireMember(conversationId, userId)
  const body = String(input.body ?? '').replace(/\r\n/g, '\n').trim()
  if (body.length > CHAT_LIMITS.body) throw new ChatError(`Messages can be up to ${CHAT_LIMITS.body} characters`)
  const record = input.record && typeof input.record === 'object' && String(input.record.href ?? '').startsWith('/')
    ? {
        type: String(input.record.type ?? '').slice(0, 40),
        id: String(input.record.id ?? '').slice(0, 80),
        title: String(input.record.title ?? '').slice(0, 160),
        subtitle: String(input.record.subtitle ?? '').slice(0, 200),
        href: String(input.record.href).slice(0, 300),
      }
    : null
  if (!body && !record && !input.attachment) throw new ChatError('Type a message, link a record or attach a file')
  const id = randomUUID()
  const { rows } = await sql`
    INSERT INTO chat_messages (id, conversation_id, sender_id, body, record, attachment)
    VALUES (${id}, ${conversationId}, ${userId}, ${body}, ${record ? JSON.stringify(record) : null}::jsonb, ${input.attachment ? JSON.stringify(input.attachment) : null}::jsonb)
    RETURNING *`
  await sql`UPDATE chat_conversations SET last_message_at = now() WHERE id = ${conversationId}`
  await sql`UPDATE chat_members SET last_read_at = now() WHERE conversation_id = ${conversationId} AND user_id = ${userId}`
  await notifyMembers(await memberIdsOf(conversationId))
  return toMessage(rows[0])
}

export async function markRead(userId: string, conversationId: string): Promise<void> {
  await requireMember(conversationId, userId)
  // Only when something was unread, and only then announced: an announcement
  // makes open screens reload, which must not read (and announce) again.
  const { rows } = await sql`
    UPDATE chat_members SET last_read_at = now()
    WHERE conversation_id = ${conversationId} AND user_id = ${userId}
      AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = ${conversationId} AND m.sender_id <> ${userId}
                  AND m.created_at > coalesce(chat_members.last_read_at, chat_members.joined_at - interval '1 second'))
    RETURNING user_id`
  // Everyone in it: the senders' ticks turn blue.
  if (rows.length) await notifyMembers(await memberIdsOf(conversationId))
}

/** "Typing…" to the other members — sent live, never stored. */
export async function notifyTyping(userId: string, conversationId: string): Promise<void> {
  await requireMember(conversationId, userId)
  for (const to of await memberIdsOf(conversationId)) {
    if (to === userId) continue
    await sql`SELECT pg_notify('deed_chat_changed', ${JSON.stringify({ to, kind: 'typing', conversationId, from: userId })})`.catch(() => null)
  }
}

export async function touchPresence(userId: string): Promise<void> {
  await ensureChatTables()
  await sql`INSERT INTO chat_presence (user_id, last_seen_at) VALUES (${userId}, now())
    ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`
}

/** Last seen per user (only those who have opened the chat). */
export async function presenceMap(): Promise<Record<string, string>> {
  await ensureChatTables()
  const { rows } = await sql`SELECT user_id, last_seen_at FROM chat_presence`
  return Object.fromEntries(rows.map(r => [String(r.user_id), iso(r.last_seen_at)]))
}

/** Delete one's own message (the text, link and file are removed; "Message deleted" stays). */
export async function deleteMessage(userId: string, messageId: string): Promise<{ attachmentKey: string | null }> {
  await ensureChatTables()
  const { rows } = await sql`SELECT conversation_id, sender_id, attachment FROM chat_messages WHERE id = ${messageId} AND deleted_at IS NULL`
  if (!rows.length) throw new ChatError('Message not found', 404)
  await requireMember(String(rows[0].conversation_id), userId)
  if (String(rows[0].sender_id) !== userId) throw new ChatError('You can only delete your own messages', 403)
  await sql`UPDATE chat_messages SET deleted_at = now(), body = '', record = NULL, attachment = NULL WHERE id = ${messageId}`
  await notifyMembers(await memberIdsOf(String(rows[0].conversation_id)))
  const att = rows[0].attachment as ChatAttachment | null
  return { attachmentKey: att?.key ?? null }
}

/** The stored file behind a message, for a member of its conversation. */
export async function attachmentFor(userId: string, messageId: string): Promise<ChatAttachment> {
  await ensureChatTables()
  const { rows } = await sql`SELECT conversation_id, attachment FROM chat_messages WHERE id = ${messageId} AND deleted_at IS NULL`
  if (!rows.length || !rows[0].attachment) throw new ChatError('File not found', 404)
  await requireMember(String(rows[0].conversation_id), userId)
  return rows[0].attachment as ChatAttachment
}
