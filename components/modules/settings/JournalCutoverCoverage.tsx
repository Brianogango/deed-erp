'use client'

import { useCallback, useEffect, useState } from 'react'

type ParityRefs = {
  blobRefCount?: number
  prismaRefCount?: number
  sharedRefCount?: number
  coveragePct?: number | null
  blobOnlyRefs?: string[]
  prismaOnlySample?: string[]
}

type RetireBlocker = { code: string; message: string }
type ChecklistItem = { id: string; ok: boolean; detail: string }

type JournalParityPayload = {
  ok?: boolean
  refs?: ParityRefs
  certificate?: {
    status?: string | null
    parityOk?: boolean | null
    certifiedAt?: string | null
    archiveKey?: string | null
  } | null
  retireReadiness?: {
    retireReady?: boolean
    blockers?: RetireBlocker[]
    checklist?: ChecklistItem[]
    note?: string
  } | null
  amountSample?: {
    sampled?: number
    mismatched?: number
  } | null
  note?: string
}

function pctLabel(coveragePct: number | null | undefined): string {
  if (coveragePct == null || Number.isNaN(coveragePct)) return '—'
  return `${Math.round(coveragePct * 1000) / 10}%`
}

/**
 * Data Cutover polish for journal ref coverage (Finance Phase 11).
 * Standalone panel — avoids editing CurrencyPricelistCutover (design-hook blocked).
 */
export function JournalCutoverCoverage({
  canWrite,
  showToast,
}: {
  canWrite: boolean
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [report, setReport] = useState<JournalParityPayload | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/journal-parity', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || 'Could not load journal parity', 'error')
        return
      }
      setReport(data as JournalParityPayload)
    } catch {
      showToast('Could not load journal parity', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runCutover = async (action: 'certify' | 'archive') => {
    if (!canWrite) {
      showToast('Director only', 'error')
      return
    }
    setBusy(action)
    try {
      const res = await fetch('/api/admin/blob-cutover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, blobKey: 'deed_journalEntries' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || `${action} failed`, 'error')
      } else {
        showToast(data.note || `${action} ok`, 'success')
      }
      await refresh()
    } catch {
      showToast(`${action} failed`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const refs = report?.refs
  const coverage = refs?.coveragePct
  const coverageOk = typeof coverage === 'number' && coverage >= 1
  const certStatus = report?.certificate?.status || 'none'
  const certOk = (certStatus === 'certified' || certStatus === 'archived') && report?.certificate?.parityOk
  const retireReady = Boolean(report?.retireReadiness?.retireReady)
  const blobOnly = refs?.blobOnlyRefs ?? []

  return (
    <div className="py-2 space-y-3">
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Journal cutover uses <span className="font-mono">ref</span> coverage (blob ⊆ Prisma), not count equality.
        Dual-write keeps Prisma ahead while store still mirrors to{' '}
        <span className="font-mono">deed_journalEntries</span>. Retire stays blocked until{' '}
        <span className="font-mono">JOURNAL_WRITERS_MIGRATED=true</span> after Finance sign-off.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-navy-500 text-white border-none cursor-pointer disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh parity'}
        </button>
        <button
          type="button"
          disabled={!canWrite || !coverageOk || busy !== null}
          onClick={() => void runCutover('certify')}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 cursor-pointer disabled:opacity-40"
        >
          {busy === 'certify' ? 'Certifying…' : 'Certify journals'}
        </button>
        <button
          type="button"
          disabled={!canWrite || !certOk || busy !== null}
          onClick={() => void runCutover('archive')}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 cursor-pointer disabled:opacity-40"
        >
          {busy === 'archive' ? 'Archiving…' : 'Archive journals'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Blob refs" value={refs?.blobRefCount ?? '—'} />
        <Metric label="Prisma refs" value={refs?.prismaRefCount ?? '—'} />
        <Metric label="Shared" value={refs?.sharedRefCount ?? '—'} />
        <Metric
          label="Coverage"
          value={pctLabel(coverage)}
          tone={coverageOk ? 'ok' : 'warn'}
        />
      </div>

      <div
        className={`rounded-lg border px-3 py-2 text-[11px] ${
          coverageOk
            ? 'border-emerald-100 bg-emerald-50 text-emerald-900'
            : 'border-amber-100 bg-amber-50 text-amber-900'
        }`}
        role="status"
      >
        {coverageOk ? (
          <>Ref coverage complete — every blob journal ref exists in Prisma.</>
        ) : (
          <>
            Ref coverage incomplete
            {blobOnly.length > 0
              ? ` — ${blobOnly.length} blob-only ref(s) (sample: ${blobOnly.slice(0, 5).join(', ')})`
              : ''}
            . Dual-write or backfill before certify.
          </>
        )}
      </div>

      <div className="rounded-lg border border-gray-100 px-3 py-2 text-[11px] text-gray-600 space-y-1">
        <p>
          Certificate: <span className="font-semibold text-gray-800">{certStatus}</span>
          {report?.certificate?.certifiedAt
            ? ` · ${new Date(report.certificate.certifiedAt).toLocaleString('en-KE')}`
            : ''}
          {report?.certificate?.archiveKey ? ` · archive ${report.certificate.archiveKey}` : ''}
        </p>
        <p>
          Amount sample: {report?.amountSample?.sampled ?? 0} checked
          {report?.amountSample?.mismatched
            ? ` · ${report.amountSample.mismatched} mismatch(es)`
            : ' · OK'}
        </p>
        <p>
          Retire ready:{' '}
          <span className={retireReady ? 'text-emerald-700 font-semibold' : 'text-amber-800 font-semibold'}>
            {retireReady ? 'yes' : 'no'}
          </span>
        </p>
        {report?.retireReadiness?.note && (
          <p className="text-gray-400 leading-relaxed">{report.retireReadiness.note}</p>
        )}
      </div>

      {(report?.retireReadiness?.checklist?.length ?? 0) > 0 && (
        <ul className="space-y-1.5">
          {report!.retireReadiness!.checklist!.map(item => (
            <li key={item.id} className="flex gap-2 text-[11px] items-start">
              <span className={item.ok ? 'text-emerald-600' : 'text-amber-700'}>
                {item.ok ? '✓' : '○'}
              </span>
              <span className="text-gray-600">
                <span className="font-semibold text-gray-800">{item.id}</span> — {item.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(report?.retireReadiness?.blockers?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-900 mb-1">Retire blockers</p>
          <ul className="space-y-1">
            {report!.retireReadiness!.blockers!.map(b => (
              <li key={b.code} className="text-[11px] text-amber-800">
                <span className="font-mono">{b.code}</span>: {b.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'ok' | 'warn'
}) {
  const valueClass =
    tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-800' : 'text-gray-800'
  return (
    <div className="rounded-lg border border-gray-100 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className={`text-[13px] font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  )
}
