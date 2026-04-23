'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp, ModuleId, AppNotification } from '@/lib/store'
import { formatRoleLabel } from '@/lib/auth/access'

const titles: Record<ModuleId, { label: string; desc: string }> = {
  dashboard:  { label: 'Dashboard',      desc: 'Business overview' },
  sales:      { label: 'Sales',          desc: 'Quotations, orders & invoices' },
  crm:        { label: 'CRM',            desc: 'Customer relationship management' },
  inventory:  { label: 'Inventory',      desc: 'Products & stock management' },
  contacts:   { label: 'Contacts',       desc: 'Customers, vendors & individuals' },
  purchase:   { label: 'Purchase',       desc: 'Purchase orders & vendor bills' },
  pos:        { label: 'Point of Sale',  desc: 'In-store checkout' },
  repair:     { label: 'Repairs',        desc: 'Repair orders & service jobs' },
  refurbishment: { label: 'Refurbishment', desc: 'Refurbish devices for resale' },
  delivery:   { label: 'Delivery',       desc: 'Order fulfillment & dispatch' },
  ecommerce:  { label: 'eCommerce',      desc: 'Online store management' },
  kilimall:   { label: 'Kilimall',       desc: 'Kilimall marketplace orders & settlements' },
  accounting: { label: 'Accounting',     desc: 'Invoices, bills & payments' },
  hr:         { label: 'HR',             desc: 'Employees, leave, payroll & self-service' },
  outsource:  { label: 'Outsource',      desc: 'Track machines sent out for external repair' },
  expenses:   { label: 'Expenses',       desc: 'Submit & approve staff expense claims' },
  after_sales: { label: 'After-Sales',         desc: 'Warranty management and customer returns' },
  sops:        { label: 'Performance Targets', desc: 'Performance targets and progress tracking' },
  leave:      { label: 'Leave',          desc: 'Apply for leave & view your balances' },
  my_documents: { label: 'SOPs', desc: 'Standard Operating Procedures reference library' },
}

const NOTIF_ICONS: Record<AppNotification['type'], string> = {
  assignment: '📋',
  leave:      '🌴',
  asset:      '💻',
  expense:    '💰',
  system:     '⚙️',
  repair:     '🔧',
}

// ── Dark-mode hook ────────────────────────────────────────────────────────────
function useDarkMode(): [boolean, (v: boolean) => void] {
  // Start false on both server and client — no hydration mismatch
  const [dark, setDark] = useState(false)

  // After hydration: read preference and apply without touching localStorage
  useEffect(() => {
    const stored = localStorage.getItem('deed-dark') === 'true'
    setDark(stored)
    document.documentElement.classList.toggle('dark', stored)
  }, [])

  // Explicit setter: persist immediately when user changes the value
  const setDarkPersist = useCallback((v: boolean) => {
    setDark(v)
    document.documentElement.classList.toggle('dark', v)
    localStorage.setItem('deed-dark', String(v))
  }, [])

  return [dark, setDarkPersist]
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="toggle-track"
      style={{ background: on ? '#1B2762' : 'var(--border)' }}
      onClick={() => onChange(!on)}
      role="switch" aria-checked={on}
    >
      <div className="toggle-thumb" style={{ transform: on ? 'translateX(18px)' : 'translateX(0)' }} />
    </div>
  )
}

