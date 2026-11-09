import 'server-only'

// Chat events for a user, announced by lib/chat/chat.server.ts with
// pg_notify('deed_chat_changed', payload): a plain user id for "something
// changed" (new message, read, group change), or JSON
// {"to": userId, "kind": "typing", "conversationId", "from"}. Same pattern as
// lib/notifications/realtime.ts.
import { Client } from 'pg'

export type ChatEvent = { kind: 'changed' } | { kind: 'typing'; conversationId: string; from: string }
type Listener = { userId: string; fn: (event: ChatEvent) => void }
type State = {
  listeners: Set<Listener>
  client: Client | null
  connecting: boolean
  reconnectDelayMs: number
}

const g = globalThis as unknown as { __chatNotify?: State }
const state = g.__chatNotify ?? (g.__chatNotify = {
  listeners: new Set(),
  client: null,
  connecting: false,
  reconnectDelayMs: 1000,
})

function parse(payload: string): { to: string; event: ChatEvent } {
  if (payload.startsWith('{')) {
    try {
      const p = JSON.parse(payload) as { to?: string; kind?: string; conversationId?: string; from?: string }
      if (p.kind === 'typing' && p.to && p.conversationId && p.from) {
        return { to: String(p.to), event: { kind: 'typing', conversationId: String(p.conversationId), from: String(p.from) } }
      }
      return { to: String(p.to ?? ''), event: { kind: 'changed' } }
    } catch { /* a plain id below */ }
  }
  return { to: payload, event: { kind: 'changed' } }
}

function fanOut(payload?: string) {
  const { to, event } = parse(payload ?? '')
  for (const listener of state.listeners) {
    if (to && to !== listener.userId) continue
    try { listener.fn(event) } catch {}
  }
}

function scheduleReconnect() {
  const dead = state.client
  state.client = null
  if (dead) {
    dead.removeAllListeners()
    dead.end().catch(() => {})
  }
  const delay = state.reconnectDelayMs
  state.reconnectDelayMs = Math.min(delay * 2, 30_000)
  setTimeout(() => { void connect() }, delay)
}

async function connect() {
  if (state.client || state.connecting) return
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!connectionString) return
  state.connecting = true
  try {
    const client = new Client({ connectionString, ssl: false })
    client.on('error', scheduleReconnect)
    client.on('end', scheduleReconnect)
    client.on('notification', msg => fanOut(msg.payload || ''))
    await client.connect()
    await client.query('LISTEN deed_chat_changed')
    state.client = client
    state.reconnectDelayMs = 1000
  } catch {
    scheduleReconnect()
  } finally {
    state.connecting = false
  }
}

export function subscribeChatChanges(userId: string, fn: (event: ChatEvent) => void) {
  const listener = { userId, fn }
  state.listeners.add(listener)
  void connect()
  return () => state.listeners.delete(listener)
}
