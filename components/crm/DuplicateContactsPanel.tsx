'use client'

import { useCallback, useEffect, useState } from 'react'
import { CompactInfoNotice, PrimaryActionButton } from '@/components/erp'
import { isEnquiryTitledContact } from '@/lib/crm/duplicate-contact-policy'

type DuplicateContactMember = {
  id: string
  name: string
  email: string | null
  phone: string | null
  phoneAlt: string | null
  companyName: string | null
  clientType?: string | null
  createdAt: string
  leadCount: number
}

type DuplicateContactGroup = {
  key: string
  kind: 'email' | 'phone' | 'name'
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
        const preferred = [...g.members].sort((a, b) => {
          const aTitle = isEnquiryTitledContact(a.name) ? 1 : 0
          const bTitle = isEnquiryTitledContact(b.name) ? 1 : 0
          if (aTitle !== bTitle) return aTitle - bTitle
          return b.leadCount - a.leadCount || a.createdAt.localeCompare(b.createdAt)
        })[0]
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

  const mergeRest = async (group: DuplicateContactGroup) => {
    const keepId = keepByGroup[group.key]
    const extras = group.members.filter(m => m.id !== keepId)
    if (!keepId || extras.length === 0) return
    setBusyKey(`${group.key}:rest`)
    try {
      for (const member of extras) {
        const res = await fetch('/api/crm/duplicate-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepId, mergeId: member.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Merge failed')
      }
      showToast(`Merged ${extras.length} contact${extras.length === 1 ? '' : 's'}`, 'success')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Merge failed', 'error')
      await load()
    } finally {
      setBusyKey(null)
    }
  }

  const mergeObvious = async () => {
    const ok = window.confirm(
      'Merge RFQ-titled and repeated organisation-name duplicates into the real customer? Different people who share a name or phone number are left for you to review.',
    )
    if (!ok) return
    setBusyKey('obvious')
    try {
      const res = await fetch('/api/crm/duplicate-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mergeObvious' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Merge failed')
      const merged = Number(data.merged || 0)
      const skipped = Number(data.skipped || 0)
      showToast(
        merged === 0
          ? 'No obvious duplicates to merge'
          : `Merged ${merged} duplicate${merged === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}`,
        merged === 0 ? 'info' : 'success',
      )
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Merge failed', 'error')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="crm-duplicates flex flex-col gap-4">
      <div className="crm-submodule-header">
        <div>
          <h2 className="text-sm font-semibold">Duplicate contacts</h2>
          <p className="text-[11px] text-text-3 mt-0.5">
            Same normalized email or phone. Keep one record; others are deactivated and sales history moves with them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryActionButton
            variant="secondary"
            onClick={() => void load()}
            disabled={loading || Boolean(busyKey)}
          >
            Refresh
          </PrimaryActionButton>
          <PrimaryActionButton
            onClick={() => void mergeObvious()}
            disabled={loading || Boolean(busyKey)}
          >
            {busyKey === 'obvious' ? 'Merging…' : 'Merge obvious duplicates'}
          </PrimaryActionButton>
        </div>
      </div>

      <CompactInfoNotice>
        Merge obvious duplicates collapses RFQ subject lines and repeated organisation names onto the real customer.
        Different people who share a name or reception number stay here for a manual keep/merge.
      </CompactInfoNotice>

      {loading ? (
        <div className="p-6 text-sm text-text-3">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="card p-6 text-sm text-text-3">No duplicate contact groups found.</div>
      ) : (
        groups.map(group => {
          const extras = group.members.filter(m => m.id !== keepByGroup[group.key])
          return (
            <div key={group.key} className="card overflow-hidden crm-duplicate-group">
              <div className="crm-duplicate-group__header">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-text-3">
                  {group.kind === 'name' ? 'same name' : group.kind}
                  {' · '}
                  {group.key.replace(/^(email|phone|name):/, '')}
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                  {extras.length > 1 && (
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void mergeRest(group)}
                      className="text-[11px] px-2.5 py-1 rounded-md border border-border hover:bg-surface font-medium"
                    >
                      Merge the rest
                    </button>
                  )}
                </div>
              </div>
              <ul className="divide-y divide-border">
                {group.members.map(m => {
                  const isKeep = keepByGroup[group.key] === m.id
                  const rfqTitle = isEnquiryTitledContact(m.name)
                  return (
                    <li key={m.id} className="crm-duplicate-member">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {m.name}
                          {isKeep && <span className="ml-2 text-[10px] uppercase text-primary font-semibold">Keep</span>}
                          {rfqTitle && (
                            <span className="ml-2 text-[10px] uppercase text-text-3 font-semibold">RFQ title</span>
                          )}
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
                          disabled={busyKey === `${group.key}:${m.id}` || Boolean(busyKey)}
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
          )
        })
      )}
    </div>
  )
}
