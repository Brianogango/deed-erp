'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Contact } from '@/lib/store'
import { Modal, SearchPicker } from '@/components/ui'

type Area = { label: string; count: number }
type Preview = {
  survivor: { id: string; name: string }
  merged: { id: string; name: string }
  areas: Area[]
  total: number
  filled: string[]
  kept: Area[]
}

const FIELD_LABELS: Record<string, string> = {
  email: 'email', phone: 'phone', mobile: 'mobile', website: 'website', address: 'address', postalAddress: 'postal address',
  city: 'city', country: 'country', vatNumber: 'KRA PIN', idNumber: 'ID number', registrationNumber: 'registration number',
  tradingName: 'trading name', jobTitle: 'job title', industry: 'industry', bankName: 'bank', bankAccount: 'bank account', bankBranch: 'bank branch',
}

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-9)

/** How alike two contacts look: same name, phone, email or KRA PIN. */
function likeness(a: Contact, b: Contact): number {
  let s = 0
  if (norm(a.name) && norm(a.name) === norm(b.name)) s += 3
  else if (norm(a.name).length > 3 && (norm(a.name).includes(norm(b.name)) || norm(b.name).includes(norm(a.name)))) s += 1
  for (const p of [a.phone, a.mobile]) if (digits(p).length >= 9 && [b.phone, b.mobile].some(q => digits(q) === digits(p))) { s += 2; break }
  if (a.email && norm(a.email) === norm(b.email)) s += 2
  if (a.vatNumber && norm(a.vatNumber) === norm(b.vatNumber)) s += 3
  return s
}

/**
 * Merge a duplicate contact into the one that stays: pick it, see exactly what
 * moves, confirm. Invoices, quotes, orders, payments, journals and the rest
 * follow; the duplicate is archived with a note.
 */
export default function MergeContactModal({ duplicate, contacts, onClose, showToast }: {
  duplicate: Contact
  contacts: Contact[]
  onClose: () => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [keep, setKeep] = useState<Contact | null>(null)
  const [swap, setSwap] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [merging, setMerging] = useState(false)

  const candidates = useMemo(() => contacts
    .filter(c => c.id !== duplicate.id && !c.isArchived)
    .map(c => ({ c, score: likeness(duplicate, c) }))
    .sort((x, y) => y.score - x.score || x.c.name.localeCompare(y.c.name)),
  [contacts, duplicate])
  const suggested = candidates.filter(x => x.score >= 2).slice(0, 4).map(x => x.c)

  // The one that stays and the one that goes, as chosen.
  const survivor = keep ? (swap ? duplicate : keep) : null
  const goner = keep ? (swap ? keep : duplicate) : null

  useEffect(() => {
    if (!survivor || !goner) { setPreview(null); return }
    let cancelled = false
    setLoading(true)
    fetch('/api/contacts/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ survivorId: survivor.id, mergedId: goner.id }),
    })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not check the merge'); return d as Preview })
      .then(d => { if (!cancelled) setPreview(d) })
      .catch(e => { if (!cancelled) { setPreview(null); showToast(e instanceof Error ? e.message : 'Could not check the merge', 'error') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [survivor?.id, goner?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!survivor || !goner || merging) return
    setMerging(true)
    try {
      const r = await fetch('/api/contacts/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ survivorId: survivor.id, mergedId: goner.id, apply: true }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not merge')
      showToast(`${goner.name} merged into ${survivor.name} · ${d.total} record${d.total === 1 ? '' : 's'} moved`, 'success')
      window.setTimeout(() => window.location.reload(), 900)
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not merge', 'error')
    } finally {
      setMerging(false)
    }
  }

  const line = (c: Contact) => [c.phone || c.mobile, c.email, c.vatNumber].filter(Boolean).join(' · ')

  return (
    <Modal
      title="Merge duplicate contact"
      subtitle={duplicate.name}
      width={540}
      variant="enterprise"
      onClose={() => { if (!merging) onClose() }}
      footer={(
        <>
          <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={onClose} disabled={merging}>Cancel</button>
          <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={() => void run()} disabled={!preview || loading || merging}>
            {merging ? 'Merging…' : survivor ? `Merge into ${survivor.name}` : 'Merge'}
          </button>
        </>
      )}
    >
      <div className="contact-merge">
        <SearchPicker
          label="The contact to keep *"
          placeholder="Search by name, phone, email or KRA PIN…"
          items={candidates.map(x => x.c)}
          onSelect={c => { setKeep(c); setSwap(false) }}
          formatSelected={c => c.name}
          selectedLabel={keep?.name}
          searchText={c => [c.phone, c.mobile, c.email, c.vatNumber, c.tradingName].filter(Boolean).join(' ')}
          emptyText="No other contact matches"
          renderItem={c => (
            <div className="min-w-0">
              <p className="font-bold text-xs truncate">{c.name}</p>
              <p className="text-[11px] text-[var(--text-4)] truncate">{line(c) || (c.type === 'company' ? 'Company' : 'Individual')}</p>
            </div>
          )}
        />
        {!keep && suggested.length > 0 && (
          <div className="contact-merge__suggest">
            <p>Looks like the same {duplicate.type === 'company' ? 'organisation' : 'person'}:</p>
            {suggested.map(c => (
              <button key={c.id} type="button" onClick={() => { setKeep(c); setSwap(false) }}>
                <b>{c.name}</b><small>{line(c)}</small>
              </button>
            ))}
          </div>
        )}

        {survivor && goner && (
          <>
            <div className="contact-merge__pair">
              <div className="is-gone"><small>Goes (archived)</small><b>{goner.name}</b><span>{line(goner)}</span></div>
              <span aria-hidden="true">→</span>
              <div className="is-kept"><small>Stays</small><b>{survivor.name}</b><span>{line(survivor)}</span></div>
            </div>
            <button type="button" className="contact-merge__swap" onClick={() => setSwap(s => !s)}>Keep {goner.name} instead</button>

            {loading ? <p className="contact-merge__note">Checking what moves…</p> : preview && (
              <>
                {preview.total > 0 ? (
                  <ul className="contact-merge__areas">
                    {preview.areas.map(a => <li key={a.label}><span>{a.label}</span><b>{a.count}</b></li>)}
                  </ul>
                ) : <p className="contact-merge__note">{goner.name} has no documents; only the contact is archived.</p>}
                {preview.filled.length > 0 && (
                  <p className="contact-merge__note">{survivor.name} also takes its missing {preview.filled.map(f => FIELD_LABELS[f] ?? f).join(', ')}.</p>
                )}
                <p className="contact-merge__note">
                  Balances, statements and history then show under {survivor.name}. {goner.name} is archived with a note, not deleted. Undoing a merge is not automatic.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
