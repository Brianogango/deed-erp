'use client'
import { useMemo } from 'react'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader } from '@/components/ui'
import { Breadcrumbs } from '@/components/erp/Breadcrumbs'
import { EmptyState, PrimaryActionButton, RecordHeader, SecondaryActionMenu, StatusBadge, WorkflowStageBar } from '@/components/erp'
import { Fa, faBarcode, faBox } from '@/components/icons'
import { printProductLabels, printSerialLabels } from '@/lib/product-label'
import type { SerialLabelItem } from '@/lib/product-label-meta'
import { canValidatePurchaseReceipt } from '@/lib/inventory/permissions'
import { LOCATIONS, type LocationId } from '@/lib/store'
import {
  receiptLineViews,
  receiptQtyReceived,
  receiptSerialCount,
  SERIAL_STATUS_LABEL,
} from '@/lib/purchase/receipt-contents'

function locationLabel(location: LocationId): string {
  return `${LOCATIONS[location].icon} ${LOCATIONS[location].name}`
}

export default function PurchaseReceiptDetail() {
  const {
    activeReceipt, purchaseOrders, products, serials, currentUser,
    setSubView, setActiveId, setMainView, setActiveReceiptId, fmtDate, showToast,
    startReceive, closeReceiptDetail, receiptOrigin,
  } = usePurchase()
  const lines = useMemo(
    () => (activeReceipt ? receiptLineViews(activeReceipt, serials) : []),
    [activeReceipt, serials],
  )

  if (!activeReceipt) return null

  const po = purchaseOrders.find(p => p.id === activeReceipt.poId)
  const serialCount = receiptSerialCount(activeReceipt)
  const qtyReceived = receiptQtyReceived(activeReceipt)
  const qtyExpected = activeReceipt.lines.reduce((n, l) => n + (Number(l.qtyExpected) || 0), 0)
  const isDraft = activeReceipt.status === 'draft'
  const canProcess = isDraft && canValidatePurchaseReceipt(currentUser?.role)
  const validated = activeReceipt.status === 'validated'

  const backToReceipts = () => closeReceiptDetail('list')
  const backToPo = () => {
    if (!po) {
      showToast('Purchase order not found for this GRN', 'error')
      return
    }
    setActiveReceiptId(null)
    setActiveId(po.id)
    setMainView('orders')
    setSubView('form')
  }

  const handlePrint = async () => {
    const serialItems: SerialLabelItem[] = []
    for (const line of lines) {
      const prod = products.find(p => p.id === line.productId)
      if (line.requiresSerial && line.serials.length) {
        for (const unit of line.serials) {
          serialItems.push({
            serial: unit.serial,
            barcode: unit.serial,
            productName: line.productName,
            sku: prod?.sku ?? '',
            salePrice: prod?.salePrice,
            category: prod?.category,
            productType: prod?.productType,
            specs: unit.specs,
          })
        }
      } else if (line.qtyReceived > 0 && prod) {
        printProductLabels(prod, line.qtyReceived)
      }
    }
    if (serialItems.length) await printSerialLabels(serialItems)
    if (!serialItems.length && lines.every(l => l.qtyReceived === 0)) {
      showToast('Nothing to print on this GRN yet', 'info')
    }
  }

  const workflow = (
    <WorkflowStageBar
      stages={[
        { id: 'draft', label: 'Pending', description: 'Awaiting receipt processing' },
        { id: 'validated', label: 'Validated', description: 'Stock and serials committed' },
      ]}
      current={validated ? 'validated' : 'draft'}
      blocker={isDraft && !canProcess ? 'Your role cannot validate this goods receipt.' : undefined}
    />
  )

  return (
    <div className="purchase-order-detail purchase-receipt-detail">
      <div className="purchase-order-detail__header">
        <RecordHeader
          title={activeReceipt.ref}
          entity={activeReceipt.vendorName}
          status={validated ? 'done' : 'pending'}
          statusLabel={validated ? 'Validated' : 'Pending'}
          onBack={receiptOrigin === 'po' ? backToPo : backToReceipts}
          backLabel={receiptOrigin === 'po' ? 'Order' : 'Receipts'}
          breadcrumbs={(
            <Breadcrumbs
              items={[
                { label: 'Purchase', onClick: backToReceipts },
                { label: 'Receipts', onClick: backToReceipts },
                { label: activeReceipt.ref },
              ]}
            />
          )}
          primaryAction={canProcess ? (
            <PrimaryActionButton hideLabelOnMobile={false} onClick={() => startReceive(activeReceipt.id)}>
              Process GRN
            </PrimaryActionButton>
          ) : undefined}
          secondaryActions={(
            <SecondaryActionMenu
              actions={[
                { id: 'print', label: 'Print labels', onClick: () => { void handlePrint() } },
                { id: 'po', label: `Open ${activeReceipt.poRef}`, hidden: !po, onClick: backToPo },
              ]}
            />
          )}
          workflow={workflow}
        />
      </div>

      <section className="purchase-order-summary" aria-label="Goods receipt summary">
        <div className="purchase-order-summary__item">
          <span>Vendor</span>
          <strong title={activeReceipt.vendorName}>{activeReceipt.vendorName}</strong>
        </div>
        <div className="purchase-order-summary__item">
          <span>Purchase order</span>
          <strong>
            {po ? (
              <button type="button" className="purchase-receipt-detail__po-link" onClick={backToPo}>
                {activeReceipt.poRef}
              </button>
            ) : activeReceipt.poRef}
          </strong>
        </div>
        <div className="purchase-order-summary__item">
          <span>Received</span>
          <strong>{qtyReceived} / {qtyExpected}</strong>
        </div>
        <div className="purchase-order-summary__item purchase-order-summary__item--next">
          <span>Serials</span>
          <strong>{serialCount}</strong>
        </div>
      </section>

      <div className="card overflow-hidden">
        <PanelHeader title="Received items" count={lines.length} />
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-b" style={{ borderColor: 'var(--border-lt)' }}>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-t3 mb-0.5">Date</p>
            <p className="text-t1">{fmtDate(activeReceipt.date)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-t3 mb-0.5">Location</p>
            <p className="text-t1">{locationLabel(activeReceipt.destinationLocation)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-t3 mb-0.5">Status</p>
            <p className="text-t1">{validated ? 'Stock updated' : 'Awaiting validation'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-t3 mb-0.5">Lines</p>
            <p className="text-t1">{lines.length}</p>
          </div>
        </div>

        {lines.length === 0 ? (
          <EmptyState
            title="No receipt lines yet"
            description={isDraft ? 'Process this GRN to capture received quantities and serial numbers.' : 'This validated goods receipt contains no line items.'}
            action={canProcess ? (
              <PrimaryActionButton hideLabelOnMobile={false} onClick={() => startReceive(activeReceipt.id)}>
                Process GRN
              </PrimaryActionButton>
            ) : undefined}
          />
        ) : (
          <div className="flex flex-col">
            {lines.map(line => {
              const prod = products.find(p => p.id === line.productId)
              return (
                <section
                  key={`${line.productId}-${line.productName}`}
                  className="purchase-receipt-detail__line"
                >
                  <div className="purchase-receipt-detail__line-head">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-t1">{line.productName}</p>
                      <p className="text-[10px] text-t3 mt-0.5">
                        Expected {line.qtyExpected} · Received {line.qtyReceived}
                        {line.requiresSerial
                          ? ` · ${line.serials.length} serial${line.serials.length === 1 ? '' : 's'}`
                          : ' · Bulk stock'}
                        {prod?.sku ? ` · SKU ${prod.sku}` : ''}
                      </p>
                    </div>
                    <Badge
                      status={line.requiresSerial ? (line.serials.length >= line.qtyReceived && line.qtyReceived > 0 ? 'active' : 'pending') : 'active'}
                      label={line.requiresSerial ? `${line.serials.length}/${line.qtyReceived || line.qtyExpected} serials` : `${line.qtyReceived} received`}
                      size="xs"
                    />
                  </div>

                  {line.requiresSerial ? (
                    line.serials.length === 0 ? (
                      <p className="text-[11px] text-t3 px-4 py-3">
                        {isDraft ? 'No serials captured yet — process this GRN to scan them in.' : 'No serials recorded on this line.'}
                      </p>
                    ) : (
                      <ul className="purchase-receipt-detail__serials">
                        {line.serials.map(unit => (
                          <li key={unit.serial} className="purchase-receipt-detail__serial">
                            <div className="purchase-receipt-detail__serial-top">
                              <span className="font-mono text-[11px] font-semibold text-t1 inline-flex items-center gap-1.5">
                                <Fa icon={faBarcode} className="text-t3" aria-hidden="true" />
                                {unit.serial}
                              </span>
                              {unit.status && (
                                <StatusBadge
                                  status={unit.status === 'refurbishment' ? 'pending' : unit.status === 'available' ? 'done' : unit.status}
                                  label={SERIAL_STATUS_LABEL[unit.status]}
                                  size="xs"
                                />
                              )}
                            </div>
                            {unit.specs && <p className="text-[11px] text-t2 mt-1">{unit.specs}</p>}
                            {unit.accessories.length > 0 && (
                              <p className="text-[10px] text-t3 mt-1">
                                Accessories: {unit.accessories.join(', ')}
                              </p>
                            )}
                            {unit.accessoryNotes && (
                              <p className="text-[10px] text-t3 mt-0.5">{unit.accessoryNotes}</p>
                            )}
                            {unit.location && (
                              <p className="text-[10px] text-t3 mt-0.5">{locationLabel(unit.location)}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : (
                    <p className="text-[11px] text-t3 px-4 py-3 inline-flex items-center gap-1.5">
                      <Fa icon={faBox} className="text-t4" aria-hidden="true" />
                      Bulk line — {line.qtyReceived} unit{line.qtyReceived === 1 ? '' : 's'} received, no serial tracking.
                    </p>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
