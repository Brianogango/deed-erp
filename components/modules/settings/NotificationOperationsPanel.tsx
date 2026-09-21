'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Fa } from '@/components/icons'
import {
  faArrowRight,
  faBell,
  faChartLine,
  faChevronLeft,
  faChevronRight,
  faClock,
  faDownload,
  faEnvelope,
  faFileLines,
  faFloppyDisk,
  faGear,
  faMagnifyingGlass,
  faPaperPlane,
  faRotate,
  faShieldHalved,
  faTriangleExclamation,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import SmsMessageCenter from './SmsMessageCenter'

type NotificationDeliveryRow = {
  id: string
  eventType: string
  title: string
  body: string
  entityType: string | null
  entityId: string | null
  severity: string
  channel: string
  destination: string | null
  provider: string | null
  status: string
  attempts: number
  error: string | null
  createdAt: string
  updatedAt: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
}

type NotificationFailureRow = {
  id: string
  eventType: string
  title: string
  channel: string
  provider: string | null
  status: string
  attempts: number
  error: string | null
  updatedAt: string
  entityType: string | null
  entityId: string | null
  severity: string
}

type NotificationOps = {
  since: string
  byStatus: Record<string, number>
  byChannel: Record<string, number>
  deadLetters: number
  pendingOutbox: number
  pendingDeliveries: number
  activeTemplates: number
  topEvents: Array<{ eventType: string; count: number }>
  recentDeliveries: NotificationDeliveryRow[]
  recentFailures: NotificationFailureRow[]
}

type NotificationTemplateRow = {
  id: string
  eventType: string
  channel: string
  version: number
  subjectTemplate: string | null
  bodyTemplate: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type NotificationPolicyRow = {
  eventType: string
  channels: string[]
  severity: string
  priority: string
  recipientRoles: string[]
  requiresAcknowledgement: boolean
  escalationMinutes: number | null
  escalationRoles: string[]
  mandatory: boolean
  mandatoryChannels: string[]
  fallbackSms: boolean
}

type NotificationPreference = {
  eventType: string
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

type TabId = 'overview' | 'templates' | 'automation' | 'messages' | 'preferences' | 'gateways'
type TemplateChannel = 'sms' | 'email' | 'in_app' | 'whatsapp'

const DEED_NAVY = '#1A1F5E'
const DEED_CYAN = '#00AEEF'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'templates', label: 'Templates' },
  { id: 'automation', label: 'Automation Rules' },
  { id: 'messages', label: 'Message Log' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'gateways', label: 'Gateways' },
]

const TEMPLATE_CHANNELS: Array<{ id: TemplateChannel; label: string }> = [
  { id: 'sms', label: 'SMS' },
  { id: 'email', label: 'Email' },
  { id: 'in_app', label: 'In-app' },
  { id: 'whatsapp', label: 'WhatsApp' },
]

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  email: 'Email',
  in_app: 'In-app',
  whatsapp: 'WhatsApp',
  push: 'Push',
}

const SAMPLE_VARS: Record<string, string> = {
  customer_name: 'Rahul Sharma',
  repair_no: 'REP-2026-1048',
  ready_date: '31 Aug 2026',
  approval_status: 'Approved',
  invoice_no: 'INV-2026-1048',
  otp_code: '482901',
  employee_name: 'John Mitchell',
  amount: 'KES 24,500',
  entityId: 'REP-2026-1048',
  title: 'Repair ready',
  body: 'Your device is ready for collection.',
  actionUrl: 'https://erp.deed.co.ke/portal',
}

const STARTER_TEMPLATES: Record<string, { subject: string; body: string }> = {
  'repair.ready': {
    subject: 'Your repair {{repair_no}} is ready for pickup',
    body: 'Hi {{customer_name}},\n\nGood news! Your device for repair no. {{repair_no}} is ready and available for pickup from our store.\nExpected ready date: {{ready_date}}\n\nThank you for choosing Deed Technologies.',
  },
  'repair.quote_ready': {
    subject: 'Repair quote ready - {{repair_no}}',
    body: 'Hi {{customer_name}},\n\nYour repair quote for {{repair_no}} is ready for review. Please use the repair link provided to approve or decline the quote.',
  },
  'hr.leave.approved': {
    subject: 'Leave application approved',
    body: 'Hi {{employee_name}},\n\nYour leave application has been approved. Please check the ERP for the approved dates and handover requirements.',
  },
  'finance.invoice_overdue': {
    subject: 'Payment reminder - {{invoice_no}}',
    body: 'Hello {{customer_name}},\n\nThis is a reminder that invoice {{invoice_no}} is overdue. Kindly arrange payment or contact Deed Technologies if you need assistance.',
  },
  'delivery.dispatched': {
    subject: 'Your delivery has been dispatched',
    body: 'Hi {{customer_name}},\n\nYour order has been dispatched and is on the way. We will update you when the delivery is completed.',
  },
}

