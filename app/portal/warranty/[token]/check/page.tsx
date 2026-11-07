'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { WARRANTY_SUPPORT_PHONE } from '@/lib/warranty/e-warranty'

type Data = {
  warranty: {
    ref: string; productName: string; serialNumber: string
    startDate: string; endDate: string; months: number; state: 'valid' | 'expired' | 'void'
  }
}

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const daysLeft = (end: string) => Math.ceil((new Date(`${end}T23:59:59+03:00`).getTime() - Date.now()) / 86_400_000)

/**
 * What scanning the QR on a printed / PDF certificate opens: is this machine
 * covered right now? Always live, so an edited copy cannot fake it. Signed-in
 * staff can start a warranty repair from here.
 */
export default function WarrantyCheckPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [staff, setStaff] = useState<{ warrantyId: string } | null>(null)

  useEffect(() => {
    fetch(`/api/portal/warranty/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async r => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'Could not check this warranty'); setData(b) })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not check this warranty'))
    // Staff signed in on this phone get the repair button; anyone else gets a 401 and nothing changes.
    fetch(`/api/warranties/staff?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async r => (r.ok ? setStaff(await r.json()) : null))
      .catch(() => {})
  }, [token])

  const shell = 'h-[100dvh] overflow-y-auto overscroll-contain bg-slate-100 px-4 py-6'
  if (error) return <main className={shell}><p className="mx-auto max-w-md rounded-2xl bg-white p-5 text-sm text-rose-700 shadow-sm">{error}</p></main>
  if (!data) return <main className={shell}><p className="mx-auto max-w-md text-sm text-slate-500">Checking the warranty…</p></main>

  const w = data.warranty
  const left = daysLeft(w.endDate)
  const supportDigits = WARRANTY_SUPPORT_PHONE.replace(/\D/g, '').replace(/^0/, '254')
  const claimText = `Hello, I would like to make a warranty claim. Warranty ${w.ref}, ${w.productName}, serial ${w.serialNumber}. The problem is: `
  const tone = w.state === 'valid'
    ? { box: 'bg-emerald-600', label: 'Covered', line: `Valid until ${longDate(w.endDate)}`, sub: `${left} day${left === 1 ? '' : 's'} of cover left` }
    : w.state === 'expired'
      ? { box: 'bg-slate-600', label: 'Not covered', line: `Expired on ${longDate(w.endDate)}`, sub: 'Repairs are charged as normal' }
      : { box: 'bg-rose-600', label: 'Not covered', line: 'This warranty is void', sub: 'Contact support if you think this is wrong' }

  return (
    <main className={shell}>
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/deed-logo.png" alt="Deed Technologies" className="h-10 w-10" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Warranty check</p>
            <p className="font-mono text-sm font-bold text-slate-800">{w.ref}</p>
          </div>
        </header>

        <section className={`rounded-2xl p-5 text-white shadow-sm ${tone.box}`} aria-live="polite">
          <p className="text-sm font-semibold uppercase tracking-wide opacity-90">{tone.label}</p>
          <p className="mt-1 text-2xl font-extrabold">{tone.line}</p>
          <p className="mt-1 text-sm opacity-90">{tone.sub}</p>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Check it matches the machine</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Model</dt><dd className="font-semibold text-slate-900">{w.productName}</dd>
            <dt className="text-slate-500">Serial</dt><dd className="font-mono font-bold text-slate-900">{w.serialNumber}</dd>
            <dt className="text-slate-500">Purchased</dt><dd className="text-slate-900">{longDate(w.startDate)}</dd>
            <dt className="text-slate-500">Cover</dt><dd className="text-slate-900">{w.months} month{w.months === 1 ? '' : 's'}</dd>
          </dl>
        </section>

        {staff && (
          <a className="block rounded-xl bg-[#1B2762] px-4 py-3.5 text-center text-base font-bold text-white" href={`/repairs?warrantyRepair=${encodeURIComponent(staff.warrantyId)}`}>
            Start warranty repair
          </a>
        )}
        {w.state === 'valid' && (
          <a className="block rounded-xl bg-emerald-600 px-4 py-3.5 text-center text-base font-bold text-white" target="_blank" rel="noreferrer"
            href={`https://wa.me/${supportDigits}?text=${encodeURIComponent(claimText)}`}>
            Make a warranty claim
          </a>
        )}
        <a className="block rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-700" href={`/portal/warranty/${encodeURIComponent(token)}`}>
          View full certificate
        </a>
        <p className="text-center text-xs text-slate-500">Warranty support: <a className="font-semibold underline" href={`tel:${WARRANTY_SUPPORT_PHONE.replace(/\s/g, '')}`}>{WARRANTY_SUPPORT_PHONE}</a></p>
      </div>
    </main>
  )
}
