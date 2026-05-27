'use client'

import { useState, useEffect, useRef, ReactNode, useCallback } from 'react'
import { fmtKes } from '@/lib/store'
import { exportToPDF, exportToExcel, ExportRow } from '@/lib/export-utils'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const statusColor: Record<string, string> = {
  // greens
  paid: 'badge-green',
  done: 'badge-green',
  active: 'badge-green',
  received: 'badge-green',
  delivered: 'badge-green',
  invoiced: 'badge-green',
  signed: 'badge-green',
  confirmed: 'badge-green',
  posted: 'badge-green',
  won: 'badge-green',
  ready: 'badge-green',
  open: 'badge-green',
  closed: 'badge-green',
  approved: 'badge-green',
  // ambers
  pending: 'badge-amber',
  quotation: 'badge-amber',
  under_repair: 'badge-amber',
  sent: 'badge-amber',
  proforma: 'badge-amber',
  draft: 'badge-amber',
  partial: 'badge-amber',
  assigned: 'badge-amber',
  awaiting_approval: 'badge-amber',
  diagnosed: 'badge-amber',
  // purples
  in_repair: 'badge-purple',
  qc: 'badge-purple',
  // reds
  cancelled: 'badge-red',
  overdue: 'badge-red',
  urgent: 'badge-red',
  critical: 'badge-red',
  lost: 'badge-red',
  // blues
  transit: 'badge-blue',
  confirmed_blue: 'badge-blue',
}

