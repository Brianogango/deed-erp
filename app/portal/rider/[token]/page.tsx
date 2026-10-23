'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Item = {
  id: string; direction: 'out' | 'in'; description: string; serial: string; qty: number
  status?: 'done' | 'not_done'; received: boolean
  unplanned?: { reason: string; billOnInvoice: boolean; note: string }
}
type Cash = { amount: number; method: 'cash' | 'mpesa'; reference?: string }
type Stop = {
  id: string; kind: 'drop' | 'collect' | 'exchange'; address: string; contactName: string; contactPhone: string; notes: string
  status: 'pending' | 'done' | 'failed'; doneAt?: string; recipientName?: string; failureReason?: string
  cashCollected?: Cash; items: Item[]
}
type Job = {
  id: string; ref: string; type: string; status: string
  customerName: string; customerPhone: string
  pickupAddress: string; deliveryAddress: string
  scheduledDate: string; pickedUpAt?: string; deliveredAt?: string
  notes: string; document: string; fee: number
  recipientName?: string; failureReason?: string
  cashCollected?: Cash; cashTotal: number
  stops: Stop[]; hasStops: boolean; progress: { done: number; total: number }
  carrying: Array<{ id: string; description: string; serial: string; qty: number; direction: 'out' | 'in'; stopAddress: string }>
  stopsFinished: boolean; backAtShopAt?: string
}
type Week = { weekStart: string; trips: number; earned: number; cashCollected: number; paid: boolean }
type View = { rider: { name: string; vehicle: string; rate: number }; open: Job[]; recent: Job[]; weeks: Week[] }

const kes = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE')}`
const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 focus:border-[#1B2762] focus:outline-none focus:ring-2 focus:ring-[#1B2762]/15'
const btn = 'w-full rounded-xl px-4 py-3 text-base font-semibold disabled:opacity-50'
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
const fmtDay = (d?: string) => {
  if (!d) return ''
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
}
const fmtTime = (d?: string) => {
  if (!d) return ''
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
}
const weekLabel = (start: string) => {
  const s = new Date(`${start}T00:00:00Z`)
  const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6)
  const f = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(s)} – ${f(e)}`
}

function Pin({ firstName, onDone }: { firstName: string; onDone: () => void }) {
  const { token } = useParams<{ token: string }>()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true); setError('')
    const res = await fetch(`/api/portal/rider/${token}/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) onDone()
    else setError(body.error || 'Could not check the PIN')
  }
  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-lg font-bold text-[#1B2762]">Hi {firstName}</p>
      <p className="mt-1 text-sm text-slate-600">Enter your PIN: the last 4 digits of your ID number.</p>
      <input
        className={`${input} mt-4 text-center text-2xl tracking-[0.5em]`}
        inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={pin}
        onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onKeyDown={e => { if (e.key === 'Enter' && pin.length === 4) void submit() }}
        aria-label="PIN"
      />
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <button className={`${btn} mt-4 bg-[#1B2762] text-white`} disabled={pin.length !== 4 || busy} onClick={() => void submit()}>
        {busy ? 'Checking…' : 'Open my jobs'}
      </button>
    </div>
  )
}

type Update = (jobId: string, body: Record<string, unknown>) => Promise<string | null>

const KIND: Record<Stop['kind'], { label: string; done: string; who: string; badge: string }> = {
  drop: { label: 'Drop off', done: 'Delivered', who: 'Who received it?', badge: 'bg-emerald-100 text-emerald-800' },
  collect: { label: 'Collect', done: 'Collected', who: 'Who handed it to you?', badge: 'bg-sky-100 text-sky-800' },
  exchange: { label: 'Exchange', done: 'Exchanged', who: 'Who did you deal with?', badge: 'bg-violet-100 text-violet-800' },
}
const REASONS: Array<[string, string]> = [['return', 'Customer return'], ['repair', 'For repair'], ['exchange', 'Exchange'], ['other', 'Other']]
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

function ItemLine({ item }: { item: Item }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${item.direction === 'out' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
        {item.direction === 'out' ? 'GIVE' : 'BRING BACK'}
      </span>
      <span className="flex-1 text-slate-800">
        {item.qty > 1 ? `${item.qty} × ` : ''}{item.description}{item.serial ? <span className="text-slate-500"> · {item.serial}</span> : null}
        {item.unplanned && <span className="block text-xs text-orange-700">Customer gave this{item.unplanned.billOnInvoice ? ' · bill on their invoice' : ''}{item.unplanned.note ? ` · ${item.unplanned.note}` : ''}</span>}
        {item.status === 'not_done' && <span className="block text-xs font-semibold text-rose-600">Not handed over — bring it back</span>}
      </span>
    </li>
  )
}

