'use client'

import { useRef, useState } from 'react'

/**
 * OFX/CSV bank statement import (Finance Phase 12).
 * Standalone panel — Cashbook.tsx is design-hook blocked for inline edits.
 */
export function BankStatementImportPanel({
  bankAccountId,
  showToast,
  onImported,
}: {
  bankAccountId: string
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  onImported?: (lines: Array<{
    id: string
    date: string
    amount: number
    payee: string | null
    memo: string | null
  }>) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [lastSummary, setLastSummary] = useState<string | null>(null)

  async function runImport(file: File | null) {
    if (!file) return
    if (!bankAccountId) {
      showToast('Select a bank account first', 'error')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set('bankAccountId', bankAccountId)
      fd.set('file', file)
      fd.set('format', 'auto')
      const res = await fetch('/api/bank-statements/import', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`)
      const msg = `Imported ${data.imported ?? 0} line(s); skipped ${data.skippedDuplicates ?? 0} duplicate(s) (${data.format})`
      setLastSummary(msg)
      showToast(msg, 'success')
      onImported?.(data.lines || [])
    } catch (err: any) {
      showToast(err?.message || 'Statement import failed', 'error')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2 py-1">
      <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
        Import OFX or CSV bank statement lines into Prisma (fingerprint-deduped), then match in Cashbook.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.ofx,.qfx,text/csv"
        className="hidden"
        onChange={e => void runImport(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className="btn-secondary text-[11px] px-3 py-1.5"
        disabled={busy || !bankAccountId}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? 'Importing…' : 'Import OFX / CSV'}
      </button>
      {lastSummary && (
        <p className="text-[11px] text-[var(--text-2)]">{lastSummary}</p>
      )}
    </div>
  )
}
