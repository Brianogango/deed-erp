'use client'
// The full-page new-quotation form.
//
// Split out of components/modules/Sales.tsx. It was already fully
// prop-driven — it closed over nothing in SalesContent — so this is a
// verbatim move, not a rewrite.

import type { DraftLine, OptionalProductDraft } from './types'
import { salesKes, uid } from './helpers'
import { MetaDetailsToggle } from './MetaDetailsToggle'
import { MoreActionsMenu } from './MoreActionsMenu'
import { useState, useEffect, useRef, useCallback } from 'react'
import { faArrowUp, faArrowDown, faTrash, faXmark, faSave, faChevronDown } from '@fortawesome/free-solid-svg-icons'
import { useApp, fmtDate } from '@/lib/store'
import { canCreateProductFromSales, hasExactProduct, similarProducts } from '@/lib/sales/similar-products'
import ProductFormModal from '@/components/inventory/ProductFormModal'
import PickerSheet, { COMPACT_PICKER_QUERY, useCompactViewport } from '@/components/ui/PickerSheet'
import { visibleViewportBand } from '@/lib/visible-viewport'
import { Fa } from '@/components/icons'
import { type DocumentPaymentDetails } from '@/lib/document-payment-details'
import PaymentDetailsPicker from '@/components/payment/PaymentDetailsPicker'
import { SalesDocTabs, SalesDocTotals, SalesDocField } from '@/components/modules/sales/workbench'
import { pricelistSelectOptions, type PriceListDef } from '@/lib/pricing/pricelist'
import { quotationPaymentTermsDays, quotationPaymentTermsLabel } from '@/lib/sales/quotation-defaults'
import { SalespersonCloserField } from '@/components/sales/SalespersonCloserField'

