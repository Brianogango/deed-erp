'use client'
import { useState, useEffect, useRef, ReactNode } from 'react'
import { fmtKes } from '@/lib/store'
import { exportToPDF, exportToExcel, ExportRow } from '@/lib/export-utils'

// ─── Badge ────────────────────────────────────────────────────────────────────
const statusColor: Record<string, string> = {
  // greens
  paid: 'badge-green', done: 'badge-green', active: 'badge-green', received: 'badge-green',
  delivered: 'badge-green', invoiced: 'badge-green', signed: 'badge-green', confirmed: 'badge-green',
  posted: 'badge-green', won: 'badge-green', ready: 'badge-green', open: 'badge-green',
  closed: 'badge-green', approved: 'badge-green',
  // ambers
  pending: 'badge-amber', quotation: 'badge-amber', under_repair: 'badge-amber',
  sent: 'badge-amber', proforma: 'badge-amber', draft: 'badge-amber', partial: 'badge-amber',
  assigned: 'badge-amber', awaiting_approval: 'badge-amber', diagnosed: 'badge-amber',
  // purples
  in_repair: 'badge-purple', qc: 'badge-purple',
  // reds
  cancelled: 'badge-red', overdue: 'badge-red', urgent: 'badge-red', critical: 'badge-red', lost: 'badge-red',
  // blues
  transit: 'badge-blue', confirmed_blue: 'badge-blue',
}
const statusLabel: Record<string, string> = {
  under_repair: 'In Repair', customer_invoice: 'Invoice', vendor_bill: 'Bill',
  customer_refund: 'Refund', vendor_refund: 'Refund', quotation: 'Quotation',
  proforma: 'Proforma', confirmed: 'Confirmed', invoiced: 'Invoiced',
}

export function Badge({ status, label, size = 'sm' }: { status: string; label?: string; size?: 'xs' | 'sm' }) {
  const cls = statusColor[status] ?? 'badge-gray'
  const text = label ?? statusLabel[status] ?? status
  return <span className={`badge ${cls} ${size === 'xs' ? 'text-[9px] px-1.5' : ''}`}>{text}</span>
}

// ─── Toast ────────────────────────────────────────────────────────────────────
export function Toast({ toast }: { toast: { msg: string; type: 'success' | 'error' | 'info' } | null }) {
  if (!toast) return null
  const cls = toast.type === 'success' ? 'bg-emerald-500 shadow-emerald-500/25 ring-emerald-500/30'
             : toast.type === 'error' ? 'bg-red-500 shadow-red-500/25 ring-red-500/30'
             : 'bg-sky-500 shadow-sky-500/25 ring-sky-500/30'
  const icon = toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-6 z-[500] flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-white shadow-2xl ring-1 ring-white/20 w-[calc(100vw-32px)] sm:w-auto sm:min-w-[280px] ${cls}`}>
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold bg-white/20 flex-shrink-0">{icon}</span>
      <span className="flex-1">{toast.msg}</span>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = 520, subtitle }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; width?: number
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div 
      className="fixed inset-0 z-[9000] backdrop-blur-sm bg-black/45 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" onClick={onClose}>
      <div 
        className="flex flex-col max-w-[96vw] max-h-[92vh] w-[var(--modal-width,520px)] rounded-2xl overflow-hidden shadow-2xl border ring-1 ring-border/50 bg-card"
        style={{ '--modal-width': width } as React.CSSProperties}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-surface border-border-lt flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-text-1">{title}</h2>
            {subtitle && <p className="text-[11px] mt-0.5 text-text-3">{subtitle}</p>}
          </div>
          <button 
            className="flex items-center justify-center w-7 h-7 rounded-md bg-muted text-text-3 text-lg font-bold hover:bg-muted/75 transition-colors"
            onClick={onClose}
            aria-label="Close">
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

// ─── Slide Panel (document view) ──────────────────────────────────────────────
export function SlidePanel({ title, subtitle, onClose, children, actions }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; actions?: ReactNode
}) {
  return (
    <div 
      className="fixed inset-0 z-[9000] backdrop-blur-xs bg-black/40 flex justify-end"
      role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex flex-col w-full sm:w-[min(95vw,720px)] max-w-5xl h-full overflow-hidden bg-card border-l border-border shadow-2xl shadow-black/20"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b bg-surface border-border-lt flex-shrink-0">
          <button 
            className="p-1.5 text-text-3 text-2xl hover:bg-muted/50 rounded-lg transition-colors"
            onClick={onClose}
            aria-label="Close panel">
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-text-1">{title}</h2>
            {subtitle && <p className="text-[10px] text-text-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Confirm ──────────────────────────────────────────────────────────────────
export function Confirm({ message, detail, onConfirm, onCancel, confirmLabel = 'Delete', confirmColor = 'bg-destructive' }: {
  message: string; detail?: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; confirmColor?: string
}) {
  return (
    <div className="fixed inset-0 z-[9100] backdrop-blur-sm bg-black/45 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-[min(380px,calc(100vw-32px))] rounded-2xl p-6 flex flex-col gap-4 bg-card border ring-1 ring-border/50 shadow-2xl">
        <p className="text-sm font-semibold text-text-1">{message}</p>
        {detail && <p className="text-xs text-text-3">{detail}</p>}
        <div className="flex gap-2 justify-end">
          <button className="btn-outline h-9 px-4" onClick={onCancel}>Cancel</button>
          <button className={`btn-primary h-9 px-6 font-semibold ${confirmColor}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Form Field ───────────────────────────────────────────────────────────────
export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-wider font-medium text-text-3">
        {label}{required && <span className="text-destructive ml-0.5"> *</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-text-4">{hint}</p>}
    </div>
  )
}

