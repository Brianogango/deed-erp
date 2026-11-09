'use client'

import { useMemo, useRef, useState } from 'react'
import { Field, Input, Modal, Select } from '@/components/ui'
import { LOCATIONS, useApp, type LocationId } from '@/lib/store'
import { PLACEHOLDER_KINDS, type PlaceholderKind } from '@/lib/refurbishment/unidentified'
import { printLabelsForSerialUnits } from '@/lib/inventory/print-serial-device-label'
import { INTAKE_SHEET_COLUMNS, parseIntakeSheet, type IntakeSheetRow } from '@/lib/refurbishment/intake-sheet'
import { readXlsx } from '@/lib/inventory/read-xlsx'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import { loadXlsx } from '@/lib/xlsx-lazy'

type Unit = { serial: string; assetId: string; issue: string; cost: string }
const blankUnit = (): Unit => ({ serial: '', assetId: '', issue: '', cost: '' })

const isSerialized = (p: { requiresSerial?: boolean; trackingMethod?: string }) => Boolean(p.requiresSerial || p.trackingMethod === 'SERIAL')

/**
 * Machines in for repair work, one by one or from Excel. Each gets an asset
 * ID (its sticker for life — typed when it already has one) and, without a
 * serial, a UNK- tag. They wait in With Issues (default) until sent to
 * Refurbishment, or go straight to the bench. Specs are not asked for: the
 * technician records them when identifying the machine.
 */
