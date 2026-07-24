export type UxEventType =
  | 'search_open'
  | 'search_navigate'
  | 'notification_open'
  | 'account_panel_open'
  | 'table_density_change'
  | 'module_pin_toggle'
  | 'sidebar_group_toggle'
  | 'form_autosave'
  | 'task_complete'
  | 'task_abandon'
  | 'error'

export type UxEvent = {
  id: string
  type: UxEventType
  at: string
  meta?: Record<string, unknown>
}

const UX_EVENTS_KEY = 'deed_ux_events'
const UX_TIMER_KEY = 'deed_ux_timer'
const MAX_EVENTS = 500

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

function readEvents(): UxEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(UX_EVENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeEvents(events: UxEvent[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UX_EVENTS_KEY, JSON.stringify(events.slice(-MAX_EVENTS)))
  } catch {
    // best effort only
  }
}

export function trackUxEvent(type: UxEventType, meta?: Record<string, unknown>) {
  const event: UxEvent = { id: uid(), type, at: new Date().toISOString(), meta }
  const next = [...readEvents(), event]
  writeEvents(next)
}

export function startUxTask(taskName: string, context?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UX_TIMER_KEY, JSON.stringify({
      taskName,
      startedAt: Date.now(),
      context: context ?? {},
    }))
  } catch {
    // best effort only
  }
}

export function finishUxTask(status: 'success' | 'abandon' | 'error', extras?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(UX_TIMER_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { taskName?: string; startedAt?: number; context?: Record<string, unknown> }
    const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now()
    const durationMs = Math.max(0, Date.now() - startedAt)
    trackUxEvent(status === 'success' ? 'task_complete' : status === 'abandon' ? 'task_abandon' : 'error', {
      taskName: parsed.taskName ?? 'unknown',
      durationMs,
      ...(parsed.context ?? {}),
      ...(extras ?? {}),
    })
    window.localStorage.removeItem(UX_TIMER_KEY)
  } catch {
    // best effort only
  }
}
