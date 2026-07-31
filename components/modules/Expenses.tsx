'use client'
import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  useFinanceStore, fmtDate, fmtKes,
  Expense, ExpenseCategory, ExpensePaymentMethod,
  EXPENSE_CATEGORIES,
} from '@/lib/store'
import { canUserApproveExpenseStep } from '@/lib/expense-approval-chain'
import { ModuleSkeleton, useMounted, RecordCard, ModuleHeader, TabBar } from '@/components/ui'
import { PrimaryActionButton, StatusBadge } from '@/components/erp'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faHourglassHalf, faMoneyBillWave, faCreditCard, faChartBar, faClipboardList, faCircleCheck, faPlus } from '@fortawesome/free-solid-svg-icons'
import { readGuardedImageAsDataUrl, validateImageUpload } from '@/lib/client-image-guard'

// ── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string; desc: string; isReimbursable: boolean }[] = [
  { value: 'reimbursement',  label: 'Reimbursement',     desc: 'I paid from my own pocket',      isReimbursable: true },
  { value: 'petty_cash',     label: 'Petty Cash',        desc: 'Company cash box was used',       isReimbursable: false },
  { value: 'mpesa_company',  label: 'M-Pesa (Company)',  desc: 'Company M-Pesa / Till / Paybill', isReimbursable: false },
  { value: 'company_card',   label: 'Company Card',      desc: 'Company debit / credit card',     isReimbursable: false },
]

const STATUS_META: Record<Expense['status'], { label: string; badgeStatus: string }> = {
  submitted:   { label: 'Pending review', badgeStatus: 'pending' },
  approved:    { label: 'Approved',       badgeStatus: 'approved' },
  rejected:    { label: 'Rejected',       badgeStatus: 'failed' },
  reimbursed:  { label: 'Reimbursed',     badgeStatus: 'paid' },
}

const CAT_ICONS: Record<string, string> = {
  courier: '📦', office_supplies: '🗂️', water: '💧', printing: '🖨️',
  transport: '🚗', meals: '🍽️', utilities: '💡', software: '💻',
  hardware: '🖥️', maintenance: '🔧', other: '📝',
}

function catLabel(v: string) { return EXPENSE_CATEGORIES.find(c => c.value === v)?.label ?? v }
function pmLabel(v: string)  { return PAYMENT_METHODS.find(p => p.value === v)?.label ?? v }
function reimbursementMethodLabel(v?: string) {
  const labels: Record<string, string> = { bank: 'Bank Transfer', mpesa: 'M-Pesa', cash: 'Cash', cheque: 'Cheque' }
  return v ? (labels[v] ?? v) : '—'
}
function isReimbursable(method: ExpensePaymentMethod) { return method === 'reimbursement' }

