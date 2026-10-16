'use client'

import { useState } from 'react'
import type { SerialCountReport } from '@/lib/inventory/serial-count-compare'

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`


type Hold = { serial: string; productName: string; status: string; orderRef: string; orderStatus: string; reason: string }

/** Serials held for an order that was cancelled, set back to a quotation, or no longer exists. */
function StaleHolds() {
  const [items, setItems] = useState<Hold[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const call = async (apply: boolean) => {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/inventory/stale-serial-holds', apply
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: true }) }
        : undefined)
      const data = await res.json().catch(() => null)
      if (!res.ok) { setMsg(data?.error || 'Could not check the held serials'); return }
      if (apply) { setMsg(`${data.released} serial(s) released back to available stock`); setItems(null) } else setItems(data.items ?? [])
    } catch { setMsg('Could not check the held serials') } finally { setBusy(false) }
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-bold">Serials held for orders that no longer need them</p>
          <p className="text-[11px] text-t3">Held (assigned or reserved) for a sales order that is cancelled, back to a quotation, or gone.</p>
        </div>
        <button className="btn-outline text-[12px]" onClick={() => void call(false)} disabled={busy}>{busy && items === null ? 'Checking…' : 'Check held serials'}</button>
      </div>
      {msg && <p className="mt-2 text-[12px]">{msg}</p>}
      {items !== null && (items.length === 0
        ? <p className="mt-2 text-[12px]" style={{ color: 'var(--success)' }}>No stale holds.</p>
        : (
          <div className="mt-3">
            <ul className="text-[11px] mb-3 space-y-1">
              {items.map(i => <li key={i.serial + i.orderRef}><span className="font-mono">{i.serial}</span> · {i.productName} · {i.orderRef} · {i.reason}</li>)}
            </ul>
            <button className="btn-primary text-[12px]" onClick={() => void call(true)} disabled={busy}>{busy ? 'Releasing…' : `Release ${items.length} serial${items.length === 1 ? '' : 's'}`}</button>
          </div>
        ))}
    </div>
  )
}

type AuditRow = { ref: string; customer: string; total: number; date: string; invoices: string[]; deliveries: string[]; heldSerials: number }
type Audit = {
  checkedOrders: number
  invoicedBeforeDelivery: Array<AuditRow & { invoiced: number; paid: number }>
  possibleDuplicates: Array<{ customer: string; total: number; orders: AuditRow[] }>
}
const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`

