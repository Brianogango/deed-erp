// @ts-nocheck
'use client'

import { useState, useMemo } from 'react'
import { useApp, fmtKes } from '@/lib/store'
import type { DepositStatus, DepositItem, DepositPayment, Deposit } from '@/lib/store'
import { Confirm, ModuleSkeleton, useMounted } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'

// ── Helpers ────────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<DepositStatus, { label: string; color: string; bg: string; dot: string }> = {
  active:         { label: 'Active',        color: '#3B82F6', bg: 'rgba(59,130,246,0.1)',  dot: '#3B82F6' },
  partially_paid: { label: 'Part Paid',     color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',  dot: '#F59E0B' },
  fully_paid:     { label: 'Fully Paid',    color: '#10B981', bg: 'rgba(16,185,129,0.1)',  dot: '#10B981' },
  completed:      { label: 'Completed',     color: '#6366F1', bg: 'rgba(99,102,241,0.1)',  dot: '#6366F1' },
  cancelled:      { label: 'Cancelled',     color: '#EF4444', bg: 'rgba(239,68,68,0.1)',   dot: '#EF4444' },
}

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'mpesa',         label: 'M-Pesa' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'card',          label: 'Card' },
]

function StatusBadge({ status }: { status: DepositStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}
    >
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  )
}

