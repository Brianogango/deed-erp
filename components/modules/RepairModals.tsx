'use client'

import { useState, useRef, useEffect } from 'react'
import { useApp, RepairOrder, OUTSOURCE_SERVICE_TYPES } from '@/lib/store'
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
  faExternalLinkSquareAlt,
  faSearch,
  faBoxOpen,
  faExclamationCircle,
  faCheckSquare,
  faShieldAlt,
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
  const { users, currentUserId, assignTechnicianToRepair } = useApp()
  const technicians = users.filter(u => ['technician', 'technical_lead'].includes(u.role))
  const isReassign = !!repair.assignedTechnicianName

  return (
    <Modal
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
            style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)', color: '#92400E' }}>
            <Fa icon={faExclamationTriangle} className="mt-0.5 flex-shrink-0" style={{ color: '#F59E0B' } as any} />
            <p className="text-[11px] leading-relaxed font-medium">
              Currently assigned to <span className="font-black">{repair.assignedTechnicianName}</span>.
              Changing this will transfer all technical responsibility for this job.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
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
                    style={{ background: isMe ? 'linear-gradient(135deg,#10B981,#059669)' : 'linear-gradient(135deg,#475569,#334155)' }}
                  >
                    {tech.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-[var(--text-1)] text-xs">{tech.name}{isMe ? ' (You)' : ''}</p>
                    <p className="text-[10px] text-[var(--text-3)] font-medium capitalize mt-0.5">{tech.role.replace('_', ' ')}</p>
                  </div>
                  {isCurrent && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider"
                      style={{ background: 'rgba(59,130,246,0.12)', color: '#2563EB', border: '1px solid rgba(59,130,246,0.25)' }}>
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
  const { logDiagnosis, updateRepair, showToast } = useApp()
  const [diagForm, setDiagForm] = useState({
    findings: '', faultDescription: '', recommendedAction: '', estimatedHours: '2',
    clientCausedDamage: false, clientDamageReason: '',
  })
  const [warrantyCoverage, setWarrantyCoverage] = useState<'full' | 'partial' | 'void'>(
    repair.warrantyCoverage ?? 'full'
  )

  const handleLogDiagnosis = () => {
    if (!diagForm.findings || !diagForm.faultDescription) {
      showToast('Findings and fault description are required', 'error'); return
    }
    if (diagForm.clientCausedDamage && !diagForm.clientDamageReason) {
      showToast('Please select the type of client-caused damage', 'error'); return
    }
    logDiagnosis(repair.id, {
      findings: diagForm.findings, faultDescription: diagForm.faultDescription,
      recommendedAction: diagForm.recommendedAction,
      estimatedHours: Number(diagForm.estimatedHours) || 0,
    })
    if (diagForm.clientCausedDamage) {
      updateRepair(repair.id, { clientCausedDamage: true, clientDamageReason: diagForm.clientDamageReason || undefined, underWarranty: false, warrantyCoverage: 'void' })
    } else if (repair.underWarranty) {
      updateRepair(repair.id, { warrantyCoverage })
    }
    onClose()
  }

  return (
    <Modal title="Log Diagnosis" subtitle={repair.ref} onClose={onClose} width={560} icon={<Fa icon={faStethoscope} />} accent="#06B6D4">
      <div className="flex flex-col gap-5">
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
            <div className="grid grid-cols-3 gap-2">
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
            <Fa icon={faStethoscope} /> Save Diagnosis
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Inline product picker used inside QuoteModal lines
 */
function ProductPicker({ value, productId, onSelect, products }: {
  value: string
  productId?: string
  onSelect: (p: { id: string; name: string; salePrice: number; stockQty: number } | null, custom: string) => void
  products: { id: string; name: string; sku: string; salePrice: number; stockQty: number; isActive: boolean }[]
}) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const matches = query.length > 0
    ? products.filter(p => p.isActive && (p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()))).slice(0, 8)
    : []

  useEffect(() => { setQuery(value) }, [value])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative w-full">
      <div className="relative">
        <Fa icon={faSearch} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-4)] text-[9px] pointer-events-none" />
        <input
          className="form-input bg-[var(--bg-card)] pl-7 pr-2"
          placeholder="Search inventory or type…"
          value={query}
          onChange={e => { setQuery(e.target.value); onSelect(null, e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
        {productId && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-500" title="Linked to inventory" />
        )}
      </div>
      {open && matches.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xl overflow-hidden">
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
        </div>
      )}
    </div>
  )
}

