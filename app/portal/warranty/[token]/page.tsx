'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'qrcode'
import { WARRANTY_INTRO, WARRANTY_SUPPORT_PHONE, warrantyTerms } from '@/lib/warranty/e-warranty'

type Data = {
  warranty: {
    ref: string; buyer: string; productName: string; serialNumber: string; specs: string; document: string
    startDate: string; endDate: string; months: number; state: 'valid' | 'expired' | 'void'
  }
  company: { name?: string; phone?: string; email?: string; website?: string; address?: string; city?: string }
}

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const STATE = {
  valid: { label: 'Valid', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  expired: { label: 'Expired', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  void: { label: 'Void', cls: 'bg-rose-100 text-rose-700 border-rose-300' },
}

/** A customer's e-warranty certificate: Deed's printed terms, filled in for one machine. */
export default function WarrantyCertificatePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [qr, setQr] = useState('')

  useEffect(() => {
    fetch(`/api/portal/warranty/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async r => {
        const b = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(b.error || 'Could not load this warranty')
        setData(b)
        // Opened from "Download PDF": straight to the print dialog (Save as PDF).
        if (new URLSearchParams(window.location.search).get('print') === '1') setTimeout(() => window.print(), 700)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load this warranty'))
    // The QR (printed / PDF copies) opens the live check, not this page again.
    QRCode.toDataURL(`${window.location.href.split(/[?#]/)[0].replace(/\/$/, '')}/check`, { margin: 1, width: 220 }).then(setQr).catch(() => {})
  }, [token])

  if (error) return <main className="h-[100dvh] overflow-y-auto bg-slate-100 p-6"><p className="mx-auto max-w-md rounded-2xl bg-white p-5 text-sm text-rose-700 shadow-sm">{error}</p></main>
  if (!data) return <main className="h-[100dvh] overflow-y-auto bg-slate-100 p-6"><p className="mx-auto max-w-md text-sm text-slate-500">Loading your warranty…</p></main>

  const w = data.warranty
  // Contacts from company settings, else as printed on the paper certificate.
  const c = {
    ...data.company,
    name: data.company.name || 'Deed Technologies',
    address: data.company.address || 'Sanlam House, Kenyatta Avenue, 1st Floor, Suite No. 103',
    city: data.company.address ? data.company.city : '',
    // Warranty claims go to the warranty support line.
    phone: WARRANTY_SUPPORT_PHONE,
    website: data.company.website || 'www.deed.africa',
  }
  const period = `${w.months} month${w.months === 1 ? '' : 's'}`
  const st = STATE[w.state]
  const phoneDigits = String(c.phone ?? '').replace(/\D/g, '').replace(/^0/, '254')

  return (
    <main className="h-[100dvh] overflow-y-auto overscroll-contain bg-slate-100 px-3 py-5 print:h-auto print:overflow-visible print:bg-white print:p-0">
      <style>{`@media print { @page { size: A4; margin: 8mm } html, body, main { background: #fff !important; min-height: 0 !important; height: auto !important; padding: 0 !important; overflow: visible !important } .no-print { display: none !important } .cert { box-shadow: none !important; border: none !important; padding: 0 !important; font-size: 7.7pt !important; line-height: 1.28 !important; max-width: none !important } .cert section { margin-bottom: 4pt !important } .cert li { margin-top: 1pt !important } .cert h1 { font-size: 12pt !important } .cert .text-xs, .cert .text-sm { font-size: 7.4pt !important } .cert img.h-14 { height: 38pt !important } .cert .h-28 { height: 66pt !important; width: 66pt !important } }`}</style>

      <div className="no-print mx-auto mb-3 flex max-w-[860px] flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${st.cls}`}>
          {w.state === 'valid' ? `Valid until ${longDate(w.endDate)}` : w.state === 'expired' ? `Expired on ${longDate(w.endDate)}` : 'This warranty is void'}
        </span>
        <div className="flex gap-2">
          {phoneDigits && (
            <a className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700" target="_blank" rel="noreferrer"
              href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(`Hello, I need help with my warranty ${w.ref} (serial ${w.serialNumber}).`)}`}>
              Contact support
            </a>
          )}
          <button className="rounded-xl bg-[#1B2762] px-3 py-2 text-sm font-semibold text-white" onClick={() => window.print()}>Download PDF</button>
        </div>
      </div>

      <article className="cert mx-auto max-w-[860px] rounded-2xl border border-slate-200 bg-white p-5 text-[12.5px] leading-snug text-slate-900 shadow-sm sm:p-8">
        <header className="flex items-center gap-4">
          <span className="h-px flex-1 bg-[#1B2762]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/deed-logo.png" alt={c.name || 'Deed Technologies'} className="h-14 w-auto" />
          <span className="h-px flex-1 bg-[#1B2762]" />
        </header>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-extrabold text-[#1B2762]">Limited Warranty Certificate</h1>
          <p className="font-mono text-sm font-bold text-rose-700">{w.ref}</p>
        </div>
        <p className="mt-2 font-semibold">{WARRANTY_INTRO}</p>

        <section className="mt-3 grid gap-3 rounded-xl border border-[#1B2762]/20 bg-slate-50 p-3 sm:grid-cols-[1fr_auto]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">Product model</dt><dd className="font-semibold">{w.productName}</dd>
            <dt className="text-slate-500">Product serial number</dt><dd className="font-mono font-semibold">{w.serialNumber}</dd>
            {w.specs && (<><dt className="text-slate-500">Specifications</dt><dd>{w.specs}</dd></>)}
            {w.buyer && (<><dt className="text-slate-500">Buyer</dt><dd>{w.buyer}</dd></>)}
            {w.document && (<><dt className="text-slate-500">Proof of purchase</dt><dd>{w.document}</dd></>)}
            <dt className="text-slate-500">Date of purchase</dt><dd>{longDate(w.startDate)}</dd>
            <dt className="text-slate-500">Warranty period</dt><dd>{period} — until {longDate(w.endDate)}</dd>
            <dt className="text-slate-500">Status</dt><dd><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span></dd>
          </dl>
          {qr && (
            <figure className="justify-self-center text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Scan to check this warranty" className="h-28 w-28" />
              <figcaption className="text-[10px] text-slate-500">Scan to check cover</figcaption>
            </figure>
          )}
        </section>

        <div className="mt-3 gap-6 sm:columns-2 print:columns-2">
          {warrantyTerms(period).map((s, i) => (
            <section key={s.title} className="mb-3 break-inside-avoid-column">
              <h2 className="font-bold text-[#2D6DB5] underline">{i + 1}. {s.title}:</h2>
              {s.intro && <p className="mt-0.5">{s.intro}</p>}
              <ol className="mt-0.5 space-y-1">
                {s.items.map((it, j) => (
                  <li key={j} className={it.label ? 'pl-4' : ''}>
                    {it.label
                      ? <><span className="font-semibold text-[#2D6DB5]">• {it.label}:</span> {it.text}</>
                      : <><span className="font-semibold">{s.items.length > 1 ? `${String.fromCharCode(97 + s.items.filter(x => !x.label).indexOf(it))}) ` : ''}</span>{it.text}</>}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>

        <footer className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-[#1B2762]/30 pt-3">
          <p className="text-xs text-slate-600">
            Issued electronically by {c.name || 'Deed Technologies'} on {longDate(w.startDate)} — no signature needed.<br />
            Scan the code above to check it is still valid.
          </p>
          <p className="text-right text-xs font-semibold text-slate-700">
            {[c.address, c.city].filter(Boolean).join(', ')}
            {c.phone && <><br />Warranty support: {c.phone}</>}
            {c.website && <><br />W: {String(c.website).replace(/^https?:\/\//, '')}</>}
          </p>
        </footer>
      </article>
    </main>
  )
}