function StopCard({ jobId, stop, index, isNext, canAct, onUpdate }: {
  jobId: string; stop: Stop; index: number; isNext: boolean; canAct: boolean; onUpdate: Update
}) {
  const [mode, setMode] = useState<'idle' | 'done' | 'fail' | 'add'>('idle')
  const [recipient, setRecipient] = useState('')
  const [missing, setMissing] = useState<Record<string, boolean>>({})
  const [paid, setPaid] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'mpesa'>('cash')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [what, setWhat] = useState('')
  const [serial, setSerial] = useState('')
  const [qty, setQty] = useState('1')
  const [why, setWhy] = useState('return')
  const [bill, setBill] = useState(false)
  const [note, setNote] = useState('')
  const [addId, setAddId] = useState(newId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const k = KIND[stop.kind]
  const planned = stop.items.filter(i => !i.unplanned)

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setError('')
    const err = await onUpdate(jobId, { ...body, stopId: stop.id })
    setBusy(false)
    if (err) { setError(err); return }
    if (body.action === 'add_item') { setWhat(''); setSerial(''); setQty('1'); setNote(''); setBill(false); setAddId(newId()) }
    setMode('idle')
  }

  return (
    <section className={`rounded-xl border p-3 ${isNext ? 'border-[#1B2762]/40 bg-white' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-900">
          <span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#1B2762] text-xs text-white">{index + 1}</span>
          {k.label}
        </p>
        {stop.status === 'done' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">{k.done}</span>}
        {stop.status === 'failed' && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">Not done</span>}
        {stop.status === 'pending' && isNext && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${k.badge}`}>Next</span>}
      </div>
      <a className="mt-2 block text-sm text-slate-900 underline decoration-slate-300" href={mapsUrl(stop.address)} target="_blank" rel="noreferrer">{stop.address || '—'}</a>
      {stop.contactName && <p className="text-sm text-slate-600">{stop.contactName}</p>}
      {stop.status === 'pending' && stop.contactPhone && (
        <a className="mt-2 block rounded-xl border border-[#1B2762]/20 p-2.5 text-center text-sm font-semibold text-[#1B2762]" href={`tel:${stop.contactPhone}`}>Call {stop.contactPhone}</a>
      )}
      {stop.notes && <p className="mt-2 rounded-xl bg-orange-50 p-2.5 text-sm text-orange-900">{stop.notes}</p>}
      {stop.items.length > 0 && <ul className="mt-2 space-y-1.5 text-sm">{stop.items.map(i => <ItemLine key={i.id} item={i} />)}</ul>}
      {stop.status === 'failed' && stop.items.some(i => i.direction === 'in' && !i.unplanned) && (
        <p className="mt-1 text-xs font-semibold text-slate-600">Nothing collected here.</p>
      )}
      {stop.status === 'done' && (
        <p className="mt-2 text-xs text-slate-500">
          {stop.recipientName ? `${stop.kind === 'collect' ? 'From' : 'Received by'} ${stop.recipientName}` : ''} {fmtTime(stop.doneAt)}
          {stop.cashCollected ? ` · you collected ${kes(stop.cashCollected.amount)}` : ''}
        </p>
      )}
      {stop.status === 'failed' && <p className="mt-2 text-xs text-rose-600">{stop.failureReason}</p>}

      {error && <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>}

      {canAct && mode === 'idle' && stop.status === 'pending' && (
        <div className="mt-3 grid gap-2">
          <button className={`${btn} bg-emerald-600 text-white`} disabled={busy} onClick={() => setMode('done')}>{k.done}</button>
          <div className="grid grid-cols-2 gap-2">
            <button className={`${btn} border border-slate-300 bg-white text-sm text-slate-700`} disabled={busy} onClick={() => setMode('add')}>Customer gave me something</button>
            <button className={`${btn} border border-slate-300 bg-white text-sm text-slate-700`} disabled={busy} onClick={() => setMode('fail')}>Couldn’t do this stop</button>
          </div>
        </div>
      )}
      {canAct && mode === 'idle' && stop.status === 'done' && (
        <button className="mt-2 text-sm font-semibold text-[#1B2762] underline" onClick={() => setMode('add')}>Customer gave me something else</button>
      )}

      {mode === 'done' && (
        <div className="mt-3 space-y-3 rounded-xl bg-emerald-50 p-3">
          {planned.length > 0 && (
            <div className="space-y-1.5">
              <span className="block text-sm font-semibold text-slate-700">Untick anything you could not {stop.kind === 'collect' ? 'collect' : 'do'}</span>
              {planned.map(i => (
                <label key={i.id} className="flex items-center gap-2 text-sm text-slate-800">
                  <input type="checkbox" className="h-5 w-5" checked={!missing[i.id]} onChange={e => setMissing(m => ({ ...m, [i.id]: !e.target.checked }))} />
                  {i.direction === 'out' ? 'Gave' : 'Took back'}: {i.description}{i.serial ? ` · ${i.serial}` : ''}
                </label>
              ))}
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">{k.who}</span>
            <input className={input} value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Full name" autoComplete="off" />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={paid} onChange={e => setPaid(e.target.checked)} />
            The customer paid me
          </label>
          {paid && (
            <div className="space-y-2">
              <input className={input} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Amount (KES)" />
              <div className="grid grid-cols-2 gap-2">
                {(['cash', 'mpesa'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setMethod(m)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${method === m ? 'border-[#1B2762] bg-[#1B2762] text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                    {m === 'cash' ? 'Cash' : 'M-Pesa to me'}
                  </button>
                ))}
              </div>
              {method === 'mpesa' && (
                <input className={input} value={reference} onChange={e => setReference(e.target.value.toUpperCase())} placeholder="M-Pesa code" autoCapitalize="characters" />
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className={`${btn} border border-slate-300 bg-white text-slate-700`} disabled={busy} onClick={() => setMode('idle')}>Back</button>
            <button className={`${btn} bg-emerald-600 text-white`} disabled={busy || recipient.trim().length < 2 || (paid && !(Number(amount) > 0))}
              onClick={() => void send({
                action: 'stop_done', recipientName: recipient,
                items: Object.fromEntries(planned.map(i => [i.id, missing[i.id] ? 'not_done' : 'done'])),
                cash: paid ? { amount: Number(amount), method, reference } : undefined,
              })}>
              {busy ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {mode === 'fail' && (
        <div className="mt-3 space-y-3 rounded-xl bg-rose-50 p-3">
          <span className="block text-sm font-semibold text-slate-700">Why?</span>
          <div className="grid gap-2">
            {['Customer not reachable', 'Customer not available', 'Wrong address', 'Customer refused'].map(r => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={`rounded-xl border px-3 py-2.5 text-left text-sm font-semibold ${reason === r ? 'border-rose-600 bg-white text-rose-700' : 'border-slate-300 bg-white text-slate-700'}`}>{r}</button>
            ))}
          </div>
          <input className={input} value={reason} onChange={e => setReason(e.target.value)} placeholder="Or type the reason" />
          {stop.items.some(i => i.direction === 'out') && <p className="text-xs text-slate-600">Bring the items for this stop back to the shop.</p>}
          <div className="grid grid-cols-2 gap-2">
            <button className={`${btn} border border-slate-300 bg-white text-slate-700`} disabled={busy} onClick={() => setMode('idle')}>Back</button>
            <button className={`${btn} bg-rose-600 text-white`} disabled={busy || reason.trim().length < 3} onClick={() => void send({ action: 'stop_failed', reason })}>
              {busy ? 'Saving…' : 'Report'}
            </button>
          </div>
        </div>
      )}

      {mode === 'add' && (
        <div className="mt-3 space-y-3 rounded-xl bg-orange-50 p-3">
          <span className="block text-sm font-semibold text-slate-700">What did the customer give you to bring back?</span>
          <input className={input} value={what} onChange={e => setWhat(e.target.value)} placeholder="e.g. HP charger, Dell laptop" />
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <input className={input} value={serial} onChange={e => setSerial(e.target.value.toUpperCase())} placeholder="Serial no. (if any)" autoCapitalize="characters" />
            <input className={input} inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Quantity" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map(([v, l]) => (
              <button key={v} type="button" onClick={() => setWhy(v)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${why === v ? 'border-[#1B2762] bg-[#1B2762] text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{l}</button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={bill} onChange={e => setBill(e.target.checked)} />
            Customer said to put it on their invoice
          </label>
          <input className={input} value={note} onChange={e => setNote(e.target.value)} placeholder="What the customer said (optional)" />
          <div className="grid grid-cols-2 gap-2">
            <button className={`${btn} border border-slate-300 bg-white text-slate-700`} disabled={busy} onClick={() => setMode('idle')}>Back</button>
            <button className={`${btn} bg-orange-600 text-white`} disabled={busy || what.trim().length < 2}
              onClick={() => void send({ action: 'add_item', id: addId, description: what, serial, qty: Number(qty) || 1, reason: why, billOnInvoice: bill, note })}>
              {busy ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function JobCard({ job, onUpdate }: { job: Job; onUpdate: Update }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setError('')
    const err = await onUpdate(job.id, body)
    setBusy(false)
    if (err) setError(err)
  }
  const nextIdx = job.stops.findIndex(s => s.status === 'pending')
  const returning = job.stopsFinished && job.carrying.length > 0

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{job.ref}{job.document ? ` · ${job.document}` : ''}</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">{job.customerName || 'Customer'}</p>
          <p className="text-sm text-slate-500">
            {fmtDay(job.scheduledDate)} · your fee {kes(job.fee)}{job.stops.length > 1 ? ` · ${job.progress.done} of ${job.progress.total} stops` : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${returning ? 'bg-sky-100 text-sky-800' : job.status === 'in_transit' ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-700'}`}>
          {returning ? 'Bring back' : job.status === 'in_transit' ? 'On the way' : 'Assigned'}
        </span>
      </div>

      {job.pickupAddress && (
        <a className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm" href={mapsUrl(job.pickupAddress)} target="_blank" rel="noreferrer">
          <span className="font-semibold text-slate-500">Start</span>
          <span className="flex-1 text-slate-900 underline decoration-slate-300">{job.pickupAddress}</span>
        </a>
      )}
      {job.notes && <p className="mt-2 rounded-xl bg-orange-50 p-3 text-sm text-orange-900">{job.notes}</p>}

      {job.status === 'assigned' && (
        <button className={`${btn} mt-3 bg-orange-500 text-white`} disabled={busy} onClick={() => void send({ action: 'picked_up' })}>
          {busy ? 'Saving…' : 'Picked up — start trip'}
        </button>
      )}

      <div className="mt-3 space-y-2">
        {job.stops.map((s, i) => (
          <StopCard key={s.id} jobId={job.id} stop={s} index={i} isNext={i === nextIdx} canAct={job.status === 'in_transit'} onUpdate={onUpdate} />
        ))}
      </div>

      {job.carrying.length > 0 && (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
          <p className="font-bold text-sky-900">You are carrying — bring back to the shop</p>
          <ul className="mt-1 list-disc pl-5 text-sky-900">
            {job.carrying.map(c => <li key={c.id}>{c.qty > 1 ? `${c.qty} × ` : ''}{c.description}{c.serial ? ` · ${c.serial}` : ''}</li>)}
          </ul>
          {returning && !job.backAtShopAt && (
            <button className={`${btn} mt-3 bg-[#1B2762] text-white`} disabled={busy} onClick={() => void send({ action: 'back_at_shop' })}>
              {busy ? 'Saving…' : 'I’m back at the shop'}
            </button>
          )}
          {job.backAtShopAt && <p className="mt-2 font-semibold text-sky-900">Waiting for the office to check the items in.</p>}
        </div>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}
    </article>
  )
}

export default function RiderPage() {
  const { token } = useParams<{ token: string }>()
  const [view, setView] = useState<View | null>(null)
  const [pinFor, setPinFor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'jobs' | 'trips'>('jobs')

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/rider/${token}`, { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 && body.needPin) { setPinFor(body.firstName || 'there'); return }
    if (!res.ok) { setError(body.error || 'Could not load your jobs'); return }
    setPinFor(null); setError(''); setView(body)
  }, [token])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    return () => clearInterval(t)
  }, [load])

  const update = async (jobId: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/portal/rider/${token}/jobs/${jobId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) return out.error || 'Could not save. Try again.'
    await load()
    return null
  }

  const thisWeek = view?.weeks[0]
  return (
    <main className="h-[100dvh] overflow-y-auto overscroll-contain bg-slate-100 px-4 pb-10 pt-6">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deed Technologies · Rider</p>
            <h1 className="text-xl font-bold text-[#1B2762]">{view ? view.rider.name : 'My deliveries'}</h1>
          </div>
          {view && <button className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700" onClick={() => void load()}>Refresh</button>}
        </header>

        {error && <p className="rounded-2xl border border-rose-200 bg-white p-4 text-sm text-rose-700">{error}</p>}
        {pinFor && <Pin firstName={pinFor} onDone={() => void load()} />}

        {view && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-white p-3 shadow-sm"><p className="text-xs text-slate-500">Open jobs</p><p className="text-xl font-bold text-slate-900">{view.open.length}</p></div>
              <div className="rounded-2xl bg-white p-3 shadow-sm"><p className="text-xs text-slate-500">Trips this week</p><p className="text-xl font-bold text-slate-900">{thisWeek?.trips ?? 0}</p></div>
              <div className="rounded-2xl bg-white p-3 shadow-sm"><p className="text-xs text-slate-500">Earned this week</p><p className="text-base font-bold text-emerald-700">{kes(thisWeek?.earned ?? 0)}</p></div>
            </div>

            <div className="grid grid-cols-2 rounded-xl bg-white p-1 shadow-sm">
              {(['jobs', 'trips'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} className={`rounded-lg py-2 text-sm font-semibold ${tab === t ? 'bg-[#1B2762] text-white' : 'text-slate-600'}`}>
                  {t === 'jobs' ? 'My jobs' : 'My trips'}
                </button>
              ))}
            </div>

            {tab === 'jobs' && (
              view.open.length
                ? view.open.map(job => <JobCard key={job.id} job={job} onUpdate={update} />)
                : <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">No jobs assigned to you right now.</p>
            )}

            {tab === 'trips' && (
              <>
                <section className="rounded-2xl bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-bold text-slate-900">By week</h2>
                  <table className="mt-2 w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Week</th><th className="py-1 text-right">Trips</th><th className="py-1 text-right">Earned</th><th className="py-1 text-right">Paid</th></tr></thead>
                    <tbody>
                      {view.weeks.map(w => (
                        <tr key={w.weekStart} className="border-t border-slate-100">
                          <td className="py-2">{weekLabel(w.weekStart)}</td>
                          <td className="py-2 text-right font-semibold">{w.trips}</td>
                          <td className="py-2 text-right">{kes(w.earned)}</td>
                          <td className="py-2 text-right">{w.trips === 0 ? '—' : w.paid ? <span className="font-semibold text-emerald-700">Paid</span> : <span className="text-orange-700">Pending</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {view.weeks.some(w => w.cashCollected > 0) && (
                    <p className="mt-2 text-xs text-slate-500">Cash you collected this week: {kes(thisWeek?.cashCollected ?? 0)} — hand it over to the office.</p>
                  )}
                </section>
                <section className="space-y-2">
                  <h2 className="px-1 text-sm font-bold text-slate-900">Last two weeks</h2>
                  {view.recent.length === 0 && <p className="rounded-2xl bg-white p-4 text-center text-sm text-slate-500 shadow-sm">No finished trips yet.</p>}
                  {view.recent.map(j => (
                    <div key={j.id} className="rounded-2xl bg-white p-3 text-sm shadow-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold text-slate-900">{j.customerName}</span>
                        <span className={j.status === 'delivered' ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-600'}>
                          {j.status === 'delivered' ? 'Delivered' : 'Not delivered'}
                        </span>
                      </div>
                      <p className="text-slate-500">
                        {j.ref} · {fmtDay(j.deliveredAt || j.scheduledDate)} {fmtTime(j.deliveredAt)}
                        {j.status === 'delivered' ? ` · ${kes(j.fee)}` : ''}
                      </p>
                      {j.recipientName && <p className="text-slate-600">Received by {j.recipientName}</p>}
                      {j.failureReason && <p className="text-slate-600">{j.failureReason}</p>}
                      {j.stops.length > 1 && <p className="text-slate-600">{j.stops.length} stops: {j.stops.map(s => `${KIND[s.kind].label}${s.status === 'failed' ? ' (not done)' : ''}`).join(', ')}</p>}
                      {j.cashTotal > 0 && <p className="text-slate-600">Collected {kes(j.cashTotal)}{j.cashCollected ? ` (${j.cashCollected.method === 'mpesa' ? `M-Pesa ${j.cashCollected.reference ?? ''}` : 'cash'})` : ''}</p>}
                    </div>
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
