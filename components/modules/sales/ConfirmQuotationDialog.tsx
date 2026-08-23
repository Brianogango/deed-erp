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
        <div className="sales-confirm-dialog__actions">
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
      <div className="sales-confirm-dialog">
        <section className="sales-confirm-dialog__summary" aria-label="Confirmation summary">
          <div className="sales-confirm-dialog__amount">
            <span>Total</span>
            <strong>{fmtKes(total)}</strong>
            <small>{customerName}</small>
          </div>
          <dl>
            <div><dt>Lines</dt><dd>{lineCount}</dd></div>
            <div><dt>Stock</dt><dd>{shortages.length ? `${shortages.length} warning${shortages.length === 1 ? '' : 's'}` : 'Available'}</dd></div>
            <div><dt>Approval</dt><dd>{blocked ? 'Required' : 'Clear'}</dd></div>
          </dl>
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
            Confirming locks configured commercial terms and opens the warehouse delivery workflow.
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
