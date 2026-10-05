'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui'
import { useApp, fmtKes } from '@/lib/store'
import { loadXlsx } from '@/lib/xlsx-lazy'
import {
  INBOUND_TEMPLATE_HEADERS,
  applyProductPicks,
  buildInboundLines,
  isSerialProduct,
  rowsFromSheet,
  type InboundProduct,
  type InboundSourceRow,
} from '@/lib/inventory/inbound-import'

const SHEET_TYPES = /\.(xlsx|xls|csv)$/i
const DOC_TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

/** Resolve once `get` returns something — the store applies state on the next render. */
async function waitFor<T>(get: () => T | null | undefined, timeoutMs = 10_000): Promise<T | null> {
  const started = Date.now()
  for (;;) {
    const value = get()
    if (value) return value
    if (Date.now() - started > timeoutMs) return null
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^data:[^,]+,/, ''))
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Inventory → Inbound → Import delivery. A supplier's delivery from an Excel /
 * CSV sheet or a PDF / photo becomes a purchase order, and the goods received
 * note opens filled in with Inbound chosen — one check and one click to
 * receive (lib/inventory/inbound-import.ts).
 */
export default function InboundImport({ onClose }: { onClose: () => void }) {
  const app = useApp() as any
  const live = useRef(app)
  live.current = app
  const router = useRouter()
  const { products = [], contacts = [], serials = [], showToast } = app

  const vendors = useMemo(() => (contacts as any[]).filter(c => c.isVendor).sort((a, b) => String(a.name).localeCompare(String(b.name))), [contacts])
  const catalogue: InboundProduct[] = useMemo(() => (products as any[]).map(p => ({
    id: p.id, name: p.name, sku: p.sku, requiresSerial: p.requiresSerial, trackingMethod: p.trackingMethod,
    costPrice: Number(p.costPrice ?? p.cost) || 0, isActive: p.isActive !== false && p.active !== false,
  })), [products])
  const existingSerials = useMemo(() => new Set((serials as any[]).map(s => String(s.serial ?? '').toUpperCase())), [serials])

  const [vendorId, setVendorId] = useState('')
  const [fileName, setFileName] = useState('')
  const [reference, setReference] = useState('')
  const [rows, setRows] = useState<InboundSourceRow[]>([])
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [costs, setCosts] = useState<Record<string, number>>({})
  const [vatRate, setVatRate] = useState(16)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [openSerials, setOpenSerials] = useState<string | null>(null)
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const lines = useMemo(
    () => buildInboundLines(applyProductPicks(rows, picks, catalogue), catalogue, existingSerials)
      .filter(l => !removed.has(l.key))
      .map(l => (costs[l.key] != null ? { ...l, unitCost: costs[l.key] } : l)),
    [rows, picks, catalogue, existingSerials, costs, removed],
  )
  const blocking = lines.filter(l => l.issues.length)
  const units = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)

  const downloadTemplate = async () => {
    const XLSX = await loadXlsx()
    const ws = XLSX.utils.aoa_to_sheet([
      INBOUND_TEMPLATE_HEADERS,
      ['HP EliteBook 840 G8', '', '5CG1234ABC', 1, 38000],
      ['HP EliteBook 840 G8', '', '5CG1234ABD', 1, 38000],
      ['USB-C Charger 65W', '', '', 10, 900],
    ])
    ws['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 20 }, { wch: 6 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Delivery')
    XLSX.writeFile(wb, 'deed_inbound_delivery_template.xlsx')
  }

  const readFile = async (file: File) => {
    setError('')
    setRows([])
    setPicks({})
    setCosts({})
    setRemoved(new Set())
    setFileName(file.name)
    setReading(true)
    try {
      if (SHEET_TYPES.test(file.name)) {
        const XLSX = await loadXlsx()
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const parsed = rowsFromSheet(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false }))
        if (!parsed.length) throw new Error('No product rows found — the first row must be the headings (Product, Serial Number, Qty, Unit Cost)')
        setRows(parsed)
        return
      }
      const mimeType = DOC_TYPES[file.name.split('.').pop()?.toLowerCase() ?? '']
      if (!mimeType) throw new Error('Upload an Excel (.xlsx), CSV, PDF or photo')
      if (file.size > 15 * 1024 * 1024) throw new Error('The file is larger than 15 MB')
      const res = await fetch('/api/inventory/inbound-import/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: await fileToBase64(file), mimeType }),
      })
      const body = await res.json().catch(() => null) as { rows?: InboundSourceRow[]; supplierName?: string; documentReference?: string; error?: string } | null
      if (!res.ok || !body?.rows) throw new Error(body?.error || `The document could not be read (${res.status})`)
      setRows(body.rows)
      if (body.documentReference) setReference(body.documentReference)
      if (!vendorId && body.supplierName) {
        const match = vendors.find(v => norm(v.name) === norm(body.supplierName) || norm(body.supplierName).includes(norm(v.name)))
        if (match) setVendorId(match.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be read')
    } finally {
      setReading(false)
    }
  }

  const receive = async () => {
    const vendor = vendors.find(v => v.id === vendorId)
    if (!vendor) { setError('Choose the supplier'); return }
    if (!lines.length || blocking.length) return
    setSaving(true)
    setError('')
    try {
      const po = await app.createPO(vendor.id, vendor.name, {
        notes: `Imported into Inbound from ${fileName}${reference ? ` (supplier ref ${reference})` : ''}`,
      })
      if (!po?.id) throw new Error('The purchase order could not be created')
      app.bulkAddPOLines(po.id, lines.map(l => {
        const product = catalogue.find(p => p.id === l.productId)
        return {
          productId: l.productId!,
          productName: l.productName,
          qty: l.qty,
          unitPrice: l.unitCost,
          taxRate: vatRate,
          requiresSerial: isSerialProduct(product) || l.serials.length > 0,
          importedSerials: l.serials.length ? l.serials : undefined,
          accountCode: (products as any[]).find(p => p.id === l.productId)?.costAccountCode,
        }
      }))
      const ready = await waitFor(() => (live.current.purchaseOrders as any[]).find(p => p.id === po.id && p.lines?.length === lines.length))
      if (!ready) throw new Error(`${po.ref} was created but its lines did not load — open it in Purchases to finish`)
      await app.confirmPO(po.id)
      const receipt = await waitFor(() => (live.current.receipts as any[]).find(r => r.poId === po.id && r.status === 'draft'))
      if (!receipt) throw new Error(`${po.ref} is confirmed — open its goods received note in Purchases to receive it into Inbound`)
      showToast?.(`${po.ref} created — check the serials and click Receive`, 'success')
      onClose()
      router.push(`/purchases?tab=receipts&id=${encodeURIComponent(receipt.id)}&receive=inbound`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Import delivery into Inbound"
      subtitle="Excel / CSV, or a supplier PDF or photo — becomes a purchase order and a goods received note into Inbound"
      onClose={onClose}
      width={980}
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-t3">
            {lines.length ? `${lines.length} product${lines.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'} · ${fmtKes(total)} excl. VAT` : 'Nothing read yet'}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-outline text-[11px]" onClick={onClose} disabled={saving}>Cancel</button>
            <button
              type="button"
              className="btn-primary text-[11px]"
              disabled={saving || reading || !lines.length || blocking.length > 0 || !vendorId}
              onClick={() => void receive()}
            >
              {saving ? 'Creating…' : blocking.length ? `Fix ${blocking.length} line${blocking.length === 1 ? '' : 's'} first` : 'Create PO and receive into Inbound'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="flex flex-col gap-3 text-xs">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-t2">Supplier</span>
            <select className="form-input text-xs" value={vendorId} onChange={e => setVendorId(e.target.value)} aria-label="Supplier">
              <option value="">Choose the supplier…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-t2">Delivery file</span>
            <input
              type="file"
              className="form-input text-xs"
              aria-label="Delivery file"
              accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp"
              disabled={reading || saving}
              onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = '' }}
            />
          </label>
          <div className="flex items-end">
            <button type="button" className="btn-outline text-[11px]" onClick={() => void downloadTemplate()}>Excel template</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-t3">
          <label className="flex items-center gap-1">
            Supplier ref
            <input className="form-input w-40 text-xs" value={reference} onChange={e => setReference(e.target.value)} aria-label="Supplier invoice or delivery note number" />
          </label>
          <label className="flex items-center gap-1">
            VAT on these prices
            <select className="form-input text-xs" value={vatRate} onChange={e => setVatRate(Number(e.target.value))} aria-label="VAT rate">
              <option value={16}>16%</option>
              <option value={0}>0% / exempt</option>
            </select>
          </label>
          <span>Excel: one row per serial number (or several serials in one cell, separated by commas). PDFs and photos are read by AI — check every serial.</span>
        </div>

        {reading && <p className="rounded-lg bg-[var(--bg-muted)] p-3 text-t2">Reading {fileName}…</p>}
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-700">{error}</p>}

        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-t3">
                <tr>
                  <th className="py-1.5 pr-3 font-semibold">Product</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Qty</th>
                  <th className="py-1.5 pr-3 font-semibold">Serial numbers</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Unit cost</th>
                  <th className="py-1.5 pr-3 font-semibold">Check</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-lt)]">
                {lines.map(line => (
                  <tr key={line.key} className="align-top">
                    <td className="py-1.5 pr-3">
                      {line.productId ? (
                        <span className="font-semibold text-t1">{line.productName}</span>
                      ) : (
                        <select
                          className="form-input text-xs"
                          aria-label={`Product for ${line.sourceText}`}
                          value=""
                          onChange={e => setPicks(p => ({ ...p, [line.key.slice(1)]: e.target.value }))}
                        >
                          <option value="">Choose product for “{line.sourceText}”…</option>
                          {catalogue.filter(p => p.isActive !== false).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                      {line.productId && line.sourceText && norm(line.sourceText) !== norm(line.productName) && (
                        <span className="block text-[10px] text-t3">from “{line.sourceText}”</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{line.qty}</td>
                    <td className="py-1.5 pr-3">
                      {line.serials.length ? (
                        <button type="button" className="sp-linkish" onClick={() => setOpenSerials(openSerials === line.key ? null : line.key)}>
                          {line.serials.length} serial{line.serials.length === 1 ? '' : 's'}
                        </button>
                      ) : <span className="text-t3">{line.requiresSerial ? 'none' : 'not needed'}</span>}
                      {openSerials === line.key && (
                        <span className="mt-1 block max-w-[260px] break-words font-mono text-[10px] text-t2">{line.serials.join(', ')}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <input
                        type="number"
                        min={0}
                        className="form-input w-28 text-right text-xs"
                        aria-label={`Unit cost for ${line.productName}`}
                        value={line.unitCost || ''}
                        onChange={e => setCosts(c => ({ ...c, [line.key]: Math.max(0, Number(e.target.value) || 0) }))}
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      {line.issues.length
                        ? line.issues.map(issue => <span key={issue} className="block font-semibold text-red-700">{issue}</span>)
                        : <span className="font-semibold text-emerald-700">OK</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-t3 hover:text-red-700"
                        aria-label={`Remove ${line.productName}`}
                        onClick={() => setRemoved(r => new Set(r).add(line.key))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}
