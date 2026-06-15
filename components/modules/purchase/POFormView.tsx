'use client'
import { useMemo } from 'react'
import { usePurchase } from './PurchaseContext'
import { Badge, Modal, Field, Input, Select, Confirm, PanelHeader, StatusStepper, SearchPicker, Divider } from '@/components/ui'
import { LOCATIONS, CATEGORY_CONFIG, type LocationId, type CategoryId, fmtKes, fmtDate } from '@/lib/store'
import { downloadPdf, type PdfLine } from '@/lib/pdf'

const ACCESSORIES = ['Charger', 'Bag/Case', 'Mouse', 'Box', 'Cable', 'Manual']
const PO_STEPS = ['RFQ', 'RFQ Sent', 'Purchase Order', 'Received', 'Billed']
const STATUS_LABEL: Record<string,string> = { draft:'RFQ', sent:'RFQ Sent', confirmed:'Purchase Order', partial:'Partially Received', received:'Fully Received', cancelled:'Cancelled' }
const STATUS_BADGE: Record<string,string> = { draft:'badge-gray', sent:'badge-amber', confirmed:'badge-blue', partial:'badge-amber', received:'badge-green', cancelled:'badge-red' }
const PO_STEP_IDX: Record<string,number> = { draft:0, sent:1, confirmed:2, partial:3, received:3 }

function buildRfqPdfLines(po: any, companySettings: any): PdfLine[] {
  const rows: PdfLine[] = (po.lines ?? []).flatMap((line: any, index: number) => ([
    { text: String(index + 1), x: 40, y: 650 - index * 18, size: 8 },
    { text: String(line.productName ?? 'Item').slice(0, 42), x: 62, y: 650 - index * 18, size: 8 },
    { text: String(line.qty ?? 0), x: 330, y: 650 - index * 18, size: 8 },
    { text: fmtKes(Number(line.unitPrice ?? 0)), x: 380, y: 650 - index * 18, size: 8 },
    { text: fmtKes(Number(line.subtotal ?? 0)), x: 480, y: 650 - index * 18, size: 8 },
  ]))
  const totalsY = 650 - ((po.lines ?? []).length + 1) * 18
  return [
    { text: String(companySettings.name ?? 'Deed ERP').toUpperCase(), x: 40, y: 810, size: 14, bold: true },
    { text: `${companySettings.address ?? ''} ${companySettings.city ?? ''}`.trim(), x: 40, y: 794, size: 8 },
    { text: `Tel: ${companySettings.phone ?? ''} | ${companySettings.email ?? ''}`, x: 40, y: 782, size: 8 },
    { text: 'REQUEST FOR QUOTATION', x: 380, y: 810, size: 13, bold: true },
    { text: String(po.ref ?? ''), x: 430, y: 792, size: 10, bold: true },
    { text: `Date: ${String(po.date ?? '')}`, x: 430, y: 778, size: 8 },
    { text: `Expected: ${String(po.expectedDate ?? '')}`, x: 430, y: 766, size: 8 },
    { text: 'VENDOR', x: 40, y: 742, size: 9, bold: true },
    { text: String(po.vendorName ?? 'Vendor'), x: 40, y: 728, size: 11, bold: true },
    { text: 'Please quote availability, lead time, payment terms, and final pricing for the items below.', x: 40, y: 704, size: 8 },
    { text: 'No.', x: 40, y: 670, size: 8, bold: true },
    { text: 'Item', x: 62, y: 670, size: 8, bold: true },
    { text: 'Qty', x: 330, y: 670, size: 8, bold: true },
    { text: 'Target Price', x: 380, y: 670, size: 8, bold: true },
    { text: 'Line Total', x: 480, y: 670, size: 8, bold: true },
    ...rows,
    { text: 'Subtotal:', x: 380, y: totalsY, size: 9 },
    { text: fmtKes(Number(po.subtotal ?? 0)), x: 480, y: totalsY, size: 9 },
    { text: 'Tax:', x: 380, y: totalsY - 14, size: 9 },
    { text: fmtKes(Number(po.taxTotal ?? 0)), x: 480, y: totalsY - 14, size: 9 },
    { text: 'Expected Total:', x: 380, y: totalsY - 30, size: 10, bold: true },
    { text: fmtKes(Number(po.total ?? 0)), x: 480, y: totalsY - 30, size: 10, bold: true },
    ...(po.notes ? [{ text: `Notes: ${String(po.notes).slice(0, 100)}`, x: 40, y: totalsY - 58, size: 8 }] : []),
  ]
}

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

