'use client'

import { useMemo, useState } from 'react'
import { Field, Input, Modal, SearchPicker } from '@/components/ui'
import { useInventoryStore, useRepairStore } from '@/lib/store'
import {
  PARTS_ADJUST_ROLES, PARTS_ARRIVED_ROLES, PARTS_ORDER_ROLES,
  countCorrectionBlocker, needsCountCorrection, partsQueue,
  type PartsQueueRow, type PartsRequest,
} from '@/lib/repair/parts-request'

/**
 * Parts technicians asked for, and what the desk does next.
 *
 * A request means the part could not be found on the shelf. So: if the system
 * still shows it in the warehouse, correct the count first (a stock
 * adjustment); then buy it on a purchase order linked to the repair; the
 * repair resumes when that order is received, or when the parts are marked
 * arrived.
 */

type Dialog =
  | { kind: 'adjust'; row: PartsQueueRow }
  | { kind: 'order'; row: PartsQueueRow }

type OrderLineForm = { itemIndex: number; productId: string; productName: string; qty: string; unitPrice: string }

const URGENCY: Record<string, string> = {
  urgent: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  normal: 'bg-slate-100 text-slate-600 border-slate-200',
  low: 'bg-slate-50 text-slate-500 border-slate-200',
}
const today = () => new Date().toISOString().slice(0, 10)