const statusLabel: Record<string, string> = {
  under_repair: 'In Repair',
  customer_invoice: 'Invoice',
  vendor_bill: 'Bill',
  customer_refund: 'Refund',
  vendor_refund: 'Refund',
  quotation: 'Quotation',
  proforma: 'Proforma',
  confirmed: 'Confirmed',
  invoiced: 'Invoiced',
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Badge Component
 */
export function Badge({
  status,
  label,
  size = 'sm',
}: {
  status: string
  label?: string
  size?: 'xs' | 'sm'
}) {
  const cls = statusColor[status] ?? 'badge-gray'
  const text = label ?? statusLabel[status] ?? status
  return (
    <span className={`badge ${cls} ${size === 'xs' ? 'text-[9px] px-1.5' : ''}`}>
      {text}
    </span>
  )
}

/**
 * ToneBadge — uses the friendly ERP palette (sage/coral/honey/mist/stone)
 * Use for contextual labels that don't map to a binary pass/fail status.
 */
export function ToneBadge({
  tone,
  children,
  size = 'sm',
}: {
  tone: 'sage' | 'coral' | 'honey' | 'mist' | 'stone'
  children: React.ReactNode
  size?: 'xs' | 'sm'
}) {
  return (
    <span className={`badge badge-${tone} ${size === 'xs' ? 'text-[9px] px-1.5' : ''}`}>
      {children}
    </span>
  )
}

/**
 * Toast Notification Component
 */
export function Toast({
  toast,
}: {
  toast: { msg: string; type: 'success' | 'error' | 'info' } | null
}) {
  if (!toast) return null
  const cls =
    toast.type === 'success'
      ? 'bg-emerald-500 shadow-emerald-500/25 ring-emerald-500/30'
      : toast.type === 'error'
      ? 'bg-red-500 shadow-red-500/25 ring-red-500/30'
      : 'bg-sky-500 shadow-sky-500/25 ring-sky-500/30'
  const icon = toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'
  return (
    <div
      className={`
        fixed bottom-6 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-6 z-[9999]
        flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-white
        shadow-2xl ring-1 ring-white/20 w-[calc(100vw-32px)] sm:w-auto sm:min-w-[280px]
        animate-in slide-in-from-bottom-4 duration-300 ${cls}
      `}
    >
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold bg-white/20 flex-shrink-0">
        {icon}
      </span>
      <span className="flex-1">{toast.msg}</span>
    </div>
  )
}

/**
 * Modal Component
 * Responsive modal that adapts to screen size
 */
export function Modal({
  title,
  onClose,
  children,
  width = 520,
  subtitle,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[9000] backdrop-blur-sm bg-black/45 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="
          flex flex-col w-full rounded-2xl overflow-hidden shadow-2xl border
          ring-1 ring-border/50 bg-card animate-in zoom-in-95 duration-200
          max-h-[92vh]
        "
        style={{ maxWidth: width } as React.CSSProperties}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-surface border-border-lt flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-text-1">{title}</h2>
            {subtitle && <p className="text-[11px] mt-0.5 text-text-3">{subtitle}</p>}
          </div>
          <button
            className="
              flex items-center justify-center w-7 h-7 rounded-md bg-muted
              text-text-3 text-lg font-bold hover:bg-muted/75 transition-colors
            "
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-4">
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Slide Panel Component
 */
export function SlidePanel({
  title,
  subtitle,
  onClose,
  children,
  actions,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-[9000] backdrop-blur-xs bg-black/40 flex justify-end"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="
          flex flex-col w-full sm:w-[min(95vw,720px)] max-w-5xl h-full
          overflow-hidden bg-card border-l border-border shadow-2xl
          animate-in slide-in-from-right duration-300
        "
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b bg-surface border-border-lt flex-shrink-0">
          <button
            className="p-1.5 text-text-3 text-2xl hover:bg-muted/50 rounded-lg transition-colors"
            onClick={onClose}
            aria-label="Close panel"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-text-1">{title}</h2>
            {subtitle && <p className="text-[10px] text-text-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/**
 * Confirmation Dialog Component
 */
export function Confirm({
  message,
  detail,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete',
  confirmColor = 'bg-destructive',
}: {
  message: string
  detail?: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  confirmColor?: string
}) {
  return (
    <div
      className="fixed inset-0 z-[9100] backdrop-blur-sm bg-black/45 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="
        w-full max-w-[380px] rounded-2xl p-6 flex flex-col gap-4
        bg-card border ring-1 ring-border/50 shadow-2xl
        animate-in zoom-in-95 duration-200
      ">
        <p className="text-sm font-semibold text-text-1">{message}</p>
        {detail && <p className="text-xs text-text-3">{detail}</p>}
        <div className="flex gap-2 justify-end mt-2">
          <button className="btn-outline h-9 px-4" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`btn-primary h-9 px-6 font-semibold ${confirmColor}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Form Field Wrapper
 */
export function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string
  required?: boolean
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <label className="text-[10px] uppercase tracking-wider font-bold text-text-3">
        {label}
        {required && <span className="text-destructive ml-0.5"> *</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-text-4">{hint}</p>}
    </div>
  )
}

/**
 * Standard Input Component
 */
export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  autoFocus,
  maxLength,
  pattern,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
  autoFocus?: boolean
  maxLength?: number
  pattern?: string
}) {
  return (
    <input
      autoFocus={autoFocus}
      disabled={disabled}
      className="form-input w-full"
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      pattern={pattern}
    />
  )
}

/**
 * Standard Textarea Component
 */
export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      className="form-input w-full"
      rows={rows}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ resize: 'vertical' }}
    />
  )
}

/**
 * Standard Select Component
 */
export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className="relative w-full">
      <select
        className="form-select w-full pr-10"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-text-4 text-xs">
        ▾
      </span>
    </div>
  )
}

/**
 * Responsive Table Component
 */
export function Table({
  cols,
  children,
  empty = 'No records found',
  minWidth = 800,
}: {
  cols: { label: string; width?: string }[]
  children: ReactNode
  empty?: string
  minWidth?: number
}) {
  const grid = cols.map(c => c.width ?? '1fr').join(' ')
  return (
    <div className="overflow-x-auto w-full scrollbar-hide">
      <div
        className="flex flex-col"
        style={{ minWidth, '--table-cols': grid } as React.CSSProperties}
      >
        <div className="table-head" style={{ gridTemplateColumns: grid }}>
          {cols.map(c => (
            <span key={c.label}>{c.label}</span>
          ))}
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Panel Header Component
 */
export function PanelHeader({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children?: ReactNode
}) {
  return (
    <div className="
      flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5
      border-b bg-gray-50/30 border-border-lt flex-shrink-0
    ">
      <div className="flex items-center gap-2">
        <span className="text-xs sm:text-sm font-bold text-gray-800">{title}</span>
        {count !== undefined && <span className="badge badge-gray">{count}</span>}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * Stat Card Component
 */
export function StatCard({
  label,
  value,
  sub,
  color,
  icon,
  onClick,
}: {
  label: string
  value: string | number
  sub?: string
  color: string
  icon?: ReactNode
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`
        card p-5 flex flex-col gap-1 transition-all duration-200
        ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5' : ''}
      `}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-3">
          {label}
        </span>
        {icon && <span style={{ color }}>{icon}</span>}
      </div>
      <div className="text-xl font-extrabold text-text-1">{value}</div>
      {sub && <div className="text-[10px] text-text-4">{sub}</div>}
    </div>
  )
}

/**
 * Divider Component
 */
export function Divider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 my-2">
      {label && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-4 whitespace-nowrap">
          {label}
        </span>
      )}
      <div className="h-px bg-border-lt flex-1" />
    </div>
  )
}

/**
 * Search Picker Component
 */
export function SearchPicker<T extends { id: string }>({
  label,
  placeholder,
  items,
  onSelect,
  renderItem,
  onCreateNew,
  createNewLabels = { title: 'Create New', subtitle: 'Not found? Add it now' }
}: {
  label: string
  placeholder: string
  items: T[]
  onSelect: (item: T) => void
  renderItem: (item: T) => ReactNode
  onCreateNew?: (query: string) => void
  createNewLabels?: { title: string; subtitle: string }
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = items.filter(item =>
    JSON.stringify(item).toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])

  return (
    <div className="flex flex-col gap-1.5 relative w-full" ref={ref}>
      <label className="text-[10px] uppercase tracking-wider font-bold text-text-3">
        {label}
      </label>
      <div className="relative">
        <input
          className="form-input w-full pr-10"
          placeholder={placeholder}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-4">🔍</span>
      </div>
      {open && (filtered.length > 0 || (onCreateNew && query.length > 0)) && (
        <div className="
          absolute top-full left-0 right-0 mt-1 z-[9300]
          bg-card border border-border rounded-xl shadow-2xl
          max-h-60 overflow-y-auto divide-y divide-border-lt
          animate-in fade-in slide-in-from-top-2 duration-200
        ">
          {onCreateNew && query.length > 0 && (
            <div
              className="p-3 hover:bg-surface cursor-pointer transition-colors border-b border-border-lt bg-primary-50/30"
              onClick={() => {
                onCreateNew(query)
                setOpen(false)
                setQuery('')
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-lg">
                  +
                </div>
                <div>
                  <p className="text-xs font-bold text-primary-700">{createNewLabels.title} "{query}"</p>
                  <p className="text-[10px] text-primary-600/70">{createNewLabels.subtitle}</p>
                </div>
              </div>
            </div>
          )}
          {filtered.map(item => (
            <div
              key={item.id}
              className="p-3 hover:bg-surface cursor-pointer transition-colors"
              onClick={() => {
                onSelect(item)
                setOpen(false)
                setQuery('')
              }}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Status Stepper Component
 */
export function StatusStepper({ steps, current }: { steps: string[]; current: string }) {
  const currentIndex = steps.indexOf(current)
  return (
    <div className="flex items-center gap-2 w-full overflow-x-auto pb-2 scrollbar-hide">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-2 flex-shrink-0">
          <div
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider
              ${
                i <= currentIndex
                  ? 'bg-primary-500 text-white'
                  : 'bg-muted text-text-4 border border-border-lt'
              }
            `}
          >
            <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[8px]">
              {i + 1}
            </span>
            {step.replace('_', ' ')}
          </div>
          {i < steps.length - 1 && <div className="w-4 h-px bg-border-lt" />}
        </div>
      ))}
    </div>
  )
}

/**
 * Module Skeleton Loader
 */
export function ModuleSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="flex justify-between items-center">
        <div className="h-8 w-48 bg-muted rounded-lg" />
        <div className="h-10 w-32 bg-muted rounded-xl" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-24 bg-muted rounded-2xl" />
        ))}
      </div>
      <div className="h-12 bg-muted rounded-xl" />
      <div className="h-96 bg-muted rounded-2xl" />
    </div>
  )
}

