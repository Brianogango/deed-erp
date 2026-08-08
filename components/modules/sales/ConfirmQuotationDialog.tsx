'use client'

import { Modal } from '@/components/ui'
import { fmtDate, fmtKes } from '@/lib/store'
import type { ConfirmQuotationMode } from '@/lib/sales/confirm-quotation'
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
  lineCount: number
  shortages: Array<{ productName: string; qty: number; available: number }>
  approvalBlockers?: ConfirmApprovalBlocker[]
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
  approvalBlockers = [],
  canReserve,
  canSkipReserve,
  confirming,
  onClose,
  onConfirm,
}: Props) {
  const blocked = approvalBlockers.length > 0
  return (
    <Modal
      title="Confirm quotation"
      subtitle={`${orderRef} · ${customerName}`}
      onClose={confirming ? () => {} : onClose}
      width={520}
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
              disabled={confirming || blocked}
              title={blocked ? 'Resolve approvals before confirming' : 'Confirm and rename this document without reserving stock'}
              onClick={() => onConfirm('no_reserve')}
            >
              {confirming ? 'Confirming…' : 'Confirm · Manual reserve'}
            </button>
          )}
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={confirming || blocked}
            title={blocked ? 'Resolve approvals before confirming' : 'Confirm — rename this quotation to a Sales Order (same document)'}
            onClick={() => onConfirm(canReserve ? 'reserve' : 'no_reserve')}
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
      <div className="flex flex-col gap-3 text-xs">
        <SameDocumentIdentity mode="preview" quotationRef={orderRef} />
        <p className="text-[var(--text-3)] m-0">
          Commercial terms lock when configured, and a waiting delivery opens for warehouse.
          Fulfilment and payment stay independent of this rename.
        </p>
        <div className="rounded-md border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-[10px] text-[var(--text-3)] space-y-1">
          <p className="m-0"><strong className="text-[var(--text-2)]">At confirmation</strong> — reserve available stock now (Confirm · Reserve stock).</p>
          <p className="m-0"><strong className="text-[var(--text-2)]">Manual</strong> — confirm without reserving; warehouse reserves when preparing the delivery.</p>
        </div>
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
        {blocked && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <p className="m-0 font-semibold">
              Resolve {approvalBlockers.length} approval{approvalBlockers.length === 1 ? '' : 's'} before confirming
            </p>
            <ul className="m-0 mt-1 list-disc pl-4 space-y-0.5">
              {approvalBlockers.map((b, i) => (
                <li key={`${b.type}-${i}`}>{b.reason}</li>
              ))}
            </ul>
          </div>
        )}
        {!canReserve && !blocked && (
          <p className="rounded-md border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-[10px] text-[var(--text-3)] m-0">
            Your role confirms without reserving stock. Inventory can prepare the delivery afterward.
          </p>
        )}
      </div>
    </Modal>
  )
}