function humanize(value: string) {
  return value
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function moduleFromEvent(eventType: string) {
  const module = eventType.split('.')[0] || 'system'
  return humanize(module)
}

function formatWhen(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusTone(status: string) {
  if (['dead_letter', 'failed'].includes(status)) return 'border-red-200 bg-red-50 text-red-700'
  if (['retrying', 'queued', 'sending', 'processing'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-700'
  if (['delivered', 'read', 'sent', 'received'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function severityTone(severity: string) {
  if (severity === 'critical') return 'border-red-200 bg-red-50 text-red-700'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (severity === 'attention') return 'border-violet-200 bg-violet-50 text-violet-700'
  if (severity === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

function renderPreview(template: string) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => SAMPLE_VARS[key] || '[' + key + ']')
}

function compactDestination(value: string | null) {
  if (!value) return 'System recipient'
  if (value.includes('@')) {
    const [name, domain] = value.split('@')
    return name.length > 14 ? name.slice(0, 12) + '…@' + domain : value
  }
  return value
}

function MiniToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (checked ? 'bg-emerald-500' : 'bg-slate-200')}
    >
      <span className={'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ' + (checked ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
    </button>
  )
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone = 'cyan',
}: {
  icon: any
  label: string
  value: string
  detail: string
  tone?: 'cyan' | 'red' | 'green' | 'violet'
}) {
  const tones = {
    cyan: 'bg-cyan-50 text-cyan-600',
    red: 'bg-red-50 text-red-600',
    green: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
  }
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start gap-3">
        <div className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-full ' + tones[tone]}>
          <Fa icon={icon} className="text-sm" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-500">{label}</p>
          <p className="mt-0.5 text-xl font-black tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 truncate text-[9px] text-slate-400">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, string> = {
    email: 'border-blue-200 bg-blue-50 text-blue-700',
    sms: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    in_app: 'border-violet-200 bg-violet-50 text-violet-700',
    whatsapp: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    push: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  }
  return (
    <span className={'inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-bold ' + (map[channel] || 'border-slate-200 bg-slate-50 text-slate-600')}>
      {CHANNEL_LABELS[channel] || humanize(channel)}
    </span>
  )
}

function pageWindow(current: number, total: number, size = 5) {
  if (total <= size) return Array.from({ length: total }, (_, index) => index + 1)
  const half = Math.floor(size / 2)
  let start = Math.max(1, current - half)
  const end = Math.min(total, start + size - 1)
  start = Math.max(1, end - size + 1)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

function ConsolePager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const pages = pageWindow(page, totalPages)

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[9px] text-slate-400">
        Showing {from} to {to} of {total} results
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30"
        >
          <Fa icon={faChevronLeft} className="text-[9px]" />
        </button>
        {pages[0] > 1 && (
          <>
            <button
              type="button"
              onClick={() => onPageChange(1)}
              className="h-8 min-w-8 rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-bold text-slate-600"
            >
              1
            </button>
            {pages[0] > 2 && <span className="px-1 text-[9px] text-slate-400">…</span>}
          </>
        )}
        {pages.map(value => (
          <button
            key={value}
            type="button"
            onClick={() => onPageChange(value)}
            className={'h-8 min-w-8 rounded-lg border px-2 text-[9px] font-bold ' + (page === value ? 'border-[#00AEEF] bg-[#00AEEF] text-white' : 'border-slate-200 bg-white text-slate-600')}
          >
            {value}
          </button>
        ))}
        {pages[pages.length - 1] < totalPages && (
          <>
            {pages[pages.length - 1] < totalPages - 1 && <span className="px-1 text-[9px] text-slate-400">…</span>}
            <button
              type="button"
              onClick={() => onPageChange(totalPages)}
              className={'h-8 min-w-8 rounded-lg border px-2 text-[9px] font-bold ' + (page === totalPages ? 'border-[#00AEEF] bg-[#00AEEF] text-white' : 'border-slate-200 bg-white text-slate-600')}
            >
              {totalPages}
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="Next page"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30"
        >
          <Fa icon={faChevronRight} className="text-[9px]" />
        </button>
      </div>
    </div>
  )
}

export default function NotificationOperationsPanel({
  showToast,
  onOpenEmailSettings,
}: {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
  onOpenEmailSettings?: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [ops, setOps] = useState<NotificationOps | null>(null)
  const [policies, setPolicies] = useState<NotificationPolicyRow[]>([])
  const [templates, setTemplates] = useState<NotificationTemplateRow[]>([])
  const [preference, setPreference] = useState<NotificationPreference | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingSecondary, setLoadingSecondary] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [query, setQuery] = useState('')
  const [channelFilter, setChannelFilter] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 8

  const [selectedEvent, setSelectedEvent] = useState('repair.ready')
  const [templateChannel, setTemplateChannel] = useState<TemplateChannel>('sms')
  const [templateSubject, setTemplateSubject] = useState('')
  const [templateBody, setTemplateBody] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)

  const [policyQuery, setPolicyQuery] = useState('')
  const [policyModule, setPolicyModule] = useState('all')
  const [policyPage, setPolicyPage] = useState(1)
  const policyPageSize = 8
  const [selectedPolicyEvent, setSelectedPolicyEvent] = useState('repair.ready')
  const [savingPreference, setSavingPreference] = useState(false)

  const loadOps = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/notifications?days=' + days, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not load notification operations', 'error')
        return
      }
      setOps(body)
    } catch {
      showToast('Could not reach notification operations API', 'error')
    } finally {
      setLoading(false)
    }
  }, [days, showToast])

  const loadPolicies = useCallback(async () => {
    setLoadingSecondary(true)
    try {
      const res = await fetch('/api/admin/notifications/policies', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not load automation policies', 'error')
        return
      }
      setPolicies(Array.isArray(body.policies) ? body.policies : [])
    } catch {
      showToast('Could not load notification policies', 'error')
    } finally {
      setLoadingSecondary(false)
    }
  }, [showToast])

  const loadTemplates = useCallback(async () => {
    setLoadingSecondary(true)
    try {
      const res = await fetch('/api/admin/notifications/templates', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not load notification templates', 'error')
        return
      }
      setTemplates(Array.isArray(body.templates) ? body.templates : [])
    } catch {
      showToast('Could not load notification templates', 'error')
    } finally {
      setLoadingSecondary(false)
    }
  }, [showToast])

  const loadPreference = useCallback(async () => {
    setLoadingSecondary(true)
    try {
      const res = await fetch('/api/notifications/preferences', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not load notification preferences', 'error')
        return
      }
      setPreference(body.global || null)
    } catch {
      showToast('Could not load notification preferences', 'error')
    } finally {
      setLoadingSecondary(false)
    }
  }, [showToast])

  useEffect(() => {
    void loadOps()
    void loadPolicies()
  }, [loadOps, loadPolicies])

  useEffect(() => {
    if (activeTab === 'templates') void loadTemplates()
    if (activeTab === 'preferences') void loadPreference()
  }, [activeTab, loadTemplates, loadPreference])

  const totals = useMemo(() => {
    const status = ops?.byStatus || {}
    const delivered = (status.delivered || 0) + (status.read || 0)
    const sent = delivered + (status.sent || 0)
    const failed = (status.failed || 0) + (status.dead_letter || 0)
    const queued = (status.retrying || 0) + (status.queued || 0) + (status.sending || 0) + (status.processing || 0)
    const all = Object.values(status).reduce((sum, value) => sum + Number(value || 0), 0)
    const success = sent
    const rate = all > 0 ? Math.round((success / all) * 1000) / 10 : 0
    return { all, delivered, sent, failed, queued, rate }
  }, [ops])

  const filteredDeliveries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (ops?.recentDeliveries || []).filter(row => {
      if (channelFilter !== 'all' && row.channel !== channelFilter) return false
      if (!q) return true
      return [
        row.title,
        row.eventType,
        row.entityId || '',
        row.destination || '',
        row.status,
        row.provider || '',
      ].some(value => value.toLowerCase().includes(q))
    })
  }, [ops, query, channelFilter])

  const pagedDeliveries = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredDeliveries.slice(start, start + pageSize)
  }, [filteredDeliveries, page])

  const totalPages = Math.max(1, Math.ceil(filteredDeliveries.length / pageSize))

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const modules = useMemo(() => {
    return Array.from(new Set(policies.map(policy => policy.eventType.split('.')[0]))).sort()
  }, [policies])

  const filteredPolicies = useMemo(() => {
    const q = policyQuery.trim().toLowerCase()
    return policies.filter(policy => {
      const module = policy.eventType.split('.')[0]
      if (policyModule !== 'all' && module !== policyModule) return false
      if (!q) return true
      return policy.eventType.toLowerCase().includes(q) ||
        policy.channels.some(channel => channel.toLowerCase().includes(q)) ||
        policy.recipientRoles.some(role => role.toLowerCase().includes(q))
    })
  }, [policies, policyQuery, policyModule])

  const pagedPolicies = useMemo(() => {
    const start = (policyPage - 1) * policyPageSize
    return filteredPolicies.slice(start, start + policyPageSize)
  }, [filteredPolicies, policyPage])

  const policyTotalPages = Math.max(1, Math.ceil(filteredPolicies.length / policyPageSize))

  useEffect(() => {
    setPolicyPage(current => Math.min(current, policyTotalPages))
  }, [policyTotalPages])

  const selectedPolicy = policies.find(policy => policy.eventType === selectedPolicyEvent) ||
    policies.find(policy => policy.eventType === selectedEvent) ||
    policies[0] ||
    null

  const templateEvents = useMemo(() => {
    const fromPolicies = policies.map(policy => policy.eventType)
    const fromTemplates = templates.map(template => template.eventType)
    return Array.from(new Set([...fromPolicies, ...fromTemplates])).sort()
  }, [policies, templates])

  useEffect(() => {
    if (templateEvents.length > 0 && !templateEvents.includes(selectedEvent)) {
      setSelectedEvent(templateEvents.includes('repair.ready') ? 'repair.ready' : templateEvents[0])
    }
  }, [templateEvents, selectedEvent])

  useEffect(() => {
    const existing = templates.find(template => template.eventType === selectedEvent && template.channel === templateChannel)
    const starter = STARTER_TEMPLATES[selectedEvent]
    setTemplateSubject(existing?.subjectTemplate || starter?.subject || '{{title}}')
    setTemplateBody(existing?.bodyTemplate || starter?.body || '{{body}}\n\n{{actionUrl}}')
  }, [templates, selectedEvent, templateChannel])

  const retryDeadLetter = async (deliveryId: string) => {
    setRetryingId(deliveryId)
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'retry_dead_letter',
          deliveryId,
          note: 'Retried from Settings > Notifications',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not retry delivery', 'error')
        return
      }
      showToast('Notification queued for retry', 'success')
      await loadOps()
    } catch {
      showToast('Could not retry delivery', 'error')
    } finally {
      setRetryingId(null)
    }
  }

  const saveTemplate = async () => {
    if (!selectedEvent || !templateBody.trim()) {
      showToast('Select an event and enter a message body.', 'error')
      return
    }
    setSavingTemplate(true)
    try {
      const res = await fetch('/api/admin/notifications/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: selectedEvent,
          channel: templateChannel,
          subjectTemplate: templateSubject.trim() || null,
          bodyTemplate: templateBody.trim(),
          isActive: true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not save template', 'error')
        return
      }
      showToast('Template version saved and activated', 'success')
      await loadTemplates()
      await loadOps()
    } catch {
      showToast('Could not save notification template', 'error')
    } finally {
      setSavingTemplate(false)
    }
  }

  const savePreference = async () => {
    if (!preference) return
    setSavingPreference(true)
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preference),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not save notification preferences', 'error')
        return
      }
      setPreference(body.preference || preference)
      showToast('Notification preferences saved', 'success')
    } catch {
      showToast('Could not save notification preferences', 'error')
    } finally {
      setSavingPreference(false)
    }
  }

  const exportPolicies = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), policies }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'deed-notification-policies.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    showToast('Notification policy registry exported', 'success')
  }

  const switchTab = (tab: TabId) => {
    setActiveTab(tab)
    setQuery('')
    setPage(1)
  }

  const channelCards = ['email', 'sms', 'in_app', 'whatsapp'].map(channel => {
    const count = ops?.byChannel?.[channel] || 0
    const providers = Array.from(new Set(
      (ops?.recentDeliveries || [])
        .filter(row => row.channel === channel && row.provider)
        .map(row => row.provider as string),
    ))
    return {
      channel,
      count,
      providers,
      label: CHANNEL_LABELS[channel],
    }
  })

  return (
    <div className="notification-console min-w-0">
      <section className="mb-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Settings / Notifications</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-[#10183E]">Notifications</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500">
              Configure, automate and monitor system notifications across email, SMS, in-app, push and WhatsApp.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => switchTab('templates')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-bold text-[#1A1F5E] hover:border-cyan-300 hover:bg-cyan-50"
            >
              <Fa icon={faFileLines} /> Manage templates
            </button>
            <button
              type="button"
              onClick={() => void loadOps()}
              disabled={loading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#00AEEF] px-4 text-[10px] font-black text-white shadow-sm transition hover:bg-[#009bd6] disabled:opacity-50"
            >
              <Fa icon={faRotate} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Refreshing…' : 'Refresh activity'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200 scrollbar-hide">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={'relative min-h-11 shrink-0 px-4 text-[10.5px] font-bold transition-colors ' + (activeTab === tab.id ? 'text-[#0878C9]' : 'text-slate-500 hover:text-slate-800')}
            >
              {tab.label}
              {activeTab === tab.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#00AEEF]" />}
            </button>
          ))}
        </div>
      </section>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <MetricCard icon={faPaperPlane} label="Sent" value={totals.sent.toLocaleString()} detail={'Last ' + days + ' days'} />
            <MetricCard icon={faClock} label="Queued / retrying" value={totals.queued.toLocaleString()} detail={(ops?.pendingDeliveries || 0) + ' delivery jobs pending'} tone="violet" />
            <MetricCard icon={faTriangleExclamation} label="Failed" value={totals.failed.toLocaleString()} detail={(ops?.deadLetters || 0) + ' unresolved dead letters'} tone="red" />
            <MetricCard icon={faChartLine} label="Delivery rate" value={totals.rate.toFixed(1) + '%'} detail="Provider delivery ledger" tone="green" />
            <MetricCard icon={faFileLines} label="Active templates" value={(ops?.activeTemplates || 0).toLocaleString()} detail="Database-backed versions" />
            <MetricCard icon={faGear} label="Automation policies" value={policies.length.toLocaleString()} detail="Registered notification events" tone="violet" />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {channelCards.map(item => (
                <div key={item.channel} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-[#FBFDFF] px-3.5 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
                    <Fa icon={item.channel === 'email' ? faEnvelope : item.channel === 'in_app' ? faBell : faPaperPlane} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] font-black text-[#14213D]">{item.label}</p>
                      <span className={'rounded-full px-1.5 py-0.5 text-[8px] font-black ' + (item.count > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                        {item.count > 0 ? 'ACTIVE' : 'NO TRAFFIC'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[9px] text-slate-400">
                      {item.providers.length ? item.providers.join(', ') : 'No provider observed in selected period'} · {item.count.toLocaleString()} deliveries
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-[12px] font-black text-[#14213D]">Recent Notifications</h3>
                  <p className="mt-0.5 text-[9px] text-slate-400">Provider delivery activity from the durable notification ledger.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative">
                    <Fa icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                    <input
                      value={query}
                      onChange={event => { setQuery(event.target.value); setPage(1) }}
                      placeholder="Search notification..."
                      className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-[10px] outline-none focus:border-cyan-400 sm:w-56"
                    />
                  </div>
                  <select
                    value={channelFilter}
                    onChange={event => { setChannelFilter(event.target.value); setPage(1) }}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600"
                  >
                    <option value="all">All channels</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="in_app">In-app</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="push">Push</option>
                  </select>
                  <select
                    value={days}
                    onChange={event => setDays(Number(event.target.value))}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600"
                  >
                    <option value={1}>24 hours</option>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </div>
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[840px] border-collapse text-left">
                  <thead className="bg-slate-50/80">
                    <tr>
                      {['Event', 'Module', 'Recipient', 'Channel', 'Status', 'Scheduled / Sent', 'Actions'].map(label => (
                        <th key={label} className="border-b border-slate-100 px-4 py-2.5 text-[8.5px] font-black uppercase tracking-wider text-slate-400">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedDeliveries.map(row => (
                      <tr key={row.id} className="transition hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <p className="max-w-[190px] truncate text-[10.5px] font-bold text-[#14213D]">{row.title}</p>
                          <p className="mt-0.5 max-w-[190px] truncate font-mono text-[8.5px] text-slate-400">{row.eventType}</p>
                        </td>
                        <td className="px-4 py-3 text-[9.5px] font-semibold text-slate-600">{moduleFromEvent(row.eventType)}</td>
                        <td className="px-4 py-3">
                          <p className="max-w-[170px] truncate text-[9.5px] font-semibold text-slate-700">{compactDestination(row.destination)}</p>
                          {row.entityId && <p className="mt-0.5 max-w-[170px] truncate text-[8.5px] text-slate-400">{row.entityId}</p>}
                        </td>
                        <td className="px-4 py-3"><ChannelBadge channel={row.channel} /></td>
                        <td className="px-4 py-3">
                          <span className={'inline-flex rounded-full border px-2 py-1 text-[8.5px] font-black uppercase ' + statusTone(row.status)}>
                            {row.status.replaceAll('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[9px] text-slate-500">{formatWhen(row.deliveredAt || row.sentAt || row.updatedAt)}</td>
                        <td className="px-4 py-3">
                          {row.status === 'dead_letter' ? (
                            <button
                              type="button"
                              onClick={() => void retryDeadLetter(row.id)}
                              disabled={retryingId === row.id}
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[8.5px] font-black text-red-700 disabled:opacity-50"
                            >
                              {retryingId === row.id ? 'Queueing…' : 'Retry'}
                            </button>
                          ) : (
                            <span className="text-[9px] text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 lg:hidden">
                {pagedDeliveries.map(row => (
                  <div key={row.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-black text-[#14213D]">{row.title}</p>
                        <p className="mt-0.5 truncate font-mono text-[8.5px] text-slate-400">{row.eventType}</p>
                      </div>
                      <span className={'shrink-0 rounded-full border px-2 py-1 text-[8px] font-black uppercase ' + statusTone(row.status)}>
                        {row.status.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
                      <div><span className="text-slate-400">Channel</span><div className="mt-1"><ChannelBadge channel={row.channel} /></div></div>
                      <div><span className="text-slate-400">Recipient</span><p className="mt-1 truncate font-semibold text-slate-700">{compactDestination(row.destination)}</p></div>
                      <div className="col-span-2"><span className="text-slate-400">Sent / updated</span><p className="mt-1 text-slate-600">{formatWhen(row.deliveredAt || row.sentAt || row.updatedAt)}</p></div>
                    </div>
                    {row.status === 'dead_letter' && (
                      <button
                        type="button"
                        onClick={() => void retryDeadLetter(row.id)}
                        className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[9px] font-black text-red-700"
                      >
                        Retry delivery
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {pagedDeliveries.length === 0 && (
                <div className="px-5 py-12 text-center">
                  <p className="text-[12px] font-bold text-slate-600">No notifications match this view.</p>
                  <p className="mt-1 text-[10px] text-slate-400">Change the channel, date range or search term.</p>
                </div>
              )}

              <ConsolePager page={page} pageSize={pageSize} total={filteredDeliveries.length} onPageChange={setPage} />
            </section>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-black text-[#14213D]">Delivery Analytics</h3>
                  <span className="text-[9px] text-slate-400">Last {days} days</span>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <div
                    className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'conic-gradient(#10B981 ' + totals.rate + '%, #EF4444 ' + totals.rate + '% ' + Math.min(100, totals.rate + (totals.all ? totals.failed / totals.all * 100 : 0)) + '%, #E2E8F0 0)' }}
                  >
                    <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-white">
                      <strong className="text-[16px] font-black text-[#14213D]">{totals.rate.toFixed(1)}%</strong>
                      <span className="text-[7px] font-semibold uppercase text-slate-400">Delivery rate</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex justify-between gap-2 text-[9px]"><span className="text-slate-500">Delivered / read</span><strong className="text-slate-800">{totals.delivered.toLocaleString()}</strong></div>
                    <div className="flex justify-between gap-2 text-[9px]"><span className="text-slate-500">Failed</span><strong className="text-red-600">{totals.failed.toLocaleString()}</strong></div>
                    <div className="flex justify-between gap-2 text-[9px]"><span className="text-slate-500">Pending</span><strong className="text-amber-600">{totals.queued.toLocaleString()}</strong></div>
                    <div className="border-t border-slate-100 pt-2 text-[9px]"><span className="text-slate-400">Total activity </span><strong className="text-slate-800">{totals.all.toLocaleString()}</strong></div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-black text-[#14213D]">Failed Messages</h3>
                  <button type="button" onClick={() => switchTab('messages')} className="text-[9px] font-bold text-[#0878C9]">View all</button>
                </div>
                <div className="mt-3 space-y-3">
                  {(ops?.recentFailures || []).slice(0, 4).map(row => (
                    <div key={row.id} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-50 text-[8px] font-black text-red-600">!</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[9.5px] font-bold text-slate-700">{row.title}</p>
                        <p className="mt-0.5 truncate text-[8px] text-slate-400">{CHANNEL_LABELS[row.channel] || row.channel} · {formatWhen(row.updatedAt)}</p>
                      </div>
                    </div>
                  ))}
                  {(ops?.recentFailures || []).length === 0 && <p className="py-4 text-center text-[9px] text-slate-400">No recent delivery failures.</p>}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <h3 className="text-[11px] font-black text-[#14213D]">Retry Queue</h3>
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between text-[9px]"><span className="font-semibold text-slate-600">Delivery queue</span><strong className="text-amber-600">{ops?.pendingDeliveries || 0}</strong></div>
                  <div className="flex items-center justify-between text-[9px]"><span className="font-semibold text-slate-600">Outbox pending</span><strong className="text-amber-600">{ops?.pendingOutbox || 0}</strong></div>
                  <div className="flex items-center justify-between text-[9px]"><span className="font-semibold text-slate-600">Dead letters</span><strong className="text-red-600">{ops?.deadLetters || 0}</strong></div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="grid gap-4 2xl:grid-cols-[250px_minmax(0,1fr)_340px]">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-[11px] font-black text-[#14213D]">Template Categories</h3>
            </div>
            <div className="p-2">
              {Array.from(new Set(templateEvents.map(eventType => eventType.split('.')[0]))).map(module => {
                const count = templateEvents.filter(eventType => eventType.startsWith(module + '.')).length
                return (
                  <button
                    key={module}
                    type="button"
                    onClick={() => {
                      const next = templateEvents.find(eventType => eventType.startsWith(module + '.'))
                      if (next) setSelectedEvent(next)
                    }}
                    className={'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[10px] font-semibold transition ' + (selectedEvent.startsWith(module + '.') ? 'bg-cyan-50 text-[#0878C9]' : 'text-slate-600 hover:bg-slate-50')}
                  >
                    <span>{humanize(module)}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[8px] text-slate-400">{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="border-t border-slate-100 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Templates</p>
            </div>
            <div className="max-h-[470px] overflow-y-auto p-2">
              {templateEvents.map(eventType => {
                const channels = templates.filter(template => template.eventType === eventType).map(template => template.channel)
                return (
                  <button
                    key={eventType}
                    type="button"
                    onClick={() => setSelectedEvent(eventType)}
                    className={'mb-1 w-full rounded-xl border px-3 py-2.5 text-left transition ' + (selectedEvent === eventType ? 'border-cyan-200 bg-[#F2FBFF]' : 'border-transparent hover:bg-slate-50')}
                  >
                    <p className="truncate text-[9.5px] font-bold text-[#14213D]">{humanize(eventType.split('.').slice(1).join(' '))}</p>
                    <p className="mt-0.5 truncate text-[8px] text-slate-400">{channels.length ? channels.map(channel => CHANNEL_LABELS[channel] || channel).join(', ') : 'Uses event fallback until customized'}</p>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[12px] font-black text-[#14213D]">Edit Template</h3>
                <p className="mt-0.5 text-[9px] text-slate-400">Saving creates a new active version and keeps the previous version for audit history.</p>
              </div>
              <button
                type="button"
                onClick={() => void saveTemplate()}
                disabled={savingTemplate || loadingSecondary}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-[#00AEEF] px-4 text-[9.5px] font-black text-white disabled:opacity-50"
              >
                <Fa icon={faFloppyDisk} />
                {savingTemplate ? 'Saving…' : 'Save template'}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-[9px] font-black text-slate-600">Template event</span>
                <select value={selectedEvent} onChange={event => setSelectedEvent(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-700">
                  {templateEvents.map(eventType => <option key={eventType} value={eventType}>{humanize(eventType)}</option>)}
                </select>
              </label>
              <div>
                <span className="text-[9px] font-black text-slate-600">Trigger event</span>
                <div className="mt-1.5 flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-[9px] text-slate-500">{selectedEvent}</div>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[9px] font-black text-slate-600">Channel</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TEMPLATE_CHANNELS.map(channel => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => setTemplateChannel(channel.id)}
                    className={'min-h-10 rounded-xl border text-[9.5px] font-bold transition ' + (templateChannel === channel.id ? 'border-[#00AEEF] bg-cyan-50 text-[#0878C9]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
                  >
                    {channel.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="mt-4 block">
              <span className="text-[9px] font-black text-slate-600">Subject <span className="font-normal text-slate-400">(Email / push)</span></span>
              <input value={templateSubject} onChange={event => setTemplateSubject(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] outline-none focus:border-cyan-400" />
            </label>

            <label className="mt-4 block">
              <span className="text-[9px] font-black text-slate-600">Message Body</span>
              <textarea
                value={templateBody}
                onChange={event => setTemplateBody(event.target.value.slice(0, 20000))}
                rows={11}
                className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-3 text-[10.5px] leading-relaxed outline-none focus:border-cyan-400"
              />
            </label>

            <div className="mt-4">
              <p className="text-[9px] font-black text-slate-600">Insert variables</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {['customer_name', 'repair_no', 'ready_date', 'approval_status', 'invoice_no', 'otp_code', 'employee_name', 'amount'].map(variable => (
                  <button
                    key={variable}
                    type="button"
                    onClick={() => setTemplateBody(value => value + '{{' + variable + '}}')}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-mono text-[8.5px] font-bold text-blue-700"
                  >
                    {'{{' + variable + '}}'}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black text-[#14213D]">Live Preview</h3>
                <ChannelBadge channel={templateChannel} />
              </div>
              <div className="mt-4 rounded-[28px] border-[6px] border-[#141927] bg-white p-2 shadow-sm">
                <div className="rounded-[18px] bg-slate-50 px-3 py-3">
                  <p className="text-center text-[8px] font-semibold text-slate-400">Deed Technologies · now</p>
                  <div className="mt-4 rounded-2xl rounded-tl-md bg-white p-3 shadow-sm">
                    <p className="whitespace-pre-wrap text-[9.5px] leading-relaxed text-slate-700">{renderPreview(templateBody)}</p>
                  </div>
                </div>
              </div>
              {templateChannel === 'email' && (
                <div className="mt-4 rounded-xl border border-slate-200">
                  <div className="border-b border-slate-100 p-3 text-[8px] text-slate-500">
                    <p><strong>From:</strong> Deed Technologies &lt;no-reply@deed.africa&gt;</p>
                    <p className="mt-1"><strong>Subject:</strong> {renderPreview(templateSubject)}</p>
                  </div>
                  <p className="whitespace-pre-wrap p-3 text-[9px] leading-relaxed text-slate-600">{renderPreview(templateBody)}</p>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-[11px] font-black text-[#14213D]">Template Metadata</h3>
              {(() => {
                const existing = templates.find(template => template.eventType === selectedEvent && template.channel === templateChannel)
                return (
                  <div className="mt-3 space-y-2.5 text-[9px]">
                    <div className="flex justify-between gap-3"><span className="text-slate-400">Status</span><strong className={existing?.isActive ? 'text-emerald-600' : 'text-slate-500'}>{existing ? (existing.isActive ? 'Active' : 'Inactive') : 'Fallback'}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-400">Version</span><strong className="text-slate-700">{existing ? 'v' + existing.version : 'Not customized'}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-400">Character count</span><strong className="text-slate-700">{templateBody.length}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-400">Last updated</span><strong className="text-right text-slate-700">{existing ? formatWhen(existing.updatedAt) : '—'}</strong></div>
                  </div>
                )
              })()}
            </section>
          </aside>
        </div>
      )}

      {activeTab === 'automation' && (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[12px] font-black text-[#14213D]">Automation Rules</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[8px] font-black text-slate-500">{policies.length}</span>
                  </div>
                  <p className="mt-0.5 text-[9px] text-slate-400">Authoritative routing policies registered by the notification platform.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative">
                    <Fa icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
                    <input value={policyQuery} onChange={event => { setPolicyQuery(event.target.value); setPolicyPage(1) }} placeholder="Search rules..." className="h-9 rounded-xl border border-slate-200 pl-8 pr-3 text-[9.5px] outline-none focus:border-cyan-400" />
                  </div>
                  <select value={policyModule} onChange={event => { setPolicyModule(event.target.value); setPolicyPage(1) }} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[9.5px] font-semibold text-slate-600">
                    <option value="all">All modules</option>
                    {modules.map(module => <option key={module} value={module}>{humanize(module)}</option>)}
                  </select>
                  <button type="button" onClick={exportPolicies} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-bold text-[#1A1F5E]">
                    <Fa icon={faDownload} /> Export rules
                  </button>
                </div>
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[860px] border-collapse text-left">
                  <thead className="bg-slate-50/80">
                    <tr>
                      {['Rule Name', 'Trigger / Event', 'Channel(s)', 'Recipients', 'Escalation', 'Status'].map(label => (
                        <th key={label} className="border-b border-slate-100 px-4 py-2.5 text-[8px] font-black uppercase tracking-wider text-slate-400">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedPolicies.map(policy => (
                      <tr
                        key={policy.eventType}
                        onClick={() => setSelectedPolicyEvent(policy.eventType)}
                        className={'cursor-pointer transition hover:bg-slate-50 ' + (selectedPolicyEvent === policy.eventType ? 'bg-cyan-50/50' : '')}
                      >
                        <td className="px-4 py-3">
                          <p className="text-[9.5px] font-bold text-[#14213D]">{humanize(policy.eventType.split('.').slice(1).join(' '))}</p>
                          <span className={'mt-1 inline-flex rounded-full border px-1.5 py-0.5 text-[7.5px] font-black uppercase ' + severityTone(policy.severity)}>{policy.severity}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[8.5px] text-slate-500">{policy.eventType}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">{policy.channels.map(channel => <ChannelBadge key={channel} channel={channel} />)}</div>
                        </td>
                        <td className="px-4 py-3 text-[8.5px] text-slate-500">{policy.recipientRoles.length ? policy.recipientRoles.map(humanize).join(', ') : 'Event recipients'}</td>
                        <td className="px-4 py-3 text-[8.5px] text-slate-500">{policy.escalationMinutes ? 'After ' + policy.escalationMinutes + ' min' : '—'}</td>
                        <td className="px-4 py-3"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[8px] font-black uppercase text-emerald-700">Active</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 lg:hidden">
                {pagedPolicies.map(policy => (
                  <button key={policy.eventType} type="button" onClick={() => setSelectedPolicyEvent(policy.eventType)} className={'w-full p-4 text-left ' + (selectedPolicyEvent === policy.eventType ? 'bg-cyan-50/50' : '')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[10.5px] font-black text-[#14213D]">{humanize(policy.eventType.split('.').slice(1).join(' '))}</p>
                        <p className="mt-0.5 truncate font-mono text-[8px] text-slate-400">{policy.eventType}</p>
                      </div>
                      <span className={'rounded-full border px-2 py-1 text-[7.5px] font-black uppercase ' + severityTone(policy.severity)}>{policy.severity}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">{policy.channels.map(channel => <ChannelBadge key={channel} channel={channel} />)}</div>
                  </button>
                ))}
              </div>

              {filteredPolicies.length === 0 && (
                <div className="px-5 py-12 text-center">
                  <p className="text-[12px] font-bold text-slate-600">No automation rules match this view.</p>
                  <p className="mt-1 text-[10px] text-slate-400">Change the module filter or search term.</p>
                </div>
              )}

              <ConsolePager page={policyPage} pageSize={policyPageSize} total={filteredPolicies.length} onPageChange={setPolicyPage} />
            </section>

            {selectedPolicy && (
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-[11px] font-black text-[#14213D]">Rule Builder</h3>
                    <p className="mt-0.5 font-mono text-[8.5px] text-slate-400">{selectedPolicy.eventType}</p>
                  </div>
                  {selectedPolicy.mandatory && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[8px] font-black uppercase text-red-700">Mandatory</span>}
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                  {[
                    { title: 'Trigger', body: humanize(selectedPolicy.eventType), icon: faChartLine },
                    { title: 'Policy', body: humanize(selectedPolicy.severity) + ' · ' + humanize(selectedPolicy.priority), icon: faShieldHalved },
                    { title: 'Channel', body: selectedPolicy.channels.map(channel => CHANNEL_LABELS[channel] || channel).join(', '), icon: faEnvelope },
                    { title: 'Recipient', body: selectedPolicy.recipientRoles.length ? selectedPolicy.recipientRoles.map(humanize).join(', ') : 'Event recipients', icon: faUsers },
                    { title: 'Fallback', body: selectedPolicy.fallbackSms ? 'SMS if primary channel fails' : 'Standard retry policy', icon: faRotate },
                    { title: 'Escalation', body: selectedPolicy.escalationMinutes ? selectedPolicy.escalationMinutes + ' min · ' + (selectedPolicy.escalationRoles.map(humanize).join(', ') || 'configured roles') : 'No timed escalation', icon: faClock },
                  ].map((step, index, all) => (
                    <div key={step.title} className="relative rounded-xl border border-slate-200 bg-[#FBFDFF] p-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600"><Fa icon={step.icon} className="text-[10px]" /></div>
                      <p className="mt-2 text-[8px] font-black uppercase tracking-wider text-slate-400">{step.title}</p>
                      <p className="mt-1 text-[8.5px] font-semibold leading-relaxed text-slate-600">{step.body}</p>
                      {index < all.length - 1 && <Fa icon={faArrowRight} className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white p-1 text-[7px] text-cyan-500 xl:block" />}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-4">
            <MetricCard icon={faGear} label="Active Rules" value={policies.length.toLocaleString()} detail="Central policy registry" tone="green" />
            <MetricCard icon={faTriangleExclamation} label="Failed Automations" value={(ops?.recentFailures.length || 0).toLocaleString()} detail={'Within the last ' + days + ' days'} tone="red" />
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-[11px] font-black text-[#14213D]">Most Triggered Events</h3>
              <div className="mt-3 space-y-2.5">
                {(ops?.topEvents || []).slice(0, 7).map(row => (
                  <div key={row.eventType} className="flex items-center justify-between gap-3 text-[8.5px]">
                    <span className="min-w-0 truncate text-slate-600">{humanize(row.eventType)}</span>
                    <strong className="shrink-0 text-slate-800">{row.count.toLocaleString()}</strong>
                  </div>
                ))}
                {(ops?.topEvents || []).length === 0 && <p className="py-3 text-center text-[9px] text-slate-400">No event activity in this period.</p>}
              </div>
            </section>
          </aside>
        </div>
      )}

      {activeTab === 'messages' && (
        <div className="space-y-4">
          <SmsMessageCenter showToast={showToast} />

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="text-[12px] font-black text-[#14213D]">Recent delivery exceptions</h3>
              <p className="mt-0.5 text-[9px] text-slate-400">Failed, retrying and dead-letter deliveries from the last {days} days.</p>
            </div>
            {(ops?.recentFailures || []).length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-[12px] font-bold text-slate-600">No failed, retrying or dead-letter deliveries.</p>
                <p className="mt-1 text-[10px] text-slate-400">Successful email, WhatsApp, push and in-app traffic stays on Overview.</p>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[760px] border-collapse text-left">
                    <thead className="bg-slate-50/80">
                      <tr>
                        {['Event', 'Channel', 'Status', 'Error', 'Updated', 'Actions'].map(label => (
                          <th key={label} className="border-b border-slate-100 px-4 py-2.5 text-[8.5px] font-black uppercase tracking-wider text-slate-400">{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(ops?.recentFailures || []).map(row => (
                        <tr key={row.id} className="align-top transition hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <p className="max-w-[220px] truncate text-[10.5px] font-bold text-[#14213D]">{row.title}</p>
                            <p className="mt-0.5 max-w-[220px] truncate font-mono text-[8.5px] text-slate-400">{row.eventType}</p>
                          </td>
                          <td className="px-4 py-3"><ChannelBadge channel={row.channel} /></td>
                          <td className="px-4 py-3">
                            <span className={'inline-flex rounded-full border px-2 py-1 text-[8.5px] font-black uppercase ' + statusTone(row.status)}>
                              {row.status.replaceAll('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {row.error
                              ? <p className="max-w-sm text-[9px] leading-relaxed text-red-700">{row.error}</p>
                              : <span className="text-[9px] text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3 text-[9px] text-slate-500">{formatWhen(row.updatedAt)} · {row.attempts} attempt{row.attempts === 1 ? '' : 's'}</td>
                          <td className="px-4 py-3">
                            {row.status === 'dead_letter' ? (
                              <button
                                type="button"
                                onClick={() => void retryDeadLetter(row.id)}
                                disabled={retryingId === row.id}
                                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[9px] font-black text-red-700 disabled:opacity-50"
                              >
                                {retryingId === row.id ? 'Queueing…' : 'Retry'}
                              </button>
                            ) : (
                              <span className="text-[9px] text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-slate-100 lg:hidden">
                  {(ops?.recentFailures || []).map(row => (
                    <div key={row.id} className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={'rounded-full border px-2 py-1 text-[8px] font-black uppercase ' + statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</span>
                        <ChannelBadge channel={row.channel} />
                      </div>
                      <p className="mt-2 text-[10.5px] font-bold text-[#14213D]">{row.title}</p>
                      <p className="mt-0.5 font-mono text-[8.5px] text-slate-400">{row.eventType}</p>
                      {row.error && <p className="mt-2 text-[9px] leading-relaxed text-red-700">{row.error}</p>}
                      <p className="mt-2 text-[8.5px] text-slate-400">Updated {formatWhen(row.updatedAt)} · {row.attempts} attempt{row.attempts === 1 ? '' : 's'}</p>
                      {row.status === 'dead_letter' && (
                        <button
                          type="button"
                          onClick={() => void retryDeadLetter(row.id)}
                          disabled={retryingId === row.id}
                          className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[9px] font-black text-red-700 disabled:opacity-50"
                        >
                          {retryingId === row.id ? 'Queueing…' : 'Retry delivery'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {activeTab === 'preferences' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[12px] font-black text-[#14213D]">User Preferences & Delivery Settings</h3>
                <p className="mt-0.5 text-[9px] text-slate-400">These settings apply to your current ERP user. Critical and mandatory events can bypass user preferences.</p>
              </div>
              <button type="button" onClick={() => void savePreference()} disabled={!preference || savingPreference} className="min-h-9 rounded-xl bg-[#00AEEF] px-4 text-[9px] font-black text-white disabled:opacity-50">
                {savingPreference ? 'Saving…' : 'Save preferences'}
              </button>
            </div>

            {!preference ? (
              <div className="py-16 text-center text-[10px] text-slate-400">{loadingSecondary ? 'Loading preferences…' : 'Preferences unavailable.'}</div>
            ) : (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    { key: 'emailEnabled', label: 'Email', desc: 'Transactional and workflow email' },
                    { key: 'smsEnabled', label: 'SMS', desc: 'Text alerts and required HR approvals' },
                    { key: 'inAppEnabled', label: 'In-app', desc: 'ERP notification centre alerts' },
                    { key: 'pushEnabled', label: 'Push', desc: 'Browser and device push alerts' },
                    { key: 'whatsappEnabled', label: 'WhatsApp', desc: 'Customer and supported workflow messaging' },
                    { key: 'soundEnabled', label: 'Notification sound', desc: 'Play a sound for eligible in-app notifications' },
                  ].map(item => (
                    <div key={item.key} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-[#FBFDFF] p-3.5">
                      <div>
                        <p className="text-[10px] font-black text-slate-700">{item.label}</p>
                        <p className="mt-0.5 text-[8.5px] text-slate-400">{item.desc}</p>
                      </div>
                      <MiniToggle
                        checked={Boolean(preference[item.key as keyof NotificationPreference])}
                        label={'Toggle ' + item.label}
                        onChange={checked => setPreference(current => current ? { ...current, [item.key]: checked } : current)}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-slate-700">Quiet Hours</p>
                        <p className="mt-0.5 text-[8.5px] text-slate-400">Pause non-urgent notifications during these hours.</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <input type="time" value={preference.quietStart || ''} onChange={event => setPreference(current => current ? { ...current, quietStart: event.target.value || null } : current)} className="h-10 min-w-0 rounded-xl border border-slate-200 px-2 text-[9.5px]" />
                      <span className="text-[9px] text-slate-400">to</span>
                      <input type="time" value={preference.quietEnd || ''} onChange={event => setPreference(current => current ? { ...current, quietEnd: event.target.value || null } : current)} className="h-10 min-w-0 rounded-xl border border-slate-200 px-2 text-[9.5px]" />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-[10px] font-black text-slate-700">Digest & Severity</p>
                    <p className="mt-0.5 text-[8.5px] text-slate-400">Control summary delivery and your minimum alert severity.</p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-[9px] font-semibold text-slate-600">
                        <input type="checkbox" checked={preference.digestEnabled} onChange={event => setPreference(current => current ? { ...current, digestEnabled: event.target.checked } : current)} />
                        Digest enabled
                      </label>
                      <select value={preference.minimumSeverity} onChange={event => setPreference(current => current ? { ...current, minimumSeverity: event.target.value } : current)} className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-600">
                        <option value="info">Info+</option>
                        <option value="success">Success+</option>
                        <option value="attention">Attention+</option>
                        <option value="warning">Warning+</option>
                        <option value="critical">Critical only</option>
                      </select>
                    </div>
                    <label className="mt-3 block">
                      <span className="text-[8.5px] font-semibold text-slate-500">Timezone</span>
                      <input value={preference.timezone} onChange={event => setPreference(current => current ? { ...current, timezone: event.target.value } : current)} className="mt-1.5 h-9 w-full rounded-xl border border-slate-200 px-3 text-[9px]" />
                    </label>
                  </div>
                </div>
              </>
            )}
          </section>

          <aside className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mx-auto max-w-[280px] overflow-hidden rounded-[32px] border-[7px] border-[#151A2D] bg-white shadow-lg">
              <div className="bg-[#1646C8] px-4 py-4 text-white">
                <div className="flex items-center gap-2">
                  <span className="text-lg">‹</span>
                  <strong className="text-[11px]">My Notifications</strong>
                </div>
              </div>
              <div className="p-3">
                <h4 className="text-[10px] font-black text-[#14213D]">Notification Preferences</h4>
                <p className="mt-0.5 text-[7.5px] text-slate-400">Manage how you receive notifications</p>
                <div className="mt-3 space-y-2">
                  {[
                    ['Email', preference?.emailEnabled],
                    ['SMS', preference?.smsEnabled],
                    ['In-app', preference?.inAppEnabled],
                    ['WhatsApp', preference?.whatsappEnabled],
                  ].map(([label, enabled]) => (
                    <div key={String(label)} className="flex items-center justify-between rounded-xl border border-slate-200 p-2.5">
                      <div>
                        <p className="text-[8.5px] font-bold text-slate-700">{String(label)}</p>
                        <p className="text-[7px] text-slate-400">{enabled ? 'Enabled' : 'Disabled'}</p>
                      </div>
                      <span className={'h-4 w-7 rounded-full p-0.5 ' + (enabled ? 'bg-blue-600' : 'bg-slate-200')}>
                        <span className={'block h-3 w-3 rounded-full bg-white ' + (enabled ? 'ml-3' : '')} />
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-xl border border-slate-200 p-2.5">
                  <p className="text-[8px] font-bold text-slate-700">Quiet Hours</p>
                  <p className="mt-1 text-[7px] text-slate-400">{preference?.quietStart || 'Not set'} – {preference?.quietEnd || 'Not set'}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {activeTab === 'gateways' && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[12px] font-black text-[#14213D]">Channel Gateways</h3>
                <p className="mt-0.5 text-[9px] text-slate-400">This view reports observed provider traffic. It does not claim provider health when no traffic has been recorded.</p>
              </div>
              {onOpenEmailSettings && (
                <button type="button" onClick={onOpenEmailSettings} className="min-h-9 rounded-xl border border-slate-200 bg-white px-4 text-[9px] font-bold text-[#1A1F5E]">Open Email / SMTP settings</button>
              )}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {channelCards.map(item => {
                const failures = (ops?.recentFailures || []).filter(row => row.channel === item.channel).length
                return (
                  <div key={item.channel} className="rounded-2xl border border-slate-200 bg-[#FBFDFF] p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
                        <Fa icon={item.channel === 'email' ? faEnvelope : item.channel === 'in_app' ? faBell : faPaperPlane} />
                      </div>
                      <span className={'rounded-full px-2 py-1 text-[8px] font-black uppercase ' + (item.count > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                        {item.count > 0 ? 'Activity observed' : 'No recent traffic'}
                      </span>
                    </div>
                    <h4 className="mt-4 text-[12px] font-black text-[#14213D]">{item.label}</h4>
                    <p className="mt-1 text-[9px] text-slate-400">{item.providers.length ? 'Provider: ' + item.providers.join(', ') : 'No provider name recorded in the selected period.'}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-slate-100 bg-white p-2.5"><p className="text-[8px] text-slate-400">Deliveries</p><strong className="text-[13px] text-slate-800">{item.count.toLocaleString()}</strong></div>
                      <div className="rounded-xl border border-slate-100 bg-white p-2.5"><p className="text-[8px] text-slate-400">Exceptions</p><strong className={failures ? 'text-[13px] text-red-600' : 'text-[13px] text-emerald-600'}>{failures}</strong></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h3 className="text-[11px] font-black text-[#14213D]">Gateway Operations Notes</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3"><p className="text-[9px] font-black text-blue-800">Email</p><p className="mt-1 text-[8.5px] leading-relaxed text-blue-700">SMTP readiness and test delivery remain in Email / SMTP settings. Notification templates consume the configured sender.</p></div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3"><p className="text-[9px] font-black text-emerald-800">SMS & replies</p><p className="mt-1 text-[8.5px] leading-relaxed text-emerald-700">Outbound SMS and inbound replies are persisted in the SMS Message Center, including opt-out enforcement.</p></div>
              <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3"><p className="text-[9px] font-black text-violet-800">Mandatory routing</p><p className="mt-1 text-[8.5px] leading-relaxed text-violet-700">Critical and mandatory policies are governed by the central policy registry and can bypass individual user preferences.</p></div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