function ProgressBar({ paid, total }: { paid: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0
  const color = pct >= 100 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#3B82F6'
  return (
    <div className="w-full h-1.5 bg-[var(--bg-muted)] rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

// ── New Deposit Modal ──────────────────────────────────────────────────────────
function NewDepositModal({ onClose, onSave }: { onClose: () => void; onSave: (d: Deposit) => void }) {
  const { contacts, products, createDeposit, showToast } = useApp()
  const customers = useMemo(() => (contacts || []).filter(c => c.isCustomer), [contacts])

  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState(1)
  const [customerId, setCustomerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DepositItem[]>([])
  const [initialPayment, setInitialPayment] = useState('')
  const [payMethod, setPayMethod] = useState<DepositPayment['method']>('cash')
  const [payRef, setPayRef] = useState('')

  const customer = customers.find(c => c.id === customerId)
  const totalValue = items.reduce((s, i) => s + i.total, 0)
  const deposit = Number(initialPayment) || 0

  const addItem = () => setItems(p => [...p, { productId: '', productName: '', sku: '', qty: 1, unitPrice: 0, total: 0 }])
  const removeItem = (idx: number) => setItems(p => p.filter((_, i) => i !== idx))
  const updateItem = (idx: number, field: string, value: any) => setItems(p => p.map((item, i) => {
    if (i !== idx) return item
    const updated = { ...item, [field]: value }
    if (field === 'productId') {
      const prod = (products || []).find(p => p.id === value)
      if (prod) {
        updated.productName = prod.name
        updated.sku = prod.sku || prod.code || ''
        updated.unitPrice = prod.salePrice || 0
        updated.total = (prod.salePrice || 0) * updated.qty
      }
    }
    if (field === 'qty' || field === 'unitPrice') updated.total = (updated.qty || 0) * (updated.unitPrice || 0)
    return updated
  }))

  const handleSave = () => {
    if (!customer || items.length === 0 || deposit <= 0 || saving) return
    if (deposit > totalValue) { showToast(`Initial payment (${fmtKes(deposit)}) cannot exceed total value (${fmtKes(totalValue)})`, 'error'); return }
    setSaving(true)
    try {
      const created = createDeposit({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        items,
        totalValue,
        dueDate: dueDate || undefined,
        notes: notes || undefined,
        initialPayment: deposit,
        payMethod,
        payRef: payRef || undefined,
      })
      onSave(created)
      onClose()
    } catch {
      showToast('Failed to save deposit. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9000] flex h-dvh items-start sm:items-center justify-center overflow-y-auto overscroll-contain p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative my-0 sm:my-auto w-full max-w-2xl bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border)] flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 32px)', animation: 'modalIn 0.22s cubic-bezier(0.34,1.4,0.64,1) both' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-gradient-to-r from-blue-600 to-indigo-600 shrink-0">
          <div>
            <h2 className="text-sm font-black text-white uppercase tracking-wider">New Deposit / Layby</h2>
            <p className="text-[10px] text-blue-200 mt-0.5">Reserve products with an upfront payment</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg transition-all">×</button>
        </div>

        {/* Step indicator */}
        <div className="flex px-5 pt-4 pb-3 gap-2 shrink-0">
          {['Customer & Items', 'Initial Payment'].map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black transition-all ${step > i + 1 ? 'bg-emerald-500 text-white' : step === i + 1 ? 'bg-blue-600 text-white' : 'bg-[var(--bg-surface)] text-[var(--text-4)] border border-[var(--border)]'}`}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <span className={`text-[11px] font-bold truncate ${step === i + 1 ? 'text-[var(--text-1)]' : 'text-[var(--text-4)]'}`}>{label}</span>
              {i < 1 && <div className="flex-1 h-px bg-[var(--border)]" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3 space-y-4">
          {step === 1 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Customer *</label>
                  <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="form-input w-full text-xs">
                    <option value="">— Select customer —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Pickup By (optional)</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="form-input w-full text-xs" />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest">Items *</label>
                  <button onClick={addItem} className="text-[10px] font-black text-blue-600 hover:text-blue-700 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 transition-all">+ Add Item</button>
                </div>
                {items.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed border-[var(--border)] gap-2">
                    <span className="text-2xl">📦</span>
                    <p className="text-[11px] text-[var(--text-4)]">No items yet — add products to reserve</p>
                  </div>
                )}
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] items-end">
                      <div className="col-span-5">
                        <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Product</p>
                        <select value={item.productId} onChange={e => updateItem(idx, 'productId', e.target.value)} className="form-input text-xs w-full">
                          <option value="">— Select —</option>
                          {(products || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Qty</p>
                        <input type="number" min={1} value={item.qty} onChange={e => updateItem(idx, 'qty', Number(e.target.value))} className="form-input text-xs w-full text-center" />
                      </div>
                      <div className="col-span-3">
                        <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Unit Price</p>
                        <input type="number" value={item.unitPrice} onChange={e => updateItem(idx, 'unitPrice', Number(e.target.value))} className="form-input text-xs w-full text-right" />
                      </div>
                      <div className="col-span-2 flex items-center justify-between">
                        <span className="text-[11px] font-black text-[var(--text-1)] font-mono">{fmtKes(item.total)}</span>
                        <button onClick={() => removeItem(idx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-4)] hover:text-red-600 hover:bg-red-50 transition-all text-lg">×</button>
                      </div>
                    </div>
                  ))}
                </div>
                {items.length > 0 && (
                  <div className="flex justify-end mt-2 pr-1">
                    <span className="text-[11px] font-black text-[var(--text-2)]">Total: <span className="text-blue-600 font-mono">{fmtKes(totalValue)}</span></span>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="form-input w-full text-xs resize-none" placeholder="Any special instructions..." />
              </div>
            </>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Layby Total</span>
                </div>
                <p className="text-2xl font-black text-slate-900">{fmtKes(totalValue)}</p>
                <p className="text-[11px] text-blue-700 mt-1">{customer?.name} · {items.length} item{items.length !== 1 ? 's' : ''}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Deposit Amount (KSh) *</label>
                  <input
                    type="number" value={initialPayment} onChange={e => setInitialPayment(e.target.value)}
                    placeholder="0" className="form-input w-full text-xs font-mono text-right"
                  />
                  {deposit > 0 && <p className="text-[10px] text-emerald-600 mt-1 font-bold">Balance: {fmtKes(totalValue - deposit)}</p>}
                </div>
                <div>
                  <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Payment Method</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value as any)} className="form-input w-full text-xs">
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Payment Reference (optional)</label>
                <input type="text" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="M-Pesa code, receipt no..." className="form-input w-full text-xs" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--border)] bg-[var(--bg-surface)]/50 flex gap-2 justify-between shrink-0">
          {step === 2
            ? <button onClick={() => setStep(1)} className="btn-outline min-w-[100px] text-xs">← Back</button>
            : <button onClick={onClose} className="btn-outline min-w-[100px] text-xs">Cancel</button>
          }
          {step === 1 ? (
            <button
              disabled={!customerId || items.length === 0 || items.some(i => !i.productId)}
              onClick={() => setStep(2)}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40 disabled:pointer-events-none shadow-lg shadow-blue-200"
            >
              Next →
            </button>
          ) : (
            <button
              disabled={!deposit || deposit <= 0 || saving}
              onClick={handleSave}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40 disabled:pointer-events-none shadow-lg"
              style={{ background: 'linear-gradient(135deg,var(--primary),#4F46E5)', boxShadow: '0 8px 24px rgba(79,70,229,0.4)' }}
            >
              {saving ? '...' : '✓ Create Deposit'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Add Payment Modal ──────────────────────────────────────────────────────────
function AddPaymentModal({ deposit, onClose, onSave }: { deposit: Deposit; onClose: () => void; onSave: () => void }) {
  const { users, currentUserId, addDepositPayment, showToast } = useApp()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<DepositPayment['method']>('cash')
  const [ref, setRef] = useState('')
  const [saving, setSaving] = useState(false)

  const maxAmount = deposit.balance
  const paying = Math.min(Number(amount) || 0, maxAmount)
  const newBalance = maxAmount - paying

  const handleSave = () => {
    if (!paying || saving) return
    setSaving(true)
    try {
      const user = users.find(u => u.id === currentUserId)
      addDepositPayment(deposit.id, {
        date: new Date().toISOString(),
        amount: paying,
        method,
        ref: ref || undefined,
        recordedBy: user?.name || 'System',
      })
      onSave()
      onClose()
    } catch {
      showToast('Failed to record payment. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9050] flex h-dvh items-center justify-center overflow-y-auto overscroll-contain p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border)] overflow-hidden" style={{ animation: 'confirmIn 0.18s cubic-bezier(0.34,1.4,0.64,1) both' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-[13px] font-black text-[var(--text-1)]">Record Payment</h3>
            <p className="text-[10px] text-[var(--text-4)] mt-0.5">{deposit.ref} · Balance: {fmtKes(deposit.balance)}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-4)] hover:text-[var(--text-1)] text-xl transition-colors">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Amount (KSh) *</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Max ${fmtKes(maxAmount)}`} max={maxAmount} className="form-input w-full text-xs font-mono text-right" />
          </div>
          <div>
            <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value as any)} className="form-input w-full text-xs">
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest block mb-1.5">Reference</label>
            <input type="text" value={ref} onChange={e => setRef(e.target.value)} placeholder="M-Pesa code / receipt..." className="form-input w-full text-xs" />
          </div>
          {paying > 0 && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">After this payment</p>
              <p className="text-[13px] font-black text-emerald-800 mt-1">Balance: {fmtKes(newBalance)}</p>
              {newBalance <= 0 && <p className="text-[10px] text-emerald-600 font-bold mt-0.5">✓ Fully paid — ready for collection</p>}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border)] flex gap-2">
          <button onClick={onClose} className="btn-outline flex-1 text-xs">Cancel</button>
          <button
            disabled={!paying || saving}
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl text-white text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-200"
          >
            {saving ? '...' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail View ────────────────────────────────────────────────────────────────
function DepositDetail({ deposit, onBack, onAddPayment, onComplete, onCancel }: {
  deposit: Deposit
  onBack: () => void
  onAddPayment: (d: Deposit) => void
  onComplete: (d: Deposit) => void
  onCancel: (d: Deposit) => void
}) {
  const cfg = STATUS_CONFIG[deposit.status]
  const pct = deposit.totalValue > 0 ? Math.min(100, (deposit.totalPaid / deposit.totalValue) * 100) : 0

  return (
    <div className="flex flex-col h-full bg-[var(--bg-page)]" style={{ animation: 'fadeIn 0.3s ease both' }}>
      {/* Header */}
      <header className="bg-[var(--bg-card)] border-b border-[var(--border)] px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={onBack} className="w-9 h-9 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] text-[var(--text-2)] flex items-center justify-center transition-all shrink-0">
            ←
          </button>
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            <span className="text-lg font-black text-[var(--text-1)] font-mono">{deposit.ref}</span>
            <StatusBadge status={deposit.status} />
            <span className="text-[var(--text-4)] hidden sm:inline">·</span>
            <span className="hidden sm:inline text-[13px] font-bold text-[var(--text-2)]">{deposit.customerName}</span>
          </div>
          <div className="flex gap-2 shrink-0">
            {['active', 'partially_paid'].includes(deposit.status) && (
              <button onClick={() => onAddPayment(deposit)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider transition-all shadow-lg shadow-emerald-100">
                + Payment
              </button>
            )}
            {deposit.status === 'fully_paid' && (
              <button onClick={() => onComplete(deposit)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-100">
                ✓ Mark Collected
              </button>
            )}
            {!['completed', 'cancelled'].includes(deposit.status) && (
              <button onClick={() => onCancel(deposit)} className="px-3 py-2 rounded-xl border-2 border-red-200 text-red-600 text-[10px] font-black uppercase tracking-wider hover:bg-red-50 transition-all">
                Cancel
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Left: main info */}
          <div className="lg:col-span-2 space-y-4">

            {/* Progress card */}
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5" style={{ animation: 'cardUp 0.4s ease both' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Payment Progress</p>
                  <p className="text-2xl font-black text-[var(--text-1)] font-mono">{fmtKes(deposit.totalPaid)}<span className="text-[14px] text-[var(--text-4)] font-semibold"> / {fmtKes(deposit.totalValue)}</span></p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest mb-1">Balance</p>
                  <p className={`text-xl font-black font-mono ${deposit.balance <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtKes(deposit.balance)}</p>
                </div>
              </div>
              <ProgressBar paid={deposit.totalPaid} total={deposit.totalValue} />
              <p className="text-[10px] text-[var(--text-4)] mt-2 text-right">{Math.round(pct)}% paid</p>
            </div>

            {/* Items */}
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden" style={{ animation: 'cardUp 0.5s ease both' }}>
              <div className="px-4 py-3 border-b border-[var(--border-lt)] flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center text-sm">📦</div>
                <div>
                  <p className="text-[11px] font-black text-[var(--text-1)] uppercase tracking-wider">Reserved Items</p>
                  <p className="text-[9px] text-[var(--text-4)]">{deposit.items.length} item{deposit.items.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <table className="w-full text-left">
                <thead className="bg-[var(--bg-surface)] border-b border-[var(--border)]">
                  <tr>
                    {['Product', 'Qty', 'Unit Price', 'Total'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {deposit.items.map((item, i) => (
                    <tr key={i} className="hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-[12px] font-bold text-[var(--text-1)]">{item.productName}</p>
                        {item.sku && <p className="text-[9px] text-[var(--text-4)] font-mono">{item.sku}</p>}
                      </td>
                      <td className="px-4 py-3 text-[12px] font-bold text-[var(--text-2)]">{item.qty}</td>
                      <td className="px-4 py-3 text-[12px] font-mono text-[var(--text-2)]">{fmtKes(item.unitPrice)}</td>
                      <td className="px-4 py-3 text-[12px] font-mono font-black text-[var(--text-1)]">{fmtKes(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[var(--bg-surface)] border-t border-[var(--border)]">
                  <tr>
                    <td colSpan={3} className="px-4 py-2.5 text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">Total Value</td>
                    <td className="px-4 py-2.5 text-[13px] font-black text-[var(--text-1)] font-mono">{fmtKes(deposit.totalValue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Payment history */}
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden" style={{ animation: 'cardUp 0.6s ease both' }}>
              <div className="px-4 py-3 border-b border-[var(--border-lt)] flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-sm">💳</div>
                <div>
                  <p className="text-[11px] font-black text-[var(--text-1)] uppercase tracking-wider">Payment History</p>
                  <p className="text-[9px] text-[var(--text-4)]">{deposit.payments.length} transaction{deposit.payments.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              {deposit.payments.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-4)] text-[12px]">No payments recorded yet</div>
              ) : (
                <div className="divide-y divide-[var(--border-lt)]">
                  {deposit.payments.map((pay, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-sm">💰</div>
                        <div>
                          <p className="text-[11px] font-bold text-[var(--text-1)]">{PAYMENT_METHODS.find(m => m.value === pay.method)?.label}</p>
                          <p className="text-[9px] text-[var(--text-4)]">{new Date(pay.date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })} · {pay.recordedBy}</p>
                          {pay.ref && <p className="text-[9px] text-blue-600 font-mono">{pay.ref}</p>}
                        </div>
                      </div>
                      <span className="text-[13px] font-black text-emerald-600 font-mono">{fmtKes(pay.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: meta */}
          <div className="space-y-4">
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4" style={{ animation: 'cardUp 0.45s ease both' }}>
              <p className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest mb-3">Details</p>
              <div className="space-y-3">
                {[
                  { label: 'Customer', value: deposit.customerName },
                  { label: 'Phone', value: deposit.customerPhone },
                  { label: 'Created', value: new Date(deposit.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) },
                  { label: 'Created By', value: deposit.createdBy },
                  ...(deposit.dueDate ? [{ label: 'Pickup By', value: new Date(deposit.dueDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) }] : []),
                  ...(deposit.completedAt ? [{ label: 'Collected', value: new Date(deposit.completedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) }] : []),
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">{label}</p>
                    <p className="text-[12px] font-semibold text-[var(--text-1)] mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>
            {deposit.notes && (
              <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4" style={{ animation: 'cardUp 0.55s ease both' }}>
                <p className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest mb-2">Notes</p>
                <p className="text-[12px] text-[var(--text-2)] leading-relaxed">{deposit.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Module ────────────────────────────────────────────────────────────────
export default function Deposits() {
  const mounted = useMounted()
  const { showToast, deposits, completeDeposit, cancelDeposit } = useApp()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DepositStatus | 'all'>('all')
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [addPaymentFor, setAddPaymentFor] = useState<Deposit | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)

  const activeDeposit = deposits.find(d => d.id === activeId)

  const filtered = useMemo(() => {
    let list = deposits
    if (statusFilter !== 'all') list = list.filter(d => d.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        d.ref.toLowerCase().includes(q) ||
        d.customerName.toLowerCase().includes(q) ||
        d.customerPhone.toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [deposits, statusFilter, search])

  const stats = useMemo(() => ({
    total: deposits.length,
    active: deposits.filter(d => ['active', 'partially_paid'].includes(d.status)).length,
    fullyPaid: deposits.filter(d => d.status === 'fully_paid').length,
    totalValue: deposits.reduce((s, d) => s + d.totalValue, 0),
  }), [deposits])

  const handleSaveDeposit = (d: Deposit) => {
    showToast(`Deposit ${d.ref} created for ${d.customerName}`, 'success')
  }

  const handleComplete = (dep: Deposit) => {
    completeDeposit(dep.id)
  }

  const handleCancel = (dep: Deposit) => {
    setPendingConfirm({
      msg: `Cancel deposit ${dep.ref}? This cannot be undone.`,
      action: () => {
        cancelDeposit(dep.id, 'User requested cancellation')
        if (activeId === dep.id) { setView('list'); setActiveId(null) }
      },
    })
  }

  const depositColumns: ColumnDef<Deposit>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '100px',
      render: dep => <span className="text-[11px] font-black text-blue-600 font-mono">{dep.ref}</span>,
    },
    {
      key: 'customer', label: 'Customer', priority: 1, width: '1.2fr',
      render: dep => (
        <div>
          <p className="text-[12px] font-bold text-[var(--text-1)]">{dep.customerName}</p>
          <p className="text-[10px] text-[var(--text-4)]">{dep.customerPhone}</p>
        </div>
      ),
      exportValue: dep => dep.customerName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '120px',
      render: dep => <StatusBadge status={dep.status} />,
      exportValue: dep => STATUS_CONFIG[dep.status].label,
    },
    {
      key: 'balance', label: 'Balance', priority: 1, width: '130px',
      render: dep => (
        <div>
          <p className={`text-[12px] font-mono font-black ${dep.balance <= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtKes(dep.balance)}</p>
          <ProgressBar paid={dep.totalPaid} total={dep.totalValue} />
        </div>
      ),
      exportValue: dep => dep.balance,
    },
    {
      key: 'items', label: 'Items', priority: 2, width: '90px',
      render: dep => `${dep.items.length} item${dep.items.length !== 1 ? 's' : ''}`,
      exportValue: dep => dep.items.length,
    },
    {
      key: 'total', label: 'Total', priority: 2, width: '110px', align: 'right',
      render: dep => <span className="font-mono font-black text-[var(--text-1)]">{fmtKes(dep.totalValue)}</span>,
      exportValue: dep => dep.totalValue,
    },
    {
      key: 'paid', label: 'Paid', priority: 2, width: '110px', align: 'right',
      render: dep => <span className="font-mono text-emerald-600">{fmtKes(dep.totalPaid)}</span>,
      exportValue: dep => dep.totalPaid,
    },
    {
      key: 'dueDate', label: 'Due Date', priority: 3, width: '100px',
      render: dep => dep.dueDate ? new Date(dep.dueDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '—',
      exportValue: dep => dep.dueDate ?? '',
    },
  ]

  const depositRowActions = (dep: Deposit) =>
    ['active', 'partially_paid'].includes(dep.status) ? (
      <button
        onClick={e => { e.stopPropagation(); setAddPaymentFor(dep) }}
        className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-black uppercase tracking-wider hover:bg-emerald-100 transition-all whitespace-nowrap"
      >
        Pay
      </button>
    ) : null

  const depositCard = (dep: Deposit) => (
    <div
      key={dep.id}
      className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 cursor-pointer active:scale-[0.99] transition-all"
      onClick={() => { setActiveId(dep.id); setView('detail') }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-[11px] font-black text-blue-600 font-mono">{dep.ref}</span>
          <p className="text-[13px] font-bold text-[var(--text-1)] mt-0.5">{dep.customerName}</p>
        </div>
        <StatusBadge status={dep.status} />
      </div>
      <ProgressBar paid={dep.totalPaid} total={dep.totalValue} />
      <div className="flex justify-between mt-2">
        <span className="text-[10px] text-[var(--text-4)]">Paid: <span className="font-bold text-emerald-600">{fmtKes(dep.totalPaid)}</span></span>
        <span className="text-[10px] text-[var(--text-4)]">Balance: <span className={`font-bold ${dep.balance <= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtKes(dep.balance)}</span></span>
      </div>
      {depositRowActions(dep) && <div className="mt-2.5 pt-2.5 border-t border-[var(--border-lt)] flex justify-end">{depositRowActions(dep)}</div>}
    </div>
  )

  if (!mounted) return <ModuleSkeleton />

  if (view === 'detail' && activeDeposit) {
    return (
      <>
        <DepositDetail
          deposit={activeDeposit}
          onBack={() => { setView('list'); setActiveId(null) }}
          onAddPayment={d => setAddPaymentFor(d)}
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
        {addPaymentFor && (
          <AddPaymentModal
            deposit={addPaymentFor}
            onClose={() => setAddPaymentFor(null)}
            onSave={() => setAddPaymentFor(null)}
          />
        )}
        {pendingConfirm && (
          <Confirm
            message={pendingConfirm.msg}
            confirmLabel="Cancel Deposit"
            onConfirm={() => { pendingConfirm.action(); setPendingConfirm(null) }}
            onCancel={() => setPendingConfirm(null)}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-page)]" style={{ animation: 'fadeIn 0.3s ease both' }}>

      {/* Header */}
      <div className="bg-[var(--bg-card)] border-b border-[var(--border)] px-4 sm:px-6 py-4 shrink-0 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-black text-[var(--text-1)] uppercase tracking-tight">Deposits & Laybys</h2>
            <p className="text-[10px] text-[var(--text-4)] mt-0.5">Reserve products with upfront payments</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[10px] font-black uppercase tracking-wider transition-all shadow-lg active:scale-95"
            style={{ background: 'linear-gradient(135deg,var(--primary),#4F46E5)', boxShadow: '0 8px 24px rgba(79,70,229,0.3)' }}
          >
            + New Deposit
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'Total Deposits', value: stats.total, color: '#3B82F6' },
            { label: 'Active / Part Paid', value: stats.active, color: '#F59E0B' },
            { label: 'Ready to Collect', value: stats.fullyPaid, color: '#10B981' },
            { label: 'Total Value', value: fmtKes(stats.totalValue), color: '#6366F1' },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
              <p className="text-[9px] font-black text-[var(--text-4)] uppercase tracking-widest">{label}</p>
              <p className="text-[15px] font-black mt-1" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--bg-card)] border-b border-[var(--border)] px-4 sm:px-6 py-2.5 flex items-center gap-3 shrink-0 overflow-x-auto scrollbar-hide">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search ref, customer…"
          className="flex-1 min-w-[160px] max-w-xs text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <div className="flex gap-1.5 shrink-0">
          {(['all', 'active', 'partially_paid', 'fully_paid', 'completed', 'cancelled'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap ${statusFilter === s ? 'bg-blue-600 text-white shadow-sm' : 'text-[var(--text-3)] hover:bg-[var(--bg-surface)] border border-[var(--border)]'}`}
            >
              {s === 'all' ? 'All' : STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6">
        <DataTable
          tableId="deposits"
          columns={depositColumns}
          rows={filtered}
          rowKey={dep => dep.id}
          hideSearch
          emptyMessage={search || statusFilter !== 'all' ? 'No matching deposits' : 'No deposits yet'}
          emptyAction={!search && statusFilter === 'all' ? (
            <button onClick={() => setShowNew(true)} className="mt-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-200">
              + New Deposit
            </button>
          ) : undefined}
          onRowClick={dep => { setActiveId(dep.id); setView('detail') }}
          rowActions={depositRowActions}
          renderCard={depositCard}
          exportTitle="Deposits & Laybys"
          exportFilename="deposits"
        />
      </div>

      {/* Modals */}
      {showNew && <NewDepositModal onClose={() => setShowNew(false)} onSave={handleSaveDeposit} />}
      {addPaymentFor && (
        <AddPaymentModal
          deposit={addPaymentFor}
          onClose={() => setAddPaymentFor(null)}
          onSave={() => setAddPaymentFor(null)}
        />
      )}
    </div>
  )
}
