'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmtDate, fmtKes, useFinanceStore } from '@/lib/store'
import { allocateCheque, chequeLinkedRefs, chequeLinkedType, docBalance, findDocByRef, openDocsForCheque } from '@/lib/cheques/cheque-link'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Modal } from '@/components/ui'
import {
  STATUS_LABEL,
  alertLabel,
  chequeAlert,
  isStaleCheque,
  NEXT_STATUSES,
  type ChequeAlert,
  type ChequeDirection,
  type ChequeStatus,
} from '@/lib/cheques/cheque-rules'

type Toast = (msg: string, type?: 'error' | 'success' | 'info') => void
type HistoryEntry = { at: string; by: string; status: ChequeStatus; note?: string }
type Cheque = {
  id: string
  direction: ChequeDirection
  chequeNumber: string
  bankName: string
  partyName: string
  amount: number
  chequeDate: string
  receivedDate: string | null
  status: ChequeStatus
  linkedRef: string | null
  notes: string | null
  hasImage: boolean
  history: HistoryEntry[]
  alert: ChequeAlert
}
type Scan = { chequeNumber: string; bankName: string; payeeName: string; accountName: string; amount: number | null; chequeDate: string; warnings: string[] }

const ALERT_TONE: Record<Exclude<ChequeAlert, null>, string> = {
  due_tomorrow: 'bg-sky-50 text-sky-800',
  due_today: 'bg-amber-100 text-amber-900',
  overdue: 'bg-red-50 text-red-700',
  stale: 'bg-slate-100 text-slate-600',
}
const STATUS_TONE: Record<ChequeStatus, string> = {
  pending: 'bg-[var(--bg-muted)] text-[var(--text-2)]',
  deposited: 'bg-sky-50 text-sky-800',
  cleared: 'bg-emerald-50 text-emerald-800',
  bounced: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date())

async function readJson<T>(res: Response): Promise<T> {
  const payload = await res.json().catch(() => null) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(payload?.error || `Request failed (${res.status})`)
  return payload as T
}

/** Phone photos run to several MB; shrink to a readable 1600px JPEG before uploading. */
async function prepareImage(file: File): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { base64: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg', previewUrl: dataUrl }
}

const EMPTY_FORM = { direction: 'received' as ChequeDirection, chequeNumber: '', bankName: '', partyName: '', amount: '', chequeDate: '', receivedDate: '', linkedRef: '', notes: '' }

