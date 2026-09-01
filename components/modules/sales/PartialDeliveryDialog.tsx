'use client'

import { Modal } from '@/components/ui'
import { AsyncActionButton, DestructiveAction, EmptyState } from '@/components/erp'

export type PartialDeliveryRemainder = {
  productName: string
  ordered: number
  done: number
}

type Props = {
  deliveryRef: string
  remainders: PartialDeliveryRemainder[]
  confirming: boolean
  onClose: () => void
  onCreateBackorder: () => void
  onCancelRemaining: () => void
}

export function PartialDeliveryDialog({
  deliveryRef,
  remainders,
  confirming,
  onClose,
  onCreateBackorder,
  onCancelRemaining,
}: Props) {
  return (
    <Modal
      title="Partial delivery"
      subtitle={deliveryRef}
      onClose={confirming ? () => {} : onClose}
      width={480}
      variant="enterprise"
      footer={
        <div className="sales-confirm-dialog__actions">
          <button type="button" className="btn-outline text-xs" disabled={confirming} onClick={onClose}>
            Cancel
          </button>
          <AsyncActionButton
            className="btn-secondary text-xs"
            disabled={confirming}
            pendingLabel="Saving…"
            action={onCreateBackorder}
          >
            Create backorder
          </AsyncActionButton>
          <DestructiveAction
            label="Drop remaining"
            confirmLabel="Drop remaining"
            warning="The undelivered quantities will be removed from this fulfilment path and will not be invoiced. This should only be used when the customer no longer expects the remaining items."
            disabled={confirming}
            action={onCancelRemaining}
            trigger={
              <button type="button" className="btn-ghost text-xs text-[var(--danger)]" disabled={confirming}>
                No backorder — drop remaining
              </button>
            }
          />
        </div>
      }
    >
      <div className="sales-confirm-dialog">
        <p className="m-0 text-xs leading-snug text-[var(--text-2)]">
          Some products are short of the quoted quantity. Create a backorder to deliver the rest later,
          or drop the remaining lines now so they are not invoiced.
        </p>
        {remainders.length === 0 ? (
          <EmptyState
            title="No outstanding quantities"
            description="There are no remaining product quantities to backorder or remove."
            className="min-h-[140px]"
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {remainders.map((row, index) => (
              <li key={`${row.productName}-${row.ordered}-${row.done}-${index}`} className="flex items-baseline justify-between gap-3 rounded-md border border-[var(--border-lt)] bg-white px-2.5 py-2">
                <strong className="text-xs text-[var(--text-1)]">{row.productName}</strong>
                <span className="whitespace-nowrap text-[11px] font-bold text-[var(--text-3)]">Deliver {row.done} of {row.ordered}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
