'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface PopupNotification {
  id: string
  title: string
  body: string
  icon?: string
  read: boolean
  createdAt: string
  severity?: 'info' | 'success' | 'attention' | 'warning' | 'critical'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  module?: string
  path?: string
}

/** Pop-ups appear only for notifications that arrived this recently, so a reload or reconnect never replays old ones. */
export const POPUP_MAX_AGE_MS = 2 * 60 * 1000
export const POPUP_MAX_VISIBLE = 3
export const POPUP_AUTO_DISMISS_MS = 10_000

const PREF_KEY = 'deed-popups'

/** Per-device preference; on by default. */
export function usePopupPreference(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    try { if (localStorage.getItem(PREF_KEY) === 'false') setEnabled(false) } catch { /* private mode */ }
  }, [])
  const set = useCallback((value: boolean) => {
    setEnabled(value)
    try { localStorage.setItem(PREF_KEY, String(value)) } catch { /* private mode */ }
  }, [])
  return [enabled, set]
}

/** True when a pop-up should stay on screen until the person acts on it. */
export function isSticky(n: Pick<PopupNotification, 'severity' | 'priority'>): boolean {
  return n.severity === 'critical' || n.priority === 'urgent'
}

/** Which of `notifications` deserve a new pop-up: unread, recent, and not shown before. */
export function selectNewPopups<T extends PopupNotification>(notifications: T[], seen: Set<string>, now: number): T[] {
  return notifications
    .filter(n => !n.read && !seen.has(n.id) && now - new Date(n.createdAt).getTime() <= POPUP_MAX_AGE_MS)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

/**
 * In-app pop-up alerts for new notifications. The bell badge keeps counting
 * unread items; this is the immediate heads-up with the action to take.
 */
export default function NotificationPopups({ notifications, enabled, onView }: {
  notifications: PopupNotification[]
  enabled: boolean
  onView: (n: PopupNotification) => void
}) {
  const seen = useRef<Set<string>>(new Set())
  const [items, setItems] = useState<PopupNotification[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  const arm = useCallback((n: PopupNotification) => {
    if (isSticky(n)) return
    const existing = timers.current.get(n.id)
    if (existing) clearTimeout(existing)
    timers.current.set(n.id, setTimeout(() => dismiss(n.id), POPUP_AUTO_DISMISS_MS))
  }, [dismiss])

  useEffect(() => {
    const fresh = selectNewPopups(notifications, seen.current, Date.now())
    // Remember everything we have looked at so nothing pops twice, shown or not.
    for (const n of notifications) seen.current.add(n.id)
    if (!enabled || fresh.length === 0) return
    setItems(prev => [...[...fresh].reverse(), ...prev].slice(0, POPUP_MAX_VISIBLE))
    fresh.forEach(arm)
  }, [notifications, enabled, arm])

  // A notification read elsewhere (the bell, another tab) no longer needs its pop-up.
  useEffect(() => {
    const unreadIds = new Set(notifications.filter(n => !n.read).map(n => n.id))
    setItems(prev => {
      const next = prev.filter(i => unreadIds.has(i.id))
      return next.length === prev.length ? prev : next
    })
  }, [notifications])

  useEffect(() => () => { timers.current.forEach(t => clearTimeout(t)) }, [])

  if (items.length === 0) return null
  return (
    <div className="notification-popups" aria-live="polite">
      {items.map(n => (
        <div
          key={n.id}
          className={`notification-popup${isSticky(n) ? ' notification-popup--urgent' : ''}`}
          role={isSticky(n) ? 'alert' : 'status'}
          onMouseEnter={() => { const t = timers.current.get(n.id); if (t) { clearTimeout(t); timers.current.delete(n.id) } }}
          onMouseLeave={() => arm(n)}
        >
          <div className="notification-popup__icon" aria-hidden="true">{n.icon || '🔔'}</div>
          <div className="notification-popup__body">
            <p className="notification-popup__title">{n.title}</p>
            {n.body && <p className="notification-popup__text">{n.body}</p>}
            <div className="notification-popup__actions">
              <button type="button" className="notification-popup__btn notification-popup__btn--primary" onClick={() => { onView(n); dismiss(n.id) }}>View</button>
              <button type="button" className="notification-popup__btn" onClick={() => dismiss(n.id)}>Dismiss</button>
            </div>
          </div>
          <button type="button" className="notification-popup__close" aria-label="Dismiss notification" onClick={() => dismiss(n.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