export default function Cheques({ showToast }: { showToast: Toast }) {
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState<'all' | ChequeDirection>('all')
  const [statusFilter, setStatusFilter] = useState<'open' | 'deposited' | 'closed' | 'all'>('open')
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<Cheque | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await readJson<{ cheques: Cheque[] }>(await fetch('/api/cheques', { cache: 'no-store' }))
      setCheques(data.cheques)
      setError(null)
      setSelected(prev => (prev ? data.cheques.find(c => c.id === prev.id) ?? null : null))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load cheques')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const now = today()
  const summary = useMemo(() => {
    const open = cheques.filter(c => c.status === 'pending')
    const sum = (list: Cheque[]) => list.reduce((total, c) => total + c.amount, 0)
    const ready = open.filter(c => c.direction === 'received' && ['due_today', 'overdue'].includes(c.alert ?? ''))
    const tomorrow = open.filter(c => c.alert === 'due_tomorrow')
    const owed = cheques.filter(c => c.direction === 'given' && (c.status === 'pending' || c.status === 'deposited'))
    const held = open.filter(c => c.direction === 'received')
    return { ready, tomorrow, owed, held, sum }
  }, [cheques])

  const rows = useMemo(() => cheques.filter(c => {
    if (direction !== 'all' && c.direction !== direction) return false
    if (statusFilter === 'open') return c.status === 'pending'
    if (statusFilter === 'deposited') return c.status === 'deposited'
    if (statusFilter === 'closed') return c.status === 'cleared' || c.status === 'bounced' || c.status === 'cancelled'
    return true
  }).sort((a, b) => (statusFilter === 'open' ? a.chequeDate.localeCompare(b.chequeDate) : b.chequeDate.localeCompare(a.chequeDate))), [cheques, direction, statusFilter])

  const move = async (cheque: Cheque, status: ChequeStatus, note?: string) => {
    try {
      await readJson(await fetch(`/api/cheques/${cheque.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      }))
      showToast(`Cheque ${cheque.chequeNumber} marked ${STATUS_LABEL[cheque.direction][status].toLowerCase()}`, 'success')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update the cheque', 'error')
    }
  }

  const columns: ColumnDef<Cheque>[] = [
    {
      key: 'date', label: 'Cheque date', priority: 1, width: '235px',
      render: c => (
        <span className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-t1">{fmtDate(c.chequeDate)}</span>
          {c.alert && (
            <span className={`w-fit whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${ALERT_TONE[c.alert]}`}>
              {alertLabel(c.direction, c.alert, c.chequeDate, now)}
            </span>
          )}
        </span>
      ),
      accessor: c => c.chequeDate,
      exportValue: c => c.chequeDate,
    },
    {
      key: 'direction', label: 'Type', priority: 2, width: '90px',
      render: c => <span className="chip text-[10px]">{c.direction === 'received' ? 'Received' : 'Given'}</span>,
      exportValue: c => c.direction,
    },
    {
      key: 'number', label: 'Cheque no.', priority: 1, width: '110px',
      render: c => <span className="font-mono text-[11px] font-semibold text-primary-600">{c.chequeNumber}</span>,
      accessor: c => `${c.chequeNumber} ${c.bankName} ${c.linkedRef ?? ''}`,
      exportValue: c => c.chequeNumber,
    },
    {
      key: 'party', label: 'From / to', priority: 1, width: 'minmax(10rem, 1.5fr)',
      render: c => (
        <span className="min-w-0 block">
          <span className="block truncate text-xs font-medium text-t1">{c.partyName}</span>
          {c.bankName && <span className="block truncate text-[10px] text-t3">{c.bankName}</span>}
        </span>
      ),
      accessor: c => c.partyName,
      exportValue: c => c.partyName,
    },
    {
      key: 'amount', label: 'Amount', priority: 1, width: '120px', align: 'right',
      render: c => <span className="font-mono text-[11px] font-semibold tabular-nums">{fmtKes(c.amount)}</span>,
      exportValue: c => c.amount,
    },
    {
      key: 'linked', label: 'For', priority: 3, width: '130px',
      render: c => <span className="font-mono text-[11px] text-t2">{c.linkedRef || '—'}</span>,
      exportValue: c => c.linkedRef ?? '',
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: c => <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.direction][c.status]}</span>,
      exportValue: c => STATUS_LABEL[c.direction][c.status],
    },
  ]

  const tile = (label: string, list: Cheque[], hint: string, tone = '') => (
    <div className={`min-w-[150px] flex-1 rounded-lg border px-3 py-2 ${tone}`} style={{ borderColor: 'var(--border-lt)' }}>
      <p className="mb-0.5 text-[10px] text-t3">{label}</p>
      <p className="text-base font-semibold text-t1">{list.length}</p>
      <p className="font-mono text-[11px] text-t2">{fmtKes(summary.sum(list))}</p>
      <p className="mt-0.5 text-[10px] text-t3">{hint}</p>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
        {tile('Ready for banking', summary.ready, 'Received, date has come', summary.ready.length ? 'bg-amber-50' : '')}
        {tile('Due tomorrow', summary.tomorrow, 'Received and given')}
        {tile('Held, not yet banked', summary.held, 'Received cheques waiting')}
        {tile('We owe on cheques', summary.owed, 'Given, not yet cleared')}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b px-4 py-2.5" style={{ borderColor: 'var(--border-lt)' }}>
        <div className="inventory-view-group" role="group" aria-label="Type">
          <span className="inventory-view-label">Type</span>
          <div className="inventory-view-segmented">
            {([['all', 'All'], ['received', 'Received'], ['given', 'Given']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={direction === value} onClick={() => setDirection(value)}
                className={`inventory-view-seg ${direction === value ? 'is-on' : ''}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="inventory-view-group" role="group" aria-label="Show">
          <span className="inventory-view-label">Show</span>
          <div className="inventory-view-segmented">
            {([['open', 'Waiting'], ['deposited', 'At the bank'], ['closed', 'Closed'], ['all', 'All']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}
                className={`inventory-view-seg ${statusFilter === value ? 'is-on' : ''}`}>{label}</button>
            ))}
          </div>
        </div>
        <button type="button" className="btn-primary ml-auto text-[12px]" onClick={() => setAdding(true)}>Add cheque</button>
      </div>

      <DataTable
        tableId="finance-cheques"
        columns={columns}
        rows={rows}
        rowKey={c => c.id}
        isLoading={loading}
        error={error}
        searchPlaceholder="Search cheque number, name or bank…"
        emptyMessage={statusFilter === 'open' ? 'No cheques waiting. Add one when you receive or issue a cheque.' : 'No cheques match these filters'}
        perPage={20}
        exportTitle="Cheque register"
        exportFilename="cheque-register"
        onRowClick={c => setSelected(c)}
        rowActions={c => {
          const primary: ChequeStatus | null = c.status === 'pending' ? 'deposited' : c.status === 'deposited' ? 'cleared' : null
          return primary ? (
            <button type="button" className="btn-secondary text-[10px] px-2 py-1" onClick={e => { e.stopPropagation(); void move(c, primary) }}>
              {primary === 'deposited' ? (c.direction === 'received' ? 'Mark banked' : 'Mark presented') : 'Mark cleared'}
            </button>
          ) : null
        }}
      />

      {adding && <AddCheque showToast={showToast} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load() }} />}
      {selected && <ChequeDetail cheque={selected} now={now} onClose={() => setSelected(null)} onMove={move} />}
    </div>
  )
}

