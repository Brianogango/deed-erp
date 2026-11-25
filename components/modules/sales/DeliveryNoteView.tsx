'use client'
// Delivery-note view for a sale order: prepare, validate, reverse, and the
// serial assignment that goes with them.
//
// Split out of components/modules/Sales.tsx. Already fully prop-driven, so
// this is a verbatim move, not a rewrite.

import type { SalesOrderView } from './types'
import { MoreActionsMenu } from './MoreActionsMenu'
import { isSellableSerial } from '@/lib/inventory/sellable-stock'
import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { faPrint } from '@fortawesome/free-solid-svg-icons'
import SerialMultiSelect from '@/components/SerialMultiSelect'
import { fmtDate, LOCATIONS } from '@/lib/store'
import { Field, Input } from '@/components/ui'
import { DestructiveAction } from '@/components/erp'
import { SalesDocField, SalesDocPill, SalesDocWorkflow, deliveryStatusPill } from '@/components/modules/sales/workbench'
import { pairOrderLinesWithDeliveryLines } from '@/lib/delivery-prepare'
import { PartialDeliveryDialog } from '@/components/modules/sales/PartialDeliveryDialog'
import {
  DELIVERY_STATE_LABELS,
  effectiveDeliveryLineQty,
  deliveryDeliveredTotal,
  canGenerateDeliveryNote,
  isOpenDeliveryStatus,
  normalizeDeliveryStatus,
  deliveriesForSaleOrder,
  saleOrderLooksConfirmed,
} from '@/lib/odoo-sales-flow'
import { isNonStockSaleLine, isDeliveryNoteLine } from '@/lib/sales/non-stock-line'

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERY NOTE VIEW
// ═══════════════════════════════════════════════════════════════════════════
export function DeliveryNoteView({
  order, deliveries, contacts = [], focusDeliveryId, serials, products, companySettings, bankAccounts, deliveryQtys, setDeliveryQtys, savingDelivery,
  setSavingDelivery, prepareDelivery, validateDelivery, reverseDelivery, markDeliveryNoteGenerated, assignSerialsToSOLine, unassignSerialFromSOLine,
  updateDelivery, showToast, onBack, ensureWaitingDeliveryForSO,
  dnRecipientName, setDnRecipientName, dnRecipientPhone, setDnRecipientPhone,
  dnRecipientId, setDnRecipientId, dnAddress, setDnAddress, dnNotes, setDnNotes,
}: {
  order: SalesOrderView; deliveries: any[]; contacts?: any[]; focusDeliveryId?: string | null
  serials: any[]; products: any[]
  companySettings: any; bankAccounts: any[]
  deliveryQtys: Record<string, number>; setDeliveryQtys: (v: Record<string, number>) => void
  savingDelivery: boolean; setSavingDelivery: (v: boolean) => void
  prepareDelivery: (id: string, qtysDone?: Record<string, number>) => boolean
  validateDelivery: (id: string, qtysDone?: Record<string, number>, opts?: { cancelRemaining?: boolean }) => void
  reverseDelivery: (id: string, reason?: string) => Promise<boolean>
  markDeliveryNoteGenerated: (id: string) => Promise<boolean>
  assignSerialsToSOLine: (orderId: string, lineId: string, serialIds: string[]) => void
  unassignSerialFromSOLine: (orderId: string, lineId: string, serialId: string) => void
  updateDelivery: (id: string, p: any) => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void; onBack: () => void
  ensureWaitingDeliveryForSO: (id: string) => Promise<any>
  dnRecipientName: string; setDnRecipientName: (v: string) => void
  dnRecipientPhone: string; setDnRecipientPhone: (v: string) => void
  dnRecipientId: string; setDnRecipientId: (v: string) => void
  dnAddress: string; setDnAddress: (v: string) => void
  dnNotes: string; setDnNotes: (v: string) => void
}) {
  const orderDeliveries = deliveriesForSaleOrder(deliveries, order.id, { includeCancelled: true })
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(
    focusDeliveryId ?? null,
  )
  const [showPartialDialog, setShowPartialDialog] = useState(false)
  useEffect(() => {
    if (focusDeliveryId) setSelectedDeliveryId(focusDeliveryId)
  }, [focusDeliveryId])

  const pendingDelivery = orderDeliveries.find((d: any) => isOpenDeliveryStatus(d.status))
  const selectedDelivery =
    orderDeliveries.find((d: any) => d.id === selectedDeliveryId) ??
    pendingDelivery ??
    orderDeliveries.find((d: any) => d.status !== 'cancelled') ??
    orderDeliveries[0]
  const existingDelivery = selectedDelivery
  const orderConfirmed = order.status === 'sale' || saleOrderLooksConfirmed(order)
  const deliveryStatus = normalizeDeliveryStatus(existingDelivery?.status)
  // Always gate actions on the canonical status. Legacy records may store title-case
  // or alias values (for example "Waiting"), which previously made both forward
  // actions disappear even though the status badge correctly showed WAITING.
  // Allow re-prepare on Ready so duplicate-product qty mistakes can be corrected.
  const canPrepare = orderConfirmed && !!existingDelivery && isOpenDeliveryStatus(deliveryStatus)
    && ['draft', 'waiting', 'ready'].includes(deliveryStatus)
  const canValidate = orderConfirmed && !!existingDelivery && deliveryStatus === 'ready' && !!existingDelivery.preparedAt
  // A delivery raised in error can be undone: a validated one returns its
  // stock, serials and COGS journal; an open one is simply cancelled.
  const canReverse = !!existingDelivery && deliveryStatus !== 'cancelled'
  const canCreateDelivery = orderConfirmed && !existingDelivery && (order.lines ?? []).some((l: any) => isDeliveryNoteLine(l))
  const [serialScan, setSerialScan] = useState('')
  const [creatingDelivery, setCreatingDelivery] = useState(false)
  const autoCreateAttemptedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!canCreateDelivery) return
    if (autoCreateAttemptedFor.current === order.id) return
    autoCreateAttemptedFor.current = order.id
    setCreatingDelivery(true)
    void ensureWaitingDeliveryForSO(order.id).finally(() => setCreatingDelivery(false))
  }, [canCreateDelivery, ensureWaitingDeliveryForSO, order.id])

  const pickingSummary = useMemo(() => {
    const pairs = pairOrderLinesWithDeliveryLines(order.lines, existingDelivery?.lines ?? [])
    let required = 0
    let picked = 0
    for (const { orderLine: l, deliveryLine: delLine } of pairs) {
      if ((l as any).lineType === 'section') continue
      if (!isDeliveryNoteLine(l)) continue
      const demand = Math.max(0, Number(l.qty) || 0)
      required += demand
      const serialCount = Array.isArray(l.serialIds) ? l.serialIds.length : 0
      const typed = Math.max(0, Number(deliveryQtys[l.id]) || 0)
      const effective = effectiveDeliveryLineQty({
        qty: Number(delLine?.qty) || demand,
        qtyDone: delLine?.qtyDone,
        serialIds: delLine?.serialIds?.length ? delLine.serialIds : l.serialIds,
      })
      const linePicked = canPrepare
        ? Math.min(demand, Math.max(typed, serialCount, effective))
        : Math.min(demand, Math.max(Number(l.qtyDelivered) || 0, effective, serialCount))
      picked += linePicked
    }
    const remaining = Math.max(0, required - picked)
    const pct = required > 0 ? Math.round((picked / required) * 100) : 0
    return { required, picked, remaining, pct }
  }, [order.lines, existingDelivery, deliveryQtys, canPrepare])

  const handleSerialScan = (e: FormEvent) => {
    e.preventDefault()
    if (!canPrepare) return
    const value = serialScan.trim().toUpperCase()
    if (!value) return
    const match = serials.find((s: any) => {
      const sn = String(s.serial ?? s.serialNumber ?? '').toUpperCase()
      return sn === value &&
        isSellableSerial(s)
    })
    if (!match) {
      showToast(`Invalid or unavailable serial ${value}`, 'error')
      setSerialScan('')
      return
    }
    const targetLine = order.lines.find(l => {
      if ((l as any).lineType === 'section' || l.productId !== match.productId) return false
      const assigned = Array.isArray(l.serialIds) ? l.serialIds.length : 0
      return assigned < l.qty
    })
    if (!targetLine) {
      showToast(`No open line for serial ${value}`, 'error')
      setSerialScan('')
      return
    }
    const assigned = Array.isArray(targetLine.serialIds) ? targetLine.serialIds : []
    if (assigned.includes(match.id)) {
      showToast(`Duplicate scan ${value}`, 'error')
      setSerialScan('')
      return
    }
    assignSerialsToSOLine(order.id, targetLine.id, [match.id])
    showToast(`Scanned ${value}`, 'success')
    setSerialScan('')
  }

  const selectDelivery = (deliveryId: string) => {
    const target = orderDeliveries.find((d: any) => d.id === deliveryId)
    if (!target || target.status === 'cancelled') return
    setSelectedDeliveryId(deliveryId)
    const init: Record<string, number> = {}
    for (const { orderLine: line, deliveryLine: delLine } of pairOrderLinesWithDeliveryLines(order.lines, target.lines ?? [])) {
      init[line.id] = Math.max(0, Number(line.qty) || Number(delLine?.qty) || 0)
    }
    setDeliveryQtys(init)
    const contact = contacts.find(c => c.id === order.customerId)
    setDnRecipientName(target.recipientName || order.customerName || contact?.name || '')
    setDnRecipientPhone(target.recipientPhone || contact?.phone || contact?.mobile || '')
    setDnRecipientId(target.recipientIdNumber || contact?.idNumber || '')
    setDnAddress(
      target.deliveryAddress
      || order.deliveryAddress
      || [contact?.address, contact?.city].filter(Boolean).join(', ')
      || '',
    )
    setDnNotes(target.notes ?? '')
  }

  const requestedByProduct = () => {
    const quantities: Record<string, number> = {}
    order.lines.forEach(line => {
      if ((line as any).lineType === 'section' || !line.productId) return
      if (isNonStockSaleLine(line, products.find(p => p.id === line.productId) ?? null)) return
      const typed = Math.max(0, deliveryQtys[line.id] ?? 0)
      const serialCount = Array.isArray(line.serialIds) ? line.serialIds.length : 0
      // Fully-serialized lines always ship their full qty — do not let a stale
      // qty input (from duplicate-product .find bugs) under-reserve them.
      const qty = serialCount >= line.qty
        ? line.qty
        : Math.min(line.qty, typed > 0 ? typed : serialCount)
      quantities[line.productId] = (quantities[line.productId] ?? 0) + qty
    })
    return quantities
  }

  const handleCreateDelivery = async () => {
    if (!canCreateDelivery || creatingDelivery) return
    setCreatingDelivery(true)
    try {
      const created = await ensureWaitingDeliveryForSO(order.id)
      if (!created) showToast('Could not create a delivery for this order', 'error')
    } finally {
      setCreatingDelivery(false)
    }
  }

  const handlePrepare = () => {
    if (!existingDelivery || !isOpenDeliveryStatus(existingDelivery.status)) {
      showToast('No pending delivery to prepare', 'error'); return
    }
    prepareDelivery(existingDelivery.id, requestedByProduct())
  }

  const handleValidate = async (opts?: { cancelRemaining?: boolean }) => {
    if (!order.lines.length) { showToast('No line items on this order', 'error'); return }
    if (!existingDelivery || normalizeDeliveryStatus(existingDelivery.status) !== 'ready') {
      showToast('No pending delivery to validate', 'error'); return
    }
    const pairs = pairOrderLinesWithDeliveryLines(order.lines, existingDelivery.lines)
    const remainders = pairs
      .filter(({ orderLine: l }) => (l as any).lineType !== 'section')
      .map(({ orderLine: l, deliveryLine: delLine }) => {
        const preparedQty = effectiveDeliveryLineQty({
          qty: Number(delLine?.qty) || Number(l.qty) || 0,
          qtyDone: delLine?.qtyDone,
          serialIds: (delLine?.serialIds?.length ? delLine.serialIds : l.serialIds) ?? [],
        })
        return {
          productName: String(l.productName ?? l.description ?? 'Item'),
          ordered: Number(l.qty) || 0,
          done: preparedQty,
        }
      })
      .filter(row => row.done < row.ordered)
    if (remainders.length > 0 && opts?.cancelRemaining === undefined) {
      setShowPartialDialog(true)
      return
    }
    const lines = pairs.map(({ orderLine: l, deliveryLine: delLine }) => {
      const preparedQty = effectiveDeliveryLineQty({
        qty: Number(delLine?.qty) || Number(l.qty) || 0,
        qtyDone: delLine?.qtyDone,
        serialIds: (delLine?.serialIds?.length ? delLine.serialIds : l.serialIds) ?? [],
      })
      return {
        id: l.id,
        qtyDelivered: Math.min(l.qty, (Number(l.qtyDelivered) || 0) + preparedQty),
      }
    })
    if (!lines.some(l => l.qtyDelivered > 0)) { showToast('Enter delivered quantities before validating', 'error'); return }
    setSavingDelivery(true)
    try {
      // Persist per-line delivered quantities on the sale order.
      // /deliver-lines heals an unconfirmed Prisma row; do not PATCH the
      // sale order here — that bumps lockVersion and 409s the follow-up write.
      const res = await fetch(`/api/sale-orders/${order.id}/deliver-lines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }),
      })
      // A 500/502/504 can answer with HTML, not JSON: parsing it threw and the
      // failure surfaced as "Network error saving delivery", hiding the real
      // reason. Read the body defensively and report what the server said.
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        showToast(json?.error ?? `Failed to save delivery (${res.status})`, 'error')
        return
      }
      if (dnRecipientName.trim()) {
        updateDelivery(existingDelivery.id, {
          recipientName: dnRecipientName.trim(),
          recipientPhone: dnRecipientPhone.trim() || undefined,
          recipientIdNumber: dnRecipientId.trim() || undefined,
          deliveryAddress: dnAddress.trim() || undefined,
          notes: dnNotes.trim() || undefined,
        })
      }
      // Validate with a summed per-product pool (not Object.fromEntries — that
      // keeps only the last duplicate productId row and breaks ThinkPad 1+2+1).
      const qtysByProduct: Record<string, number> = {}
      for (const line of existingDelivery.lines) {
        const qty = effectiveDeliveryLineQty(line)
        if (!line.productId || qty <= 0) continue
        qtysByProduct[line.productId] = (qtysByProduct[line.productId] ?? 0) + qty
      }
      await Promise.resolve(validateDelivery(existingDelivery.id, qtysByProduct, {
        cancelRemaining: opts?.cancelRemaining === true,
      }))
      setShowPartialDialog(false)
      onBack()
    } catch (err) {
      // Never swallow the reason: this catch also covers the validation step.
      const detail = err instanceof Error && err.message ? err.message : 'unexpected error'
      showToast(`Could not save delivery — ${detail}`, 'error')
    }
    finally { setSavingDelivery(false) }
  }

  const handleReverse = async () => {
    if (!existingDelivery) return
    setSavingDelivery(true)
    try {
      const ok = await reverseDelivery(existingDelivery.id)
      if (ok) onBack()
    } finally { setSavingDelivery(false) }
  }

  const handlePrintDN = () => {
    if (!existingDelivery) { showToast('No delivery record found. Validate delivery first.', 'error'); return }
    if (existingDelivery.status !== 'done') {
      showToast('Validate the delivery before generating the final Delivery Note', 'error')
      return
    }
    if (deliveryDeliveredTotal(existingDelivery) <= 0) {
      showToast('Cannot generate Delivery Note — delivered quantity is 0. Assign serials or enter quantities first.', 'error')
      return
    }
    if (dnRecipientName.trim()) {
      updateDelivery(existingDelivery.id, {
        recipientName: dnRecipientName.trim(), recipientPhone: dnRecipientPhone.trim() || undefined,
        recipientIdNumber: dnRecipientId.trim() || undefined, deliveryAddress: dnAddress.trim() || undefined, notes: dnNotes.trim() || undefined,
      })
    }
    import('@/lib/delivery-note-pdf').then(async ({ downloadDeliveryNotePdf }) => {
      const generated = await downloadDeliveryNotePdf(
        existingDelivery,
        serials,
        companySettings,
        bankAccounts,
        {
          recipientName: dnRecipientName.trim(),
          recipientPhone: dnRecipientPhone.trim(),
          recipientIdNumber: dnRecipientId.trim(),
          deliveryAddress: dnAddress.trim(),
          notes: dnNotes.trim(),
        },
        products,
      )
      if (generated) {
        const saved = await markDeliveryNoteGenerated(existingDelivery.id)
        if (saved) showToast(`Delivery Note ${existingDelivery.ref} generated — invoicing is now available`, 'success')
        else showToast('Delivery Note could not be saved — check delivered quantities', 'error')
      }
    })
  }

  const dnPill = deliveryStatusPill(existingDelivery?.status ?? 'waiting')

  return (
    <div className="flex flex-col gap-3">
      <div className="sales-proto-page-header">
        <div className="sales-proto-header-copy">
          <button type="button" className="sp-btn sp-btn-ghost sales-back-button" aria-label="Back to sales order" onClick={onBack}>
            <span className="sales-back-button__icon" aria-hidden="true">←</span>
            <span className="sales-back-button__label">Back</span>
          </button>
          <div className="sp-ref-row">
            <div className="sales-record-title-block">
              <h1>Delivery</h1>
              <span className="sales-record-ref">{existingDelivery?.ref ?? 'Draft'}</span>
            </div>
            <SalesDocPill label={dnPill.label} tone={dnPill.tone} />
          </div>
          <div className="sub">Source {order.ref} · {order.customerName}</div>
        </div>
        <div className="sales-proto-actions sales-delivery-header-actions">
          {canGenerateDeliveryNote(existingDelivery) && (
            <MoreActionsMenu items={[{ label: 'Print delivery note', icon: faPrint, onClick: handlePrintDN }]} />
          )}
          {canReverse && (
            <DestructiveAction
              label="Reverse delivery"
              confirmLabel={deliveryStatus === 'done' ? 'Reverse delivery' : 'Cancel delivery'}
              warning={deliveryStatus === 'done'
                ? `${existingDelivery?.ref ?? 'This delivery'} has already been delivered. Reversing it returns the quantities to stock, frees the serial numbers, restores the reservation and reverses the stock journal. Use this when the delivery was recorded in error.`
                : `${existingDelivery?.ref ?? 'This delivery'} has not been delivered yet. Cancelling it releases the reserved stock and serial numbers; the order keeps its remaining quantities.`}
              disabled={savingDelivery}
              action={() => void handleReverse()}
              trigger={
                <button type="button" className="sp-btn sp-btn-ghost text-[var(--danger)]" disabled={savingDelivery}>
                  {deliveryStatus === 'done' ? 'Reverse delivery' : 'Cancel delivery'}
                </button>
              }
            />
          )}
          {canPrepare && (
            <button type="button" className="sp-btn sp-btn-primary" onClick={handlePrepare} disabled={savingDelivery}>
              {savingDelivery ? 'Saving…' : 'Prepare delivery'}
            </button>
          )}
          {canValidate && (
            <button type="button" className="sp-btn sp-btn-primary" onClick={() => void handleValidate()} disabled={savingDelivery}>
              {savingDelivery ? 'Saving…' : 'Mark as delivered'}
            </button>
          )}
          {canCreateDelivery && (
            <button type="button" className="sp-btn sp-btn-primary" onClick={() => void handleCreateDelivery()} disabled={creatingDelivery}>
              {creatingDelivery ? 'Creating…' : 'Create delivery'}
            </button>
          )}
        </div>
      </div>

      <SalesDocWorkflow
        steps={[
          {
            key: 'waiting',
            label: 'Waiting',
            state: ['ready', 'done'].includes(deliveryStatus) ? 'done' : 'current',
          },
          {
            key: 'ready',
            label: 'Ready',
            state: deliveryStatus === 'done'
              ? 'done'
              : deliveryStatus === 'ready'
                ? 'current'
                : 'todo',
          },
          {
            key: 'done',
            label: 'Done',
            state: deliveryStatus === 'done' ? 'current' : 'todo',
          },
          {
            key: 'backorder',
            label: 'Backorder',
            state: existingDelivery?.backorderOfRef ? 'current' : 'todo',
          },
        ] as Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }>}
      />

      <section className="sales-doc-smart-row sales-delivery-smart-row" aria-label="Related delivery records">
        <button type="button" className="sales-doc-smart-button">
          <span>Sales Order</span>
          <strong>{order.ref}</strong>
        </button>
        <button type="button" className="sales-doc-smart-button">
          <span>Deliveries</span>
          <strong>{orderDeliveries.length}</strong>
        </button>
        <button type="button" className="sales-doc-smart-button">
          <span>Backorders</span>
          <strong>{orderDeliveries.filter((delivery: any) => delivery.backorderOfRef).length}</strong>
        </button>
        <button type="button" className="sales-doc-smart-button">
          <span>Returns</span>
          <strong>0</strong>
        </button>
        <button type="button" className="sales-doc-smart-button">
          <span>Delivery Note</span>
          <strong>{existingDelivery?.deliveryNoteGenerated ? '1' : '0'}</strong>
        </button>
        <button type="button" className="sales-doc-smart-button">
          <span>Activities</span>
          <strong>2</strong>
        </button>
      </section>

      <section className="sales-delivery-summary" aria-label="Delivery summary">
        <div className="sales-delivery-summary__primary">
          <span>Picking progress</span>
          <strong>{pickingSummary.pct}%</strong>
          <small>{pickingSummary.remaining} item{pickingSummary.remaining === 1 ? '' : 's'} remaining</small>
        </div>
        <dl>
          <div><dt>Customer</dt><dd>{order.customerName}</dd></div>
          <div><dt>Source</dt><dd>{order.ref}</dd></div>
          <div><dt>Required</dt><dd>{pickingSummary.required}</dd></div>
          <div><dt>Picked</dt><dd>{pickingSummary.picked}</dd></div>
        </dl>
        <div className="sales-delivery-summary__next">
          <span>Next action</span>
          <strong>{canCreateDelivery ? 'Create delivery' : canPrepare ? 'Reserve stock' : canValidate ? 'Validate delivery' : 'Delivery complete'}</strong>
        </div>
      </section>

      <div className="sp-delivery-work">
        {orderDeliveries.length > 0 && (
          <aside className="sp-delivery-rail" aria-label={`Deliveries for ${order.ref}`}>
            <span className="sp-delivery-rail-title">Deliveries for {order.ref}</span>
            {orderDeliveries.map((d: any) => {
              const selected = existingDelivery?.id === d.id
              const cancelled = d.status === 'cancelled'
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={cancelled}
                  data-viewing={selected ? 'true' : 'false'}
                  onClick={() => selectDelivery(d.id)}
                  className="sp-delivery-item"
                >
                  <span className="font-semibold">
                    {d.ref}{d.backorderOfRef ? ` (backorder of ${d.backorderOfRef})` : ''}
                    {selected ? ' · viewing' : ''}
                  </span>
                  <span className="text-[10px] font-bold">
                    {DELIVERY_STATE_LABELS[d.status as keyof typeof DELIVERY_STATE_LABELS] ?? d.status}
                  </span>
                </button>
              )
            })}
          </aside>
        )}

        <div className="sp-delivery-main">
      <div className="sp-panel sp-panel-pad sales-delivery-support">
        <div className="sp-grid-2">
          <SalesDocField label="Customer"><div className="sp-value">{order.customerName}</div></SalesDocField>
          <SalesDocField label="Scheduled / order date"><div className="sp-value">{fmtDate(order.date)}</div></SalesDocField>
          <SalesDocField label="Source order"><div className="sp-value"><span className="sp-linkish">{order.ref}</span></div></SalesDocField>
          <SalesDocField label="Delivery address"><div className="sp-value">{dnAddress || '—'}</div></SalesDocField>
        </div>
      </div>

        {/* Delivery lines */}
        <div className="flex flex-col gap-3 sales-delivery-operations">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Products to Deliver</h3>
            {canPrepare && (
              <form onSubmit={handleSerialScan} className="flex items-center gap-2 min-w-[220px] flex-1 max-w-md">
                <label className="sr-only" htmlFor="delivery-serial-scan">Barcode / serial</label>
                <input
                  id="delivery-serial-scan"
                  className="sales-pilot-scan"
                  placeholder="Scan or type serial…"
                  value={serialScan}
                  onChange={e => setSerialScan(e.target.value)}
                  autoComplete="off"
                />
                <button type="submit" className="btn-secondary text-xs shrink-0">Assign</button>
              </form>
            )}
          </div>
          <div className="sp-panel">
            <div className="sp-table-wrap">
            <table className="sp-table sp-line-table" data-no-responsive>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Demand</th>
                  <th className="num">{canPrepare ? 'Qty to reserve' : canValidate ? 'Reserved' : 'Delivered'}</th>
                  <th>Serial numbers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-lt)]">
                {pairOrderLinesWithDeliveryLines(order.lines, existingDelivery?.lines ?? []).map(({ orderLine: l, deliveryLine: delLine }) => {
                  const serialIdsForDisplay = (Array.isArray(l.serialIds) && l.serialIds.length
                    ? l.serialIds
                    : (delLine?.serialIds ?? [])) as string[]
                  const lineSerials = serials.filter((s: any) => serialIdsForDisplay.includes(s.id))
                  const product = products.find((item: any) => item.id === l.productId)
                  const serialTracked = Boolean(product?.requiresSerial)
                  const assignableSerials = serialTracked
                    ? serials.filter((serial: any) =>
                        serial.productId === l.productId &&
                        isSellableSerial(serial),
                      )
                    : []
                  const effectiveDone = effectiveDeliveryLineQty({
                    qty: Number(delLine?.qty) || Number(l.qty) || 0,
                    qtyDone: delLine?.qtyDone,
                    serialIds: delLine?.serialIds?.length ? delLine.serialIds : l.serialIds,
                  })
                  const delivered = canPrepare
                    ? Math.min(l.qty, Math.max(Number(deliveryQtys[l.id]) || 0, Number(l.qtyDelivered) || 0, effectiveDone))
                    : Math.max(Number(l.qtyDelivered) || 0, effectiveDone)
                  const preparedQty = effectiveDone
                  const isFullyDelivered = delivered >= l.qty
                  const isPartial = delivered > 0 && delivered < l.qty
                  return (
                    <tr key={l.id}>
                      <td data-col="product">{l.productName ?? l.description ?? 'Item'}</td>
                      <td className="num" data-col="demand">{l.qty}</td>
                      <td className="num" data-col="reserve">
                        {canPrepare ? (
                          <input type="number" aria-label={`Delivery quantity for ${l.productName ?? l.description ?? 'line item'}`} min={0} max={l.qty} value={deliveryQtys[l.id] ?? 0}
                            onChange={e => setDeliveryQtys({ ...deliveryQtys, [l.id]: Math.min(l.qty, Math.max(0, Number(e.target.value) || 0)) })}
                            className="w-20 text-center" />
                        ) : canValidate ? (
                          <span className="font-semibold text-blue-700">{preparedQty}</span>
                        ) : (
                          <span
                            className={`font-semibold ${isFullyDelivered ? 'text-emerald-600' : isPartial ? 'text-amber-500' : 'text-[var(--text-4)]'}`}
                            aria-label={`${delivered} of ${l.qty} delivered${isFullyDelivered ? ' — fully delivered' : isPartial ? ' — partially delivered' : ' — not yet delivered'}`}
                          >
                            {delivered}
                            {isFullyDelivered && <span aria-hidden="true"> ✓</span>}
                            {isPartial && <span aria-hidden="true" className="text-[9px] font-normal"> (partial)</span>}
                          </span>
                        )}
                      </td>
                      <td data-col="serials">
                        {lineSerials.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {lineSerials.map((s: any) => (
                              <span
                                key={s.id}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[9px] font-mono border border-blue-100"
                                title={s.specs ? `Specs: ${s.specs}` : undefined}
                              >
                                {s.serial ?? s.serialNumber}
                                {canPrepare && (
                                  <button type="button" onClick={() => unassignSerialFromSOLine(order.id, l.id, s.id)} className="text-blue-700 hover:text-red-600" aria-label={`Unassign ${s.serial ?? s.id}`}>×</button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        {canPrepare && serialTracked && (
                          <div className="mt-2 flex items-center gap-2">
                            <span
                              className={`text-[10px] font-semibold ${lineSerials.length >= l.qty ? 'text-emerald-600' : 'text-amber-600'}`}
                              aria-label={`${lineSerials.length} of ${l.qty} serials assigned`}
                            >{lineSerials.length}/{l.qty}</span>
                            <SerialMultiSelect
                              options={assignableSerials.map((serial: any) => ({
                                id: serial.id,
                                label: serial.serial ?? serial.serialNumber ?? serial.id,
                                // specs first — this is the moment staff pick which physical
                                // unit fulfills the line, so a reconfigured (upgraded/downgraded)
                                // unit's CURRENT specs must be visible here to avoid shipping the
                                // wrong configuration under a generic catalog product name.
                                sublabel: [serial.specs, serial.barcode, LOCATIONS[serial.location as keyof typeof LOCATIONS]?.name ?? serial.location].filter(Boolean).join(' · '),
                              }))}
                              maxSelectable={Math.max(0, l.qty - lineSerials.length)}
                              onAssign={ids => assignSerialsToSOLine(order.id, l.id, ids)}
                            />
                          </div>
                        )}
                        {!lineSerials.length && !(canPrepare && serialTracked) && <span className="text-[var(--text-4)]">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>

        {/* Recipient info */}
        <div className="flex flex-col gap-3 sales-delivery-recipient">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Recipient Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Received By (Full Name)"><Input value={dnRecipientName} onChange={setDnRecipientName} placeholder="e.g. John Kamau" /></Field>
            <Field label="Phone"><Input value={dnRecipientPhone} onChange={setDnRecipientPhone} placeholder="+254…" /></Field>
            <Field label="ID / Passport No."><Input value={dnRecipientId} onChange={setDnRecipientId} placeholder="National ID or Passport number" /></Field>
            <Field label="Delivery Address"><Input value={dnAddress} onChange={setDnAddress} placeholder="e.g. Westlands, Nairobi" /></Field>
          </div>
          <Field label="Notes"><textarea className="form-input text-xs" rows={2} placeholder="Accessories included, special instructions…" value={dnNotes} onChange={e => setDnNotes(e.target.value)} /></Field>
        </div>

        <div className="sp-footer-sticky" aria-label="Picking progress">
          <div>
            Required {pickingSummary.required} · Picked {pickingSummary.picked} · Remaining {pickingSummary.remaining}
            {' — '}<span className="pct">{pickingSummary.pct}%</span>
          </div>
          <div className="sales-proto-actions">
            <button type="button" className="sp-btn" onClick={onBack}>Back</button>
            {canCreateDelivery && (
              <button type="button" className="sp-btn sp-btn-primary" onClick={() => void handleCreateDelivery()} disabled={creatingDelivery}>
                {creatingDelivery ? 'Creating…' : 'Create delivery'}
              </button>
            )}
            {canPrepare && (
              <button type="button" className="sp-btn sp-btn-primary" onClick={handlePrepare} disabled={savingDelivery}>
                {savingDelivery ? 'Saving…' : 'Complete picking'}
              </button>
            )}
            {canValidate && (
              <button type="button" className="sp-btn sp-btn-success" onClick={() => void handleValidate()} disabled={savingDelivery}>
                {savingDelivery ? 'Saving…' : 'Mark as delivered'}
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
      {showPartialDialog && existingDelivery && (
        <PartialDeliveryDialog
          deliveryRef={existingDelivery.ref}
          remainders={pairOrderLinesWithDeliveryLines(order.lines, existingDelivery.lines)
            .filter(({ orderLine: l }) => (l as any).lineType !== 'section')
            .map(({ orderLine: l, deliveryLine: delLine }) => {
              const done = effectiveDeliveryLineQty({
                qty: Number(delLine?.qty) || Number(l.qty) || 0,
                qtyDone: delLine?.qtyDone,
                serialIds: (delLine?.serialIds?.length ? delLine.serialIds : l.serialIds) ?? [],
              })
              return {
                productName: String(l.productName ?? l.description ?? 'Item'),
                ordered: Number(l.qty) || 0,
                done,
              }
            })
            .filter(row => row.done < row.ordered)}
          confirming={savingDelivery}
          onClose={() => setShowPartialDialog(false)}
          onCreateBackorder={() => void handleValidate({ cancelRemaining: false })}
          onCancelRemaining={() => void handleValidate({ cancelRemaining: true })}
        />
      )}
    </div>
  )
}