export function Input({ value, onChange, placeholder, type = 'text', disabled, autoFocus, maxLength, pattern }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean; autoFocus?: boolean; maxLength?: number; pattern?: string
}) {
  return (
    <input autoFocus={autoFocus} disabled={disabled} className="form-input" type={type}
      value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      maxLength={maxLength} pattern={pattern} />
  )
}

export function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  return (
    <textarea className="form-input" rows={rows} value={value}
      onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ resize: 'vertical', fontFamily: 'Inter, sans-serif' }} />
  )
}

export function Select({ value, onChange, options, disabled }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className="relative">
      <select className="form-select w-full" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-text-4 text-xs">▾</span>
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function Table({ cols, children, empty = 'No records found', minWidth = 800 }: {
  cols: { label: string; width?: string }[]
  children: ReactNode
  empty?: string
  minWidth?: number
}) {
  const grid = cols.map(c => c.width ?? '1fr').join(' ')
  return (
    <div className="overflow-x-auto w-full">
      <div className="flex flex-col" style={{ minWidth, '--table-cols': grid } as React.CSSProperties}>
        <div className="table-head" style={{ gridTemplateColumns: grid }}>
          {cols.map(c => <span key={c.label}>{c.label}</span>)}
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Panel Header ─────────────────────────────────────────────────────────────
export function PanelHeader({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 border-b flex-wrap flex-shrink-0 bg-gray-50/30" style={{ borderColor: '#F3F4F6' }}>
      <span className="text-xs sm:text-sm font-bold text-gray-800">{title}</span>
      {count !== undefined && <span className="badge badge-gray">{count}</span>}
      {children && <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color, icon, onClick }: {
  label: string; value: string | number; sub?: string; color: string; icon?: ReactNode; onClick?: () => void
}) {
  return (
    <div
      className="group/card card flex flex-col gap-1 transition-all hover:shadow-md hover:border-primary/30"
      role="button" tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', padding: '10px 12px' }}>
      <div className="flex items-start justify-between gap-1">
        <p className="text-[9px] uppercase tracking-[0.6px] font-semibold leading-tight" style={{ color: 'var(--text-3)' }}>{label}</p>
        {icon && (
          <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: color + '18', color }}>
            <span className="text-[11px]">{icon}</span>
          </div>
        )}
      </div>
      <p className="text-base font-bold leading-none truncate" style={{ color }}>{value}</p>
      {sub && <p className="text-[9px] leading-tight truncate" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

// ─── Search + Dropdown (for picking contacts/products) ────────────────────────
export function SearchPicker<T extends { id: string; name: string }>({
  label, placeholder, items, onSelect, renderItem, value
}: {
  label: string
  placeholder: string
  items: T[]
  onSelect: (item: T) => void
  renderItem?: (item: T) => ReactNode
  value?: string
}) {
  const [q, setQ] = useState(value ?? '')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = q.length > 0 ? items.filter(i => i.name.toLowerCase().includes(q.toLowerCase())) : items.slice(0, 8)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <Field label={label}>
      <div ref={ref} className="relative">
        <input className="form-input" value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder} />
        {open && filtered.length > 0 && (
          <div className="absolute z-40 w-full mt-1.5 rounded-xl overflow-hidden shadow-2xl border ring-1 ring-border max-h-52 overflow-y-auto bg-card">
            {filtered.map(item => (
              <div 
                key={item.id} 
                className="px-3 py-2.5 cursor-pointer text-xs transition-all hover:bg-accent/10 text-text-1 first:rounded-t-xl last:rounded-b-xl border-b border-border-lt last:border-b-0 [&:first-child]:mt-0" 
                onClick={() => { onSelect(item); setQ(item.name); setOpen(false) }}>
                {renderItem ? renderItem(item) : item.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </Field>
  )
}

// ─── Document Info Row ────────────────────────────────────────────────────────
export function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-[10px] uppercase tracking-[0.5px] flex-shrink-0 w-28 text-t3" style={{ paddingTop: 1 }}>{label}</span>
      <span className={`text-xs ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// ─── Divider ──────────────────────────────────────────────────────────────────
export function Divider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 my-1">
      <div className="flex-1 border-b" style={{ borderColor: '#F3F4F6' }} />
      {label && <span className="text-[9px] uppercase tracking-wider text-t3">{label}</span>}
      <div className="flex-1 border-b" style={{ borderColor: '#F3F4F6' }} />
    </div>
  )
}

// ─── Status Flow Stepper ──────────────────────────────────────────────────────
export function StatusStepper({ steps, current }: { steps: string[]; current: string }) {
  const idx = steps.indexOf(current)
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
      <div className="flex items-center gap-0 min-w-max">
        {steps.map((s, i) => {
          const done = i < idx
          const active = i === idx
          return (
            <div key={s} className="flex items-center">
              <div className="flex flex-col items-center gap-0.5">
                <div className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-[9px] sm:text-[10px] font-bold ring-1 ring-border/50 shadow-sm transition-all duration-200 ${
                  done ? 'bg-green text-white'
                  : active ? 'bg-primary text-primary-fg'
                  : 'bg-muted text-text-4'
                }`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className={`text-[8px] sm:text-[9px] capitalize whitespace-nowrap font-medium transition-colors ${
                  active ? 'text-primary' : done ? 'text-green' : 'text-text-4'
                }`}>{s}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`w-4 sm:w-8 h-px mx-0.5 sm:mx-1 rounded-full transition-colors ${
                  done ? 'bg-green' : 'bg-border'
                }`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── ExportButtons ────────────────────────────────────────────────────────────
export function ExportButtons({
  title,
  filename,
  headers,
  rows,
  orientation = 'landscape',
}: {
  title: string
  filename: string
  headers: string[]
  rows: ExportRow[]
  orientation?: 'portrait' | 'landscape'
}) {
  return (
    <div className="flex gap-1.5">
      <button
        className="btn-outline text-[10px] px-2.5 py-1"
        style={{ color: '#EF4444', borderColor: '#FCA5A5' }}
        onClick={() => exportToPDF(title, headers, rows, filename, orientation)}
        title="Download PDF"
      >
        ⬇ PDF
      </button>
      <button
        className="btn-outline text-[10px] px-2.5 py-1"
        style={{ color: '#10B981', borderColor: '#6EE7B7' }}
        onClick={() => exportToExcel(title, headers, rows, filename)}
        title="Download Excel"
      >
        ⬇ Excel
      </button>
    </div>
  )
}

// ─── DataTable ────────────────────────────────────────────────────────────────
// Structured, fully mobile-responsive table. Desktop = grid, mobile = cards.
export function DataTable<T>({
  cols, rows, keyFn, empty = 'No records', onRowClick,
}: {
  cols: { label: string; width?: string; mobileHide?: boolean; render: (row: T) => ReactNode }[]
  rows: T[]
  keyFn: (row: T) => string
  empty?: string
  onRowClick?: (row: T) => void
}) {
  const visibleCols = cols.filter(c => !c.mobileHide)
  const grid = cols.map(c => c.width ?? '1fr').join(' ')

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-xs text-text-3">{empty}</div>
    )
  }

  return (
    <div>
      {/* ── Desktop grid ── */}
      <div className="hidden sm:block overflow-x-auto w-full">
        <div className="flex flex-col" style={{ '--table-cols': grid } as React.CSSProperties}>
          <div className="table-head" style={{ gridTemplateColumns: grid }}>
            {cols.map(c => <span key={c.label}>{c.label}</span>)}
          </div>
          {rows.map(row => (
            <div
              key={keyFn(row)}
              className="table-row"
              style={{ gridTemplateColumns: grid, cursor: onRowClick ? 'pointer' : 'default' }}
              onClick={() => onRowClick?.(row)}
            >
              {cols.map(c => <span key={c.label}>{c.render(row)}</span>)}
            </div>
          ))}
        </div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="sm:hidden divide-y" style={{ borderColor: 'var(--border-lt)' }}>
        {rows.map(row => (
          <div
            key={keyFn(row)}
            className="px-4 py-3 transition-colors hover:bg-surface"
            style={{ cursor: onRowClick ? 'pointer' : 'default', background: 'var(--bg-card)' }}
            onClick={() => onRowClick?.(row)}
          >
            {/* First visible col = primary */}
            <div className="font-semibold text-[13px] text-text-1 mb-1">
              {visibleCols[0]?.render(row)}
            </div>
            {/* Remaining visible cols = stacked label:value pairs */}
            <div className="flex flex-col gap-1">
              {visibleCols.slice(1).map(c => (
                <div key={c.label} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-text-4 flex-shrink-0">{c.label}</span>
                  <span className="text-[11px] text-text-2 text-right">{c.render(row)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, desc, action }: {
  icon?: ReactNode; title: string; desc?: string; action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center gap-3">
      {icon && <div className="text-4xl opacity-30 mb-1">{icon}</div>}
      <p className="text-sm font-semibold text-text-2">{title}</p>
      {desc && <p className="text-xs text-text-3 max-w-xs leading-relaxed">{desc}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

// ─── FilterTabs ───────────────────────────────────────────────────────────────
export function FilterTabs<T extends string>({
  tabs, active, onChange, counts,
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
  counts?: Partial<Record<T, number>>
}) {
  return (
    <div className="flex gap-1 overflow-x-auto scrollbar-hide py-0.5">
      {tabs.map(t => {
        const isActive = t.id === active
        const count = counts?.[t.id]
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap flex-shrink-0 transition-all border cursor-pointer"
            style={{
              background: isActive ? 'var(--primary)' : 'transparent',
              color: isActive ? 'var(--primary-fg)' : 'var(--text-3)',
              borderColor: isActive ? 'var(--primary)' : 'var(--border)',
            }}
          >
            {t.label}
            {count !== undefined && (
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={{ background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--bg-muted)', color: isActive ? '#fff' : 'var(--text-3)' }}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── PageHeader ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions, badge }: {
  title: string; subtitle?: string; actions?: ReactNode; badge?: ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[15px] font-bold text-text-1 leading-tight truncate">{title}</h2>
            {badge}
          </div>
          {subtitle && <p className="text-[11px] text-text-3 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ─── SectionCard ─────────────────────────────────────────────────────────────
export function SectionCard({ title, action, children, noPad }: {
  title?: string; action?: ReactNode; children: ReactNode; noPad?: boolean
}) {
  return (
    <div className="card overflow-hidden">
      {title && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b"
          style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
          <p className="text-[10.5px] font-bold text-text-3 uppercase tracking-widest">{title}</p>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-4 sm:p-5'}>{children}</div>
    </div>
  )
}

export function ModuleSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse w-full max-w-6xl mx-auto">
      <div className="flex justify-between items-start">
        <div className="space-y-3">
          <div className="h-6 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-100 rounded w-72" />
        </div>
        <div className="h-9 bg-gray-200 rounded w-32" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
      </div>
      <div className="h-96 bg-gray-50 rounded-xl border border-gray-100" />
    </div>
  )
}

// ─── Skeleton primitives ──────────────────────────────────────────────────────
const shimmer = {
  background: 'linear-gradient(90deg, var(--bg-muted) 25%, var(--bg-card) 50%, var(--bg-muted) 75%)',
  backgroundSize: '200% 100%',
  animation: 'skeletonShimmer 1.4s ease-in-out infinite',
} as React.CSSProperties

export function Sk({ w = '100%', h = 14, radius = 6, className = '' }: { w?: string | number; h?: number; radius?: number; className?: string }) {
  return <div style={{ width: w, height: h, borderRadius: radius, flexShrink: 0, ...shimmer }} className={className} />
}

export function SkStatCards({ count = 5 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Sk w={70} h={10} />
            <Sk w={28} h={28} radius={8} />
          </div>
          <Sk w={90} h={22} radius={4} />
          <Sk w={55} h={9} />
        </div>
      ))}
    </div>
  )
}

export function SkTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  const colWidths = Array.from({ length: cols }, (_, i) => i === 0 ? '2fr' : '1fr').join(' ')
  return (
    <div className="card overflow-hidden">
      <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <Sk w={120} h={14} />
          <Sk w={80} h={28} radius={8} />
        </div>
      </div>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: colWidths, gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="flex flex-col gap-1.5">
              <Sk w="70%" h={11} />
              <Sk w="45%" h={9} />
            </div>
            {Array.from({ length: cols - 1 }).map((_, j) => (
              <Sk key={j} w="60%" h={11} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkKanban({ cols = 6 }: { cols?: number }) {
  return (
    <div style={{ display: 'flex', gap: 12, overflow: 'hidden' }}>
      {Array.from({ length: cols }).map((_, c) => (
        <div key={c} style={{ width: 260, flexShrink: 0 }} className="flex flex-col gap-2">
          <div className="card p-3 flex items-center justify-between">
            <div className="flex flex-col gap-1.5 flex-1">
              <Sk w="55%" h={11} />
              <Sk w="35%" h={9} />
            </div>
            <Sk w={24} h={20} radius={10} />
          </div>
          {Array.from({ length: c % 2 === 0 ? 3 : 2 }).map((_, r) => (
            <div key={r} className="card p-3 flex flex-col gap-2">
              <Sk w="80%" h={11} />
              <Sk w="50%" h={9} />
              <div className="flex items-center gap-2 mt-1">
                <div style={{ flex: 1, height: 6, borderRadius: 3, ...shimmer }} />
                <Sk w={24} h={9} />
              </div>
              <div className="flex items-center justify-between">
                <Sk w={60} h={10} />
                <Sk w={30} h={9} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkDashboard() {
  return (
    <div className="flex flex-col gap-4">
      <SkStatCards count={5} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <div className="card p-4 flex flex-col gap-3">
          <Sk w={140} h={14} />
          <Sk w="100%" h={160} radius={8} />
        </div>
        <div className="card p-4 flex flex-col gap-3">
          <Sk w={100} h={14} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <Sk w={90} h={11} />
                <Sk w={60} h={9} />
              </div>
              <Sk w={50} h={20} radius={6} />
            </div>
          ))}
        </div>
      </div>
      <SkTable rows={5} cols={5} />
    </div>
  )
}

export function SkListModule({ statCount = 4, tableCols = 5, tableRows = 7 }: { statCount?: number; tableCols?: number; tableRows?: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="flex gap-1">
          {Array.from({ length: 4 }).map((_, i) => <Sk key={i} w={72} h={30} radius={8} />)}
        </div>
        <div style={{ flex: 1 }} />
        <Sk w={90} h={30} radius={8} />
        <Sk w={110} h={30} radius={8} />
      </div>
      <SkStatCards count={statCount} />
      <SkTable rows={tableRows} cols={tableCols} />
    </div>
  )
}

export function SkKanbanModule() {
  return (
    <div className="flex flex-col gap-4">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {Array.from({ length: 3 }).map((_, i) => <Sk key={i} w={80} h={30} radius={8} />)}
        <div style={{ flex: 1 }} />
        <Sk w={80} h={30} radius={8} />
        <Sk w={100} h={30} radius={8} />
      </div>
      <SkStatCards count={5} />
      <SkKanban cols={6} />
    </div>
  )
}

export function SkPOS() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 12, height: 'calc(100vh - 120px)' }}>
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <Sk w="100%" h={34} radius={8} />
          <Sk w={90} h={34} radius={8} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card p-3 flex flex-col gap-2">
              <Sk w="100%" h={60} radius={6} />
              <Sk w="70%" h={11} />
              <Sk w="50%" h={10} />
            </div>
          ))}
        </div>
      </div>
      <div className="card p-4 flex flex-col gap-3">
        <Sk w={120} h={16} />
        <div className="flex flex-col gap-2 flex-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Sk w={36} h={36} radius={6} />
              <div className="flex-1 flex flex-col gap-1">
                <Sk w="70%" h={11} />
                <Sk w="40%" h={9} />
              </div>
              <Sk w={55} h={11} />
            </div>
          ))}
        </div>
        <div className="border-t pt-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="flex justify-between"><Sk w={60} h={11} /><Sk w={70} h={11} /></div>
          <div className="flex justify-between"><Sk w={40} h={11} /><Sk w={50} h={11} /></div>
          <Sk w="100%" h={40} radius={10} />
        </div>
      </div>
    </div>
  )
}

const SKELETON_MAP: Record<string, React.ComponentType> = {
  dashboard: SkDashboard,
  crm: SkKanbanModule,
  pos: SkPOS,
}

export function SkeletonModule({ moduleId }: { moduleId: string }) {
  const Comp = SKELETON_MAP[moduleId]
  return (
    <div className="animate-pulse">
      {Comp ? <Comp /> : (
        <SkListModule
          statCount={moduleId === 'hr' ? 3 : 4}
          tableCols={5}
          tableRows={8}
        />
      )}
    </div>
  )
}
