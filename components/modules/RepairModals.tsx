'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRepairStore, RepairOrder, fmtKes, type RepairQAItem } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { assignableTechnicians } from '@/lib/repair/assignable-technicians'
import { DIRECT_REPAIR_WAIVER_TEXT } from '@/lib/repair-path'
import { isRepairNoCharge } from '@/lib/repair-billing-exempt'
import { shouldDefaultCloseAfterHandover } from '@/lib/repair-handover'
import { buildRepairInvoiceCharges, repairBillingNeedsSync } from '@/lib/repair-invoice'
import { findSaleOrderForRepair, findSalesQuoteForRepair } from '@/lib/repair/sale-order-link'
import {
  DIAGNOSIS_FEE_LINE_DESCRIPTION,
  isDiagnosisFeeLine,
  resolveDiagnosisFee,
  shouldChargeDiagnosisFee,
} from '@/lib/diagnosis-fee'
import { Modal, Field, Input, Select, Textarea } from '@/components/ui'
import { Fa } from '@/components/icons'
import {
  faUserGear,
  faStethoscope,
  faFileInvoiceDollar,
  faCheckCircle,
  faTruck,
  faTools,
  faExclamationTriangle,
  faPlay,
  faHistory,
  faCartPlus,
  faUndo,
  faTimesCircle,
  faBan,
  faTrash,
  faSearch,
  faBoxOpen,
  faExclamationCircle,
  faCheckSquare,
  faShieldAlt,
  faUser,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'

// Reusable styled action button for modal footers
function ActionBtn({ onClick, color, shadow, children, disabled }: {
  onClick: () => void
  color: string
  shadow: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-black text-xs text-white uppercase tracking-widest transition-all hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
      style={{ background: color, boxShadow: shadow, minWidth: 140 }}
    >
      {children}
    </button>
  )
}

/**
 * AssignTechnicianModal
 */
export function AssignTechnicianModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { users, currentUserId, assignTechnicianToRepair } = useRepairStore()
  const employees = useHrStore(s => s.employees)
  const technicians = assignableTechnicians(users, employees)
  const isReassign = !!repair.assignedTechnicianName

  return (
    <Modal variant="enterprise"
      title={isReassign ? 'Reassign Technician' : 'Assign Technician'}
      subtitle={`Job Reference: ${repair.ref}`}
      onClose={onClose}
      width={440}
      icon={<Fa icon={faUserGear} />}
      accent="#3B82F6"
    >
      <div className="flex flex-col gap-4">
        {isReassign && (
          <div className="flex items-start gap-3 p-3.5 rounded-xl border"
            style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)', color: 'var(--warning-text)' }}>
            <Fa icon={faExclamationTriangle} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' } as any} />
            <p className="text-[11px] leading-relaxed font-medium">
              Currently assigned to <span className="font-black">{repair.assignedTechnicianName}</span>.
              Changing this will transfer all technical responsibility for this job.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
          {technicians.length === 0 && (
            <p className="text-[11px] text-[var(--text-3)] font-medium p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-muted)]">
              No active technicians available. Exited employees and deactivated users are hidden.
            </p>
          )}
          {[...technicians]
            .sort((a, b) => a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0)
            .map(tech => {
              const isMe = tech.id === currentUserId
              const isCurrent = tech.id === repair.assignedTechnicianId
              return (
                <button
                  key={tech.id}
                  onClick={() => { assignTechnicianToRepair(repair.id, tech.id); onClose() }}
                  className="flex items-center gap-4 p-3.5 rounded-2xl border transition-all text-left group active:scale-[0.98]"
                  style={{
                    background: isCurrent ? 'rgba(59,130,246,0.07)' : 'var(--bg-card)',
                    borderColor: isCurrent ? 'rgba(59,130,246,0.35)' : 'var(--border)',
                    boxShadow: isCurrent ? '0 0 0 3px rgba(59,130,246,0.1)' : 'none',
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm transition-transform group-hover:scale-110"
                    style={{ background: isMe ? 'linear-gradient(135deg,var(--success),var(--success))' : 'linear-gradient(135deg,var(--text-3),#334155)' }}
                  >
                    {tech.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-[var(--text-1)] text-xs">{tech.name}{isMe ? ' (You)' : ''}</p>
                    <p className="text-[10px] text-[var(--text-3)] font-medium capitalize mt-0.5">{tech.role.replace('_', ' ')}</p>
                  </div>
                  {isCurrent && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider"
                      style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--primary)', border: '1px solid rgba(59,130,246,0.25)' }}>
                      Current
                    </span>
                  )}
                </button>
              )
            })}
        </div>
      </div>
    </Modal>
  )
}

/**
 * LogDiagnosisModal
 */
export function LogDiagnosisModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { logDiagnosis, showToast } = useRepairStore()
  const existingDiagnosis = repair.diagnosis
  const isRevision = !!existingDiagnosis
  const revisionCount = repair.diagnosisHistory?.length ?? (existingDiagnosis ? 1 : 0)
  const [diagForm, setDiagForm] = useState({
    findings: existingDiagnosis?.findings ?? '',
    faultDescription: existingDiagnosis?.faultDescription ?? '',
    recommendedAction: existingDiagnosis?.recommendedAction ?? '',
    estimatedHours: String(existingDiagnosis?.estimatedHours ?? '2'),
    revisionType: 'update' as 'update' | 'correction',
    revisionReason: '',
    clientCausedDamage: false, clientDamageReason: '',
  })
  const [warrantyCoverage, setWarrantyCoverage] = useState<'full' | 'partial' | 'void'>(
    repair.warrantyCoverage ?? 'full'
  )

  const handleLogDiagnosis = () => {
    if (!diagForm.findings || !diagForm.faultDescription) {
      showToast('Findings and fault description are required', 'error'); return
    }
    if (isRevision && !diagForm.revisionReason.trim()) {
      showToast('Please explain why this diagnosis is being updated', 'error'); return
    }
    if (diagForm.clientCausedDamage && !diagForm.clientDamageReason) {
      showToast('Please select the type of client-caused damage', 'error'); return
    }
    logDiagnosis(repair.id, {
      findings: diagForm.findings, faultDescription: diagForm.faultDescription,
      recommendedAction: diagForm.recommendedAction,
      estimatedHours: Number(diagForm.estimatedHours) || 0,
      revisionType: isRevision ? diagForm.revisionType : 'initial',
      revisionReason: isRevision ? diagForm.revisionReason.trim() : undefined,
    } as any, diagForm.clientCausedDamage
      ? {
          clientCausedDamage: true,
          clientDamageReason: diagForm.clientDamageReason || undefined,
          underWarranty: false,
          warrantyCoverage: 'void',
          warrantyVerificationStatus: 'excluded_client_damage',
        }
      : repair.underWarranty
        ? { warrantyCoverage }
        : undefined)
    onClose()
  }

  return (
    <Modal variant="enterprise" title={isRevision ? 'Add Diagnosis Update' : 'Log Diagnosis'} subtitle={isRevision ? `${repair.ref} · Revision ${revisionCount + 1}` : repair.ref} onClose={onClose} width={560} icon={<Fa icon={faStethoscope} />} accent="#06B6D4">
      <div className="flex flex-col gap-5">
        {isRevision && existingDiagnosis && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Fa icon={faHistory} className="text-blue-600 text-xs" />
              <p className="text-[10px] font-black text-blue-700 uppercase tracking-wider">Current diagnosis will be preserved</p>
            </div>
            <p className="text-[11px] text-blue-900 font-semibold leading-relaxed">{existingDiagnosis.faultDescription}</p>
            <p className="text-[10px] text-blue-700 leading-relaxed">The update below becomes the latest diagnosis. The earlier diagnosis remains visible in diagnosis history for audit and customer transparency.</p>
          </div>
        )}
        {isRevision && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Update Type" required>
              <select className="form-input text-xs font-medium" value={diagForm.revisionType} onChange={e => setDiagForm(p => ({ ...p, revisionType: e.target.value as 'update' | 'correction' }))}>
                <option value="update">Additional findings / update</option>
                <option value="correction">Correction to previous diagnosis</option>
              </select>
            </Field>
            <Field label="Reason for Update" required>
              <Input value={diagForm.revisionReason} onChange={v => setDiagForm(p => ({ ...p, revisionReason: v }))} placeholder="e.g. extra fault found after teardown" />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4">
          <Field label="Technical Findings" required hint="What was discovered during physical inspection?">
            <Textarea value={diagForm.findings} onChange={v => setDiagForm(p => ({ ...p, findings: v }))} placeholder="e.g. Blown capacitor on power board, liquid damage on trackpad connector..." rows={3} />
          </Field>
          <Field label="Fault Description" required hint="The core issue needing repair">
            <Input value={diagForm.faultDescription} onChange={v => setDiagForm(p => ({ ...p, faultDescription: v }))} placeholder="e.g. Mainboard Power Failure" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Recommended Action">
              <Input value={diagForm.recommendedAction} onChange={v => setDiagForm(p => ({ ...p, recommendedAction: v }))} placeholder="e.g. Component level repair" />
            </Field>
            <Field label="Est. Labour Hours">
              <Input value={diagForm.estimatedHours} onChange={v => setDiagForm(p => ({ ...p, estimatedHours: v }))} type="number" />
            </Field>
          </div>
        </div>

        {/* Warranty coverage selector — only shown for warranty jobs where client didn't cause damage */}
        {repair.underWarranty && !diagForm.clientCausedDamage && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-3" style={{ animation: 'fadeIn 0.18s ease both' }}>
            <div className="flex items-center gap-2">
              <Fa icon={faShieldAlt} className="text-blue-500 text-sm" />
              <p className="text-xs font-black text-blue-700 uppercase tracking-wider">Warranty Coverage</p>
            </div>
            <p className="text-[10px] text-[var(--text-3)] leading-relaxed">
              Select how this warranty claim is covered. This affects whether the client needs to approve a quote.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([
                { value: 'full',    label: 'Full Cover',    desc: 'Company pays — no charge to client',         color: 'emerald' },
                { value: 'partial', label: 'Partial Cover', desc: 'Client pays for uncovered items only',        color: 'amber'   },
                { value: 'void',    label: 'Voided',        desc: 'Not covered — client pays full amount',       color: 'red'     },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setWarrantyCoverage(opt.value)}
                  className={`flex flex-col gap-1 p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                    warrantyCoverage === opt.value
                      ? opt.color === 'emerald' ? 'border-emerald-400 bg-emerald-50'
                        : opt.color === 'amber' ? 'border-amber-400 bg-amber-50'
                        : 'border-red-400 bg-red-50'
                      : 'border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-lt)]'
                  }`}
                >
                  <span className={`text-[10px] font-black uppercase tracking-wider ${
                    warrantyCoverage === opt.value
                      ? opt.color === 'emerald' ? 'text-emerald-700'
                        : opt.color === 'amber' ? 'text-amber-700'
                        : 'text-red-700'
                      : 'text-[var(--text-2)]'
                  }`}>{opt.label}</span>
                  <span className="text-[9px] text-[var(--text-3)] leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
            {warrantyCoverage === 'full' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-100 border border-emerald-200">
                <Fa icon={faCheckSquare} className="text-emerald-600 text-xs" />
                <p className="text-[10px] font-bold text-emerald-700">Quote will be auto-approved — no client sign-off needed</p>
              </div>
            )}
          </div>
        )}

        <div className={`rounded-2xl overflow-hidden border transition-all ${diagForm.clientCausedDamage ? 'border-amber-300 bg-amber-50/50' : 'border-[var(--border)] bg-[var(--bg-surface)]'}`}>
          <div className="p-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="mt-1">
                <input type="checkbox" className="w-4 h-4 rounded border-[var(--border)] text-amber-600 focus:ring-amber-500 transition-all"
                  checked={diagForm.clientCausedDamage}
                  onChange={e => setDiagForm(p => ({ ...p, clientCausedDamage: e.target.checked, clientDamageReason: '' }))} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold text-[var(--text-1)] group-hover:text-amber-700 transition-colors">Client-caused damage detected</p>
                <p className="text-[10px] text-[var(--text-3)] mt-0.5 leading-relaxed">
                  {repair.underWarranty
                    ? 'Device is under warranty — checking this will void it and charge the client.'
                    : 'Damage caused by customer misuse (e.g. liquid spill, drop). Client will be charged.'}
                </p>
              </div>
            </label>
          </div>
          {diagForm.clientCausedDamage && (
            <div className="px-4 pb-4" style={{ animation: 'fadeIn 0.18s ease both' }}>
              <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-amber-200 shadow-sm space-y-3">
                <Field label="Damage Category">
                  <select className="form-input text-xs font-medium" value={diagForm.clientDamageReason}
                    onChange={e => setDiagForm(p => ({ ...p, clientDamageReason: e.target.value }))}>
                    <option value="">— Select damage type —</option>
                    <option value="Water/liquid spillage">Water / liquid spillage</option>
                    <option value="Physical drop/impact damage">Physical drop / impact damage</option>
                    <option value="Unauthorized repair attempt">Unauthorized repair attempt</option>
                    <option value="Fire/heat/power surge damage">Fire / heat / power surge</option>
                    <option value="Intentional damage">Intentional damage</option>
                    <option value="Pest/rodent damage">Pest / rodent damage</option>
                    <option value="Other client-caused damage">Other client-caused damage</option>
                  </select>
                </Field>
                {repair.underWarranty && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 text-red-700 border border-red-100">
                    <Fa icon={faExclamationTriangle} className="text-xs" />
                    <p className="text-[10px] font-black uppercase tracking-tight">Warranty will be voided</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-2 pt-4 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleLogDiagnosis} color="linear-gradient(135deg,#0891B2,#06B6D4)" shadow="0 8px 24px rgba(6,182,212,0.4)">
            <Fa icon={faStethoscope} /> {isRevision ? 'Save Diagnosis Update' : 'Save Diagnosis'}
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

// Line types that MUST be linked to an inventory product — free-text not allowed
const INVENTORY_REQUIRED_TYPES = ['part', 'license'] as const
type InventoryRequiredType = typeof INVENTORY_REQUIRED_TYPES[number]

/**
 * Inline product picker used inside QuoteModal lines.
 * When `requireInventory` is true the field shows a red border and helper
 * text if the user has typed something but hasn't selected from the list.
 */
function ProductPicker({ value, productId, onSelect, products, requireInventory, submitted }: {
  value: string
  productId?: string
  onSelect: (p: { id: string; name: string; salePrice: number; stockQty: number } | null, custom: string) => void
  products: { id: string; name: string; sku: string; salePrice: number; stockQty: number; isActive: boolean }[]
  requireInventory?: boolean
  submitted?: boolean
}) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Opening the field with no query yet browses the catalogue (sorted,
  // capped) instead of showing nothing — the whole point of picking FROM
  // inventory is being able to see what's there without knowing a name first.
  const matches = query.length > 0
    ? products.filter(p => p.isActive && (p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()))).slice(0, 8)
    : [...products].filter(p => p.isActive).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8)

  useEffect(() => { setQuery(value) }, [value])

  // The quote-lines table this picker lives in clips overflowing content
  // (rounded-2xl ... overflow-hidden), so a plain position:absolute dropdown
  // gets cut off / hidden behind later rows. Computing viewport coordinates
  // from the input's getBoundingClientRect() and rendering position:fixed
  // escapes that — BUT this picker also lives inside <Modal variant="enterprise">, whose box has
  // `animation: modalIn ... both`. The `both` fill-mode keeps the keyframe's
  // `transform: translateY(0) scale(1)` applied forever after the animation
  // ends (never reverts to `transform: none`), and any non-none transform on
  // an ancestor makes IT the containing block for fixed descendants instead
  // of the viewport — silently breaking these getBoundingClientRect()-based
  // coordinates (the dropdown renders, just at the wrong place, off-screen).
  // Portalling the dropdown to document.body sidesteps that entirely: it is
  // no longer a descendant of the transformed modal box.
  const openDropdown = () => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) { setOpen(true); return }
    const openUp = rect.bottom + 280 > window.innerHeight && rect.top > 300
    setDropdownPos({
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      openUp,
    })
    setOpen(true)
  }

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!open) return
    // A fixed-position dropdown doesn't track scroll/resize on its own —
    // close it instead of letting it drift away from the input.
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const isError = requireInventory && submitted && !productId

  return (
    <div ref={ref} className="relative w-full">
      <div className="relative">
        <Fa icon={faSearch} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-4)] text-[9px] pointer-events-none" />
        <input
          ref={inputRef}
          className="form-input bg-[var(--bg-card)] pl-7 pr-6"
          placeholder={requireInventory ? 'Search & select from inventory…' : 'Search inventory or type…'}
          value={query}
          onChange={e => { setQuery(e.target.value); onSelect(null, e.target.value); openDropdown() }}
          onFocus={openDropdown}
          style={isError ? { borderColor: '#EF4444', background: 'rgba(239,68,68,0.04)' } : undefined}
        />
        {productId ? (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-500" title="Linked to inventory" />
        ) : isError ? (
          <Fa icon={faExclamationCircle} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-red-500 pointer-events-none" />
        ) : null}
      </div>
      {isError && (
        <p className="text-[9px] font-bold text-red-500 mt-0.5 ml-1">Must be selected from inventory</p>
      )}
      {open && dropdownPos && matches.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9700] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl overflow-hidden"
          style={{
            left: dropdownPos.left,
            width: dropdownPos.width,
            ...(dropdownPos.openUp ? { bottom: window.innerHeight - dropdownPos.top } : { top: dropdownPos.top }),
          }}
        >
          {query.length === 0 && (
            <p className="px-3 py-1.5 text-[9px] font-bold text-[var(--text-4)] uppercase tracking-wide bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
              Browse inventory — type to narrow
            </p>
          )}
          {matches.map(p => (
            <button
              key={p.id}
              type="button"
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--bg-surface)] transition-colors text-left"
              onMouseDown={e => { e.preventDefault(); setQuery(p.name); onSelect(p, p.name); setOpen(false) }}
            >
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-[var(--text-1)] truncate">{p.name}</p>
                <p className="text-[9px] text-[var(--text-4)] font-medium">SKU: {p.sku} · KES {p.salePrice.toLocaleString()}</p>
              </div>
              <span
                className="shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider"
                style={p.stockQty > 0
                  ? { background: 'rgba(16,185,129,0.12)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)' }
                  : { background: 'rgba(239,68,68,0.1)', color: '#DC2626', border: '1px solid rgba(239,68,68,0.25)' }
                }
              >
                {p.stockQty > 0 ? `${p.stockQty} in stock` : 'Out of stock'}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
      {open && dropdownPos && query.length > 1 && matches.length === 0 && requireInventory && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9700] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl px-3 py-3 text-center"
          style={{
            left: dropdownPos.left,
            width: dropdownPos.width,
            ...(dropdownPos.openUp ? { bottom: window.innerHeight - dropdownPos.top } : { top: dropdownPos.top }),
          }}
        >
          <p className="text-[10px] font-bold text-[var(--text-3)]">No inventory match for "{query}"</p>
          <p className="text-[9px] text-[var(--text-4)] mt-0.5">Add the product to inventory first, then quote it here.</p>
        </div>,
        document.body,
      )}
    </div>
  )
}

