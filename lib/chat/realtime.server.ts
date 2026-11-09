import 'server-only'

// Chat changes for a user (new message, read, group change), announced with
// pg_notify('deed_chat_changed', userId) by lib/chat/chat.server.ts. Same
// pattern as lib/notifications/realtime.ts.
import { Client } from 'pg'

type Listener = { userId: string; fn: () => void }
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

function fanOut(payload?: string) {
  for (const listener of state.listeners) {
    if (payload && payload !== listener.userId) continue
    try { listener.fn() } catch {}
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

export function subscribeChatChanges(userId: string, fn: () => void) {
  const listener = { userId, fn }
  state.listeners.add(listener)
  void connect()
  return () => state.listeners.delete(listener)
}
