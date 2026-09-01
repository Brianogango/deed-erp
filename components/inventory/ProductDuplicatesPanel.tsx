'use client'

import React, { useEffect, useState } from 'react'
import { Modal } from '@/components/ui'
import { AsyncActionButton, DestructiveAction, EmptyState, ErrorState } from '@/components/erp'
import type { DuplicateProductGroup } from '@/lib/inventory/duplicate-products'

export default function ProductDuplicatesPanel({
  onClose,
  onMerged,
  onToast,
}: {
  onClose: () => void
  onMerged: () => void
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [groups, setGroups] = useState<DuplicateProductGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/products/duplicates')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not load duplicates')
      setGroups(Array.isArray(body.groups) ? body.groups : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load duplicates'
      setLoadError(message)
      onToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const mergePair = async (keepId: string, dropId: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/products/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId, dropId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Merge failed')
      onToast('Duplicate merged', 'success')
      onMerged()
      await load()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Merge failed', 'error')
      throw err
    } finally {
      setBusy(false)
    }
  }

  const mergeAll = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/products/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obvious: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Merge failed')
      onToast(`Merged ${body.merges ?? 0} duplicate product${body.merges === 1 ? '' : 's'}`, 'success')
      onMerged()
      await load()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Merge failed', 'error')
      throw err
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Duplicate products"
      width={720}
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <button type="button" className="btn-secondary text-[11px]" onClick={onClose}>Close</button>
          <DestructiveAction
            label="Merge all obvious duplicates"
            confirmLabel="Merge duplicates"
            warning="This moves linked serials, orders and photos to the selected keeper records and archives the duplicate product masters. Review the groups before continuing."
            action={mergeAll}
            disabled={busy || groups.length === 0}
            trigger={
              <button type="button" className="btn-primary text-[11px]" disabled={busy || groups.length === 0}>
                Merge all obvious duplicates
              </button>
            }
          />
        </div>
      }
    >
      <p className="text-[12px] text-text-2 leading-relaxed m-0 mb-3">
        Same name, SKU, or barcode. The keeper is the active product with more stock and sales history.
        Serials, orders, and photos move onto the keeper; the extra master is archived.
      </p>
      {loading ? (
        <div className="py-8 text-center text-[12px] text-text-3" aria-busy="true">Checking the catalog…</div>
      ) : loadError ? (
        <ErrorState
          title="Could not check duplicate products"
          description={loadError}
          retry={() => { void load() }}
          retryLabel="Check again"
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No duplicate product masters found"
          description="The active catalog does not currently contain obvious duplicate names, SKUs or barcodes."
          className="min-h-[180px]"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(group => (
            <div key={group.key} className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-[10px] uppercase tracking-wider font-bold text-text-3 m-0 mb-2">
                Same {group.kind}
              </p>
              <ul className="m-0 p-0 list-none flex flex-col gap-2">
                {group.members.map((member, index) => (
                  <li key={member.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-text-1 m-0 truncate">{member.name}</p>
                      <p className="text-[10.5px] text-text-3 m-0 mt-0.5 font-mono">
                        {member.sku || 'no SKU'}
                        {member.barcode ? ` · ${member.barcode}` : ''}
                        {` · ${member.refCount} linked rows`}
                        {member.isActive ? '' : ' · archived'}
                      </p>
                    </div>
                    {index > 0 && (
                      <AsyncActionButton
                        className="btn-secondary text-[10px] px-2.5 py-1.5 flex-shrink-0"
                        disabled={busy}
                        action={() => mergePair(group.members[0].id, member.id)}
                        pendingLabel="Merging…"
                        successLabel="Merged"
                      >
                        Merge into first
                      </AsyncActionButton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
