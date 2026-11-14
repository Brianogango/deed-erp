'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AUDIT_AREAS, AUDIT_AREA_LABELS, auditAreasOfKey, type AuditArea } from '@/lib/auth/audit-areas'

type Row = {
  id: string
  at: string
  actor?: { name?: string; username?: string; role?: string }
  savedKeys?: string[]
  deniedKeys?: string[]
}

/** deed_saleOrders → "sale orders". */
const keyLabel = (key: string) => key.replace(/^deed_/, '').replace(/_v\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()

/**
 * The audit trail for the areas this person may read (the server already
 * leaves the rest out). User access changes are under Settings → User Access.
 */
export default function AuditLogPanel({ areas }: { areas: 'all' | Set<AuditArea> }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [area, setArea] = useState<AuditArea | 'all'>('all')
  const allowed = areas === 'all' ? [...AUDIT_AREAS] : AUDIT_AREAS.filter(a => areas.has(a))

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/audit?limit=300', { cache: 'no-store' })
      const data = await res.json().catch(() => null) as { rows?: Row[]; error?: string } | null
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      setRows(data?.rows ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the audit log')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => (rows ?? []).filter(row => area === 'all'
    || [...(row.savedKeys ?? []), ...(row.deniedKeys ?? [])].some(key => auditAreasOfKey(key).includes(area))), [rows, area])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest">Audit log</p>
          <p className="text-[11px] text-gray-500">
            {areas === 'all' ? 'Every area.' : `Your areas: ${allowed.map(a => AUDIT_AREA_LABELS[a]).join(', ')}.`} Who saved what, newest first.
          </p>
        </div>
        <select className="rounded-lg border px-2 py-1.5 text-xs" value={area} onChange={e => setArea(e.target.value as AuditArea | 'all')} aria-label="Area">
          <option value="all">All my areas</option>
          {allowed.filter(a => a !== 'users').map(a => <option key={a} value={a}>{AUDIT_AREA_LABELS[a]}</option>)}
        </select>
      </div>
      <div className="mt-3">
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        {!error && rows === null && <p className="text-[11px] text-gray-400">Loading…</p>}
        {rows && shown.length === 0 && <p className="text-[11px] text-gray-500">Nothing recorded for this area yet.</p>}
        {shown.length > 0 && (
          <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border-lt)' }}>
            {shown.map(row => {
              const areasOfRow = [...new Set((row.savedKeys ?? []).flatMap(auditAreasOfKey))]
              return (
                <li key={row.id} className="py-2 text-[11px] leading-relaxed text-gray-600">
                  <span className="font-semibold text-gray-800">{row.actor?.name || row.actor?.username || 'Someone'}</span>
                  {' saved '}{(row.savedKeys ?? []).map(keyLabel).join(', ') || 'nothing'}
                  {(row.deniedKeys?.length ?? 0) > 0 && <span className="text-red-600">{' · refused: '}{row.deniedKeys!.map(keyLabel).join(', ')}</span>}
                  <span className="block text-[10px] text-gray-400">
                    {new Date(row.at).toLocaleString('en-KE')}{areasOfRow.length ? ` · ${areasOfRow.map(a => AUDIT_AREA_LABELS[a]).join(', ')}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
