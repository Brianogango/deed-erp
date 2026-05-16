'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp, ModuleId, AppNotification } from '@/lib/store'
import type { UpdateUserInput } from '@/lib/auth/types'
import { formatRoleLabel, hasModuleAccess, isAdmin as isAdminRole } from '@/lib/auth/access'
import { usePathname, useRouter } from 'next/navigation'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ROUTE_TITLES: Record<string, { label: string; desc: string }> = {
  '/':            { label: 'Dashboard',      desc: 'Business overview' },
  '/sales':       { label: 'Sales & CRM',    desc: 'Quotations, orders & invoices' },
  '/pos':         { label: 'Point of Sale',  desc: 'Retail till & transactions' },
  '/ecommerce':   { label: 'E-commerce',     desc: 'Online store management' },
  '/kilimall':    { label: 'Kilimall',       desc: 'Kilimall orders & settlements' },
  '/contacts':    { label: 'Contacts',       desc: 'Customers, vendors & staff' },
  '/operations':  { label: 'Operations',     desc: 'Products, stock & fulfillment' },
  '/purchase':    { label: 'Purchases',      desc: 'Purchase orders & bills' },
  '/delivery':    { label: 'Delivery',       desc: 'Riders & delivery tracking' },
  '/repairs':     { label: 'Repairs',        desc: 'Device repairs & service jobs' },
  '/refurbishment': { label: 'Refurbishment', desc: 'Internal device refurbishing' },
  '/outsource':   { label: 'Outsource',      desc: 'External repair vendors' },
  '/aftersales':  { label: 'After-Sales',    desc: 'Warranties & RMAs' },
  '/finance':     { label: 'Finance',        desc: 'Accounting, bills & reports' },
  '/expenses':    { label: 'Expenses',       desc: 'Staff expense claims' },
  '/hr':          { label: 'HR',             desc: 'Employees, payroll & time off' },
  '/settings':    { label: 'Settings',       desc: 'System config & user management' },
}

const ROUTE_MODULE: Record<string, ModuleId> = {
  '/sales':          'sales',
  '/pos':            'pos',
  '/ecommerce':      'ecommerce',
  '/kilimall':       'kilimall',
  '/contacts':       'contacts',
  '/operations':     'inventory',
  '/purchase':       'purchase',
  '/purchases':      'purchase',
  '/delivery':       'delivery',
  '/repairs':        'repair',
  '/refurbishment':  'refurbishment',
  '/outsource':      'outsource',
  '/aftersales':     'after_sales',
  '/finance':        'accounting',
  '/expenses':       'expenses',
  '/hr':             'hr',
}

const NOTIF_ICONS: Record<AppNotification['type'], string> = {
  assignment: '📋',
  leave:      '🌴',
  asset:      '💻',
  expense:    '💰',
  system:     '⚙️',
  repair:     '🔧',
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dark mode preference hook with localStorage persistence
 */
function useDarkMode(): [boolean, (v: boolean) => void] {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('deed-dark') === 'true'
    setDark(stored)
    document.documentElement.classList.toggle('dark', stored)
  }, [])

  const setDarkPersist = useCallback((v: boolean) => {
    setDark(v)
    document.documentElement.classList.toggle('dark', v)
    localStorage.setItem('deed-dark', String(v))
  }, [])

  return [dark, setDarkPersist]
}

/**
 * Sound preference hook with localStorage persistence
 */
