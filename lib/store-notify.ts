import 'server-only'
import { Client } from 'pg'

// Postgres LISTEN/NOTIFY fan-out for app_state changes. A trigger on app_state
// (database/migrations/20260709_app_state_notify.sql) fires pg_notify on every
// insert/update; this module keeps ONE dedicated connection per Node process in
// LISTEN mode and wakes every subscribed SSE stream immediately, so connected
// clients receive changes in near real-time instead of on the next poll tick.

type Listener = () => void

type NotifyState = {
  listeners: Set<Listener>
  client: Client | null
  connecting: boolean
  reconnectDelayMs: number
}

// Survives Next.js dev-mode HMR module reloads; in production it simply makes
// the state a per-process singleton.
const g = globalThis as unknown as { __appStateNotify?: NotifyState }
const state: NotifyState =
  g.__appStateNotify ?? (g.__appStateNotify = { listeners: new Set(), client: null, connecting: false, reconnectDelayMs: 1_000 })

function fanOut() {
  for (const listener of state.listeners) {
    try { listener() } catch { /* one bad subscriber must not break the rest */ }
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

async function connect(): Promise<void> {
  if (state.client || state.connecting) return
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!connectionString) return
  state.connecting = true
  try {
    const client = new Client({ connectionString, ssl: false })
    client.on('error', scheduleReconnect)
    client.on('end', scheduleReconnect)
    client.on('notification', fanOut)
    await client.connect()
    await client.query('LISTEN app_state_changed')
    state.client = client
    state.reconnectDelayMs = 1_000
  } catch {
    scheduleReconnect()
  } finally {
    state.connecting = false
  }
}

/**
 * Subscribe to "app_state changed" wake-ups. Returns an unsubscribe function.
 * Subscribers should treat the callback as a hint to re-check for changes (the
 * SSE stream already tracks its own updated_at cursor), not as a payload.
 */
export function subscribeAppStateChanges(listener: Listener): () => void {
  state.listeners.add(listener)
  void connect()
  return () => { state.listeners.delete(listener) }
}
