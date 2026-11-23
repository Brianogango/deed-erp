'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFinanceStore, fmtKes } from '@/lib/store'
import { Modal } from '@/components/ui'
import { prepareImage } from '@/components/finance/cheque-image'
import { bankChoiceLabel } from '@/lib/finance/bank-choice-label'
import { chequeLinkedType, docBalance, openDocsForCheque } from '@/lib/cheques/cheque-link'
import { isStaleCheque, type ChequeDirection } from '@/lib/cheques/cheque-rules'

type Toast = (msg: string, type?: 'error' | 'success' | 'info') => void
type Scan = { chequeNumber: string; bankName: string; payeeName: string; accountName: string; amount: number | null; chequeDate: string; warnings: string[] }
type Row = {
  key: string
  preview?: string
  base64?: string
  mimeType?: string
  reading: boolean
  warnings: string[]
  chequeNumber: string
  bankName: string
  chequeDate: string
  amount: string
  docId: string
  saved?: boolean
  error?: string
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date())
const uid = () => Math.random().toString(36).slice(2)
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/**
 * Many cheques at once (e.g. 20 post-dated cheques over two years): photos are
 * read one by one, checked in a table, then saved to the register with their
 * photos. Each cheque linked to an invoice / bill pays it on its own date,
 * straight to the bank (lib/cheques/cheque-schedule.server.ts).
 */
