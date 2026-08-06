'use client'

import { Modal } from '@/components/ui'
import { fmtDate, fmtKes } from '@/lib/store'
import type { ConfirmQuotationMode } from '@/lib/sales/confirm-quotation'

type Props = {
  orderRef: string
  customerName: string
  total: number
  validUntil?: string
  deliveryDate?: string
  lineCount: number
  shortages: Array<{ productName: string; qty: number; available: number }>
  canReserve: boolean
  canSkipReserve: boolean
  confirming: boolean
  onClose: () => void
  onConfirm: (mode: ConfirmQuotationMode) => void
}

export function ConfirmQuotationDialog({
  orderRef,
  customerName,
  total,
  validUntil,
  deliveryDate,
  lineCount,
  shortages,
  canReserve,
  canSkipReserve,
  confirming,
  onClose,
  onConfirm,
}: Props) {
  return (
    <Modal
      title="Confirm quotation"
      subtitle={`${orderRef} · ${customerName}`}
      onClose={confirming ? () => {} : onClose}
      width={480}
      variant="enterprise"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="btn-outline text-xs" disabled={confirming} onClick={onClose}>
            Cancel
          </button>
          {canSkipReserve && (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={confirming}
              onClick={() => onConfirm('no_reserve')}
            >
              {confirming ? 'Confirming…' : 'Confirm without reservation'}
            </button>
          )}
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={confirming}
            onClick={() => onConfirm(canReserve ? 'reserve' : 'no_reserve')}
          >
            {confirming
              ? 'Confirming…'
              : canReserve
                ? 'Confirm and Reserve'
                : 'Confirm quotation'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-xs">
        <p className="text-[var(--text-3)]">
          Creates a linked sales order, locks this quotation version when configured, and opens a waiting
          delivery. Stock is reserved only when you choose <strong>Confirm and Reserve</strong> (or when
          you prepare the delivery later).
        </p>
        <ul className="m-0 list-disc space-y-1 pl-4 text-[var(--text-2)]">
          <li>
            {lineCount} line{lineCount === 1 ? '' : 's'} · {fmtKes(total)}
          </li>
          {validUntil ? <li>Valid until {fmtDate(validUntil)}</li> : null}
          {deliveryDate ? <li>Expected delivery {fmtDate(deliveryDate)}</li> : null}
          {shortages.length === 0 ? (
            <li>No free-stock shortfalls detected at Warehouse + Shop</li>
          ) : (
            shortages.map(s => (
              <li key={s.productName} className="text-amber-700">
                Stock shortfall: {s.productName} needs {s.qty}, free {s.available}
              </li>
            ))
          )}
        </ul>
        {!canReserve && (
          <p className="rounded-md border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-[10px] text-[var(--text-3)]">
            Your role confirms the sales order without reserving stock. Inventory can prepare the delivery
            afterward.
          </p>
        )}
      </div>
    </Modal>
  )
}
