'use client'
// @ts-nocheck

import { useState, useMemo, useEffect } from 'react'
import { useApp } from '@/lib/store'
import { ModuleSkeleton, useMounted } from '@/components/ui'

// ── Types ──────────────────────────────────────────────────────────────────────

type HoldoverStatus = 'active' | 'returned' | 'overdue'
type HoldoverPurpose = 'repair_loaner' | 'exam' | 'purchase_pending' | 'short_term' | 'other'
type DeviceCondition = 'excellent' | 'good' | 'fair' | 'damaged'

interface Holdover {
  id: string
  ref: string                   // LOAN/0001
  clientName: string
  clientPhone: string
  clientIdNo: string
  productId: string
  productName: string
  serialId: string
  serialNumber: string
  deviceCondition: DeviceCondition
  accessories: string
  purpose: HoldoverPurpose
  purposeNote: string
  linkedRepairId: string
  linkedRepairRef: string
  issuedDate: string
  expectedReturnDate: string
  returnedDate: string
  returnCondition: DeviceCondition | ''
  returnNotes: string
  returnLocation: 'shop' | 'warehouse'
  status: HoldoverStatus
  issuedByName: string
  authorizedByUserId: string
  authorizedByName: string
  createdAt: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

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

const STATUS_CONFIG: Record<HoldoverStatus, { label: string; color: string; bg: string; dot: string }> = {
  active:   { label: 'Active',   color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',  dot: '#3B82F6' },
  overdue:  { label: 'Overdue',  color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   dot: '#EF4444' },
  returned: { label: 'Returned', color: '#10B981', bg: 'rgba(16,185,129,0.12)',  dot: '#10B981' },
}

const STORAGE_KEY = 'deed_holdovers_v1'
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

function nextRef(existing: Holdover[]): string {
  const nums = existing.map(h => parseInt(h.ref.replace('LOAN/', ''), 10)).filter(n => !isNaN(n))
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `LOAN/${String(next).padStart(4, '0')}`
}

function resolveStatus(h: Holdover): HoldoverStatus {
  if (h.returnedDate) return 'returned'
  if (new Date(h.expectedReturnDate) < new Date()) return 'overdue'
  return 'active'
}

// ── Hook ──────────────────────────────────────────────────────────────────────

function useHoldovers() {
  const [items, setItems] = useState<Holdover[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  const add = (h: Holdover) => setItems(p => [h, ...p])
  const update = (id: string, patch: Partial<Holdover>) =>
    setItems(p => p.map(h => h.id === id ? { ...h, ...patch } : h))

  return { items: items.map(h => ({ ...h, status: resolveStatus(h) })), add, update }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: HoldoverStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}30` }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap"
    >
      <span style={{ background: cfg.dot }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
      {cfg.label}
    </span>
  )
}

function DaysTag({ h }: { h: Holdover }) {
  if (h.returnedDate) {
    const issued = new Date(h.issuedDate)
    const returned = new Date(h.returnedDate)
    const days = Math.ceil((returned.getTime() - issued.getTime()) / 86400000)
    return <span className="text-[11px] text-[var(--text-4)]">{days}d loan</span>
  }
  const issued = new Date(h.issuedDate)
  const today = new Date()
  const days = Math.ceil((today.getTime() - issued.getTime()) / 86400000)
  const overdue = new Date(h.expectedReturnDate) < today
  return (
    <span className={`text-[11px] font-semibold ${overdue ? 'text-red-500' : 'text-[var(--text-3)]'}`}>
      {overdue ? `${days}d (overdue)` : `${days}d out`}
    </span>
  )
}

// ── New Holdover Modal ─────────────────────────────────────────────────────────

function NewHoldoverModal({ onClose, onSave }: { onClose: () => void; onSave: (h: Holdover) => void }) {
  const { products, getAvailableSerials, contacts, getVisibleRepairs, users, currentUserId, updateSerial } = useApp()
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
    getVisibleRepairs().filter(r => !['delivered', 'closed', 'cancelled', 'returned'].includes(r.status)),
    [getVisibleRepairs]
  )

  const step1Valid = clientName.trim() && clientPhone.trim() && productId && serialId
  const authorizedUser = users.find(u => u.id === authorizedByUserId)
  const step2Valid = expectedReturnDate && authorizedByUserId

  const handleSave = () => {
    if (!step2Valid || !selectedSerial) return
    setSaving(true)

    const { items } = useHoldoversRef.current
    const h: Holdover = {
      id: uid(),
      ref: nextRef(items),
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
      expectedReturnDate: new Date(expectedReturnDate).toISOString(),
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

    // Mark serial as out on loan
    updateSerial(serialId, { status: 'assigned', location: 'customer' })
    onSave(h)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[9100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div style={{ animation: 'modalIn 0.2s ease both' }}
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

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

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 1 && (
            <>
              {/* Client */}
              <div>
                <p className="text-[11px] font-bold text-[var(--text-4)] uppercase tracking-wider mb-2">Client</p>
                <div className="relative mb-3">
                  <input
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Full Name *</label>
                    <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="John Doe"
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Phone *</label>
                    <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="07XX XXX XXX"
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">National ID / Passport</label>
                  <input value={clientIdNo} onChange={e => setClientIdNo(e.target.value)} placeholder="12345678"
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
                </div>
              </div>

              {/* Device */}
              <div>
                <p className="text-[11px] font-bold text-[var(--text-4)] uppercase tracking-wider mb-2">Device to Issue</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Product *</label>
                    <select value={productId} onChange={e => { setProductId(e.target.value); setSerialId('') }}
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
                      <select value={serialId} onChange={e => setSerialId(e.target.value)}
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

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Condition when given</label>
                      <select value={deviceCondition} onChange={e => setDeviceCondition(e.target.value as DeviceCondition)}
                        className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                        {Object.entries(CONDITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Accessories</label>
                      <input value={accessories} onChange={e => setAccessories(e.target.value)} placeholder="Charger, bag…"
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
                <select value={purpose} onChange={e => setPurpose(e.target.value as HoldoverPurpose)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                  {Object.entries(PURPOSE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {purpose === 'repair_loaner' && (
                <div style={{ animation: 'fadeIn 0.18s ease both' }}>
                  <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Link to Repair Job</label>
                  <select value={linkedRepairId} onChange={e => setLinkedRepairId(e.target.value)}
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
                <input value={purposeNote} onChange={e => setPurposeNote(e.target.value)} placeholder="Any additional details…"
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Authorized By *</label>
                <select value={authorizedByUserId} onChange={e => setAuthorizedByUserId(e.target.value)}
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
                <input type="date" value={expectedReturnDate} onChange={e => setExpectedReturnDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--border-lt)] flex gap-3 flex-shrink-0">
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

// Ref trick to access hook state inside callback
const useHoldoversRef = { current: { items: [] as Holdover[] } }

// ── Return Modal ──────────────────────────────────────────────────────────────

function ReturnModal({ holdover, onClose, onReturn }: { holdover: Holdover; onClose: () => void; onReturn: (patch: Partial<Holdover>) => void }) {
  const { updateSerial } = useApp()
  const [condition, setCondition] = useState<DeviceCondition>('good')
  const [notes, setNotes] = useState('')
  const [returnLocation, setReturnLocation] = useState<'shop' | 'warehouse'>('shop')
  const [saving, setSaving] = useState(false)

  const handleReturn = () => {
    setSaving(true)
    updateSerial(holdover.serialId, { status: 'available', location: returnLocation })
    onReturn({
      returnedDate: now(),
      returnCondition: condition,
      returnNotes: notes.trim(),
      returnLocation,
      status: 'returned',
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[9200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div style={{ animation: 'confirmIn 0.2s cubic-bezier(0.34,1.4,0.64,1) both' }}
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-2xl">

        <div className="px-5 py-4 border-b border-[var(--border-lt)] flex items-center justify-between">
          <p className="text-sm font-bold text-[var(--text-1)]">Record Device Return</p>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors flex items-center justify-center text-lg cursor-pointer">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Device summary */}
          <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-[var(--text-1)]">{holdover.productName}</p>
              <StatusBadge status={holdover.status} />
            </div>
            <p className="text-[11px] text-[var(--text-4)]">S/N: {holdover.serialNumber}</p>
            <p className="text-[11px] text-[var(--text-4)]">Issued to: {holdover.clientName} · {holdover.ref}</p>
            {holdover.accessories && <p className="text-[11px] text-[var(--text-4)] mt-0.5">Accessories: {holdover.accessories}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Return Condition</label>
              <select value={condition} onChange={e => setCondition(e.target.value as DeviceCondition)}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                {Object.entries(CONDITION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Return to</label>
              <select value={returnLocation} onChange={e => setReturnLocation(e.target.value as 'shop' | 'warehouse')}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                <option value="shop">Shop Floor</option>
                <option value="warehouse">Warehouse</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[var(--text-3)] block mb-1">Return Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any damage, missing accessories, etc."
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

        <div className="px-5 py-4 border-t border-[var(--border-lt)] flex gap-3">
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

function HoldoverDetail({ holdover, onClose, onReturn }: { holdover: Holdover; onClose: () => void; onReturn: () => void }) {
  const fmt = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const isActive = holdover.status !== 'returned'

  return (
    <div className="fixed inset-0 z-[9100] flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
      <div style={{ animation: 'modalIn 0.2s ease both' }}
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">

        <div className="px-5 py-4 border-b border-[var(--border-lt)] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <p className="text-sm font-bold text-[var(--text-1)]">{holdover.ref}</p>
            <StatusBadge status={holdover.status} />
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors flex items-center justify-center text-lg cursor-pointer">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
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
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Issued', value: fmt(holdover.issuedDate) },
              { label: 'Expected Return', value: fmt(holdover.expectedReturnDate) },
              { label: holdover.returnedDate ? 'Returned' : 'Days Out', value: holdover.returnedDate ? fmt(holdover.returnedDate) : <DaysTag h={holdover} /> },
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

        <div className="px-5 py-4 border-t border-[var(--border-lt)] flex gap-3 flex-shrink-0">
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

export default function Holdovers() {
  const mounted = useMounted()
  const { items, add, update } = useHoldovers()
  useHoldoversRef.current = { items }

  const [filter, setFilter] = useState<'all' | HoldoverStatus>('all')
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState<Holdover | null>(null)
  const [returning, setReturning] = useState<Holdover | null>(null)

  // Stats
  const total    = items.length
  const active   = items.filter(h => h.status === 'active').length
  const overdue  = items.filter(h => h.status === 'overdue').length
  const returned = items.filter(h => h.status === 'returned').length

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
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [items, filter, search])

  const fmt = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="flex flex-col h-full bg-[var(--bg-page)] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-[var(--border-lt)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-[var(--text-1)] tracking-tight">Holdovers</h2>
            <p className="text-[12px] text-[var(--text-4)] mt-0.5">Device loans & temporary issue log</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-all active:scale-95 shadow-lg shadow-blue-900/30 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
            Issue Device
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          {[
            { label: 'Total', value: total, color: 'text-[var(--text-1)]', bg: 'bg-[var(--bg-surface)]' },
            { label: 'Active', value: active, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            { label: 'Overdue', value: overdue, color: 'text-red-500', bg: 'bg-red-500/10' },
            { label: 'Returned', value: returned, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 border border-[var(--border)]`}>
              <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-[11px] font-semibold text-[var(--text-4)] mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-lt)] flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none flex-shrink-0">
          {(['all', 'active', 'overdue', 'returned'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer capitalize ${
                filter === f
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-[var(--bg-surface)] text-[var(--text-3)] border border-[var(--border)] hover:text-[var(--text-1)]'
              }`}
            >
              {f === 'all' ? `All (${total})` : f === 'active' ? `Active (${active})` : f === 'overdue' ? `Overdue (${overdue})` : `Returned (${returned})`}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-4)' }}>
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by client, device, serial, ref…"
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-1)] text-sm placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500" />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-center mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" stroke="var(--text-4)" strokeWidth="1.5"/><path d="M8 21h8M12 17v4" stroke="var(--text-4)" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </div>
            <p className="text-sm font-bold text-[var(--text-1)]">{search ? 'No results found' : 'No holdovers yet'}</p>
            <p className="text-xs text-[var(--text-3)] mt-1">{search ? 'Try a different search term' : 'Issue a device to start tracking loans'}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-lt)]">
                    {['Ref', 'Client', 'Device / Serial', 'Purpose', 'Issued', 'Return By', 'Duration', 'Status', ''].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {filtered.map((h, i) => (
                    <tr key={h.id} onClick={() => setDetail(h)}
                      style={{ animation: `cardUp 0.25s ease both`, animationDelay: `${i * 30}ms` }}
                      className="hover:bg-[var(--bg-surface)] cursor-pointer transition-colors group">
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-[12px] font-bold text-blue-500">{h.ref}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-[var(--text-1)]">{h.clientName}</p>
                        <p className="text-[11px] text-[var(--text-4)]">{h.clientPhone}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-[var(--text-1)]">{h.productName}</p>
                        <p className="text-[11px] font-mono text-[var(--text-4)]">{h.serialNumber}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-[12px] text-[var(--text-2)]">{PURPOSE_LABELS[h.purpose]}</p>
                        {h.linkedRepairRef && <p className="text-[11px] text-blue-500">{h.linkedRepairRef}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-[12px] text-[var(--text-3)]">{fmt(h.issuedDate)}</td>
                      <td className="px-5 py-3.5 text-[12px] text-[var(--text-3)]">{fmt(h.expectedReturnDate)}</td>
                      <td className="px-5 py-3.5"><DaysTag h={h} /></td>
                      <td className="px-5 py-3.5"><StatusBadge status={h.status} /></td>
                      <td className="px-5 py-3.5">
                        {h.status !== 'returned' && (
                          <button
                            onClick={e => { e.stopPropagation(); setReturning(h) }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-500 text-[11px] font-bold border border-emerald-500/20 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                          >
                            Return
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden p-4 space-y-3">
              {filtered.map((h, i) => (
                <div key={h.id} onClick={() => setDetail(h)}
                  style={{ animation: `cardUp 0.25s ease both`, animationDelay: `${i * 40}ms` }}
                  className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 cursor-pointer active:scale-[0.98] transition-transform">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <span className="font-mono text-[12px] font-bold text-blue-500">{h.ref}</span>
                      <p className="font-bold text-[var(--text-1)] mt-0.5">{h.clientName}</p>
                      <p className="text-[11px] text-[var(--text-4)]">{h.clientPhone}</p>
                    </div>
                    <StatusBadge status={h.status} />
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] mb-3">
                    <p className="text-sm font-semibold text-[var(--text-1)]">{h.productName}</p>
                    <p className="text-[11px] font-mono text-[var(--text-4)]">{h.serialNumber}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-[var(--text-3)]">
                      <span>Due: {fmt(h.expectedReturnDate)}</span>
                      <span className="mx-1.5">·</span>
                      <DaysTag h={h} />
                    </div>
                    {h.status !== 'returned' && (
                      <button
                        onClick={e => { e.stopPropagation(); setReturning(h) }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                      >
                        Return
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {showNew && (
        <NewHoldoverModal
          onClose={() => setShowNew(false)}
          onSave={h => { add(h) }}
        />
      )}

      {detail && (
        <HoldoverDetail
          holdover={detail}
          onClose={() => setDetail(null)}
          onReturn={() => { setReturning(detail); setDetail(null) }}
        />
      )}

      {returning && (
        <ReturnModal
          holdover={returning}
          onClose={() => setReturning(null)}
          onReturn={patch => { update(returning.id, patch); setReturning(null) }}
        />
      )}
    </div>
  )
}
