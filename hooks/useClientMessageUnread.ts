'use client'

import { useEffect, useState } from 'react'
import { startVisiblePoll } from '@/lib/visible-poll'

export type ClientMessageUnread = Record<string, { count: number; lastAt: string; lastText: string; senderName?: string }>

/**
 * Repairs whose client has written and nobody on staff has opened the chat
 * since (keyed by repair ref, upper case). Refreshed while the page is open.
 */
export function useClientMessageUnread(enabled = true): ClientMessageUnread {
  const [unread, setUnread] = useState<ClientMessageUnread>({})
  useEffect(() => {
    if (!enabled) return
    return startVisiblePoll(() => {
      fetch('/api/repairs/client-messages', { cache: 'no-store' })
        .then(res => (res.ok ? res.json() : null))
        .then(data => { if (data?.unread && typeof data.unread === 'object') setUnread(data.unread) })
        .catch(() => { /* keep the last copy */ })
    })
  }, [enabled])
  return unread
}

export const unreadFor = (unread: ClientMessageUnread, ref?: string | null) =>
  ref ? unread[String(ref).toUpperCase()] : undefined
