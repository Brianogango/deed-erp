import 'server-only'
import { loadAppState, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import type { RepairMessage } from '@/lib/portal-repairs'

/**
 * Durable storage for portal customer ↔ staff messages.
 *
 * These lived in a plain module-level Map that was never persisted and, unlike
 * the repair registry beside it, never even pinned to `global`. Every deploy
 * and every PM2 restart silently emptied every thread — and this process has
 * restarted 21 times. Threads now live in app_state, like approval decisions.
 */

export const MAX_MESSAGE_LENGTH = 4_000
const MAX_MESSAGES_PER_REPAIR = 500

function normaliseRef(ref: string) {
  return decodeURIComponent(ref).toUpperCase()
}

function messagesStateKey(ref: string) {
  return `portal_messages_${normaliseRef(ref).replace(/\//g, '_')}`
}

/**
 * Repairs with client messages nobody on staff has opened yet:
 * ref → { count, lastAt, lastText }. Kept beside the threads so the repairs
 * list can flag them without reading every thread. A staff reply or a staff
 * read clears the entry.
 */
const UNREAD_KEY = 'portal_messages_unread'
export type UnreadClientMessages = Record<string, { count: number; lastAt: string; lastText: string; senderName?: string }>

async function updateUnread(change: (index: UnreadClientMessages) => UnreadClientMessages | null) {
  await withAppStateKeyLock(UNREAD_KEY, async () => {
    const state = await loadAppState([UNREAD_KEY])
    const current = (state[UNREAD_KEY] && typeof state[UNREAD_KEY] === 'object' ? state[UNREAD_KEY] : {}) as UnreadClientMessages
    const next = change({ ...current })
    if (next) await saveStoreKeys({ [UNREAD_KEY]: JSON.stringify(next) })
  })
}

export async function getUnreadClientMessages(): Promise<UnreadClientMessages> {
  const state = await loadAppState([UNREAD_KEY])
  const index = state[UNREAD_KEY]
  return index && typeof index === 'object' && !Array.isArray(index) ? index as UnreadClientMessages : {}
}

export async function getMessagesStored(ref: string): Promise<RepairMessage[]> {
  const key = messagesStateKey(ref)
  const state = await loadAppState([key])
  const rows = state[key]
  return Array.isArray(rows) ? rows as RepairMessage[] : []
}

export async function addMessageStored(
  ref: string,
  msg: Omit<RepairMessage, 'id' | 'repairRef'>,
): Promise<RepairMessage> {
  const key = messagesStateKey(ref)
  const message: RepairMessage = {
    ...msg,
    text: String(msg.text ?? '').slice(0, MAX_MESSAGE_LENGTH),
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    repairRef: decodeURIComponent(ref),
  }
  // Serialize the read-modify-write so two people typing at once cannot drop
  // one another's message.
  await withAppStateKeyLock(key, async () => {
    const state = await loadAppState([key])
    const existing = Array.isArray(state[key]) ? state[key] as RepairMessage[] : []
    const next = [...existing, message].slice(-MAX_MESSAGES_PER_REPAIR)
    await saveStoreKeys({ [key]: JSON.stringify(next) })
  })
  const unreadRef = normaliseRef(ref)
  await updateUnread(index => {
    if (message.sender === 'customer') {
      const was = index[unreadRef]
      index[unreadRef] = { count: (was?.count ?? 0) + 1, lastAt: message.timestamp, lastText: message.text.slice(0, 140), senderName: message.senderName }
      return index
    }
    // Staff answered: handled.
    if (!index[unreadRef]) return null
    delete index[unreadRef]
    return index
  }).catch(err => console.error('[portal messages] unread index:', err))
  return message
}

export async function markMessagesReadStored(ref: string, byRole: 'customer' | 'staff'): Promise<void> {
  const key = messagesStateKey(ref)
  await withAppStateKeyLock(key, async () => {
    const state = await loadAppState([key])
    const existing = Array.isArray(state[key]) ? state[key] as RepairMessage[] : []
    if (!existing.length) return
    const next = existing.map(m => (m.sender !== byRole && !m.read ? { ...m, read: true } : m))
    if (next.some((m, i) => m !== existing[i])) {
      await saveStoreKeys({ [key]: JSON.stringify(next) })
    }
  })
  if (byRole === 'staff') {
    const unreadRef = normaliseRef(ref)
    await updateUnread(index => {
      if (!index[unreadRef]) return null
      delete index[unreadRef]
      return index
    }).catch(err => console.error('[portal messages] unread index:', err))
  }
}