/**
 * QuoteModal
 */
export function QuoteModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { generateRepairQuote, requestProcurement, companySettings, products, showToast } = useApp()
  const [applyVat, setApplyVat] = useState(repair.quote ? repair.quote.tax > 0 : true)
  const [quoteLines, setQuoteLines] = useState<{
    type: 'part'|'labor'|'software'|'license'|'logistics'|'service'
    description: string
    qty: string
    unitPrice: string
    productId?: string
    stockQty?: number
  }[]>(() => {
    if (repair.quote) return repair.quote.lines.map(l => ({
      type: l.type as any, description: l.description, qty: String(l.qty),
      unitPrice: String(l.unitPrice), productId: l.productId,
    }))
    return [{ type: 'labor', description: 'Labour & Service Charge', qty: '1', unitPrice: '5000' }]
  })

  const outOfStockLines = quoteLines.filter(l => l.type === 'part' && l.productId && (l.stockQty ?? 1) === 0)

  const handleGenerateQuote = (andRequestParts = false) => {
    const lines = quoteLines.map(line => {
      const qty = Number(line.qty) || 1
      const unitPrice = Number(line.unitPrice) || 0
      return { type: line.type, description: line.description, productId: line.productId, qty, unitPrice, subtotal: qty * unitPrice }
    })
    generateRepairQuote(repair.id, lines as any, applyVat)

    if (andRequestParts && outOfStockLines.length > 0) {
      const procItems = outOfStockLines.map(l => ({
        productId: l.productId, productName: l.description, name: l.description,
        qty: Number(l.qty) || 1, estimatedCost: Number(l.unitPrice) || 0,
      }))
      requestProcurement(repair.id, procItems, 'normal', `Parts required for quote on ${repair.ref} — ${repair.productName}`)
      showToast('Quote generated and parts procurement requested', 'success')
    }
    onClose()
  }

  const total = quoteLines.reduce((s, l) => s + (Number(l.qty) || 1) * (Number(l.unitPrice) || 0), 0)
  const vatAmt = applyVat ? Math.round(total * (companySettings.vatRate / 100)) : 0

  return (
    <Modal title={repair.quote ? 'Update Quote' : 'Generate Quote'} subtitle={`Job Ref: ${repair.ref} — ${repair.productName}`} onClose={onClose} width={760} icon={<Fa icon={faFileInvoiceDollar} />} accent="#F59E0B">
      <div className="flex flex-col gap-5">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[120px_1fr_72px_120px_36px] gap-1 px-3 py-2 bg-[var(--bg-muted)] border-b border-[var(--border)]">
            {['Type','Description / Item','Qty','Unit Price (KES)',''].map(h => (
              <span key={h} className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">{h}</span>
            ))}
          </div>

          {/* Lines */}
          <div className="divide-y divide-[var(--border-lt)]">
            {quoteLines.map((line, i) => (
              <div key={i} className="grid grid-cols-[120px_1fr_72px_120px_36px] gap-1 px-3 py-2 items-center" style={{ animation: 'fadeIn 0.18s ease both', animationDelay: `${i * 40}ms` }}>
                <select
                  className="form-input text-[11px] font-bold py-1.5"
                  value={line.type}
                  onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, type: e.target.value as any, productId: undefined, stockQty: undefined } : l))}
                >
                  <option value="part">Part</option>
                  <option value="labor">Labour</option>
                  <option value="software">Software</option>
                  <option value="license">License</option>
                  <option value="logistics">Logistics</option>
                  <option value="service">Service</option>
                </select>

                {line.type === 'part' || line.type === 'service' ? (
                  <ProductPicker
                    value={line.description}
                    productId={line.productId}
                    products={products as any}
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
                  className="form-input text-center font-mono text-[12px]"
                  type="number" min="1"
                  value={line.qty}
                  onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))}
                />
                <input
                  className="form-input text-right font-mono text-[12px]"
                  type="number" min="0"
                  value={line.unitPrice}
                  onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, unitPrice: e.target.value } : l))}
                />
                <button
                  onClick={() => setQuoteLines(prev => prev.filter((_, j) => j !== i))}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-4)] hover:text-red-500 hover:bg-[rgba(239,68,68,0.08)] transition-all"
                >×</button>
              </div>
            ))}
          </div>

          {/* Footer row */}
          <div className="flex items-center justify-between px-3 py-2.5 border-t border-[var(--border)] bg-[var(--bg-card)]">
            <button
              className="text-[10px] font-black flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
              style={{ color: '#D97706', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
              onClick={() => setQuoteLines(prev => [...prev, { type: 'part', description: '', qty: '1', unitPrice: '0' }])}
            >
              + ADD LINE
            </button>
            <div className="flex items-center gap-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded" checked={applyVat} onChange={e => setApplyVat(e.target.checked)} />
                <span className="text-[10px] font-bold text-[var(--text-3)]">VAT {companySettings.vatRate}%</span>
              </label>
              <div className="text-right space-y-0.5">
                {applyVat && (
                  <p className="text-[10px] text-[var(--text-4)] font-medium">Subtotal: KES {total.toLocaleString()} + VAT {vatAmt.toLocaleString()}</p>
                )}
                <p className="text-lg font-black text-[var(--text-1)] font-mono">KES {(total + vatAmt).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Out-of-stock warning */}
        {outOfStockLines.length > 0 && (
          <div className="flex items-start gap-3 p-3.5 rounded-xl border border-red-500/25 bg-[rgba(239,68,68,0.07)]">
            <Fa icon={faExclamationCircle} className="text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black text-red-600 uppercase tracking-wide mb-1">Parts Not In Stock</p>
              <p className="text-[10px] text-[var(--text-2)] leading-relaxed">
                {outOfStockLines.map(l => l.description).join(', ')} {outOfStockLines.length === 1 ? 'is' : 'are'} not currently in stock.
                You can generate the quote and auto-create a procurement request for these parts.
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-3 border-t border-[var(--border-lt)] flex-wrap">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          {outOfStockLines.length > 0 && (
            <ActionBtn onClick={() => handleGenerateQuote(true)} color="linear-gradient(135deg,#DC2626,#EF4444)" shadow="0 8px 24px rgba(239,68,68,0.35)">
              <Fa icon={faBoxOpen} /> Quote + Request Parts
            </ActionBtn>
          )}
          <ActionBtn onClick={() => handleGenerateQuote(false)} color="linear-gradient(135deg,#D97706,#F59E0B)" shadow="0 8px 24px rgba(245,158,11,0.4)">
            <Fa icon={faFileInvoiceDollar} /> {repair.quote ? 'Update & Resend' : 'Generate & Send Quote'}
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
  const { completeRepairQA } = useApp()
  const [qcItems, setQcItems] = useState(repair.qcItems)

  const handleCompleteQA = () => {
    const qaResults = qcItems.map(item => ({ itemId: item.id, passed: item.passed, notes: item.notes }))
    completeRepairQA(repair.id, qaResults)
    onClose()
  }

  const allPassed = qcItems.every(i => i.passed)

  return (
    <Modal title="Quality Assurance" subtitle={repair.ref} onClose={onClose} width={480} icon={<Fa icon={faCheckCircle} />} accent="#10B981">
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
            {qcItems.map(item => (
              <label
                key={item.id}
                className="flex items-center gap-4 p-4 rounded-2xl border cursor-pointer transition-all group"
                style={{
                  background: item.passed ? 'rgba(16,185,129,0.07)' : 'var(--bg-card)',
                  borderColor: item.passed ? 'rgba(16,185,129,0.3)' : 'var(--border)',
                  boxShadow: item.passed ? '0 0 0 3px rgba(16,185,129,0.08)' : 'none',
                }}
              >
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
            ))}
          </div>
        )}

        <div
          className="p-4 rounded-2xl border flex items-start gap-3 transition-all"
          style={{
            background: allPassed ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
            borderColor: allPassed ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)',
          }}
        >
          <Fa icon={allPassed ? faCheckCircle : faExclamationTriangle} style={{ color: allPassed ? '#10B981' : '#F59E0B', marginTop: 2 } as any} />
          <p className="text-[11px] leading-relaxed font-medium" style={{ color: allPassed ? '#065F46' : '#92400E' }}>
            {allPassed
              ? 'Excellent! All tests passed. The device is verified and ready for the customer.'
              : 'Some tests are still pending or failed. Submitting now will flag this for rework.'}
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn
            onClick={handleCompleteQA}
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
 * ScheduleDeliveryModal
 */