// ═══════════════════════════════════════════════════════════════════════════
// NEW QUOTATION FULL-PAGE FORM
// ═══════════════════════════════════════════════════════════════════════════
export function NewQuotationForm({
  customers, products, newCustomer, setNewCustomer, newDeliveryDate, setNewDeliveryDate,
  newValidUntil, setNewValidUntil, newNotes, setNewNotes,
  newTermsAndConditions, setNewTermsAndConditions, newOptionalProducts, setNewOptionalProducts,
  newQuoteAttachments, setNewQuoteAttachments,
  newCustomerRef, setNewCustomerRef, newInvoiceAddress, setNewInvoiceAddress,
  newDeliveryAddress, setNewDeliveryAddress, newPaymentDetails, setNewPaymentDetails,
  newPricelist, setNewPricelist, availablePricelists, salesPricelistsEnabled,
  newSalespersonId, newSalespersonName, setNewSalesperson, createdByName,
  newDraftLines,
  addDraftLine, addDraftSection, updateDraftLine, removeDraftLine, moveDraftLine, selectProductForDraftLine,
  calcDraftLineTotal, draftSubtotal, draftTaxTotal, draftTotal,
  bankAccounts, companySettings, canSave, saveBlockedReason, fieldErrors, onSave, onSaveAndAddAnother, onSaveDraft, onCancel, onCreateNewCustomer,
}: {
  customers: any[]; products: any[]; newCustomer: { id: string; name: string } | null
  setNewCustomer: (c: { id: string; name: string } | null) => void
  newDeliveryDate: string; setNewDeliveryDate: (v: string) => void
  newValidUntil: string; setNewValidUntil: (v: string) => void
  newNotes: string; setNewNotes: (v: string) => void
  newTermsAndConditions: string; setNewTermsAndConditions: (v: string) => void
  newOptionalProducts: OptionalProductDraft[]
  setNewOptionalProducts: (value: OptionalProductDraft[]) => void
  newQuoteAttachments: File[]; setNewQuoteAttachments: (files: File[]) => void
  newCustomerRef: string; setNewCustomerRef: (v: string) => void
  newInvoiceAddress: string; setNewInvoiceAddress: (v: string) => void
  newDeliveryAddress: string; setNewDeliveryAddress: (v: string) => void
  newPaymentDetails: DocumentPaymentDetails
  setNewPaymentDetails: (v: DocumentPaymentDetails) => void
  newPricelist: string; setNewPricelist: (v: string) => void
  availablePricelists: PriceListDef[]; salesPricelistsEnabled: boolean
  newSalespersonId: string
  newSalespersonName: string
  setNewSalesperson: (id: string, name: string) => void
  createdByName?: string
  newDraftLines: DraftLine[]; addDraftLine: () => void; addDraftSection: () => void
  updateDraftLine: (id: string, field: keyof DraftLine, value: string) => void
  removeDraftLine: (id: string) => void
  moveDraftLine: (id: string, direction: -1 | 1) => void
  selectProductForDraftLine: (lineId: string, product: any) => void
  calcDraftLineTotal: (l: DraftLine) => number
  draftSubtotal: number; draftTaxTotal: number; draftTotal: number
  bankAccounts: any[]
  companySettings: any
  canSave: boolean; saveBlockedReason: string
  fieldErrors?: { customer?: string; validUntil?: string; lines?: string }
  onSave: () => void; onSaveAndAddAnother: () => void; onSaveDraft: () => void; onCancel: () => void
  onCreateNewCustomer: (query: string) => void
}) {
  // Phones: what is filled in for you (date, salesperson, pricelist) stays folded.
  const [showAllMeta, setShowAllMeta] = useState(false)
  const [productSearch, setProductSearch] = useState<Record<string, string>>({})
  const [createTab, setCreateTab] = useState('Order Lines')
  // The line table lives inside an overflow container that clips absolutely
  // positioned children — the picker renders position:fixed at the trigger's
  // viewport coordinates instead, so it can never disappear under the table.
  const [productDropdownOpen, setProductDropdownOpen] = useState<{ id: string; top: number; left: number; openUp: boolean } | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const selectedCustomer = customers.find(c => c.id === newCustomer?.id)
  const paymentTermsDays = quotationPaymentTermsDays(selectedCustomer)
  const customerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  const compactPicker = useCompactViewport()
  const productTriggerRef = useRef<HTMLElement | null>(null)
  const closeProductDropdown = useCallback(() => setProductDropdownOpen(null), [])
  const openProductDropdown = (lineId: string, trigger: HTMLElement) => {
    productTriggerRef.current = trigger
    const rect = trigger.getBoundingClientRect()
    const openUp = rect.bottom + 320 > visibleViewportBand().bottom && rect.top > 340
    setProductDropdownOpen({
      id: lineId,
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
      openUp,
    })
  }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (customerRef.current && !customerRef.current.contains(e.target as Node)) setCustomerDropdownOpen(false)
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setProductDropdownOpen(null)
    }
    // Keep the fixed-position popover glued to its trigger on scroll/resize.
    // It used to close instead, which on phones meant the keyboard opening
    // (a resize + scroll-into-view) dismissed the picker before anyone could type.
    // The phone sheet is not anchored, so it ignores both.
    const followTrigger = (e: Event) => {
      if (dropdownRef.current && e.target instanceof Node && dropdownRef.current.contains(e.target)) return
      setProductDropdownOpen(prev => {
        if (!prev || window.matchMedia(COMPACT_PICKER_QUERY).matches) return prev
        const trigger = productTriggerRef.current
        if (!trigger || !trigger.isConnected) return null
        const rect = trigger.getBoundingClientRect()
        // Trigger scrolled fully out of view: nothing left to anchor to.
        if (rect.bottom < 0 || rect.top > window.innerHeight) return null
        const openUp = rect.bottom + 320 > visibleViewportBand().bottom && rect.top > 340
        const top = openUp ? rect.top - 6 : rect.bottom + 6
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - 296))
        return prev.top === top && prev.left === left && prev.openUp === openUp ? prev : { ...prev, top, left, openUp }
      })
    }
    window.addEventListener('mousedown', h)
    window.addEventListener('scroll', followTrigger, true)
    window.addEventListener('resize', followTrigger)
    return () => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('scroll', followTrigger, true)
      window.removeEventListener('resize', followTrigger)
    }
  }, [])

  const filteredCustomers = customers.filter(c =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) || (c.email ?? '').toLowerCase().includes(customerSearch.toLowerCase())
  )
  const getFilteredProducts = (search: string) =>
    products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku ?? '').toLowerCase().includes(search.toLowerCase()))
  // One picker body, two presentations: an anchored popover on desktop, a
  // bottom sheet on phones (where the keyboard would otherwise cover/close it).
  const renderProductPickerBody = (lineId: string, inSheet: boolean) => {
    const search = productSearch[lineId] ?? ''
    const typed = search.trim()
    const filteredProds = getFilteredProducts(search)
    const pick = (p: (typeof products)[number]) => {
      selectProductForDraftLine(lineId, p)
      setProductSearch(prev => ({ ...prev, [lineId]: '' }))
      setProductDropdownOpen(null)
    }
    const option = (p: (typeof products)[number]) => (
      <button key={p.id} type="button" className="picker-option w-full text-left px-3 py-2 hover:bg-[var(--sp-accent-soft)] transition-colors"
        onClick={() => pick(p)}>
        <p className="text-xs font-semibold text-[var(--sp-text)]">{p.name}</p>
        <p className="text-[10px] text-[var(--sp-text-3)]">{p.category} · {salesKes(p.salePrice)} · {p.stockQty > 0 ? `${p.stockQty} in stock` : 'out of stock'}</p>
      </button>
    )
    const close = filteredProds.length === 0 && typed ? similarProducts(products, typed) : []
    return (
      <>
        <div className={inSheet ? 'picker-search' : 'p-2 border-b border-[var(--sp-border)]'}>
          <input
            autoFocus={!inSheet}
            data-sheet-autofocus
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search products"
            placeholder={inSheet ? 'Search name or SKU' : 'Search products…'}
            className="w-full"
            value={search}
            onChange={e => setProductSearch(prev => ({ ...prev, [lineId]: e.target.value }))}
          />
        </div>
        <div className={inSheet ? 'picker-list' : 'max-h-48 overflow-y-auto'}>
          {filteredProds.length === 0 ? (
            <>
              <p className="picker-note px-3 py-2 text-xs text-[var(--sp-text-3)]">
                {typed ? `No product named “${typed}”.` : 'No products found'}
                {close.length > 0 ? ' Did you mean:' : ''}
              </p>
              {close.map(option)}
              {typed && !canCreateProduct && (
                <p className="picker-note px-3 py-2 text-[10px] text-[var(--sp-text-3)]">Not in the catalogue — ask Inventory or an admin to add it.</p>
              )}
            </>
          ) : filteredProds.map(option)}
        </div>
        {canCreateProduct && typed && !hasExactProduct(products, search) && (
          <button type="button" className="picker-create w-full text-left px-3 py-2 text-xs font-semibold border-t border-[var(--sp-border)] hover:bg-[var(--sp-accent-soft)]"
            style={{ color: 'var(--navy)' }}
            onClick={() => { setQuickProduct({ lineId, name: typed }); setProductDropdownOpen(null) }}>
            + Create product “{typed}”
          </button>
        )}
      </>
    )
  }
  // Create a product from the quote line (roles that may create products).
  const { users: appUsers, currentUserId: appUserId } = useApp()
  const canCreateProduct = canCreateProductFromSales(appUsers.find(u => u.id === appUserId)?.role)
  const [quickProduct, setQuickProduct] = useState<{ lineId: string; name: string } | null>(null)

  return (
    <div>
      {quickProduct && (
        // The same product form as Inventory; the new product goes on this line.
        <ProductFormModal
          start={{ mode: 'new', name: quickProduct.name }}
          onClose={() => setQuickProduct(null)}
          onSaved={p => { selectProductForDraftLine(quickProduct.lineId, p); setProductSearch(prev => ({ ...prev, [quickProduct.lineId]: '' })) }}
        />
      )}
      <div className="sales-proto-page-header">
        <div className="sales-proto-header-copy">
          <button type="button" className="sp-btn sp-btn-ghost sales-back-button" aria-label="Back to quotations" onClick={onCancel}>
            <span className="sales-back-button__icon" aria-hidden="true">←</span>
            <span className="sales-back-button__label">Back</span>
          </button>
          <div className="sp-ref-row">
            <div className="sales-record-title-block">
              <h1>Quotation</h1>
              <span className="sales-record-ref">New</span>
            </div>
          </div>
          <div className="sub">Customer · lines · terms · send</div>
        </div>
        <div className="sales-proto-actions sales-proto-actions--dock sales-create-actions">
          <MoreActionsMenu
            className="sales-action-more"
            items={[
              { label: 'Save as draft', icon: faSave, disabled: !canSave, onClick: onSaveDraft },
              { label: 'Discard', icon: faXmark, onClick: onCancel },
            ]}
          />
          <button type="button" className="sp-btn sp-btn-primary sales-action-primary" onClick={onSave} disabled={!canSave}>Submit</button>
        </div>
      </div>

      <div className={`sp-panel sp-panel-pad sales-order-meta-panel sales-order-meta-panel--new sales-order-meta-panel--unified ${showAllMeta ? 'is-expanded' : ''}`}>
        <div className="sales-order-unified-heading">
          <strong>Quotation</strong>
          <span>Who this quotation is for, with dates, terms and ownership</span>
        </div>
        <div className="sp-grid-2 sales-order-meta-grid">
          <div className="sales-order-meta-column sales-order-meta-column--customer">
            <SalesDocField label="Customer">
              <div className="relative" ref={customerRef}>
                <div
                  id="quote-customer"
                  tabIndex={0}
                  role="button"
                  aria-haspopup="listbox"
                  aria-expanded={customerDropdownOpen}
                  className={`cursor-pointer flex items-center justify-between ${!newCustomer ? 'text-[var(--sp-text-3)]' : ''}`}
                  style={{ border: '1px solid var(--sp-border-strong)', borderRadius: 4, padding: '5px 8px', fontSize: 12.5, background: '#fff', minHeight: 30, lineHeight: 1.25 }}
                  onClick={() => setCustomerDropdownOpen(v => !v)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCustomerDropdownOpen(v => !v) }
                    else if (e.key === 'Escape' && customerDropdownOpen) setCustomerDropdownOpen(false)
                  }}
                >
                  <span className="truncate">{newCustomer ? newCustomer.name : 'Search customer…'}</span>
                  <Fa icon={faChevronDown} className={`text-[10px] flex-shrink-0 transition-transform ${customerDropdownOpen ? 'rotate-180' : ''}`} />
                </div>
                {customerDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 z-[9300] mt-1 bg-white border border-[var(--sp-border)] rounded-[6px] shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-[var(--sp-border)]">
                      <input autoFocus type="text" aria-label="Search customers by name or email" placeholder="Search by name or email…" className="w-full" style={{ border: '1px solid var(--sp-border-strong)', borderRadius: 4, padding: '6px 8px', fontSize: 12.5 }} value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {filteredCustomers.length === 0 ? (
                        <div className="px-3 py-2">
                          <p className="text-[12px] text-[var(--sp-text-3)] mb-2">No customers found</p>
                          <button className="text-[12px] text-[var(--sp-accent)] font-semibold hover:underline" onClick={() => { setCustomerDropdownOpen(false); onCreateNewCustomer(customerSearch) }}>+ Create new contact</button>
                        </div>
                      ) : (
                        filteredCustomers.map(c => (
                          <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-[var(--sp-accent-soft)] transition-colors" onClick={() => { setNewCustomer({ id: c.id, name: c.name }); setCustomerDropdownOpen(false); setCustomerSearch('') }}>
                            <p className="text-[12.5px] font-semibold text-[var(--sp-text)]">{c.name}</p>
                            <p className="text-[11px] text-[var(--sp-text-3)]">{c.email || c.phone || 'No contact info'}</p>
                          </button>
                        ))
                      )}
                    </div>
                    {filteredCustomers.length > 0 && (
                      <div className="p-2 border-t border-[var(--sp-border)]">
                        <button className="text-[12px] text-[var(--sp-accent)] font-semibold hover:underline" onClick={() => { setCustomerDropdownOpen(false); onCreateNewCustomer(customerSearch) }}>+ Create new contact</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SalesDocField>
            {fieldErrors?.customer && (
              <p role="alert" className="text-[11px] text-[var(--sp-danger)] font-semibold" style={{ marginTop: -4, marginBottom: 8 }}>{fieldErrors.customer}</p>
            )}
            {/* The customer's details under the picker, instead of three rows of
                dashes before anyone is chosen. */}
            <SalesDocField label="Contact details">
              {selectedCustomer ? (
                <div className="sales-new-contact">
                  {selectedCustomer.email ? <span>{selectedCustomer.email}</span> : <em>No email on file</em>}
                  {(selectedCustomer.phone || selectedCustomer.mobile) ? <span>{selectedCustomer.phone || selectedCustomer.mobile}</span> : <em>No phone on file</em>}
                </div>
              ) : (
                <p className="sales-new-contact sales-new-contact--empty">Shown once you pick a customer</p>
              )}
            </SalesDocField>
          </div>

          <div className="sales-order-meta-column sales-order-meta-column--commercial">
            <SalesDocField label="Quotation date" htmlFor="quote-date" secondary>
              <span id="quote-date" className="sales-new-static">{fmtDate(new Date().toISOString().slice(0, 10))}</span>
            </SalesDocField>
            <SalesDocField label="Valid until">
              <div className="sales-valid-until">
                <input
                  id="quote-valid-until"
                  type="date"
                  aria-label="Valid until"
                  value={newValidUntil || ''}
                  onChange={e => setNewValidUntil(e.target.value)}
                  aria-describedby={fieldErrors?.validUntil ? 'quote-valid-until-error' : undefined}
                  aria-invalid={fieldErrors?.validUntil ? true : undefined}
                />
                <div className="sales-valid-until__quick" role="group" aria-label="Valid for">
                  {[30, 60, 90].map(days => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => {
                        const d = new Date()
                        d.setDate(d.getDate() + days)
                        setNewValidUntil(d.toISOString().slice(0, 10))
                      }}
                    >
                      {days}d
                    </button>
                  ))}
                </div>
              </div>
              {fieldErrors?.validUntil && (
                <p id="quote-valid-until-error" role="alert" className="text-[11px] text-[var(--sp-danger)] font-semibold mt-1">
                  {fieldErrors.validUntil}
                </p>
              )}
            </SalesDocField>
            <SalesDocField label="Expected delivery" htmlFor="quote-delivery-date" secondary>
              <input
                id="quote-delivery-date"
                type="date"
                aria-label="Expected delivery"
                value={newDeliveryDate || ''}
                onChange={e => setNewDeliveryDate(e.target.value)}
              />
            </SalesDocField>
            <SalesDocField label="Payment terms" htmlFor="quote-payment-terms">
              <span id="quote-payment-terms" className="sales-new-static" aria-label="Payment terms, assigned from customer">
                {quotationPaymentTermsLabel(paymentTermsDays)}
                <small>from the customer</small>
              </span>
            </SalesDocField>
            <div className="sales-secondary-group" style={{ display: 'contents' }}>
              <SalespersonCloserField
                valueId={newSalespersonId}
                valueName={newSalespersonName}
                createdByName={createdByName}
                onChange={setNewSalesperson}
              />
            </div>
            {salesPricelistsEnabled && availablePricelists.filter(l => l.isActive).length > 1 && (
              <SalesDocField label="Pricelist" htmlFor="quote-pricelist" secondary>
                <select
                  id="quote-pricelist"
                  value={newPricelist}
                  onChange={e => setNewPricelist(e.target.value)}
                  aria-label="Pricelist — determines the catalogue price lines use"
                >
                  <option value="" disabled>Select pricelist…</option>
                  {pricelistSelectOptions(availablePricelists).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </SalesDocField>
            )}
          </div>
        </div>
        <MetaDetailsToggle expanded={showAllMeta} onToggle={() => setShowAllMeta(v => !v)} />
      </div>

      <div className="sp-panel sales-order-lines-panel" style={{ marginTop: 10 }}>
        <SalesDocTabs
          className="sales-order-section-tabs"
          tabs={['Order Lines', 'Optional Products', 'Notes', 'Terms and Conditions', 'Attachments']}
          active={createTab}
          onChange={setCreateTab}
        />

        {createTab === 'Order Lines' && (
          <>
            <div className="sp-table-wrap" id="quote-lines" tabIndex={-1}>
              {fieldErrors?.lines && (
                <p id="quote-lines-error" role="alert" className="px-4 pt-3 text-[10px] text-destructive font-semibold">
                  {fieldErrors.lines}
                </p>
              )}
              <table className="sp-table sp-line-table sp-line-table--edit" data-no-responsive>
                <thead>
                  <tr>
                    <th data-col="index">#</th>
                    <th data-col="product">Product</th>
                    <th data-col="description">Description</th>
                    <th className="num" data-col="qty">Qty</th>
                    <th data-col="unit">Unit</th>
                    <th className="num" data-col="price">Unit price</th>
                    <th data-col="tax">Taxes</th>
                    <th className="num" data-col="amount">Amount</th>
                    <th data-col="actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {newDraftLines.map((line, lineIndex) => {
                    const isOpen = productDropdownOpen?.id === line.id
                    const hasInvalidQty = !!line.productId && Number(line.qty) <= 0
                    const moveButtons = (
                      <>
                        <button type="button" onClick={() => moveDraftLine(line.id, -1)} disabled={lineIndex === 0} aria-label="Move line up"
                          className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed">
                          <Fa icon={faArrowUp} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => moveDraftLine(line.id, 1)} disabled={lineIndex === newDraftLines.length - 1} aria-label="Move line down"
                          className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed">
                          <Fa icon={faArrowDown} aria-hidden="true" />
                        </button>
                      </>
                    )
                    if (line.type === 'section') {
                      return (
                        <tr key={line.id}>
                          <td className="num" data-col="index">{lineIndex + 1}</td>
                          <td colSpan={6} data-col="product">
                            <input
                              aria-label="Quote section title"
                              className="w-full font-bold"
                              placeholder="Section title, e.g. Hardware, Services, Accessories"
                              value={line.description}
                              onChange={e => updateDraftLine(line.id, 'description', e.target.value)}
                            />
                          </td>
                          <td className="num text-[10px] font-bold text-[var(--sp-text-3)]" data-col="index">Section</td>
                          <td data-col="actions">
                            <div className="flex items-center justify-end gap-0.5">
                              {moveButtons}
                              <button type="button" onClick={() => removeDraftLine(line.id)} aria-label="Remove section" className="row-action-btn btn-danger"><Fa icon={faTrash} aria-hidden="true" /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    }
                    return (
                      <tr key={line.id} className={hasInvalidQty ? 'bg-red-50/60' : undefined}>
                        <td className="num" data-col="index">{lineIndex + 1}</td>
                        <td data-col="product">
                          <div
                            className="flex items-center gap-1 cursor-pointer min-w-[140px]"
                            style={{ border: '1px solid var(--sp-border-strong)', borderRadius: 4, padding: '4px 6px', background: '#fff', fontSize: 12 }}
                            tabIndex={0}
                            role="button"
                            aria-haspopup="listbox"
                            aria-expanded={isOpen}
                            aria-label={line.productName ? `Product: ${line.productName}` : 'Select product'}
                            onClick={e => (isOpen ? setProductDropdownOpen(null) : openProductDropdown(line.id, e.currentTarget))}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                isOpen ? setProductDropdownOpen(null) : openProductDropdown(line.id, e.currentTarget)
                              } else if (e.key === 'Escape' && isOpen) {
                                setProductDropdownOpen(null)
                              }
                            }}
                          >
                            <span className="flex-1 truncate min-w-0" title={line.productName || undefined}>{line.productName || <span className="text-[var(--sp-text-3)]">Select product…</span>}</span>
                            <Fa icon={faChevronDown} className={`text-[9px] text-[var(--sp-text-3)] flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </div>
                          {isOpen && productDropdownOpen && !compactPicker && (
                            <div
                              ref={dropdownRef}
                              className="fixed z-[9500] w-72 bg-white border border-[var(--sp-border)] rounded-[6px] shadow-lg overflow-hidden"
                              style={{
                                left: productDropdownOpen.left,
                                ...(productDropdownOpen.openUp
                                  ? { bottom: window.innerHeight - productDropdownOpen.top }
                                  : { top: productDropdownOpen.top }),
                              }}
                            >
                              {renderProductPickerBody(line.id, false)}
                            </div>
                          )}
                        </td>
                        <td data-col="description">
                          <input type="text" aria-label="Line item description" className="w-full" placeholder="Description…" value={line.description} onChange={e => updateDraftLine(line.id, 'description', e.target.value)} />
                        </td>
                        <td className="num" data-col="qty">
                          <input type="number" aria-label="Line item quantity" min={1} className="text-center w-16" value={line.qty} onChange={e => updateDraftLine(line.id, 'qty', e.target.value)} />
                          {hasInvalidQty && <p className="text-[9px] text-red-600 font-semibold mt-1">Qty &gt; 0</p>}
                        </td>
                        <td data-col="unit">Unit(s)</td>
                        <td className="num" data-col="price">
                          <input
                            type="number"
                            aria-label="Line item unit price"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className="text-right w-28"
                            value={line.unitPrice}
                            onChange={e => updateDraftLine(line.id, 'unitPrice', e.target.value)}
                            onFocus={e => e.currentTarget.select()}
                          />
                        </td>
                        <td data-col="tax">
                          <select aria-label="Line item tax rate" className="w-20" value={line.taxRate} onChange={e => updateDraftLine(line.id, 'taxRate', e.target.value)}>
                            <option value="" disabled>Select…</option>
                            <option value="0">0%</option>
                            <option value={String(companySettings.vatRate)}>{companySettings.vatRate}%</option>
                          </select>
                        </td>
                        <td className="num font-bold" data-col="amount">{salesKes(calcDraftLineTotal(line))}</td>
                        <td data-col="actions">
                          <div className="flex items-center justify-end gap-0.5">
                            {moveButtons}
                            <button type="button" onClick={() => removeDraftLine(line.id)} aria-label="Remove line" className="row-action-btn btn-danger"><Fa icon={faTrash} aria-hidden="true" /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {newDraftLines.length === 0 && (
                    <tr><td colSpan={9} className="text-center text-[var(--sp-text-3)]" style={{ padding: '16px 10px', fontSize: 12 }}>No products added yet. Click &quot;Add a line&quot; below.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {compactPicker && (
              <PickerSheet
                open={!!productDropdownOpen}
                onClose={closeProductDropdown}
                title="Choose product"
                panelRef={dropdownRef}
              >
                {productDropdownOpen ? renderProductPickerBody(productDropdownOpen.id, true) : null}
              </PickerSheet>
            )}
            <div className="sp-line-actions">
              <button type="button" onClick={addDraftLine}>Add a line</button>
              <button type="button" onClick={addDraftSection}>Add a section</button>
              <button type="button" onClick={() => setCreateTab('Notes')}>Add a note</button>
            </div>
            <SalesDocTotals
              sticky
              rows={[
                { label: 'Untaxed amount', value: salesKes(draftSubtotal) },
                { label: 'Taxes', value: salesKes(draftTaxTotal) },
                {
                  label: 'Total',
                  value: salesKes(draftTotal),
                  grand: true,
                },
                { label: 'Currency', value: 'KES' },
              ]}
            />
          </>
        )}

        {createTab === 'Optional Products' && (
          <div className="sp-panel-pad flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold text-[var(--sp-text)]">Alternative products</p>
              <p className="mt-1 text-[11px] text-[var(--sp-text-3)]">Offer alternatives without including them in the quotation total.</p>
            </div>
            <select
              aria-label="Add an optional product"
              className="form-input text-xs"
              value=""
              onChange={event => {
                const product = products.find(item => item.id === event.target.value)
                if (!product || newOptionalProducts.some(item => item.productId === product.id)) return
                setNewOptionalProducts([...newOptionalProducts, {
                  id: uid(),
                  productId: product.id,
                  productName: product.name,
                  qty: '',
                  unitPrice: Number(product.salePrice) || 0,
                }])
              }}
            >
              <option value="">Add an optional product…</option>
              {products.filter(product => !newOptionalProducts.some(item => item.productId === product.id)).map(product => (
                <option key={product.id} value={product.id}>{product.name} · {salesKes(product.salePrice)}</option>
              ))}
            </select>
            {newOptionalProducts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--sp-border)] p-5 text-center text-xs text-[var(--sp-text-3)]">No optional products added.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {newOptionalProducts.map(item => (
                  <div key={item.id} className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--sp-border)] p-3 sm:grid-cols-[minmax(0,1fr)_90px_140px_auto] sm:items-center">
                    <strong className="truncate text-xs text-[var(--sp-text)]">{item.productName}</strong>
                    <input aria-label={`Quantity for ${item.productName}`} type="number" min={1} placeholder="Qty" value={item.qty} onChange={event => setNewOptionalProducts(newOptionalProducts.map(row => row.id === item.id ? { ...row, qty: event.target.value === '' ? '' : Math.max(0, Number(event.target.value) || 0) } : row))} />
                    <input aria-label={`Price for ${item.productName}`} type="number" min={0} value={item.unitPrice} onChange={event => setNewOptionalProducts(newOptionalProducts.map(row => row.id === item.id ? { ...row, unitPrice: Math.max(0, Number(event.target.value) || 0) } : row))} />
                    <button type="button" className="btn-outline" onClick={() => setNewOptionalProducts(newOptionalProducts.filter(row => row.id !== item.id))}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {createTab === 'Notes' && (
          <div className="sp-panel-pad flex flex-col gap-4">
            <SalesDocField label="Notes" htmlFor="quote-notes">
              <textarea
                id="quote-notes"
                aria-label="Notes and payment terms"
                rows={5}
                placeholder="Payment terms, warranty conditions, special instructions…"
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
              />
            </SalesDocField>
            <PaymentDetailsPicker
              value={newPaymentDetails}
              onChange={setNewPaymentDetails}
              bankAccounts={bankAccounts}
              isVat={newDraftLines.some(l => Number(l.taxRate) > 0)}
            />
          </div>
        )}

        {createTab === 'Terms and Conditions' && (
          <div className="sp-panel-pad">
            <SalesDocField label="Commercial terms" htmlFor="quote-terms">
              <textarea
                id="quote-terms"
                rows={8}
                value={newTermsAndConditions}
                onChange={event => setNewTermsAndConditions(event.target.value)}
                placeholder="Payment schedule, delivery obligations, warranty, validity, exclusions and acceptance conditions…"
              />
            </SalesDocField>
            <p className="mt-2 text-[11px] text-[var(--sp-text-3)]">These terms are saved with the quotation and remain available after confirmation.</p>
          </div>
        )}

        {createTab === 'Attachments' && (
          <div className="sp-panel-pad flex flex-col gap-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--sp-border-strong)] bg-[var(--sp-soft)] px-4 py-7 text-center">
              <span className="text-xs font-semibold text-[var(--sp-text)]">Choose supporting files</span>
              <span className="mt-1 text-[11px] text-[var(--sp-text-3)]">Files upload after the quotation is saved and receives a reference.</span>
              <input type="file" multiple className="sr-only" onChange={event => {
                const selected = Array.from(event.target.files ?? [])
                setNewQuoteAttachments([...newQuoteAttachments, ...selected.filter(file => !newQuoteAttachments.some(existing => existing.name === file.name && existing.size === file.size))])
                event.currentTarget.value = ''
              }} />
            </label>
            {newQuoteAttachments.length === 0 ? (
              <p className="text-center text-xs text-[var(--sp-text-3)]">No files selected.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {newQuoteAttachments.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--sp-border)] px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[var(--sp-text)]">{file.name}</p>
                      <p className="text-[10px] text-[var(--sp-text-3)]">{(file.size / 1024).toFixed(file.size >= 1024 * 1024 ? 0 : 1)} KB</p>
                    </div>
                    <button type="button" className="btn-outline" onClick={() => setNewQuoteAttachments(newQuoteAttachments.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {saveBlockedReason && <p className="text-[10px] text-amber-600 font-semibold px-1">{saveBlockedReason}</p>}
    </div>
  )
}