export default function BulkCheques({ showToast, onClose, onSaved, initialFiles }: { showToast: Toast; onClose: () => void; onSaved: () => Promise<void>; initialFiles?: File[] }) {
  const { invoices, bankAccounts, contacts } = useFinanceStore()
  const [direction, setDirection] = useState<ChequeDirection>('received')
  const [party, setParty] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [defaultDoc, setDefaultDoc] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const activeBanks = (bankAccounts ?? []).filter(b => b.active)
  const now = today()

  const partyContacts = useMemo(() => (contacts ?? [])
    .filter(c => !c.isArchived && (direction === 'given' ? c.isVendor : c.isCustomer))
    .sort((a, b) => a.name.localeCompare(b.name)), [contacts, direction])
  const docs = useMemo(() => {
    const open = openDocsForCheque(invoices, direction)
    return party.trim() ? open.filter(d => norm(d.partnerName) === norm(party)) : open
  }, [invoices, direction, party])
  const docById = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs])

  const patch = (key: string, p: Partial<Row>) => setRows(list => list.map(r => (r.key === key ? { ...r, ...p } : r)))

  const addPhotos = async (picked: File[]) => {
    // One at a time from start to finish: each photo is shrunk, shown, then read, so the
    // phone never holds more than one full-size picture and rows appear as they go.
    let failed = 0
    for (const file of picked) {
      let row: Row
      try {
        const img = await prepareImage(file)
        row = { key: uid(), preview: img.previewUrl, base64: img.base64, mimeType: img.mimeType, reading: true, warnings: [], chequeNumber: '', bankName: '', chequeDate: '', amount: '', docId: defaultDoc }
      } catch {
        failed += 1
        continue
      }
      setRows(list => [...list, row])
      try {
        const res = await fetch('/api/cheques/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: row.base64, mimeType: row.mimeType }),
        })
        const scan = await res.json().catch(() => ({})) as Scan & { error?: string }
        if (!res.ok) throw new Error(scan.error || 'Could not read it')
        patch(row.key, {
          reading: false,
          warnings: scan.warnings ?? [],
          chequeNumber: scan.chequeNumber || '',
          bankName: scan.bankName || '',
          chequeDate: scan.chequeDate || '',
          amount: scan.amount ? String(scan.amount) : '',
        })
        const name = direction === 'received' ? scan.accountName : scan.payeeName
        if (name) setParty(p => p || name)
      } catch (err) {
        patch(row.key, { reading: false, warnings: [err instanceof Error ? err.message : 'Could not read it — type the details'] })
      }
    }
    if (failed) showToast(`${failed} of ${picked.length} file${picked.length === 1 ? '' : 's'} could not be opened as a picture — add ${failed === 1 ? 'it' : 'them'} by hand`, 'error')
  }

  const started = useRef(false)
  useEffect(() => {
    if (started.current || !initialFiles?.length) return
    started.current = true
    void addPhotos(initialFiles)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addBlank = () => setRows(list => [...list, { key: uid(), reading: false, warnings: [], chequeNumber: '', bankName: list[list.length - 1]?.bankName ?? '', chequeDate: '', amount: list[list.length - 1]?.amount ?? '', docId: defaultDoc }])

  // Checks before saving.
  const pending = rows.filter(r => !r.saved)
  const total = pending.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const numbers = pending.map(r => `${norm(r.bankName)}|${norm(r.chequeNumber)}`)
  const dupes = new Set(numbers.filter((n, i) => n !== '|' && numbers.indexOf(n) !== i))
  const problems = (r: Row): string[] => {
    const out: string[] = []
    if (!r.chequeNumber.trim()) out.push('number')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.chequeDate)) out.push('date')
    if (!(Number(r.amount) > 0)) out.push('amount')
    if (dupes.has(`${norm(r.bankName)}|${norm(r.chequeNumber)}`)) out.push('same number twice')
    if (r.chequeDate && isStaleCheque(r.chequeDate, now)) out.push('stale (over 6 months)')
    return out
  }
  const perDoc = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of pending) if (r.docId) m.set(r.docId, (m.get(r.docId) ?? 0) + (Number(r.amount) || 0))
    return [...m].map(([id, sum]) => ({ doc: docById.get(id), sum }))
  }, [pending, docById])
  const blocking = pending.some(r => r.reading || problems(r).some(p => p !== 'stale (over 6 months)'))
  const needsBank = pending.some(r => r.docId)

  const save = async () => {
    if (!party.trim()) { showToast(direction === 'received' ? 'Who are the cheques from?' : 'Who are the cheques to?', 'error'); return }
    if (blocking) { showToast('Fix the highlighted rows first', 'error'); return }
    if (needsBank && !bankAccountId) { showToast('Pick the bank account the cheques go through', 'error'); return }
    const list = rows.filter(r => !r.saved)
    setSaving({ done: 0, total: list.length })
    let ok = 0
    for (const [i, r] of list.entries()) {
      const doc = r.docId ? docById.get(r.docId) : undefined
      try {
        const res = await fetch('/api/cheques', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            direction,
            chequeNumber: r.chequeNumber.trim(),
            bankName: r.bankName.trim(),
            partyName: party.trim(),
            amount: Number(r.amount),
            chequeDate: r.chequeDate,
            receivedDate: now,
            linkedRef: doc?.ref,
            linkedType: doc ? chequeLinkedType(doc.type) : undefined,
            imageBase64: r.base64,
            imageType: r.mimeType,
            ...(doc ? { scheduleInvoiceId: doc.id, bankAccountId } : {}),
          }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || 'Not saved')
        patch(r.key, { saved: true, error: undefined })
        ok++
      } catch (err) {
        patch(r.key, { error: err instanceof Error ? err.message : 'Not saved' })
      }
      setSaving({ done: i + 1, total: list.length })
    }
    setSaving(null)
    const failed = list.length - ok
    showToast(failed ? `${ok} cheque${ok === 1 ? '' : 's'} saved; ${failed} not — see the rows marked in red` : `${ok} cheque${ok === 1 ? '' : 's'} saved with their photos`, failed ? 'error' : 'success')
    await onSaved()
    if (!failed) onClose()
  }

  return (
    <Modal
      title="Upload many cheques"
      subtitle="Post-dated cheques pay their invoice or bill on their own date"
      width={860}
      variant="enterprise"
      onClose={() => { if (!saving) onClose() }}
      footer={(
        <>
          <span className="bulk-cheques__total">{pending.length} cheque{pending.length === 1 ? '' : 's'} · {fmtKes(total)}</span>
          <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={onClose} disabled={!!saving}>Cancel</button>
          <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={() => void save()} disabled={!!saving || pending.length === 0}>
            {saving ? `Saving ${saving.done} of ${saving.total}…` : `Save ${pending.length} cheque${pending.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    >
      <div className="bulk-cheques">
        <div className="bulk-cheques__settings">
          <div className="bulk-cheques__dir" role="radiogroup" aria-label="Cheques">
            {(['received', 'given'] as const).map(d => (
              <button key={d} type="button" role="radio" aria-checked={direction === d} className={direction === d ? 'is-active' : ''}
                onClick={() => { setDirection(d); setDefaultDoc(''); setRows(list => list.map(r => ({ ...r, docId: '' }))) }}>
                {d === 'received' ? 'From a customer' : 'To a supplier'}
              </button>
            ))}
          </div>
          <label>
            <span>{direction === 'received' ? 'Customer' : 'Supplier'} *</span>
            <input className="form-input" list="bulk-cheque-party" value={party} onChange={e => setParty(e.target.value)} placeholder="Name on the cheques" />
            <datalist id="bulk-cheque-party">{partyContacts.map(c => <option key={c.id} value={c.name} />)}</datalist>
          </label>
          <label>
            <span>Bank account{needsBank ? ' *' : ''}</span>
            <select className="form-input" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">{direction === 'received' ? 'Banked into…' : 'Drawn on…'}</option>
              {activeBanks.map(b => <option key={b.id} value={b.id}>{bankChoiceLabel(b)}</option>)}
            </select>
          </label>
          <label>
            <span>Pays (for every cheque)</span>
            <select className="form-input" value={defaultDoc} onChange={e => { const v = e.target.value; setDefaultDoc(v); setRows(list => list.map(r => (r.saved ? r : { ...r, docId: v }))) }}>
              <option value="">{docs.length ? 'Choose the invoice / bill…' : `No open ${direction === 'received' ? 'invoices' : 'bills'}${party ? ` for ${party}` : ''}`}</option>
              {docs.map(d => <option key={d.id} value={d.id}>{d.ref} · owes {fmtKes(docBalance(d))}</option>)}
            </select>
          </label>
        </div>

        <div className="bulk-cheques__add">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { const picked = Array.from(e.target.files ?? []); e.currentTarget.value = ''; if (picked.length) void addPhotos(picked) }} />
          <button type="button" className="btn-primary text-[13px]" onClick={() => fileRef.current?.click()}>Add cheque photos</button>
          <button type="button" className="btn-outline text-[13px]" onClick={addBlank}>Add a row by hand</button>
          <span>Pick all the photos at once; each is read and kept with its cheque.</span>
        </div>

        {perDoc.length > 0 && (
          <ul className="bulk-cheques__docs">
            {perDoc.map(({ doc, sum }) => doc && (
              <li key={doc.id} className={Math.abs(sum - docBalance(doc)) < 0.01 ? 'is-ok' : sum > docBalance(doc) ? 'is-over' : ''}>
                <b>{doc.ref}</b> owes {fmtKes(docBalance(doc))} · cheques {fmtKes(sum)}
                {Math.abs(sum - docBalance(doc)) < 0.01 ? ' ✓' : sum > docBalance(doc) ? ` · ${fmtKes(sum - docBalance(doc))} more than owed (only what is owed is applied)` : ` · ${fmtKes(docBalance(doc) - sum)} short`}
              </li>
            ))}
          </ul>
        )}

        {rows.length > 0 && (
          <ol className="bulk-cheques__rows">
            {rows.map((r, i) => {
              const issues = problems(r)
              return (
                <li key={r.key} className={r.saved ? 'is-saved' : r.error || issues.some(p => p !== 'stale (over 6 months)') ? 'is-bad' : ''}>
                  <span className="bulk-cheques__n">{i + 1}</span>
                  {r.preview
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.preview} alt={`Cheque ${i + 1}`} />
                    : <span className="bulk-cheques__nophoto">No photo</span>}
                  <div className="bulk-cheques__fields">
                    <input className="form-input" aria-label="Cheque number" placeholder={r.reading ? 'Reading…' : 'Cheque no.'} value={r.chequeNumber} disabled={r.saved} onChange={e => patch(r.key, { chequeNumber: e.target.value })} />
                    <input className="form-input" aria-label="Bank" placeholder="Bank" value={r.bankName} disabled={r.saved} onChange={e => patch(r.key, { bankName: e.target.value })} />
                    <input className="form-input" aria-label="Date on the cheque" type="date" value={r.chequeDate} disabled={r.saved} onChange={e => patch(r.key, { chequeDate: e.target.value })} />
                    <input className="form-input" aria-label="Amount" type="number" placeholder="Amount" value={r.amount} disabled={r.saved} onChange={e => patch(r.key, { amount: e.target.value })} />
                    <select className="form-input" aria-label="Pays" value={r.docId} disabled={r.saved} onChange={e => patch(r.key, { docId: e.target.value })}>
                      <option value="">Register only</option>
                      {docs.map(d => <option key={d.id} value={d.id}>{d.ref}</option>)}
                    </select>
                  </div>
                  <div className="bulk-cheques__state">
                    {r.saved ? <span className="is-ok">Saved</span>
                      : r.error ? <span className="is-bad">{r.error}</span>
                      : r.reading ? <span>Reading…</span>
                      : issues.length ? <span className={issues.every(p => p.startsWith('stale')) ? '' : 'is-bad'}>Check: {issues.join(', ')}</span>
                      : r.docId ? <span>{r.chequeDate <= now ? 'Pays now' : `Pays on ${r.chequeDate}`}</span>
                      : <span>Register only</span>}
                    {r.warnings.length > 0 && !r.saved && <small>{r.warnings.join(' · ')}</small>}
                    {!r.saved && <button type="button" onClick={() => setRows(list => list.filter(x => x.key !== r.key))} disabled={!!saving}>Remove</button>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </Modal>
  )
}
