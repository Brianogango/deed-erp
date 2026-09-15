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
  connectPromise: Promise<void> | null
  reconnectDelayMs: number
}

// Survives Next.js dev-mode HMR module reloads; in production it simply makes
// the state a per-process singleton.
const g = globalThis as unknown as { __appStateNotify?: NotifyState }
const state: NotifyState =
  g.__appStateNotify ?? (g.__appStateNotify = {
    listeners: new Set(),
    client: null,
    connectPromise: null,
    reconnectDelayMs: 1_000,
  })

const NOTIFY_TRIGGER_NAME = 'app_state_notify_trigger'
const TRIGGER_CHECK_TTL_MS = 60_000

let triggerPresent: boolean | null = null
let triggerCheckedAt = 0

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
  if (state.client) return
  if (state.connectPromise) return state.connectPromise
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!connectionString) return

  const attempt = (async () => {
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
      if (state.connectPromise === attempt) state.connectPromise = null
    }
  })()

  state.connectPromise = attempt
  return attempt
}

async function hasNotifyTrigger(): Promise<boolean | null> {
  if (!state.client) return false
  if (triggerPresent != null && Date.now() - triggerCheckedAt < TRIGGER_CHECK_TTL_MS) {
    return triggerPresent
  }
  try {
    const res = await state.client.query(
      `SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = $1 LIMIT 1`,
      [NOTIFY_TRIGGER_NAME],
    )
    triggerPresent = (res.rowCount ?? res.rows.length) > 0
    triggerCheckedAt = Date.now()
    return triggerPresent
  } catch {
    return null
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

/**
 * True when this process is LISTENing and the app_state notify trigger exists.
 * A connected socket with no trigger still leaves every tab on the fallback
 * poll, so the SSE hello treats that as "not live" and clients poll faster.
 */
export async function getStoreNotifyLive(): Promise<boolean> {
  await connect()
  if (!state.client) return false
  const present = await hasNotifyTrigger()
  // Catalog lookup failed — LISTEN itself is up, so do not force backup polling.
  return present !== false
}
