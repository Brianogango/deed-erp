'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useShellStore, ModuleId, AppNotification, SYNC_STATUS_EVENT, LAST_SYNC_AT_LS, DIRTY_KEYS_LS } from '@/lib/store'
import type { UpdateUserInput } from '@/lib/auth/types'
import { passwordPolicyError } from '@/lib/auth/password-policy'
import { formatRoleLabel, hasModuleAccess, isAdmin as isAdminRole } from '@/lib/auth/access'
import { usePathname, useRouter } from 'next/navigation'
import { readGuardedImageAsDataUrl } from '@/lib/client-image-guard'
import { trackUxEvent } from '@/lib/ux-telemetry'

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
  '/operations':  { label: 'Inventory',      desc: 'Products, stock & fulfillment' },
  '/inventory':   { label: 'Inventory',      desc: 'Products, stock & fulfillment' },
  '/purchase':    { label: 'Purchases',      desc: 'Purchase orders & bills' },
  '/purchases':   { label: 'Purchases',      desc: 'Purchase orders & bills' },
  '/delivery':    { label: 'Delivery',       desc: 'Riders & delivery tracking' },
  '/repairs':     { label: 'Repairs',        desc: 'Device repairs & service jobs' },
  '/refurbishment': { label: 'Refurbishment', desc: 'Internal device refurbishing' },
  '/reconfiguration': { label: 'Reconfiguration', desc: 'Device upgrades & component swaps' },
  '/outsource':   { label: 'Outsource',      desc: 'External repair vendors' },
  '/aftersales':  { label: 'After-Sales',    desc: 'Warranties & RMAs' },
  '/after_sales': { label: 'After-Sales',    desc: 'Warranties & RMAs' },
  '/finance':     { label: 'Finance',        desc: 'Accounting, bills & reports' },
  '/accounting':  { label: 'Finance',        desc: 'Accounting, bills & reports' },
  '/cashbook':    { label: 'Cashbook',       desc: 'Cash receipts and payments' },
  '/deposits':    { label: 'Deposits',       desc: 'Customer deposits & layby' },
  '/holdovers':   { label: 'Holdovers',      desc: 'Device loans & temporary issue log' },
  '/property':    { label: 'Asset Management', desc: 'Office furniture, fittings & equipment' },
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

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const bytes = new ArrayBuffer(raw.length)
  const view = new Uint8Array(bytes)
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i)
  return bytes
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

function AccountChannelIcon({ kind }: { kind: 'inapp' | 'push' | 'email' | 'whatsapp' | 'sms' | 'sound' }) {
  const common = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'inapp') return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
  if (kind === 'push') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 6.5h.01M11 6.5h.01"/></svg>
  if (kind === 'email') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
  if (kind === 'whatsapp') return <svg {...common}><path d="M20.5 11.7a8.5 8.5 0 0 1-12.7 7.4L3 20.5l1.4-4.6A8.5 8.5 0 1 1 20.5 11.7Z"/><path d="M8.4 8.1c.3 3.5 2.1 5.4 5.7 6.1l1.2-1.2-2.3-1.1-.8.7c-1.3-.5-2.3-1.5-2.8-2.8l.7-.8-1-2.2-.7 1.3Z"/></svg>
  if (kind === 'sms') return <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 2 1.5-4A5 5 0 0 1 3 13V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 10h8M8 13h5"/></svg>
  return <svg {...common}><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/></svg>
}