/** Confirmed orders invoiced before any delivery was done, and orders that look entered more than once. */
function OrderAuditCard() {
  const [audit, setAudit] = useState<Audit | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const run = async () => {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/sales/order-audit')
      const data = await res.json().catch(() => null)
      if (!res.ok) { setMsg(data?.error || 'Could not run the audit'); return }
      setAudit(data)
    } catch { setMsg('Could not run the audit') } finally { setBusy(false) }
  }
  return (
    <div className="card p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-bold">Sales order audit</p>
          <p className="text-[11px] text-t3">Confirmed orders invoiced before any delivery was done, and orders that look entered more than once.</p>
        </div>
        <button className="btn-outline text-[12px]" onClick={() => void run()} disabled={busy}>{busy ? 'Checking…' : 'Run audit'}</button>
      </div>
      {msg && <p className="mt-2 text-[12px]">{msg}</p>}
      {audit && (
        <div className="mt-3 text-[12px]">
          <p className="mb-2 text-t3">{audit.checkedOrders} confirmed order(s) checked.</p>
          <p className="font-semibold">Invoiced, but no delivery done ({audit.invoicedBeforeDelivery.length})</p>
          {audit.invoicedBeforeDelivery.length === 0 ? <p className="mb-3 text-t3">None.</p> : (
            <ul className="mb-3 space-y-1 text-[11px]">
              {audit.invoicedBeforeDelivery.map(o => (
                <li key={o.ref}><span className="font-mono">{o.ref}</span> · {o.customer} · invoiced {kes(o.invoiced)}, paid {kes(o.paid)} · {o.invoices.join(', ')} · deliveries: {o.deliveries.join(', ') || 'none'} · {o.heldSerials} serial(s) held</li>
              ))}
            </ul>
          )}
          <p className="font-semibold">Possible duplicate orders ({audit.possibleDuplicates.length} group{audit.possibleDuplicates.length === 1 ? '' : 's'})</p>
          {audit.possibleDuplicates.length === 0 ? <p className="text-t3">None.</p> : (
            <ul className="space-y-2 text-[11px]">
              {audit.possibleDuplicates.map(g => (
                <li key={g.customer + g.total}>
                  <b>{g.customer}</b> · {kes(g.total)} · {g.orders.length} orders
                  <ul className="ml-4 mt-0.5">
                    {g.orders.map(o => <li key={o.ref}><span className="font-mono">{o.ref}</span> · {o.date} · invoices: {o.invoices.join(', ') || 'none'} · deliveries: {o.deliveries.join(', ') || 'none'} · {o.heldSerials} serial(s) held</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Inventory → Serial count check: paste or upload the serials counted on the shelf. */
export default function SerialCountCheck() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<SerialCountReport | null>(null)

  const parse = (raw: string) => raw.split(/[\n,;\t]+/).map(s => s.trim()).filter(Boolean)

  const run = async () => {
    const serials = parse(text)
    if (serials.length === 0) { setError('Paste or upload the counted serial numbers first'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/inventory/serial-count-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serials }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || 'Could not run the check'); return }
      setReport(data)
    } catch { setError('Could not run the check') } finally { setBusy(false) }
  }

  const download = () => {
    if (!report) return
    const lines = [
      ['Section', 'Serial', 'Counted as', 'Product', 'System status', 'Location'].map(csvCell).join(','),
      ...report.missing.map(r => ['Unsold in system, not counted', r.serial, '', r.productName, r.status, r.location].map(csvCell).join(',')),
      ...report.notInSystem.map(r => ['Counted, not in system', '', r.counted, '', '', ''].map(csvCell).join(',')),
      ...report.soldInSystem.map(r => ['Counted, but sold in system', r.serial, r.counted, r.productName, r.status, r.location].map(csvCell).join(',')),
      ...report.lookAlike.map(r => ['Counted, matched on look-alike characters', r.serial, r.counted, r.productName, r.status, r.location].map(csvCell).join(',')),
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'serial-count-check.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const Table = ({ title, note, head, rows }: { title: string; note?: string; head: string[]; rows: string[][] }) => (
    <div className="card mb-4 overflow-hidden">
      <div className="px-4 py-3 border-b border-border-lt">
        <p className="text-[13px] font-bold">{title} <span className="text-t3 font-normal">({rows.length})</span></p>
        {note && <p className="text-[11px] text-t3">{note}</p>}
      </div>
      {rows.length === 0 ? <p className="px-4 py-3 text-[12px] text-t3">None.</p> : (
        <div className="overflow-x-auto">
          <table className="erp-table w-full text-[12px]">
            <thead><tr>{head.map(h => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={'px-3 py-1.5 ' + (j === 0 ? 'font-mono' : '')}>{c || '—'}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <div className="mod-page p-4 sm:p-6">
      <h1 className="text-lg font-extrabold">Serial count check</h1>
      <p className="mt-1 mb-4 max-w-3xl text-xs text-t3">
        Paste the serial numbers you counted (one per line, or a column copied from a sheet), or upload a text/CSV file.
        The system compares them with its serial register and lists the unsold serials that were not counted. Nothing is changed.
      </p>
      <OrderAuditCard />
      <StaleHolds />
      <div className="card p-4 mb-4">
        <textarea className="form-input w-full font-mono text-[12px]" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder={'5CG2151FN4\n5CG2151FMM\n…'} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={e => {
            const input = e.target
            const f = input.files?.[0]
            if (f) void f.text().then(content => setText(prev => (prev ? prev + '\n' : '') + content))
            input.value = ''
          }} />
          <span className="text-[11px] text-t3">{parse(text).length} serial(s) entered</span>
          <button className="btn-primary text-[12px]" onClick={run} disabled={busy}>{busy ? 'Checking…' : 'Check against the system'}</button>
          {report && <button className="btn-secondary text-[12px]" onClick={download}>Download CSV</button>}
        </div>
        {error && <p className="mt-2 text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      {report && (
        <>
          <p className="mb-3 text-[12px]">
            Counted {report.summary.uniqueCounted} unique serial(s). The system holds {report.summary.systemUnsold} unsold serial(s):{' '}
            <b>{report.summary.missing} not counted</b>, {report.summary.notInSystem} counted but unknown, {report.summary.soldInSystem} counted but sold in the system
            {report.summary.duplicates > 0 ? `, ${report.summary.duplicates} listed twice (${report.duplicates.join(', ')})` : ''}.
          </p>
          <Table title="Unsold in the system but not on your count" note="Check each one: it may be missing, in repair, out on a job, or listed with a different serial." head={['Serial', 'Product', 'Status', 'Location']} rows={report.missing.map(r => [r.serial, r.productName, r.status, r.location])} />
          <Table title="Counted but not in the system" note="Usually a typing difference on the sheet, or a unit that was never received into the system." head={['Counted as']} rows={report.notInSystem.map(r => [r.counted])} />
          <Table title="Counted but sold in the system" note="The system says these left the building; they are on your shelf." head={['Serial', 'Product', 'Status', 'Location']} rows={report.soldInSystem.map(r => [r.serial ?? '', r.productName ?? '', r.status ?? '', r.location ?? ''])} />
          <Table title="Matched on look-alike characters" note="Counted as one spelling, found as another (O/0, I/1, S/5…). Confirm they are the same unit." head={['Counted as', 'System serial', 'Product', 'Status']} rows={report.lookAlike.map(r => [r.counted, r.serial ?? '', r.productName ?? '', r.status ?? ''])} />
        </>
      )}
    </div>
  )
}