export default function POFormView() {
  const {
    activePO, linkedBill, receipts, purchaseReturns, invoices, contacts, products, accounts,
    currentUser, serials, bankAccounts, companySettings, purchaseOrders,
    updatePO, updatePOLine, removePOLine, bulkAddPOLines, sendPO, confirmPO, deletePO, createBillFromPO, revertPOToDraft,
    postInvoice, registerPayment, createPurchaseReturn, addReturnLine, confirmPurchaseReturn, logReturnPickup,
    showToast, addContact,
    setSubView, setActiveId,
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

  if (!activePO) return null

  const openReceive = () => {
    const draft = receipts.find(r => r.poId === activePO.id && r.status === 'draft')
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
    const canReceive     = activePO.status === 'confirmed' && hasDraftReceipt && ['director', 'admin_officer', 'inventory_officer', 'technical_lead'].includes(currentUser?.role ?? '')
    const canReturn      = (activePO.status === 'received' || activePO.status === 'partial') && receipts.some(r => r.poId === activePO.id && r.status === 'validated') && ['director', 'admin_officer', 'inventory_officer'].includes(currentUser?.role ?? '')
    const canCreateBill  = (activePO.status === 'received' || activePO.status === 'partial') && !activePO.billId && ['director', 'finance_officer'].includes(currentUser?.role ?? '')
    const canValidateBill = linkedBill?.status === 'draft' && ['director', 'finance_officer'].includes(currentUser?.role ?? '')
    const canPay         = (linkedBill?.status === 'posted' || linkedBill?.status === 'partially_paid' || linkedBill?.status === 'overdue') && (linkedBill?.amountPaid ?? 0) < (linkedBill?.total ?? 0) && ['director', 'finance_officer'].includes(currentUser?.role ?? '')
    const stepIdx        = linkedBill ? 4 : (PO_STEP_IDX[activePO.status] ?? 0)
    const poReceipts     = receipts.filter(r => r.poId === activePO.id)
    const poReturns      = purchaseReturns.filter(r => r.poId === activePO.id)
    const vendor         = contacts.find(c => c.id === activePO.vendorId)

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
          style={{ background: '#F3F4F6', border: '1px dashed #D1D5DB' }}
          title="Click to edit"
          onClick={() => { setEditCell({ lineId, field }); setEditVal(String(value)) }}>
          {formatter(value)}
        </span>
      )
    }

    return (
      <div className="flex flex-col gap-3">
        {/* ── Header ── */}
        <div className="flex items-center gap-2 flex-wrap" style={{ background: '#FFFFFF', padding: '12px 0', borderBottom: '1px solid #F3F4F6' }}>
          <button className="btn-outline text-[11px] py-1 px-2.5" onClick={() => { setSubView('list'); setActiveId(null) }}>← Orders</button>
          <span className="text-sm font-bold text-t1">{activePO.ref}</span>
          <span className={`badge ${STATUS_BADGE[activePO.status]}`}>{STATUS_LABEL[activePO.status]}</span>
          {canEdit && <span className="text-[10px] text-t3">· Click any value in the table to edit</span>}
          <div className="ml-auto flex gap-2 flex-wrap">
            {(activePO.status === 'draft' || activePO.status === 'sent') && activePO.lines.length > 0 && (
              <>
                <button className="btn-secondary text-[11px]" onClick={() => downloadPdf(`RFQ-${activePO.ref}.pdf`, buildRfqPdfLines(activePO, companySettings))}>Download RFQ</button>
                <button className="btn-secondary text-[11px]" onClick={() => openRfqMail(activePO, vendor, companySettings)}>Mail RFQ</button>
              </>
            )}
            {canEdit && (
              <>
                <button className="btn-secondary text-[11px]" onClick={() => setShowScanModal(true)}>🔍 Scan Document</button>
                <button className="btn-secondary text-[11px]" onClick={() => setShowImport(true)}>📥 Import Lines</button>
                <button className="btn-secondary text-[11px]" onClick={() => setShowAddLine(true)}>+ Add Product</button>
              </>
            )}
            {canRevertToDraft && <button className="btn-outline text-[11px]" style={{ color: '#6B7280', borderColor: '#D1D5DB' }} onClick={() => revertPOToDraft(activePO.id)}>↩ Revert to Draft</button>}
            {canSend         && <button className="btn-primary" style={{ background: '#F59E0B' }} onClick={() => sendPO(activePO.id)}>📧 Send RFQ</button>}
            {canConfirm      && <button className="btn-primary" onClick={() => confirmPO(activePO.id)}>✓ Confirm Order</button>}
            {canReceive      && <button className="btn-primary" style={{ background: '#10B981' }} onClick={openReceive}>📦 Process GRN</button>}
            {canCreateBill   && <button className="btn-primary" style={{ background: '#8B5CF6' }} onClick={() => createBillFromPO(activePO.id)}>🧾 Create Bill</button>}
            {canValidateBill && <button className="btn-primary" style={{ background: '#10B981' }} onClick={() => postInvoice(linkedBill!.id)}>✓ Validate Bill</button>}
            {canPay && (
              <span className="text-[10px] text-[var(--text-3)] italic">Pay via Finance → Accounting</span>
            )}
            {canReturn && <button className="btn-outline text-[11px]" style={{ color: '#F59E0B', borderColor: '#FDE68A' }} onClick={openReturnForPO}>↩ Return to Vendor</button>}
            {canEdit   && <button className="btn-outline text-[11px]" style={{ color: '#EF4444', borderColor: '#FCA5A5' }} onClick={() => setDelId(activePO.id)}>Delete</button>}
          </div>
        </div>

        {/* Stepper */}
        <div className="card p-4">
          <StatusStepper steps={PO_STEPS} current={PO_STEPS[stepIdx]} />
        </div>

        {/* Repair procurement link banner */}
        {activePO.repairRef && (
          <div className="card p-3 flex items-center gap-2.5" style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-card))', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}>
            <span className="text-base">🔧</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-t1">Repair procurement — {activePO.repairRef}</p>
              <p className="text-[10px] text-t3">Auto-created from a parts request on repair {activePO.repairRef}. Assign a vendor below, then process normally through Purchase → GRN → Validate to auto-resume the repair.</p>
            </div>
            {!activePO.vendorId && (
              <span className="badge badge-amber text-[9px] whitespace-nowrap">Vendor needed</span>
            )}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-3">
          {/* ── Left ── */}
          <div className="flex flex-col gap-3 flex-1 min-w-0">

            {/* Order header fields */}
            <div className="card overflow-hidden">
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
            <div className="card overflow-hidden">
              <PanelHeader title="Products" count={activePO.lines.length}>
                {canEdit && (
                  <div className="flex gap-1.5">
                    <button className="btn-secondary text-[10px] py-1" onClick={() => setShowImport(true)}>📥 Import CSV</button>
                    <button className="btn-primary text-[11px]" onClick={() => setShowAddLine(true)}>+ Add Product</button>
                  </div>
                )}
              </PanelHeader>

              <div className="overflow-x-auto w-full">
              <div className="min-w-[800px] flex flex-col">
              {/* Table header */}
              <div className="table-head" style={{ gridTemplateColumns: '32px 2fr 70px 110px 80px 90px 60px 80px 32px' }}>
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
                    <span className="text-3xl">📦</span>
                    <p className="text-xs text-t3">No products yet</p>
                    {canEdit && (
                      <div className="flex gap-2">
                        <button className="btn-secondary text-[11px]" onClick={() => setShowImport(true)}>📥 Import from CSV</button>
                        <button className="btn-primary text-[11px]" onClick={() => setShowAddLine(true)}>+ Add Product</button>
                      </div>
                    )}
                  </div>
                )
                : activePO.lines.map(l => {
                    const p = products.find(x => x.id === l.productId)
                    const vatOn = l.taxRate > 0
                    const acct = l.accountCode ? accounts.find(a => a.code === l.accountCode) : null
                    const costAccounts = accounts.filter(a => a.type === 'expense' && a.isActive)
                    return (
                      <div key={l.id} className="table-row" style={{ gridTemplateColumns: '32px 2fr 70px 110px 80px 90px 60px 80px 32px' }}>
                        <span className="text-base">{p?.image ?? '📦'}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-xs text-t1 truncate">{l.productName}</p>
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
                            <p className="text-[10px]" style={{ color: acct ? '#6366F1' : '#9CA3AF' }}>
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
                              style={{ accentColor: '#1B2762', width: 13, height: 13 }} />
                            <EditableCell lineId={l.id} field="taxRate" value={l.taxRate} formatter={v => `${v}%`} />
                          </div>
                        ) : (
                          <span className="text-[10px] text-t2">{vatOn ? `${l.taxRate}%` : 'No VAT'}</span>
                        )}

                        <span className="font-mono text-xs font-semibold text-t1">{fmtKes(l.subtotal)}</span>

                        <span>
                          {l.requiresSerial
                            ? <span className="text-[10px]" style={{ color: '#F59E0B' }}>🔖 Yes</span>
                            : <span className="text-[10px] text-t3">No</span>}
                        </span>

                        <span className="font-mono text-[11px]"
                          style={{ color: l.qtyReceived >= l.qty ? '#10B981' : l.qtyReceived > 0 ? '#F59E0B' : '#9CA3AF' }}>
                          {l.qtyReceived}/{l.qty}
                        </span>

                        {canEdit ? (
                          <button onClick={() => removePOLine(activePO.id, l.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 18, lineHeight: 1 }}>×</button>
                        ) : <span />}
                      </div>
                    )
                  })
              }

              {activePO.lines.length > 0 && (
                <div className="flex justify-end p-4 border-t" style={{ borderColor: '#F3F4F6' }}>
                  <div className="flex flex-col gap-1.5" style={{ minWidth: 240 }}>
                    <div className="flex justify-between text-xs">
                      <span className="text-t3">Subtotal</span>
                      <span className="font-mono text-t1">{fmtKes(activePO.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-t3">VAT</span>
                      <span className="font-mono text-t2">{activePO.taxTotal > 0 ? fmtKes(activePO.taxTotal) : '—'}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold pt-2 border-t" style={{ borderColor: '#E5E7EB' }}>
                      <span className="text-t1">Total</span>
                      <span className="font-mono" style={{ color: '#1B2762' }}>{fmtKes(activePO.total)}</span>
                    </div>
                  </div>
                </div>
              )}
              </div>
              </div>
            </div>

            {/* GRN history */}
            {poReceipts.length > 0 && (
              <div className="card overflow-hidden">
                <PanelHeader title="Goods Receipts (GRN)" count={poReceipts.length} />
                {poReceipts.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3 border-b text-xs" style={{ borderColor: '#F3F4F6' }}>
                    <div>
                      <p className="font-mono font-semibold" style={{ color: '#1B2762' }}>{r.ref}</p>
                      <p className="text-t3 mt-0.5">
                        {fmtDate(r.date)} · {LOCATIONS[r.destinationLocation].icon} {LOCATIONS[r.destinationLocation].name}
                        {r.status === 'validated' && ` · ${r.lines.reduce((a, l) => a + l.serials.length, 0)} serials`}
                      </p>
                    </div>
                    <Badge status={r.status === 'validated' ? 'active' : 'pending'} label={r.status === 'validated' ? '✓ Validated' : 'Pending'} />
                  </div>
                ))}
              </div>
            )}

            {/* Returns history */}
            {poReturns.length > 0 && (
              <div className="card overflow-hidden">
                <PanelHeader title="Returns" count={poReturns.length} />
                {poReturns.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-3 border-b text-xs" style={{ borderColor: '#F3F4F6' }}>
                    <div>
                      <p className="font-mono font-semibold" style={{ color: '#F59E0B' }}>{r.ref}</p>
                      <p className="text-t3 mt-0.5">{fmtDate(r.date)} · {r.reason.replace('_', ' ')}</p>
                    </div>
                    <Badge status={r.status === 'confirmed' ? 'active' : 'pending'} label={r.status} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Right sidebar ── */}
          <div className="flex flex-col gap-3 w-full lg:w-[300px] flex-shrink-0">

            {/* Vendor card */}
            <div className="card overflow-hidden">
              <PanelHeader title="Vendor" />
              <div className="p-4 flex flex-col gap-2">
                {vendor ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                        style={{ background: 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                        {vendor.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-t1">{vendor.name}</p>
                        <p className="text-[10px] text-t3">{vendor.type === 'company' ? 'Company' : 'Individual'}</p>
                      </div>
                    </div>
                    {vendor.email    && <p className="text-[11px] text-t2">✉ {vendor.email}</p>}
                    {vendor.phone    && <p className="text-[11px] text-t2">📞 {vendor.phone}</p>}
                    {vendor.address  && <p className="text-[10px] text-t3">📍 {vendor.address}</p>}
                    {vendor.vatNumber && <p className="text-[10px] text-t3">PIN: {vendor.vatNumber}</p>}
                    <div className="grid grid-cols-2 gap-2 text-[10px] pt-2 border-t" style={{ borderColor: '#F3F4F6' }}>
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
                        <span className="text-t1">{vendor.vendorRating ? `⭐ ${vendor.vendorRating.toFixed(1)}/5` : '—'}</span>
                      </div>
                    </div>
                    {vendor.bankDetails && (
                      <p className="text-[10px] text-t3 pt-2 border-t" style={{ borderColor: '#F3F4F6' }}>
                        🏦 {vendor.bankDetails}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-t3">{activePO.vendorName}</p>
                )}
              </div>
            </div>

            {/* Vendor bill */}
            <div className="card overflow-hidden">
              <PanelHeader title="Vendor Bill" />
              <div className="p-3">
                {linkedBill ? (
                  <div className="p-3 rounded-lg flex flex-col gap-2" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                    <p className="font-mono font-semibold text-xs" style={{ color: '#1B2762' }}>{linkedBill.ref}</p>
                    <div className="flex justify-between text-xs"><span className="text-t3">Total</span><span className="font-mono text-t1">{fmtKes(linkedBill.total)}</span></div>
                    <div className="flex justify-between text-xs"><span className="text-t3">Paid</span><span className="font-mono" style={{ color: '#10B981' }}>{fmtKes(linkedBill.amountPaid)}</span></div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-t1">Outstanding</span>
                      <span className="font-mono" style={{ color: linkedBill.total - linkedBill.amountPaid > 0 ? '#EF4444' : '#10B981' }}>
                        {fmtKes(linkedBill.total - linkedBill.amountPaid)}
                      </span>
                    </div>
                    <Badge status={linkedBill.status} size="xs" />
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
              <div className="card p-3 text-xs" style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}>
                <p className="font-semibold mb-1.5" style={{ color: '#F59E0B' }}>🔖 Serial Tracking Required</p>
                {activePO.lines.filter(l => l.requiresSerial).map(l => (
                  <p key={l.id} className="text-t3 mb-0.5">• {l.productName} — {l.qty} unit(s)</p>
                ))}
                <p className="mt-2 text-t3">All serial numbers must be scanned during GRN validation.</p>
              </div>
            )}
          </div>
        </div>

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
                      {CATEGORY_CONFIG[p.category as CategoryId]?.serialRequired ? ' · 🔖 Serial' : ''}
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
                    style={{ accentColor: '#1B2762', width: 14, height: 14 }} />
                <span>Include VAT ({companySettings.vatRate}%)</span>
                  {addVAT && Number(addQty) > 0 && Number(addPrice) > 0 && (
                  <span className="ml-auto font-mono text-t3">+{fmtKes(Math.round(Number(addQty) * Number(addPrice) * (companySettings.vatRate / 100)))} VAT</span>
                  )}
                </label>
              </>
            )}
            {addProd && Number(addQty) > 0 && Number(addPrice) > 0 && (
              <div className="flex justify-between text-xs font-mono rounded px-3 py-2" style={{ background: '#F5F3FF', border: '1px solid #C4B5FD' }}>
                <span className="text-t3">Total incl. VAT</span>
                <span className="font-semibold" style={{ color: '#1B2762' }}>
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