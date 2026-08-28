'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useShellStore, ModuleId, AppNotification, SYNC_STATUS_EVENT, LAST_SYNC_AT_LS, DIRTY_KEYS_LS } from '@/lib/store'
import type { UpdateUserInput } from '@/lib/auth/types'
import { formatRoleLabel, hasModuleAccess, isAdmin as isAdminRole } from '@/lib/auth/access'
import { usePathname, useRouter } from 'next/navigation'
import { readGuardedImageAsDataUrl } from '@/lib/client-image-guard'
import { trackUxEvent } from '@/lib/ux-telemetry'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

const GlobalSearch = dynamic(() => import('./GlobalSearch'), { ssr: false })

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ROUTE_TITLES: Record<string, { label: string; desc: string }> = {
  '/':            { label: 'Dashboard',      desc: 'Business overview' },
  '/dashboard':   { label: 'Dashboard',      desc: 'Business overview' },
  '/sales':       { label: 'Selling · Sales', desc: '' },
  '/crm':         { label: 'CRM',            desc: 'Customers, opportunities & pipeline' },
  '/pos':         { label: 'Point of Sale',  desc: 'Retail till & transactions' },
  '/ecommerce':   { label: 'E-commerce',     desc: 'Online store management' },
  '/kilimall':    { label: 'Kilimall',       desc: 'Kilimall orders & settlements' },
  '/contacts':    { label: 'Contacts',       desc: 'Customers, vendors & staff' },
  '/operations':  { label: 'Operations',     desc: 'Products, stock & fulfillment' },
  '/inventory':   { label: 'Operations',     desc: 'Products, stock & fulfillment' },
  '/purchase':    { label: 'Purchases',      desc: 'Purchase orders & bills' },
  '/purchases':   { label: 'Purchases',      desc: 'Purchase orders & bills' },
  '/delivery':    { label: 'Delivery',       desc: 'Riders & delivery tracking' },
  '/repairs':     { label: 'Repairs',        desc: 'Device repairs & service jobs' },
  '/refurbishment': { label: 'Refurbishment', desc: 'Internal device refurbishing' },
  '/outsource':   { label: 'Outsource',      desc: 'External repair vendors' },
  '/aftersales':  { label: 'After-Sales',    desc: 'Warranties & RMAs' },
  '/after_sales': { label: 'After-Sales',    desc: 'Warranties & RMAs' },
  '/finance':     { label: 'Finance',        desc: 'Accounting, bills & reports' },
  '/accounting':  { label: 'Finance',        desc: 'Accounting, bills & reports' },
  '/cashbook':    { label: 'Cashbook',       desc: 'Cash receipts and payments' },
  '/deposits':    { label: 'Deposits',       desc: 'Customer deposits & layby' },
  '/holdovers':   { label: 'Holdovers',      desc: 'Device loans & temporary issue log' },
  '/property':    { label: 'Property',       desc: 'Office furniture, fittings & equipment' },
  '/expenses':    { label: 'Expenses',       desc: 'Staff expense claims' },
  '/hr':          { label: 'HR',             desc: 'Employees, payroll & time off' },
  '/documents':   { label: 'My Documents',   desc: 'Policies, standards & personal documents' },
  '/sops':        { label: 'KPI Targets',    desc: 'Performance goals and scorecards' },
  '/sop-documents': { label: 'Standards & SOPs', desc: 'Company standards and procedures' },
  '/settings':    { label: 'Settings',       desc: 'System config & user management' },
  '/account':     { label: 'Account Security', desc: 'Password and account settings' },
}

const ROUTE_MODULE: Record<string, ModuleId | 'settings' | null> = {
  '/':               'dashboard',
  '/dashboard':      'dashboard',
  '/sales':          'sales',
  '/crm':            'crm',
  '/pos':            'pos',
  '/ecommerce':      'ecommerce',
  '/kilimall':       'kilimall',
  '/contacts':       'contacts',
  '/operations':     'inventory',
  '/inventory':      'inventory',
  '/purchase':       'purchase',
  '/purchases':      'purchase',
  '/delivery':       'delivery',
  '/repairs':        'repair',
  '/refurbishment':  'refurbishment',
  '/outsource':      'outsource',
  '/aftersales':     'after_sales',
  '/after_sales':    'after_sales',
  '/finance':        'accounting',
  '/accounting':     'accounting',
  '/cashbook':       'accounting',
  '/deposits':       'deposits',
  '/holdovers':      'holdovers',
  '/property':       'company_property',
  '/expenses':       'expenses',
  '/hr':             'hr',
  '/documents':      'my_documents',
  '/sops':           'sops',
  '/sop-documents':  'sop_documents',
  '/settings':       'settings',
  '/account':        null,
  '/login':          null,
  '/portal':         null,
  '/track':          null,
}

const NOTIF_ICONS: Record<AppNotification['type'], string> = {
  assignment: '◈',
  leave:      '◷',
  asset:      '▣',
  expense:    '◎',
  system:     '◉',
  repair:     '◈',
}