/**
 * Tab Content Wrapper
 */
export function TabContent({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return null
  return <div className="animate-in fade-in duration-300">{children}</div>
}

/**
 * Tab Bar Component
 */
export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; icon?: ReactNode }[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap
            ${
              active === t.id
                ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                : 'bg-white text-text-3 hover:bg-surface border border-border-lt'
            }
          `}
        >
          {t.icon && <span className="text-sm">{t.icon}</span>}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Export Buttons Component
 */
export function ExportButtons({
  title,
  filename,
  headers,
  rows,
}: {
  title: string
  filename: string
  headers: string[]
  rows: ExportRow[]
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => exportToPDF(title, headers, rows, filename)}
        className="btn-secondary flex items-center gap-2"
      >
        <span>PDF</span>
      </button>
      <button
        onClick={() => exportToExcel(title, headers, rows, filename)}
        className="btn-secondary flex items-center gap-2"
      >
        <span>Excel</span>
      </button>
    </div>
  )
}

/**
 * Info Row — label + value pair used in detail panels
 */
export function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-[var(--border-lt)] last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-4)] w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className={`text-xs text-[var(--text-1)] flex-1 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

/**
 * Module Header — uniform top bar for every module
 */
export function ModuleHeader({
  title,
  subtitle,
  icon,
  count,
  actions,
  color = '#1B2762',
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  count?: number
  actions?: ReactNode
  color?: string
}) {
  return (
    <div className="mod-header">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {icon && (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ background: color + '18', color }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-extrabold text-text-1 truncate">{title}</h1>
            {count !== undefined && (
              <span className="badge badge-gray text-[9px]">{count.toLocaleString()}</span>
            )}
          </div>
          {subtitle && <p className="text-[10px] text-text-3 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">{actions}</div>
      )}
    </div>
  )
}

/**
 * Pagination — numbered with mobile-simplified mode
 */
export function Pagination({
  page,
  total,
  perPage = 20,
  onChange,
}: {
  page: number
  total: number
  perPage?: number
  onChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / perPage)
  if (totalPages <= 1) return null

  const start = (page - 1) * perPage + 1
  const end   = Math.min(page * perPage, total)

  // Build desktop page numbers with ellipsis
  const getPages = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | '…')[] = []
    if (page <= 4) {
      pages.push(1, 2, 3, 4, 5, '…', totalPages)
    } else if (page >= totalPages - 3) {
      pages.push(1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
    } else {
      pages.push(1, '…', page - 1, page, page + 1, '…', totalPages)
    }
    return pages
  }

  return (
    <div className="pagination">
      <span className="text-[10px] text-text-3 hidden sm:block">
        {start}–{end} of {total.toLocaleString()}
      </span>
      {/* Mobile simplified */}
      <div className="flex items-center gap-1 sm:hidden w-full justify-between">
        <button className="page-btn" onClick={() => onChange(page - 1)} disabled={page === 1}>‹ Prev</button>
        <span className="text-[11px] font-bold text-text-2">{page} / {totalPages}</span>
        <button className="page-btn" onClick={() => onChange(page + 1)} disabled={page === totalPages}>Next ›</button>
      </div>
      {/* Desktop numbered */}
      <div className="hidden sm:flex items-center gap-1">
        <button className="page-btn" onClick={() => onChange(page - 1)} disabled={page === 1}>‹</button>
        {getPages().map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="text-text-4 text-xs px-1">…</span>
          ) : (
            <button
              key={p}
              className={`page-btn ${page === p ? 'active' : ''}`}
              onClick={() => onChange(p as number)}
            >
              {p}
            </button>
          )
        )}
        <button className="page-btn" onClick={() => onChange(page + 1)} disabled={page === totalPages}>›</button>
      </div>
    </div>
  )
}

/**
 * Empty State placeholder
 */
export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div>
        <p className="text-xs font-bold text-text-2 uppercase tracking-wider">{title}</p>
        {subtitle && <p className="text-[10px] text-text-4 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/**
 * Filter Chip — colored pill filter button
 */
export function FilterChip({
  label,
  active,
  color,
  count,
  onClick,
}: {
  label: string
  active: boolean
  color?: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold
        uppercase tracking-wider whitespace-nowrap transition-all duration-150
        border flex-shrink-0
        ${active
          ? 'text-white border-transparent shadow-md'
          : 'bg-transparent text-text-3 border-border hover:bg-surface hover:text-text-1'
        }
      `}
      style={active ? { background: color ?? 'var(--primary)', borderColor: color ?? 'var(--primary)' } : {}}
    >
      {label}
      {count !== undefined && (
        <span className={`
          w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black
          ${active ? 'bg-white/25' : 'bg-muted'}
        `}>{count > 99 ? '99+' : count}</span>
      )}
    </button>
  )
}

/**
 * Search Input with icon
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-4 pointer-events-none text-[11px]">🔍</span>
      <input
        className="form-input pl-8 w-full"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}
