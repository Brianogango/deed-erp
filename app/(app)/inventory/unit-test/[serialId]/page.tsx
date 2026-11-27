'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { UnitTestReport } from '@/components/inventory/test-bench/UnitTestForm'
import { fetchUnitTestHistory } from '@/components/inventory/test-bench/useUnitTests'
import { printUnitTestLabels } from '@/lib/inventory/unit-test-label'
import type { UnitTest } from '@/lib/inventory/unit-tests'

/**
 * A unit's test report: every test it has had, newest first. The bench
 * label's QR code opens this page; it is behind the login, so only signed-in
 * staff see it.
 */
export default function UnitTestReportPage({ params }: { params: Promise<{ serialId: string }> }) {
  const { serialId } = use(params)
  const [tests, setTests] = useState<UnitTest[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    void fetchUnitTestHistory(serialId).then(h => {
      if (!live) return
      if (!h) { setError('Could not load the test report.'); return }
      setTests(h.tests.filter(t => t.status !== 'in_progress'))
    })
    return () => { live = false }
  }, [serialId])

  const latest = tests?.[0]
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--navy)]">Test report</p>
          <h1 className="text-lg font-extrabold text-text-1 truncate">{latest?.productName ?? 'Unit'}</h1>
          {latest ? (
            <p className="font-mono text-[12px] text-text-2">
              {latest.assetId ? `${latest.assetId} · ` : ''}S/N {latest.serialNumber}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {latest ? <button type="button" className="btn-secondary text-[12px]" onClick={() => void printUnitTestLabels([latest])}>Print test label</button> : null}
          <Link className="btn-outline text-[12px]" href={`/inventory?tab=reports&serial=${encodeURIComponent(serialId)}`}>Open in Inventory</Link>
        </div>
      </div>
      {error ? <p className="text-[12px] text-[var(--danger-text)]">{error}</p> : null}
      {!tests && !error ? <p className="text-[12px] text-text-3">Loading…</p> : null}
      {tests && tests.length === 0 ? (
        <p className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] px-4 py-6 text-center text-[12px] text-text-3">
          No finished test for this unit. Units in Ready for Sale from before the test bench show as untested (legacy).
        </p>
      ) : null}
      {tests?.map((t, i) => (
        <section key={t.id} className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-4">
          <UnitTestReport test={t} previous={tests[i + 1] ?? null} />
          {t.placedTo ? <p className="mt-2 text-[11px] text-text-4">Placed {t.placedTo === 'warehouse' ? 'in Ready for Sale' : t.placedTo === 'shop' ? 'in With Issues' : t.placedTo === 'quarantine' ? 'in Rejected' : t.placedTo === 'repair_unit' ? 'in Refurbishment' : `at ${t.placedTo}`}{t.placedByName ? ` by ${t.placedByName}` : ''}</p> : null}
        </section>
      ))}
    </div>
  )
}
