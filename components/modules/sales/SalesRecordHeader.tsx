'use client'

import {
  faBan,
  faBoxOpen,
  faFileAlt,
  faFileInvoice,
  faMoneyBillWave,
  faRotateLeft,
  faTruck,
} from '@fortawesome/free-solid-svg-icons'
import { StatusStepper } from '@/components/ui'
import { Fa } from '@/components/icons'
import { Breadcrumbs } from '@/components/erp/Breadcrumbs'
import { SmartButtons, type SmartButton } from '@/components/erp/SmartButtons'
import {
  SALE_STATUS_BAR,
  SALE_STATUS_LABELS,
  SO_INVOICE_STATUS_LABELS,
  isQuotationStage,
  saleOrderLooksConfirmed,
  type OdooSaleStatus,
} from '@/lib/odoo-sales-flow'
import { fmtDate } from '@/lib/store'
import type { SaleOrder } from '@/lib/store'

type SalesOrderView = SaleOrder & {
  lines: SaleOrder['lines']
}

type Props = {
  order: SalesOrderView
  invoiceStatus: string
  deliveriesCount: number
  invoicesCount: number
  paymentsCount: number
  returnsCount: number
  canSeeFinance: boolean
  canSeeReturns: boolean
  onBackToList: () => void
  onOpenDelivery: () => void
  onOpenInvoices: () => void
  onOpenReturns: () => void
  onPreview: () => void
  onSendQuote: () => void
  onConfirm: () => void
  onStepBlocked?: (message: string) => void
}

function saleStepIndex(status: string): number {
  const idx = SALE_STATUS_BAR.indexOf(status as OdooSaleStatus)
  return idx >= 0 ? idx : 0
}

export function SalesRecordHeader({
  order,
  invoiceStatus,
  deliveriesCount,
  invoicesCount,
  paymentsCount,
  returnsCount,
  canSeeFinance,
  canSeeReturns,
  onBackToList,
  onOpenDelivery,
  onOpenInvoices,
  onOpenReturns,
  onPreview,
  onSendQuote,
  onConfirm,
  onStepBlocked,
}: Props) {
  const currentIdx = saleStepIndex(order.status)

  const isStepClickable = (step: string, index: number) => {
    if (order.status === 'cancelled') return false
    if (index !== currentIdx + 1) return false
    if (!order.lines.length) return false
    if (step === 'quotation_sent') return order.status === 'quotation'
    if (step === 'sale') return isQuotationStage(order.status)
    return false
  }

  const handleStepClick = (step: string, index: number) => {
    if (!isStepClickable(step, index)) return
    if (!order.lines.length) {
      onStepBlocked?.('Add at least one product before advancing')
      return
    }
    if (step === 'quotation_sent') onSendQuote()
    else if (step === 'sale') onConfirm()
  }

  const smartButtons: SmartButton[] = []

  const looksConfirmed = order.status === 'sale' || saleOrderLooksConfirmed(order)
  if (deliveriesCount > 0) {
    smartButtons.push({
      id: 'delivery',
      label: 'Deliveries',
      count: deliveriesCount,
      tone: 'success',
      icon: <Fa icon={faBoxOpen} className="text-[10px]" />,
      onClick: onOpenDelivery,
    })
  } else if (looksConfirmed) {
    smartButtons.push({
      id: 'record-delivery',
      label: 'Create delivery',
      tone: 'primary',
      icon: <Fa icon={faTruck} className="text-[10px]" />,
      onClick: onOpenDelivery,
    })
  }

  if (canSeeFinance && invoicesCount > 0) {
    smartButtons.push({
      id: 'invoices',
      label: 'Invoices',
      count: invoicesCount,
      tone: 'violet',
      icon: <Fa icon={faFileInvoice} className="text-[10px]" />,
      onClick: onOpenInvoices,
    })
  }

  if (canSeeFinance && paymentsCount > 0) {
    smartButtons.push({
      id: 'payments',
      label: 'Payments',
      count: paymentsCount,
      tone: 'teal',
      icon: <Fa icon={faMoneyBillWave} className="text-[10px]" />,
      onClick: onOpenInvoices,
    })
  }

  if (canSeeReturns && returnsCount > 0) {
    smartButtons.push({
      id: 'returns',
      label: 'Returns',
      count: returnsCount,
      tone: 'warning',
      icon: <Fa icon={faRotateLeft} className="text-[10px]" />,
      onClick: onOpenReturns,
    })
  }

  if (order.lines.length > 0) {
    smartButtons.push({
      id: 'preview',
      label: 'Customer Preview',
      tone: 'neutral',
      icon: <Fa icon={faFileAlt} className="text-[10px]" />,
      onClick: onPreview,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Breadcrumbs
        items={[
          { label: 'Sales', onClick: onBackToList },
          { label: 'Orders', onClick: onBackToList },
          { label: order.ref ?? 'Order' },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-[var(--text-1)]">{order.ref}</h2>
            {order.locked && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                Locked
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-3)] mt-0.5">{order.customerName}</p>
          {order.status === 'quotation_sent' && order.sentAt && (
            <p className="text-[10px] text-[var(--text-4)] mt-0.5">
              Sent {fmtDate(order.sentAt)}
              {order.sentTo ? ` to ${order.sentTo}` : ''}
              {order.sentByName ? ` by ${order.sentByName}` : ''}
            </p>
          )}
          {order.status === 'sale' && (
            <p className="text-[10px] text-[var(--text-4)] mt-0.5">
              Invoice status:{' '}
              <strong
                className={
                  invoiceStatus === 'to_invoice'
                    ? 'text-amber-600'
                    : invoiceStatus === 'invoiced'
                      ? 'text-emerald-600'
                      : invoiceStatus === 'upselling'
                        ? 'text-violet-600'
                        : ''
                }
              >
                {SO_INVOICE_STATUS_LABELS[invoiceStatus as keyof typeof SO_INVOICE_STATUS_LABELS] ?? invoiceStatus}
              </strong>
              {order.confirmedAt
                ? ` · confirmed ${fmtDate(order.confirmedAt)}${order.confirmedByName ? ` by ${order.confirmedByName}` : ''}`
                : ''}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-3">
          {order.status === 'cancelled' ? (
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-red-50 text-red-600 border border-red-200">
              <Fa icon={faBan} className="text-[10px]" /> Cancelled
            </span>
          ) : (
            <StatusStepper
              steps={[...SALE_STATUS_BAR]}
              current={order.status}
              labels={SALE_STATUS_LABELS}
              isStepClickable={isStepClickable}
              onStepClick={handleStepClick}
            />
          )}
          <SmartButtons buttons={smartButtons} />
        </div>
      </div>
    </div>
  )
}
