'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Fa } from '@/components/icons'
import {
  faBell,
  faBullseye,
  faCheck,
  faChevronRight,
  faCog,
  faEnvelope,
  faKey,
  faLandmark,
  faShieldHalved,
  faUpload,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import ProductionEnvSettings from './ProductionEnvSettings'

type ToastType = 'success' | 'error' | 'info'

type SecurityOverview = {
  ok: boolean
  generatedAt: string
  summary: {
    mfaEnforced: boolean
    activeSessions: number
    failedLogins24h: number
    lastSecurityEventAt: string | null
    privilegedUsers: number
    activeMfaUsers: number
    enrolledMfaUsers: number
    activeApiKeys: number
    rotatedAt: string | null
    ipAllowlist: string[]
  }
  passwordPolicy: {
    minimumLength: number
    requireUppercase: boolean
    requireLowercase: boolean
    requireNumbers: boolean
    requireSpecial: boolean
    rotationDays: number
    preventReuseCount: number
  }
  sessionPolicy: {
    jwtHours: number
    inactivityMinutes: number
  }
  securityControls: {
    defaultDenyStore: boolean
    sameOriginWrites: boolean
    csp: boolean
    hsts: boolean
    uploadGuards: boolean
    auditLogging: boolean
    rowLevelAuthorization: boolean
  }
  sessions: Array<{
    id: string
    userId: string
    name: string
    username: string
    ipAddress: string
    userAgent: string
    createdAt: string | null
    expiresAt: string | null
  }>
  audits: Array<{
    id: string
    name: string
    username: string
    action: string
    entityType: string
    entityKey: string
    ipAddress: string
    createdAt: string | null
  }>
  api: {
    activeKeys: number
    readRateLimitPerMinute: number
    writeRateLimitPerMinute: number
    partnerRateLimitPerMinute: number
  }
}

type Props = {
  currentUser: {
    id: string
    name: string
    username: string
    role: string
  } | null | undefined
  systemSettings: {
    auditLogs: boolean
    secDisableProductDeletion: boolean
    secDisableStockManipulation: boolean
    secDisableInvoiceEditAfterValidation: boolean
    secPortalRequirePhoneVerification: boolean
  }
  showToast: (message: string, type?: ToastType) => void
  onOpenUserAccess: () => void
}

const cardClass = 'rounded-[18px] border border-[#DDE5EF] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
const titleClass = 'text-[13px] font-bold tracking-[-0.01em] text-[#111827]'
const mutedClass = 'text-[10.5px] leading-[1.45] text-[#778399]'

function ToggleDisplay({ on, onClick, disabled = false, label }: { on: boolean; onClick?: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="relative inline-flex h-[20px] w-[36px] flex-shrink-0 items-center rounded-full border border-transparent transition-all disabled:cursor-default disabled:opacity-70"
      style={{ background: on ? '#16A365' : '#D8DEE8' }}
    >
      <span
        className="h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: on ? 'translateX(17px)' : 'translateX(1px)' }}
      />
    </button>
  )
}

function StatusPill({ children, tone = 'green' }: { children: React.ReactNode; tone?: 'green' | 'blue' | 'amber' | 'red' | 'gray' }) {
  const tones = {
    green: 'border-[#CFEBDD] bg-[#EFF9F4] text-[#168653]',
    blue: 'border-[#CFE6F5] bg-[#EEF7FC] text-[#087AB3]',
    amber: 'border-[#F8DEB9] bg-[#FFF7EA] text-[#B66A00]',
    red: 'border-[#F4C5C5] bg-[#FFF1F1] text-[#D23939]',
    gray: 'border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]',
  }
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold ${tones[tone]}`}>{children}</span>
}

function IconBox({ icon, tone = 'green' }: { icon: any; tone?: 'green' | 'blue' | 'amber' | 'slate' | 'cyan' }) {
  const tones = {
    green: { bg: '#EAF8F1', fg: '#168B58' },
    blue: { bg: '#EDF4FF', fg: '#2563EB' },
    amber: { bg: '#FFF4E3', fg: '#E78A12' },
    slate: { bg: '#F1F5F9', fg: '#64748B' },
    cyan: { bg: '#EAF8FC', fg: 'var(--primary)' },
  }
  return (
    <span
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px]"
      style={{ background: tones[tone].bg, color: tones[tone].fg }}
    >
      <Fa icon={icon} style={{ fontSize: 14 }} />
    </span>
  )
}

function SummaryCard({
  icon,
  tone,
  label,
  value,
  detail,
  valueTone = 'default',
}: {
  icon: any
  tone: 'green' | 'blue' | 'amber' | 'cyan'
  label: string
  value: React.ReactNode
  detail: string
  valueTone?: 'default' | 'green' | 'blue' | 'amber'
}) {
  const valueColor =
    valueTone === 'green' ? '#168653'
      : valueTone === 'blue' ? '#0F67D8'
        : valueTone === 'amber' ? '#D97706'
          : '#172033'
  return (
    <div className={`${cardClass} flex min-h-[105px] items-center gap-3 px-4 py-4`}>
      <IconBox icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-[#667085]">{label}</p>
        <p className="mt-1 text-[20px] font-black tracking-[-0.03em]" style={{ color: valueColor }}>{value}</p>
        <p className="mt-1 truncate text-[9.5px] text-[#7A8699]">{detail}</p>
      </div>
    </div>
  )
}

function SecurityStatusRow({
  icon,
  tone,
  title,
  detail,
  status,
  statusTone = 'green',
  onClick,
}: {
  icon: any
  tone: 'green' | 'blue' | 'amber' | 'slate' | 'cyan'
  title: string
  detail: string
  status: string
  statusTone?: 'green' | 'blue' | 'amber' | 'red' | 'gray'
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center gap-3 border-b border-[#EDF1F6] px-3 py-2.5 text-left last:border-b-0 disabled:cursor-default disabled:opacity-100"
    >
      <IconBox icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-bold text-[#182033]">{title}</span>
        <span className="mt-0.5 block truncate text-[9.5px] text-[#7A8699]">{detail}</span>
      </span>
      <StatusPill tone={statusTone}>{status}</StatusPill>
      {onClick && <Fa icon={faChevronRight} className="text-[#9BA8BA]" style={{ fontSize: 8 }} />}
    </button>
  )
}

function QuickAction({
  label,
  icon,
  tone = 'blue',
  onClick,
  disabled = false,
}: {
  label: string
  icon: any
  tone?: 'blue' | 'red' | 'cyan' | 'navy'
  onClick: () => void
  disabled?: boolean
}) {
  const tones = {
    blue: { border: '#9FC6F4', text: '#0D67C7', bg: '#FFFFFF' },
    red: { border: '#F4A8A8', text: '#E23636', bg: '#FFFDFD' },
    cyan: { border: '#9DDDF1', text: '#0780AF', bg: '#FFFFFF' },
    navy: { border: '#B7B0D8', text: 'var(--navy)', bg: '#FFFFFF' },
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border px-4 text-left text-[10.5px] font-bold transition hover:-translate-y-[1px] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderColor: tones[tone].border, color: tones[tone].text, background: tones[tone].bg }}
    >
      <Fa icon={icon} style={{ fontSize: 12 }} />
      <span>{label}</span>
    </button>
  )
}

function SubPanel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className={`${cardClass} overflow-hidden`}>
      <div className="flex items-start justify-between border-b border-[#EDF1F6] px-4 py-3.5">
        <div>
          <h4 className={titleClass}>{title}</h4>
          <p className="mt-0.5 text-[9.5px] text-[#8995A7]">{subtitle}</p>
        </div>
        <Fa icon={faChevronRight} className="rotate-90 text-[#68768C]" style={{ fontSize: 8 }} />
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

function RowSetting({
  title,
  detail,
  right,
}: {
  title: string
  detail: string
  right: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[#EDF1F6] py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-[#20283A]">{title}</p>
        <p className="mt-0.5 text-[8.8px] leading-[1.35] text-[#8894A6]">{detail}</p>
      </div>
      <div className="flex-shrink-0">{right}</div>
    </div>
  )
}

function timeAgo(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const t = new Date(value).getTime()
  if (!Number.isFinite(t)) return 'Not recorded'
  const diff = Math.max(0, Date.now() - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function compactAgent(value: string) {
  if (!value || value === 'Unknown browser') return 'Current browser'
  const browser = /Edg\//.test(value) ? 'Edge' : /Chrome\//.test(value) ? 'Chrome' : /Firefox\//.test(value) ? 'Firefox' : /Safari\//.test(value) ? 'Safari' : 'Browser'
  const os = /Windows/i.test(value) ? 'Windows' : /Android/i.test(value) ? 'Android' : /iPhone|iPad/i.test(value) ? 'iOS' : /Mac OS/i.test(value) ? 'macOS' : ''
  return os ? `${browser} on ${os}` : browser
}

function codeLabel(value: string) {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

export default function SecuritySettingsDashboard({
  currentUser,
  systemSettings,
  showToast,
  onOpenUserAccess,
}: Props) {
  const [overview, setOverview] = useState<SecurityOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(false)
  const [showEnvironment, setShowEnvironment] = useState(false)

  const refresh = useCallback(async (announce = false) => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/security/overview', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not load security status')
      setOverview(data)
      if (announce) showToast('Security status refreshed', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load security status', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  const dataProtectionEnabled =
    systemSettings.secDisableProductDeletion
    && systemSettings.secDisableStockManipulation
    && systemSettings.secDisableInvoiceEditAfterValidation
    && systemSettings.secPortalRequirePhoneVerification

  const activeSessions = overview?.sessions?.length
    ? overview.sessions
    : currentUser
      ? [{
          id: 'current-session',
          userId: currentUser.id,
          name: currentUser.name || currentUser.username,
          username: currentUser.username,
          ipAddress: 'This device',
          userAgent: 'Current browser',
          createdAt: new Date().toISOString(),
          expiresAt: null,
        }]
      : []

  const password = overview?.passwordPolicy
  const mfaEnforced = Boolean(overview?.summary.mfaEnforced)
  const ipAllowlist = overview?.summary.ipAllowlist || []
  const auditRows = overview?.audits || []
  const securityEvent = overview?.summary.lastSecurityEventAt

  const revokeAll = async () => {
    if (currentUser?.role !== 'director') {
      showToast('Only the Director can revoke every other user session.', 'error')
      return
    }
    if (!window.confirm('Force every other ERP user to sign in again? Your current Director session will remain active.')) return
    setRevoking(true)
    try {
      const response = await fetch('/api/admin/security/sessions', { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not revoke sessions')
      showToast(data.message || 'Sessions revoked', 'success')
      await refresh(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not revoke sessions', 'error')
    } finally {
      setRevoking(false)
    }
  }

  const downloadReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      generatedBy: currentUser ? { id: currentUser.id, username: currentUser.username, role: currentUser.role } : null,
      overview,
      dataProtection: {
        disableProductDeletion: systemSettings.secDisableProductDeletion,
        disableManualStockManipulation: systemSettings.secDisableStockManipulation,
        lockValidatedInvoices: systemSettings.secDisableInvoiceEditAfterValidation,
        portalPhoneVerification: systemSettings.secPortalRequirePhoneVerification,
      },
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `deed-security-report-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    showToast('Security report downloaded', 'success')
  }

  const securityStatuses = useMemo(() => ([
    {
      icon: faShieldHalved,
      tone: 'green' as const,
      title: 'Multi-Factor Authentication',
      detail: 'Required for Director, Admin Officer & Finance Officer',
      status: mfaEnforced ? 'Enforced' : 'Needs setup',
      statusTone: mfaEnforced ? 'green' as const : 'amber' as const,
      onClick: currentUser?.role === 'director' ? () => setShowEnvironment(true) : undefined,
    },
    {
      icon: faKey,
      tone: 'cyan' as const,
      title: 'Password Policy',
      detail: `Minimum ${password?.minimumLength ?? 8} characters · last 5 passwords cannot be reused`,
      status: 'Enforced',
      statusTone: 'green' as const,
    },
    {
      icon: faBell,
      tone: 'blue' as const,
      title: 'Session Timeout',
      detail: `Inactive sessions expire after ${overview?.sessionPolicy.inactivityMinutes ?? 30} minutes`,
      status: 'Enforced',
      statusTone: 'green' as const,
    },
    {
      icon: faBullseye,
      tone: ipAllowlist.length ? 'cyan' as const : 'slate' as const,
      title: 'IP Allowlist',
      detail: ipAllowlist.length ? `${ipAllowlist.length} approved address${ipAllowlist.length === 1 ? '' : 'es'} configured` : 'No production IP allowlist configured',
      status: ipAllowlist.length ? 'Configured' : 'Optional',
      statusTone: ipAllowlist.length ? 'blue' as const : 'gray' as const,
      onClick: currentUser?.role === 'director' ? () => setShowEnvironment(true) : undefined,
    },
    {
      icon: faLandmark,
      tone: systemSettings.auditLogs ? 'green' as const : 'amber' as const,
      title: 'Audit Logging',
      detail: 'Security and business audit events are retained in PostgreSQL',
      status: systemSettings.auditLogs ? 'Enabled' : 'Disabled',
      statusTone: systemSettings.auditLogs ? 'green' as const : 'amber' as const,
    },
    {
      icon: faShieldHalved,
      tone: dataProtectionEnabled ? 'green' as const : 'amber' as const,
      title: 'Data Protection',
      detail: 'Deletion, stock, invoice and portal safeguards',
      status: dataProtectionEnabled ? 'Enabled' : 'Review',
      statusTone: dataProtectionEnabled ? 'green' as const : 'amber' as const,
    },
    {
      icon: faUpload,
      tone: 'cyan' as const,
      title: 'Backup & Recovery',
      detail: 'Server backup posture is verified by the production security audit',
      status: 'Verify host',
      statusTone: 'blue' as const,
    },
  ]), [dataProtectionEnabled, ipAllowlist.length, mfaEnforced, overview?.sessionPolicy.inactivityMinutes, password?.minimumLength, currentUser?.role, systemSettings.auditLogs])

  return (
    <div className="security-dashboard min-w-0">
      <div className="mb-4 flex flex-col gap-3 border-b border-[#E7ECF3] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] border border-[#D4E8F0] bg-[#F4FBFE] text-[var(--primary)]">
            <Fa icon={faShieldHalved} style={{ fontSize: 16 }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[17px] font-black tracking-[-0.025em] text-[#151D2D]">
              Settings / <span className="text-[var(--primary-dark)]">Security</span>
            </h2>
            <p className="mt-1 text-[10.5px] text-[#778399]">Manage authentication, sessions, access control and system protection.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading}
          className="min-h-[38px] self-start rounded-xl border border-[#D7E0EA] bg-white px-4 text-[10.5px] font-bold text-[#435169] transition hover:bg-[#F8FAFC] disabled:opacity-50 sm:self-auto"
        >
          {loading ? 'Refreshing…' : 'Refresh status'}
        </button>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.78fr)]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              icon={faShieldHalved}
              tone="green"
              label="MFA Enforcement"
              value={loading ? '—' : mfaEnforced ? 'Enabled' : 'Review'}
              detail="For privileged roles"
              valueTone={mfaEnforced ? 'green' : 'amber'}
            />
            <SummaryCard
              icon={faUsers}
              tone="blue"
              label="Active Sessions"
              value={loading ? '—' : overview?.summary.activeSessions ?? activeSessions.length}
              detail="Across all users"
              valueTone="blue"
            />
            <SummaryCard
              icon={faKey}
              tone="amber"
              label="Failed Logins (24h)"
              value={loading ? '—' : overview?.summary.failedLogins24h ?? 0}
              detail="Account protection"
              valueTone="amber"
            />
            <SummaryCard
              icon={faShieldHalved}
              tone="blue"
              label="Last Security Event"
              value={loading ? '—' : timeAgo(securityEvent)}
              detail="Latest recorded audit activity"
              valueTone="blue"
            />
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_275px]">
            <section className={`${cardClass} overflow-hidden`}>
              <div className="border-b border-[#EDF1F6] px-4 py-3.5">
                <h3 className={titleClass}>Security Status</h3>
              </div>
              <div>
                {securityStatuses.map(item => (
                  <SecurityStatusRow key={item.title} {...item} />
                ))}
              </div>
            </section>

            <section className={`${cardClass} p-4`}>
              <h3 className={titleClass}>Quick Actions</h3>
              <div className="mt-4 space-y-3">
                <QuickAction
                  label={revoking ? 'Revoking Sessions…' : 'Force Logout All Sessions'}
                  icon={faShieldHalved}
                  tone="red"
                  onClick={() => void revokeAll()}
                  disabled={revoking || currentUser?.role !== 'director'}
                />
                <QuickAction
                  label="Rotate Secrets"
                  icon={faKey}
                  tone="navy"
                  onClick={() => setShowEnvironment(true)}
                  disabled={currentUser?.role !== 'director'}
                />
                <QuickAction
                  label="Security Audit"
                  icon={faBullseye}
                  tone="blue"
                  onClick={() => void refresh(true)}
                />
                <QuickAction
                  label="Backup Now"
                  icon={faUpload}
                  tone="cyan"
                  onClick={() => showToast('Backup execution remains a production-host operation. Use the security host audit before running a live backup.', 'info')}
                />
                <QuickAction
                  label="Download Security Report"
                  icon={faEnvelope}
                  tone="navy"
                  onClick={downloadReport}
                />
              </div>
            </section>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <SubPanel title="Authentication (MFA)" subtitle="Configure multi-factor authentication for enhanced account security.">
            <div>
              <p className="mb-1.5 text-[9.5px] font-black uppercase tracking-[0.08em] text-[#435169]">MFA Enforcement</p>
              <RowSetting
                title="Require MFA for privileged roles"
                detail="Director, Admin Officer & Finance Officer"
                right={
                  <ToggleDisplay
                    on={mfaEnforced}
                    label="Require MFA for privileged roles"
                    disabled={currentUser?.role !== 'director'}
                    onClick={currentUser?.role === 'director' ? () => setShowEnvironment(true) : undefined}
                  />
                }
              />

              <p className="mb-1.5 mt-3 text-[9.5px] font-black uppercase tracking-[0.08em] text-[#435169]">MFA Methods</p>
              <RowSetting
                title="Authenticator App (TOTP)"
                detail="Recommended · encrypted enrollment secret"
                right={<ToggleDisplay on label="Authenticator app enabled" disabled />}
              />
              <RowSetting
                title="SMS (Backup)"
                detail="Not enabled — authenticator app remains the secure fallback"
                right={<ToggleDisplay on={false} label="SMS backup disabled" disabled />}
              />

              <p className="mb-1.5 mt-3 text-[9.5px] font-black uppercase tracking-[0.08em] text-[#435169]">MFA Status</p>
              <RowSetting
                title="Privileged accounts protected"
                detail={overview ? `${overview.summary.activeMfaUsers} enrolled · ${overview.summary.privilegedUsers} eligible` : 'Loading enrollment status…'}
                right={<StatusPill tone={mfaEnforced ? 'green' : 'amber'}>{mfaEnforced ? 'Required' : 'Review'}</StatusPill>}
              />
            </div>
          </SubPanel>

          <SubPanel title="Password Policy" subtitle="Current password requirements enforced when passwords are created or changed.">
            <RowSetting
              title="Minimum length"
              detail="Minimum characters required"
              right={<span className="flex h-8 min-w-[48px] items-center justify-center rounded-lg border border-[#DDE5EF] bg-[#FAFCFE] px-2 text-[10px] font-bold text-[#334155]">{password?.minimumLength ?? 8}</span>}
            />
            <RowSetting title="Require uppercase letters" detail="Current policy state" right={<ToggleDisplay on={Boolean(password?.requireUppercase)} label="Require uppercase letters" disabled />} />
            <RowSetting title="Require lowercase letters" detail="Current policy state" right={<ToggleDisplay on={Boolean(password?.requireLowercase)} label="Require lowercase letters" disabled />} />
            <RowSetting title="Require numbers" detail="Current policy state" right={<ToggleDisplay on={Boolean(password?.requireNumbers)} label="Require numbers" disabled />} />
            <RowSetting title="Require special characters" detail="Current policy state" right={<ToggleDisplay on={Boolean(password?.requireSpecial)} label="Require special characters" disabled />} />
            <RowSetting
              title="Password rotation"
              detail={password?.rotationDays ? 'Force password change every configured period' : 'No forced age-based rotation configured'}
              right={<span className="flex h-8 min-w-[48px] items-center justify-center rounded-lg border border-[#DDE5EF] bg-[#FAFCFE] px-2 text-[10px] font-bold text-[#334155]">{password?.rotationDays || 'Off'}</span>}
            />
            <RowSetting
              title="Prevent password reuse"
              detail="Number of previous password hashes retained"
              right={<span className="flex h-8 min-w-[48px] items-center justify-center rounded-lg border border-[#DDE5EF] bg-[#FAFCFE] px-2 text-[10px] font-bold text-[#334155]">{password?.preventReuseCount ?? 5}</span>}
            />
          </SubPanel>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
        <section className={`${cardClass} min-w-0 overflow-hidden`}>
          <div className="flex items-start justify-between border-b border-[#EDF1F6] px-3.5 py-3">
            <div>
              <h4 className="text-[11px] font-bold text-[#182033]">Active Sessions</h4>
              <p className="mt-0.5 text-[8.7px] text-[#8894A6]">View and manage active user sessions.</p>
            </div>
            <button type="button" onClick={onOpenUserAccess} className="text-[#6B778A]"><Fa icon={faChevronRight} style={{ fontSize: 8 }} /></button>
          </div>
          <div className="px-3.5 py-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[300px] text-left">
                <thead>
                  <tr className="text-[7.5px] font-bold text-[#718096]">
                    <th className="pb-2">User</th>
                    <th className="pb-2">Device</th>
                    <th className="pb-2">IP</th>
                    <th className="pb-2 text-right">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.slice(0, 4).map(session => (
                    <tr key={session.id} className="border-t border-[#F0F3F7] text-[8px] text-[#4C596D]">
                      <td className="max-w-[72px] truncate py-2 font-semibold text-[#1E293B]">{session.name}</td>
                      <td className="max-w-[82px] truncate py-2">{compactAgent(session.userAgent)}</td>
                      <td className="max-w-[70px] truncate py-2 font-mono">{session.ipAddress}</td>
                      <td className="py-2 text-right">{timeAgo(session.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={onOpenUserAccess} className="mt-2 text-[8.5px] font-bold text-[var(--primary-dark)]">View all sessions →</button>
          </div>
        </section>

        <section className={`${cardClass} min-w-0 overflow-hidden`}>
          <div className="flex items-start justify-between border-b border-[#EDF1F6] px-3.5 py-3">
            <div>
              <h4 className="text-[11px] font-bold text-[#182033]">Audit Logs</h4>
              <p className="mt-0.5 text-[8.7px] text-[#8894A6]">View security-related events and activities.</p>
            </div>
            <Fa icon={faChevronRight} className="text-[#6B778A]" style={{ fontSize: 8 }} />
          </div>
          <div className="px-3.5 py-3">
            {auditRows.length ? (
              <div className="space-y-0">
                {auditRows.slice(0, 4).map(row => (
                  <div key={row.id} className="grid grid-cols-[68px_minmax(0,1fr)_72px] gap-2 border-b border-[#F0F3F7] py-2 text-[8px] last:border-b-0">
                    <span className="truncate text-[#667085]">{row.createdAt ? new Date(row.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }) : '—'}</span>
                    <span className="truncate font-semibold text-[#263247]">{codeLabel(row.action)}</span>
                    <span className="truncate text-right font-mono text-[#667085]">{row.ipAddress}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-5 text-center text-[9px] text-[#8A96A8]">No audit rows returned yet.</p>
            )}
            <button type="button" onClick={() => void refresh(true)} className="mt-2 text-[8.5px] font-bold text-[var(--primary-dark)]">Refresh logs →</button>
          </div>
        </section>

        <section className={`${cardClass} min-w-0 overflow-hidden`}>
          <div className="flex items-start justify-between border-b border-[#EDF1F6] px-3.5 py-3">
            <div>
              <h4 className="text-[11px] font-bold text-[#182033]">IP Allowlist</h4>
              <p className="mt-0.5 text-[8.7px] text-[#8894A6]">Approved production addresses.</p>
            </div>
            <button type="button" onClick={() => setShowEnvironment(true)} className="text-[#6B778A]"><Fa icon={faChevronRight} style={{ fontSize: 8 }} /></button>
          </div>
          <div className="px-3.5 py-3">
            <div className="flex items-center justify-between border-b border-[#F0F3F7] pb-2">
              <span className="text-[9px] font-bold text-[#334155]">Allowed IPs</span>
              <StatusPill tone={ipAllowlist.length ? 'blue' : 'gray'}>{ipAllowlist.length}</StatusPill>
            </div>
            {ipAllowlist.length ? ipAllowlist.slice(0, 3).map(ip => (
              <div key={ip} className="border-b border-[#F0F3F7] py-2 font-mono text-[8px] text-[#526175] last:border-b-0">{ip}</div>
            )) : (
              <p className="py-3 text-[8.5px] leading-relaxed text-[#8995A7]">No allowlist is configured. Access remains protected by authentication, RBAC and same-origin write controls.</p>
            )}
            {currentUser?.role === 'director' && (
              <button type="button" onClick={() => setShowEnvironment(true)} className="mt-2 text-[8.5px] font-bold text-[var(--primary-dark)]">Manage production settings →</button>
            )}
          </div>
        </section>

        <section className={`${cardClass} min-w-0 overflow-hidden`}>
          <div className="flex items-start justify-between border-b border-[#EDF1F6] px-3.5 py-3">
            <div>
              <h4 className="text-[11px] font-bold text-[#182033]">API Security</h4>
              <p className="mt-0.5 text-[8.7px] text-[#8894A6]">API access and request limits.</p>
            </div>
            <Fa icon={faChevronRight} className="text-[#6B778A]" style={{ fontSize: 8 }} />
          </div>
          <div className="px-3.5 py-3">
            <div className="flex items-center justify-between border-b border-[#F0F3F7] py-2">
              <span className="text-[9px] font-bold text-[#334155]">API Access</span>
              <StatusPill tone="blue">{overview?.api.activeKeys ?? 0}</StatusPill>
            </div>
            <div className="flex items-center justify-between border-b border-[#F0F3F7] py-2">
              <span className="text-[9px] font-bold text-[#334155]">Write limit</span>
              <StatusPill tone="green">{overview?.api.writeRateLimitPerMinute ?? 240}/min</StatusPill>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[9px] font-bold text-[#334155]">Partner limit</span>
              <StatusPill tone="green">{overview?.api.partnerRateLimitPerMinute ?? 120}/min</StatusPill>
            </div>
          </div>
        </section>

        <section className={`${cardClass} min-w-0 overflow-hidden`}>
          <div className="flex items-start justify-between border-b border-[#EDF1F6] px-3.5 py-3">
            <div>
              <h4 className="text-[11px] font-bold text-[#182033]">Data Protection</h4>
              <p className="mt-0.5 text-[8.7px] text-[#8894A6]">Application and transport safeguards.</p>
            </div>
            <Fa icon={faChevronRight} className="text-[#6B778A]" style={{ fontSize: 8 }} />
          </div>
          <div className="px-3.5 py-3">
            <div className="flex items-center justify-between border-b border-[#F0F3F7] py-2">
              <span className="text-[9px] font-bold text-[#334155]">CSP + HSTS</span>
              <StatusPill tone="green">Enabled</StatusPill>
            </div>
            <div className="flex items-center justify-between border-b border-[#F0F3F7] py-2">
              <span className="text-[9px] font-bold text-[#334155]">Store ACL</span>
              <StatusPill tone="green">Default deny</StatusPill>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[9px] font-bold text-[#334155]">Business guards</span>
              <StatusPill tone={dataProtectionEnabled ? 'green' : 'amber'}>{dataProtectionEnabled ? 'Enabled' : 'Review'}</StatusPill>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-[#E7ECF3] px-1 pt-3 text-[8.5px] text-[#8A96A8] sm:flex-row sm:items-center sm:justify-between">
        <span>© 2026 Deed Technologies LTD. Security controls use the existing ERP authentication and audit stack.</span>
        <span className="font-bold text-[var(--primary-dark)]">Security Settings</span>
      </div>

      {showEnvironment && (
        <div className="fixed inset-0 z-[10020] flex justify-end bg-[#0E1730]/35 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label="Production security environment">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="Close production security environment" onClick={() => setShowEnvironment(false)} />
          <div className="relative h-full w-full max-w-[860px] overflow-y-auto border-l border-[#D7E0EA] bg-[#F5F8FC] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#DDE5EF] bg-white/95 px-5 py-4 backdrop-blur">
              <div>
                <h3 className="text-sm font-black text-[#172033]">Production Security Settings</h3>
                <p className="mt-0.5 text-[10px] text-[#7A8699]">Rotate MFA, authentication and integration secrets without exposing existing values.</p>
              </div>
              <button type="button" onClick={() => setShowEnvironment(false)} className="rounded-xl border border-[#D7E0EA] bg-white px-3 py-2 text-[10px] font-bold text-[#526175] hover:bg-[#F8FAFC]">Close</button>
            </div>
            <div className="p-4 sm:p-5">
              <ProductionEnvSettings showToast={showToast} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