function ChequeDetail({ cheque, now, onClose, onMove }: {
  cheque: Cheque
  now: string
  onClose: () => void
  onMove: (cheque: Cheque, status: ChequeStatus, note?: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const next = NEXT_STATUSES[cheque.status]
  const run = async (status: ChequeStatus) => {
    setBusy(true)
    await onMove(cheque, status, note.trim() || undefined)
    setBusy(false)
    setNote('')
  }
  const label = (status: ChequeStatus) => {
    if (status === 'pending') return 'Reopen'
    if (status === 'deposited') return cheque.direction === 'received' ? 'Mark banked' : 'Mark presented'
    if (status === 'cleared') return 'Mark cleared'
    if (status === 'bounced') return cheque.direction === 'received' ? 'Mark bounced' : 'Mark returned'
    return cheque.direction === 'received' ? 'Cancel cheque' : 'Stop cheque'
  }
  return (
    <Modal title={`Cheque ${cheque.chequeNumber}`} subtitle={`${cheque.direction === 'received' ? 'Received from' : 'Given to'} ${cheque.partyName}`} onClose={onClose} width={640}>
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
          <div><dt className="text-[10px] text-t3">Amount</dt><dd className="font-mono font-semibold">{fmtKes(cheque.amount)}</dd></div>
          <div><dt className="text-[10px] text-t3">Status</dt><dd>{STATUS_LABEL[cheque.direction][cheque.status]}</dd></div>
          <div><dt className="text-[10px] text-t3">Date on the cheque</dt><dd>{fmtDate(cheque.chequeDate)}{cheque.alert ? ` — ${alertLabel(cheque.direction, cheque.alert, cheque.chequeDate, now)}` : ''}</dd></div>
          <div><dt className="text-[10px] text-t3">Bank</dt><dd>{cheque.bankName || '—'}</dd></div>
          <div><dt className="text-[10px] text-t3">{cheque.direction === 'received' ? 'Received on' : 'Issued on'}</dt><dd>{cheque.receivedDate ? fmtDate(cheque.receivedDate) : '—'}</dd></div>
          <div><dt className="text-[10px] text-t3">For</dt><dd>{cheque.linkedRef || '—'}</dd></div>
          {cheque.notes && <div className="col-span-2"><dt className="text-[10px] text-t3">Notes</dt><dd>{cheque.notes}</dd></div>}
        </dl>
        {cheque.hasImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/cheques/${cheque.id}/image`} alt={`Cheque ${cheque.chequeNumber}`} className="max-h-64 w-full rounded-lg border object-contain" style={{ borderColor: 'var(--border-lt)' }} />
        )}
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-t4">History</p>
          <ul className="flex flex-col gap-1 text-[11px] text-t2">
            {cheque.history.map((h, i) => (
              <li key={i}>{new Date(h.at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })} — {STATUS_LABEL[cheque.direction][h.status]} by {h.by}{h.note ? ` (${h.note})` : ''}</li>
            ))}
          </ul>
        </div>
        {next.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--border-lt)' }}>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-t4">Note (required to bounce or cancel)</span>
              <input className="form-input text-[12px]" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Insufficient funds" />
            </label>
            <div className="flex flex-wrap gap-2">
              {next.map(status => (
                <button key={status} type="button" disabled={busy}
                  className={status === 'bounced' || status === 'cancelled' ? 'btn-secondary text-[12px]' : 'btn-primary text-[12px]'}
                  onClick={() => run(status)}>{label(status)}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function AddCheque({ showToast, onClose, onSaved }: { showToast: Toast; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, receivedDate: today() })
  const [image, setImage] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null)
  const [scan, setScan] = useState<Scan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm(prev => ({ ...prev, ...patch }))
  // The invoice or bill this cheque settles: picking it fills the name and
  // amount, and the payment can be recorded on it in the same step.
  const { invoices, bankAccounts, registerPayment, contacts } = useFinanceStore()
  // Who the cheque is from / paid to: searched from Contacts, or typed when not there.
  const partyContacts = useMemo(
    () => (contacts ?? [])
      .filter(c => !c.isArchived && (form.direction === 'given' ? c.isVendor : c.isCustomer))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [contacts, form.direction],
  )
  const sameParty = (name?: string) => !!name && !!form.partyName.trim() && name.trim().toLowerCase() === form.partyName.trim().toLowerCase()
  const openDocs = useMemo(() => openDocsForCheque(invoices, form.direction), [invoices, form.direction])
  // One cheque often pays several bills (or invoices): they are listed here.
  const [linkedIds, setLinkedIds] = useState<string[]>([])
  const [docQuery, setDocQuery] = useState('')
  const linkedDocs = useMemo(
    () => linkedIds.map(id => openDocs.find(d => d.id === id)).filter(Boolean) as typeof openDocs,
    [linkedIds, openDocs],
  )
  const linkedTotal = useMemo(() => Math.round(linkedDocs.reduce((s, d) => s + docBalance(d), 0) * 100) / 100, [linkedDocs])
  const allocation = useMemo(() => allocateCheque(Number(form.amount) || 0, linkedDocs as any[]), [form.amount, linkedDocs])
  const [recordPayment, setRecordPayment] = useState(true)
  const [payBankId, setPayBankId] = useState('')
  const activeBanks = bankAccounts.filter(b => b.active)

  // Adding a document fills the name and keeps the amount at the total owed,
  // unless the amount was typed (or scanned) as something else.
  const amountFollowsTotal = !form.amount || Number(form.amount) === linkedTotal
  const pickDoc = (ref: string) => {
    const doc = findDocByRef(openDocs, ref)
    if (!doc) { setDocQuery(ref); return }
    setDocQuery('')
    if (linkedIds.includes(doc.id)) return
    const nextTotal = Math.round((linkedTotal + docBalance(doc)) * 100) / 100
    setLinkedIds(ids => [...ids, doc.id])
    set({
      partyName: form.partyName || doc.partnerName || '',
      amount: amountFollowsTotal ? String(nextTotal) : form.amount,
      // A cheque we write is usually dated the day it is issued.
      chequeDate: form.chequeDate || (form.direction === 'given' ? form.receivedDate : ''),
    })
  }
  const removeDoc = (id: string) => {
    const doc = linkedDocs.find(d => d.id === id)
    setLinkedIds(ids => ids.filter(x => x !== id))
    if (doc && amountFollowsTotal) set({ amount: String(Math.round((linkedTotal - docBalance(doc)) * 100) / 100 || '') })
  }

  const fillFrom = (result: Scan, direction: ChequeDirection) => set({
    chequeNumber: result.chequeNumber || form.chequeNumber,
    bankName: result.bankName || form.bankName,
    partyName: (direction === 'received' ? result.accountName : result.payeeName) || form.partyName,
    amount: result.amount ? String(result.amount) : form.amount,
    chequeDate: result.chequeDate || form.chequeDate,
  })

  const onPhoto = async (file: File) => {
    setScanning(true)
    setScan(null)
    try {
      const prepared = await prepareImage(file)
      setImage(prepared)
      const result = await readJson<Scan>(await fetch('/api/cheques/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: prepared.base64, mimeType: prepared.mimeType }),
      }))
      setScan(result)
      fillFrom(result, form.direction)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read the cheque', 'error')
    } finally {
      setScanning(false)
    }
  }

  const setDirection = (direction: ChequeDirection) => {
    // Invoices belong to received cheques and bills to given ones.
    if (direction !== form.direction) { setLinkedIds([]); setDocQuery('') }
    set({ direction })
    if (scan) set({ direction, partyName: (direction === 'received' ? scan.accountName : scan.payeeName) || '' })
  }

  const stale = form.chequeDate && isStaleCheque(form.chequeDate, today())
  const alert = form.chequeDate ? chequeAlert({ status: 'pending', chequeDate: form.chequeDate }, today()) : null

  const save = async () => {
    setSaving(true)
    try {
      await readJson(await fetch('/api/cheques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          amount: Number(form.amount),
          linkedRef: linkedDocs.length ? chequeLinkedRefs(linkedDocs.map(d => d.ref)) : form.linkedRef,
          linkedType: linkedDocs.length ? chequeLinkedType(linkedDocs[0].type) : undefined,
          // Every document the cheque covers, even when the short reference had to shorten.
          notes: linkedDocs.length > 1
            ? [form.notes.trim(), `Covers ${linkedDocs.map(d => d.ref).join(', ')}`].filter(Boolean).join(' · ').slice(0, 1000)
            : form.notes,
          imageBase64: image?.base64,
          imageType: image?.mimeType,
        }),
      }))
      showToast(`Cheque ${form.chequeNumber} added`, 'success')
      if (linkedDocs.length && recordPayment) {
        const failed: string[] = []
        let recorded = 0
        for (const { doc, amount } of allocation) {
          if (!(amount > 0)) continue
          const paid = await registerPayment(doc.id, amount, 'cheque', payBankId || undefined, `Cheque ${form.chequeNumber}`, form.receivedDate || today())
          if (paid) recorded += amount
          else failed.push(doc.ref)
        }
        if (recorded > 0) showToast(`${fmtKes(recorded)} recorded on ${allocation.filter(a => a.amount > 0 && !failed.includes(a.doc.ref)).map(a => a.doc.ref).join(', ')}`, 'success')
        if (failed.length) showToast(`The cheque is in the register, but the payment on ${failed.join(', ')} was not recorded — record it from the ${linkedDocs[0].type === 'vendor_bill' ? 'bill' : 'invoice'}`, 'error')
      }
      await onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the cheque', 'error')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, node: React.ReactNode, span = false) => (
    <label className={`flex flex-col gap-1 ${span ? 'sm:col-span-2' : ''}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-t4">{label}</span>
      {node}
    </label>
  )

  return (
    <Modal title="Add cheque" subtitle="Scan a photo of the cheque or type the details in" onClose={onClose} width={680}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3" style={{ borderColor: 'var(--border)' }}>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.currentTarget.value = '' }} />
          <button type="button" className="btn-secondary text-[12px]" disabled={scanning} onClick={() => fileRef.current?.click()}>
            {scanning ? 'Reading the cheque…' : image ? 'Scan another photo' : 'Scan cheque photo'}
          </button>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.previewUrl} alt="Cheque preview" className="h-16 rounded border object-contain" style={{ borderColor: 'var(--border-lt)' }} />
          )}
          <p className="min-w-[200px] flex-1 text-[11px] text-t3">Take a clear, flat photo with the whole cheque in view. The details fill in below — check each one before saving.</p>
        </div>

        {scan && scan.warnings.length > 0 && (
          <ul className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            {scan.warnings.map(w => <li key={w}>• {w}</li>)}
          </ul>
        )}

        <div className="inventory-view-segmented w-fit" role="radiogroup" aria-label="Cheque type">
          {([['received', 'Received from a customer'], ['given', 'Given to a supplier']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={form.direction === value}
              className={`inventory-view-seg ${form.direction === value ? 'is-on' : ''}`} onClick={() => setDirection(value)}>{label}</button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('Cheque number', <input className="form-input text-[12px]" value={form.chequeNumber} onChange={e => set({ chequeNumber: e.target.value })} inputMode="numeric" />)}
          {field('Bank', <input className="form-input text-[12px]" value={form.bankName} onChange={e => set({ bankName: e.target.value })} />)}
          {field(form.direction === 'received' ? 'From (account holder)' : 'Paid to', (
            <>
              <input
                className="form-input text-[12px]"
                list="cheque-parties"
                value={form.partyName}
                onChange={e => set({ partyName: e.target.value })}
                placeholder={form.direction === 'received' ? 'Search customers or type the name on the cheque' : 'Search suppliers or type a name'}
                autoComplete="off"
              />
              <datalist id="cheque-parties">
                {partyContacts.slice(0, 500).map(c => (
                  <option key={c.id} value={c.name}>{[c.phone, c.email].filter(Boolean).join(' · ')}</option>
                ))}
              </datalist>
            </>
          ), true)}
          {field('Amount (KES)', <input className="form-input text-[12px]" type="number" min="0" step="0.01" value={form.amount} onChange={e => set({ amount: e.target.value })} />)}
          {field('Date on the cheque', <input className="form-input text-[12px]" type="date" value={form.chequeDate} onChange={e => set({ chequeDate: e.target.value })} />)}
          {field(form.direction === 'received' ? 'Received on' : 'Issued on', <input className="form-input text-[12px]" type="date" value={form.receivedDate} onChange={e => set({ receivedDate: e.target.value })} />)}
          {field(form.direction === 'received' ? (linkedDocs.length ? 'Add another invoice' : 'For invoice(s)') : (linkedDocs.length ? 'Add another bill' : 'For bill(s)'), (
            <>
              <input
                className="form-input text-[12px]"
                list="cheque-open-docs"
                value={docQuery}
                onChange={e => pickDoc(e.target.value)}
                placeholder={(() => {
                  const kind = form.direction === 'received' ? 'invoices' : 'bills'
                  const mine = openDocs.filter(d => sameParty(d.partnerName) && !linkedIds.includes(d.id)).length
                  if (mine) return `${mine} open ${mine === 1 ? kind.slice(0, -1) : kind} for ${form.partyName.trim()} — pick…`
                  return openDocs.length ? `Pick from ${openDocs.length} open ${kind}…` : 'e.g. INV/2026/0191'
                })()}
              />
              <datalist id="cheque-open-docs">
                {openDocs
                  .filter(d => !linkedIds.includes(d.id))
                  // The chosen supplier's / customer's documents come first.
                  .sort((a, b) => {
                    const rank = (d: typeof a) => (sameParty(d.partnerName) ? 2 : 0) + (d.partnerName === linkedDocs[0]?.partnerName ? 1 : 0)
                    return rank(b) - rank(a)
                  })
                  .slice(0, 300)
                  .map(d => (
                    <option key={d.id} value={d.ref}>{`${d.partnerName ?? ''} · ${fmtKes(docBalance(d))} owing`}</option>
                  ))}
              </datalist>
            </>
          ))}
          {field('Notes', <input className="form-input text-[12px]" value={form.notes} onChange={e => set({ notes: e.target.value })} />, true)}
        </div>

        {linkedDocs.length > 0 && (
          <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--border-lt)' }}>
            <table className="w-full" data-no-responsive>
              <tbody>
                {allocation.map(({ doc, amount }) => (
                  <tr key={doc.id} className="border-b last:border-0" style={{ borderColor: 'var(--border-lt)' }}>
                    <td className="py-1.5 pr-2 font-mono text-t1">{doc.ref}</td>
                    <td className="py-1.5 pr-2 text-t3">{doc.partnerName}</td>
                    <td className="py-1.5 pr-2 text-right text-t3 whitespace-nowrap">{fmtKes(docBalance(doc))} owing</td>
                    <td className="py-1.5 pr-2 text-right font-semibold whitespace-nowrap">{amount > 0 ? `pays ${fmtKes(amount)}` : 'not covered'}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" className="text-[11px] text-red-600 underline" onClick={() => removeDoc(doc.id)} aria-label={`Remove ${doc.ref}`}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {linkedDocs.length > 1 && (
              <p className="mt-1.5 text-t3">
                Total owing {fmtKes(linkedTotal)}
                {Number(form.amount) > 0 && Math.abs(Number(form.amount) - linkedTotal) >= 0.01 && (
                  Number(form.amount) < linkedTotal
                    ? ` · the cheque covers ${fmtKes(Number(form.amount))}, paid oldest first`
                    : ` · the cheque is ${fmtKes(Number(form.amount) - linkedTotal)} more than owed; only what is owed is recorded`
                )}
              </p>
            )}
            <label className="mt-2 flex items-center gap-2 text-t1">
              <input type="checkbox" checked={recordPayment} onChange={e => setRecordPayment(e.target.checked)} />
              {form.direction === 'received'
                ? `Also record this as a receipt on the ${linkedDocs.length > 1 ? 'invoices' : 'invoice'}`
                : `Also record this as a payment on the ${linkedDocs.length > 1 ? 'bills' : 'bill'}`}
            </label>
            {recordPayment && activeBanks.length > 0 && (
              <select
                className="form-input mt-2 text-[12px]"
                value={payBankId}
                aria-label="Bank account"
                onChange={e => {
                  setPayBankId(e.target.value)
                  // Our own cheque is drawn on this account: that is its bank.
                  const bank = activeBanks.find(b => b.id === e.target.value)
                  if (form.direction === 'given' && bank && !form.bankName) set({ bankName: bank.bankName || bank.name })
                }}
              >
                <option value="">{form.direction === 'received' ? 'Bank account it will be banked into…' : 'Bank account it is drawn on…'}</option>
                {activeBanks.map(b => <option key={b.id} value={b.id}>{b.bankName || b.name}</option>)}
              </select>
            )}
          </div>
        )}

        {stale && <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">This cheque is over six months old, so the bank will treat it as stale.</p>}
        {alert === 'overdue' && !stale && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">The date on this cheque has already passed{form.direction === 'received' ? ' — it can be banked now' : ''}.</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-[12px]" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary text-[12px]" disabled={saving || scanning} onClick={save}>{saving ? 'Saving…' : 'Add cheque'}</button>
        </div>
      </div>
    </Modal>
  )
}
