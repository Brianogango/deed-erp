'use client'
import { useState } from 'react'
import { usePurchase } from './PurchaseContext'
import { Modal, Field, Input, Select, Confirm, PanelHeader, StatusStepper, SearchPicker, Divider } from '@/components/ui'
import { LOCATIONS, CATEGORY_CONFIG, type LocationId, type CategoryId, fmtKes, fmtDate } from '@/lib/store'
import { invoiceDocState, invoicePaymentStatus, displayDocRef, PAYMENT_STATUS_LABELS } from '@/lib/odoo-sales-flow'
import { downloadPoPdf, downloadRfqPdf } from '@/lib/purchase-pdf'
import Chatter from '@/components/erp/Chatter'
import { Breadcrumbs } from '@/components/erp/Breadcrumbs'
import { SmartButtons } from '@/components/erp/SmartButtons'
import { PrimaryActionButton, SecondaryActionMenu, StatusBadge } from '@/components/erp'
import { billableQty } from '@/lib/purchase/three-way-match'
import {
  Fa, faBox, faCheck, faCreditCard, faFileInvoice, faPaperPlane, faPlus, faTrash, faUpload,
  faWarehouse, faBarcode, faWrench, faPhone, faLocationDot, faEnvelope, faStar,
} from '@/components/icons'

const ACCESSORIES = ['Charger', 'Bag/Case', 'Mouse', 'Box', 'Cable', 'Manual']
const PO_STEPS = ['RFQ', 'RFQ Sent', 'Purchase Order', 'Received', 'Billed']
const STATUS_LABEL: Record<string,string> = { draft:'RFQ', sent:'RFQ Sent', confirmed:'Purchase Order', partial:'Partially Received', received:'Fully Received', cancelled:'Cancelled' }
const PO_STEP_IDX: Record<string,number> = { draft:0, sent:1, confirmed:2, partial:3, received:3 }