function ExpenseApprovalChain({ chain }: { chain: NonNullable<Expense['approvalChain']> }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-t3 mb-2">Approval chain</p>
      <div className="flex flex-col gap-1.5">
        {chain.map((step, i) => {
          const done = step.status === 'approved'
          const rejected = step.status === 'rejected'
          const pending = step.status === 'pending'
          return (
            <div key={`${step.role}-${i}`} className="flex items-center gap-2 text-[11px]">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{
                  background: done ? 'var(--success-bg)' : rejected ? 'var(--danger-bg)' : 'var(--bg-muted)',
                  color: done ? 'var(--success-text)' : rejected ? '#991B1B' : 'var(--text-4)',
                }}
              >
                {done ? '✓' : rejected ? '✕' : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <span className="font-semibold capitalize">{step.role.replace(/_/g, ' ')}</span>
                {done && step.by && (
                  <span className="text-t3 ml-1">· {step.by}{step.at ? ` · ${fmtDate(step.at.slice(0, 10))}` : ''}</span>
                )}
                {pending && <span className="text-amber-700 ml-1 font-medium">— pending</span>}
                {rejected && <span className="text-red-700 ml-1 font-medium">— rejected</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

  const m = STATUS_META[status]
  return <StatusBadge status={m.badgeStatus} label={m.label} />
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Expenses() {
  return (
    <Suspense fallback={
      <ModuleSkeleton />
    }>
      <ExpensesContent />
    </Suspense>
  )
}

function ExpensesContent() {
  const mounted = useMounted()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const { users, currentUserId, expenses, submitExpense, reviewExpense, reimburseExpense, showToast, bankAccounts } = useFinanceStore()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isFinance   = ['director', 'finance_officer'].includes(currentUser?.role ?? '')

  const myExpenses  = expenses.filter(e => e.submittedByUserId === currentUserId)
  const allPending  = isFinance ? expenses.filter(e => e.status === 'submitted') : []
  const pendingReimbursements = isFinance ? expenses.filter(e => e.status === 'approved' && isReimbursable(e.paymentMethod)) : []

  const defaultTab = isFinance ? 'review' : 'mine'
  const queryTab = searchParams.get('tab') as 'mine' | 'review' | null
  const initialTab = queryTab === 'review' && !isFinance ? 'mine' : (queryTab ?? defaultTab)

  const [tab, setLocalTab] = useState<'mine' | 'review'>(initialTab)

  const setTab = (newTab: 'mine' | 'review') => {
    setLocalTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlTab = searchParams.get('tab') as 'mine' | 'review' | null
    const safeTab = urlTab === 'review' && !isFinance ? 'mine' : (urlTab ?? defaultTab)
    if (safeTab !== tab) {
      setLocalTab(safeTab)
      if (urlTab && safeTab !== urlTab) {
        const params = new URLSearchParams(searchParams.toString())
        params.set('tab', safeTab)
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      }
    }
  }, [searchParams, tab, isFinance, defaultTab, router, pathname])

  // ── Review filters ──
  const [reviewStatus, setReviewStatus] = useState<Expense['status'] | 'all'>('submitted')
  const [reviewUser,   setReviewUser]   = useState('all')

  const uniqueSubmitters: [string, string][] = isFinance
    ? Array.from(new Map(expenses.map(e => [e.submittedByUserId, e.submittedByName] as [string, string])))
    : []

  const reviewList = isFinance ? expenses
    .filter(e => reviewStatus === 'all' || e.status === reviewStatus)
    .filter(e => reviewUser  === 'all' || e.submittedByUserId === reviewUser) : []

  // ── Submit modal ──
  const [showSubmit, setShowSubmit] = useState(false)
  const [form, setForm] = useState({
    category:      'other' as ExpenseCategory,
    description:   '',
    amount:        '',
    expenseDate:   new Date().toISOString().slice(0, 10),
    paymentMethod: 'reimbursement' as ExpensePaymentMethod,
    notes:         '',
  })
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function openSubmit() {
    setForm({ category: 'other', description: '', amount: '', expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'reimbursement', notes: '' })
    setReceiptFile(null)
    setIsScanning(false)
    setShowSubmit(true)
  }

  async function handleFile(file: File | null) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10 MB)', 'error'); return }

    const isImage = file.type.startsWith('image/')
    if (isImage) {
      try {
        await validateImageUpload(file, { label: 'Receipt image', maxBytes: 8 * 1024 * 1024 })
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Receipt image could not be validated', 'error')
        if (fileRef.current) fileRef.current.value = ''
        return
      }
    }

    setReceiptFile(file)

    // Only scan images — PDFs and docs are stored but not OCR'd
    if (!isImage) return

    setIsScanning(true)
    try {
      const dataUrl = await readGuardedImageAsDataUrl(file, { label: 'Receipt image', maxBytes: 8 * 1024 * 1024 })
      const base64 = dataUrl.split(',')[1] ?? ''

      const res = await fetch('/api/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showToast(err.error ?? 'Deed OCR could not read this receipt — fill in details manually', res.status === 422 ? 'info' : 'error')
        return
      }

      const data = await res.json()
      setForm(prev => ({
        ...prev,
        amount:      prev.amount      || (data.amount ? String(data.amount) : prev.amount),
        expenseDate: prev.expenseDate !== new Date().toISOString().slice(0, 10) ? prev.expenseDate : (data.date || prev.expenseDate),
        category:    prev.category === 'other' ? ((data.category as ExpenseCategory) ?? prev.category) : prev.category,
        description: prev.description || data.description || prev.description,
      }))
      const confidence = typeof data.confidence === 'number' ? ` (${data.confidence}% confidence)` : ''
      showToast(`Deed OCR extracted receipt details${confidence}`, 'success')
    } catch {
      showToast('Deed OCR could not scan this receipt — fill in details manually', 'info')
    } finally {
      setIsScanning(false)
    }
  }

  function handleSubmit() {
    if (!form.description.trim())    { showToast('Enter a description', 'error'); return }
    const amt = Number(form.amount)
    if (!amt || amt <= 0)            { showToast('Enter a valid amount', 'error'); return }

    const save = (dataUrl?: string, meta?: { name: string; size: number; type: string }) => {
      submitExpense({
        category:        form.category,
        description:     form.description.trim(),
        amount:          amt,
        expenseDate:     form.expenseDate,
        paymentMethod:   form.paymentMethod,
        notes:           form.notes.trim() || undefined,
        receiptDataUrl:  dataUrl,
        receiptFileName: meta?.name,
        receiptFileSize: meta?.size,
        receiptFileType: meta?.type,
      })
      setShowSubmit(false)
    }

    if (receiptFile) {
      if (receiptFile.type.startsWith('image/')) {
        readGuardedImageAsDataUrl(receiptFile, { label: 'Receipt image', maxBytes: 8 * 1024 * 1024 })
          .then(dataUrl => save(dataUrl, { name: receiptFile.name, size: receiptFile.size, type: receiptFile.type }))
          .catch(err => showToast(err instanceof Error ? err.message : 'Receipt image could not be validated', 'error'))
        return
      }

      const reader = new FileReader()
      reader.onload = () => save(reader.result as string, { name: receiptFile.name, size: receiptFile.size, type: receiptFile.type })
      reader.readAsDataURL(receiptFile)
    } else {
      save()
    }
  }

  // ── Review modal ──
  const queryId = searchParams.get('id')
  const [reviewingId, setLocalReviewingId] = useState<string | null>(queryId ?? null)
  const [reviewNotes, setReviewNotes] = useState('')

  const setReviewingId = (id: string | null) => {
    setLocalReviewingId(id)
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('id', id)
    else params.delete('id')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlId = searchParams.get('id')
    if (urlId !== reviewingId) setLocalReviewingId(urlId)
  }, [searchParams, reviewingId])

  const [reimbursingId, setReimbursingId] = useState<string | null>(null)
  const [reimburseNote, setReimburseNote] = useState('')
  const [reimburseBankAccountId, setReimburseBankAccountId] = useState('')
  const [reimburseMethod, setReimburseMethod] = useState('bank')
  const [reimburseReference, setReimburseReference] = useState('')

  // ── Receipt preview ──
  const [previewExp, setPreviewExp] = useState<Expense | null>(null)
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  function openReceiptPreview(exp: Expense) {
    setPreviewExp(exp)
    setPreviewUrl(null)
    if (!exp.receiptFileName) return
    setPreviewLoading(true)
    fetch(`/api/expense-receipts/${exp.id}`)
      .then(r => {
        if (!r.ok) throw new Error('not found')
        return r.blob()
      })
      .then(blob => setPreviewUrl(URL.createObjectURL(blob)))
      .catch(() => setPreviewUrl(null))
      .finally(() => setPreviewLoading(false))
  }

  function closeReceiptPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewExp(null)
    setPreviewUrl(null)
  }

  // ── Stats ──
  const myTotal      = myExpenses.reduce((s, e) => s + e.amount, 0)
  const myPending    = myExpenses.filter(e => e.status === 'submitted').length
  const myApproved   = myExpenses.filter(e => e.status === 'approved').length
  const myReimbursed = myExpenses.filter(e => e.status === 'reimbursed').reduce((s, e) => s + e.amount, 0)

  const totalPendingAmt = allPending.reduce((s, e) => s + e.amount, 0)
  const reimbDue        = pendingReimbursements.reduce((s, e) => s + e.amount, 0)

  if (!mounted) return <ModuleSkeleton />

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div className="mod-page">
      <ModuleHeader
        title="Expenses"
        subtitle="Submit and track expense claims"
        icon={<Fa icon={faClipboardList} />}
        color="var(--warning)"
        primaryAction={
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openSubmit}>
            New expense
          </PrimaryActionButton>
        }
      />

      <TabBar
        tabs={[
          { id: 'mine', label: myExpenses.length > 0 ? `My expenses (${myExpenses.length})` : 'My expenses' },
          ...(isFinance
            ? [{ id: 'review', label: allPending.length > 0 ? `Review (${allPending.length})` : 'Review' }]
            : []),
        ]}
        active={tab}
        onChange={id => setTab(id as typeof tab)}
        maxVisibleDesktop={6}
        ariaLabel="Expense sections"
      />

      <div className="mod-body">
      <div className="card overflow-hidden m-3 sm:m-4">

        {/* ── My Expenses tab ── */}
        {tab === 'mine' && (
          <ExpenseTable
            rows={myExpenses}
            showSubmitter={false}
            emptyMessage='No expenses submitted yet. Click "+ New Expense" to get started.'
            onPreview={openReceiptPreview}
            onView={e => setReviewingId(e.id)}
          />
        )}

        {/* ── Review tab (finance/admin) ── */}
        {tab === 'review' && isFinance && (
          <ExpenseTable
            rows={reviewList}
            showSubmitter
            emptyMessage="No expenses match the filter."
            searchPlaceholder="Search reference or description…"
            primaryFilters={[
              {
                key: 'status',
                label: 'Status',
                value: reviewStatus,
                allValue: 'all',
                options: [
                  { value: 'all', label: 'All statuses' },
                  { value: 'submitted', label: 'Pending' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'rejected', label: 'Rejected' },
                  { value: 'reimbursed', label: 'Reimbursed' },
                ],
                onChange: v => setReviewStatus(v as typeof reviewStatus),
              },
              {
                key: 'staff',
                label: 'Staff',
                value: reviewUser,
                allValue: 'all',
                options: [
                  { value: 'all', label: 'All staff' },
                  ...uniqueSubmitters.map(([uid, name]) => ({ value: uid, label: name })),
                ],
                onChange: setReviewUser,
              },
            ]}
            onClearFilters={() => {
              setReviewStatus('all')
              setReviewUser('all')
            }}
            onPreview={openReceiptPreview}
            onReview={e => { setReviewingId(e.id); setReviewNotes('') }}
            onReimburse={e => {
              setReimbursingId(e.id)
              setReimburseNote('')
              setReimburseMethod('bank')
              setReimburseBankAccountId('')
              setReimburseReference('')
            }}
            onView={e => setReviewingId(e.id)}
          />
        )}
      </div>

      {/* ── Submit Expense Modal ──────────────────────────────────────────── */}
      {showSubmit && (
        <div className="modal-overlay" onClick={() => setShowSubmit(false)}>
          <div className="modal-box w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-t1">New Expense</h3>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Submitting as <span className="font-semibold" style={{ color: 'var(--navy)' }}>{currentUser?.name ?? '—'}</span>
                </p>
              </div>
              <button onClick={() => setShowSubmit(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
            </div>

            <div className="space-y-3">
              {/* Category + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Category *</label>
                  <select aria-label="Expense category" className="form-input w-full text-[12px]" value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value as ExpenseCategory }))}>
                    {EXPENSE_CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{CAT_ICONS[c.value]} {c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Expense Date *</label>
                  <input type="date" aria-label="Expense date" className="form-input w-full text-[12px]" value={form.expenseDate}
                    onChange={e => setForm(f => ({ ...f, expenseDate: e.target.value }))} />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Description *</label>
                <textarea aria-label="Expense description" className="form-input w-full text-[12px]" rows={2}
                  placeholder="What was purchased / what was the expense for?"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              {/* Amount */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Amount (KSh) *</label>
                <input type="number" aria-label="Expense amount" className="form-input w-full text-[12px]" placeholder="0.00"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>

              {/* Payment method */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-2">How was it paid? *</label>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map(pm => {
                    const active = form.paymentMethod === pm.value
                    return (
                      <button key={pm.value} onClick={() => setForm(f => ({ ...f, paymentMethod: pm.value }))}
                        style={{
                          padding: '8px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                          border: `1px solid ${active ? 'var(--navy)' : 'var(--border-lt)'}`,
                          background: active ? '#E8F3FA' : '#FAFAFA',
                        }}>
                        <p className="text-[11px] font-semibold" style={{ color: active ? 'var(--navy-dark)' : 'var(--text-3)' }}>{pm.label}</p>
                        <p className="text-[10px]" style={{ color: active ? 'var(--accent-cyan)' : 'var(--text-4)' }}>{pm.desc}</p>
                        {pm.isReimbursable && (
                          <span style={{ fontSize: 9, background: 'var(--warning-bg)', color: 'var(--warning-text)', borderRadius: 20, padding: '1px 6px', fontWeight: 600, marginTop: 3, display: 'inline-block' }}>
                            Reimbursable
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Receipt upload */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">
                  Attach Receipt / Transaction Message
                  <span className="font-normal text-t3 ml-1">(photo, PDF, screenshot)</span>
                </label>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0] ?? null) }}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? 'var(--navy)' : receiptFile ? 'var(--success)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '14px 16px', cursor: 'pointer', textAlign: 'center',
                    background: dragOver ? '#E8F3FA' : receiptFile ? 'var(--success-bg)' : '#FAFAFA',
                    transition: 'all 0.15s',
                  }}>
                  <input ref={fileRef} type="file" className="hidden"
                    accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx"
                    onChange={e => handleFile(e.target.files?.[0] ?? null)} />
                  {isScanning ? (
                    <div className="flex flex-col items-center justify-center py-3 gap-2">
                      <svg className="h-6 w-6 animate-spin" style={{ color: 'var(--navy)' }} viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-[11px] font-bold text-t1 mt-1">Reading receipt with Deed OCR...</p>
                      <p className="text-[10px] text-t3">Your own scanner is extracting amount, date & description</p>
                    </div>
                  ) : receiptFile ? (
                    <div>
                      <div style={{ fontSize: 24 }} className="mb-1">
                        {receiptFile.type.startsWith('image/') ? '🖼️' : '📄'}
                      </div>
                      <p className="text-[11px] font-semibold text-green-700">{receiptFile.name}</p>
                      <p className="text-[10px] text-t3 mt-0.5">{formatSize(receiptFile.size)} · Click to change</p>
                      {receiptFile.type.startsWith('image/') && (
                        <button
                          type="button"
                          className="btn-outline text-[10px] py-1 px-3 mt-2"
                          onClick={e => { e.stopPropagation(); handleFile(receiptFile) }}
                        >
                          Scan with Deed OCR
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 24 }} className="mb-1">📎</div>
                      <p className="text-[11px] text-t2 font-medium">Drop receipt here or click to browse</p>
                      <p className="text-[10px] text-t3 mt-0.5">JPG, PNG, or WebP images scan with Deed OCR — max 8 MB; PDF/manual upload max 10 MB</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Notes (optional)</label>
                <input aria-label="Expense notes" className="form-input w-full text-[12px]" placeholder="Any additional context..."
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setShowSubmit(false)}>Cancel</button>
              <button className="btn-primary text-[11px] py-2 px-4" onClick={handleSubmit}>Submit Expense</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Approve / Reject Modal ────────────────────────────────────────── */}
      {reviewingId && (() => {
        const exp = expenses.find(e => e.id === reviewingId)
        if (!exp) return null
        const canReview = isFinance && exp.status === 'submitted'
          && (!exp.approvalChain?.length || canUserApproveExpenseStep(currentUser?.role, exp.approvalChain))
        return (
          <div className="modal-overlay" onClick={() => setReviewingId(null)}>
            <div className="modal-box w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-t1">{canReview ? 'Review Expense' : 'View Expense'}</h3>
                  <p className="text-[11px] text-t3">{exp.ref} · {exp.submittedByName}</p>
                </div>
                <button onClick={() => setReviewingId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
              </div>

              {/* Summary */}
              <div className="rounded-xl p-3 mb-4 space-y-1.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-muted)' }}>
                <div className="flex justify-between text-[12px]">
                  <span className="text-t3">Category</span>
                  <span className="font-semibold">{CAT_ICONS[exp.category]} {catLabel(exp.category)}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-t3">Date</span>
                  <span>{fmtDate(exp.expenseDate)}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-t3">Payment</span>
                  <span>{pmLabel(exp.paymentMethod)}{isReimbursable(exp.paymentMethod) && <span className="ml-1 text-[10px] text-amber-700 font-semibold">(Reimbursable)</span>}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-t3">Description</span>
                  <span className="font-medium text-right ml-4 max-w-[220px]">{exp.description}</span>
                </div>
                <div className="flex justify-between text-[12px] pt-1 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                  <span className="font-bold text-t1">Amount</span>
                  <span className="font-bold text-base" style={{ color: 'var(--navy)' }}>{fmtKes(exp.amount)}</span>
                </div>
              </div>

              {exp.approvalChain && exp.approvalChain.length > 0 && (
                <ExpenseApprovalChain chain={exp.approvalChain} />
              )}

              {exp.receiptFileName && (
                <button onClick={() => { openReceiptPreview(exp); setReviewingId(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--navy)', background: '#E8F3FA', border: '1px solid #A8D4E8', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', marginBottom: 12 }}>
                  📎 View attached receipt
                </button>
              )}

              {exp.reviewNotes && !canReview && (
                <div className="mb-3 p-3 rounded-lg" style={{ background: 'var(--warning-bg)', border: '1px solid #FDE68A' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-t3 mb-1">Review Notes</p>
                  <p className="text-xs" style={{ color: 'var(--warning-text)' }}>{exp.reviewNotes}</p>
                </div>
              )}

              {exp.status === 'reimbursed' && (exp.reimbursementMethod || exp.reimbursementBankAccount || exp.reimbursementReference) && (
                <div className="mb-3 p-3 rounded-lg" style={{ background: '#ECFEFF', border: '1px solid #A5F3FC' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-t3 mb-2">Reimbursement Details</p>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between gap-3"><span className="text-t3">Method</span><span className="font-semibold text-right">{reimbursementMethodLabel(exp.reimbursementMethod)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-t3">Bank Account</span><span className="font-semibold text-right">{bankAccounts.find(a => a.id === exp.reimbursementBankAccount)?.name ?? exp.reimbursementBankAccount ?? '—'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-t3">Reference</span><span className="font-semibold text-right">{exp.reimbursementReference || '—'}</span></div>
                  </div>
                </div>
              )}

              {canReview && (
                <div className="mb-3">
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Review Notes (optional)</label>
                  <textarea aria-label="Expense review notes" className="form-input w-full text-[12px]" rows={2}
                    placeholder="Add a note for the employee..."
                    value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} />
                </div>
              )}

              <div className="flex gap-2 justify-end">
                {canReview ? (
                  <>
                    <button onClick={() => setReviewingId(null)} className="btn-outline text-[11px] py-2 px-4">Cancel</button>
                    <button onClick={() => { reviewExpense(reviewingId, false, reviewNotes); setReviewingId(null) }}
                      style={{ fontSize: 11, padding: '8px 16px', borderRadius: 8, border: '1px solid #FECACA', background: 'var(--danger-bg)', color: '#991B1B', cursor: 'pointer', fontWeight: 600 }}>
                      Reject
                    </button>
                    <button onClick={() => { reviewExpense(reviewingId, true, reviewNotes); setReviewingId(null) }}
                      className="btn-primary text-[11px] py-2 px-4" style={{ background: 'var(--success)' }}>
                      Approve
                    </button>
                  </>
                ) : (
                  <button onClick={() => setReviewingId(null)} className="btn-outline text-[11px] py-2 px-4">Close</button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Reimburse Modal ───────────────────────────────────────────────── */}
      {reimbursingId && (() => {
        const exp = expenses.find(e => e.id === reimbursingId)
        if (!exp) return null
        return (
          <div className="modal-overlay" onClick={() => setReimbursingId(null)}>
            <div className="modal-box w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-t1">Mark as Reimbursed</h3>
                  <p className="text-[11px] text-t3">{exp.ref} · {exp.submittedByName}</p>
                </div>
                <button onClick={() => setReimbursingId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
              </div>

              <div className="rounded-xl p-3 mb-4 text-center" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                <p className="text-[10px] text-t3 mb-1">Amount to reimburse to {exp.submittedByName}</p>
                <p className="text-2xl font-bold" style={{ color: 'var(--navy)' }}>{fmtKes(exp.amount)}</p>
                <p className="text-[10px] text-t3 mt-1">{catLabel(exp.category)} · {fmtDate(exp.expenseDate)}</p>
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Bank Account</label>
                  <select aria-label="Reimbursement bank account" className="form-input w-full text-[12px]" value={reimburseBankAccountId} onChange={e => setReimburseBankAccountId(e.target.value)}>
                    <option value="">— Select Bank Account —</option>
                    {bankAccounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Payment Method</label>
                  <select aria-label="Reimbursement payment method" className="form-input w-full text-[12px]" value={reimburseMethod} onChange={e => setReimburseMethod(e.target.value)}>
                    <option value="bank">Bank Transfer</option>
                    <option value="mpesa">M-Pesa</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">{reimburseMethod === 'cheque' ? 'Cheque Number' : 'Payment Reference'}</label>
                  <input aria-label={reimburseMethod === 'cheque' ? 'Cheque number' : 'Payment reference'} className="form-input w-full text-[12px]" placeholder={reimburseMethod === 'cheque' ? 'e.g. 000123' : 'e.g. M-Pesa ref QGH123XY'}
                    value={reimburseReference} onChange={e => setReimburseReference(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-t2 block mb-1">Reimbursement Note (optional)</label>
                  <textarea aria-label="Reimbursement note" className="form-input w-full text-[12px]" rows={2} placeholder="Any note about the reimbursement..."
                    value={reimburseNote} onChange={e => setReimburseNote(e.target.value)} />
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button onClick={() => { setReimbursingId(null); setReimburseReference(''); setReimburseBankAccountId('') }} className="btn-outline text-[11px] py-2 px-4">Cancel</button>
                <button onClick={() => {
                  reimburseExpense(reimbursingId, reimburseNote.trim() || undefined, reimburseMethod, reimburseBankAccountId || undefined, reimburseReference.trim() || undefined)
                  setReimbursingId(null)
                  setReimburseReference('')
                  setReimburseBankAccountId('')
                  setReimburseNote('')
                }}
                  className="btn-primary text-[11px] py-2 px-4" style={{ background: 'var(--accent-cyan)' }}>
                  Confirm Reimbursement
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Receipt Preview Modal ─────────────────────────────────────────── */}
      {previewExp && (
        <div className="modal-overlay" onClick={closeReceiptPreview}>
          <div className="modal-box w-full max-w-2xl" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-t1">{previewExp.ref} · Receipt</h3>
                <p className="text-[10px] text-t3">{previewExp.receiptFileName} · {previewExp.receiptFileSize ? formatSize(previewExp.receiptFileSize) : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                {previewUrl && (
                  <a href={previewUrl} download={previewExp.receiptFileName ?? 'receipt'}
                    className="btn-outline text-[11px] py-1.5 px-3" style={{ textDecoration: 'none' }}>
                    Download
                  </a>
                )}
                <button onClick={closeReceiptPreview} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-4)' }}>×</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto rounded-lg" style={{ background: 'var(--bg-muted)', minHeight: 300 }}>
              {previewLoading ? (
                <div className="flex items-center justify-center h-48">
                  <svg className="h-8 w-8 animate-spin" style={{ color: 'var(--navy)' }} viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : previewUrl ? (
                previewExp.receiptFileType?.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="receipt" className="max-w-full mx-auto block" style={{ maxHeight: 600 }} />
                ) : previewExp.receiptFileType === 'application/pdf' ? (
                  <iframe src={previewUrl} title="receipt" className="w-full" style={{ height: 500, border: 'none' }} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-48 text-t3 text-sm gap-2">
                    <span style={{ fontSize: 40 }}>📄</span>
                    <a href={previewUrl} download={previewExp.receiptFileName} className="btn-primary text-[11px] py-2 px-4" style={{ textDecoration: 'none' }}>Download to view</a>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-t3 text-sm gap-2">
                  <span style={{ fontSize: 40 }}>⚠️</span>
                  <p className="text-[12px]">Receipt could not be loaded</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>{/* mod-body */}
    </div>
  )
}

// ── Shared expense table ──────────────────────────────────────────────────────

function ExpenseTable({
  rows,
  showSubmitter,
  emptyMessage,
  searchPlaceholder,
  primaryFilters,
  onClearFilters,
  onPreview,
  onReview,
  onReimburse,
  onView,
}: {
  rows: Expense[]
  showSubmitter: boolean
  emptyMessage?: string
  searchPlaceholder?: string
  primaryFilters?: PrimaryFilterConfig[]
  onClearFilters?: () => void
  onPreview: (e: Expense) => void
  onReview?: (e: Expense) => void
  onReimburse?: (e: Expense) => void
  onView?: (e: Expense) => void
}) {
  const rowActions = (exp: Expense) => (
    <div className="flex items-center gap-2">
      {onReview && exp.status === 'submitted' && (
        <button className="btn-primary text-[10px] py-1.5 px-3" onClick={() => onReview(exp)}>Review</button>
      )}
      {onReimburse && exp.status === 'approved' && isReimbursable(exp.paymentMethod) && (
        <button className="btn-primary text-[10px] py-1.5 px-3 bg-cyan-600 hover:bg-cyan-700" onClick={() => onReimburse(exp)}>Reimburse</button>
      )}
      {onView && (
        <button className="btn-secondary text-[10px] py-1.5 px-3" onClick={() => onView(exp)}>View</button>
      )}
    </div>
  )

  const columns: ColumnDef<Expense>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: exp => <span className="font-mono text-[11px] font-bold text-primary-600">{exp.ref}</span>,
    },
    {
      key: 'description', label: 'Description', priority: 1, width: '1.6fr',
      render: exp => (
        <div className="min-w-0" style={{ maxWidth: 250 }}>
          <p className="text-[var(--text-1)] font-bold erp-truncate" title={exp.description}>{exp.description}</p>
          {exp.notes && <p className="text-[10px] text-[var(--text-4)] erp-truncate mt-0.5" title={exp.notes}>{exp.notes}</p>}
        </div>
      ),
      exportValue: exp => exp.description,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '130px',
      render: exp => (
        <div>
          <ExpenseStatusBadge status={exp.status} />
          {exp.approvalChain && exp.approvalChain.length > 1 && exp.status === 'submitted' && (
            <p className="text-[9px] text-amber-700 mt-1">
              Step {exp.approvalChain.filter(s => s.status === 'approved').length + 1}/{exp.approvalChain.length}
            </p>
          )}
          {exp.reviewNotes && (
            <p className="text-[10px] text-[var(--text-4)] mt-1 italic truncate max-w-[120px]" title={exp.reviewNotes}>{exp.reviewNotes}</p>
          )}
          {exp.status === 'reimbursed' && exp.reimbursementReference && (
            <p className="text-[10px] text-cyan-700 mt-1 truncate max-w-[120px]" title={exp.reimbursementReference}>Paid: {exp.reimbursementReference}</p>
          )}
        </div>
      ),
      exportValue: exp => STATUS_META[exp.status].label,
    },
    {
      key: 'amount', label: 'Amount', priority: 1, width: '100px', align: 'right',
      render: exp => <span className="font-bold text-[var(--text-1)]">{fmtKes(exp.amount)}</span>,
      exportValue: exp => exp.amount,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: exp => <span className="whitespace-nowrap font-medium">{fmtDate(exp.expenseDate)}</span>,
      exportValue: exp => exp.expenseDate,
    },
    {
      key: 'category', label: 'Category', priority: 2, width: '140px',
      render: exp => (
        <span className="text-[var(--text-2)] font-semibold flex items-center gap-2 whitespace-nowrap">
          <span className="text-base">{CAT_ICONS[exp.category]}</span>
          {catLabel(exp.category)}
        </span>
      ),
      exportValue: exp => catLabel(exp.category),
    },
    {
      key: 'receipt', label: 'Receipt', priority: 2, width: '80px',
      render: exp => exp.receiptFileName ? (
        <button
          type="button"
          onClick={() => onPreview(exp)}
          className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary-50 text-primary-600 hover:bg-primary-100 transition-colors"
          aria-label={`Preview receipt for ${exp.ref}`}
        >
          <Fa icon={faClipboardList} />
        </button>
      ) : <span className="text-[var(--text-4)]">—</span>,
      exportValue: exp => exp.receiptFileName ?? '',
    },
    ...(showSubmitter ? [{
      key: 'submitter', label: 'Submitted By', priority: 2 as const, width: '130px',
      render: (exp: Expense) => <span className="text-[var(--text-2)] whitespace-nowrap font-medium">{exp.submittedByName}</span>,
      exportValue: (exp: Expense) => exp.submittedByName,
    }] : []),
    {
      key: 'payment', label: 'Payment', priority: 3, width: '120px',
      render: exp => (
        <div className="whitespace-nowrap font-medium">
          {pmLabel(exp.paymentMethod)}
          {isReimbursable(exp.paymentMethod) && (
            <span className="block text-[9px] text-amber-600 font-bold uppercase mt-0.5">Reimbursable</span>
          )}
        </div>
      ),
      exportValue: exp => pmLabel(exp.paymentMethod),
    },
  ]

  const renderExpenseCard = (exp: Expense) => (
    <RecordCard
      key={exp.id}
      eyebrow={exp.ref}
      title={exp.description}
      subtitle={`${catLabel(exp.category)} · ${fmtDate(exp.expenseDate)}${showSubmitter ? ` · ${exp.submittedByName}` : ''}`}
      amount={fmtKes(exp.amount)}
      status={<ExpenseStatusBadge status={exp.status} />}
      meta={[
        { label: 'Payment', value: pmLabel(exp.paymentMethod) },
        ...(exp.receiptFileName ? [{ label: 'Receipt', value: exp.receiptFileName }] : []),
      ]}
      actions={rowActions(exp)}
    />
  )

  return (
    <DataTable
      tableId={showSubmitter ? 'expenses_review' : 'expenses_mine'}
      columns={columns}
      rows={rows}
      rowKey={exp => exp.id}
      emptyMessage={emptyMessage ?? 'No expenses found'}
      searchPlaceholder={searchPlaceholder ?? 'Search reference or description…'}
      primaryFilters={primaryFilters}
      onClearFilters={onClearFilters}
      hideColumnFilters={Boolean(primaryFilters?.length)}
      rowActions={rowActions}
      renderCard={renderExpenseCard}
      exportTitle={showSubmitter ? 'Expense Reviews' : 'My Expenses'}
      exportFilename="expenses"
    />
  )
}
