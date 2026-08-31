'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui'
import { fmtDate, fmtKes } from '@/lib/store'
import type { ConfirmQuotationMode } from '@/lib/sales/confirm-quotation'
import {
  applyConfirmLineSelection,
  confirmSelectionHasProduct,
  confirmSelectionTotals,
  defaultConfirmQtyByLineId,
  stockShortageLines,
  type ConfirmableLine,
} from '@/lib/sales/confirm-quotation'
import { SameDocumentIdentity } from '@/components/modules/sales/SameDocumentIdentity'

export type ConfirmApprovalBlocker = {
  type: string
  reason: string
  status?: 'pending' | 'needed'
}

type Props = {
  orderRef: string
  customerName: string
  total: number
  validUntil?: string
  deliveryDate?: string
  lines: ConfirmableLine[]
  headerDiscount?: number
  stockAvailable?: (productId: string) => number
  isNonStockLine?: (line: { lineType?: string; productId?: string; unit?: string }) => boolean
  approvalBlockers?: ConfirmApprovalBlocker[]
  canReserve: boolean
  canSkipReserve: boolean
  confirming: boolean
  onClose: () => void
  onConfirm: (mode: ConfirmQuotationMode, qtyByLineId: Record<string, number>) => void
}

export function ConfirmQuotationDialog({
  orderRef,
  customerName,
  total,
  validUntil,
  deliveryDate,
  lines,
  headerDiscount = 0,
  stockAvailable,
  isNonStockLine,
  approvalBlockers = [],
  canReserve,
  canSkipReserve,
  confirming,
  onClose,
  onConfirm,
}: Props) {
  const [qtyByLineId, setQtyByLineId] = useState(() => defaultConfirmQtyByLineId(lines))

  useEffect(() => {
    setQtyByLineId(defaultConfirmQtyByLineId(lines))
  }, [lines])

  const productLines = useMemo(
    () => lines.filter(line => line.lineType !== 'section'),
    [lines],
  )
  const selection = useMemo(
    () => applyConfirmLineSelection(lines, qtyByLineId),
    [lines, qtyByLineId],
  )
  const selectedTotals = useMemo(
    () => confirmSelectionTotals(selection.lines, headerDiscount),
    [selection.lines, headerDiscount],
  )
  const shortages = useMemo(() => {
    if (!stockAvailable) return []
    return stockShortageLines(selection.lines, stockAvailable, isNonStockLine)
  }, [selection.lines, stockAvailable, isNonStockLine])

  const blocked = approvalBlockers.length > 0
  const hasProduct = confirmSelectionHasProduct(selection.lines)
  const droppedCount = selection.droppedIds.length
  const reducedCount = productLines.filter(line => {
    const next = qtyByLineId[line.id]
    return next > 0 && next < line.qty
  }).length
  const lineCount = productLines.filter(line => (qtyByLineId[line.id] ?? 0) > 0).length
  const confirmDisabled = confirming || blocked || !hasProduct

  const setLineQty = (lineId: string, raw: number, max: number) => {
    const qty = Math.min(max, Math.max(0, Math.floor(Number(raw) || 0)))
    setQtyByLineId(prev => ({ ...prev, [lineId]: qty }))
  }

  return (
    <Modal
      title="Confirm quotation"
      subtitle={`${orderRef} · ${customerName}`}
      onClose={confirming ? () => {} : onClose}
      width={560}
      variant="enterprise"
      footer={
        <div className="sales-confirm-dialog__actions">
          <button type="button" className="btn-outline text-xs" disabled={confirming} onClick={onClose}>
            Cancel
          </button>
          {canSkipReserve && (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={confirmDisabled}
              title={
                blocked
                  ? 'Resolve approvals before confirming'
                  : !hasProduct
                    ? 'Keep at least one product'
                    : 'Confirm and rename this document without reserving stock'
              }
              onClick={() => onConfirm('no_reserve', qtyByLineId)}
            >
              {confirming ? 'Confirming…' : 'Confirm · Manual reserve'}
            </button>
          )}
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={confirmDisabled}
            title={
              blocked
                ? 'Resolve approvals before confirming'
                : !hasProduct
                  ? 'Keep at least one product'
                  : 'Confirm — rename this quotation to a Sales Order (same document)'
            }
            onClick={() => onConfirm(canReserve ? 'reserve' : 'no_reserve', qtyByLineId)}
          >
            {confirming
              ? 'Confirming…'
              : canReserve
                ? 'Confirm · Reserve stock'
                : 'Confirm · Rename to SO'}
          </button>
        </div>
      }
    >
      <div className="sales-confirm-dialog">
        <section className="sales-confirm-dialog__summary" aria-label="Confirmation summary">
          <div className="sales-confirm-dialog__amount">
            <span>Total</span>
            <strong>{fmtKes(selectedTotals.totalAmount)}</strong>
            <small>
              {customerName}
              {selection.changed ? ` · was ${fmtKes(total)}` : ''}
            </small>
          </div>
          <dl>
            <div><dt>Lines</dt><dd>{lineCount}</dd></div>
            <div><dt>Stock</dt><dd>{shortages.length ? `${shortages.length} warning${shortages.length === 1 ? '' : 's'}` : 'Available'}</dd></div>
            <div><dt>Approval</dt><dd>{blocked ? 'Required' : 'Clear'}</dd></div>
          </dl>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-[var(--border-lt)] bg-white p-3" aria-label="Products to confirm">
          <header>
            <strong className="block text-xs font-bold text-[var(--text-1)]">Process these products</strong>
            <p className="mt-1 mb-0 text-[11px] leading-snug text-[var(--text-3)]">
              Uncheck a line or lower its quantity to drop it from the Sales Order.
              Removed products are not delivered or invoiced.
            </p>
          </header>
          {productLines.length === 0 ? (
            <p className="m-0 text-[11px] text-[var(--text-3)]">This quotation has no product lines.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {productLines.map(line => {
                const qty = qtyByLineId[line.id] ?? 0
                const included = qty > 0
                const label = line.productName || line.description || 'Item'
                return (
                  <li
                    key={line.id}
                    className={`grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md border border-[var(--border-lt)] bg-[var(--bg-surface)] px-2 py-1.5 ${included ? '' : 'opacity-55'}`}
                  >
                    <label className="flex min-w-0 cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={included}
                        disabled={confirming}
                        onChange={event => setLineQty(line.id, event.target.checked ? line.qty : 0, line.qty)}
                      />
                      <span className="flex min-w-0 flex-col">
                        <strong className="truncate text-xs text-[var(--text-1)]">{label}</strong>
                        <small className="text-[10px] text-[var(--text-3)]">{fmtKes(Number(line.unitPrice) || 0)} each · quoted {line.qty}</small>
                      </span>
                    </label>
                    <label>
                      <span className="sr-only">Quantity for {label}</span>
                      <input
                        type="number"
                        min={0}
                        max={line.qty}
                        step={1}
                        disabled={confirming}
                        value={qty}
                        onChange={event => setLineQty(line.id, Number(event.target.value), line.qty)}
                        className="form-input h-8 w-full px-1 text-center text-xs font-bold"
                      />
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {(droppedCount > 0 || reducedCount > 0) && (
            <p className="m-0 text-[11px] text-[var(--text-2)]" role="status">
              {droppedCount > 0 ? `${droppedCount} line${droppedCount === 1 ? '' : 's'} removed` : null}
              {droppedCount > 0 && reducedCount > 0 ? ' · ' : null}
              {reducedCount > 0 ? `${reducedCount} quantity reduced` : null}
              . Invoice will follow the confirmed Sales Order.
            </p>
          )}
        </section>

        {blocked && (
          <section className="sales-confirm-dialog__alert" role="alert">
            <strong>Resolve {approvalBlockers.length} approval{approvalBlockers.length === 1 ? '' : 's'} first</strong>
            <ul>
              {approvalBlockers.map((blocker, index) => (
                <li key={`${blocker.type}-${index}`}>{blocker.reason}</li>
              ))}
            </ul>
          </section>
        )}

        {shortages.length > 0 && (
          <section className="sales-confirm-dialog__stock" aria-label="Stock warnings">
            <strong>Stock check</strong>
            <ul>
              {shortages.map(shortage => (
                <li key={shortage.productName}>
                  {shortage.productName}: need {shortage.qty}, free {shortage.available}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="sales-confirm-dialog__details">
          <SameDocumentIdentity mode="preview" quotationRef={orderRef} className="sales-confirm-dialog__identity" />
          <dl className="sales-confirm-dialog__dates">
            {validUntil ? <div><dt>Valid until</dt><dd>{fmtDate(validUntil)}</dd></div> : null}
            {deliveryDate ? <div><dt>Expected delivery</dt><dd>{fmtDate(deliveryDate)}</dd></div> : null}
          </dl>
          <p>
            Confirming locks the quantities you kept and opens warehouse delivery.
            Fulfilment and payment remain independent.
          </p>
        </section>

        {!canReserve && !blocked && (
          <p className="sales-confirm-dialog__note">
            Your role confirms without reserving stock. Inventory can reserve it during delivery preparation.
          </p>
        )}
      </div>
    </Modal>
  )
}
