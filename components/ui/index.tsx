'use client'

import { Children, useState, useEffect, useRef, ReactNode, useCallback, useId, cloneElement, isValidElement, useMemo, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
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
  // invoice partial
  partially_paid: 'badge-amber',
  warning: 'badge-amber',
}

const statusLabel: Record<string, string> = {
  partially_paid: 'Partial',
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

let bodyLockCount = 0
let previousBodyOverflow = ''

export function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    if (bodyLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    bodyLockCount += 1
    return () => {
      bodyLockCount = Math.max(0, bodyLockCount - 1)
      if (bodyLockCount === 0) {
        document.body.style.overflow = previousBodyOverflow
      }
    }
  }, [locked])
}

function Portal({ children }: { children: ReactNode }) {
  const mounted = useMounted()
  if (!mounted) return null
  return createPortal(children, document.body)
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null)
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    onEscapeRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => el.offsetParent !== null || el === document.activeElement)
    const first = focusables()[0] ?? container
    window.setTimeout(() => first.focus(), 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onEscapeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [active])
  return ref
}

function withLinkedId(children: ReactNode, id: string, describedBy?: string) {
  if (!isValidElement(children)) return children
  const child = children as ReactElement<any>
  if (child.props?.id) return child
  return cloneElement(child, {
    id,
    ...(describedBy && !child.props?.['aria-describedby'] ? { 'aria-describedby': describedBy } : {}),
  })
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
  const toastIcons: Record<'success' | 'error' | 'info', ReactNode> = {
    success: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    error: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
    info: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  }
  const cfg = {
    success: { bg: 'linear-gradient(135deg,#059669 0%,#047857 100%)', shadow: 'rgba(5,150,105,0.45)',  icon: toastIcons.success, label: 'Success' },
    error:   { bg: 'linear-gradient(135deg,#DC2626 0%,#B91C1C 100%)', shadow: 'rgba(220,38,38,0.45)',   icon: toastIcons.error, label: 'Error'   },
    info:    { bg: 'linear-gradient(135deg,#0284C7 0%,#0369A1 100%)', shadow: 'rgba(2,132,199,0.45)',    icon: toastIcons.info, label: 'Info'    },
  }[toast.type]
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-4 sm:right-6 z-[9999] flex items-center gap-3.5 w-[calc(100vw-32px)] sm:w-auto overflow-hidden"
      style={{
        background: cfg.bg,
        borderRadius: 18,
        padding: '14px 22px 18px 14px',
        minWidth: 290,
        maxWidth: 440,
        boxShadow: `0 24px 56px -8px ${cfg.shadow}, 0 0 0 1px rgba(255,255,255,0.18), 0 8px 24px rgba(0,0,0,0.22)`,
        animation: 'toastIn 0.32s cubic-bezier(0.34,1.4,0.64,1) both',
      }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-xl font-black flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.22)', border: '1.5px solid rgba(255,255,255,0.32)', boxShadow: '0 2px 10px rgba(0,0,0,0.18)' }}
      >
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.62)' }}>{cfg.label}</p>
        <p className="text-[13px] font-semibold text-white leading-snug">{toast.msg}</p>
      </div>
      {/* Auto-dismiss progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[18px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
        <div style={{ height: '100%', background: 'rgba(255,255,255,0.65)', borderRadius: 'inherit', animation: 'toastProgress 4s linear both' }} />
      </div>
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
  icon,
  accent = '#1B2762',
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  width?: number
  icon?: ReactNode
  accent?: string
}) {
  useBodyScrollLock(true)
  const titleId = useId()
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose)

  return (
    <Portal>
    <div
      className="fixed inset-0 z-[9000] flex h-dvh items-center justify-center overflow-y-auto overscroll-contain p-2.5 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', animation: 'backdropIn 0.2s ease both' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="my-auto flex w-full flex-col overflow-hidden rounded-xl sm:rounded-2xl max-h-[calc(100dvh-20px)] sm:max-h-[92vh]"
        style={{
          maxWidth: width,
          background: 'var(--bg-card)',
          border: `1px solid ${accent}28`,
          boxShadow: `0 32px 72px -12px rgba(0,0,0,0.5), 0 0 0 1px ${accent}12, 0 16px 40px -8px ${accent}22`,
          animation: 'modalIn 0.22s cubic-bezier(0.34,1.4,0.64,1) both',
        } as React.CSSProperties}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-5 border-b flex-shrink-0"
          style={{
            background: `linear-gradient(135deg, ${accent}0e 0%, ${accent}1a 100%)`,
            borderBottomColor: `${accent}25`,
          }}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            {icon && (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
                style={{
                  background: `linear-gradient(135deg, ${accent}22, ${accent}3a)`,
                  color: accent,
                  border: `1px solid ${accent}38`,
                  boxShadow: `0 4px 14px ${accent}1c`,
                }}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base sm:text-sm font-black text-text-1 leading-tight">{title}</h2>
              {subtitle && (
                <p className="text-[11px] sm:text-[10px] mt-0.5 font-bold uppercase tracking-wider truncate" style={{ color: accent, opacity: 0.65 }}>
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-xl ml-3 flex-shrink-0 text-lg sm:text-base font-bold transition-[background-color,color,border-color,transform] hover:scale-110 active:scale-90"
            style={{ background: `${accent}16`, color: accent, border: `1px solid ${accent}2a` }}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {/* Body */}
        <div className="modal-content-shell flex-1 p-4 sm:p-6 overflow-y-auto flex flex-col gap-3 sm:gap-4">
          {children}
        </div>
      </div>
    </div>
    </Portal>
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
  useBodyScrollLock(true)
  const titleId = useId()
  const panelRef = useFocusTrap<HTMLDivElement>(true, onClose)
  return (
    <Portal>
    <div
      className="fixed inset-0 z-[9000] h-dvh overscroll-contain backdrop-blur-xs bg-black/40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex flex-col w-full sm:w-[min(95vw,720px)] max-w-5xl h-full overflow-hidden bg-card border-l border-border shadow-2xl"
        style={{ animation: 'slideInRight 0.28s cubic-bezier(0.25,0.46,0.45,0.94) both' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3.5 sm:py-4 border-b bg-surface border-border-lt flex-shrink-0">
          <button
            className="p-2 sm:p-1.5 text-text-3 text-xl sm:text-2xl hover:bg-muted/50 rounded-lg transition-colors"
            onClick={onClose}
            aria-label="Close panel"
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-base sm:text-sm font-semibold text-text-1">{title}</h2>
            {subtitle && <p className="text-[11px] sm:text-[10px] text-text-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
    </Portal>
  )
}

/**
 * Confirmation Dialog Component
 */
export function Confirm({
  title,
  message,
  detail,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete',
  confirmColor = 'bg-destructive',
  dismissOnBackdrop = false,
  requireText,
  requireTextHint,
  undoWindowMs,
}: {
  title?: string
  message: string
  detail?: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  confirmColor?: string
  dismissOnBackdrop?: boolean
  requireText?: string
  requireTextHint?: string
  undoWindowMs?: number
}) {
  useBodyScrollLock(true)
  const titleId = useId()
  const confirmRef = useFocusTrap<HTMLDivElement>(true, onCancel)
  const [typedText, setTypedText] = useState('')
  const [undoSecondsLeft, setUndoSecondsLeft] = useState<number | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const destructiveAction = /delete|cancel|remove|void/i.test(confirmLabel) || /destructive/.test(confirmColor)
  const expectedText = requireText ?? (destructiveAction ? 'CONFIRM' : '')
  const requiresTyping = expectedText.length > 0
  const resolvedUndoWindowMs = undoWindowMs ?? (destructiveAction ? 6000 : 0)

  const clearUndoTimers = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    if (undoIntervalRef.current) {
      clearInterval(undoIntervalRef.current)
      undoIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => clearUndoTimers()
  }, [clearUndoTimers])

  const runConfirm = useCallback(() => {
    clearUndoTimers()
    setUndoSecondsLeft(null)
    onConfirm()
  }, [clearUndoTimers, onConfirm])

  const startUndoWindow = useCallback(() => {
    if (resolvedUndoWindowMs <= 0) {
      runConfirm()
      return
    }
    const totalSeconds = Math.max(1, Math.ceil(resolvedUndoWindowMs / 1000))
    setUndoSecondsLeft(totalSeconds)
    clearUndoTimers()
    undoIntervalRef.current = setInterval(() => {
      setUndoSecondsLeft(prev => (prev && prev > 0 ? prev - 1 : 0))
    }, 1000)
    undoTimerRef.current = setTimeout(() => {
      runConfirm()
    }, resolvedUndoWindowMs)
  }, [clearUndoTimers, resolvedUndoWindowMs, runConfirm])

  const undoPendingAction = useCallback(() => {
    clearUndoTimers()
    setUndoSecondsLeft(null)
  }, [clearUndoTimers])

  const confirmDisabled = (requiresTyping && typedText.trim() !== expectedText) || undoSecondsLeft !== null

  return (
    <Portal>
    <div
      className="fixed inset-0 z-[9100] h-dvh overscroll-contain backdrop-blur-sm bg-black/45 flex items-center justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      onClick={dismissOnBackdrop ? onCancel : undefined}
    >
      <div
        ref={confirmRef}
        tabIndex={-1}
        className="w-full max-w-[380px] rounded-xl sm:rounded-2xl p-4 sm:p-6 flex flex-col gap-4 bg-card border ring-1 ring-border/50 shadow-2xl"
        style={{ animation: 'confirmIn 0.18s cubic-bezier(0.34,1.4,0.64,1) both' }}
        onClick={e => e.stopPropagation()}
      >
        {title && <p id={titleId} className="text-sm sm:text-xs font-black uppercase tracking-widest text-text-3">{title}</p>}
        <p className="text-base sm:text-sm font-semibold text-text-1">{message}</p>
        {detail && <p className="text-sm sm:text-xs text-text-3">{detail}</p>}
        {requiresTyping && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] uppercase tracking-wider font-bold text-text-4">
              Type <span className="text-text-2">{expectedText}</span> to continue
            </p>
            <input
              value={typedText}
              onChange={e => setTypedText(e.target.value)}
              placeholder={requireTextHint ?? expectedText}
              className="form-input w-full"
              aria-label={`Type ${expectedText} to confirm`}
            />
          </div>
        )}
        {undoSecondsLeft !== null && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[11px] font-semibold text-amber-900">
              Action queued. Undo available for {undoSecondsLeft}s.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button className="btn-outline h-8 px-3 text-[11px]" onClick={undoPendingAction}>
                Undo
              </button>
              <button className="btn-primary h-8 px-3 text-[11px]" onClick={runConfirm}>
                Apply now
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-2">
          <button
            className="btn-outline h-9 px-4"
            onClick={() => {
              clearUndoTimers()
              setUndoSecondsLeft(null)
              onCancel()
            }}
          >
            Cancel
          </button>
          <button
            className={`btn-primary h-9 px-6 font-semibold ${confirmColor}`}
            onClick={startUndoWindow}
            disabled={confirmDisabled}
          >
            {undoSecondsLeft !== null ? 'Queued…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </Portal>
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
  id,
}: {
  label: string
  required?: boolean
  children: ReactNode
  hint?: string
  id?: string
}) {
  const generatedId = useId()
  const fieldId = id ?? `field-${generatedId}`
  const hintId = hint ? `${fieldId}-hint` : undefined
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <label htmlFor={fieldId} className="text-[10px] uppercase tracking-wider font-bold text-text-3">
        {label}
        {required && <span className="text-destructive ml-0.5"> *</span>}
      </label>
      {withLinkedId(children, fieldId, hintId)}
      {hint && <p id={hintId} className="text-[10px] text-text-4">{hint}</p>}
    </div>
  )
}