function NotificationPreferenceControls({
  soundEnabled,
  setSoundEnabled,
  showToast,
}: {
  soundEnabled: boolean
  setSoundEnabled: (v: boolean) => void
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
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
  const [pushConfigured, setPushConfigured] = useState(true)

  const load = useCallback(async () => {
    try {
      const [prefRes, endpointRes] = await Promise.all([
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
      if (endpointRes.ok) {
        const config = await endpointRes.json()
        setPushConfigured(Boolean(config.pushConfigured && config.vapidPublicKey))
      }
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      setPushSupported(supported)
      if (supported) {
        const registration = await navigator.serviceWorker.getRegistration('/')
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
    if (enabled && !pushConfigured) {
      showToast('Browser push is not configured on this server yet', 'error')
      return
    }
    setPushBusy(true)
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
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
        showToast('Browser push turned off for this device', 'info')
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Allow notifications in the browser to enable Browser Push')

      const configRes = await fetch('/api/notifications/endpoints', { cache: 'no-store' })
      const config = await configRes.json()
      if (!configRes.ok || !config.vapidPublicKey) throw new Error('Web Push is not configured on the server')
      setPushConfigured(true)

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
      showToast('This browser will get ERP alerts even when the tab is closed', 'success')
    } catch (error) {
      console.warn('[notifications] push preference failed', error)
      setPushSubscribed(false)
      showToast(error instanceof Error ? error.message : 'Could not enable browser push', 'error')
    } finally {
      setPushBusy(false)
    }
  }, [pushBusy, pushConfigured, pushSupported, showToast, update])

  const sendPushTest = useCallback(async () => {
    if (!pushSubscribed || pushBusy) return
    setPushBusy(true)
    try {
      const res = await fetch('/api/notifications/push-test', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Test notification could not be sent')
      showToast('Test notification sent — check the system tray', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Test notification failed', 'error')
    } finally {
      setPushBusy(false)
    }
  }, [pushBusy, pushSubscribed, showToast])

  return (
    <div className="acct-notification-wrap">
      <div className="acct-notification-card">
        <div className="acct-channel-row">
          <span className="acct-channel-icon"><AccountChannelIcon kind="inapp" /></span>
          <span className="acct-channel-copy">
            <span className="acct-channel-title">In-app notifications</span>
            <span className="acct-channel-detail">Bell inbox and real-time ERP alerts</span>
          </span>
          <Toggle on={pref.inAppEnabled} onChange={value => void update({ inAppEnabled: value })} />
        </div>

        <div className="acct-channel-row">
          <span className="acct-channel-icon"><AccountChannelIcon kind="push" /></span>
          <span className="acct-channel-copy">
            <span className="acct-channel-title">Browser Push</span>
            <span className="acct-channel-detail">
              {!pushSupported
                ? 'Not supported by this browser. Use Chrome, Edge, or Firefox on HTTPS.'
                : !pushConfigured
                  ? 'Not configured on this server yet'
                  : pushSubscribed
                    ? 'This browser is subscribed — alerts arrive even if the ERP tab is closed'
                    : 'Notify even when the ERP tab is closed'}
            </span>
            {pushSubscribed && (
              <button
                type="button"
                className="acct-push-test"
                disabled={pushBusy}
                onClick={() => void sendPushTest()}
              >
                Send test notification
              </button>
            )}
          </span>
          <Toggle
            on={pushSubscribed}
            onChange={value => void setPushForDevice(value)}
          />
        </div>

        <div className="acct-channel-row">
          <span className="acct-channel-icon"><AccountChannelIcon kind="email" /></span>
          <span className="acct-channel-copy">
            <span className="acct-channel-title">Email alerts</span>
            <span className="acct-channel-detail">Receive important ERP alerts by email</span>
          </span>
          <Toggle on={pref.emailEnabled} onChange={value => void update({ emailEnabled: value })} />
        </div>

        <div className="acct-channel-row">
          <span className="acct-channel-icon"><AccountChannelIcon kind="whatsapp" /></span>
          <span className="acct-channel-copy">
            <span className="acct-channel-title">WhatsApp alerts</span>
            <span className="acct-channel-detail">Operational notifications on WhatsApp</span>
          </span>
          <Toggle on={pref.whatsappEnabled} onChange={value => void update({ whatsappEnabled: value })} />
        </div>

        <div className="acct-channel-row">
          <span className="acct-channel-icon"><AccountChannelIcon kind="sms" /></span>
          <span className="acct-channel-copy">
            <span className="acct-channel-title">SMS alerts</span>
            <span className="acct-channel-detail">Text-message alerts for selected events</span>
          </span>
          <Toggle on={pref.smsEnabled} onChange={value => void update({ smsEnabled: value })} />
        </div>

        <div className="acct-channel-row">
          <span className="acct-channel-icon"><AccountChannelIcon kind="sound" /></span>
          <span className="acct-channel-copy">
            <span className="acct-channel-title">Sound Alerts</span>
            <span className="acct-channel-detail">Play an alert sound for new notifications</span>
          </span>
          <Toggle
            on={soundEnabled}
            onChange={value => {
              setSoundEnabled(value)
              void update({ soundEnabled: value })
            }}
          />
        </div>
      </div>

      <div className="acct-notification-advanced">
        <div className="acct-advanced-grid">
          <label>
            <span>Quiet from</span>
            <input
              type="time"
              className="form-input"
              value={pref.quietStart || ''}
              onChange={event => void update({ quietStart: event.target.value || null })}
            />
          </label>
          <label>
            <span>Quiet until</span>
            <input
              type="time"
              className="form-input"
              value={pref.quietEnd || ''}
              onChange={event => void update({ quietEnd: event.target.value || null })}
            />
          </label>
        </div>
        <label className="acct-severity-field">
          <span>Minimum alert severity</span>
          <select
            className="form-input"
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
        <p className="acct-notification-note">
          Critical security, finance-integrity and operational alerts can bypass quiet hours when policy requires it.
        </p>
      </div>
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
      const policyError = passwordPolicyError(newPw)
      if (policyError) {
        setPwError(policyError)
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
      <aside className="acct-panel" role="dialog" aria-modal="true" aria-label="Account Settings">
        <header className="acct-panel-header">
          <div className="acct-header-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21a8 8 0 0 0-16 0"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div className="acct-header-copy">
            <h2>Account Settings</h2>
            <p>Edit your profile, photo and preferences</p>
          </div>
          <button onClick={onClose} className="acct-close-btn" aria-label="Close account settings">×</button>
        </header>

        <div className="acct-panel-body">
          <section className="acct-section acct-profile-section">
            <p className="acct-label">Profile Photo</p>
            <div className="acct-profile-card">
              <div className="acct-avatar-wrap">
                <div className="acct-avatar">
                  {avatar ? (
                    <img src={avatar} alt="Profile" />
                  ) : (
                    <span>{initials}</span>
                  )}
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="acct-camera-btn"
                  title="Change photo"
                  aria-label="Change profile photo"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </button>
              </div>

              <div className="acct-profile-copy">
                <div>
                  <h3>{currentUser?.name || 'User'}</h3>
                  <p className="acct-username">@{currentUser?.username || 'user'}</p>
                  <span className="acct-role-pill">{formatRoleLabel(currentUser?.role)}</span>
                </div>
                <p className="acct-profile-note">This is how your name and role appear in Deed Technologies.</p>
                <div className="acct-profile-actions">
                  <button type="button" onClick={() => fileRef.current?.click()} className="acct-upload-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14a2 2 0 0 0 2-2v-4"/><path d="M3 15v4a2 2 0 0 0 2 2"/></svg>
                    Upload Photo
                  </button>
                  {avatar && (
                    <button type="button" onClick={() => currentUserId && setProfileImage(currentUserId, '')} className="acct-remove-btn">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 15H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageUpload} className="hidden" />
          </section>

          <section className="acct-section acct-notification-section">
            <div className="acct-section-heading">
              <span className="acct-section-icon" aria-hidden="true">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
              </span>
              <span>
                <strong>Notification Channels</strong>
                <small>Choose how you’d like to stay updated</small>
              </span>
            </div>
            <NotificationPreferenceControls soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} showToast={showToast} />
          </section>

          <section className="acct-section">
            <div className="acct-section-heading">
              <span className="acct-section-icon" aria-hidden="true">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <span><strong>Profile</strong><small>Update your account identity</small></span>
            </div>
            <div className="acct-form-card">
              <label>
                <span>Full Name</span>
                <input type="text" value={name} onChange={e => setName(e.target.value)} className="form-input" />
              </label>
              <label>
                <span>Username</span>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="form-input" />
              </label>
            </div>
          </section>

          <section className="acct-section">
            <div className="acct-section-heading">
              <span className="acct-section-icon" aria-hidden="true">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
              </span>
              <span><strong>Change Password</strong><small>Keep your account credentials secure</small></span>
            </div>
            <div className="acct-form-card">
              <label>
                <span>Current Password</span>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className="form-input" />
              </label>
              <label>
                <span>New Password</span>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className="form-input" />
              </label>
              <label>
                <span>Confirm Password</span>
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className="form-input" />
              </label>
              {pwError && <p className="acct-password-error">{pwError}</p>}
            </div>
          </section>
        </div>

        <footer className="acct-panel-footer">
          <button onClick={() => void logout()} className="acct-signout-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 19V5a2 2 0 0 0-2-2h-6"/></svg>
            Sign Out
          </button>
          <button onClick={() => void handleSave()} disabled={saving} className={`acct-save-btn ${saved ? 'is-saved' : ''}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.3 2.3 4.8-5"/></svg>
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
          </button>
        </footer>
      </aside>
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
    profileImages,
    sidebarOpen,
    toggleSidebar,
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
  const [timeLabel, setTimeLabel] = useState('')
  const [serverNotifs, setServerNotifs] = useState<BellNotification[]>([])
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
    if (wasOpen && !sidebarOpen && window.matchMedia('(max-width: 1023px)').matches) {
      mobileMenuButtonRef.current?.focus()
    }
  }, [sidebarOpen])

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

  useEffect(() => {
    const openAccount = () => {
      setPanelOpen(true)
      setNotifOpen(false)
      setSearchOpen(false)
    }
    window.addEventListener('deed:account-open', openAccount)
    return () => window.removeEventListener('deed:account-open', openAccount)
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
    const updateClock = () => {
      const now = new Date()
      setDateLabel(now.toLocaleDateString('en-KE', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }))
      setTimeLabel(now.toLocaleTimeString('en-KE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }))
    }
    updateClock()
    const timer = window.setInterval(updateClock, 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Notifications — relational notification ledger is authoritative.
  const loadNotifications = useCallback(async () => {
    if (!currentUserId) {
      setServerNotifs([])
      return
    }
    try {
      // The bell shows a badge + short dropdown; 200 rows per SSE-driven
      // refetch was the app's third-highest request volume. 50 covers the
      // visible surface with margin.
      const res = await fetch('/api/notifications?limit=50', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setServerNotifs(Array.isArray(data.notifications) ? data.notifications : [])
    } catch {
      // Keep the last known notification list during transient network failures.
    }
  }, [currentUserId])

  useEffect(() => {
    if (!currentUserId) {
      setServerNotifs([])
      return
    }
    void loadNotifications()

    const source = new EventSource('/api/notifications/stream')
    const refresh = () => { void loadNotifications() }
    source.addEventListener('notification', refresh)
    source.addEventListener('ready', refresh)
    return () => {
      source.removeEventListener('notification', refresh)
      source.removeEventListener('ready', refresh)
      source.close()
    }
  }, [currentUserId, loadNotifications])

  const mutateNotification = useCallback(async (action: 'read' | 'read_all' | 'clear_read' | 'acknowledge', id?: string) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      if (res.ok) await loadNotifications()
    } catch {}
  }, [loadNotifications])

  const myNotifs = [...serverNotifs].sort(
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
    if (pathname?.startsWith('/operations') || pathname?.startsWith('/inventory')) {
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

  // Route-aware tab title. No blinking: a title that alternates to "🚨 Action
  // Required!" every second is always-on noise, so it taught users to ignore
  // genuinely urgent states — the bell badge and sound carry urgency instead.
  useEffect(() => {
    document.title = `${displayTitle.label} | Deed ERP`
  }, [displayTitle.label])

  // Notification sound effect
  const prevNotifIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(myNotifs.map(n => n.id))

    if (prevNotifIds.current.size > 0) {
      const newNotifs = myNotifs.filter(n => !n.read && !prevNotifIds.current.has(n.id))
      const hasUrgent = newNotifs.some(
        n => n.icon === '🚨' || n.severity === 'critical'
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
          className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0
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

        <button
          type="button"
          className="app-topbar-sidebar-toggle hidden lg:inline-flex"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-controls="primary-navigation"
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={sidebarOpen ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
          </svg>
        </button>

        {/* Page Title */}
        <div className="app-topbar-title flex-1 min-w-0">
          <h1 className="text-sm font-bold text-[var(--text-1)]">{pathname?.startsWith('/sales') ? 'Sales' : displayTitle.label}</h1>
          <p className="text-[10px] hidden sm:block text-[var(--text-4)]">
            {displayTitle.desc}
          </p>
        </div>

        <button
          type="button"
          className="app-topbar-clock"
          onClick={() => window.dispatchEvent(new CustomEvent('jarvis:toggle'))}
          title="Open DIA voice assistant"
          aria-label="Open DIA voice assistant"
        >
          <span className="app-topbar-clock__dot" aria-hidden="true" />
          <span><small>{dateLabel}</small><strong>{timeLabel}</strong></span>
          <span className="app-topbar-clock__mic" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>
          </span>
        </button>

        {/* Right Controls */}
        <div className="app-topbar-controls flex items-center gap-1.5 md:gap-2 flex-shrink-0 min-w-0">
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


          {/* Sync state — only surfaced when something needs attention */}
          {syncBadge && (
            <div className={syncBadge.className} title={syncStatus.message || (syncStatus.lastSyncedAt ? `Last synced ${new Date(syncStatus.lastSyncedAt).toLocaleString('en-KE')}` : 'No sync timestamp available')}>
              {syncBadge.label}
            </div>
          )}

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
                onMarkRead={(id) => { void mutateNotification('read', id) }}
                onMarkAll={() => { void mutateNotification('read_all') }}
                onClearRead={() => { void mutateNotification('clear_read') }}
                onAcknowledge={(id) => { void mutateNotification('acknowledge', id) }}
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
                    operations: '/inventory',
                    inventory: '/inventory',
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
                  const target = path
                    ? (path.startsWith('/') ? path : `${baseRoute}${path}`)
                    : baseRoute
                  router.push(target)
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