function openRfqMail(po: any, vendor: any, companySettings: any) {
  const subject = `RFQ ${po.ref} from ${companySettings.name ?? 'Deed ERP'}`
  const body = [
    `Hello ${po.vendorName ?? 'Vendor'},`,
    '',
    `Please quote for RFQ ${po.ref}.`,
    `Expected date: ${po.expectedDate ?? 'To be confirmed'}`,
    '',
    ...(po.lines ?? []).map((line: any, index: number) => `${index + 1}. ${line.productName ?? 'Item'} - Qty ${line.qty} - Target ${fmtKes(Number(line.unitPrice ?? 0))}`),
    '',
    po.notes ? `Notes: ${po.notes}` : '',
    '',
    'Regards,',
    `${companySettings.name ?? 'Deed ERP'}`,
  ].filter(Boolean).join('\n')
  window.location.href = `mailto:${encodeURIComponent(vendor?.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

async function sendRfqViaServer(po: any, vendor: any, companySettings: any): Promise<{ ok: boolean; error?: string }> {
  const to = String(vendor?.email || '').trim()
  if (!to) return { ok: false, error: 'Vendor has no email address' }
  const res = await fetch('/api/integrations/send-rfq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      rfq: {
        ref: po.ref,
        vendorName: po.vendorName || vendor?.name || 'Vendor',
        companyName: companySettings?.name || 'Deed Technologies',
        expectedDate: po.expectedDate,
        notes: po.notes,
        lines: (po.lines || []).map((line: any) => ({
          productName: line.productName || 'Item',
          qty: Number(line.qty) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          subtotal: Number(line.subtotal) || (Number(line.qty) || 0) * (Number(line.unitPrice) || 0),
        })),
        subtotal: Number(po.subtotal) || 0,
        taxTotal: Number(po.taxTotal) || 0,
        total: Number(po.total) || 0,
      },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || data.message || `Send failed (${res.status})` }
  }
  return { ok: true }
}

export default function POFormView() {
  const {
    activePO, linkedBill, receipts, purchaseReturns, invoices, contacts, products, accounts,
    currentUser, serials, bankAccounts, companySettings, purchaseOrders,
    updatePO, updatePOLine, removePOLine, bulkAddPOLines, sendPO, confirmPO, createReceiptFromPO, deletePO, createBillFromPO, revertPOToDraft,
    postInvoice, registerPayment, createPurchaseReturn, addReturnLine, confirmPurchaseReturn, logReturnPickup,
    showToast, addContact,
    setMainView, setSubView, setActiveId,
    editCell, setEditCell, editVal, setEditVal, commitCell,
    showAddLine, setShowAddLine, addProd, setAddProd, addQty, setAddQty, addPrice, setAddPrice, addVAT, setAddVAT, handleAddLine,
    showImport, setShowImport, showScanModal, setShowScanModal, scanFile, setScanFile, isScanningScan, setIsScanningScan, scanFileRef,
    importRows, setImportRows, importVendorId, setImportVendorId, importVendorName, setImportVendorName, isDragging, setIsDragging, fileInputRef, setImportRowAccount,
    activeReceiptId, setActiveReceiptId, grnLines, setGrnLines, destLocation, setDestLocation,
    serialInputs, setSerialInputs, serialAccessories, setSerialAccessories,
    serialAccessoryNotes, setSerialAccessoryNotes, serialSpecs, setSerialSpecs, serialIssues, setSerialIssues, serialRefs,
    showReturnModal, setShowReturnModal, returnReceiptId, setReturnReceiptId,
    returnReason, setReturnReason, returnLines, setReturnLines, returnScanInput, setReturnScanInput,
    returnCollectedBy, setReturnCollectedBy, returnCollectedDate, setReturnCollectedDate, returnPickupNotes, setReturnPickupNotes,
    delId, setDelId, vendors, purchasableProds,
  } = usePurchase()

  const [sendingRfqMail, setSendingRfqMail] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [showBillModal, setShowBillModal] = useState(false)
  const [billQtys, setBillQtys] = useState<Record<string, string>>({})
  const [creatingBill, setCreatingBill] = useState(false)

  if (!activePO) return null

  const vendor = contacts.find((c: any) => c.id === activePO.vendorId) || vendors.find((v: any) => v.id === activePO.vendorId)
  const activeBillsForPO = invoices.filter((bill: any) => {
    const belongsToPO = bill.purchaseOrderId === activePO.id || bill.id === activePO.billId
    const isLive = !['cancelled', 'voided', 'void'].includes(String(bill.status))
    return bill.type === 'vendor_bill' && belongsToPO && isLive
  })
  const billedQtyForLine = (poLine: typeof activePO.lines[number]) =>
    activeBillsForPO.reduce((total: number, bill: any) => {
      const billQty = (bill.lines ?? []).reduce((sum: number, line: any) => {
        const sameProduct = Boolean(poLine.productId && line.productId && poLine.productId === line.productId)
        const sameDescription = !line.productId && String(line.description ?? '').includes(poLine.productName)
        return sum + (sameProduct || sameDescription ? Math.max(0, Math.floor(Number(line.qty) || 0)) : 0)
      }, 0)
      return total + billQty
    }, 0)
  const billableQtyForLine = (line: typeof activePO.lines[number]) =>
    billableQty({ ...line, qtyBilled: billedQtyForLine(line) })

  const handleMailRfq = async () => {
    if (!vendor?.email) {
      showToast('Add an email address on the vendor contact first', 'error')
      return
    }
    if (!activePO.lines?.length) {
      showToast('Add at least one line before emailing the RFQ', 'error')
      return
    }
    setSendingRfqMail(true)
    try {
      const result = await sendRfqViaServer(activePO, vendor, companySettings)
      if (result.ok) {
        showToast(`RFQ emailed to ${vendor.email}`, 'success')
        return
      }
      showToast(`${result.error || 'Server email failed'} — opening mail app…`, 'info')
      openRfqMail(activePO, vendor, companySettings)
    } catch {
      showToast('Server email unavailable — opening mail app…', 'info')
      openRfqMail(activePO, vendor, companySettings)
    } finally {
      setSendingRfqMail(false)
    }
  }

  const openReceive = async () => {
    let draft = receipts.find(r => r.poId === activePO.id && r.status === 'draft') ?? null
    if (!draft) {
      draft = await Promise.resolve(createReceiptFromPO(activePO.id))
    }
    if (!draft) { showToast('No pending receipt found', 'error'); return }
    setActiveReceiptId(draft.id)
    const preSpecs: Record<string, string> = {}
    const preLines = draft.lines.map(l => {
      const preSerials = (l.importedSerials ?? []).slice(0, l.qtyExpected)
      return { ...l, qtyReceived: l.qtyExpected, serials: preSerials }
    })
    draft.lines.forEach(l => {
      if (l.specs && l.importedSerials) l.importedSerials.forEach(s => { preSpecs[s] = l.specs! })
    })
    setGrnLines(preLines); setDestLocation(draft.destinationLocation)
    setSerialInputs({}); setSerialSpecs(preSpecs); setSubView('receive')
  }

  const billableLinesFor = (po: typeof activePO) =>
    po.lines
      .map(l => ({ id: l.id, label: l.productName, maxQty: billableQtyForLine(l) }))
      .filter(l => l.maxQty > 0)

  const openBillModal = () => {
    const lines = billableLinesFor(activePO)
    setBillQtys(Object.fromEntries(lines.map(l => [l.id, String(l.maxQty)])))
    setShowBillModal(true)
  }

  const submitPartialBill = async () => {
    const overrides = Object.entries(billQtys)
      .map(([lineId, qty]) => ({ lineId, qty: Math.max(0, Number(qty) || 0) }))
      .filter(o => o.qty > 0)
    if (overrides.length === 0) {
      showToast('Enter a quantity greater than zero for at least one line', 'error')
      return
    }
    setCreatingBill(true)
    try {
      const bill = await Promise.resolve(createBillFromPO(activePO.id, overrides))
      if (bill?.id) setShowBillModal(false)
    } finally {
      setCreatingBill(false)
    }
  }

  const openBillsTab = () => {
    setActiveId(null)
    setSubView('list')
    setMainView('bills')
  }

  const openReturnForPO = () => {
    const latest = receipts.filter(r => r.poId === activePO.id && r.status === 'validated').pop()
    if (!latest) { showToast('No validated receipt found', 'error'); return }
    setReturnReceiptId(latest.id)
    setReturnLines(latest.lines.filter(l => l.qtyReceived > 0).map(l => ({ productId: l.productId, productName: l.productName, qty: '1', serials: [], requiresSerial: l.requiresSerial })))
    setReturnScanInput({}); setReturnCollectedBy(''); setReturnCollectedDate(new Date().toISOString().slice(0, 10)); setReturnPickupNotes(''); setShowReturnModal(true)
  }

    const canEdit        = activePO.status === 'draft' || activePO.status === 'sent'
    const canSend        = activePO.status === 'draft' && activePO.lines.length > 0 && !!activePO.vendorId && ['director', 'admin_officer', 'inventory_officer'].includes(currentUser?.role ?? '')
    const canConfirm     = activePO.status === 'sent' && ['director', 'admin_officer', 'inventory_officer'].includes(currentUser?.role ?? '')
    const canRevertToDraft = activePO.status === 'sent' && ['director', 'admin_officer'].includes(currentUser?.role ?? '')
    const hasDraftReceipt = receipts.some(r => r.poId === activePO.id && r.status === 'draft')
    const hasOutstandingQty = activePO.lines.some(line => line.qtyReceived < line.qty)
    // technical_lead is deliberately excluded: validateReceipt's
    // canValidatePurchaseReceiptAction gate (and the server's
    // validatePurchaseReceipt permission) both reject it, so showing this
    // button to technical_lead is a guaranteed-denied dead end that loses
    // unsaved GRN scan progress (serials/specs are local component state
    // until the receipt is validated).
    const canReceive     = (activePO.status === 'confirmed' || activePO.status === 'partial') && hasOutstandingQty && ['director', 'admin_officer', 'inventory_officer'].includes(currentUser?.role ?? '')
    const canReturn      = (activePO.status === 'received' || activePO.status === 'partial') && receipts.some(r => r.poId === activePO.id && r.status === 'validated') && ['director', 'admin_officer', 'inventory_officer'].includes(currentUser?.role ?? '')
    const hasBillableQty = activePO.lines.some(line => billableQtyForLine(line) > 0)
    const canCreateBill  = (activePO.status === 'received' || activePO.status === 'partial') && hasBillableQty && ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')
    const canValidateBill = linkedBill?.status === 'draft' && ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')
    const canPay         = !!linkedBill && invoiceDocState(linkedBill.status) === 'posted' && (linkedBill.amountPaid ?? 0) < (linkedBill.total ?? 0) && ['director', 'finance_officer'].includes(currentUser?.role ?? '')
    const stepIdx        = linkedBill ? 4 : (PO_STEP_IDX[activePO.status] ?? 0)
    const poReceipts     = receipts.filter(r => r.poId === activePO.id)
    const poReturns      = purchaseReturns.filter(r => r.poId === activePO.id)
    const billsCount     = linkedBill ? 1 : 0

    const poStepClickable = (step: string, index: number) => {
      if (index === 1 && activePO.status === 'draft') return canSend
      if (index === 2 && activePO.status === 'sent') return canConfirm
      return false
    }

    const handlePOStepClick = (step: string, index: number) => {
      if (!poStepClickable(step, index)) return
      if (index === 1) sendPO(activePO.id)
      else if (index === 2) confirmPO(activePO.id)
    }

    const backToList = () => { setSubView('list'); setActiveId(null) }
    const receivedValue = activePO.lines.reduce((sum, line) => {
      const receivedQty = Math.min(line.qtyReceived, line.qty)
      return sum + receivedQty * line.unitPrice * (1 + (line.taxRate || 0) / 100)
    }, 0)
    const toReceiveValue = Math.max(0, activePO.total - receivedValue)
    const nextActionLabel = canSend
      ? 'Send RFQ'
      : canConfirm
        ? 'Confirm order'
        : canReceive
          ? 'Process GRN'
          : canCreateBill
            ? 'Create bill'
            : canValidateBill
              ? 'Validate bill'
              : canPay
                ? 'Register payment'
                : 'No action due'

    // Helper: render an inline-editable cell
    const EditableCell = ({ lineId, field, value, formatter }: { lineId: string; field: 'qty' | 'unitPrice' | 'taxRate'; value: number; formatter: (v: number) => string }) => {
      const isEditing = editCell?.lineId === lineId && editCell.field === field
      if (!canEdit) return <span className="font-mono text-xs">{formatter(value)}</span>
      if (isEditing) {
        return (
          <input
            autoFocus
            className="form-input text-xs text-center font-mono py-0.5"
            style={{ width: field === 'taxRate' ? 60 : 90, padding: '2px 6px' }}
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={() => commitCell(activePO.id, lineId, field, editVal)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitCell(activePO.id, lineId, field, editVal)
              if (e.key === 'Escape') setEditCell(null)
            }}
          />
        )
      }
      return (
        <span
          className="font-mono text-xs cursor-pointer rounded px-1 py-0.5 transition-all"
          style={{ background: 'var(--bg-muted)', border: '1px dashed var(--border)' }}
          title="Click to edit"
          onClick={() => { setEditCell({ lineId, field }); setEditVal(String(value)) }}>
          {formatter(value)}
        </span>
      )
    }

    return (
      <div className="purchase-order-detail">
        {/* ── Header ── */}
        <div className="purchase-order-detail__header">
          <Breadcrumbs
            items={[
              { label: 'Purchase', onClick: backToList },
              { label: 'Orders', onClick: backToList },
              { label: activePO.ref },
            ]}
          />
          <div className="purchase-order-detail__title-row">
          <div className="purchase-order-detail__identity">
          <button type="button" className="btn-outline text-[11px] py-1 px-2.5" onClick={backToList} aria-label="Back to orders">← Orders</button>
          <span className="text-sm font-bold text-t1">{activePO.ref}</span>
          <StatusBadge status={activePO.status} label={STATUS_LABEL[activePO.status]} />
          {canEdit && <span className="purchase-order-detail__edit-hint">Click table values to edit</span>}
          </div>
          <div className="purchase-order-detail__actions">
            {canSend && (
              <PrimaryActionButton
                icon={<Fa icon={faPaperPlane} />}
                hideLabelOnMobile={false}
                disabled={!!actionBusy}
                onClick={async () => {
                  setActionBusy('send')
                  try { await Promise.resolve(sendPO(activePO.id)) } finally { setActionBusy(null) }
                }}
              >
                {actionBusy === 'send' ? 'Sending…' : 'Send RFQ'}
              </PrimaryActionButton>
            )}
            {canConfirm && (
              <PrimaryActionButton
                icon={<Fa icon={faCheck} />}
                hideLabelOnMobile={false}
                disabled={!!actionBusy}
                onClick={async () => {
                  setActionBusy('confirm')
                  try { await Promise.resolve(confirmPO(activePO.id)) } finally { setActionBusy(null) }
                }}
              >
                {actionBusy === 'confirm' ? 'Confirming…' : 'Confirm Order'}
              </PrimaryActionButton>
            )}
            {!canSend && !canConfirm && canReceive && (
              <PrimaryActionButton
                icon={<Fa icon={faWarehouse} />}
                hideLabelOnMobile={false}
                disabled={!!actionBusy}
                onClick={async () => {
                  setActionBusy('receive')
                  try { await openReceive() } finally { setActionBusy(null) }
                }}
              >
                {actionBusy === 'receive' ? 'Opening…' : 'Process GRN'}
              </PrimaryActionButton>
            )}
            {!canSend && !canConfirm && !canReceive && canCreateBill && (
              <PrimaryActionButton
                icon={<Fa icon={faFileInvoice} />}
                hideLabelOnMobile={false}
                disabled={!!actionBusy}
                onClick={openBillModal}
              >
                Create Bill
              </PrimaryActionButton>
            )}
            {!canSend && !canConfirm && !canReceive && !canCreateBill && canValidateBill && (
              <PrimaryActionButton
                icon={<Fa icon={faCheck} />}
                hideLabelOnMobile={false}
                disabled={!!actionBusy}
                onClick={async () => {
                  setActionBusy('validate')
                  try { await Promise.resolve(postInvoice(linkedBill!.id)) } finally { setActionBusy(null) }
                }}
              >
                {actionBusy === 'validate' ? 'Posting…' : 'Validate Bill'}
              </PrimaryActionButton>
            )}
            {!canSend && !canConfirm && !canReceive && !canCreateBill && !canValidateBill && canPay && (
              <PrimaryActionButton
                icon={<Fa icon={faCreditCard} />}
                hideLabelOnMobile={false}
                onClick={openBillsTab}
              >
                Register payment
              </PrimaryActionButton>
            )}
            <SecondaryActionMenu
              label="More"
              ariaLabel="More purchase order actions"
              actions={[
                {
                  id: 'download-rfq',
                  label: 'Download RFQ',
                  hidden: !(activePO.status === 'draft' || activePO.status === 'sent') || activePO.lines.length === 0,
                  onClick: () => {
                    void downloadRfqPdf(activePO, contacts, companySettings).catch(() => {
                      showToast('RFQ PDF generation failed', 'error')
                    })
                  },
                },
                {
                  id: 'download-po',
                  label: 'Download PO',
                  hidden: !['confirmed', 'partial', 'received', 'cancelled'].includes(activePO.status) || activePO.lines.length === 0,
                  onClick: () => {
                    void downloadPoPdf(activePO, contacts, companySettings).catch(() => {
                      showToast('PO PDF generation failed', 'error')
                    })
                  },
                },
                {
                  id: 'mail-rfq',
                  label: sendingRfqMail ? 'Sending RFQ…' : 'Mail RFQ',
                  disabled: sendingRfqMail,
                  hidden: !(activePO.status === 'draft' || activePO.status === 'sent') || activePO.lines.length === 0,
                  onClick: () => { void handleMailRfq() },
                },
                { id: 'scan', label: 'Scan document', hidden: !canEdit, onClick: () => setShowScanModal(true) },
                { id: 'import', label: 'Import lines', hidden: !canEdit, onClick: () => setShowImport(true) },
                { id: 'add', label: 'Add product', hidden: !canEdit, onClick: () => setShowAddLine(true) },
                { id: 'receive', label: 'Process GRN', hidden: !canReceive || canSend || canConfirm, onClick: () => { void openReceive() } },
                {
                  id: 'bill',
                  label: 'Create bill',
                  hidden: !canCreateBill || canSend || canConfirm || canReceive,
                  onClick: openBillModal,
                },
                {
                  id: 'validate',
                  label: 'Validate bill',
                  hidden: !canValidateBill || canSend || canConfirm || canReceive || canCreateBill,
                  onClick: () => { void postInvoice(linkedBill!.id) },
                },
                {
                  id: 'open-bill',
                  label: 'Open vendor bill',
                  hidden: !linkedBill,
                  onClick: openBillsTab,
                },
                {
                  id: 'pay-bill',
                  label: 'Register payment',
                  hidden: !canPay,
                  onClick: openBillsTab,
                },
                { id: 'revert', label: 'Revert to draft', hidden: !canRevertToDraft, onClick: () => revertPOToDraft(activePO.id) },
                { id: 'return', label: 'Return to vendor', hidden: !canReturn, onClick: () => openReturnForPO() },
                { id: 'delete', label: 'Delete', hidden: !canEdit, danger: true, onClick: () => setDelId(activePO.id) },
              ]}
            />
          </div>
          </div>
        </div>

        <section className="purchase-order-summary" aria-label="Purchase order priorities">
          <div className="purchase-order-summary__item">
            <span>Order total</span>
            <strong>{fmtKes(activePO.total)}</strong>
          </div>
          <div className="purchase-order-summary__item">
            <span>Received</span>
            <strong>{fmtKes(receivedValue)}</strong>
          </div>
          <div className="purchase-order-summary__item">
            <span>To receive</span>
            <strong>{fmtKes(toReceiveValue)}</strong>
          </div>
          <div className="purchase-order-summary__item purchase-order-summary__item--next">
            <span>Next action</span>
            <strong>{nextActionLabel}</strong>
          </div>
        </section>

        {/* Stepper + smart buttons */}
        <div className="card purchase-order-detail__progress">
          <StatusStepper
            steps={PO_STEPS}
            current={PO_STEPS[stepIdx]}
            isStepClickable={poStepClickable}
            onStepClick={handlePOStepClick}
          />
          <SmartButtons
            buttons={[
              ...(poReceipts.length > 0
                ? [{ id: 'receipts', label: 'Receipts', count: poReceipts.length, tone: 'success' as const, onClick: () => document.getElementById('po-grn-history')?.scrollIntoView({ behavior: 'smooth' }) }]
                : []),
              ...(billsCount > 0
                ? [{ id: 'bills', label: 'Bills', count: billsCount, tone: 'violet' as const, onClick: () => document.getElementById('po-vendor-bill')?.scrollIntoView({ behavior: 'smooth' }) }]
                : []),
              ...(poReturns.length > 0
                ? [{ id: 'returns', label: 'Returns', count: poReturns.length, tone: 'warning' as const, onClick: () => document.getElementById('po-returns-history')?.scrollIntoView({ behavior: 'smooth' }) }]
                : []),
            ]}
          />
        </div>

        {/* Repair procurement link banner */}
        {activePO.repairRef && (
          <div className="card p-3 flex items-center gap-2.5" style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-card))', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}>
            <span className="text-base text-t3" aria-hidden="true"><Fa icon={faWrench} /></span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-t1">Repair procurement — {activePO.repairRef}</p>
              <p className="text-[10px] text-t3">Auto-created from a parts request on repair {activePO.repairRef}. Assign a vendor below, then process normally through Purchase → GRN → Validate to auto-resume the repair.</p>
            </div>
            {!activePO.vendorId && (
              <span className="badge badge-amber text-[9px] whitespace-nowrap">Vendor needed</span>
            )}
          </div>
        )}

        <div className="purchase-order-detail__grid">
          {/* ── Left ── */}
          <div className="purchase-order-detail__main">

            {/* Order header fields */}
            <div className="card overflow-hidden purchase-order-detail__facts">
              <PanelHeader title={canEdit ? 'Request for Quotation' : 'Purchase Order'} />
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Vendor">
                  {canEdit && !activePO.vendorId ? (
                    <SearchPicker
                      label=""
                      placeholder="Assign vendor…"
                      items={vendors}
                      onSelect={v => updatePO(activePO.id, { vendorId: v.id, vendorName: v.name })}
                      renderItem={v => <span className="text-xs">{v.name}</span>}
                    />
                  ) : (
                    <div className="form-input text-xs text-t1">{activePO.vendorName || <span className="text-t3">No vendor assigned</span>}</div>
                  )}
                </Field>
                <Field label="Order Date">
                  {canEdit
                    ? <input className="form-input" type="date" value={activePO.date}
                        onChange={e => updatePO(activePO.id, { date: e.target.value })} />
                    : <div className="form-input text-xs">{fmtDate(activePO.date)}</div>}
                </Field>
                <Field label="Expected Delivery">
                  {canEdit
                    ? <input className="form-input" type="date" value={activePO.expectedDate}
                        onChange={e => updatePO(activePO.id, { expectedDate: e.target.value })} />
                    : <div className="form-input text-xs">{fmtDate(activePO.expectedDate)}</div>}
                </Field>
                <Field label="Notes">
                  {canEdit
                    ? <input className="form-input text-xs" value={activePO.notes} placeholder="Internal notes…"
                        onChange={e => updatePO(activePO.id, { notes: e.target.value })} />
                    : <div className="form-input text-xs">{activePO.notes || '—'}</div>}
                </Field>
              </div>
            </div>

            {/* Products table */}
            <div className="card overflow-hidden purchase-order-lines">
              <PanelHeader title="Order lines" count={activePO.lines.length}>
                {canEdit && (
                  <div className="flex gap-1.5">
                    <button type="button" className="btn-secondary text-[10px] py-1 flex items-center gap-1.5" onClick={() => setShowImport(true)}>
                      <Fa icon={faUpload} aria-hidden="true" /> Import CSV
                    </button>
                    <button type="button" className="btn-primary text-[11px] flex items-center gap-1.5" onClick={() => setShowAddLine(true)}>
                      <Fa icon={faPlus} aria-hidden="true" /> Add Product
                    </button>
                  </div>
                )}
              </PanelHeader>

              <div className="dt-scroll">
              <div className="flex flex-col">
              {/* Table header */}
              <div className="table-head" style={{ gridTemplateColumns: '40px 2fr 70px 110px 80px 90px 60px 80px 44px' }}>
                <span></span>
                <span>Product / Cost Account</span>
                <span>Qty {canEdit && <span className="text-[9px] text-t3 normal-case tracking-normal">(click)</span>}</span>
                <span>Unit Cost {canEdit && <span className="text-[9px] text-t3 normal-case tracking-normal">(click)</span>}</span>
                <span>VAT %</span>
                <span>Subtotal</span>
                <span>Serial?</span>
                <span>Received</span>
                <span></span>
              </div>

              {activePO.lines.length === 0
                ? (
                  <div className="flex flex-col items-center py-10 gap-2">
                    <span className="text-3xl text-t4" aria-hidden="true"><Fa icon={faBox} /></span>
                    <p className="text-xs text-t3">No products yet</p>
                    {canEdit && (
                      <div className="flex gap-2">
                        <button type="button" className="btn-secondary text-[11px] flex items-center gap-1.5" onClick={() => setShowImport(true)}>
                          <Fa icon={faUpload} aria-hidden="true" /> Import from CSV
                        </button>
                        <button type="button" className="btn-primary text-[11px] flex items-center gap-1.5" onClick={() => setShowAddLine(true)}>
                          <Fa icon={faPlus} aria-hidden="true" /> Add Product
                        </button>
                      </div>
                    )}
                  </div>
                )
                : activePO.lines.map(l => {
                    const p = products.find(x => x.id === l.productId)
                    const vatOn = l.taxRate > 0
                    const acct = l.accountCode ? accounts.find(a => a.code === l.accountCode) : null
                    const costAccounts = accounts.filter(a => a.type === 'expense' && a.isActive)
                    const imageSrc = p?.image && !/^\p{Extended_Pictographic}/u.test(p.image) ? p.image : null
                    return (
                      <div key={l.id} className="table-row" style={{ gridTemplateColumns: '40px 2fr 70px 110px 80px 90px 60px 80px 44px' }}>
                        <span className="text-t4 flex items-center justify-center" aria-hidden="true">
                          {imageSrc
                            ? <img src={imageSrc} alt="" className="w-7 h-7 object-contain rounded" />
                            : <Fa icon={faBox} />}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-xs text-t1 truncate" title={l.productName}>{l.productName}</p>
                          {canEdit ? (
                            <select
                              className="form-select text-[10px] py-0.5 mt-0.5"
                              style={{ maxWidth: 200 }}
                              value={l.accountCode ?? ''}
                              onChange={e => updatePOLine(activePO.id, l.id, { accountCode: e.target.value || undefined })}
                            >
                              <option value="">— no account —</option>
                              {costAccounts.map(a => (
                                <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                              ))}
                            </select>
                          ) : (
                            <p className="text-[10px]" style={{ color: acct ? 'var(--navy)' : 'var(--text-4)' }}>
                              {acct ? `${acct.code} · ${acct.name}` : 'No account linked'}
                            </p>
                          )}
                        </div>

                        {/* Qty — inline editable */}
                        <EditableCell lineId={l.id} field="qty" value={l.qty} formatter={v => String(v)} />

                        {/* Unit Price — inline editable */}
                        <EditableCell lineId={l.id} field="unitPrice" value={l.unitPrice} formatter={fmtKes} />

                        {/* VAT — toggle or display */}
                        {canEdit ? (
                          <div className="flex items-center gap-1">
                            <input type="checkbox" checked={vatOn}
                              onChange={e => {
                                const rate = e.target.checked ? 16 : 0
                                updatePOLine(activePO.id, l.id, { taxRate: rate })
                              }}
                              style={{ accentColor: 'var(--navy)', width: 13, height: 13 }} />
                            <EditableCell lineId={l.id} field="taxRate" value={l.taxRate} formatter={v => `${v}%`} />
                          </div>
                        ) : (
                          <span className="text-[10px] text-t2">{vatOn ? `${l.taxRate}%` : 'No VAT'}</span>
                        )}

                        <span className="font-mono text-xs font-semibold text-t1">{fmtKes(l.subtotal)}</span>

                        <span>
                          {l.requiresSerial
                            ? <span className="text-[10px]" style={{ color: 'var(--warning-text)' }}>Serial</span>
                            : <span className="text-[10px] text-t3">No</span>}
                        </span>

                        <span className="font-mono text-[11px]"
                          style={{ color: l.qtyReceived >= l.qty ? 'var(--success)' : l.qtyReceived > 0 ? 'var(--warning)' : 'var(--text-4)' }}>
                          {l.qtyReceived}/{l.qty}
                        </span>

                        {canEdit ? (
                          <button
                            type="button"
                            className="row-action-btn btn-danger"
                            aria-label={`Remove ${l.productName}`}
                            onClick={() => removePOLine(activePO.id, l.id)}
                          >
                            <Fa icon={faTrash} aria-hidden="true" />
                          </button>
                        ) : <span />}
                      </div>
                    )
                  })
              }

              {activePO.lines.length > 0 && (
                <div className="flex justify-end p-4 border-t" style={{ borderColor: 'var(--bg-muted)' }}>
                  <div className="flex flex-col gap-1.5" style={{ minWidth: 240 }}>
                    <div className="flex justify-between text-xs">
                      <span className="text-t3">Subtotal</span>
                      <span className="font-mono text-t1">{fmtKes(activePO.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-t3">VAT</span>
                      <span className="font-mono text-t2">{activePO.taxTotal > 0 ? fmtKes(activePO.taxTotal) : '—'}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold pt-2 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                      <span className="text-t1">Total</span>
                      <span className="font-mono" style={{ color: 'var(--navy)' }}>{fmtKes(activePO.total)}</span>
                    </div>
                  </div>
                </div>
              )}
              </div>
              </div>
            </div>

            {/* GRN history */}
            {poReceipts.length > 0 && (
              <div id="po-grn-history" className="card overflow-hidden">
                <PanelHeader title="Goods Receipts (GRN)" count={poReceipts.length} />
                {poReceipts.map(r => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between px-4 py-3 border-b text-xs ${r.status === 'draft' ? 'cursor-pointer hover:bg-[var(--bg-surface)]' : ''}`}
                    style={{ borderColor: 'var(--bg-muted)' }}
                    onClick={() => { if (r.status === 'draft' && canReceive) void openReceive() }}
                    role={r.status === 'draft' && canReceive ? 'button' : undefined}
                    tabIndex={r.status === 'draft' && canReceive ? 0 : undefined}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ' ') && r.status === 'draft' && canReceive) {
                        e.preventDefault()
                        void openReceive()
                      }
                    }}
                  >
                    <div>
                      <p className="font-mono font-semibold" style={{ color: 'var(--navy)' }}>{r.ref}</p>
                      <p className="text-t3 mt-0.5">
                        {fmtDate(r.date)} · {LOCATIONS[r.destinationLocation].icon} {LOCATIONS[r.destinationLocation].name}
                        {r.status === 'validated' && ` · ${r.lines.reduce((a, l) => a + l.serials.length, 0)} serials`}
                        {r.status === 'draft' && canReceive ? ' · Click to process' : ''}
                      </p>
                    </div>
                    <StatusBadge status={r.status === 'validated' ? 'done' : 'pending'} label={r.status === 'validated' ? 'Validated' : 'Pending'} />
                  </div>
                ))}
              </div>
            )}

            {/* Returns history */}
            {poReturns.length > 0 && (
              <div id="po-returns-history" className="card overflow-hidden">
                <PanelHeader title="Returns" count={poReturns.length} />
                {poReturns.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3 border-b text-xs" style={{ borderColor: 'var(--bg-muted)' }}>
                    <div>
                      <p className="font-mono font-semibold" style={{ color: 'var(--warning)' }}>{r.ref}</p>
                      <p className="text-t3 mt-0.5">{fmtDate(r.date)} · {r.reason.replace('_', ' ')}</p>
                    </div>
                    <StatusBadge status={r.status === 'confirmed' ? 'confirmed' : 'pending'} label={r.status} />
                  </div>
                ))}
              </div>
            )}

            <Chatter
              model="purchase_order"
              recordId={activePO.id}
              title="PO Chatter"
              compact
            />
          </div>

          {/* ── Right sidebar ── */}
          <div className="purchase-order-detail__side">
            <div className="card overflow-hidden purchase-order-match">
              <PanelHeader title="Three-way match" />
              <div className="purchase-order-match__body">
                <div className="purchase-order-match__row">
                  <span>Purchase order</span>
                  <strong className={!['draft', 'sent', 'cancelled'].includes(activePO.status) ? 'is-complete' : 'is-pending'}>
                    {!['draft', 'sent', 'cancelled'].includes(activePO.status) ? 'Confirmed' : 'Pending'}
                  </strong>
                </div>
                <div className="purchase-order-match__row">
                  <span>Goods receipt</span>
                  <strong className={poReceipts.some(receipt => receipt.status === 'validated') ? 'is-complete' : 'is-pending'}>
                    {poReceipts.some(receipt => receipt.status === 'validated') ? 'Validated' : 'Pending'}
                  </strong>
                </div>
                <div className="purchase-order-match__row">
                  <span>Vendor bill</span>
                  <strong className={linkedBill ? 'is-complete' : 'is-pending'}>{linkedBill ? 'Linked' : 'Not created'}</strong>
                </div>
              </div>
            </div>

            {/* Vendor card */}
            <div className="card overflow-hidden purchase-order-vendor">
              <PanelHeader title="Vendor" />
              <div className="p-4 flex flex-col gap-2">
                {vendor ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                        style={{ background: 'linear-gradient(135deg, var(--navy), var(--accent-cyan))' }}>
                        {vendor.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-t1">{vendor.name}</p>
                        <p className="text-[10px] text-t3">{vendor.type === 'company' ? 'Company' : 'Individual'}</p>
                      </div>
                    </div>
                    {vendor.email    && <p className="text-[11px] text-t2 inline-flex items-center gap-1.5"><Fa icon={faEnvelope} className="text-t4" aria-hidden="true" /> {vendor.email}</p>}
                    {vendor.phone    && <p className="text-[11px] text-t2 inline-flex items-center gap-1.5"><Fa icon={faPhone} className="text-t4" aria-hidden="true" /> {vendor.phone}</p>}
                    {vendor.address  && <p className="text-[10px] text-t3 inline-flex items-center gap-1.5"><Fa icon={faLocationDot} className="text-t4" aria-hidden="true" /> {vendor.address}</p>}
                    {vendor.vatNumber && <p className="text-[10px] text-t3">PIN: {vendor.vatNumber}</p>}
                    <div className="grid grid-cols-2 gap-2 text-[10px] pt-2 border-t" style={{ borderColor: 'var(--bg-muted)' }}>
                      <div>
                        <span className="text-t3">Credit Limit</span><br />
                        <span className="font-mono text-t1">{vendor.creditLimit ? fmtKes(vendor.creditLimit) : 'None'}</span>
                      </div>
                      <div>
                        <span className="text-t3">Terms</span><br />
                        <span className="text-t1">{vendor.paymentTerms || '—'}</span>
                      </div>
                      <div>
                        <span className="text-t3">Rating</span><br />
                        <span className="text-t1 inline-flex items-center gap-1">{vendor.vendorRating ? <><Fa icon={faStar} className="text-amber-500" aria-hidden="true" /> {vendor.vendorRating.toFixed(1)}/5</> : '—'}</span>
                      </div>
                    </div>
                    {vendor.bankDetails && (
                      <p className="text-[10px] text-t3 pt-2 border-t" style={{ borderColor: 'var(--bg-muted)' }}>
                        Bank: {vendor.bankDetails}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-t3">{activePO.vendorName}</p>
                )}
              </div>
            </div>

            {/* Vendor bill */}
            <div id="po-vendor-bill" className="card overflow-hidden">
              <PanelHeader title="Vendor Bill" />
              <div className="p-3">
                {linkedBill ? (
                  <div className="p-3 rounded-lg flex flex-col gap-2" style={{ background: 'var(--info-bg)', border: '1px solid color-mix(in srgb, var(--info) 35%, transparent)' }}>
                    <p className="font-mono font-semibold text-xs" style={{ color: 'var(--navy)' }}>{displayDocRef(linkedBill.ref)}</p>
                    <div className="flex justify-between text-xs"><span className="text-t3">Total</span><span className="font-mono text-t1">{fmtKes(linkedBill.total)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-t3">Paid</span><span className="font-mono" style={{ color: 'var(--success)' }}>{fmtKes(linkedBill.amountPaid)}</span></div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-t1">Outstanding</span>
                      <span className="font-mono" style={{ color: linkedBill.total - linkedBill.amountPaid > 0 ? 'var(--danger)' : 'var(--success)' }}>
                        {fmtKes(linkedBill.total - linkedBill.amountPaid)}
                      </span>
                    </div>
                    <StatusBadge
                      status={invoiceDocState(linkedBill.status) === 'posted' ? invoicePaymentStatus(linkedBill) : invoiceDocState(linkedBill.status)}
                      label={invoiceDocState(linkedBill.status) === 'posted' ? PAYMENT_STATUS_LABELS[invoicePaymentStatus(linkedBill)] : undefined}
                      size="xs"
                    />
                  </div>
                ) : (
                  <p className="text-[11px] text-t3 text-center py-3">
                    {activePO.status === 'received' || activePO.status === 'partial'
                      ? 'Click "Create Bill" to generate the vendor invoice'
                      : 'Available after goods are received'}
                  </p>
                )}
              </div>
            </div>

            {/* Serial reminder */}
            {activePO.lines.some(l => l.requiresSerial) && (
              <div className="card p-3 text-xs" style={{ background: 'var(--warning-bg)', borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)' }}>
                <p className="font-semibold mb-1.5" style={{ color: 'var(--warning-text)' }}>Serial tracking required</p>
                {activePO.lines.filter(l => l.requiresSerial).map(l => (
                  <p key={l.id} className="text-t3 mb-0.5">• {l.productName} — {l.qty} unit(s)</p>
                ))}
                <p className="mt-2 text-t3">All serial numbers must be scanned during GRN validation.</p>
              </div>
            )}
          </div>
        </div>

        {/* Partial-bill quantity picker — bill less than the full received-and-unbilled qty per line. */}
        {showBillModal && (
          <Modal title={`Create Bill — ${activePO.ref}`} onClose={() => setShowBillModal(false)} width={520}>
            <div className="flex flex-col gap-4">
              <p className="text-xs text-t3">Choose how much of each received line to bill now. Leave a line at 0 to bill it later.</p>
              <div className="flex flex-col gap-3">
                {billableLinesFor(activePO).map(l => (
                  <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-t1 truncate">{l.label}</p>
                      <p className="text-[10px] text-t4">Up to {l.maxQty} billable now</p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={l.maxQty}
                      className="form-input text-xs w-20 text-right"
                      value={billQtys[l.id] ?? ''}
                      onChange={e => {
                        const clamped = Math.max(0, Math.min(l.maxQty, Number(e.target.value) || 0))
                        setBillQtys(prev => ({ ...prev, [l.id]: String(clamped) }))
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 justify-end pt-4 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                <button className="btn-outline" onClick={() => setShowBillModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={() => void submitPartialBill()} disabled={creatingBill}>
                  {creatingBill ? 'Creating…' : 'Create Bill'}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Add product modal */}
        {showAddLine && (
          <Modal title="Add Product" onClose={() => setShowAddLine(false)} width={500}>
            <SearchPicker label="Product *" placeholder="Search purchasable products…" items={purchasableProds}
              onSelect={p => { setAddProd(p); setAddPrice(String(p.costPrice)) }}
              renderItem={p => (
                <div className="flex items-center gap-2">
                  <span className="text-lg">{p.image}</span>
                  <div>
                    <p className="font-medium text-xs text-t1">{p.name}</p>
                    <p className="text-[10px] text-t3">
                      {p.category} · Cost: {fmtKes(p.costPrice)}
                      {CATEGORY_CONFIG[p.category as CategoryId]?.serialRequired ? <> · <Fa icon={faBarcode} aria-hidden="true" /> Serial</> : ''}
                    </p>
                  </div>
                </div>
              )} />
            {addProd && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Quantity"><Input value={addQty} onChange={setAddQty} type="number" /></Field>
                  <Field label="Unit Cost (KES)"><Input value={addPrice} onChange={setAddPrice} type="number" /></Field>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
                  <input type="checkbox" checked={addVAT} onChange={e => setAddVAT(e.target.checked)}
                    style={{ accentColor: 'var(--navy)', width: 14, height: 14 }} />
                <span>Include VAT ({companySettings.vatRate}%)</span>
                  {addVAT && Number(addQty) > 0 && Number(addPrice) > 0 && (
                  <span className="ml-auto font-mono text-t3">+{fmtKes(Math.round(Number(addQty) * Number(addPrice) * (companySettings.vatRate / 100)))} VAT</span>
                  )}
                </label>
              </>
            )}
            {addProd && Number(addQty) > 0 && Number(addPrice) > 0 && (
              <div className="flex justify-between text-xs font-mono rounded px-3 py-2" style={{ background: 'var(--primary-light)', border: '1px solid color-mix(in srgb, var(--primary) 35%, transparent)' }}>
                <span className="text-t3">Total incl. VAT</span>
                <span className="font-semibold" style={{ color: 'var(--navy)' }}>
                  {fmtKes(Number(addQty) * Number(addPrice) * (addVAT ? 1 + (companySettings.vatRate ?? 16) / 100 : 1))}
                </span>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setShowAddLine(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddLine} disabled={!addProd}>Add Product</button>
            </div>
          </Modal>
        )}

        {delId && (
          <Confirm
            message={`Delete ${activePO.ref}? This cannot be undone.`}
            onConfirm={() => { deletePO(activePO.id); setDelId(null); setSubView('list'); setActiveId(null) }}
            onCancel={() => setDelId(null)}
          />
        )}
      </div>
    )
}