function useSoundPreference(): [boolean, (v: boolean) => void] {
  const [sound, setSound] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('deed-sound')
    if (stored !== null) setSound(stored === 'true')
  }, [])

  const setSoundPersist = useCallback((v: boolean) => {
    setSound(v)
    localStorage.setItem('deed-sound', String(v))
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
    <div
      className="toggle-track"
      style={{ background: on ? 'var(--primary)' : 'var(--border)' }}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <div className="toggle-thumb" style={{ transform: on ? 'translateX(18px)' : 'translateX(0)' }} />
    </div>
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

/**
 * Notifications Panel Component
 */
function NotificationsPanel({
  notifs,
  onClose,
  onMarkRead,
  onMarkAll,
  onNavigate,
}: {
  notifs: AppNotification[]
  onClose: () => void
  onMarkRead: (id: string) => void
  onMarkAll: () => void
  onNavigate: (module: ModuleId, path?: string) => void
}) {
  const unread = notifs.filter(n => !n.read).length
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={panelRef}
      className="
        fixed top-14 right-2 z-[9050]
        w-[min(360px,calc(100vw-16px))] max-h-[calc(100vh-72px)]
        bg-[var(--bg-card)] border border-[var(--border)]
        rounded-lg shadow-lg
        flex flex-col overflow-hidden
      "
    >
      {/* Header */}
      <div className="
        px-4 py-3 border-b border-[var(--border-lt)]
        flex items-center justify-between flex-shrink-0
      ">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[var(--text-1)]">Notifications</span>
          {unread > 0 && (
            <span className="
              bg-red-500 text-white text-xs font-bold
              rounded-full px-1.5 min-w-[18px] text-center
            ">
              {unread}
            </span>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={onMarkAll}
            className="text-xs font-semibold text-primary-500 hover:text-primary-600 transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto">
        {notifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <div className="text-3xl mb-2">🔔</div>
            <p className="text-xs font-medium text-[var(--text-3)]">No notifications yet</p>
            <p className="text-[10px] text-[var(--text-4)] mt-1">
              You'll see assignments, approvals and updates here
            </p>
          </div>
        ) : (
          notifs.map(n => (
            <NotificationItem
              key={n.id}
              notification={n}
              onMarkRead={() => onMarkRead(n.id)}
              onNavigate={() => {
                if (n.module) onNavigate(n.module, n.path)
                onClose()
              }}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {notifs.length > 0 && (
        <div className="
          px-4 py-2 border-t border-[var(--border-lt)]
          bg-[var(--bg-surface)] text-center flex-shrink-0
        ">
          <p className="text-[10px] text-[var(--text-4)]">
            {notifs.length} notification{notifs.length !== 1 ? 's' : ''} total
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Individual Notification Item
 */
function NotificationItem({
  notification,
  onMarkRead,
  onNavigate,
}: {
  notification: AppNotification
  onMarkRead: () => void
  onNavigate: () => void
}) {
  return (
    <div
      onClick={() => {
        onMarkRead()
        onNavigate()
      }}
      className="
        px-4 py-2.5 border-b border-[var(--border-lt)]
        flex gap-3 items-start cursor-pointer
        transition-colors duration-150
        hover:bg-[var(--bg-surface)]
      "
      style={{
        background: notification.read ? 'transparent' : 'rgba(27,39,98,0.05)',
      }}
    >
      {/* Icon */}
      <div className="
        w-8 h-8 rounded-lg flex-shrink-0 mt-0.5
        bg-[var(--bg-surface)] border border-[var(--border)]
        flex items-center justify-center text-sm
      ">
        {notification.icon || NOTIF_ICONS[notification.type]}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`
            text-xs leading-snug
            ${notification.read ? 'font-medium' : 'font-bold'}
            text-[var(--text-1)]
          `}>
            {notification.title}
          </p>
          {!notification.read && (
            <div className="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0 mt-1" />
          )}
        </div>
        <p className="text-[11px] text-[var(--text-3)] leading-relaxed mt-0.5">
          {notification.body}
        </p>
        <p className="text-[10px] text-[var(--text-4)] mt-1">
          {timeAgo(notification.createdAt)}
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
  dark,
  setDark,
  soundEnabled,
  setSoundEnabled,
}: {
  onClose: () => void
  dark: boolean
  setDark: (v: boolean) => void
  soundEnabled: boolean
  setSoundEnabled: (v: boolean) => void
}) {
  const { users, currentUserId, updateUser, logout, profileImages, setProfileImage } = useApp()
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentUserId) return
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be under 2 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setProfileImage(currentUserId, reader.result)
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setPwError('')
    if (newPw || currentPw) {
      if (!currentPw) {
        setPwError('Enter your current password to change it.')
        return
      }
      if (newPw.length < 6) {
        setPwError('New password must be at least 6 characters.')
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
                  className="
                    absolute bottom-0 right-0
                    w-6 h-6 rounded-full
                    bg-primary-500 border-2 border-[var(--bg-card)]
                    cursor-pointer flex items-center justify-center
                    text-xs hover:bg-primary-600 transition-colors
                  "
                  title="Change photo"
                >
                  📷
                </button>
              </div>
              <div>
                <p className="text-sm font-bold text-[var(--text-1)]">{currentUser?.name}</p>
                <p className="text-xs text-[var(--text-3)] mt-0.5">@{currentUser?.username}</p>
                <span className="
                  inline-block mt-2 px-2 py-0.5 text-[10px] font-semibold
                  bg-blue-100 text-blue-700 rounded-full
                ">
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
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>

          {/* Preferences Section */}
          <div className="acct-section">
            <p className="acct-label">Preferences</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--text-2)]">Dark Mode</label>
                <Toggle on={dark} onChange={setDark} />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--text-2)]">Sound Alerts</label>
                <Toggle on={soundEnabled} onChange={setSoundEnabled} />
              </div>
            </div>
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
        <div className="
          px-5 py-3 border-t border-[var(--border-lt)]
          bg-[var(--bg-surface)] flex gap-2 flex-shrink-0
        ">
          <button
            onClick={() => void logout()}
            className="
              flex-1 px-3 py-2 rounded-lg
              border border-red-300 bg-red-50
              text-red-700 text-xs font-semibold
              hover:bg-red-100 transition-colors
            "
          >
            🚪 Sign Out
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className={`
              flex-2 px-3 py-2 rounded-lg
              text-white text-xs font-semibold
              border-none cursor-pointer transition-colors
              ${saving ? 'bg-gray-500' : saved ? 'bg-green-600' : 'bg-primary-500 hover:bg-primary-600'}
            `}
          >
            {saving ? '⟳ Saving…' : saved ? '✓ Saved!' : '💾 Save Changes'}
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
    invoices,
    users,
    currentUserId,
    activeModule,
    setModule,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    profileImages,
    toggleSidebar,
    getVisibleRepairs,
    showToast,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin = currentUser?.role === 'director'
  const isFinance = currentUser?.role === 'finance_officer'

  const [panelOpen, setPanelOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [dark, setDark] = useDarkMode()
  const [soundEnabled, setSoundEnabled] = useSoundPreference()
  const [dateLabel, setDateLabel] = useState('')

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
  const baseNotifs = notifications.filter(n => n.userId === currentUserId)
  const canAssignRepairs = ['director', 'technical_lead'].includes(currentUser?.role ?? '')
  const pendingTickets = canAssignRepairs
    ? getVisibleRepairs().filter(r => r.status === 'received')
    : []

  const ticketNotifs: AppNotification[] = pendingTickets.map(r => ({
    id: `pending-ticket-${r.id}`,
    userId: currentUserId || '',
    type: 'repair',
    title: 'Action Required: Unassigned Ticket',
    body: `${r.ref} — ${r.productName} needs to be assigned.`,
    module: 'repair',
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

  const unpaidInvoices = invoices.filter(
    i => i.type === 'customer_invoice' && i.status === 'posted'
  ).length
  const overdueBills = invoices.filter(i => i.type === 'vendor_bill' && i.status === 'overdue')
    .length

  const handleBellClick = useCallback(() => {
    setNotifOpen(v => !v)
    setPanelOpen(false)
  }, [])

  const handleAvatarClick = useCallback(() => {
    setPanelOpen(v => !v)
    setNotifOpen(false)
  }, [])

  return (
    <>
      <header className="
        flex items-center gap-4 px-5 py-0 flex-shrink-0
        border-b border-[var(--topbar-border)]
        bg-[var(--topbar-bg)] h-14
        shadow-sm transition-all duration-200
      ">
        {/* Hamburger Menu - Mobile */}
        <button
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0
            bg-[var(--bg-surface)] border border-[var(--border)]
            hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
          onClick={toggleSidebar}
          aria-label="Toggle menu"
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
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-[var(--text-1)]">{displayTitle.label}</h1>
          <p className="text-[10px] hidden sm:block text-[var(--text-4)]">
            {displayTitle.desc}
          </p>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 md:gap-2">
          {/* Financial Badges */}
          {unpaidInvoices > 0 && (
            <div className="
              hidden sm:flex items-center gap-1.5 px-2.5 py-1.5
              rounded-lg text-[11px] cursor-pointer
              bg-green-100 text-green-700 border border-green-200
            ">
              💰 {unpaidInvoices} to collect
            </div>
          )}
          {overdueBills > 0 && (
            <div className="
              hidden sm:flex items-center gap-1.5 px-2.5 py-1.5
              rounded-lg text-[11px] cursor-pointer
              bg-red-100 text-red-700 border border-red-200
            ">
              ⚠️ {overdueBills} overdue
            </div>
          )}

          {/* Date */}
          <div className="text-[10px] hidden md:block text-[var(--text-4)]">{dateLabel}</div>

          {/* Dark Mode Toggle */}
          <button
            title={dark ? 'Light mode' : 'Dark mode'}
            onClick={() => setDark(!dark)}
            className="
              w-9 h-9 rounded-lg flex items-center justify-center
              bg-[var(--bg-surface)] border border-[var(--border)]
              hover:bg-[var(--bg-muted)] transition-colors cursor-pointer text-base
            "
          >
            {dark ? '☀️' : '🌙'}
          </button>

          {/* Notifications Bell */}
          <div className="relative">
            <button
              onClick={handleBellClick}
              className={`
                w-9 h-9 rounded-lg flex items-center justify-center
                border transition-all duration-150 cursor-pointer text-base
                ${notifOpen
                  ? 'bg-blue-100 border-blue-300'
                  : 'bg-[var(--bg-surface)] border-[var(--border)] hover:bg-[var(--bg-muted)]'
                }
              `}
            >
              🔔
              {unreadCount > 0 && (
                <span className="
                  absolute -top-1 -right-1 flex h-4 min-w-[16px]
                  items-center justify-center rounded-full
                  bg-red-500 px-1 text-[8px] font-bold text-white
                  shadow-sm border border-[var(--topbar-bg)]
                ">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <NotificationsPanel
                notifs={myNotifs}
                onClose={() => setNotifOpen(false)}
                onMarkRead={markNotificationRead}
                onMarkAll={markAllNotificationsRead}
                onNavigate={(mod, path) => {
                  setModule(mod)
                  const routeMap: Record<string, string> = {
                    dashboard: '/',
                    sales: '/sales',
                    pos: '/pos',
                    ecommerce: '/ecommerce',
                    kilimall: '/kilimall',
                    contacts: '/contacts',
                    aftersales: '/aftersales',
                    operations: '/operations',
                    inventory: '/operations',
                    purchase: '/purchase',
                    delivery: '/delivery',
                    repair: '/repairs',
                    refurbishment: '/refurbishment',
                    outsource: '/outsource',
                    accounting: '/finance',
                    expenses: '/expenses',
                    cashbook: '/finance',
                    hr: '/hr',
                    documents: '/hr',
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
            className={`
              flex items-center gap-2 rounded-lg px-2.5 py-1.5
              border transition-all duration-150 cursor-pointer
              ${panelOpen
                ? 'bg-blue-100 border-blue-300'
                : 'bg-[var(--bg-surface)] border-[var(--border)] hover:bg-[var(--bg-muted)]'
              }
            `}
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
            <div className="min-w-0 hidden sm:block text-left">
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
          dark={dark}
          setDark={setDark}
          soundEnabled={soundEnabled}
          setSoundEnabled={setSoundEnabled}
        />
      )}
    </>
  )
}