export function TaggedIntakeModal({ onClose }: { onClose: () => void }) {
  const { products, bulkStock, serials, intakeTaggedMachines, refreshProductCatalog, showToast } = useApp()
  const [mode, setMode] = useState<'rows' | 'excel'>('rows')
  const [where, setWhere] = useState<'stock' | 'unrecorded'>('unrecorded')
  const [destination, setDestination] = useState<'with_issues' | 'refurbishment'>('with_issues')
  const [sourceProductId, setSourceProductId] = useState('')
  const [sourceLocation, setSourceLocation] = useState<LocationId | ''>('')
  const [fileAs, setFileAs] = useState<PlaceholderKind | 'known'>('laptop')
  const [knownProductId, setKnownProductId] = useState('')
  const [units, setUnits] = useState<Unit[]>([blankUnit()])
  const [sheet, setSheet] = useState<IntakeSheetRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Quantity stock (no serials) of devices that could be machines.
  const stockRows = useMemo(() => bulkStock
    .filter(b => Number(b.qty) > 0)
    .map(b => ({ ...b, product: products.find(p => p.id === b.productId) }))
    .filter(b => b.product && !isSerialized(b.product)), [bulkStock, products])
  const sourceProducts = useMemo(() => {
    const ids = [...new Set(stockRows.map(r => r.productId))]
    return ids.map(id => products.find(p => p.id === id)!).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
  }, [stockRows, products])
  const sourceLocations = stockRows.filter(r => r.productId === sourceProductId)
  const available = sourceLocations.filter(r => r.location === sourceLocation).reduce((s, r) => s + Number(r.qty), 0)
  const serialProducts = useMemo(() => products.filter(p => isSerialized(p) && p.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)), [products])
  const fromStock = mode === 'rows' && where === 'stock'

  const setCount = (raw: string) => {
    const n = Math.max(1, Math.min(200, Math.floor(Number(raw) || 1)))
    setUnits(prev => Array.from({ length: n }, (_, i) => prev[i] ?? blankUnit()))
  }
  const patchUnit = (i: number, patch: Partial<Unit>) => setUnits(prev => prev.map((u, j) => (j === i ? { ...u, ...patch } : u)))
  const givenTotal = units.reduce((s, u) => s + (u.cost.trim() ? Math.max(0, Number(u.cost) || 0) : 0), 0)

  /** The product machines are filed under when their model is not known. */
  async function fallbackProductId(): Promise<string | null> {
    if (fileAs === 'known') return knownProductId || null
    const res = await fetch('/api/refurbishment/placeholders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: fileAs }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.product?.id) { setError(data.error || 'Could not set up the unidentified product'); return null }
    if (data.created) await refreshProductCatalog().catch(() => 0)
    return data.product.id
  }

  async function downloadTemplate() {
    const XLSX = await loadXlsx()
    const ws = XLSX.utils.aoa_to_sheet([
      [...INTAKE_SHEET_COLUMNS],
      ['HP EliteBook 840 G5', '5CG81236', 'DT000005', 'No display', 12000],
      ['HP EliteBook 840 G5', '', '', 'Dead, no power', ''],
    ])
    ws['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 30 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Machines')
    XLSX.writeFile(wb, 'machine-intake-template.xlsx')
  }

  async function readSheet(file: File) {
    setError('')
    try {
      guardSpreadsheetFile(file)
      const rows = await readXlsx(file)
      guardSpreadsheetRows(rows)
      const parsed = parseIntakeSheet(rows, products, serials as never)
      if (!parsed.length) { setError('No machines found in the file. Use the template: Model, Serial, Asset ID, Issues, Cost.'); return }
      if (parsed.length > 200) { setError(`The file has ${parsed.length} machines — up to 200 at a time`); return }
      setSheet(parsed)
    } catch (err) {
      setError(err instanceof SpreadsheetGuardError ? err.message : 'Could not read that file. Save it as .xlsx and try again.')
    }
  }

  async function submit() {
    setError('')
    if (mode === 'excel') {
      if (!sheet?.length) return setError('Upload the filled template first')
      const bad = sheet.filter(r => r.problem)
      if (bad.length) return setError(`Fix ${bad.length} row${bad.length === 1 ? '' : 's'} first (line ${bad.map(r => r.line).slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''})`)
    } else {
      if (fromStock) {
        if (!sourceProductId || !sourceLocation) return setError('Choose the stock they are counted under, and where')
        if (units.length > available) return setError(`Only ${available} at ${LOCATIONS[sourceLocation as LocationId]?.name ?? sourceLocation}`)
      }
      if (units.some(u => u.cost.trim() && !(Number(u.cost) >= 0))) return setError('Costs must be 0 or more')
    }
    if (fileAs === 'known' && !knownProductId) return setError('Choose the model, or file them as unidentified')
    setSaving(true)
    try {
      const needsFallback = mode === 'rows' || sheet!.some(r => !r.productId)
      const fallback = needsFallback ? await fallbackProductId() : null
      if (needsFallback && !fallback) return
      const lines = mode === 'excel'
        ? sheet!.map(r => ({ productId: r.productId ?? fallback!, serial: r.serial || undefined, assetId: r.assetId || undefined, issue: r.issue, cost: r.cost }))
        : units.map(u => ({ serial: u.serial.trim() || undefined, assetId: u.assetId.trim() || undefined, issue: u.issue.trim(), cost: u.cost.trim() ? Number(u.cost) : null }))
      const made = await intakeTaggedMachines({
        productId: (mode === 'excel' ? (fallback ?? sheet![0].productId) : fallback) as string,
        units: lines,
        from: fromStock ? { productId: sourceProductId, location: sourceLocation as LocationId } : undefined,
        reference: `${destination === 'with_issues' ? 'ISSUES-IN' : 'REFURB-IN'} ${new Date().toISOString().slice(0, 10)}`,
        destination,
      })
      if (made) setDone(made)
    } finally {
      setSaving(false)
    }
  }

  async function printStickers() {
    if (!done) return
    const wanted = new Set(done)
    const rows = serials.filter(s => wanted.has(String((s as { assetId?: string }).assetId ?? '')) || wanted.has(s.serial))
    if (!rows.length) { showToast('The stickers are not ready yet — try again in a moment', 'info'); return }
    await printLabelsForSerialUnits({ serials: rows, products }).catch(() => showToast('Could not open the label print. Allow pop-ups for this site.', 'error'))
  }

  if (done) {
    return (
      <Modal title="Machines taken in" onClose={onClose} width={480}>
        <div className="space-y-3">
          <p className="text-xs text-t2">
            {done.length} machine{done.length === 1 ? '' : 's'} {destination === 'with_issues' ? 'in With Issues — send them to Refurbishment from the With Issues list' : 'queued for refurbishment'}.
            Stick each sticker on its machine: the asset ID is its barcode from now on.
          </p>
          <div className="flex flex-wrap gap-1.5">{done.map(t => <span key={t} className="font-mono text-[11px] rounded-md px-2 py-0.5" style={{ background: 'var(--bg-muted)' }}>{t}</span>)}</div>
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={onClose}>Done</button>
            <button className="btn-primary" onClick={() => void printStickers()}>Print stickers</button>
          </div>
        </div>
      </Modal>
    )
  }

  const okRows = sheet?.filter(r => !r.problem).length ?? 0
  const count = mode === 'excel' ? (sheet?.length ?? 0) : units.length

  return (
    <Modal title="Add machines for repair" subtitle="Dead, unreadable or untested machines — each gets an asset ID sticker" onClose={onClose} width={760}>
      <div className="space-y-4">
        {error && <div role="alert" className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div>}

        <div className="flex gap-1 rounded-lg p-1 w-fit" style={{ background: 'var(--bg-muted)' }} role="tablist">
          {([['rows', 'Enter machines'], ['excel', 'Upload Excel']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => { setMode(id); setError('') }}
              className="rounded-md px-3 py-1.5 text-xs font-semibold" style={mode === id ? { background: 'var(--bg-card)', color: 'var(--text-1)', boxShadow: 'var(--shadow-xs)' } : { color: 'var(--text-3)' }}>
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Send them to" required>
            <Select value={destination} onChange={v => setDestination(v as 'with_issues' | 'refurbishment')} options={[
              { value: 'with_issues', label: 'With Issues (send to Refurbishment later)' },
              { value: 'refurbishment', label: 'Refurbishment now' },
            ]} />
          </Field>
          <Field label={mode === 'excel' ? 'Models not in the catalog' : 'File them under'} required hint="Unidentified ones move to the right model once identified">
            <Select value={fileAs} onChange={v => setFileAs(v as PlaceholderKind | 'known')} options={[
              ...PLACEHOLDER_KINDS.map(k => ({ value: k.id, label: `${k.label} — unidentified` })),
              { value: 'known', label: 'A model I know…' },
            ]} />
          </Field>
        </div>
        {fileAs === 'known' && (
          <Field label="Model" required>
            <Select value={knownProductId} onChange={setKnownProductId} options={[{ value: '', label: 'Choose a serial-tracked product…' }, ...serialProducts.map(p => ({ value: p.id, label: `${p.name}${p.sku ? ` · ${p.sku}` : ''}` }))]} />
          </Field>
        )}

        {mode === 'rows' ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
              <Field label="Where are they now?" required>
                <Select value={where} onChange={v => setWhere(v as 'stock' | 'unrecorded')} options={[
                  { value: 'unrecorded', label: 'Not on record yet' },
                  { value: 'stock', label: 'Counted in stock, without serials' },
                ]} />
              </Field>
              <Field label="How many" required>
                <Input type="number" value={String(units.length)} onChange={setCount} />
              </Field>
            </div>
            {fromStock && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Counted under" required hint="Their stock and cost come off this product">
                  <Select value={sourceProductId} onChange={v => { setSourceProductId(v); setSourceLocation('') }} options={[{ value: '', label: sourceProducts.length ? 'Choose the stock…' : 'No quantity stock found' }, ...sourceProducts.map(p => ({ value: p.id, label: p.name }))]} />
                </Field>
                <Field label="Location" required hint={sourceLocation ? `${available} there` : undefined}>
                  <Select value={sourceLocation} onChange={v => setSourceLocation(v as LocationId)} options={[{ value: '', label: 'Choose…' }, ...sourceLocations.map(r => ({ value: r.location, label: `${LOCATIONS[r.location as LocationId]?.name ?? r.location} (${r.qty})` }))]} />
                </Field>
              </div>
            )}
            <div>
              <p className="text-[11px] font-semibold text-t2 mb-1">Each machine <span className="font-normal text-t3">— all optional</span></p>
              <p className="text-[10px] text-t3 mb-2">
                Asset ID: type the sticker number if the machine has one; blank issues a new one (LT000124…). No serial: it gets a UNK- tag until identified.
                {fromStock ? ' Cost blank shares the stock\'s cost equally.' : ' Cost blank means no value.'}
              </p>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border-lt divide-y divide-border-lt">
                <div className="hidden sm:grid grid-cols-[28px_1fr_120px_1.3fr_100px] gap-2 px-2 py-1 text-[10px] font-semibold uppercase text-t3">
                  <span>#</span><span>Serial</span><span>Asset ID</span><span>Issues</span><span>Cost</span>
                </div>
                {units.map((u, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-[28px_1fr_120px_1.3fr_100px] items-center gap-2 px-2 py-1.5">
                    <span className="hidden sm:block text-[10px] text-t4 tabular-nums">{i + 1}</span>
                    <Input value={u.serial} onChange={v => patchUnit(i, { serial: v })} placeholder="Serial (if readable)" />
                    <Input value={u.assetId} onChange={v => patchUnit(i, { assetId: v.toUpperCase() })} placeholder="Auto" />
                    <Input value={u.issue} onChange={v => patchUnit(i, { issue: v })} placeholder="e.g. No display" />
                    <Input type="number" value={u.cost} onChange={v => patchUnit(i, { cost: v })} placeholder={fromStock ? 'Share' : 'KES'} />
                  </div>
                ))}
              </div>
              {givenTotal > 0 && <p className="text-[10px] text-t3 mt-1">Costs entered: KES {givenTotal.toLocaleString('en-KE')}</p>}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-outline text-xs" onClick={() => void downloadTemplate()}>Download template</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => fileRef.current?.click()}>{sheet ? 'Upload another file' : 'Upload filled template'}</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readSheet(f) }} />
              <span className="text-[10px] text-t3">Columns: {INTAKE_SHEET_COLUMNS.join(', ')} · only Model is needed · up to 200 machines</span>
            </div>
            {sheet && (
              <div className="rounded-lg border border-border-lt">
                <p className="px-3 py-2 text-[11px] font-semibold text-t2 border-b border-border-lt">{okRows} of {sheet.length} ready{okRows < sheet.length ? ` · ${sheet.length - okRows} to fix` : ''}</p>
                <div className="max-h-64 overflow-y-auto divide-y divide-border-lt">
                  {sheet.map(r => (
                    <div key={r.line} className="grid grid-cols-[44px_1.4fr_1fr_90px_80px] gap-2 px-3 py-1.5 text-[11px] items-start">
                      <span className="text-t4 tabular-nums">L{r.line}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-t1">{r.productName ?? r.model}</span>
                        {!r.productId && r.model && <span className="block text-[10px] text-t3">Not in catalog — filed as unidentified</span>}
                        {r.problem && <span className="block text-[10px] font-semibold" style={{ color: 'var(--danger-text)' }}>{r.problem}</span>}
                      </span>
                      <span className="truncate text-t2">{r.serial || <span className="text-t4">no serial</span>}{r.issue ? <span className="block truncate text-[10px] text-t3">{r.issue}</span> : null}</span>
                      <span className="font-mono text-t2">{r.assetId || <span className="text-t4">auto</span>}</span>
                      <span className="text-right tabular-nums text-t2">{r.cost != null ? r.cost.toLocaleString('en-KE') : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-t3">Specs are not needed here — the technician records them when identifying each machine. Trade-ins: use “Serial unknown — tag it” on the trade-in form.</p>
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving || (mode === 'excel' && (!sheet || okRows !== sheet.length))} onClick={() => void submit()}>
            {saving ? 'Saving…' : `Add ${count} machine${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
