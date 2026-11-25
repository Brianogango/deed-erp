'use client'

import { useEffect, useState } from 'react'
import { fmtKes } from '@/lib/store'

type DocCheque = {
  id: string
  direction: 'received' | 'given'
  chequeNumber: string
  bankName: string
  amount: number
  chequeDate: string
  status: string
  hasImage: boolean
  schedule?: { state: string; message: string | null }
  clearsOn?: string
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))

function stateText(c: DocCheque, today: string): string {
  if (c.status === 'bounced') return c.direction === 'received' ? 'Bounced' : 'Returned'
  if (c.status === 'cancelled') return c.direction === 'received' ? 'Cancelled' : 'Stopped'
  if (c.status === 'cleared') return 'Cleared'
  const clears = c.clearsOn ?? c.chequeDate
  if (c.schedule?.state === 'applied') return `Paid on ${fmtDay(clears)}`
  if (c.status === 'deposited') return `Banked · clears ${fmtDay(clears)}`
  if (c.schedule?.state === 'scheduled') return c.chequeDate <= today ? `Clears ${fmtDay(clears)}` : `Dated ${fmtDay(c.chequeDate)} · pays ${fmtDay(clears)}`
  return c.status === 'pending' ? 'Held' : c.status
}

/**
 * The cheques on this invoice / bill: their photos, dates and whether each has
 * paid yet, and "Print all" (one page per cheque, for review or audit).
 */
export default function DocumentCheques({ invoiceId, docRef }: { invoiceId: string; docRef: string }) {
  const [cheques, setCheques] = useState<DocCheque[]>([])
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date())

  useEffect(() => {
    let cancelled = false
    const q = new URLSearchParams({ invoiceId, ref: docRef })
    fetch(`/api/cheques?${q}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d && Array.isArray(d.cheques)) setCheques(d.cheques) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [invoiceId, docRef])

  if (!cheques.length) return null
  const live = cheques.filter(c => c.status !== 'bounced' && c.status !== 'cancelled')
  const waiting = live.filter(c => c.schedule?.state === 'scheduled' && (c.clearsOn ?? c.chequeDate) > today)
  const next = waiting[0]

  const printAll = () => {
    const w = window.open('', '_blank')
    if (!w) return
    const rows = cheques.map(c => `
      <section>
        <h2>Cheque ${esc(c.chequeNumber)} · ${esc(fmtKes(c.amount))}</h2>
        <p>${esc(c.bankName || 'Bank not recorded')} · dated ${esc(fmtDay(c.chequeDate))} · ${esc(stateText(c, today))}</p>
        ${c.hasImage ? `<img src="/api/cheques/${esc(c.id)}/image" alt="Cheque ${esc(c.chequeNumber)}">` : '<p><em>No photo kept</em></p>'}
      </section>`).join('')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cheques for ${esc(docRef)}</title>
      <style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:13px}h2{font-size:13px;margin:0 0 4px}
      p{margin:0 0 8px;font-size:12px;color:#444}section{page-break-inside:avoid;margin:0 0 24px;padding-bottom:16px;border-bottom:1px solid #ddd}
      img{max-width:100%;max-height:300px;border:1px solid #ccc}</style></head>
      <body><h1>Cheques for ${esc(docRef)} (${cheques.length})</h1>${rows}
      <script>Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>print())</script></body></html>`)
    w.document.close()
  }

  return (
    <section className="doc-cheques card" aria-label="Cheques">
      <div className="doc-cheques__head">
        <div>
          <strong>Cheques ({cheques.length})</strong>{' '}
          <span>
            {fmtKes(live.reduce((s, c) => s + c.amount, 0))}
            {next ? ` · ${waiting.length} still to come, next pays ${fmtDay(next.clearsOn ?? next.chequeDate)} (${fmtKes(next.amount)})` : ''}
          </span>
        </div>
        <button type="button" onClick={printAll}>Print all</button>
      </div>
      <ul>
        {cheques.map(c => (
          <li key={c.id}>
            {c.hasImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/cheques/${c.id}/image`} alt={`Cheque ${c.chequeNumber}`} onClick={() => window.open(`/api/cheques/${c.id}/image`, '_blank')} />
            )}
            <span>No. {c.chequeNumber} · <b>{fmtKes(c.amount)}</b></span>
            <small>{stateText(c, today)}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}