/**
 * Standard Input Component
 */
export function Input({
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  autoFocus,
  maxLength,
  pattern,
}: {
  id?: string
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
      id={id}
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
  id,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      id={id}
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
  id,
  value,
  onChange,
  options,
  disabled,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className="relative w-full">
      <select
        id={id}
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
  tableId,
  stickyHeader = true,
  resizable = true,
  isLoading = false,
  error,
  emptyAction,
  hideColumnMenu = false,
}: {
  cols: { label: string; width?: string }[]
  children: ReactNode
  empty?: string
  minWidth?: number
  tableId?: string
  stickyHeader?: boolean
  resizable?: boolean
  isLoading?: boolean
  error?: string | null
  emptyAction?: ReactNode
  /** Hide the legacy menu when a composed DataTable toolbar owns columns. */
  hideColumnMenu?: boolean
}) {
  const MIN_PERSISTED_COL_WIDTH = 56
  const MAX_PERSISTED_COL_WIDTH = 2400

  const storageKey = tableId ? `deed_table_widths_v2_${tableId}` : null
  const visibilityKey = tableId ? `deed_table_visible_cols_v1_${tableId}` : null
  const [colWidths, setColWidths] = useState<number[]>([])
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[] | null>(null)
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)
  const colWidthsRef = useRef<number[]>([])
  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null)
  const headCellRefs = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    colWidthsRef.current = colWidths
  }, [colWidths])

  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Repair corrupted / stale persisted widths from older builds so
        // tables don't render with collapsed columns after upgrades.
        const normalized = parsed.map(value => {
          const n = Number(value)
          if (!Number.isFinite(n)) return 0
          if (n < MIN_PERSISTED_COL_WIDTH || n > MAX_PERSISTED_COL_WIDTH) return 0
          return Math.round(n)
        })
        const hasAnyValid = normalized.some(width => width > 0)
        if (hasAnyValid) {
          setColWidths(normalized)
        } else {
          localStorage.removeItem(storageKey)
        }
      }
    } catch {
      // ignore invalid persisted widths
      try { localStorage.removeItem(storageKey) } catch {}
    }
  }, [storageKey])

  useEffect(() => {
    if (!visibilityKey) return
    try {
      const raw = localStorage.getItem(visibilityKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(key => cols.some((col, index) => `${index}:${col.label}` === key))
        if (valid.length > 0) setVisibleColumnKeys(valid)
      }
    } catch {
      try { localStorage.removeItem(visibilityKey) } catch {}
    }
  }, [cols, visibilityKey])

  const persistWidths = useCallback((nextWidths: number[]) => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextWidths))
    } catch {
      // ignore storage failures
    }
  }, [storageKey])

  const columnKey = useCallback((col: { label: string }, index: number) => `${index}:${col.label}`, [])

  const grid = useMemo(() => {
    return cols
      .filter((col, index) => !visibleColumnKeys || visibleColumnKeys.includes(columnKey(col, index)))
      .map((col, index) => {
        const originalIndex = cols.indexOf(col)
        const stored = colWidths[originalIndex]
        if (Number.isFinite(stored) && stored >= MIN_PERSISTED_COL_WIDTH) return `${stored}px`
        const width = col.width ?? '1fr'
        if (/^\d+px$/.test(width)) {
          const px = Number(width.replace('px', ''))
          if (px <= 64) return width
          return `minmax(${width}, 1fr)`
        }
        return width
      })
      .join(' ')
  }, [cols, colWidths, columnKey, visibleColumnKeys])

  const visibleCols = useMemo(
    () => cols.filter((col, index) => !visibleColumnKeys || visibleColumnKeys.includes(columnKey(col, index))),
    [cols, columnKey, visibleColumnKeys],
  )

  const persistVisibleColumns = useCallback((keys: string[] | null) => {
    setVisibleColumnKeys(keys)
    if (!visibilityKey) return
    try {
      if (!keys) localStorage.removeItem(visibilityKey)
      else localStorage.setItem(visibilityKey, JSON.stringify(keys))
    } catch {}
  }, [visibilityKey])

  const toggleColumn = useCallback((key: string) => {
    const current = visibleColumnKeys ?? cols.map((col, index) => columnKey(col, index))
    const isVisible = current.includes(key)
    const next = isVisible ? current.filter(item => item !== key) : [...current, key]
    if (next.length < Math.min(2, cols.length)) return
    persistVisibleColumns(next)
  }, [cols, columnKey, persistVisibleColumns, visibleColumnKeys])

  const startResize = useCallback((index: number, event: React.MouseEvent<HTMLButtonElement>) => {
    if (!resizable) return
    event.preventDefault()
    event.stopPropagation()
    const cell = headCellRefs.current[index]
    if (!cell) return
    resizingRef.current = {
      index,
      startX: event.clientX,
      startWidth: cell.getBoundingClientRect().width,
    }

    const onMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return
      const { index: resizeIndex, startX, startWidth } = resizingRef.current
      setColWidths(prev => {
        const next = [...prev]
        next[resizeIndex] = Math.max(84, Math.round(startWidth + (moveEvent.clientX - startX)))
        return next
      })
    }

    const onUp = () => {
      if (!resizingRef.current) return
      resizingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      persistWidths(colWidthsRef.current)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [persistWidths, resizable])

  const labelledChildren = Children.map(children, child => {
    if (!isValidElement(child)) return child
    const className = String((child.props as { className?: string }).className ?? '')
    if (!className.split(/\s+/).includes('table-row')) return child

    const rowChildren = Children.toArray((child.props as { children?: ReactNode }).children)
      .filter((_, index) => !visibleColumnKeys || !cols[index] || visibleColumnKeys.includes(columnKey(cols[index], index)))
      .map((cell, visibleIndex) => {
      if (!isValidElement(cell)) return cell
      const col = visibleCols[visibleIndex]
      return cloneElement(cell as ReactElement<Record<string, unknown>>, {
        role: (cell.props as { role?: string }).role ?? 'gridcell',
        'data-label': col?.label,
        'data-mobile-extra': visibleIndex > 2 ? 'true' : undefined,
      })
    })

    return cloneElement(child as ReactElement<Record<string, unknown>>, {
      role: (child.props as { role?: string }).role ?? 'row',
      children: rowChildren,
      style: {
        ...(child.props as { style?: React.CSSProperties }).style,
        gridTemplateColumns: grid,
      },
    })
  })

  const visibleRows = Children.count(labelledChildren)
  const showEmptyState = !isLoading && !error && visibleRows === 0

  return (
    <div className="table-scroll responsive-table relative">
      {!hideColumnMenu && tableId && cols.length > 3 && (
        <div className="flex items-center justify-end gap-2 border-b border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-2">
          <button
            type="button"
            className="btn-secondary h-8 px-2 text-[13px] leading-none"
            onClick={() => setColumnMenuOpen(open => !open)}
            aria-haspopup="menu"
            aria-expanded={columnMenuOpen}
            title="Choose table columns"
          >
            ⋯
          </button>
          {columnMenuOpen && (
            <div className="absolute right-4 z-20 mt-10 w-64 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-2 shadow-xl">
              <div className="mb-2 flex items-center justify-between px-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-[var(--text-4)]">Columns</span>
                <button type="button" className="text-[10px] font-bold text-primary-600" onClick={() => persistVisibleColumns(null)}>Reset</button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {cols.map((col, index) => {
                  const key = columnKey(col, index)
                  const visible = !visibleColumnKeys || visibleColumnKeys.includes(key)
                  return (
                    <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--bg-surface)]">
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggleColumn(key)}
                      />
                      <span className="min-w-0 truncate">{col.label || `Column ${index + 1}`}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
      <div
        className="flex flex-col"
        style={{ minWidth: `max(${minWidth}px, 100%)`, width: '100%', '--table-cols': grid } as React.CSSProperties}
        role="grid"
        aria-busy={isLoading || undefined}
        aria-rowcount={visibleRows + 1}
        aria-colcount={visibleCols.length}
      >
        <div
          className={`table-head ${stickyHeader ? 'sticky top-0 z-[3]' : ''}`}
          style={{ gridTemplateColumns: grid }}
          role="row"
        >
          {visibleCols.map(c => {
            const index = cols.indexOf(c)
            return (
            <span
              key={columnKey(c, index)}
              ref={element => {
                headCellRefs.current[index] = element
              }}
              role="columnheader"
              className="relative pr-3"
            >
              {c.label}
              {resizable && (
                <button
                  type="button"
                  className="absolute right-0 top-1/2 h-5 w-2 -translate-y-1/2 cursor-col-resize rounded bg-transparent hover:bg-[var(--border)]/50"
                  onMouseDown={event => startResize(index, event)}
                  aria-label={`Resize column ${c.label}`}
                />
              )}
            </span>
          )})}
        </div>
        {isLoading ? (
          <div role="row">
            <div role="gridcell" aria-colspan={visibleCols.length} className="p-4">
              <StateSkeleton label="Loading table records" />
            </div>
          </div>
        ) : error ? (
          <div role="row">
            <div role="gridcell" aria-colspan={visibleCols.length} className="p-4">
              <StatePanel
                tone="error"
                title="Table failed to load"
                description={error}
              />
            </div>
          </div>
        ) : showEmptyState ? (
          <div role="row">
            <div role="gridcell" aria-colspan={visibleCols.length} className="p-4">
              <StatePanel
                tone="empty"
                title={empty}
                description="Try adjusting filters or create a new record."
                action={emptyAction}
              />
            </div>
          </div>
        ) : (
          labelledChildren
        )}
      </div>
    </div>
  )
}

export function RecordCard({
  eyebrow,
  title,
  subtitle,
  amount,
  status,
  meta = [],
  actions,
  onClick,
  accent = 'var(--primary)',
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  amount?: ReactNode
  status?: ReactNode
  meta?: Array<{ label: string; value: ReactNode }>
  actions?: ReactNode
  onClick?: () => void
  accent?: string
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      } : undefined}
      className={`record-card w-full rounded-xl sm:rounded-2xl border bg-card p-2.5 sm:p-3.5 text-left shadow-card transition-[background-color,border-color,box-shadow,transform] ${onClick ? 'cursor-pointer hover:shadow-lg active:scale-[0.99]' : ''}`}
      style={{ borderColor: 'var(--border-lt)', borderLeft: `4px solid ${accent}` }}
    >
      <div className="flex items-start justify-between gap-2.5 sm:gap-3">
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="text-[10px] sm:text-[10px] font-black uppercase tracking-wider text-primary-600 mb-0.5">{eyebrow}</div>}
          <div className="text-[15px] sm:text-sm font-black text-text-1 truncate">{title}</div>
          {subtitle && <div className="text-[11px] sm:text-[11px] text-text-3 mt-0.5 truncate">{subtitle}</div>}
        </div>
        <div className="flex-shrink-0 text-right">
          {amount && <div className="font-mono text-[13px] sm:text-xs font-black text-text-1">{amount}</div>}
          {status && <div className="mt-0.5 sm:mt-1 flex justify-end">{status}</div>}
        </div>
      </div>
      {meta.length > 0 && (
        <div className="record-card-meta mt-2 sm:mt-3 grid grid-cols-2 gap-1.5 sm:gap-2">
          {meta.map(item => (
            <div key={item.label} className="rounded-lg sm:rounded-xl border border-border-lt bg-surface/45 px-2 py-1.5 sm:px-2.5 sm:py-2">
              <div className="text-[9px] sm:text-[9px] font-black uppercase tracking-wider text-text-4">{item.label}</div>
              <div className="mt-0.5 text-[11px] sm:text-[11px] font-bold text-text-2 truncate">{item.value}</div>
            </div>
          ))}
        </div>
      )}
      {actions && <div className="record-card-actions mt-2.5 sm:mt-3 flex flex-wrap gap-2 border-t border-border-lt pt-2.5 sm:pt-3">{actions}</div>}
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
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5 border-b border-border-lt flex-shrink-0 bg-surface">
      <div className="flex items-center gap-2">
        <span className="text-xs sm:text-sm font-bold text-text-1">{title}</span>
        {count !== undefined && <span className="badge badge-gray">{count}</span>}
      </div>
      {children && (
        <div className="section-actions flex flex-wrap items-center gap-2 sm:ml-auto">
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
  compact = false,
}: {
  label: string
  value: string | number
  sub?: string
  color: string
  icon?: ReactNode
  onClick?: () => void
  compact?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`
        stat-card card p-3 sm:p-5 min-h-[92px] sm:min-h-[96px] flex flex-col justify-between gap-1.5 transition-[background-color,border-color,box-shadow,transform] duration-200
        ${compact ? 'stat-card--compact' : ''}
        ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5' : ''}
      `}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider text-text-3">
          {label}
        </span>
        {icon && <span className="text-base sm:text-sm" style={{ color }}>{icon}</span>}
      </div>
      <div className="text-xl sm:text-xl font-extrabold text-text-1 leading-tight">{value}</div>
      {sub && <div className="text-[11px] sm:text-[10px] text-text-4">{sub}</div>}
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
  const inputId = useId()

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
      <label htmlFor={inputId} className="text-[10px] uppercase tracking-wider font-bold text-text-3">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          className="form-input w-full pr-10"
          placeholder={placeholder}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
        <svg
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
          width="13" height="13" viewBox="0 0 24 24" fill="none"
          style={{ color: 'var(--text-4)' }}
        >
          <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
          <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      {open && (filtered.length > 0 || (onCreateNew && query.length > 0)) && (
        <div
          className="absolute top-full left-0 right-0 mt-1 z-[9300] bg-card border border-border rounded-xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-border-lt"
          style={{ animation: 'dropdownIn 0.18s ease both' }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
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
export function StatusStepper({ steps, current, labels }: { steps: string[]; current: string; labels?: Record<string, string> }) {
  const currentIndex = Math.max(0, steps.indexOf(current))
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
            {labels?.[step] ?? step.replace(/_/g, ' ')}
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
    <div className="mod-page animate-pulse">
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

type StateTone = 'empty' | 'loading' | 'success' | 'error'

const stateToneConfig: Record<StateTone, { icon: string; cls: string; title: string }> = {
  empty: { icon: '○', cls: 'state-panel-empty', title: 'No data yet' },
  loading: { icon: '↻', cls: 'state-panel-loading', title: 'Loading…' },
  success: { icon: '✓', cls: 'state-panel-success', title: 'Success' },
  error: { icon: '!', cls: 'state-panel-error', title: 'Something went wrong' },
}

/**
 * Standardized state panel (empty/loading/success/error) for all modules.
 */
export function StatePanel({
  tone,
  title,
  description,
  action,
}: {
  tone: StateTone
  title?: string
  description?: ReactNode
  action?: ReactNode
}) {
  const cfg = stateToneConfig[tone]
  const isError = tone === 'error'
  const isLoading = tone === 'loading'
  return (
    <div
      className={`state-panel ${cfg.cls}`}
      role={isError ? 'alert' : isLoading ? 'status' : undefined}
      aria-live={isError ? 'assertive' : isLoading ? 'polite' : undefined}
      aria-busy={isLoading || undefined}
    >
      <div className="state-panel-icon" aria-hidden="true">{cfg.icon}</div>
      <div className="state-panel-title">{title ?? cfg.title}</div>
      {description ? <div className="state-panel-desc">{description}</div> : null}
      {action ? <div className="mt-2 section-actions">{action}</div> : null}
    </div>
  )
}

export function StateSkeleton({ label = 'Loading content' }: { label?: string }) {
  return (
    <div
      className="state-panel state-panel-loading animate-pulse"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="state-panel-icon" aria-hidden="true">↻</div>
      <div className="h-4 w-36 rounded bg-muted" />
      <div className="h-3 w-56 rounded bg-muted" />
      <div className="h-3 w-44 rounded bg-muted" />
    </div>
  )
}

/**
 * Table Skeleton Loader
 */
export function TableSkeleton({
  rows = 8,
  columns = 6,
  minWidth = 720,
}: {
  rows?: number
  columns?: number
  minWidth?: number
}) {
  return (
    <div className="overflow-x-auto w-full animate-pulse">
      <div className="flex flex-col" style={{ minWidth }}>
        <div className="table-head" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, i) => (
            <span key={i} className="h-3 rounded bg-muted" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} className="table-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }).map((_, col) => (
              <span
                key={col}
                className="h-3 rounded bg-muted"
                style={{ width: `${col === 0 ? 55 : 72 + ((row + col) % 3) * 10}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Public portal/auth skeleton for non-AppShell pages.
 */
export function PortalPageSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-[#06070d] via-[#0e1220] to-[#0A0C14] animate-pulse">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
        <div className="mx-auto mb-6 h-14 w-14 rounded-2xl bg-white/10" />
        <div className="mx-auto mb-3 h-4 w-44 rounded-full bg-white/10" />
        <div className="mx-auto mb-8 h-3 w-64 max-w-full rounded-full bg-white/10" />
        <div className="space-y-3">
          <div className="h-11 rounded-xl bg-white/10" />
          <div className="h-11 rounded-xl bg-white/10" />
          <div className="h-11 rounded-xl bg-cyan-400/20" />
        </div>
        <p className="mt-6 text-center text-xs font-semibold text-white/40">{label}</p>
      </div>
    </div>
  )
}

/**
 * Tab Content Wrapper
 */
export function TabContent({
  active,
  children,
  id,
  labelledBy,
}: {
  active: boolean
  children: ReactNode
  id?: string
  labelledBy?: string
}) {
  if (!active) return null
  return (
    <div id={id} role="tabpanel" aria-labelledby={labelledBy} style={{ animation: 'fadeIn 0.25s ease both' }}>
      {children}
    </div>
  )
}

/**
 * Tab Bar Component
 */
export function TabBar({
  tabs,
  active,
  onChange,
  className = '',
  maxVisibleMobile = 4,
  maxVisibleTablet = 6,
  maxVisibleDesktop = 6,
  showIcons = false,
  ariaLabel = 'Sections',
}: {
  tabs: { id: string; label: string; icon?: ReactNode; panelId?: string }[]
  active: string
  onChange: (id: string) => void
  className?: string
  maxVisibleMobile?: number
  maxVisibleTablet?: number
  maxVisibleDesktop?: number
  /** Per-tab icons are opt-in to keep shared navigation compact. */
  showIcons?: boolean
  ariaLabel?: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState<number>(0)
  // The dropdown is rendered through a portal with fixed positioning so it can
  // never be clipped by the tab bar's overflow-x scrolling or by ancestor
  // `overflow-hidden` cards — previously the menu vanished behind content.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const overflowRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const pendingFocusRef = useRef<string | null>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const baseId = useId()
  const menuId = `${baseId}-more`

  useEffect(() => {
    const syncWidth = () => setViewportWidth(window.innerWidth)
    syncWidth()
    window.addEventListener('resize', syncWidth)
    return () => window.removeEventListener('resize', syncWidth)
  }, [])

  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null)
      return
    }
    const updatePosition = () => {
      const rect = moreButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenuPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (overflowRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      moreButtonRef.current?.focus()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  useEffect(() => {
    setMenuOpen(false)
  }, [active])

  const viewportMode = useMemo<'mobile' | 'tablet' | 'desktop'>(() => {
    if (viewportWidth === 0) return 'desktop'
    if (viewportWidth < 640) return 'mobile'
    if (viewportWidth < 1024) return 'tablet'
    return 'desktop'
  }, [viewportWidth])

  const { visibleTabs, overflowTabs } = useMemo(() => {
    const configuredMax = viewportMode === 'mobile'
      ? maxVisibleMobile
      : viewportMode === 'tablet'
        ? maxVisibleTablet
        : maxVisibleDesktop
    const maxVisible = Math.max(1, Math.floor(configuredMax))
    if (tabs.length <= maxVisible) return { visibleTabs: tabs, overflowTabs: [] as typeof tabs }

    const activeTab = tabs.find(t => t.id === active)
    const primarySlots = maxVisible
    let base = tabs.slice(0, primarySlots)
    if (activeTab && !base.some(t => t.id === activeTab.id)) {
      if (primarySlots === 1) {
        base = [activeTab]
      } else {
        base = [...base.slice(0, primarySlots - 1), activeTab]
      }
    }
    const seen = new Set<string>()
    const normalizedBase = base.filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
    const hidden = tabs.filter(t => !normalizedBase.some(v => v.id === t.id))
    return { visibleTabs: normalizedBase, overflowTabs: hidden }
  }, [active, maxVisibleDesktop, maxVisibleMobile, maxVisibleTablet, tabs, viewportMode])

  useEffect(() => {
    const id = pendingFocusRef.current
    if (!id) return
    pendingFocusRef.current = null
    tabRefs.current.get(id)?.focus()
  }, [visibleTabs])

  const activateFromKeyboard = useCallback((currentId: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.findIndex(tab => tab.id === currentId)
    if (currentIndex < 0) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = tabs[nextIndex]
    pendingFocusRef.current = next.id
    onChange(next.id)
  }, [onChange, tabs])

  const tabBarClassName = [
    'mod-tabs',
    viewportMode === 'mobile' ? 'mod-tabs-adaptive' : '',
    viewportMode === 'tablet' ? 'mod-tabs-tablet-grid' : '',
    viewportMode === 'desktop' ? 'mod-tabs-desktop-full' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={tabBarClassName}>
      <div role="tablist" aria-label={ariaLabel} className="mod-tablist">
        {visibleTabs.map((t, index) => (
          <button
            key={t.id}
            id={`${baseId}-tab-${t.id}`}
            ref={element => {
              if (element) tabRefs.current.set(t.id, element)
              else tabRefs.current.delete(t.id)
            }}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            aria-controls={t.panelId}
            tabIndex={active === t.id || (!tabs.some(tab => tab.id === active) && index === 0) ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={event => activateFromKeyboard(t.id, event)}
            className={`mod-tab ${active === t.id ? 'active' : ''}`}
          >
            {showIcons && t.icon && <span className="text-[12px]" aria-hidden="true">{t.icon}</span>}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {overflowTabs.length > 0 && (
        <div className="relative ml-auto" ref={overflowRef}>
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => setMenuOpen(prev => !prev)}
            className="mod-tab"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label="More tabs"
          >
            <span>More</span>
            <span className={`ml-1 text-[10px] transition-transform ${menuOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {menuOpen && menuPos && typeof document !== 'undefined' && createPortal(
            <div
              id={menuId}
              ref={menuRef}
              className="tab-overflow-menu"
              style={{ top: menuPos.top, right: menuPos.right }}
              role="menu"
              aria-label="More tabs"
            >
              {overflowTabs.map(t => (
                <button
                  key={t.id}
                  className={`tab-overflow-item ${active === t.id ? 'active' : ''}`}
                  onClick={() => {
                    onChange(t.id)
                    setMenuOpen(false)
                  }}
                  role="menuitem"
                >
                  {showIcons && t.icon && <span className="text-[12px]" aria-hidden="true">{t.icon}</span>}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )}
        </div>
      )}
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
  primaryAction,
  overflowActions,
  headingLevel = 1,
  subtitleMode = 'compact',
  color = '#1B2762',
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  count?: number
  /** @deprecated Prefer primaryAction and overflowActions for clear hierarchy. */
  actions?: ReactNode
  primaryAction?: ReactNode
  overflowActions?: ReactNode
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  /** Compact hides supporting copy on phones; hidden omits it entirely. */
  subtitleMode?: 'compact' | 'visible' | 'hidden'
  color?: string
}) {
  const HeadingTag = `h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  const hasActions = Boolean(primaryAction || overflowActions || actions)
  return (
    <header className="mod-header">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {icon && (
          <div
            className="mod-header-icon w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ color }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <HeadingTag className="text-sm font-extrabold text-text-1 truncate">{title}</HeadingTag>
            {count !== undefined && (
              <span className="badge badge-gray text-[9px]">{count.toLocaleString()}</span>
            )}
          </div>
          {subtitle && subtitleMode !== 'hidden' && (
            <p className={`mod-header-subtitle text-[10px] text-text-3 mt-0.5 truncate ${subtitleMode === 'compact' ? 'hidden sm:block' : ''}`}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {hasActions && (
        <div className="section-actions flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {primaryAction}
          {overflowActions}
          {actions}
        </div>
      )}
    </header>
  )
}

/**
 * Pagination — numbered with mobile-simplified mode, first/last jumps on desktop
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

  const getPages = (): (number | '…')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (page <= 4)           return [1, 2, 3, 4, 5, '…', totalPages]
    if (page >= totalPages - 3) return [1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [1, '…', page - 1, page, page + 1, '…', totalPages]
  }

  return (
    <div className="pagination">
      {/* Info — hidden on smallest mobile */}
      <span className="text-[10px] font-semibold text-text-3 hidden xs:block whitespace-nowrap">
        {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
      </span>

      {/* Mobile: prev / page indicator / next */}
      <div className="flex items-center gap-1.5 sm:hidden w-full justify-between">
        <button
          className="page-btn flex-shrink-0"
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
        >‹ Prev</button>
        <span className="text-[11px] font-bold text-text-2 whitespace-nowrap">
          {page} / {totalPages}
        </span>
        <button
          className="page-btn flex-shrink-0"
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
        >Next ›</button>
      </div>

      {/* Desktop: first / ‹ / numbered / › / last */}
      <div className="hidden sm:flex items-center gap-1">
        {totalPages > 5 && (
          <button className="page-btn" onClick={() => onChange(1)} disabled={page === 1} aria-label="First page">«</button>
        )}
        <button className="page-btn" onClick={() => onChange(page - 1)} disabled={page === 1} aria-label="Previous page">‹</button>
        {getPages().map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="text-text-4 text-xs w-7 text-center select-none">…</span>
          ) : (
            <button
              key={p}
              className={`page-btn ${page === p ? 'active' : ''}`}
              onClick={() => onChange(p as number)}
              aria-label={`Page ${p}`}
              aria-current={page === p ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}
        <button className="page-btn" onClick={() => onChange(page + 1)} disabled={page === totalPages} aria-label="Next page">›</button>
        {totalPages > 5 && (
          <button className="page-btn" onClick={() => onChange(totalPages)} disabled={page === totalPages} aria-label="Last page">»</button>
        )}
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
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold
        uppercase tracking-wider whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150
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
  ariaLabel,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Accessible name; generated from placeholder when omitted. */
  ariaLabel?: string
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
        width="13" height="13" viewBox="0 0 24 24" fill="none"
        style={{ color: 'var(--text-4)' }}
      >
        <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
        <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        className="form-input pl-8 w-full"
        type="search"
        aria-label={ariaLabel ?? placeholder ?? 'Search'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

export function useEscapeKey(onClose: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, enabled])
}
