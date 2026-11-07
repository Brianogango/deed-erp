'use client'

import { useEffect, useState } from 'react'
import { fmtDate } from '@/lib/store'

type Row = { id: string; ref: string; status: string; date: string; issue: string; underWarranty: boolean }

/** Staff: repairs done on this machine since it was sold. Not shown to customers. */
export function WarrantyRepairs({ warrantyId }: { warrantyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setRows(null); setError('')
    fetch(`/api/warranties/repairs?id=${encodeURIComponent(warrantyId)}`, { cache: 'no-store' })
      .then(async r => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'Could not load repairs'); setRows(b.repairs ?? []) })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load repairs'))
  }, [warrantyId])

  return (
    <div className="card p-3 text-[12px] flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-t1">Repairs on this machine</p>
        <a className="btn-outline text-[11px]" href={`/repairs?warrantyRepair=${encodeURIComponent(warrantyId)}`}>Start warranty repair</a>
      </div>
      {error && <p className="text-[11px]" style={{ color: 'var(--danger-text)' }}>{error}</p>}
      {!rows && !error && <p className="text-t3 text-[11px]">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-t3 text-[11px]">No repairs since it was sold.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-[var(--border-lt)]">
          {rows.map(r => (
            <li key={r.id} className="py-1.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a className="font-mono font-semibold" style={{ color: 'var(--navy)' }} href={`/repairs?id=${encodeURIComponent(r.id)}`}>{r.ref}</a>
                <span className="text-t3"> · {fmtDate(r.date)}{r.underWarranty ? ' · under warranty' : ' · charged'}</span>
                {r.issue && <p className="text-t2 text-[11px] truncate" title={r.issue}>{r.issue}</p>}
              </div>
              <span className="text-[10px] text-t3 whitespace-nowrap">{r.status.replace(/_/g, ' ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
