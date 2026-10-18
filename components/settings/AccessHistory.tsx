'use client'

import { useCallback, useState } from 'react'

type Entry = { id: string; at: string; action: string; actor: string; target: string; summary: string }

const ACTION_LABEL: Record<string, string> = {
  'user.created': 'Added',
  'user.access_changed': 'Changed',
  'user.deactivated': 'Deactivated',
  'user.reactivated': 'Reactivated',
  'user.deleted': 'Deleted',
  'role.created': 'Created role',
  'role.updated': 'Changed role',
  'role.deleted': 'Deleted role',
}

/** Who changed whose role, modules or status — Directors only. Loads when opened. */
export default function AccessHistory() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/users/access-history', { cache: 'no-store' })
      const data = await res.json().catch(() => null) as { entries?: Entry[]; error?: string } | null
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      setEntries(data?.entries ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the history')
    }
  }, [])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
        onClick={() => { const next = !open; setOpen(next); if (next && entries === null) void load() }}
      >
        <span className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest">Access change history</span>
        <span className="text-[11px] font-semibold text-[var(--primary)]">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-3">
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {!error && entries === null && <p className="text-[11px] text-gray-400">Loading…</p>}
          {entries && entries.length === 0 && (
            <p className="text-[11px] text-gray-500">No changes recorded yet. From now on, every change to a user&apos;s role, modules or status is kept here.</p>
          )}
          {entries && entries.length > 0 && (
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border-lt)' }}>
              {entries.map(entry => (
                <li key={entry.id} className="py-2 text-[11px] leading-relaxed text-gray-600">
                  <span className="font-semibold text-gray-800">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                  {' '}<span className="font-semibold text-gray-800">{entry.target || 'a user'}</span>
                  {entry.action === 'user.access_changed' || entry.action === 'user.created' ? ` — ${entry.summary}` : ''}
                  <span className="block text-[10px] text-gray-400">
                    by {entry.actor} · {new Date(entry.at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