/**
 * QuoteModal
 */
export function QuoteModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { generateRepairQuote, companySettings, products, systemSettings, showToast } = useRepairStore()
  const [applyVat, setApplyVat] = useState(repair.quote ? repair.quote.tax > 0 : false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const feeResolved = resolveDiagnosisFee(repair, systemSettings)
  const chargeFee = shouldChargeDiagnosisFee(repair) && feeResolved.amount > 0
  const [quoteLines, setQuoteLines] = useState<{
    type: 'part'|'labor'|'software'|'license'|'logistics'|'service'
    description: string
    qty: string
    unitPrice: string
    productId?: string
    stockQty?: number
    isDiagnosisFee?: boolean
  }[]>(() => {
    const seed = repair.quote
      ? repair.quote.lines.map(l => ({
          type: l.type as any,
          description: l.description,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
          productId: l.productId,
          isDiagnosisFee: !!l.isDiagnosisFee || isDiagnosisFeeLine(l),
        }))
      : [{ type: 'labor' as const, description: 'Labour & Service Charge', qty: '1', unitPrice: '5000' }]
    if (!chargeFee) return seed.filter(l => !isDiagnosisFeeLine(l))
    const without = seed.filter(l => !isDiagnosisFeeLine(l))
    return [
      {
        type: 'service' as const,
        description: DIAGNOSIS_FEE_LINE_DESCRIPTION,
        qty: '1',
        unitPrice: String(feeResolved.amount),
        isDiagnosisFee: true,
      },
      ...without,
    ]
  })

  const requiresInventory = (type: string) => INVENTORY_REQUIRED_TYPES.includes(type as InventoryRequiredType)
  const editableLines = quoteLines.filter(l => !l.isDiagnosisFee && !isDiagnosisFeeLine(l))
  const unlinkedInventoryLines = editableLines.filter(l => requiresInventory(l.type) && !l.productId)
  const invalidQuoteLines = editableLines.filter(l => !l.description.trim() || Number(l.qty) <= 0 || Number(l.unitPrice) < 0)
  const outOfStockLines = editableLines.filter(l => requiresInventory(l.type) && l.productId && (l.stockQty ?? 0) === 0)
  const canSubmit = unlinkedInventoryLines.length === 0 && invalidQuoteLines.length === 0 && quoteLines.length > 0

  const handleGenerateQuote = async () => {
    setSubmitted(true)
    if (!canSubmit || saving) return
    const lines = quoteLines.map(line => {
      const qty = Number(line.qty)
      const unitPrice = Number(line.unitPrice) || 0
      return {
        type: line.type,
        description: line.description,
        productId: line.productId,
        qty,
        unitPrice,
        subtotal: qty * unitPrice,
        isDiagnosisFee: line.isDiagnosisFee || isDiagnosisFeeLine(line) || undefined,
      }
    })
    setSaving(true)
    try {
      const savedQuote = await Promise.resolve(generateRepairQuote(repair.id, lines as any, applyVat))
      // Quote generation owns portal sync and customer delivery. Keeping the
      // send in one place prevents duplicate messages and makes revisions reliable.
      if (!savedQuote) return
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const taxable = quoteLines.reduce((s, l) => {
    if (l.isDiagnosisFee || isDiagnosisFeeLine(l)) return s
    return s + Math.max(0, Number(l.qty) || 0) * Math.max(0, Number(l.unitPrice) || 0)
  }, 0)
  const total = quoteLines.reduce((s, l) => s + Math.max(0, Number(l.qty) || 0) * Math.max(0, Number(l.unitPrice) || 0), 0)
  const vatAmt = applyVat ? Math.round(taxable * (companySettings.vatRate / 100)) : 0

  return (
    <Modal variant="enterprise" title={repair.quote ? 'Update Quote' : 'Generate Quote'} subtitle={`Job Ref: ${repair.ref} — ${repair.productName}`} onClose={onClose} width={760} icon={<Fa icon={faFileInvoiceDollar} />} accent="#F59E0B">
      <div className="flex flex-col gap-5">
        {chargeFee && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 font-semibold">
            Diagnosis fee KES {feeResolved.amount.toLocaleString('en-KE')} is locked and not credited against labour or parts. VAT on diagnosis fee is 0%.
          </div>
        )}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[120px_1fr_72px_120px_36px] gap-1 px-3 py-2 bg-[var(--bg-muted)] border-b border-[var(--border)]">
            {['Type','Description / Item','Qty','Unit Price (KES)',''].map(h => (
              <span key={h} className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">{h}</span>
            ))}
          </div>

          {/* Lines */}
          <div className="divide-y divide-[var(--border-lt)]">
            {quoteLines.map((line, i) => {
              const locked = !!(line.isDiagnosisFee || isDiagnosisFeeLine(line))
              const hasInvalidLine = !locked && (!line.description.trim() || Number(line.qty) <= 0 || Number(line.unitPrice) < 0)
              return (
              <div key={i} className={`grid grid-cols-1 sm:grid-cols-[120px_1fr_72px_120px_36px] gap-2 px-3 py-3 sm:py-2 items-center ${hasInvalidLine && submitted ? 'bg-red-50/70' : locked ? 'bg-amber-50/40' : ''}`} style={{ animation: 'fadeIn 0.18s ease both', animationDelay: `${i * 40}ms` }}>
                <select
                  className="form-input text-[12px] sm:text-[11px] font-bold py-1.5"
                  value={line.type}
                  disabled={locked}
                  onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, type: e.target.value as any, productId: undefined, stockQty: undefined } : l))}
                >
                  <option value="part">Hardware Part</option>
                  <option value="labor">Labour</option>
                  <option value="software">Software</option>
                  <option value="license">License</option>
                  <option value="logistics">Logistics</option>
                  <option value="service">Service</option>
                </select>

                {locked ? (
                  <input className="form-input" value={line.description} readOnly />
                ) : line.type === 'part' || line.type === 'license' || line.type === 'service' ? (
                  <ProductPicker
                    value={line.description}
                    productId={line.productId}
                    products={products as any}
                    requireInventory={requiresInventory(line.type)}
                    submitted={submitted}
                    onSelect={(p, custom) => setQuoteLines(prev => prev.map((l, j) => j === i
                      ? p
                        ? { ...l, description: p.name, productId: p.id, unitPrice: String(p.salePrice), stockQty: p.stockQty }
                        : { ...l, description: custom, productId: undefined, stockQty: undefined }
                      : l
                    ))}
                  />
                ) : (
                  <input
                    className="form-input"
                    placeholder="Description…"
                    value={line.description}
                    onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, description: e.target.value } : l))}
                  />
                )}

                <input
                  className="form-input text-right"
                  type="number"
                  min="0"
                  value={line.qty}
                  readOnly={locked}
                  onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))}
                />
                <input
                  className="form-input text-right"
                  type="number"
                  min="0"
                  value={line.unitPrice}
                  readOnly={locked}
                  onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, unitPrice: e.target.value } : l))}
                />
                <button
                  type="button"
                  className="text-[var(--text-4)] hover:text-red-500 disabled:opacity-30"
                  disabled={locked || quoteLines.length <= 1}
                  title={locked ? 'Diagnosis fee is locked' : 'Remove line'}
                  onClick={() => setQuoteLines(prev => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            )})}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => setQuoteLines(prev => [...prev, { type: 'labor', description: '', qty: '1', unitPrice: '0' }])}
          >
            + Add line
          </button>
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-2)]">
            <input type="checkbox" checked={applyVat} onChange={e => setApplyVat(e.target.checked)} />
            Apply VAT on labour/parts (diagnosis fee always 0%)
          </label>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-[var(--text-3)]">Subtotal</span><span className="font-bold">{fmtKes(total)}</span></div>
          {applyVat && <div className="flex justify-between"><span className="text-[var(--text-3)]">VAT</span><span className="font-bold">{fmtKes(vatAmt)}</span></div>}
          <div className="flex justify-between border-t border-[var(--border-lt)] pt-1"><span className="font-black">Total</span><span className="font-black">{fmtKes(total + vatAmt)}</span></div>
        </div>

        {(submitted && (!canSubmit)) && (
          <p className="text-[11px] text-red-600 font-semibold">Fix invalid or unlinked inventory lines before generating the quote.</p>
        )}

        {outOfStockLines.length > 0 && (
          <div className="flex items-start gap-3 p-3.5 rounded-xl border border-amber-500/25 bg-[rgba(245,158,11,0.07)]">
            <Fa icon={faExclamationCircle} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black text-amber-600 uppercase tracking-wide mb-1">Out of Stock — Procurement will be raised</p>
              <p className="text-[10px] text-[var(--text-2)] leading-relaxed">
                <strong>{outOfStockLines.map(l => l.description).join(', ')}</strong> {outOfStockLines.length === 1 ? 'is' : 'are'} currently out of stock.
                A procurement request will be created automatically when the client approves.
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleGenerateQuote} color="linear-gradient(135deg,#D97706,#F59E0B)" shadow="0 8px 24px rgba(245,158,11,0.35)" disabled={saving || (submitted && !canSubmit)}>
            <Fa icon={faFileInvoiceDollar} /> {saving ? 'Saving…' : repair.quote ? 'Update Quote' : 'Generate Quote'}
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * QAModal
 */
export function QAModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { completeRepairQA } = useRepairStore()
  const seedDefaults = (): RepairQAItem[] => [
    { id: crypto.randomUUID(), description: 'Device powers on successfully', passed: false },
    { id: crypto.randomUUID(), description: 'Reported issue(s) fully resolved', passed: false },
    { id: crypto.randomUUID(), description: 'No new issues introduced during repair', passed: false },
    { id: crypto.randomUUID(), description: 'All accessories present and returned', passed: false },
    { id: crypto.randomUUID(), description: 'Device cleaned and presentable', passed: false },
  ]
  const resetItems = (items: RepairQAItem[]): RepairQAItem[] =>
    items.map(item => ({ ...item, passed: false, notes: undefined, testedBy: undefined, testedDate: undefined }))

  const [qcItems, setQcItems] = useState<RepairQAItem[]>(() =>
    resetItems(repair.qcItems?.length ? repair.qcItems : seedDefaults())
  )
  const [failReason, setFailReason] = useState('')

  // Reset prior pass ticks whenever the modal opens for this repair
  useEffect(() => {
    setQcItems(resetItems(repair.qcItems?.length ? repair.qcItems : seedDefaults()))
    setFailReason('')
  }, [repair.id])

  const allPassed = qcItems.length > 0 && qcItems.every(i => i.passed)
  const canSubmitFail = allPassed || failReason.trim().length > 0

  const handleCompleteQA = () => {
    if (!allPassed && !failReason.trim()) return
    const qaResults = qcItems.map(item => ({
      itemId: item.id,
      description: item.description,
      passed: item.passed,
      notes: item.notes,
    }))
    completeRepairQA(repair.id, qaResults, allPassed ? undefined : failReason.trim())
    onClose()
  }

  return (
    <Modal variant="enterprise" title="Quality Assurance" subtitle={repair.ref} onClose={onClose} width={520} icon={<Fa icon={faCheckCircle} />} accent="#10B981">
      <div className="flex flex-col gap-6">
        {qcItems.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center animate-pulse">
              <Fa icon={faTools} className="text-xl" />
            </div>
            <p className="text-xs font-medium">Loading checklist...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <p className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Verify Repair Quality</p>
            <p className="text-[11px] text-[var(--text-3)] mb-1">Prior pass ticks are cleared for this QC round — re-check every item.</p>
            {qcItems.map(item => (
              <div
                key={item.id}
                className="flex flex-col gap-2 p-4 rounded-2xl border transition-all"
                style={{
                  background: item.passed ? 'rgba(16,185,129,0.07)' : 'var(--bg-card)',
                  borderColor: item.passed ? 'rgba(16,185,129,0.3)' : 'var(--border)',
                  boxShadow: item.passed ? '0 0 0 3px rgba(16,185,129,0.08)' : 'none',
                }}
              >
                <label className="flex items-center gap-4 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="w-5 h-5 rounded-lg border-[var(--border)] text-emerald-600 focus:ring-emerald-500 transition-all cursor-pointer"
                    checked={item.passed}
                    onChange={e => setQcItems(prev => prev.map(qi => qi.id === item.id ? { ...qi, passed: e.target.checked } : qi))}
                  />
                  <span className={`text-xs font-bold flex-1 transition-colors ${item.passed ? 'text-emerald-700' : 'text-[var(--text-2)]'}`}>
                    {item.description}
                  </span>
                  {item.passed && <Fa icon={faCheckCircle} className="text-emerald-500" style={{ animation: 'confirmIn 0.18s cubic-bezier(0.34,1.4,0.64,1) both' }} />}
                </label>
                {!item.passed && (
                  <input
                    className="form-input text-[11px] w-full"
                    placeholder="Note for this failed / unchecked item (optional)"
                    value={item.notes || ''}
                    onChange={e => setQcItems(prev => prev.map(qi => qi.id === item.id ? { ...qi, notes: e.target.value } : qi))}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {!allPassed && (
          <Field label="Fail reason" required>
            <Textarea
              value={failReason}
              onChange={setFailReason}
              placeholder="Why is QC failing? (required — shown to the technician)"
              rows={3}
            />
          </Field>
        )}

        <div
          className="p-4 rounded-2xl border flex items-start gap-3 transition-all"
          style={{
            background: allPassed ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
            borderColor: allPassed ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)',
          }}
        >
          <Fa icon={allPassed ? faCheckCircle : faExclamationTriangle} style={{ color: allPassed ? 'var(--success)' : 'var(--warning)', marginTop: 2 } as any} />
          <p className="text-[11px] leading-relaxed font-medium" style={{ color: allPassed ? 'var(--success-text)' : 'var(--warning-text)' }}>
            {allPassed
              ? 'Excellent! All tests passed. The device is verified and ready for the customer.'
              : 'Submitting will return this job to In Repair for rework. A fail reason is required.'}
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn
            onClick={handleCompleteQA}
            disabled={!canSubmitFail}
            color={allPassed ? 'linear-gradient(135deg,#059669,#10B981)' : 'linear-gradient(135deg,#D97706,#F59E0B)'}
            shadow={allPassed ? '0 8px 24px rgba(16,185,129,0.4)' : '0 8px 24px rgba(245,158,11,0.4)'}
          >
            <Fa icon={allPassed ? faCheckCircle : faExclamationTriangle} />
            {allPassed ? 'Pass Quality Check' : 'Submit as Failed'}
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * LeaveDeviceModal — customer leaves device with Deed (terminal retained)
 */
export function LeaveDeviceModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { leaveDeviceWithDeed } = useRepairStore()
  const [notes, setNotes] = useState('')
  const [convertMode, setConvertMode] = useState<'none' | 'donation' | 'buyback'>('donation')

  const handleConfirm = () => {
    leaveDeviceWithDeed(repair.id, {
      convertToDonation: convertMode === 'donation',
      convertToStock: convertMode === 'buyback',
      notes: notes.trim() || undefined,
    })
    onClose()
  }

  return (
    <Modal variant="enterprise" title="Customer Leaves Device" subtitle={repair.ref} onClose={onClose} width={440} icon={<Fa icon={faBoxOpen} />} accent="#57534E">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: 'rgba(87,83,78,0.08)', border: '1px solid rgba(87,83,78,0.22)' }}>
          <Fa icon={faBoxOpen} style={{ color: '#57534E', marginTop: 2, flexShrink: 0 } as any} />
          <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Closes this job as <strong>Left with Deed</strong>. Reserved parts are released and any linked sale order / invoice is cancelled.
            Convert into a donation-in or free buy-back stocked at warehouse, linked to this repair.
          </p>
        </div>
        <Field label="Notes (optional)">
          <Textarea value={notes} onChange={setNotes} placeholder="e.g. Customer donated the laptop after declining repair" rows={3} />
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest">Convert device</p>
          {([
            { v: 'donation' as const, label: 'Donation in → warehouse' },
            { v: 'buyback' as const, label: 'Buy-back stock (KES 0)' },
            { v: 'none' as const, label: 'Retain only (convert later)' },
          ]).map(opt => (
            <label key={opt.v} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] cursor-pointer">
              <input type="radio" name="leave-convert-modal" checked={convertMode === opt.v} onChange={() => setConvertMode(opt.v)} />
              <span className="text-[11px] font-medium text-[var(--text-2)]">{opt.label}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleConfirm} color="linear-gradient(135deg,#44403C,#78716C)" shadow="0 8px 24px rgba(87,83,78,0.35)">
            <Fa icon={faBoxOpen} /> Confirm Retain
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * ScheduleDeliveryModal
 */
export function ScheduleDeliveryModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { riders, scheduleDelivery } = useRepairStore()
  const [deliveryForm, setDeliveryForm] = useState({
    method: 'pickup' as 'pickup' | 'delivery' | 'courier',
    scheduledDate: new Date().toISOString().slice(0, 10),
    address: '',
    riderId: '',
    riderName: ''
  })

  const handleSchedule = async () => {
    const scheduled = await scheduleDelivery(
      repair.id,
      deliveryForm.method,
      deliveryForm.scheduledDate,
      deliveryForm.address || undefined,
      deliveryForm.riderId || undefined,
      deliveryForm.riderName || undefined,
    )
    // Ref allocation failure already toasted — keep the modal open to retry.
    if (scheduled !== false) onClose()
  }

  return (
    <Modal variant="enterprise" title="Schedule Delivery" subtitle={repair.ref} onClose={onClose} width={480} icon={<Fa icon={faTruck} />} accent="#0EA5E9">
      <div className="flex flex-col gap-5">
        <div className="flex p-1 bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)]">
          {(['pickup', 'delivery', 'courier'] as const).map(m => (
            <button
              key={m}
              onClick={() => setDeliveryForm(p => ({ ...p, method: m }))}
              className="flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
              style={{
                background: deliveryForm.method === m ? 'var(--bg-card)' : 'transparent',
                color: deliveryForm.method === m ? '#0284C7' : 'var(--text-4)',
                boxShadow: deliveryForm.method === m ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="space-y-4" style={{ animation: 'fadeIn 0.25s ease both' }}>
          <Field label="Scheduled Date" required>
            <Input type="date" value={deliveryForm.scheduledDate} onChange={v => setDeliveryForm(p => ({ ...p, scheduledDate: v }))} />
          </Field>

          {deliveryForm.method !== 'pickup' && (
            <>
              <Field label="Delivery Address" required>
                <Textarea value={deliveryForm.address} onChange={v => setDeliveryForm(p => ({ ...p, address: v }))} placeholder="Enter full physical address for delivery..." rows={2} />
              </Field>
              {deliveryForm.method === 'delivery' && (
                <Field label="Assign Rider" required>
                  <select
                    className="form-input text-xs font-medium"
                    value={deliveryForm.riderId}
                    onChange={e => {
                      const r = riders.find(x => x.id === e.target.value)
                      setDeliveryForm(p => ({ ...p, riderId: e.target.value, riderName: r?.name || '' }))
                    }}
                  >
                    <option value="">— Select internal rider —</option>
                    {riders.map(r => <option key={r.id} value={r.id}>{r.name} ({r.phone})</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleSchedule} color="linear-gradient(135deg,#0284C7,#0EA5E9)" shadow="0 8px 24px rgba(14,165,233,0.4)">
            <Fa icon={faTruck} /> Confirm Schedule
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * RepairProgressModal
 */
export function RepairProgressModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { startRepair, markRepairComplete, createInvoiceFromRepair, invoices, quotes, saleOrders, companySettings } = useRepairStore()
  const [notes, setNotes] = useState('')
  const noCharge = !!(repair.billingExempt || (repair.underWarranty && repair.warrantyCoverage === 'full'))
  const billingExempt = !!repair.billingExempt
  const linkedInvoice = invoices.find(i => i.id === (repair.invoiceId ?? (repair as any).linkedInvoiceId))
    ?? invoices.find(i => i.repairId === repair.id)
  const billingSync = repairBillingNeedsSync({
    salesQuoteStatus: findSalesQuoteForRepair(quotes, repair)?.status,
    saleOrderStatus: findSaleOrderForRepair(saleOrders, repair)?.status,
    invoice: linkedInvoice,
    charges: buildRepairInvoiceCharges(repair, true, companySettings?.vatRate ?? 0),
  })
  const canBillFromQuote = !noCharge
    && ['ready', 'invoiced'].includes(repair.status)
    && billingSync.needed
    && !(billingSync.invoicePaid && !billingSync.matchesInvoice)

  const canStartHere = (['approved', 'awaiting_parts'].includes(repair.status))
    || (repair.repairPath === 'direct_repair' && ['assigned', 'diagnosed', 'approved', 'awaiting_parts'].includes(repair.status))
    || (billingExempt && ['assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'declined'].includes(repair.status))

  const handleAction = () => {
    if (canStartHere) {
      startRepair(repair.id)
    } else if (repair.status === 'in_repair') {
      markRepairComplete(repair.id)
    } else if (canBillFromQuote) {
      createInvoiceFromRepair(repair.id, true)
    }
    onClose()
  }

  const getConfig = () => {
    if (canStartHere)
      return { title: 'Start Repair Job',     btn: 'Start Repair',      icon: faPlay,             accent: '#2563EB', grad: 'linear-gradient(135deg,#1D4ED8,#2563EB)', shadow: '0 8px 24px rgba(37,99,235,0.4)' }
    if (repair.status === 'in_repair')
      return { title: 'Mark Repair Complete', btn: 'Complete Repair',   icon: faCheckCircle,      accent: '#059669', grad: 'linear-gradient(135deg,#047857,#059669)', shadow: '0 8px 24px rgba(5,150,105,0.4)' }
    if (repair.status === 'ready' && noCharge)
      return { title: 'No Invoice Needed',    btn: 'Done',              icon: faCheckCircle,      accent: '#059669', grad: 'linear-gradient(135deg,#047857,#059669)', shadow: '0 8px 24px rgba(5,150,105,0.4)' }
    if (canBillFromQuote)
      return {
        title: billingSync.canRewriteInvoice || billingSync.quoteOpen ? 'Align Invoice with Quote' : 'Create Invoice',
        btn: billingSync.canRewriteInvoice || billingSync.quoteOpen ? 'Update from Quote' : 'Generate Invoice',
        icon: faFileInvoiceDollar, accent: '#D97706', grad: 'linear-gradient(135deg,#B45309,#D97706)', shadow: '0 8px 24px rgba(217,119,6,0.4)',
      }
    return   { title: 'Update Progress',      btn: 'Update',            icon: faHistory,           accent: '#475569', grad: 'linear-gradient(135deg,#334155,#475569)', shadow: '0 8px 24px rgba(71,85,105,0.35)' }
  }

  const cfg = getConfig()
  const readyNoChargeHint = repair.status === 'ready' && noCharge
    ? (billingExempt
      ? 'This job is no-charge — prepare release / mark collected. No customer invoice.'
      : 'Full warranty — no customer invoice. Prepare release / mark collected.')
    : null
  const billingHint = canBillFromQuote && (billingSync.canRewriteInvoice || billingSync.quoteOpen || billingSync.saleOrderOpen)
    ? 'Uses the approved quote lines, converts the quotation, and posts one invoice.'
    : null

  return (
    <Modal variant="enterprise" title={cfg.title} subtitle={repair.ref} onClose={onClose} width={400} icon={<Fa icon={cfg.icon} />} accent={cfg.accent}>
      <div className="flex flex-col gap-5">
        <div
          className="flex items-center gap-4 p-4 rounded-2xl"
          style={{ background: `${cfg.accent}0e`, border: `1px solid ${cfg.accent}22` }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl flex-shrink-0"
            style={{ background: cfg.grad, boxShadow: cfg.shadow }}
          >
            <Fa icon={cfg.icon} />
          </div>
          <div className="flex-1">
            <p className="text-xs font-black text-[var(--text-1)] uppercase tracking-tight">{cfg.title}</p>
            <p className="text-[10px] text-[var(--text-3)] font-medium mt-0.5">
              {readyNoChargeHint || billingHint || 'Moving this job to the next stage in the workflow'}
            </p>
          </div>
        </div>

        {!readyNoChargeHint && (
          <Field label="Progress Notes (Optional)">
            <Textarea value={notes} onChange={setNotes} placeholder="Any specific notes about this stage..." rows={3} />
          </Field>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleAction} color={cfg.grad} shadow={cfg.shadow}>
            <Fa icon={cfg.icon} /> {cfg.btn}
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * ProcurementModal
 */
export function ProcurementModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { requestProcurement } = useRepairStore()
  const [form, setForm] = useState({
    items: [{ type: 'part' as const, description: '', qty: '1', estimatedCost: '0' }],
    urgency: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    notes: '',
  })

  const handleRequest = () => {
    requestProcurement(repair.id, form.items.map(i => ({ ...i, qty: Number(i.qty), estimatedCost: Number(i.estimatedCost) })), form.urgency, form.notes)
    onClose()
  }

  const urgencyColors: Record<string, string> = { low: '#6B7280', normal: '#3B82F6', high: '#F97316', urgent: '#EF4444' }

  return (
    <Modal variant="enterprise" title="Request Procurement" subtitle={repair.ref} onClose={onClose} width={600} icon={<Fa icon={faCartPlus} />} accent="#F97316">
      <div className="flex flex-col gap-6">
        <div className="space-y-3">
          <p className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest">Required Parts / Licenses</p>
          {form.items.map((item, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]/50 items-end">
              <div className="sm:col-span-3">
                <Field label="Type">
                  <select className="form-input bg-[var(--bg-card)]" value={item.type}
                    onChange={e => setForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, type: e.target.value as any } : x) }))}>
                    <option value="part">Hardware Part</option>
                    <option value="software">Software</option>
                    <option value="license">License</option>
                  </select>
                </Field>
              </div>
              <div className="sm:col-span-5">
                <Field label="Description">
                  <Input value={item.description}
                    onChange={v => setForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, description: v } : x) }))}
                    placeholder="e.g. Dell Latitude 5400 Screen" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Qty">
                  <Input type="number" value={item.qty}
                    onChange={v => setForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, qty: v } : x) }))} />
                </Field>
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <button
                  onClick={() => setForm(p => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all active:scale-90">
                  ×
                </button>
              </div>
            </div>
          ))}
          <button
            className="text-[10px] font-black flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:scale-105 active:scale-95"
            style={{ color: '#EA580C', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)' }}
            onClick={() => setForm(p => ({ ...p, items: [...p.items, { type: 'part', description: '', qty: '1', estimatedCost: '0' }] }))}
          >
            <Fa icon={faCartPlus} /> ADD ANOTHER ITEM
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Field label="Urgency Level">
              <select className="form-input" value={form.urgency} onChange={e => setForm(p => ({ ...p, urgency: e.target.value as any }))}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            {form.urgency !== 'low' && (
              <div className="mt-2 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: urgencyColors[form.urgency] }} />
                <span className="text-[10px] font-bold capitalize" style={{ color: urgencyColors[form.urgency] }}>
                  {form.urgency} priority
                </span>
              </div>
            )}
          </div>
          <Field label="Additional Notes">
            <Input value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Any specific sourcing notes..." />
          </Field>
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleRequest} color="linear-gradient(135deg,#EA580C,#F97316)" shadow="0 8px 24px rgba(249,115,22,0.4)">
            <Fa icon={faCartPlus} /> Submit Request
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * ReturnModal
 */
export function ReturnModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { returnToCustomer, systemSettings } = useRepairStore()
  const [reason, setReason] = useState('')
  const afterDecline = repair.status === 'declined'
  const resolved = resolveDiagnosisFee(repair, systemSettings)
  const feeStillDue =
    shouldChargeDiagnosisFee(repair) &&
    resolved.amount > 0 &&
    !!repair.diagnosis &&
    repair.diagnosisFeeStatus !== 'invoiced' &&
    repair.diagnosisFeeStatus !== 'waived' &&
    repair.diagnosisFeeStatus !== 'paid' &&
    !repair.diagnosisFeePaidAt

  const handleReturn = () => {
    if (!reason.trim()) return
    returnToCustomer(repair.id, reason.trim())
    onClose()
  }

  return (
    <Modal variant="enterprise" title="Return to Customer" subtitle={repair.ref} onClose={onClose} width={440} icon={<Fa icon={faUndo} />} accent="#F59E0B">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <Fa icon={faUndo} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 } as any} />
          <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--warning-text)' }}>
            {afterDecline
              ? <>Returning the device after the customer declined the quote. Job moves to <strong>Returned</strong>.</>
              : <>Returning the device without completing repairs. This will move the job to <strong>Returned</strong> status.</>}
            {repair.billingExempt ? (
              <> This job is <strong>no-charge</strong> — no diagnosis fee is due.</>
            ) : feeStillDue ? (
              <> Diagnosis fee of <strong>KES {resolved.amount.toLocaleString('en-KE')}</strong> still applies.</>
            ) : null}
          </p>
        </div>
        <Field label="Reason for Return" required>
          <Textarea value={reason} onChange={setReason} placeholder="Why is the device being returned? (e.g. Customer request, part unavailable)" rows={3} />
        </Field>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleReturn} color="linear-gradient(135deg,#D97706,#F59E0B)" shadow="0 8px 24px rgba(245,158,11,0.4)">
            <Fa icon={faUndo} /> Confirm Return
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * DeclineModal
 */
export function DeclineModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { declineQuote } = useRepairStore()
  const [reason, setReason] = useState('')

  const handleDecline = () => {
    if (!reason.trim()) return
    void declineQuote(repair.id, reason.trim())
    onClose()
  }

  return (
    <Modal variant="enterprise" title="Decline Quote" subtitle={repair.ref} onClose={onClose} width={440} icon={<Fa icon={faTimesCircle} />} accent="#EF4444">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)' }}>
          <Fa icon={faTimesCircle} style={{ color: 'var(--danger)', marginTop: 2, flexShrink: 0 } as any} />
          <p className="text-[11px] font-medium leading-relaxed" style={{ color: '#7F1D1D' }}>
            Marks the quote as <strong>Declined</strong>. You can still{' '}
            <strong>revise and re-send</strong> another quote, or <strong>return the device</strong>.
            Diagnosis fee (if diagnosis was done) stays due — it is not credited against any future repair.
            Declining diagnosis at intake (Direct Repair) is different and has no fee.
          </p>
        </div>
        <Field label="Reason for Declining" required>
          <Textarea value={reason} onChange={setReason} placeholder="e.g. Cost too high, customer decided to buy new device..." rows={3} />
        </Field>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleDecline} color="linear-gradient(135deg,#B91C1C,#EF4444)" shadow="0 8px 24px rgba(239,68,68,0.4)">
            <Fa icon={faTimesCircle} /> Mark as Declined
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * EditRepairDetailsModal — managers (director, admin officer, technical lead)
 * can correct intake/customer/device details after booking.
 */
export function EditRepairDetailsModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { updateRepair, appendRepairHistory, showToast, currentUserId, users, systemSettings } = useRepairStore()
  const actor = users.find(u => u.id === currentUserId)
  const feeLocked = repair.diagnosisFeeStatus === 'invoiced' || repair.diagnosisFeeStatus === 'waived'
  const [form, setForm] = useState({
    customerName: repair.customerName || '',
    customerPhone: repair.customerPhone || '',
    customerEmail: repair.customerEmail || '',
    productName: repair.productName || '',
    serialNumber: repair.serialNumber || '',
    deviceColor: repair.deviceColor || '',
    deviceCondition: repair.deviceCondition || 'good',
    clientLaptopPassword: repair.clientLaptopPassword || '',
    priority: repair.priority || 'normal',
    issueDescription: repair.issueDescription || '',
    intakeNotes: repair.intakeNotes || '',
    repairPath: (repair.repairPath === 'direct_repair' ? 'direct_repair' : 'diagnosis_first') as 'diagnosis_first' | 'direct_repair',
    consentSignature: repair.liabilityWaiverSignature || '',
    agreeTerms: !!repair.liabilityWaiverAccepted,
  })
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.customerName.trim()) { showToast('Client name is required', 'error'); return }
    if (!form.productName.trim()) { showToast('Device name is required', 'error'); return }
    const pathChanging = form.repairPath !== (repair.repairPath === 'direct_repair' ? 'direct_repair' : 'diagnosis_first')
    if (form.repairPath === 'direct_repair' && pathChanging && (!String(form.consentSignature).trim() || !form.agreeTerms)) {
      showToast('Customer signature and terms agreement required when switching to Direct Repair', 'error')
      return
    }
    const nowIso = new Date().toISOString()
    const pathPatch = pathChanging
      ? form.repairPath === 'direct_repair'
        ? {
            repairPath: 'direct_repair' as const,
            liabilityWaiverAccepted: true,
            liabilityWaiverText: DIRECT_REPAIR_WAIVER_TEXT,
            liabilityWaiverAcceptedAt: nowIso,
            liabilityWaiverSignature: String(form.consentSignature).trim(),
            diagnosisFee: 0,
            diagnosisFeeStatus: 'not_applicable' as const,
            diagnosisFeeBilling: undefined,
            notes: `${repair.notes || ''}\n[Workflow path changed → Direct Repair / declined diagnosis] Signed by: ${String(form.consentSignature).trim()}. No diagnosis fee. By: ${actor?.name || 'staff'}.`.trim(),
          }
        : {
            repairPath: 'diagnosis_first' as const,
            liabilityWaiverAccepted: false,
            liabilityWaiverText: undefined,
            liabilityWaiverAcceptedAt: undefined,
            liabilityWaiverSignature: undefined,
            notes: `${repair.notes || ''}\n[Workflow path changed → Diagnosis First] By: ${actor?.name || 'staff'}.`.trim(),
          }
      : {}

    const feePatch = (!feeLocked && form.repairPath === 'diagnosis_first')
      ? (() => {
          const resolved = resolveDiagnosisFee(
            {
              ...repair,
              repairPath: 'diagnosis_first',
              diagnosisFeeStatus: repair.diagnosisFeeStatus === 'waived' ? 'waived' : (repair.diagnosisFeeStatus === 'paid' ? 'paid' : 'applicable'),
            },
            systemSettings,
          )
          return {
            diagnosisFee: resolved.amount,
            diagnosisFeeStatus: (repair.diagnosisFeeStatus === 'waived'
              ? 'waived'
              : repair.diagnosisFeeStatus === 'paid' || repair.diagnosisFeePaidAt
                ? 'paid'
                : resolved.amount > 0 ? 'applicable' : 'not_applicable') as RepairOrder['diagnosisFeeStatus'],
            diagnosisFeeBilling: repair.diagnosisFeeBilling ?? resolved.billing,
            customerBillingType: repair.customerBillingType ?? resolved.customerType,
          }
        })()
      : form.repairPath === 'direct_repair'
        ? { diagnosisFee: 0, diagnosisFeeStatus: 'not_applicable' as const }
        : {}

    updateRepair(repair.id, {
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      customerEmail: form.customerEmail.trim() || undefined,
      productName: form.productName.trim(),
      serialNumber: form.serialNumber.trim(),
      deviceColor: form.deviceColor.trim() || undefined,
      deviceCondition: form.deviceCondition as RepairOrder['deviceCondition'],
      clientLaptopPassword: form.clientLaptopPassword.trim() || undefined,
      priority: form.priority as RepairOrder['priority'],
      issueDescription: form.issueDescription.trim(),
      intakeNotes: form.intakeNotes.trim(),
      description: form.issueDescription.trim(),
      ...pathPatch,
      ...feePatch,
    })
    if (pathChanging && appendRepairHistory) {
      appendRepairHistory(repair.id, {
        status: repair.status,
        date: nowIso.slice(0, 10),
        note: `Workflow path changed to ${form.repairPath === 'direct_repair' ? 'Direct Repair' : 'Diagnosis First'}`,
        by: actor?.name || 'staff',
      })
    }
    showToast(pathChanging ? 'Repair details and workflow path updated' : 'Repair details updated', 'success')
    onClose()
  }

  const flatFee = resolveDiagnosisFee({
    repairPath: 'diagnosis_first',
    intakeDate: repair.intakeDate,
  }, systemSettings).amount
  const feeInEffect = flatFee > 0

  return (
    <Modal variant="enterprise" title="Edit Repair Details" subtitle={repair.ref} onClose={onClose} width={560} icon={<Fa icon={faUserGear} />} accent="#2563EB">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Client Name" required><Input value={form.customerName} onChange={set('customerName')} /></Field>
          <Field label="Phone"><Input value={form.customerPhone} onChange={set('customerPhone')} /></Field>
          <Field label="Email"><Input value={form.customerEmail} onChange={set('customerEmail')} /></Field>
          <Field label="Device" required><Input value={form.productName} onChange={set('productName')} /></Field>
          <Field label="Serial Number"><Input value={form.serialNumber} onChange={set('serialNumber')} /></Field>
          <Field label="Device Colour"><Input value={form.deviceColor} onChange={set('deviceColor')} /></Field>
          <Field label="Condition">
            <Select value={form.deviceCondition} onChange={set('deviceCondition')} options={[
              { value: 'good', label: 'Good' },
              { value: 'fair', label: 'Fair' },
              { value: 'poor', label: 'Poor' },
              { value: 'damaged', label: 'Damaged' },
            ]} />
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={set('priority')} options={[
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]} />
          </Field>
          <Field label="Device Password"><Input value={form.clientLaptopPassword} onChange={set('clientLaptopPassword')} /></Field>
          <Field label="Workflow Path">
            <Select value={form.repairPath} onChange={v => set('repairPath')(v)} options={[
              { value: 'diagnosis_first', label: 'Diagnosis First' },
              { value: 'direct_repair', label: 'Direct Repair (decline diagnosis)' },
            ]} />
          </Field>
        </div>
        {form.repairPath === 'diagnosis_first' && (
          <p className="text-[10px] font-semibold text-[var(--text-3)]">
            {feeInEffect
              ? `Diagnosis fee KES ${flatFee.toLocaleString('en-KE')} · billed on final invoice · not credited against repair`
              : 'No mandatory diagnosis fee — this job was received before 3 Aug 2026, 3:00pm'}
            {feeLocked ? ` · currently ${repair.diagnosisFeeStatus}` : ''}
          </p>
        )}
        {form.repairPath === 'direct_repair' && form.repairPath !== (repair.repairPath === 'direct_repair' ? 'direct_repair' : 'diagnosis_first') && (
          <div className="p-3 rounded-xl space-y-3" style={{ background: '#F5F3FF', border: '1px solid #DDD6FE' }}>
            <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#6D28D9' }}>Direct Repair consent</p>
            <Field label="Customer Signature" required>
              <Input value={String(form.consentSignature)} onChange={v => set('consentSignature')(v)} placeholder="Type full name as signature" />
            </Field>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={!!form.agreeTerms} onChange={e => set('agreeTerms')(e.target.checked)} />
              <span className="text-[10px] font-medium leading-tight" style={{ color: 'var(--text-3)' }}>
                Customer declines diagnosis — no diagnosis fee; work limited to the requested scope. Liability waiver accepted.
              </span>
            </label>
          </div>
        )}
        <Field label="Issue Description"><Textarea value={form.issueDescription} onChange={set('issueDescription')} rows={3} /></Field>
        <Field label="Intake Notes"><Textarea value={form.intakeNotes} onChange={set('intakeNotes')} rows={2} /></Field>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleSave} color="linear-gradient(135deg,#1D4ED8,#3B82F6)" shadow="0 8px 24px rgba(59,130,246,0.4)">
            <Fa icon={faCheckCircle} /> Save Changes
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * StopAtDiagnosisModal — customer declines repair after diagnosis was performed.
 * Diagnosis fee still applies (not the same as declining diagnosis at intake).
 */
export function StopAtDiagnosisModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { stopAtDiagnosis, updateRepair, systemSettings } = useRepairStore()
  const [reason, setReason] = useState('')
  const fee = resolveDiagnosisFee(repair, systemSettings)
  const alreadyPaid = fee.status === 'paid' || !!repair.diagnosisFeePaidAt
  const feeLabel = fee.amount > 0
    ? `KES ${fee.amount.toLocaleString('en-KE')}`
    : fee.status === 'waived' ? 'waived' : 'KES 0'

  const handleConfirm = () => {
    stopAtDiagnosis(repair.id)
    if (reason.trim()) {
      updateRepair(repair.id, { notes: (repair.notes || '') + `\n[Stopped at diagnosis] ${reason.trim()}` })
    }
    onClose()
  }

  return (
    <Modal variant="enterprise" title="Stop at Diagnosis" subtitle={repair.ref} onClose={onClose} width={440} icon={<Fa icon={faBan} />} accent="#F59E0B">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <Fa icon={faExclamationTriangle} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 } as any} />
          <div className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--warning-text)' }}>
            <p className="mb-1">The customer is taking the device <strong>without repair</strong>. This will:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                {alreadyPaid
                  ? <>Diagnosis fee <strong>{feeLabel}</strong> already paid (not credited against labour)</>
                  : <>Charge diagnosis fee <strong>{feeLabel}</strong> (0% VAT; not credited against labour)</>}
              </li>
              <li>Move the job to <strong>Ready</strong> for invoicing and collection</li>
              <li>Release the device through the normal handover flow</li>
            </ul>
          </div>
        </div>
        <Field label="Reason (optional)">
          <Textarea value={reason} onChange={setReason} placeholder="e.g. Repair cost too high, customer buying a new device..." rows={2} />
        </Field>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleConfirm} color="linear-gradient(135deg,#D97706,#F59E0B)" shadow="0 8px 24px rgba(245,158,11,0.4)">
            <Fa icon={faBan} /> Stop &amp; {alreadyPaid ? 'Close' : 'Charge Fee'}
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * MarkDeliveredConfirm — 2-step handover form
 * Collector type: Client | Representative
 */
export function MarkDeliveredConfirm({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { deliverRepair } = useRepairStore()
  const [collectorType, setCollectorType] = useState<'client' | 'rep'>('client')
  const [name, setName] = useState(repair.contactPersonName || repair.customerName || '')
  const [phone, setPhone] = useState(repair.contactPersonPhone || repair.customerPhone || '')
  const [relationship, setRelationship] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [closeAfter, setCloseAfter] = useState(() => shouldDefaultCloseAfterHandover(repair))
  const [loading, setLoading] = useState(false)

  const isRep = collectorType === 'rep'
  const canSubmit = name.trim().length > 0 && (!isRep || relationship.trim().length > 0)
  const noCharge = isRepairNoCharge(repair)

  const RELATIONSHIPS = [
    { value: '', label: '— Select relationship —' },
    { value: 'Spouse', label: 'Spouse / Partner' },
    { value: 'Family', label: 'Family Member' },
    { value: 'Employee', label: 'Employee / Colleague' },
    { value: 'Friend', label: 'Friend' },
    { value: 'Driver', label: 'Driver / Courier' },
    { value: 'Other', label: 'Other' },
  ]

  const handleConfirm = () => {
    if (!canSubmit) return
    setLoading(true)
    deliverRepair(repair.id, name.trim(), phone.trim(), isRep, relationship.trim() || undefined, idNumber.trim() || undefined, closeAfter)
    onClose()
  }

  return (
    <Modal variant="enterprise" title="Device Handover" subtitle={repair.ref} onClose={onClose} width={480} icon={<Fa icon={faTruck} />} accent="#10B981">
      <div className="flex flex-col gap-5">

        {/* Collector type toggle */}
        <div>
          <p className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest mb-2">Who is collecting the device?</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={() => {
                setCollectorType('client')
                setName(repair.contactPersonName || repair.customerName || '')
                setPhone(repair.contactPersonPhone || repair.customerPhone || '')
                setRelationship('')
                setIdNumber('')
              }}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-[11px] font-black uppercase tracking-wider transition-all active:scale-95"
              style={collectorType === 'client'
                ? { borderColor: '#10B981', background: 'rgba(16,185,129,0.08)', color: '#059669' }
                : { borderColor: 'var(--border)', color: 'var(--text-3)' }
              }
            >
              <Fa icon={faUser} className="text-xs" /> Client
            </button>
            <button
              onClick={() => {
                setCollectorType('rep')
                setName('')
                setPhone('')
                setRelationship('')
                setIdNumber('')
              }}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-[11px] font-black uppercase tracking-wider transition-all active:scale-95"
              style={collectorType === 'rep'
                ? { borderColor: '#3B82F6', background: 'rgba(59,130,246,0.08)', color: '#2563EB' }
                : { borderColor: 'var(--border)', color: 'var(--text-3)' }
              }
            >
              <Fa icon={faUsers} className="text-xs" /> Representative
            </button>
          </div>
        </div>

        {/* Client path */}
        {!isRep && (
          <>
            <Field label="Client Name">
              <Input value={name} onChange={setName} placeholder={repair.customerName} />
            </Field>
            <Field label="Phone (optional)">
              <Input value={phone} onChange={setPhone} placeholder="e.g. 0712 345 678" />
            </Field>
          </>
        )}

        {/* Representative path */}
        {isRep && (
          <>
            <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-[rgba(245,158,11,0.08)] border border-amber-500/30">
              <Fa icon={faExclamationTriangle} className="text-amber-500 text-sm mt-0.5 shrink-0" />
              <p className="text-[11px] text-[var(--text-2)] leading-relaxed">
                Collecting on behalf of <strong>{repair.contactPersonName || repair.customerName}</strong>. Verify representative identity before releasing the device.
              </p>
            </div>
            <Field label="Representative Name" required>
              <Input value={name} onChange={setName} placeholder="Full name" />
            </Field>
            <Field label="Phone Number">
              <Input value={phone} onChange={setPhone} placeholder="Representative's phone number" />
            </Field>
            <Field label="Relationship to Client" required>
              <Select value={relationship} onChange={setRelationship} options={RELATIONSHIPS} />
            </Field>
            <Field label="ID / Document Number (optional)">
              <Input value={idNumber} onChange={setIdNumber} placeholder="National ID, passport, etc." />
            </Field>
          </>
        )}

        {/* Handover summary */}
        {name.trim() && (
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[rgba(16,185,129,0.08)] border border-emerald-500/25">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <p className="text-[10px] font-semibold text-emerald-700">
              Handing over to <strong>{name.trim()}</strong>
              {isRep && relationship ? ` — ${relationship}, collecting on behalf of client` : ''}
            </p>
          </div>
        )}

        <label className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 rounded border-[var(--border)]"
            checked={closeAfter}
            onChange={e => setCloseAfter(e.target.checked)}
          />
          <span>
            <span className="block text-[11px] font-black text-[var(--text-1)] uppercase tracking-wider">Close job after handover</span>
            <span className="block text-[11px] text-[var(--text-3)] mt-0.5 leading-relaxed">
              {noCharge
                ? 'No invoice needed — this marks the job collected and closed in one step.'
                : 'Billed jobs need an invoice before they can close. Uncheck to collect now and close later.'}
            </span>
          </span>
        </label>

        <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleConfirm} disabled={!canSubmit || loading} color="linear-gradient(135deg,#059669,#10B981)" shadow="0 8px 24px rgba(16,185,129,0.4)">
            <Fa icon={faTruck} /> Confirm Handover
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

export function CancelRepairModal({ repair, onClose }: { repair: RepairOrder; onClose: () => void }) {
  const { updateRepairProgress, showToast } = useRepairStore()
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCancel() {
    if (!reason.trim()) { showToast('Please enter a cancellation reason', 'error'); return }
    setLoading(true)
    try {
      await updateRepairProgress(repair.id, 'cancelled', reason.trim(), false)
      showToast(`Repair ${repair.ref} cancelled`, 'success')
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal variant="enterprise" title="Cancel Repair" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center gap-4 py-4">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl shadow-lg"
            style={{ background: 'linear-gradient(135deg,var(--danger),var(--danger))', boxShadow: '0 12px 32px rgba(239,68,68,0.4)' }}
          >
            <Fa icon={faBan} />
          </div>
          <div>
            <p className="text-sm font-black text-[var(--text-1)]">Cancel Repair #{repair.ref}?</p>
            <p className="text-xs text-[var(--text-3)] mt-1.5 px-4 leading-relaxed">
              This will mark the repair as cancelled and release any assigned resources. This action cannot be undone.
            </p>
          </div>
        </div>
        <Field label="Reason for Cancellation">
          <Textarea
            value={reason}
            onChange={v => setReason(v)}
            placeholder="Enter reason for cancellation…"
            rows={3}
          />
        </Field>
        <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Back</button>
          <ActionBtn onClick={handleCancel} color="linear-gradient(135deg,#DC2626,#EF4444)" shadow="0 8px 24px rgba(239,68,68,0.4)" disabled={loading}>
            <Fa icon={faBan} /> {loading ? 'Cancelling…' : 'Cancel Repair'}
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

export function DeleteRepairConfirm({ repair, onClose, onDeleted }: { repair: RepairOrder; onClose: () => void; onDeleted?: () => void }) {
  const { deleteRepair } = useRepairStore()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    if (loading) return
    setLoading(true)
    try {
      const deleted = await deleteRepair(repair.id)
      if (!deleted) return
      onDeleted?.()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal variant="enterprise" title="Delete Repair" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center gap-4 py-4">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl shadow-lg"
            style={{ background: 'linear-gradient(135deg,#7C3AED,#9333EA)', boxShadow: '0 12px 32px rgba(124,58,237,0.4)' }}
          >
            <Fa icon={faTrash} />
          </div>
          <div>
            <p className="text-sm font-black text-[var(--text-1)]">Delete Repair #{repair.ref}?</p>
            <p className="text-xs text-[var(--text-3)] mt-1.5 px-4 leading-relaxed">
              This will permanently remove this repair record and all associated data. This action <span className="font-black text-red-500">cannot</span> be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Back</button>
          <ActionBtn onClick={() => { void handleDelete() }} color="linear-gradient(135deg,#7C3AED,#9333EA)" shadow="0 8px 24px rgba(124,58,237,0.4)" disabled={loading}>
            <Fa icon={faTrash} /> {loading ? 'Deleting…' : 'Delete Permanently'}
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}