// ── Time-ago formatter ────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Notifications Panel ───────────────────────────────────────────────────────
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
  onNavigate: (module: ModuleId) => void
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
      style={{
        position: 'fixed', top: 57, right: 8,
        width: 'min(360px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 72px)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
        zIndex: 300,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-lt)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Notifications</span>
          {unread > 0 && (
            <span style={{
              background: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700,
              borderRadius: 20, padding: '1px 6px', minWidth: 18, textAlign: 'center',
            }}>{unread}</span>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={onMarkAll}
            style={{ fontSize: 11, color: '#1B2762', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {notifs.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-4)', fontSize: 12 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🔔</div>
            <p>No notifications yet</p>
            <p style={{ fontSize: 10, marginTop: 4 }}>You&apos;ll see assignments, approvals and updates here</p>
          </div>
        ) : notifs.map(n => (
          <div
            key={n.id}
            onClick={() => {
              onMarkRead(n.id)
              if (n.module) onNavigate(n.module)
              onClose()
            }}
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border-lt)',
              display: 'flex', gap: 10, alignItems: 'flex-start',
              cursor: 'pointer',
              background: n.read ? 'transparent' : 'rgba(27,39,98,0.05)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = n.read ? 'transparent' : 'rgba(27,39,98,0.05)' }}
          >
            {/* Icon */}
            <div style={{
              width: 34, height: 34, borderRadius: 9, flexShrink: 0,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
              marginTop: 1,
            }}>
              {n.icon || NOTIF_ICONS[n.type]}
            </div>
            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                <p style={{ fontSize: 12, fontWeight: n.read ? 500 : 700, color: 'var(--text-1)', lineHeight: 1.3 }}>
                  {n.title}
                </p>
                {!n.read && (
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#1B2762', flexShrink: 0, marginTop: 3 }} />
                )}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4, marginTop: 2 }}>{n.body}</p>
              <p style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4 }}>{timeAgo(n.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>

      {notifs.length > 0 && (
        <div style={{
          padding: '8px 16px', borderTop: '1px solid var(--border-lt)',
          background: 'var(--bg-surface)', textAlign: 'center', flexShrink: 0,
        }}>
          <p style={{ fontSize: 10, color: 'var(--text-4)' }}>{notifs.length} notification{notifs.length !== 1 ? 's' : ''} total</p>
        </div>
      )}
    </div>
  )
}

// ── Account Settings Panel ────────────────────────────────────────────────────
function AccountPanel({
  onClose,
  dark,
  setDark,
}: {
  onClose: () => void
  dark: boolean
  setDark: (v: boolean) => void
}) {
  const { users, currentUserId, updateUser, logout, profileImages, setProfileImage } = useApp()
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const avatar = currentUserId ? (profileImages[currentUserId] ?? null) : null

  const [name,       setName]       = useState(currentUser?.name ?? '')
  const [username,   setUsername]   = useState(currentUser?.username ?? '')
  const [currentPw,  setCurrentPw]  = useState('')
  const [newPw,      setNewPw]      = useState('')
  const [confirmPw,  setConfirmPw]  = useState('')
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [pwError,    setPwError]    = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: 8, padding: '8px 12px',
    fontSize: 12, color: 'var(--text-1)',
    outline: 'none', fontFamily: 'Inter, sans-serif',
    transition: 'border-color 0.15s',
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentUserId) return
    if (file.size > 2 * 1024 * 1024) { alert('Image must be under 2 MB'); return }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setProfileImage(currentUserId, reader.result)
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setPwError('')
    if (newPw || currentPw) {
      if (!currentPw) { setPwError('Enter your current password to change it.'); return }
      if (newPw.length < 6) { setPwError('New password must be at least 6 characters.'); return }
      if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    }
    setSaving(true)
    try {
      const payload: Record<string, string> = {}
      if (name.trim() && name !== currentUser?.name) payload.name = name.trim()
      if (username.trim() && username !== currentUser?.username) payload.username = username.trim()
      if (newPw) payload.password = newPw
      if (Object.keys(payload).length > 0 && currentUserId) {
        await updateUser(currentUserId, payload)
      }
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
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
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border-lt)', flexShrink: 0,
        }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Account Settings</p>
            <p style={{ fontSize: 10, color: 'var(--text-4)' }}>Edit your profile, photo and preferences</p>
          </div>
          <button onClick={onClose} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 8, width: 32, height: 32, cursor: 'pointer',
            fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-3)',
          }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 24 }}>

          {/* ── Profile photo ── */}
          <div className="acct-section">
            <p className="acct-label">Profile Photo</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  width: 72, height: 72, borderRadius: '50%',
                  background: avatar ? 'transparent' : 'linear-gradient(135deg, #1B2762, #00B0D7)',
                  overflow: 'hidden',
                  border: '3px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(27,39,98,0.2)',
                }}>
                  {avatar
                    ? <img src={avatar} alt="profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ color: '#fff', fontWeight: 700, fontSize: 22 }}>{initials}</span>
                  }
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 24, height: 24, borderRadius: '50%',
                    background: '#1B2762', border: '2px solid var(--bg-card)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11,
                  }}
                  title="Change photo"
                >📷</button>
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{currentUser?.name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>@{currentUser?.username}</p>
                <span style={{
                  display: 'inline-block', marginTop: 5, fontSize: 10, fontWeight: 600,
                  background: '#E8F3FA', color: '#1B2762', padding: '2px 8px', borderRadius: 20,
                }}>{formatRoleLabel(currentUser?.role)}</span>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => fileRef.current?.click()}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '5px 10px',
                      background: '#1B2762', color: '#fff', border: 'none',
                      borderRadius: 7, cursor: 'pointer',
                    }}
                  >Upload Photo</button>
                  {avatar && (
                    <button
                      onClick={() => currentUserId && setProfileImage(currentUserId, '')}
                      style={{
                        fontSize: 11, padding: '5px 10px',
                        background: 'var(--bg-surface)', color: 'var(--text-3)',
                        border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer',
                      }}
                    >Remove</button>
                  )}
                </div>
              </div>
              <input
                ref={fileRef} type="file" accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageUpload}
              />
            </div>
          </div>

          {/* ── Profile fields ── */}
          <div className="acct-section">
            <p className="acct-label">Profile</p>
            <div className="acct-field">
              <label>Display Name</label>
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
                placeholder="Your full name"
                onFocus={e => { e.currentTarget.style.borderColor = '#1B2762' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-border)' }} />
            </div>
            <div className="acct-field" style={{ marginBottom: 0 }}>
              <label>Username</label>
              <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)}
                placeholder="login username"
                onFocus={e => { e.currentTarget.style.borderColor = '#1B2762' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-border)' }} />
            </div>
          </div>

          {/* ── Password ── */}
          <div className="acct-section">
            <p className="acct-label">Change Password</p>
            <div className="acct-field">
              <label>Current Password</label>
              <input type="password" style={inputStyle} value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                placeholder="••••••••"
                onFocus={e => { e.currentTarget.style.borderColor = '#1B2762' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-border)' }} />
            </div>
            <div className="acct-field">
              <label>New Password</label>
              <input type="password" style={inputStyle} value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="Min 6 characters"
                onFocus={e => { e.currentTarget.style.borderColor = '#1B2762' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-border)' }} />
            </div>
            <div className="acct-field" style={{ marginBottom: 0 }}>
              <label>Confirm New Password</label>
              <input type="password" style={inputStyle} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                placeholder="Repeat new password"
                onFocus={e => { e.currentTarget.style.borderColor = '#1B2762' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--input-border)' }} />
            </div>
            {pwError && <p style={{ fontSize: 11, color: '#EF4444', marginTop: 6 }}>{pwError}</p>}
          </div>

          {/* ── Preferences ── */}
          <div className="acct-section">
            <p className="acct-label">Preferences</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: dark ? '#1E2235' : '#FEF9C3',
                  border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                }}>
                  {dark ? '🌙' : '☀️'}
                </div>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>Dark Mode</p>
                  <p style={{ fontSize: 10, color: 'var(--text-4)' }}>{dark ? 'Dark theme active' : 'Light theme active'}</p>
                </div>
              </div>
              <Toggle on={dark} onChange={setDark} />
            </div>
          </div>

          {/* ── Account info ── */}
          <div className="acct-section" style={{ borderBottom: 'none' }}>
            <p className="acct-label">Account Info</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[
                { label: 'Role',         value: formatRoleLabel(currentUser?.role) },
                { label: 'Status',       value: currentUser?.active ? 'Active' : 'Inactive' },
                { label: 'Member since', value: currentUser?.createdAt ? new Date(currentUser.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
                { label: 'Modules',      value: `${currentUser?.modules?.length ?? 0} modules` },
              ].map(row => (
                <div key={row.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '7px 0', borderBottom: '1px solid var(--border-lt)',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{row.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-1)' }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--border-lt)',
          display: 'flex', gap: 8, background: 'var(--bg-surface)', flexShrink: 0,
        }}>
          <button
            onClick={() => { void logout() }}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 9,
              border: '1px solid #FECACA', background: '#FEF2F2',
              color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >🚪 Sign Out</button>
          <button
            onClick={() => { void handleSave() }}
            disabled={saving}
            style={{
              flex: 2, padding: '9px 0', borderRadius: 9,
              background: saved ? '#059669' : '#1B2762',
              color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: 'none', transition: 'background 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >{saving ? '⟳ Saving…' : saved ? '✓ Saved!' : '💾 Save Changes'}</button>
        </div>
      </div>
    </>
  )
}

// ── Main Topbar ────────────────────────────────────────────────────────────────
export default function Topbar() {
  const {
    activeModule, invoices, users, currentUserId,
    notifications, markNotificationRead, markAllNotificationsRead,
    profileImages, setModule, toggleSidebar,
  } = useApp()
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin = currentUser?.role === 'admin'

  const [panelOpen,  setPanelOpen]  = useState(false)
  const [notifOpen,  setNotifOpen]  = useState(false)
  const [dark,       setDark]       = useDarkMode()
  const [dateLabel,  setDateLabel]  = useState('')
  useEffect(() => {
    setDateLabel(new Date().toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))
  }, [])

  const myNotifs = notifications.filter(n => n.userId === currentUserId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const unreadCount = myNotifs.filter(n => !n.read).length

  const avatar = currentUserId ? (profileImages[currentUserId] ?? null) : null
  const initials = (currentUser?.name ?? '??').slice(0, 2).toUpperCase()

  const t = activeModule === 'hr' && !isAdmin
    ? { label: 'Leave', desc: 'Apply for leave & view your balances' }
    : titles[activeModule]

  const unpaidInvoices = invoices.filter(i => i.type === 'customer_invoice' && i.status === 'posted').length
  const overdueBills   = invoices.filter(i => i.type === 'vendor_bill'      && i.status === 'overdue').length

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
      <header
        className="flex items-center gap-4 px-5 py-0 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--topbar-border)',
          background: 'var(--topbar-bg)',
          height: 56,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          transition: 'background 0.2s, border-color 0.2s',
          position: 'relative',
        }}>

        {/* Hamburger — visible on tablet + phone (below md = 768px) */}
        <button
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', cursor: 'pointer' }}
          onClick={toggleSidebar}
          aria-label="Toggle menu"
        >
          <svg width="16" height="14" viewBox="0 0 16 14" fill="none" style={{ color: 'var(--text-2)' }}>
            <path d="M0 1h16M0 7h16M0 13h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{t.label}</h1>
          {/* Description hidden on phones (< 480px) */}
          <p className="text-[10px] hidden sm:block" style={{ color: 'var(--text-4)' }}>{t.desc}</p>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5 md:gap-2">
          {/* Financial badges — hidden on phones (< 480px) */}
          {unpaidInvoices > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer"
              style={{ background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0' }}>
              💰 {unpaidInvoices} to collect
            </div>
          )}
          {overdueBills > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer"
              style={{ background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' }}>
              ⚠️ {overdueBills} overdue
            </div>
          )}

          {/* Date — hidden on phones + tablets (< 768px) */}
          <div className="text-[10px] hidden md:block" style={{ color: 'var(--text-4)' }}>
            {dateLabel}
          </div>

          {/* Dark mode quick-toggle */}
          <button
            title={dark ? 'Light mode' : 'Dark mode'}
            onClick={() => setDark(!dark)}
            style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            {dark ? '☀️' : '🌙'}
          </button>

          {/* Bell with badge */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={handleBellClick}
              style={{
                background: notifOpen ? '#E8F3FA' : 'var(--bg-surface)',
                border: `1px solid ${notifOpen ? '#A8D4E8' : 'var(--border)'}`,
                borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', position: 'relative',
              }}>
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: '#EF4444', color: '#fff',
                  fontSize: 9, fontWeight: 800,
                  borderRadius: 10, minWidth: 16, height: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 3px', border: '1.5px solid var(--topbar-bg)',
                  lineHeight: 1,
                }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>

            {notifOpen && (
              <NotificationsPanel
                notifs={myNotifs}
                onClose={() => setNotifOpen(false)}
                onMarkRead={markNotificationRead}
                onMarkAll={markAllNotificationsRead}
                onNavigate={(mod) => { setModule(mod); setNotifOpen(false) }}
              />
            )}
          </div>

          {/* User chip */}
          <button
            onClick={handleAvatarClick}
            className="flex items-center gap-2 rounded-xl px-2.5 py-1.5"
            style={{
              background: panelOpen ? '#E8F3FA' : 'var(--bg-surface)',
              border: `1px solid ${panelOpen ? '#A8D4E8' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: avatar ? 'transparent' : 'linear-gradient(135deg, #1B2762, #00B0D7)',
              overflow: 'hidden', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {avatar
                ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>{initials}</span>
              }
            </div>
            <div className="min-w-0 hidden sm:block text-left">
              <div className="text-[11px] font-semibold" style={{ color: 'var(--text-1)' }}>{currentUser?.name ?? 'Guest'}</div>
              <div className="text-[9px]" style={{ color: 'var(--text-4)' }}>{formatRoleLabel(currentUser?.role)}</div>
            </div>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--text-4)', flexShrink: 0 }}>
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      {panelOpen && <AccountPanel onClose={() => setPanelOpen(false)} dark={dark} setDark={setDark} />}
    </>
  )
}