export default function PartsRequestsPanel() {
  const { repairs, products, contacts, users, currentUserId, markPartsArrived, correctPartsCount, raisePartsPurchaseOrder } = useRepairStore()
  const { getStockByLocation, stockAdjustments } = useInventoryStore()
  const role = String(users.find(u => u.id === currentUserId)?.role ?? '')
  const canAdjust = PARTS_ADJUST_ROLES.includes(role) || role === 'inventory'
  const canOrder = PARTS_ORDER_ROLES.includes(role) || role === 'inventory'
  const canArrive = PARTS_ARRIVED_ROLES.includes(role)

  const rows = useMemo(() => partsQueue(repairs as never, today()), [repairs])
  const vendors = useMemo(() => contacts.filter(c => c.isVendor).map(c => ({ id: c.id, name: c.name })), [contacts])
  const productOptions = useMemo(() => products.filter(p => p.isActive !== false).map(p => ({ id: p.id, name: p.name, sku: p.sku ?? '' })), [products])
  const warehouseQty = (productId: string) => (productId ? Number(getStockByLocation(productId)?.warehouse ?? 0) : 0)

  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [saving, setSaving] = useState(false)
  const [adjust, setAdjust] = useState({ itemIndex: 0, productId: '', productName: '', qtyMissing: '' })
  const [vendor, setVendor] = useState({ id: '', name: '' })
  const [lines, setLines] = useState<OrderLineForm[]>([])

  const openAdjust = (row: PartsQueueRow) => {
    const item = row.request.items[0]
    const qty = warehouseQty(item?.productId ?? '')
    setAdjust({ itemIndex: 0, productId: item?.productId ?? '', productName: item?.productId ? item.productName : '', qtyMissing: qty ? String(qty) : '' })
    setDialog({ kind: 'adjust', row })
  }
  const openOrder = (row: PartsQueueRow) => {
    setVendor({ id: '', name: '' })
    setLines(row.request.items.map((item, itemIndex) => ({
      itemIndex,
      productId: item.productId ?? '',
      productName: item.productId ? item.productName : '',
      qty: String(item.qty || 1),
      unitPrice: Number(item.estimatedCost) > 0 ? String(item.estimatedCost) : '',
    })))
    setDialog({ kind: 'order', row })
  }

  const submit = async () => {
    if (!dialog) return
    setSaving(true)
    try {
      if (dialog.kind === 'adjust') {
        const ok = correctPartsCount(dialog.row.repairId, dialog.row.request.id, {
          itemIndex: adjust.itemIndex, productId: adjust.productId, productName: adjust.productName, qtyMissing: Number(adjust.qtyMissing),
        })
        if (ok) setDialog(null)
      } else {
        const po = await raisePartsPurchaseOrder(dialog.row.repairId, dialog.row.request.id, vendor.id, vendor.name, lines.map(l => ({
          itemIndex: l.itemIndex, productId: l.productId, productName: l.productName, qty: Number(l.qty), unitPrice: Number(l.unitPrice),
        })))
        if (po) setDialog(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const adjustmentStatus = (ref: string) => stockAdjustments.find(a => a.ref === ref)?.status ?? 'pending'
  const itemLabel = (item: PartsRequest['items'][number]) => item.productId ? item.productName : (item.description || item.productName)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0">
        <h3 className="m-0 text-[13px] font-black text-[var(--text-1)]">Parts requests from repairs</h3>
        <p className="m-0 mt-0.5 max-w-2xl text-[11px] leading-relaxed text-[var(--text-3)]">
          A technician asks for a part when it is not on the shelf. <strong>1.</strong> If the system still shows it in the warehouse, correct the count.{' '}
          <strong>2.</strong> Raise a purchase order — receiving it puts the repair back to work. <strong>3.</strong> Otherwise mark the parts arrived.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="m-0 rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-6 text-center text-[12px] text-[var(--text-3)]">
          No open parts requests.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--border-lt)] overflow-hidden rounded-lg border border-[var(--border-lt)]">
          {rows.map(row => {
            const { request } = row
            const uncheckedStock = request.items.some(item => needsCountCorrection(request, item.productId, warehouseQty(item.productId)))
            return (
              <div key={`${row.repairId}:${request.id}`} className="flex flex-wrap items-start justify-between gap-3 bg-[var(--bg-card)] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[12px] font-bold text-[var(--text-1)]">
                    <span className="font-mono">{row.repairRef}</span>
                    {row.device ? <span className="ml-2 font-semibold text-[var(--text-2)]">{row.device}</span> : null}
                    <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${URGENCY[request.urgency] ?? URGENCY.normal}`}>{request.urgency || 'normal'}</span>
                  </p>
                  <p className="m-0 mt-0.5 text-[11px] text-[var(--text-3)]">
                    {row.customerName ? `${row.customerName} · ` : ''}asked by {request.requestedByName} · {row.ageDays === 0 ? 'today' : `${row.ageDays} day${row.ageDays === 1 ? '' : 's'} ago`}
                    {request.notes ? ` · “${request.notes}”` : ''}
                  </p>
                  <ul className="m-0 mt-1 list-none p-0 text-[11px] text-[var(--text-2)]">
                    {request.items.map((item, i) => {
                      const qty = warehouseQty(item.productId)
                      return (
                        <li key={i}>
                          {item.qty} × {itemLabel(item)}
                          {item.productId && request.status === 'pending' && (
                            needsCountCorrection(request, item.productId, qty)
                              ? <span className="ml-1 font-semibold" style={{ color: '#D97706' }}>— system shows {qty} in the warehouse; correct the count first</span>
                              : <span className="ml-1 text-[var(--text-3)]">— {qty} in the warehouse</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {(request.adjustmentRefs ?? []).length > 0 && (
                    <p className="m-0 mt-1 text-[11px] text-[var(--text-3)]">
                      Count corrected: {(request.adjustmentRefs ?? []).map(ref => `${ref} (${adjustmentStatus(ref)})`).join(', ')}
                    </p>
                  )}
                  {row.step === 'awaiting_delivery' && (
                    <p className="m-0 mt-1 text-[11px] text-[var(--text-2)]">
                      Ordered on <span className="font-mono font-semibold">{request.orderReference}</span>{request.orderedDate ? ` on ${String(request.orderedDate).slice(0, 10)}` : ''}.
                      {' '}Confirm it and receive it on the GRN in Purchase — the repair resumes by itself.
                    </p>
                  )}
                  {row.step === 'mark_arrived' && (
                    <p className="m-0 mt-1 text-[11px] text-[var(--text-2)]">Parts are in. Mark them arrived to hand the repair back to the technician.</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {row.step === 'adjust_then_order' && (
                    <>
                      {canAdjust && (
                        <button type="button" className={uncheckedStock ? 'btn-primary px-3 py-1.5 text-[11px]' : 'btn-secondary px-3 py-1.5 text-[11px]'} onClick={() => openAdjust(row)}>
                          1 · Correct stock count
                        </button>
                      )}
                      {canOrder && (
                        <button type="button" className={uncheckedStock ? 'btn-secondary px-3 py-1.5 text-[11px]' : 'btn-primary px-3 py-1.5 text-[11px]'} onClick={() => openOrder(row)}>
                          2 · Raise purchase order
                        </button>
                      )}
                    </>
                  )}
                  {row.step === 'mark_arrived' && canArrive && (
                    <button type="button" className="btn-primary px-3 py-1.5 text-[11px]" onClick={() => markPartsArrived(row.repairId)}>
                      Mark parts arrived
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {dialog && (
        <Modal
          variant="enterprise"
          title={dialog.kind === 'adjust' ? 'Correct the stock count' : 'Raise a purchase order'}
          subtitle={`${dialog.row.repairRef} · asked by ${dialog.row.request.requestedByName}`}
          onClose={() => setDialog(null)}
          width={600}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setDialog(null)} disabled={saving}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : dialog.kind === 'adjust' ? 'Submit adjustment' : 'Raise purchase order'}
              </button>
            </div>
          )}
        >
          {dialog.kind === 'adjust' ? (() => {
            const systemQty = warehouseQty(adjust.productId)
            const blocker = adjust.productId ? countCorrectionBlocker(systemQty, Number(adjust.qtyMissing)) : null
            return (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-[11px] leading-relaxed text-[var(--text-2)]">
                  The technician could not find this part, so any the system shows in the warehouse are not really there.
                  This raises a <strong>stock count correction</strong> for approval; nothing is ordered until the count is right.
                </p>
                {dialog.row.request.items.length > 1 && (
                  <Field label="Requested part">
                    <select className="form-input" value={adjust.itemIndex} onChange={e => {
                      const itemIndex = Number(e.target.value)
                      const item = dialog.row.request.items[itemIndex]
                      const qty = warehouseQty(item?.productId ?? '')
                      setAdjust({ itemIndex, productId: item?.productId ?? '', productName: item?.productId ? item.productName : '', qtyMissing: qty ? String(qty) : '' })
                    }}>
                      {dialog.row.request.items.map((item, i) => <option key={i} value={i}>{item.qty} × {itemLabel(item)}</option>)}
                    </select>
                  </Field>
                )}
                <SearchPicker
                  label="Catalogue product"
                  placeholder={`Search for “${dialog.row.request.items[adjust.itemIndex]?.description || 'the part'}”…`}
                  items={productOptions}
                  selectedLabel={adjust.productName || undefined}
                  formatSelected={p => p.name}
                  onSelect={p => {
                    const qty = warehouseQty(p.id)
                    setAdjust(a => ({ ...a, productId: p.id, productName: p.name, qtyMissing: qty ? String(qty) : '' }))
                  }}
                  renderItem={p => <span className="text-sm">{p.name}<span className="ml-2 font-mono text-xs text-slate-400">{p.sku}</span></span>}
                />
                {adjust.productId && (
                  <p className="m-0 text-[12px] text-[var(--text-2)]">
                    The system shows <strong className="tabular-nums">{systemQty}</strong> in the warehouse.
                    {systemQty <= 0 ? ' Nothing to correct — go straight to the purchase order.' : ''}
                  </p>
                )}
                {systemQty > 0 && (
                  <Field label="How many are not on the shelf" hint="Count the shelf; enter the difference">
                    <Input type="number" value={adjust.qtyMissing} onChange={v => setAdjust(a => ({ ...a, qtyMissing: v }))} />
                  </Field>
                )}
                {blocker && systemQty > 0 && <p className="m-0 text-[11px] font-semibold" style={{ color: '#D97706' }}>{blocker}</p>}
              </div>
            )
          })() : (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-[11px] leading-relaxed text-[var(--text-2)]">
                This raises a <strong>draft purchase order</strong> linked to {dialog.row.repairRef}. Confirm it in Purchase; when it is received on the GRN,
                the parts are reserved for the repair and the technician is told.
              </p>
              <SearchPicker
                label="Vendor"
                placeholder="Search vendors…"
                items={vendors}
                selectedLabel={vendor.name || undefined}
                formatSelected={v => v.name}
                onSelect={v => setVendor({ id: v.id, name: v.name })}
                renderItem={v => <span className="text-sm">{v.name}</span>}
              />
              {lines.map((line, i) => {
                const item = dialog.row.request.items[line.itemIndex]
                const patchLine = (p: Partial<OrderLineForm>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...p } : l))
                return (
                  <div key={line.itemIndex} className="rounded-lg border border-[var(--border-lt)] p-3">
                    <p className="m-0 mb-2 text-[11px] font-bold text-[var(--text-2)]">Requested: {item?.qty} × {item ? itemLabel(item) : ''}</p>
                    <SearchPicker
                      label="Catalogue product"
                      placeholder="Search products…"
                      items={productOptions}
                      selectedLabel={line.productName || undefined}
                      formatSelected={p => p.name}
                      onSelect={p => patchLine({ productId: p.id, productName: p.name })}
                      renderItem={p => <span className="text-sm">{p.name}<span className="ml-2 font-mono text-xs text-slate-400">{p.sku}</span></span>}
                    />
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <Field label="Qty"><Input type="number" value={line.qty} onChange={v => patchLine({ qty: v })} /></Field>
                      <Field label="Unit price"><Input type="number" value={line.unitPrice} onChange={v => patchLine({ unitPrice: v })} /></Field>
                    </div>
                    {line.productId && needsCountCorrection(dialog.row.request, line.productId, warehouseQty(line.productId)) && (
                      <p className="m-0 mt-2 text-[11px] font-semibold" style={{ color: '#D97706' }}>
                        The system shows {warehouseQty(line.productId)} in the warehouse — correct the count first.
                      </p>
                    )}
                    <button type="button" className="mt-2 text-[11px] font-semibold text-[var(--text-3)] underline" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>
                      Leave this part off the order
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
