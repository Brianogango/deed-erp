'use client'
// @ts-nocheck

import { Suspense, useState, useMemo } from 'react'
import { useOperationsStore, type Holdover, type HoldoverStatus, type HoldoverPurpose, type HoldoverDeviceCondition } from '@/lib/store'
import { ModuleSkeleton, useMounted, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faLaptop, faPlus } from '@fortawesome/free-solid-svg-icons'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'
import {
  holdoverLoanDays,
  holdoverOverdueDays,
  nairobiDateKey,
  resolveHoldoverStatus,
  storedDateKey,
} from '@/lib/workspace-integrity'

// ── Constants ──────────────────────────────────────────────────────────────────

type DeviceCondition = HoldoverDeviceCondition

const PURPOSE_LABELS: Record<HoldoverPurpose, string> = {
  repair_loaner:    'Repair Loaner',
  exam:             'Exams / Studies',
  purchase_pending: 'Organising Purchase',
  short_term:       'Short-term Use',
  other:            'Other',
}

const CONDITION_LABELS: Record<DeviceCondition, string> = {
  excellent: 'Excellent',
  good:      'Good',
  fair:      'Fair',
  damaged:   'Damaged',
}

const STATUS_CONFIG: Record<HoldoverStatus, { label: string; badgeStatus: string }> = {
  active:   { label: 'Active',   badgeStatus: 'active' },
  overdue:  { label: 'Overdue',  badgeStatus: 'overdue' },
  returned: { label: 'Returned', badgeStatus: 'done' },
}

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

