'use client'

import { useCallback, useEffect, useState } from 'react'
import { PrimaryActionButton } from '@/components/erp'

type DuplicateContactMember = {
  id: string
  name: string
  email: string | null
  phone: string | null
  phoneAlt: string | null
  companyName: string | null
  createdAt: string
  leadCount: number
}

type DuplicateContactGroup = {
  key: string
  kind: 'email' | 'phone'
  members: DuplicateContactMember[]
}

export default function DuplicateContactsPanel({
  showToast,
}: {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [groups, setGroups] = useState<DuplicateContactGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/crm/duplicate-contacts')
      if (!res.ok) throw new Error('Failed to load duplicates')
      const data = await res.json()
      const next: DuplicateContactGroup[] = Array.isArray(data.groups) ? data.groups : []
      setGroups(next)
      const defaults: Record<string, string> = {}
      for (const g of next) {
        const preferred = [...g.members].sort((a, b) => b.leadCount - a.leadCount || a.createdAt.localeCompare(b.createdAt))[0]
        if (preferred) defaults[g.key] = preferred.id
      }
      setKeepByGroup(defaults)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Load failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void load() }, [load])

  const mergeOne = async (group: DuplicateContactGroup, mergeId: string) => {
    const keepId = keepByGroup[group.key]
    if (!keepId || keepId === mergeId) {
      showToast('Pick a different contact to merge away', 'error')
      return
    }
    setBusyKey(`${group.key}:${mergeId}`)
    try {
      const res = await fetch('/api/crm/duplicate-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId, mergeId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Merge failed')
      showToast('Contacts merged', 'success')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Merge failed', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Duplicate contacts</h2>
          <p className="text-[11px] text-text-3 mt-0.5">
            Same normalized email or phone. Keep one record; others are soft-deactivated and leads are re-pointed.
          </p>
        </div>
        <PrimaryActionButton onClick={() => void load()} disabled={loading}>
          Refresh
        </PrimaryActionButton>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-text-3">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="card p-6 text-sm text-text-3">No duplicate contact groups found.</div>
      ) : (
        groups.map(group => (
          <div key={group.key} className="card overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-text-3">
                {group.kind} · {group.key.replace(/^(email|phone):/, '')}
              </div>
              <label className="text-[11px] text-text-2 flex items-center gap-1.5">
                Keep
                <select
                  className="text-xs border border-border rounded-md px-2 py-1 bg-bg"
                  value={keepByGroup[group.key] || ''}
                  onChange={e => setKeepByGroup(prev => ({ ...prev, [group.key]: e.target.value }))}
                >
                  {group.members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.companyName ? ` (${m.companyName})` : ''} · {m.leadCount} leads
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ul className="divide-y divide-border">
              {group.members.map(m => {
                const isKeep = keepByGroup[group.key] === m.id
                return (
                  <li key={m.id} className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {m.name}
                        {isKeep && <span className="ml-2 text-[10px] uppercase text-primary font-semibold">Keep</span>}
                      </div>
                      <div className="text-[11px] text-text-3 truncate">
                        {[m.email, m.phone || m.phoneAlt, m.companyName].filter(Boolean).join(' · ') || '—'}
                        {' · '}
                        {m.leadCount} leads
                      </div>
                    </div>
                    {!isKeep && (
                      <button
                        type="button"
                        disabled={busyKey === `${group.key}:${m.id}`}
                        onClick={() => void mergeOne(group, m.id)}
                        className="text-[11px] px-2.5 py-1 rounded-md border border-border hover:bg-surface font-medium"
                      >
                        Merge into keep
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