export function ScheduleDeliveryModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { riders, scheduleDelivery } = useApp()
  const [deliveryForm, setDeliveryForm] = useState({
    method: 'pickup' as 'pickup' | 'delivery' | 'courier',
    scheduledDate: new Date().toISOString().slice(0, 10),
    address: '',
    riderId: '',
    riderName: ''
  })

  const handleSchedule = () => {
    scheduleDelivery(repair.id, deliveryForm)
    onClose()
  }

  return (
    <Modal title="Schedule Delivery" subtitle={repair.ref} onClose={onClose} width={480} icon={<Fa icon={faTruck} />} accent="#0EA5E9">
      <div className="flex flex-col gap-5">
        <div className="flex p-1 bg-[var(--bg-surface)] rounded-2xl border border-[var(--border)]">
          {(['pickup', 'delivery', 'courier'] as const).map(m => (
            <button
              key={m}
              onClick={() => setDeliveryForm(p => ({ ...p, method: m }))}
              className="flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
              style={{
                background: deliveryForm.method === m ? 'var(--bg-card)' : 'transparent',
                color: deliveryForm.method === m ? '#0284C7' : '#64748B',
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
  const { startRepair, markRepairComplete, createInvoiceFromRepair } = useApp()
  const [notes, setNotes] = useState('')

  const handleAction = () => {
    if (repair.status === 'approved' || (repair.status === 'assigned' && repair.repairPath === 'direct_repair')) {
      startRepair(repair.id)
    } else if (repair.status === 'in_repair') {
      markRepairComplete(repair.id)
    } else if (repair.status === 'ready') {
      createInvoiceFromRepair(repair.id, true)
    }
    onClose()
  }

  const getConfig = () => {
    if (repair.status === 'approved' || (repair.status === 'assigned' && repair.repairPath === 'direct_repair'))
      return { title: 'Start Repair Job',     btn: 'Start Repair',      icon: faPlay,             accent: '#2563EB', grad: 'linear-gradient(135deg,#1D4ED8,#2563EB)', shadow: '0 8px 24px rgba(37,99,235,0.4)' }
    if (repair.status === 'in_repair')
      return { title: 'Mark Repair Complete', btn: 'Complete Repair',   icon: faCheckCircle,      accent: '#059669', grad: 'linear-gradient(135deg,#047857,#059669)', shadow: '0 8px 24px rgba(5,150,105,0.4)' }
    if (repair.status === 'ready')
      return { title: 'Create Invoice',       btn: 'Generate Invoice',  icon: faFileInvoiceDollar, accent: '#D97706', grad: 'linear-gradient(135deg,#B45309,#D97706)', shadow: '0 8px 24px rgba(217,119,6,0.4)'  }
    return   { title: 'Update Progress',      btn: 'Update',            icon: faHistory,           accent: '#475569', grad: 'linear-gradient(135deg,#334155,#475569)', shadow: '0 8px 24px rgba(71,85,105,0.35)' }
  }

  const cfg = getConfig()

  return (
    <Modal title={cfg.title} subtitle={repair.ref} onClose={onClose} width={400} icon={<Fa icon={cfg.icon} />} accent={cfg.accent}>
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
            <p className="text-[10px] text-[var(--text-3)] font-medium mt-0.5">Moving this job to the next stage in the workflow</p>
          </div>
        </div>

        <Field label="Progress Notes (Optional)">
          <Textarea value={notes} onChange={setNotes} placeholder="Any specific notes about this stage..." rows={3} />
        </Field>

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
  const { requestProcurement } = useApp()
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
    <Modal title="Request Procurement" subtitle={repair.ref} onClose={onClose} width={600} icon={<Fa icon={faCartPlus} />} accent="#F97316">
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
  const { returnToCustomer } = useApp()
  const [reason, setReason] = useState('')

  const handleReturn = () => {
    returnToCustomer(repair.id, reason)
    onClose()
  }

  return (
    <Modal title="Return to Customer" subtitle={repair.ref} onClose={onClose} width={400} icon={<Fa icon={faUndo} />} accent="#F59E0B">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <Fa icon={faUndo} style={{ color: '#F59E0B', marginTop: 2, flexShrink: 0 } as any} />
          <p className="text-[11px] font-medium leading-relaxed" style={{ color: '#92400E' }}>
            Returning the device without completing repairs. This will move the job to{' '}
            <strong>Returned</strong> status.
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
  const { updateRepair } = useApp()
  const [reason, setReason] = useState('')

  const handleDecline = () => {
    updateRepair(repair.id, { status: 'declined', notes: (repair.notes || '') + `\n[Declined] Reason: ${reason}` })
    onClose()
  }

  return (
    <Modal title="Decline Quote" subtitle={repair.ref} onClose={onClose} width={400} icon={<Fa icon={faTimesCircle} />} accent="#EF4444">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)' }}>
          <Fa icon={faTimesCircle} style={{ color: '#EF4444', marginTop: 2, flexShrink: 0 } as any} />
          <p className="text-[11px] font-medium leading-relaxed" style={{ color: '#7F1D1D' }}>
            The customer has declined the repair quote. The device will be marked as{' '}
            <strong>Declined</strong>.
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
 * MarkDeliveredConfirm
 */
export function MarkDeliveredConfirm({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { deliverRepair } = useApp()

  const handleConfirm = () => {
    deliverRepair(repair.id)
    onClose()
  }

  return (
    <Modal title="Confirm Delivery" subtitle={repair.ref} onClose={onClose} width={400} icon={<Fa icon={faTruck} />} accent="#10B981">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-4 py-4">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl shadow-lg"
            style={{ background: 'linear-gradient(135deg,#059669,#10B981)', boxShadow: '0 12px 32px rgba(16,185,129,0.4)' }}
          >
            <Fa icon={faTruck} />
          </div>
          <div>
            <p className="text-sm font-black text-[var(--text-1)]">Mark as Delivered?</p>
            <p className="text-xs text-[var(--text-3)] mt-1.5 px-4 leading-relaxed">
              This confirms that the device has been successfully handed over to the customer.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleConfirm} color="linear-gradient(135deg,#059669,#10B981)" shadow="0 8px 24px rgba(16,185,129,0.4)">
            <Fa icon={faTruck} /> Yes, Delivered
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

export function CancelRepairModal({ repair, onClose }: { repair: RepairOrder; onClose: () => void }) {
  const { updateRepairProgress, showToast } = useApp()
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
    <Modal title="Cancel Repair" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center gap-4 py-4">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl shadow-lg"
            style={{ background: 'linear-gradient(135deg,#DC2626,#EF4444)', boxShadow: '0 12px 32px rgba(239,68,68,0.4)' }}
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
  const { deleteRepair, showToast } = useApp()
  const [loading, setLoading] = useState(false)

  function handleDelete() {
    setLoading(true)
    deleteRepair(repair.id)
    showToast(`Repair ${repair.ref} deleted`, 'success')
    onDeleted?.()
    onClose()
  }

  return (
    <Modal title="Delete Repair" onClose={onClose}>
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
          <ActionBtn onClick={handleDelete} color="linear-gradient(135deg,#7C3AED,#9333EA)" shadow="0 8px 24px rgba(124,58,237,0.4)" disabled={loading}>
            <Fa icon={faTrash} /> Delete Permanently
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}

export function OutsourceRepairModal({ repair, onClose }: { repair: RepairOrder; onClose: () => void }) {
  const { outsourceVendors, addOutsourceJob, showToast } = useApp()
  const [form, setForm] = useState({
    vendorId: '',
    serviceType: 'other' as typeof OUTSOURCE_SERVICE_TYPES[number]['value'],
    issueDescription: repair.issueDescription ?? repair.diagnosis?.faultDescription ?? '',
    quotedCost: '',
    notes: '',
  })
  const [loading, setLoading] = useState(false)

  const selectedVendor = outsourceVendors.find(v => v.id === form.vendorId)

  function handleSubmit() {
    if (!form.vendorId) { showToast('Select an outsource vendor', 'error'); return }
    if (!form.issueDescription.trim()) { showToast('Describe the issue to be outsourced', 'error'); return }
    setLoading(true)
    addOutsourceJob({
      vendorId: form.vendorId,
      vendorName: selectedVendor?.name ?? '',
      deviceDescription: `${repair.productName}${repair.serialNumber ? ` — SN ${repair.serialNumber}` : ''}`,
      serial: repair.serialNumber,
      repairOrderId: repair.id,
      serviceType: form.serviceType,
      issueDescription: form.issueDescription,
      sentDate: new Date().toISOString(),
      quotedCost: form.quotedCost ? Number(form.quotedCost) : undefined,
      notes: form.notes || undefined,
    })
    onClose()
  }

  return (
    <Modal title="Outsource Repair" subtitle={`${repair.ref} — ${repair.productName}`} onClose={onClose} width={520} icon={<Fa icon={faExternalLinkSquareAlt} />} accent="#8B5CF6">
      <div className="space-y-4">
        <div className="p-3.5 rounded-xl border border-violet-500/20 bg-[rgba(139,92,246,0.07)]">
          <p className="text-[10px] font-black text-violet-600 uppercase tracking-wide mb-1">Staff Only — Not Visible to Client</p>
          <p className="text-[11px] text-[var(--text-2)] leading-relaxed">
            This will log the job with an external vendor. Directors and the technical lead will be notified automatically.
          </p>
        </div>

        <Field label="Vendor">
          <select
            className="form-input"
            value={form.vendorId}
            onChange={e => setForm(p => ({ ...p, vendorId: e.target.value }))}
          >
            <option value="">— Select vendor —</option>
            {outsourceVendors.map(v => (
              <option key={v.id} value={v.id}>{v.name}{v.phone ? ` · ${v.phone}` : ''}</option>
            ))}
          </select>
          {outsourceVendors.length === 0 && (
            <p className="text-[9px] text-amber-600 mt-1 font-medium">No vendors configured yet. Add them in the Outsource module first.</p>
          )}
        </Field>

        <Field label="Service Type">
          <select
            className="form-input"
            value={form.serviceType}
            onChange={e => setForm(p => ({ ...p, serviceType: e.target.value as any }))}
          >
            {OUTSOURCE_SERVICE_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Issue Description">
          <Textarea
            value={form.issueDescription}
            onChange={v => setForm(p => ({ ...p, issueDescription: v }))}
            placeholder="Describe the fault to communicate to the vendor…"
            rows={3}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quoted Cost (KES) — optional">
            <input
              type="number"
              className="form-input"
              value={form.quotedCost}
              placeholder="0"
              onChange={e => setForm(p => ({ ...p, quotedCost: e.target.value }))}
            />
          </Field>
          <Field label="Internal Notes — optional">
            <input
              className="form-input"
              value={form.notes}
              placeholder="Any notes for the team…"
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            />
          </Field>
        </div>

        <div className="flex gap-2 justify-end pt-3 border-t border-[var(--border-lt)]">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <ActionBtn onClick={handleSubmit} color="linear-gradient(135deg,#7C3AED,#8B5CF6)" shadow="0 8px 24px rgba(139,92,246,0.4)" disabled={loading}>
            <Fa icon={faExternalLinkSquareAlt} /> Send to Vendor
          </ActionBtn>
        </div>
      </div>
    </Modal>
  )
}