function nextRef(existing: Holdover[]): string {
  const nums = existing
    .map(h => parseInt(h.ref.replace(/^(?:HOLD|LOAN)\//, ''), 10))
    .filter(n => !Number.isNaN(n))
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `HOLD/${String(next).padStart(4, '0')}`
}

function resolveStatus(h: Holdover): HoldoverStatus {
  return resolveHoldoverStatus(h.expectedReturnDate, h.returnedDate)
}

function withResolvedStatus(items: Holdover[]): Holdover[] {
  return items.map(h => ({ ...h, status: resolveStatus(h) }))
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function HoldoverStatusBadge({ status }: { status: HoldoverStatus }) {
  const cfg = STATUS_CONFIG[status]
  return <StatusBadge status={cfg.badgeStatus} label={cfg.label} />
}

function DaysTag({ h }: { h: Holdover }) {
  if (h.returnedDate) {
    const days = holdoverLoanDays(h.issuedDate, h.returnedDate)
    return <span className="text-[11px] text-[var(--text-4)]">{days}d loan</span>
  }

  const loanDays = holdoverLoanDays(h.issuedDate)
  const overdueDays = holdoverOverdueDays(h.expectedReturnDate)
  return (
    <span className={`text-[11px] font-semibold ${overdueDays > 0 ? 'text-red-500' : 'text-[var(--text-3)]'}`}>
      {overdueDays > 0 ? `${overdueDays}d overdue` : `${loanDays}d out`}
    </span>
  )
}

// ── New Holdover Modal ─────────────────────────────────────────────────────────

function NewHoldoverModal({ onClose, onSave }: { onClose: () => void; onSave: (h: Holdover) => void }) {
  const { products, getAvailableSerials, contacts, getVisibleRepairs, users, currentUserId, updateSerial, holdovers } = useOperationsStore()
  const currentUser = users.find(u => u.id === currentUserId)

  const [step, setStep] = useState(1)

  // Step 1
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientIdNo, setClientIdNo] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [showContactDrop, setShowContactDrop] = useState(false)
  const [productId, setProductId] = useState('')
  const [serialId, setSerialId] = useState('')
  const [deviceCondition, setDeviceCondition] = useState<DeviceCondition>('good')
  const [accessories, setAccessories] = useState('')

  // Step 2
  const [purpose, setPurpose] = useState<HoldoverPurpose>('short_term')
  const [purposeNote, setPurposeNote] = useState('')
  const [linkedRepairId, setLinkedRepairId] = useState('')
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [authorizedByUserId, setAuthorizedByUserId] = useState('')
  const [saving, setSaving] = useState(false)

  // Serialised products that have available serials
  const loanableProducts = useMemo(() =>
    products.filter(p => p.requiresSerial && p.isActive && getAvailableSerials(p.id).length > 0),
    [products, getAvailableSerials]
  )

  const availableSerials = useMemo(() =>
    productId ? getAvailableSerials(productId) : [],
    [productId, getAvailableSerials]
  )

  const selectedProduct = products.find(p => p.id === productId)
  const selectedSerial = availableSerials.find(s => s.id === serialId)

  // Contact autocomplete
  const filteredContacts = useMemo(() =>
    contactSearch.length >= 2
      ? contacts.filter(c => c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.phone?.includes(contactSearch)).slice(0, 6)
      : [],
    [contacts, contactSearch]
  )

  const openRepairs = useMemo(() =>
    getVisibleRepairs().filter(r => !['delivered', 'closed', 'cancelled', 'returned', 'retained'].includes(r.status)),
    [getVisibleRepairs]
  )

  const step1Valid = clientName.trim() && clientPhone.trim() && productId && serialId
  const authorizedUser = users.find(u => u.id === authorizedByUserId)
  const step2Valid = expectedReturnDate && authorizedByUserId

  const handleSave = () => {
    if (!step2Valid || !selectedSerial) return
    setSaving(true)

    const h: Holdover = {
      id: uid(),
      ref: nextRef(withResolvedStatus(holdovers || [])),
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientIdNo: clientIdNo.trim(),
      productId,
      productName: selectedProduct?.name ?? '',
      serialId,
      serialNumber: selectedSerial.serial,
      deviceCondition,
      accessories: accessories.trim(),
      purpose,
      purposeNote: purposeNote.trim(),
      linkedRepairId,
      linkedRepairRef: openRepairs.find(r => r.id === linkedRepairId)?.ref ?? '',
      issuedDate: now(),
      expectedReturnDate,
      returnedDate: '',
      returnCondition: '',
      returnNotes: '',
      returnLocation: 'shop',
      status: 'active',
      issuedByName: currentUser?.name ?? 'Staff',
      authorizedByUserId,
      authorizedByName: authorizedUser?.name ?? '',
      createdAt: now(),
    }

    // Save the loan record before changing stock so a failed save cannot orphan an assigned serial.
    onSave(h)
    updateSerial(serialId, { status: 'assigned', location: 'customer' })
    setSaving(false)
    onClose()
  }

  return (
    <div className="holdover-modal-overlay fixed inset-0 z-[9100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div style={{ animation: 'modalIn 0.2s ease both' }}
        className="holdover-modal holdover-modal--issue bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border-lt)] flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-sm font-bold text-[var(--text-1)]">Issue Holdover Device</p>
            <p className="text-[11px] text-[var(--text-4)] mt-0.5">Step {step} of 2 — {step === 1 ? 'Client & Device' : 'Loan Details'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors flex items-center justify-center text-lg cursor-pointer">×</button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-2 px-5 pt-4 flex-shrink-0">
          {[1, 2].map(s => (
            <div key={s} className={`flex-1 h-1 rounded-full transition-all duration-300 ${s <= step ? 'bg-blue-500' : 'bg-[var(--border)]'}`} />
          ))}
        </div>

        <div className="holdover-modal__body flex-1 overflow-y-auto p-5 space-y-4">
          {step === 1 && (
            <>
              {/* Client */}
              <div>
                <p className="text-[11px] font-bold text-[var(--text-4)] uppercase tracking-wider mb-2">Client</p>
                <div className="relative mb-3">
                  <input
                    aria-label="Search contacts"
                    value={contactSearch}
                    onChange={e => { setContactSearch(e.target.value); setShowContactDrop(true) }}
                    onFocus={() => setShowContactDrop(true)}
                    placeholder="Search existing contacts…"
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500"
                  />
                  {showContactDrop && filteredContacts.length > 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 z-10 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden">
                      {filteredContacts.map(c => (
                        <button key={c.id} type="button"
                          onClick={() => {
                            setClientName(c.name)
                            setClientPhone(c.phone || c.mobile || '')
                            setClientIdNo(c.idNumber || '')
                            setContactSearch(c.name)
                            setShowContactDrop(false)
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-surface)] transition-colors border-b border-[var(--border-lt)] last:border-0 cursor-pointer"
                        >
                          <p className="text-sm font-semibold text-[var(--text-1)]">{c.name}</p>
                          <p className="text-[11px] text-[var(--text-4)]">{c.phone}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Full Name *</label>
                    <input aria-label="Client full name" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="John Doe"
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Phone *</label>
                    <input aria-label="Client phone" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="07XX XXX XXX"
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">National ID / Passport</label>
                  <input aria-label="Client national ID or passport" value={clientIdNo} onChange={e => setClientIdNo(e.target.value)} placeholder="12345678"
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              {/* Device */}
              <div>
                <p className="text-[11px] font-bold text-[var(--text-4)] uppercase tracking-wider mb-2">Device to Issue</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Product *</label>
                    <select aria-label="Holdover product" value={productId} onChange={e => { setProductId(e.target.value); setSerialId('') }}
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                      <option value="">-- Select a product --</option>
                      {loanableProducts.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({getAvailableSerials(p.id).length} available)
                        </option>
                      ))}
                    </select>
                    {loanableProducts.length === 0 && (
                      <p className="text-[11px] text-amber-500 mt-1">No serialised devices with available stock.</p>
                    )}
                  </div>

                  {productId && (
                    <div style={{ animation: 'fadeIn 0.18s ease both' }}>
                      <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Serial Number *</label>
                      <select aria-label="Holdover serial number" value={serialId} onChange={e => setSerialId(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                        <option value="">-- Select serial --</option>
                        {availableSerials.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.serial}{s.specs ? ` — ${s.specs}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Condition when given</label>
                      <select aria-label="Device condition when given" value={deviceCondition} onChange={e => setDeviceCondition(e.target.value as DeviceCondition)}
                        className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                        {Object.entries(CONDITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Accessories</label>
                      <input aria-label="Device accessories" value={accessories} onChange={e => setAccessories(e.target.value)} placeholder="Charger, bag…"
                        className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <div style={{ animation: 'fadeIn 0.2s ease both' }} className="space-y-4">
              {/* Summary pill */}
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" stroke="#3B82F6" strokeWidth="2"/><path d="M8 21h8M12 17v4" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-1)]">{selectedProduct?.name}</p>
                  <p className="text-[11px] text-[var(--text-4)]">S/N: {selectedSerial?.serial} · to {clientName}</p>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Purpose *</label>
                <select aria-label="Holdover purpose" value={purpose} onChange={e => setPurpose(e.target.value as HoldoverPurpose)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                  {Object.entries(PURPOSE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {purpose === 'repair_loaner' && (
                <div style={{ animation: 'fadeIn 0.18s ease both' }}>
                  <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Link to Repair Job</label>
                  <select aria-label="Linked repair job" value={linkedRepairId} onChange={e => setLinkedRepairId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                    <option value="">-- No specific job --</option>
                    {openRepairs.map(r => (
                      <option key={r.id} value={r.id}>{r.ref} — {r.customerName} ({r.productName})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Note (optional)</label>
                <input aria-label="Holdover purpose note" value={purposeNote} onChange={e => setPurposeNote(e.target.value)} placeholder="Any additional details…"
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Authorized By *</label>
                <select aria-label="Authorizing staff member" value={authorizedByUserId} onChange={e => setAuthorizedByUserId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                  <option value="">-- Select authorizing staff --</option>
                  {users.filter(u => u.id !== currentUserId).map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role?.replace(/_/g, ' ')})</option>
                  ))}
                  <option value={currentUserId ?? ''}>Myself — {currentUser?.name}</option>
                </select>
                <p className="text-[10px] text-[var(--text-4)] mt-1">The manager or staff member who approved this loan.</p>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Expected Return Date *</label>
                <input type="date" aria-label="Expected return date" value={expectedReturnDate} onChange={e => setExpectedReturnDate(e.target.value)}
                  min={nairobiDateKey()}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="holdover-modal__footer px-5 py-4 border-t border-[var(--border-lt)] flex gap-3 flex-shrink-0">
          {step === 1 ? (
            <>
              <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-2)] text-sm font-semibold hover:bg-[var(--bg-muted)] transition-colors cursor-pointer">Cancel</button>
              <button onClick={() => setStep(2)} disabled={!step1Valid}
                className="flex-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                Continue →
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)} className="px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-2)] text-sm font-semibold hover:bg-[var(--bg-muted)] transition-colors cursor-pointer">← Back</button>
              <button onClick={handleSave} disabled={!step2Valid || saving}
                className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                {saving ? 'Issuing…' : 'Issue Device'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Return Modal ──────────────────────────────────────────────────────────────

function ReturnModal({ holdover, onClose, onReturn }: { holdover: Holdover; onClose: () => void; onReturn: (patch: Partial<Holdover>) => void }) {
  const { updateSerial } = useOperationsStore()
  const [condition, setCondition] = useState<DeviceCondition>('good')
  const [notes, setNotes] = useState('')
  const [returnLocation, setReturnLocation] = useState<'shop' | 'warehouse'>('shop')
  const [saving, setSaving] = useState(false)

  const handleReturn = () => {
    setSaving(true)
    onReturn({
      returnedDate: now(),
      returnCondition: condition,
      returnNotes: notes.trim(),
      returnLocation,
      status: 'returned',
    })
    updateSerial(holdover.serialId, { status: 'available', location: returnLocation })
    setSaving(false)
    onClose()
  }

  return (
    <div className="holdover-modal-overlay fixed inset-0 z-[9200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div style={{ animation: 'confirmIn 0.2s cubic-bezier(0.16,1,0.3,1) both' }}
        className="holdover-modal holdover-modal--return bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl">

        <div className="px-5 py-4 border-b border-[var(--border-lt)] flex items-center justify-between">
          <p className="text-sm font-bold text-[var(--text-1)]">Record Device Return</p>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors flex items-center justify-center text-lg cursor-pointer">×</button>
        </div>

        <div className="holdover-modal__body p-5 space-y-4">
          {/* Device summary */}
          <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-[var(--text-1)]">{holdover.productName}</p>
              <HoldoverStatusBadge status={holdover.status} />
            </div>
            <p className="text-[11px] text-[var(--text-4)]">S/N: {holdover.serialNumber}</p>
            <p className="text-[11px] text-[var(--text-4)]">Issued to: {holdover.clientName} · {holdover.ref}</p>
            {holdover.accessories && <p className="text-[11px] text-[var(--text-4)] mt-0.5">Accessories: {holdover.accessories}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Return Condition</label>
              <select aria-label="Return condition" value={condition} onChange={e => setCondition(e.target.value as DeviceCondition)}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                {Object.entries(CONDITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Return to</label>
              <select aria-label="Return location" value={returnLocation} onChange={e => setReturnLocation(e.target.value as 'shop' | 'warehouse')}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                <option value="shop">Shop Floor</option>
                <option value="warehouse">Warehouse</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Return Notes</label>
            <textarea aria-label="Return notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any damage, missing accessories, etc."
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500 resize-none" />
          </div>

          {condition === 'damaged' && (
            <div style={{ animation: 'fadeIn 0.18s ease both' }}
              className="flex gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#EF4444" strokeWidth="2"/><line x1="12" y1="9" x2="12" y2="13" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/></svg>
              <p className="text-[11px] text-red-400 leading-relaxed">Device returned damaged. Consider creating a repair job after confirming.</p>
            </div>
          )}
        </div>

        <div className="holdover-modal__footer px-5 py-4 border-t border-[var(--border-lt)] flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-2)] text-sm font-semibold hover:bg-[var(--bg-muted)] transition-colors cursor-pointer">Cancel</button>
          <button onClick={handleReturn} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-40 cursor-pointer">
            {saving ? 'Processing…' : '✓ Confirm Return'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail View ───────────────────────────────────────────────────────────────

const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function HoldoverDetail({ holdover, onClose, onReturn }: { holdover: Holdover; onClose: () => void; onReturn: () => void }) {
  const isActive = holdover.status !== 'returned'

  return (
    <div className="holdover-modal-overlay fixed inset-0 z-[9100] flex items-end sm:items-center justify-center p-4 bg-black/55 backdrop-blur-sm">
      <div style={{ animation: 'modalIn 0.2s ease both' }}
        className="holdover-modal holdover-modal--detail bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">

        <div className="px-5 py-4 border-b border-[var(--border-lt)] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <p className="text-sm font-bold text-[var(--text-1)]">{holdover.ref}</p>
            <HoldoverStatusBadge status={holdover.status} />
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors flex items-center justify-center text-lg cursor-pointer">×</button>
        </div>

        <div className="holdover-modal__body flex-1 overflow-y-auto p-5 space-y-4">
          {/* Device card */}
          <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" stroke="#3B82F6" strokeWidth="2"/><path d="M8 21h8M12 17v4" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[var(--text-1)]">{holdover.productName}</p>
                <p className="text-[12px] text-[var(--text-3)] mt-0.5">S/N: <span className="font-mono font-semibold">{holdover.serialNumber}</span></p>
                {holdover.accessories && <p className="text-[12px] text-[var(--text-4)] mt-0.5">With: {holdover.accessories}</p>}
              </div>
              <div className="text-right text-[11px]">
                <p className="text-[var(--text-4)]">Issued in</p>
                <p className="font-bold text-[var(--text-2)]">{CONDITION_LABELS[holdover.deviceCondition]}</p>
              </div>
            </div>
          </div>

          {/* Client & loan info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
              <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider mb-2">Client</p>
              <p className="font-bold text-[var(--text-1)] text-sm">{holdover.clientName}</p>
              <p className="text-[12px] text-[var(--text-3)]">{holdover.clientPhone}</p>
              {holdover.clientIdNo && <p className="text-[11px] text-[var(--text-4)] mt-0.5">ID: {holdover.clientIdNo}</p>}
            </div>
            <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
              <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider mb-2">Purpose</p>
              <p className="font-bold text-[var(--text-1)] text-sm">{PURPOSE_LABELS[holdover.purpose]}</p>
              {holdover.purposeNote && <p className="text-[12px] text-[var(--text-3)] mt-0.5 line-clamp-2">{holdover.purposeNote}</p>}
              {holdover.linkedRepairRef && (
                <p className="text-[11px] text-blue-500 mt-1">Repair: {holdover.linkedRepairRef}</p>
              )}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Issued', value: fmtDate(holdover.issuedDate) },
              { label: 'Expected Return', value: fmtDate(holdover.expectedReturnDate) },
              { label: holdover.returnedDate ? 'Returned' : 'Days Out', value: holdover.returnedDate ? fmtDate(holdover.returnedDate) : <DaysTag h={holdover} /> },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-center">
                <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider mb-1">{label}</p>
                <p className="text-sm font-bold text-[var(--text-1)]">{value}</p>
              </div>
            ))}
          </div>

          {/* Return info (if returned) */}
          {holdover.returnedDate && (
            <div style={{ animation: 'fadeIn 0.2s ease both' }} className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-[11px] font-bold text-emerald-400 mb-1">Return recorded</p>
              <div className="flex gap-4 text-[12px]">
                <span className="text-[var(--text-2)]">Condition: <strong>{CONDITION_LABELS[holdover.returnCondition as DeviceCondition] || '—'}</strong></span>
                <span className="text-[var(--text-2)]">To: <strong>{holdover.returnLocation === 'shop' ? 'Shop floor' : 'Warehouse'}</strong></span>
              </div>
              {holdover.returnNotes && <p className="text-[11px] text-[var(--text-3)] mt-1">{holdover.returnNotes}</p>}
            </div>
          )}

          <div className="flex items-center gap-4 text-[10px] text-[var(--text-4)]">
            <span>Issued by <strong className="text-[var(--text-3)]">{holdover.issuedByName}</strong></span>
            {holdover.authorizedByName && (
              <>
                <span className="w-1 h-1 rounded-full bg-[var(--border)]" />
                <span>Authorized by <strong className="text-[var(--text-3)]">{holdover.authorizedByName}</strong></span>
              </>
            )}
          </div>
        </div>

        <div className="holdover-modal__footer px-5 py-4 border-t border-[var(--border-lt)] flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-2)] text-sm font-semibold hover:bg-[var(--bg-muted)] transition-colors cursor-pointer">Close</button>
          {isActive && (
            <button onClick={onReturn}
              className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors cursor-pointer">
              Record Return
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

function HoldoversContent() {
  const mounted = useMounted()
  const { holdovers, addHoldover, updateHoldover } = useOperationsStore()
  const items = useMemo(() => withResolvedStatus(holdovers || []), [holdovers])

  const [filter, setFilter] = useState<'all' | HoldoverStatus>('all')
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [detailId, setDetailId] = useUrlRecordId()
  const [returning, setReturning] = useState<Holdover | null>(null)
  const detail = detailId ? items.find(h => h.id === detailId) ?? null : null

  // Stats
  const total    = items.length
  const active   = items.filter(h => h.status === 'active').length
  const overdue  = items.filter(h => h.status === 'overdue').length
  const returned = items.filter(h => h.status === 'returned').length
  const todayKey = nairobiDateKey()
  const monthKey = todayKey.slice(0, 7)
  const dueToday = items.filter(h => h.status !== 'returned' && storedDateKey(h.expectedReturnDate) === todayKey).length
  const returnedThisMonth = items.filter(h => h.returnedDate?.slice(0, 7) === monthKey).length
  const returnQueue = items
    .filter(h => h.status !== 'returned')
    .sort((a, b) => new Date(a.expectedReturnDate).getTime() - new Date(b.expectedReturnDate).getTime())
    .slice(0, 6)

  const filtered = useMemo(() => {
    let list = filter === 'all' ? items : items.filter(h => h.status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(h =>
        h.ref.toLowerCase().includes(q) ||
        h.clientName.toLowerCase().includes(q) ||
        h.productName.toLowerCase().includes(q) ||
        h.serialNumber.toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [items, filter, search])

  const holdoverPrimaryFilters: PrimaryFilterConfig[] = [
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All statuses',
      value: filter,
      options: [
        { value: 'all', label: `All statuses (${total})` },
        { value: 'active', label: `Active (${active})` },
        { value: 'overdue', label: `Overdue (${overdue})` },
        { value: 'returned', label: `Returned (${returned})` },
      ],
      onChange: value => setFilter(value as 'all' | HoldoverStatus),
    },
  ]

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page holdovers-workspace">
      <ModuleHeader
        title="Holdovers"
        subtitle="Temporary device loans for repairs and demos"
        icon={<Fa icon={faLaptop} />}
        count={total}
        color="var(--primary)"
        primaryAction={
          <PrimaryActionButton
            icon={<Fa icon={faPlus} />}
            onClick={() => setShowNew(true)}
            hideLabelOnMobile={false}
            aria-label="Issue device"
          >
            Issue device
          </PrimaryActionButton>
        }
      />

      <div className="holdover-kpi-strip" aria-label="Holdover summary">
        {[
          { label: 'Active', value: active, tone: 'blue' },
          { label: 'Due today', value: dueToday, tone: 'navy' },
          { label: 'Overdue', value: overdue, tone: 'amber' },
          { label: 'Returned this month', value: returnedThisMonth, tone: 'green' },
        ].map(stat => (
          <article key={stat.label} className={`holdover-kpi holdover-kpi--${stat.tone}`}>
            <span>{stat.label}</span><strong>{stat.value}</strong>
          </article>
        ))}
      </div>

      <div className="holdover-notice px-3 sm:px-4 pt-2">
        <p className="text-[11px] text-[var(--text-3)] rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2">
          Holdovers track temporary device loans for repairs and demos. They do not post journals, affect stock valuation, or appear on the trial balance.
        </p>
      </div>

      {/* List */}
      <div className="mod-body holdover-body overflow-y-auto custom-scrollbar">
        <div className="holdover-workbench">
        <section className="holdover-table-card" aria-label="Device loans">
          <header className="holdover-card-header"><div><h2>Device loans</h2><p>{filtered.length} of {total} records</p></div></header>
        <DataTable
              tableId="holdovers"
              columns={[
                {
                  key: 'ref', label: 'Ref', priority: 1, width: '100px',
                  render: (h: Holdover) => <span className="font-mono text-[12px] font-bold text-blue-500">{h.ref}</span>,
                  exportValue: (h: Holdover) => h.ref,
                },
                {
                  key: 'client', label: 'Client', priority: 1, width: '1.2fr',
                  render: (h: Holdover) => (
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-1)] erp-truncate" title={h.clientName}>{h.clientName}</p>
                      <p className="text-[11px] text-[var(--text-4)] erp-truncate" title={h.clientPhone}>{h.clientPhone}</p>
                    </div>
                  ),
                  accessor: (h: Holdover) => `${h.clientName} ${h.clientPhone}`,
                  exportValue: (h: Holdover) => h.clientName,
                },
                {
                  key: 'device', label: 'Device / serial', priority: 1, width: '1.2fr',
                  render: (h: Holdover) => (
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-1)] erp-truncate" title={h.productName}>{h.productName}</p>
                      <p className="text-[11px] font-mono text-[var(--text-4)] erp-truncate" title={h.serialNumber}>{h.serialNumber}</p>
                    </div>
                  ),
                  accessor: (h: Holdover) => `${h.productName} ${h.serialNumber}`,
                  exportValue: (h: Holdover) => h.productName,
                },
                {
                  key: 'purpose', label: 'Purpose', priority: 2, width: '120px',
                  render: (h: Holdover) => (
                    <div>
                      <p className="text-[12px] text-[var(--text-2)]">{PURPOSE_LABELS[h.purpose]}</p>
                      {h.linkedRepairRef && <p className="text-[11px] text-blue-500">{h.linkedRepairRef}</p>}
                    </div>
                  ),
                  exportValue: (h: Holdover) => PURPOSE_LABELS[h.purpose],
                },
                {
                  key: 'issued', label: 'Issued', priority: 3, width: '100px',
                  render: (h: Holdover) => <span className="text-[12px] text-[var(--text-3)]">{fmtDate(h.issuedDate)}</span>,
                  exportValue: (h: Holdover) => h.issuedDate,
                },
                {
                  key: 'returnBy', label: 'Return by', priority: 2, width: '100px',
                  render: (h: Holdover) => <span className="text-[12px] text-[var(--text-3)]">{fmtDate(h.expectedReturnDate)}</span>,
                  exportValue: (h: Holdover) => h.expectedReturnDate,
                },
                {
                  key: 'duration', label: 'Duration', priority: 3, width: '90px',
                  render: (h: Holdover) => <DaysTag h={h} />,
                  exportValue: (h: Holdover) => h.status,
                },
                {
                  key: 'status', label: 'Status', priority: 1, width: '90px',
                  render: (h: Holdover) => <HoldoverStatusBadge status={h.status} />,
                  accessor: (h: Holdover) => h.status,
                  exportValue: (h: Holdover) => h.status,
                },
              ] as ColumnDef<Holdover>[]}
              rows={filtered}
              rowKey={h => h.id}
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search holdovers by client, device, serial, or reference..."
              clientSearch={false}
              primaryFilters={holdoverPrimaryFilters}
              onClearFilters={() => { setSearch(''); setFilter('all') }}
              hideColumnFilters
              emptyMessage={search || filter !== 'all' ? 'No matching holdovers' : 'No holdovers yet'}
              emptyAction={!search && filter === 'all' ? (
                <button
                  type="button"
                  onClick={() => setShowNew(true)}
                  className="mt-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wider hover:bg-blue-700 transition-all"
                >
                  + Issue device
                </button>
              ) : undefined}
              onRowClick={h => setDetailId(h.id)}
              rowActions={h => h.status !== 'returned' ? (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setReturning(h) }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-500 text-[11px] font-bold border border-emerald-500/20 transition-colors cursor-pointer whitespace-nowrap"
                >
                  Return
                </button>
              ) : null}
              renderCard={h => (
                <div
                  key={h.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailId(h.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(h.id) } }}
                  className={`rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-3 text-left shadow-sm ${h.status === 'overdue' ? 'ring-1 ring-[var(--danger)]' : h.status === 'returned' ? 'ring-1 ring-emerald-500/40' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-bold text-blue-500">{h.ref}</p>
                      <p className="text-sm font-semibold text-[var(--text-1)] truncate">{h.clientName}</p>
                      <p className="text-[12px] text-[var(--text-3)] truncate" title={h.productName}>{h.productName}</p>
                      <p className="text-[11px] font-mono text-[var(--text-4)]">{h.serialNumber}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <HoldoverStatusBadge status={h.status} />
                      {h.status !== 'returned' && (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setReturning(h) }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold"
                        >
                          Return
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              exportTitle="Holdovers"
              exportFilename="holdovers"
            />
        </section>
        <aside className="holdover-return-queue" aria-label="Return queue">
          <header><div><h2>Return queue</h2><p>Due and overdue devices</p></div><span>{returnQueue.length}</span></header>
          <div className="holdover-return-queue__list">
            {returnQueue.map(h => (
              <article key={h.id} className={h.status === 'overdue' ? 'is-overdue' : ''}>
                <button type="button" className="holdover-return-queue__open" onClick={() => setDetailId(h.id)}>
                  <span><strong>{h.ref}</strong><small>{h.clientName}</small></span><span>›</span>
                </button>
                <p>{fmtDate(h.expectedReturnDate)} <b>· {h.status === 'overdue' ? 'Overdue' : h.expectedReturnDate.slice(0, 10) === todayKey ? 'Due today' : 'Upcoming'}</b></p>
                <p>Responsible: {h.authorizedByName || h.issuedByName}</p>
                <button type="button" onClick={() => setReturning(h)}>Process return</button>
              </article>
            ))}
            {returnQueue.length === 0 && <p className="holdover-return-queue__empty">No devices are awaiting return.</p>}
          </div>
        </aside>
        </div>
      </div>

      {/* Modals */}
      {showNew && (
        <NewHoldoverModal
          onClose={() => setShowNew(false)}
          onSave={h => { addHoldover(h) }}
        />
      )}

      {detail && (
        <HoldoverDetail
          holdover={detail}
          onClose={() => setDetailId(null)}
          onReturn={() => { setReturning(detail); setDetailId(null) }}
        />
      )}

      {returning && (
        <ReturnModal
          holdover={returning}
          onClose={() => setReturning(null)}
          onReturn={patch => { updateHoldover(returning.id, patch); setReturning(null) }}
        />
      )}
    </div>
  )
}

export default function Holdovers() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <HoldoversContent />
    </Suspense>
  )
}