type BellNotification = AppNotification & {
  eventId?: string
  eventType?: string
  severity?: 'info' | 'success' | 'attention' | 'warning' | 'critical'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  requiresAcknowledgement?: boolean
  acknowledgedAt?: string | null
  resolvedAt?: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**

/**
 * Sound preference hook with localStorage persistence
 */
function useSoundPreference(): [boolean, (v: boolean) => void] {
  const [sound, setSound] = useState(true)

  useEffect(() => {
    let cancelled = false
    const stored = localStorage.getItem('deed-sound')
    if (stored !== null) setSound(stored === 'true')

    fetch('/api/notifications/preferences', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !data?.global || typeof data.global.soundEnabled !== 'boolean') return
        setSound(data.global.soundEnabled)
        localStorage.setItem('deed-sound', String(data.global.soundEnabled))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const setSoundPersist = useCallback((v: boolean) => {
    setSound(v)
    localStorage.setItem('deed-sound', String(v))
    void fetch('/api/notifications/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: '*', soundEnabled: v }),
    }).catch(() => {})
  }, [])

  return [sound, setSoundPersist]
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Toggle Switch Component
 */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className="toggle-track focus-ring"
      style={{ background: on ? 'var(--primary)' : 'var(--border-strong)' }}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <div className="toggle-thumb" style={{ transform: on ? 'translateX(18px)' : 'translateX(0)' }} />
    </button>
  )
}

/**
 * Format time difference to human-readable string
 */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

type SyncStatus = {
  stage: 'idle' | 'syncing' | 'synced' | 'error' | 'conflict'
  pendingKeys: number
  lastSyncedAt: string | null
  skippedKeys: string[]
  message: string
}

type NotifFilter = 'all' | 'unread' | 'actionable' | 'informational' | 'system'

const FILTER_TABS: { id: NotifFilter; label: string }[] = [
  { id: 'all',           label: 'All' },
  { id: 'unread',        label: 'Unread' },
  { id: 'actionable',    label: 'Actionable' },
  { id: 'informational', label: 'Informational' },
  { id: 'system',        label: 'System' },
]

function notificationCategory(notification: BellNotification): 'actionable' | 'informational' | 'system' {
  if (notification.type === 'system') return 'system'
  if (notification.type === 'asset') return 'informational'
  return 'actionable'
}

function groupByDate(notifs: BellNotification[]): { label: string; items: BellNotification[] }[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const groups: { label: string; items: BellNotification[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const n of notifs) {
    const t = new Date(n.createdAt).getTime()
    if (t >= todayStart) groups[0].items.push(n)
    else if (t >= yesterdayStart) groups[1].items.push(n)
    else groups[2].items.push(n)
  }
  return groups.filter(g => g.items.length > 0)
}

/**
 * Notifications Panel Component
 */
function NotificationsPanel({
  notifs,
  onClose,
  onMarkRead,
  onMarkAll,
  onClearRead,
  onAcknowledge,
  onNavigate,
}: {
  notifs: BellNotification[]
  onClose: () => void
  onMarkRead: (id: string) => void
  onMarkAll: () => void
  onClearRead: () => void
  onAcknowledge: (id: string) => void
  onNavigate: (module: ModuleId, path?: string) => void
}) {
  const [activeFilter, setActiveFilter] = useState<NotifFilter>('all')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const filtered = notifs.filter(n => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'unread') return !n.read
    return notificationCategory(n) === activeFilter
  })

  const unread = notifs.filter(n => !n.read).length
  const readNotifs = notifs.filter(n => n.read)
  const groups = groupByDate(filtered)

  const handleClearRead = () => onClearRead()

  return (
    <div
      ref={panelRef}
      style={{ animation: 'dropdownIn 0.18s ease both' }}
      className="
        fixed top-[60px] right-4 z-[9050]
        w-[min(400px,calc(100vw-32px))] max-h-[calc(100vh-80px)]
        bg-[var(--bg-card)] border border-[var(--border)]
        rounded-2xl shadow-2xl shadow-black/30
        flex flex-col overflow-hidden
      "
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--border-lt)] flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--text-1)] leading-none">Notifications</p>
              <p className="text-[10px] text-[var(--text-4)] mt-0.5">{notifs.length} total · {unread} unread</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {readNotifs.length > 0 && (
              <button
                onClick={handleClearRead}
                className="text-[10px] font-semibold text-[var(--text-3)] hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                title="Remove all read notifications"
              >
                Clear read
              </button>
            )}
            {unread > 0 && (
              <button
                onClick={onMarkAll}
                className="text-[10px] font-bold text-primary-500 hover:text-primary-600 transition-colors bg-primary-500/10 hover:bg-primary-500/20 px-2 py-1 rounded-lg"
              >
                Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {FILTER_TABS.filter(tab => {
            if (tab.id === 'all' || tab.id === 'unread') return true
            return notifs.some(n => notificationCategory(n) === tab.id)
          }).map(tab => {
            const count = tab.id === 'all'
              ? notifs.length
              : tab.id === 'unread'
              ? unread
              : notifs.filter(n => notificationCategory(n) === tab.id).length
            return (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                  activeFilter === tab.id
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'bg-[var(--bg-surface)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-muted)] border border-[var(--border)]'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`rounded-full px-1 min-w-[16px] text-center text-[9px] font-bold ${
                    activeFilter === tab.id ? 'bg-white/20 text-white' : 'bg-[var(--bg-muted)] text-[var(--text-3)]'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="w-14 h-14 rounded-full bg-[var(--bg-surface)] flex items-center justify-center mb-3 border border-[var(--border-lt)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="var(--text-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="var(--text-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-sm font-bold text-[var(--text-1)]">
              {activeFilter === 'unread' ? 'No unread notifications' : 'All caught up!'}
            </p>
            <p className="text-xs text-[var(--text-3)] mt-1.5 leading-relaxed max-w-[200px]">
              {activeFilter === 'all'
                ? 'Assignments, approvals and updates appear here.'
                : `No ${activeFilter} notifications right now.`}
            </p>
          </div>
        ) : (
          <div>
            {groups.map(group => (
              <div key={group.label}>
                <div className="px-4 py-2 sticky top-0 z-10 bg-[var(--bg-surface)]/90 backdrop-blur-sm border-b border-[var(--border-lt)]">
                  <span className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-widest">
                    {group.label}
                  </span>
                </div>
                <div className="divide-y divide-[var(--border-lt)]">
                  {group.items.map(n => (
                    <NotificationItem
                      key={n.id}
                      notification={n}
                      onMarkRead={() => onMarkRead(n.id)}
                      onAcknowledge={() => onAcknowledge(n.id)}
                      onNavigate={() => {
                        if (n.module) onNavigate(n.module, n.path)
                        onClose()
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-[var(--border-lt)] bg-[var(--bg-surface)]/50 flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] text-[var(--text-4)]">
          {filtered.length} {activeFilter === 'unread' ? 'unread' : activeFilter === 'all' ? 'total' : activeFilter}
        </span>
        <button
          onClick={onClose}
          className="text-[10px] font-semibold text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}

/**
 * Individual Notification Item
 */
function NotificationItem({
  notification,
  onMarkRead,
  onAcknowledge,
  onNavigate,
}: {
  notification: BellNotification
  onMarkRead: () => void
  onAcknowledge: () => void
  onNavigate: () => void
}) {
  const category = notificationCategory(notification)
  const whatChanged = (() => {
    const body = notification.body?.trim() ?? ''
    if (!body) return null
    if (body.length <= 140) return body
    return `${body.slice(0, 137)}...`
  })()
  return (
    <div
      onClick={() => {
        onMarkRead()
        onNavigate()
      }}
      className={`
        px-5 py-4 flex gap-4 items-start cursor-pointer
        transition-all duration-200 group
        ${notification.read 
          ? 'hover:bg-[var(--bg-surface)]' 
          : 'bg-primary-500/[0.03] hover:bg-primary-500/[0.06]'
        }
      `}
    >
      {/* Icon */}
      <div className={`
        w-10 h-10 rounded-xl flex-shrink-0 mt-0.5
        flex items-center justify-center text-lg transition-transform duration-200 group-hover:scale-110
        ${notification.read 
          ? 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-3)]' 
          : 'bg-primary-500/10 border border-primary-500/20 text-primary-600'
        }
      `}>
        {notification.icon || NOTIF_ICONS[notification.type]}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`
            text-[13px] leading-snug tracking-tight
            ${notification.read ? 'font-semibold text-[var(--text-2)]' : 'font-bold text-[var(--text-1)]'}
          `}>
            {notification.title}
          </p>
          <span className={`text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
            category === 'actionable'
              ? 'bg-amber-100 text-amber-700'
              : category === 'system'
                ? 'bg-rose-100 text-rose-700'
                : 'bg-slate-100 text-slate-600'
          }`}>
            {category}
          </span>
          {!notification.read && (
            <div className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0 mt-1.5 shadow-sm shadow-primary-500/40" />
          )}
        </div>
        {whatChanged && (
          <p className={`
            text-[12px] leading-relaxed mt-1 line-clamp-2
            ${notification.read ? 'text-[var(--text-3)]' : 'text-[var(--text-2)] font-medium'}
          `}>
            <span className="font-bold">What changed:</span> {whatChanged}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider">
            {timeAgo(notification.createdAt)}
          </span>
          {notification.module && (
            <>
              <span className="w-1 h-1 rounded-full bg-[var(--border)]" />
              <span className="text-[10px] font-bold text-primary-500/70 uppercase tracking-wider">
                {notification.module}
              </span>
            </>
          )}
          {notification.resolvedAt && (
            <span className="text-[9px] font-bold rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700">
              Resolved
            </span>
          )}
        </div>
        {notification.requiresAcknowledgement && !notification.acknowledgedAt && !notification.resolvedAt && (
          <button
            type="button"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onAcknowledge()
            }}
            className="mt-2 inline-flex items-center rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-[10px] font-bold text-white hover:opacity-90"
          >
            Acknowledge
          </button>
        )}
        {notification.acknowledgedAt && !notification.resolvedAt && (
          <span className="mt-2 inline-flex text-[9px] font-bold rounded-full px-2 py-0.5 bg-blue-100 text-blue-700">
            Acknowledged
          </span>
        )}
      </div>
    </div>
  )
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)))
}

type GlobalNotificationPreference = {
  inAppEnabled: boolean
  pushEnabled: boolean
  emailEnabled: boolean
  whatsappEnabled: boolean
  smsEnabled: boolean
  soundEnabled: boolean
  digestEnabled: boolean
  quietStart: string | null
  quietEnd: string | null
  timezone: string
  minimumSeverity: string
}

function NotificationPreferenceControls({
  soundEnabled,
  setSoundEnabled,
}: {
  soundEnabled: boolean
  setSoundEnabled: (v: boolean) => void
}) {
  const [pref, setPref] = useState<GlobalNotificationPreference>({
    inAppEnabled: true,
    pushEnabled: true,
    emailEnabled: true,
    whatsappEnabled: false,
    smsEnabled: false,
    soundEnabled,
    digestEnabled: false,
    quietStart: null,
    quietEnd: null,
    timezone: 'Africa/Nairobi',
    minimumSeverity: 'info',
  })
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushSupported, setPushSupported] = useState(false)

  const load = useCallback(async () => {
    try {
      const [prefRes] = await Promise.all([
        fetch('/api/notifications/preferences', { cache: 'no-store' }),
        fetch('/api/notifications/endpoints', { cache: 'no-store' }),
      ])
      if (prefRes.ok) {
        const data = await prefRes.json()
        if (data?.global) {
          setPref(data.global)
          if (typeof data.global.soundEnabled === 'boolean') setSoundEnabled(data.global.soundEnabled)
        }
      }
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      setPushSupported(supported)
      if (supported) {
        const registration = await navigator.serviceWorker.getRegistration('/deed-notifications-sw.js')
          || await navigator.serviceWorker.getRegistration()
        const sub = await registration?.pushManager.getSubscription()
        setPushSubscribed(Boolean(sub))
      }
    } catch {}
  }, [setSoundEnabled])

  useEffect(() => { void load() }, [load])

  const update = useCallback(async (patch: Partial<GlobalNotificationPreference>) => {
    setPref(prev => ({ ...prev, ...patch }))
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: '*', ...patch }),
      })
      if (!res.ok) throw new Error()
    } catch {
      void load()
    }
  }, [load])

  const setPushForDevice = useCallback(async (enabled: boolean) => {
    if (!pushSupported || pushBusy) return
    setPushBusy(true)
    try {
      const registration = await navigator.serviceWorker.register('/deed-notifications-sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()

      if (!enabled) {
        if (existing) {
          const endpoint = existing.endpoint
          await existing.unsubscribe()
          await fetch('/api/notifications/endpoints', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
          })
        }
        setPushSubscribed(false)
        await update({ pushEnabled: false })
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Browser notification permission was not granted')

      const configRes = await fetch('/api/notifications/endpoints', { cache: 'no-store' })
      const config = await configRes.json()
      if (!configRes.ok || !config.vapidPublicKey) throw new Error('Web Push is not configured on the server')

      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
      })
      const subJson = subscription.toJSON()
      const saveRes = await fetch('/api/notifications/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: subJson.keys,
          deviceLabel: navigator.userAgent.includes('Mobile') ? 'Mobile browser' : 'Desktop browser',
        }),
      })
      if (!saveRes.ok) throw new Error('Could not register this browser for push notifications')
      setPushSubscribed(true)
      await update({ pushEnabled: true })
    } catch (error) {
      console.warn('[notifications] push preference failed', error)
      setPushSubscribed(false)
    } finally {
      setPushBusy(false)
    }
  }, [pushBusy, pushSupported, update])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="text-xs font-medium text-[var(--text-2)]">In-app notifications</label>
          <p className="text-[10px] text-[var(--text-4)]">Bell inbox and real-time ERP alerts</p>
        </div>
        <Toggle on={pref.inAppEnabled} onChange={value => void update({ inAppEnabled: value })} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="text-xs font-medium text-[var(--text-2)]">Browser Push</label>
          <p className="text-[10px] text-[var(--text-4)]">
            {pushSupported ? (pushSubscribed ? 'This browser is subscribed' : 'Notify even when the ERP tab is closed') : 'Not supported by this browser'}
          </p>
        </div>
        <Toggle on={pushSubscribed} onChange={value => void setPushForDevice(value)} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--text-2)]">Email alerts</label>
        <Toggle on={pref.emailEnabled} onChange={value => void update({ emailEnabled: value })} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--text-2)]">WhatsApp alerts</label>
        <Toggle on={pref.whatsappEnabled} onChange={value => void update({ whatsappEnabled: value })} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--text-2)]">SMS alerts</label>
        <Toggle on={pref.smsEnabled} onChange={value => void update({ smsEnabled: value })} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--text-2)]">Sound Alerts</label>
        <Toggle
          on={soundEnabled}
          onChange={value => {
            setSoundEnabled(value)
            void update({ soundEnabled: value })
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <label className="text-[10px] font-semibold text-[var(--text-3)]">
          Quiet from
          <input
            type="time"
            className="form-input mt-1"
            value={pref.quietStart || ''}
            onChange={event => void update({ quietStart: event.target.value || null })}
          />
        </label>
        <label className="text-[10px] font-semibold text-[var(--text-3)]">
          Quiet until
          <input
            type="time"
            className="form-input mt-1"
            value={pref.quietEnd || ''}
            onChange={event => void update({ quietEnd: event.target.value || null })}
          />
        </label>
      </div>
      <label className="block text-[10px] font-semibold text-[var(--text-3)]">
        Minimum alert severity
        <select
          className="form-input mt-1"
          value={pref.minimumSeverity}
          onChange={event => void update({ minimumSeverity: event.target.value })}
        >
          <option value="info">All notifications</option>
          <option value="success">Success and above</option>
          <option value="attention">Attention and above</option>
          <option value="warning">Warning and critical</option>
          <option value="critical">Critical only</option>
        </select>
      </label>
      <p className="text-[10px] leading-relaxed text-[var(--text-4)]">
        Critical security, finance-integrity and operational alerts can bypass quiet hours/channel preferences when policy requires it.
      </p>
    </div>
  )
}

/**
 * Account Settings Panel Component
 */
function AccountPanel({
  onClose,
  soundEnabled,
  setSoundEnabled,
}: {
  onClose: () => void
  soundEnabled: boolean
  setSoundEnabled: (v: boolean) => void
}) {
  const { users, currentUserId, updateUser, logout, profileImages, setProfileImage, showToast } = useShellStore()
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const avatar = currentUserId ? (profileImages[currentUserId] ?? null) : null

  const [name, setName] = useState(currentUser?.name ?? '')
  const [username, setUsername] = useState(currentUser?.username ?? '')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pwError, setPwError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentUserId) return
    try {
      const dataUrl = await readGuardedImageAsDataUrl(file, { label: 'Profile image', maxBytes: 2 * 1024 * 1024, maxPixels: 12_000_000 })
      setProfileImage(currentUserId, dataUrl)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Profile image could not be validated', 'error')
    } finally {
      e.target.value = ''
    }
  }

  const handleSave = async () => {
    setPwError('')
    if (newPw || currentPw) {
      if (!currentPw) {
        setPwError('Enter your current password to change it.')
        return
      }
      if (newPw.length < 8) {
        setPwError('New password must be at least 8 characters.')
        return
      }
      if (newPw !== confirmPw) {
        setPwError('Passwords do not match.')
        return
      }
    }
    setSaving(true)
    try {
      const payload: Partial<UpdateUserInput> = {}
      if (name.trim() && name !== currentUser?.name) payload.name = name.trim()
      if (username.trim() && username !== currentUser?.username) payload.username = username.trim()
      if (newPw) payload.password = newPw
      if (Object.keys(payload).length > 0 && currentUserId) {
        await updateUser(currentUserId, payload)
      }
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } finally {
      setSaving(false)
    }
  }

  const initials = (currentUser?.name ?? '??').slice(0, 2).toUpperCase()

  return (
    <>
      <div className="acct-backdrop" onClick={onClose} />
      <div className="acct-panel">
        {/* Header */}
        <div className="
          flex items-center justify-between
          px-5 py-4 border-b border-[var(--border-lt)] flex-shrink-0
        ">
          <div>
            <p className="text-sm font-bold text-[var(--text-1)]">Account Settings</p>
            <p className="text-[10px] text-[var(--text-4)] mt-0.5">
              Edit your profile, photo and preferences
            </p>
          </div>
          <button
            onClick={onClose}
            className="
              w-8 h-8 rounded-lg flex items-center justify-center
              bg-[var(--bg-surface)] border border-[var(--border)]
              text-[var(--text-3)] hover:text-[var(--text-1)]
              transition-colors cursor-pointer text-lg
            "
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-6">
          {/* Profile Photo Section */}
          <div className="acct-section">
            <p className="acct-label">Profile Photo</p>
            <div className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                <div className="
                  w-18 h-18 rounded-full flex-shrink-0
                  bg-gradient-to-br from-primary-500 to-accent-500
                  border-3 border-[var(--border)]
                  overflow-hidden
                  flex items-center justify-center
                  shadow-md
                ">
                  {avatar ? (
                    <img src={avatar} alt="profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-bold text-2xl">{initials}</span>
                  )}
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-primary-500 border-2 border-[var(--bg-card)] cursor-pointer flex items-center justify-center hover:bg-primary-600 transition-colors"
                  title="Change photo"
                  aria-label="Change profile photo"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </button>
              </div>
              <div>
                <p className="text-sm font-bold text-[var(--text-1)]">{currentUser?.name}</p>
                <p className="text-xs text-[var(--text-3)] mt-0.5">@{currentUser?.username}</p>
                <span className="inline-block mt-2 badge badge-blue">
                  {formatRoleLabel(currentUser?.role)}
                </span>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="
                      px-2.5 py-1 text-xs font-semibold
                      bg-primary-500 text-white rounded-lg
                      hover:bg-primary-600 transition-colors
                    "
                  >
                    Upload Photo
                  </button>
                  {avatar && (
                    <button
                      onClick={() => currentUserId && setProfileImage(currentUserId, '')}
                      className="
                        px-2.5 py-1 text-xs font-semibold
                        bg-red-100 text-red-700 rounded-lg
                        hover:bg-red-200 transition-colors
                      "
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>

          {/* Notification Preferences */}
          <div className="acct-section">
            <p className="acct-label">Notification Channels</p>
            <NotificationPreferenceControls
              soundEnabled={soundEnabled}
              setSoundEnabled={setSoundEnabled}
            />
          </div>

          {/* Profile Section */}
          <div className="acct-section">
            <p className="acct-label">Profile</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-3)] block mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-3)] block mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
          </div>

          {/* Password Section */}
          <div className="acct-section">
            <p className="acct-label">Change Password</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-3)] block mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-3)] block mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-3)] block mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  className="form-input"
                />
              </div>
              {pwError && (
                <p className="text-xs text-red-600 font-medium">{pwError}</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-lt)] bg-[var(--bg-surface)] flex gap-2 flex-shrink-0">
          <button
            onClick={() => void logout()}
            className="btn-danger flex-1 text-xs"
          >
            Sign Out
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className={`btn-primary flex-1 text-xs ${saved ? '!bg-[var(--success)]' : ''}`}
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TOPBAR COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main Topbar Component
 * Displays page title, notifications, dark mode toggle, and user menu
 */
export default function Topbar() {
  const pathname = usePathname()
  const router = useRouter()
  const {
    users,
    currentUserId,
    activeModule,
    setModule,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    clearReadNotifications,
    profileImages,
    sidebarOpen,
    toggleSidebar,
    getVisibleRepairs,
    showToast,
  } = useShellStore()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin = currentUser?.role === 'director'
  const isFinance = currentUser?.role === 'finance_officer'

  const [panelOpen, setPanelOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [soundEnabled, setSoundEnabled] = useSoundPreference()
  const [dateLabel, setDateLabel] = useState('')
  const [dismissedTicketIds, setDismissedTicketIds] = useState<Set<string>>(new Set())
  const [tableDensity, setTableDensity] = useState<'cozy' | 'compact'>('cozy')
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    stage: 'idle',
    pendingKeys: 0,
    lastSyncedAt: null,
    skippedKeys: [],
    message: '',
  })
  const [showConflictPrompt, setShowConflictPrompt] = useState(false)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const wasSidebarOpenRef = useRef(sidebarOpen)

  useEffect(() => {
    const wasOpen = wasSidebarOpenRef.current
    wasSidebarOpenRef.current = sidebarOpen
    if (wasOpen && !sidebarOpen && window.matchMedia('(max-width: 767px)').matches) {
      mobileMenuButtonRef.current?.focus()
    }
  }, [sidebarOpen])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('deed-dismissed-tickets')
      if (stored) setDismissedTicketIds(new Set(JSON.parse(stored)))
    } catch {}
  }, [])

  useEffect(() => {
    if (!currentUserId) return
    const key = `deed_table_density_${currentUserId}`
    const stored = localStorage.getItem(key)
    const nextDensity = stored === 'compact' ? 'compact' : 'cozy'
    setTableDensity(nextDensity)
    document.body.dataset.tableDensity = nextDensity
  }, [currentUserId])

  useEffect(() => {
    const initialPending = (() => {
      try {
        const raw = localStorage.getItem(DIRTY_KEYS_LS)
        if (!raw) return 0
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.length : 0
      } catch {
        return 0
      }
    })()

    setSyncStatus(prev => ({
      ...prev,
      pendingKeys: initialPending,
      lastSyncedAt: localStorage.getItem(LAST_SYNC_AT_LS),
      stage: initialPending > 0 ? 'syncing' : prev.stage,
    }))

    const onSyncStatus = (event: Event) => {
      const detail = (event as CustomEvent<Partial<SyncStatus>>).detail
      if (!detail) return
      setSyncStatus(prev => ({
        stage: detail.stage ?? prev.stage,
        pendingKeys: typeof detail.pendingKeys === 'number' ? detail.pendingKeys : prev.pendingKeys,
        lastSyncedAt: detail.lastSyncedAt ?? prev.lastSyncedAt,
        skippedKeys: Array.isArray(detail.skippedKeys) ? detail.skippedKeys : prev.skippedKeys,
        message: detail.message ?? prev.message,
      }))
      if (detail.stage === 'conflict') {
        setShowConflictPrompt(true)
      }
    }

    window.addEventListener(SYNC_STATUS_EVENT, onSyncStatus as EventListener)
    return () => window.removeEventListener(SYNC_STATUS_EVENT, onSyncStatus as EventListener)
  }, [])

  // Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
        setNotifOpen(false)
        setPanelOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    setDateLabel(
      new Date().toLocaleDateString('en-KE', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    )
  }, [])

  // Notifications
  const notifList = Array.isArray(notifications) ? notifications : []
  const baseNotifs = notifList.filter(n => n.userId === currentUserId)
  const canAssignRepairs = ['director', 'technical_lead'].includes(currentUser?.role ?? '')
  const visibleRepairsRaw = getVisibleRepairs()
  const pendingTickets = canAssignRepairs
    ? (Array.isArray(visibleRepairsRaw) ? visibleRepairsRaw : []).filter(r => r.status === 'received')
    : []

  const ticketNotifs: AppNotification[] = pendingTickets
    .filter(r => !dismissedTicketIds.has(`pending-ticket-${r.id}`))
    .map(r => ({
      id: `pending-ticket-${r.id}`,
      userId: currentUserId || '',
      type: 'repair',
      title: 'Action Required: Unassigned Ticket',
      body: `${r.ref} — ${r.productName} needs to be assigned.`,
      module: 'repair',
      path: `?id=${r.id}`,
      read: false,
      createdAt: r.createdDate || new Date().toISOString(),
      icon: '🚨',
    }))

  const myNotifs = [...ticketNotifs, ...baseNotifs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  const unreadCount = myNotifs.filter(n => !n.read).length

  // Page title
  const baseRoute = `/${pathname?.split('/')[1] || ''}`
  const t = ROUTE_TITLES[baseRoute] || { label: 'Deed ERP', desc: 'Business Management System' }

  const displayTitle = { ...t }
  if (!isAdmin) {
    if (pathname?.startsWith('/hr')) {
      displayTitle.label = isFinance ? 'HR & Payroll' : 'Leave & Performance'
      displayTitle.desc = isFinance
        ? 'Payroll, employees & time off'
        : 'Self service, leave requests & targets'
    }
    if (pathname?.startsWith('/operations')) {
      displayTitle.label = 'Inventory'
      displayTitle.desc = 'Products & stock levels'
    }
  }

  // Route guard
  useEffect(() => {
    if (!currentUser) return

    const baseRoute = `/${pathname?.split('/')[1] || ''}`
    const requiredModule = ROUTE_MODULE[baseRoute]

    if (baseRoute === '/settings') {
      if (!isAdminRole(currentUser.role)) {
        showToast('Access Denied: You do not have permission to view this page.', 'error')
        router.replace('/')
      }
      return
    }

    if (
      requiredModule &&
      requiredModule !== 'settings' &&
      !hasModuleAccess(currentUser, requiredModule)
    ) {
      showToast('Access Denied: You do not have permission to view this page.', 'error')
      router.replace('/')
    }
  }, [pathname, currentUser, router, showToast])

  // Tab title flashing for urgent notifications
  useEffect(() => {
    const hasUnreadUrgent = myNotifs.some(
      n =>
        !n.read &&
        (n.icon === '🚨' || n.type === 'repair' || n.title.toLowerCase().includes('urgent'))
    )
    const baseTitle = `${displayTitle.label} | Deed ERP`

    if (!hasUnreadUrgent) {
      document.title = baseTitle
      return
    }

    let toggle = false
    const intervalId = setInterval(() => {
      document.title = toggle ? baseTitle : '🚨 Action Required!'
      toggle = !toggle
    }, 1000)

    return () => {
      clearInterval(intervalId)
      document.title = baseTitle
    }
  }, [myNotifs, displayTitle.label])

  // Notification sound effect
  const prevNotifIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(myNotifs.map(n => n.id))

    if (prevNotifIds.current.size > 0) {
      const newNotifs = myNotifs.filter(n => !n.read && !prevNotifIds.current.has(n.id))
      const hasUrgent = newNotifs.some(
        n =>
          n.icon === '🚨' ||
          n.type === 'repair' ||
          n.title.toLowerCase().includes('urgent')
      )

      if (hasUrgent && soundEnabled) {
        try {
          const AudioContext = window.AudioContext || (window as any).webkitAudioContext
          if (AudioContext) {
            const ctx = new AudioContext()
            const playBeep = (timeOffset: number) => {
              const osc = ctx.createOscillator()
              const gain = ctx.createGain()
              osc.connect(gain)
              gain.connect(ctx.destination)
              osc.type = 'sine'
              osc.frequency.value = 880
              gain.gain.setValueAtTime(0, ctx.currentTime + timeOffset)
              gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + timeOffset + 0.02)
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + timeOffset + 0.15)
              osc.start(ctx.currentTime + timeOffset)
              osc.stop(ctx.currentTime + timeOffset + 0.15)
            }
            playBeep(0)
            playBeep(0.2)
          }
        } catch (e) {
          // Silently fail if Audio API is blocked
        }
      }
    }

    prevNotifIds.current = currentIds
  }, [myNotifs, soundEnabled])

  const avatar = currentUserId ? (profileImages[currentUserId] ?? null) : null
  const initials = (currentUser?.name ?? '??').slice(0, 2).toUpperCase()

  // The steady "Synced" pill was visual noise — only problem states surface.
  const syncBadge = (() => {
    if (syncStatus.stage === 'conflict') {
      return {
        label: `Conflict${syncStatus.skippedKeys.length ? ` (${syncStatus.skippedKeys.length})` : ''}`,
        className: 'status-pill status-pill-danger',
      }
    }
    if (syncStatus.stage === 'error') {
      return { label: 'Sync delayed', className: 'status-pill status-pill-danger' }
    }
    if (syncStatus.pendingKeys > 0 || syncStatus.stage === 'syncing') {
      return { label: `Syncing ${syncStatus.pendingKeys}`, className: 'status-pill status-pill-warning' }
    }
    return null
  })()

  const handleBellClick = useCallback(() => {
    setNotifOpen(v => !v)
    setPanelOpen(false)
    trackUxEvent('notification_open', { module: activeModule })
  }, [activeModule])

  const handleAvatarClick = useCallback(() => {
    setPanelOpen(v => !v)
    setNotifOpen(false)
    trackUxEvent('account_panel_open', { module: activeModule })
  }, [activeModule])

  const toggleTableDensity = useCallback(() => {
    if (!currentUserId) return
    const next = tableDensity === 'cozy' ? 'compact' : 'cozy'
    setTableDensity(next)
    document.body.dataset.tableDensity = next
    try {
      localStorage.setItem(`deed_table_density_${currentUserId}`, next)
    } catch {
      // ignore
    }
    trackUxEvent('table_density_change', { density: next })
  }, [currentUserId, tableDensity])

  return (
    <>
      {showConflictPrompt && syncStatus.skippedKeys.length > 0 && (
        <div className="mx-3 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 flex flex-wrap items-center gap-2">
          <span className="font-bold">Sync conflict:</span>
          <span>Server blocked stale overwrite for {syncStatus.skippedKeys.join(', ')}.</span>
          <button className="btn-outline h-7 px-2 text-[10px]" onClick={() => window.location.reload()}>
            Reload latest data
          </button>
          <button className="btn-outline h-7 px-2 text-[10px]" onClick={() => setShowConflictPrompt(false)}>
            Keep local edits
          </button>
        </div>
      )}
      <header className={`app-topbar ${pathname?.startsWith('/sales') ? 'app-topbar--sales' : ''} ${pathname?.startsWith('/finance') || pathname?.startsWith('/accounting') ? 'app-topbar--finance' : ''}
        flex items-center gap-2 sm:gap-3 md:gap-4 px-3 sm:px-4 md:px-5 py-0 flex-shrink-0
        border-b border-[var(--topbar-border)]
        bg-[var(--topbar-bg)] h-14
        shadow-sm transition-all duration-200
      `}>
        {/* Hamburger Menu - Mobile */}
        <button
          type="button"
          ref={mobileMenuButtonRef}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0
            bg-[var(--bg-surface)] border border-[var(--border)]
            hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-controls="primary-navigation"
          aria-expanded={sidebarOpen}
        >
          <svg
            width="16"
            height="14"
            viewBox="0 0 16 14"
            fill="none"
            style={{ color: 'var(--text-2)' }}
          >
            <path
              d="M0 1h16M0 7h16M0 13h16"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Page Title */}
        <div className="app-topbar-title flex-1 min-w-0">
          <h1 className="text-sm font-bold text-[var(--text-1)]">{pathname?.startsWith('/sales') ? 'Sales' : displayTitle.label}</h1>
          <p className="text-[10px] hidden sm:block text-[var(--text-4)]">
            {displayTitle.desc}
          </p>
        </div>

        {/* Right Controls */}
        <div className="app-topbar-controls flex items-center gap-1.5 md:gap-2 flex-shrink-0 min-w-0">
          {/* DIA — Deed Intelligence Assistant */}
          {hasModuleAccess(currentUser, 'jarvis') && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('jarvis:toggle'))}
              title="DIA — Deed Intelligence Assistant"
              aria-label="Ask DIA"
              className="app-topbar-secondary flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] hover:bg-[var(--bg-muted)] transition-colors cursor-pointer text-[var(--text-3)] hover:text-[var(--text-1)] shrink-0"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded bg-[var(--primary)] text-[10px] font-extrabold text-white leading-none">DIA</span>
              <span className="hidden sm:block text-[11px] font-semibold">DIA</span>
            </button>
          )}
          {/* Global Search Button */}
          <button
            onClick={() => {
              setSearchOpen(true)
              setNotifOpen(false)
              setPanelOpen(false)
              trackUxEvent('search_open', { module: activeModule })
            }}
            title="Search (Ctrl+K)"
            className="app-topbar-search flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] hover:bg-[var(--bg-muted)] transition-colors cursor-pointer text-[var(--text-3)] hover:text-[var(--text-1)] shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
              <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:block text-[11px] font-semibold">Search</span>
            <kbd className="hidden md:flex items-center px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] text-[9px] font-bold text-[var(--text-4)]">⌘K</kbd>
          </button>
          <button
            onClick={toggleTableDensity}
            title={`Switch to ${tableDensity === 'cozy' ? 'compact' : 'cozy'} density`}
            className="hidden sm:flex items-center gap-1.5 px-2 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] hover:bg-[var(--bg-muted)] transition-colors text-[11px] font-semibold text-[var(--text-3)]"
          >
            <span>{tableDensity === 'cozy' ? 'Cozy' : 'Compact'}</span>
          </button>

          <ThemeToggle />

          {/* Sync state — only surfaced when something needs attention */}
          {syncBadge && (
            <div className={syncBadge.className} title={syncStatus.message || (syncStatus.lastSyncedAt ? `Last synced ${new Date(syncStatus.lastSyncedAt).toLocaleString('en-KE')}` : 'No sync timestamp available')}>
              {syncBadge.label}
            </div>
          )}

          {/* Date */}
          <div className="text-[10px] hidden md:block text-[var(--text-4)]">{dateLabel}</div>

          {/* Notifications Bell */}
          <div className="relative">
            <button
              onClick={handleBellClick}
              className={`icon-btn w-9 h-9 focus-ring ${notifOpen ? 'active' : ''}`}
              aria-label="Notifications"
              aria-expanded={notifOpen}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full z-10 bg-[var(--danger)] px-1 text-[10px] font-black text-white shadow-md ring-2 ring-[var(--bg-card)]">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <NotificationsPanel
                notifs={myNotifs}
                onClose={() => setNotifOpen(false)}
                onMarkRead={(id) => {
                  if (id.startsWith('pending-ticket-')) {
                    setDismissedTicketIds(prev => {
                      const next = new Set(prev)
                      next.add(id)
                      localStorage.setItem('deed-dismissed-tickets', JSON.stringify([...next]))
                      return next
                    })
                  } else {
                    markNotificationRead(id)
                  }
                }}
                onMarkAll={() => {
                  markAllNotificationsRead()
                  const ids = ticketNotifs.map(n => n.id)
                  if (ids.length > 0) {
                    setDismissedTicketIds(prev => {
                      const next = new Set([...prev, ...ids])
                      localStorage.setItem('deed-dismissed-tickets', JSON.stringify([...next]))
                      return next
                    })
                  }
                }}
                onClearRead={() => {
                  clearReadNotifications()
                }}
                onNavigate={(mod, path) => {
                  setModule(mod)
                  const routeMap: Record<string, string> = {
                    dashboard: '/',
                    sales: '/sales',
                    pos: '/pos',
                    ecommerce: '/ecommerce',
                    kilimall: '/kilimall',
                    contacts: '/contacts',
                    after_sales: '/aftersales',
                    operations: '/operations',
                    inventory: '/operations',
                    purchase: '/purchases',
                    delivery: '/delivery',
                    repair: '/repairs',
                    refurbishment: '/refurbishment',
                    outsource: '/outsource',
                    accounting: '/finance',
                    deposits: '/deposits',
                    holdovers: '/holdovers',
                    company_property: '/property',
                    expenses: '/expenses',
                    cashbook: '/cashbook',
                    hr: '/hr',
                    my_documents: '/documents',
                    documents: '/documents',
                    crm: '/crm',
                    sops: '/sops',
                    sop_documents: '/sop-documents',
                    settings: '/settings',
                  }
                  const baseRoute = routeMap[mod] || '/'
                  router.push(path ? `${baseRoute}${path}` : baseRoute)
                  setNotifOpen(false)
                }}
              />
            )}
          </div>

          {/* User Menu */}
          <button
            onClick={handleAvatarClick}
            className={`app-topbar-account flex items-center gap-2 rounded-lg px-2.5 py-1.5 border transition-all duration-150 cursor-pointer focus-ring ${panelOpen ? 'border-[var(--primary)] bg-[var(--info-bg)]' : 'bg-[var(--bg-surface)] border-[var(--border)] hover:bg-[var(--bg-muted)]'}`}
            aria-label="Account settings"
            aria-expanded={panelOpen}
          >
            <div className="
              w-6 h-6 rounded-full flex-shrink-0
              bg-gradient-to-br from-primary-500 to-accent-500
              overflow-hidden flex items-center justify-center
            ">
              {avatar ? (
                <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-[9px] font-bold">{initials}</span>
              )}
            </div>
            <div className="min-w-0 hidden md:block text-left">
              <div className="text-[11px] font-semibold text-[var(--text-1)]">
                {currentUser?.name ?? 'Guest'}
              </div>
              <div className="text-[9px] text-[var(--text-4)]">
                {formatRoleLabel(currentUser?.role)}
              </div>
            </div>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="hidden sm:block"
              style={{ color: 'var(--text-4)', flexShrink: 0 }}
            >
              <path
                d="M2 3.5L5 6.5L8 3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {panelOpen && (
        <AccountPanel
          onClose={() => setPanelOpen(false)}
          soundEnabled={soundEnabled}
          setSoundEnabled={setSoundEnabled}
        />
      )}

      {searchOpen && (
        <GlobalSearch
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  )
}
