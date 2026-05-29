'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useApp, QuoteStatus, fmtKes, fmtDate } from '@/lib/store'
import { Badge, Confirm, Modal, Field, Input, Select, Textarea, StatCard, PanelHeader, ModuleSkeleton } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faClipboardCheck, faMoneyBillWave, faCircleCheck, faArrowTrendUp, faChartBar, faClock } from '@fortawesome/free-solid-svg-icons'

type Tab = 'quotes' | 'pipeline' | 'analytics'

export default function SalesEnhanced() {
  return (
    <Suspense fallback={
      <ModuleSkeleton />
    }>
      <SalesEnhancedContent />
    </Suspense>
  )
}

function SalesEnhancedContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const {
    quotes, opportunities, companies, contactPersons, products, saleOrders, users, currentUserId,
    createQuote, updateQuote, addQuoteLine, removeQuoteLine,
    sendQuote, acceptQuote, rejectQuote, convertQuoteToSaleOrder, convertRepairQuoteToSOAndInvoice,
    reviseQuote, deleteQuote,
    showToast,
  } = useApp()

  const defaultTab: Tab = 'quotes'
  const queryTab = searchParams.get('tab') as Tab | null
  const initialTab = queryTab ?? defaultTab

  const [tab, setLocalTab] = useState<Tab>(initialTab)

  const setTab = (newTab: Tab) => {
    setLocalTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlTab = searchParams.get('tab') as Tab | null
    if (urlTab && urlTab !== tab) {
      setLocalTab(urlTab)
    }
  }, [searchParams, tab])

  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null)
  const [showNewQuoteModal, setShowNewQuoteModal] = useState(false)
  const [quoteSearch, setQuoteSearch] = useState('')
  const [quoteStatusFilter, setQuoteStatusFilter] = useState('all')
  const [showAddLineModal, setShowAddLineModal] = useState(false)

  const [quoteForm, setQuoteForm] = useState({
    opportunityId: '',
    opportunityName: '',
    companyId: '',
    companyName: '',
    contactPersonId: '',
    contactPersonName: '',
    validDays: '14',
    paymentTerms: '30 days from invoice date',
    deliveryTerms: '',
    warranty: '12 months manufacturer warranty',
    notes: '',
    internalNotes: '',
  })

  const [lineForm, setLineForm] = useState({
    productId: '',
    qty: '1',
    customPrice: '',
    discount: '0',
    notes: '',
  })
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)

  const currentUser = users.find(u => u.id === currentUserId)
  const activeQuote = quotes.find(q => q.id === activeQuoteId)

  // Analytics
  const totalQuoted = quotes.reduce((sum, q) => sum + q.total, 0)
  const acceptedQuotes = quotes.filter(q => q.status === 'accepted')
  const acceptedValue = acceptedQuotes.reduce((sum, q) => sum + q.total, 0)
  const conversionRate = quotes.length > 0 
    ? Math.round((acceptedQuotes.length / quotes.length) * 100)
    : 0

  const stats = {
    totalQuotes: quotes.length,
    quoted: totalQuoted,
    accepted: acceptedValue,
    conversionRate,
    avgQuoteValue: quotes.length > 0 ? totalQuoted / quotes.length : 0,
  }

  const filteredQuotes = quotes.filter(q => {
    const qs = quoteSearch.toLowerCase()
    return (quoteStatusFilter === 'all' || q.status === quoteStatusFilter) &&
      (!qs || q.ref.toLowerCase().includes(qs) || q.companyName.toLowerCase().includes(qs) ||
        q.contactPersonName.toLowerCase().includes(qs) || q.opportunityName.toLowerCase().includes(qs))
  })

  const handleCreateQuote = () => {
    if (!quoteForm.opportunityId || !quoteForm.companyId || !quoteForm.contactPersonId) {
      showToast('Opportunity, company, and contact are required', 'error')
      return
    }

    if (!currentUser) return

    const quote = createQuote({
      opportunityId: quoteForm.opportunityId,
      opportunityName: quoteForm.opportunityName,
      companyId: quoteForm.companyId,
      companyName: quoteForm.companyName,
      contactPersonId: quoteForm.contactPersonId,
      contactPersonName: quoteForm.contactPersonName,
      ownerId: currentUserId!,
      ownerName: currentUser.name,
      status: 'draft',
      validUntil: new Date(Date.now() + Number(quoteForm.validDays) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      paymentTerms: quoteForm.paymentTerms,
      deliveryTerms: quoteForm.deliveryTerms,
      warranty: quoteForm.warranty,
      lines: [],
      subtotal: 0,
      discountAmount: 0,
      discountPercent: 0,
      taxTotal: 0,
      total: 0,
      notes: quoteForm.notes,
      internalNotes: quoteForm.internalNotes,
    })

    setShowNewQuoteModal(false)
    setQuoteForm({
      opportunityId: '',
      opportunityName: '',
      companyId: '',
      companyName: '',
      contactPersonId: '',
      contactPersonName: '',
      validDays: '14',
      paymentTerms: '30 days from invoice date',
      deliveryTerms: '',
      warranty: '12 months manufacturer warranty',
      notes: '',
      internalNotes: '',
    })
    setActiveQuoteId(quote.id)
  }

  const handleAddLine = () => {
    if (!activeQuoteId || !lineForm.productId) {
      showToast('Select a product', 'error')
      return
    }

    const product = products.find(p => p.id === lineForm.productId)
    if (!product) return

    addQuoteLine(
      activeQuoteId,
      product,
      Number(lineForm.qty) || 1,
      Number(lineForm.discount) || 0,
      lineForm.customPrice ? Number(lineForm.customPrice) : undefined
    )

    setShowAddLineModal(false)
    setLineForm({
      productId: '',
      qty: '1',
      customPrice: '',
      discount: '0',
      notes: '',
    })
  }

  // Quotes Tab
  if (tab === 'quotes') {
    return (
      <div className="flex flex-col gap-3">
        {/* Stats */}
        <div className="stat-grid-4">
          <StatCard label="Total Quotes" value={stats.totalQuotes} sub="all time" color="#8B5CF6" icon={<Fa icon={faClipboardCheck} />} />
          <StatCard label="Quoted Value" value={fmtKes(stats.quoted)} sub="total quoted" color="#2E90FA" icon={<Fa icon={faMoneyBillWave} />} />
          <StatCard label="Accepted" value={fmtKes(stats.accepted)} sub="won quotes" color="#12B76A" icon={<Fa icon={faCircleCheck} />} />
          <StatCard label="Conversion" value={`${stats.conversionRate}%`} sub="acceptance rate" color="#fec84b" icon={<Fa icon={faArrowTrendUp} />} />
          <StatCard label="Avg Quote" value={fmtKes(stats.avgQuoteValue)} sub="per quote" color="#6B7280" icon={<Fa icon={faChartBar} />} />
        </div>

        {/* Actions */}
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <button className="btn-primary text-[11px]" onClick={() => setShowNewQuoteModal(true)}>
              + New Quote
            </button>
            <div className="ml-auto flex gap-2">
              {['quotes', 'pipeline', 'analytics'].map(t => (
                <button
                  key={t}
                  className={`btn-${tab === t ? 'primary' : 'outline'} text-[11px]`}
                  onClick={() => setTab(t as Tab)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quote Detail View */}
        {activeQuoteId && activeQuote ? (
          <div className="flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center gap-3 flex-wrap">
              <button className="btn-outline text-[11px] py-1 px-2.5" onClick={() => setActiveQuoteId(null)}>
                ← Back to List
              </button>
              <span className="text-t3 text-xs">/</span>
              <span className="text-xs font-semibold">{activeQuote.ref}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>v{activeQuote.version}</span>
              <Badge status={activeQuote.status} label={activeQuote.status} />
              {activeQuote.source === 'repair' && (
                <span className="badge badge-purple text-[9px]">🔧 Repair Quote — {activeQuote.repairRef}</span>
              )}
            </div>

            {/* Quote Content */}
            <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
              <div className="flex flex-col gap-3">
                {/* Quote Info */}
                <div className="card p-4">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>
                        {activeQuote.source === 'repair' ? 'Customer' : 'Company'}
                      </div>
                      <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{activeQuote.companyName}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Contact</div>
                      <div style={{ color: 'var(--text-1)' }}>{activeQuote.contactPersonName}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>
                        {activeQuote.source === 'repair' ? 'Repair Order' : 'Opportunity'}
                      </div>
                      <div style={{ color: activeQuote.source === 'repair' ? '#7C3AED' : 'var(--text-1)', fontWeight: activeQuote.source === 'repair' ? 700 : 400 }}>
                        {activeQuote.opportunityName}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Owner</div>
                      <div style={{ color: 'var(--text-1)' }}>{activeQuote.ownerName}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Issue Date</div>
                      <div style={{ color: 'var(--text-1)' }}>{fmtDate(activeQuote.issueDate)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Valid Until</div>
                      <div style={{ color: 'var(--text-1)' }}>{fmtDate(activeQuote.validUntil)}</div>
                    </div>
                    {activeQuote.saleOrderId && (
                      <div>
                        <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Sale Order</div>
                        <div style={{ color: '#10B981', fontWeight: 700 }}>
                          {saleOrders.find(s => s.id === activeQuote.saleOrderId)?.ref ?? '—'}
                        </div>
                      </div>
                    )}
                    {activeQuote.invoiceId && (
                      <div>
                        <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Invoice</div>
                        <div style={{ color: '#8B5CF6', fontWeight: 700 }}>
                          {activeQuote.invoiceId ? '✓ Created' : '—'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Line Items */}
                <div className="card overflow-hidden">
                  <PanelHeader title="Line Items" count={activeQuote.lines.length}>
                    {activeQuote.status === 'draft' && (
                      <button className="btn-primary text-[11px]" onClick={() => setShowAddLineModal(true)}>
                        + Add Item
                      </button>
                    )}
                  </PanelHeader>
                  {activeQuote.lines.length > 0 ? (
                    <div className="overflow-x-auto w-full">
                      <div className="min-w-[700px] flex flex-col">
                        <div className="table-head" style={{ gridTemplateColumns: '2fr 80px 120px 80px 120px 120px 30px' }}>
                          <span>Product</span>
                          <span>Qty</span>
                          <span>Unit Price</span>
                          <span>Disc%</span>
                          <span>Tax</span>
                          <span>Total</span>
                          <span></span>
                        </div>
                        {activeQuote.lines.map(line => (
                          <div key={line.id} className="table-row" style={{ gridTemplateColumns: '2fr 80px 120px 80px 120px 120px 30px' }}>
                            <div>
                              <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{line.productName}</div>
                              <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{line.sku}</div>
                            </div>
                            <span className="font-mono">{line.qty}</span>
                            <span className="font-mono">{fmtKes(line.unitPrice)}</span>
                            <span className="font-mono">{line.discount}%</span>
                            <span className="font-mono">{fmtKes(line.taxAmount)}</span>
                            <span className="font-mono font-semibold">{fmtKes(line.lineTotal)}</span>
                            <button
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F04438', fontSize: 14 }}
                              onClick={() => removeQuoteLine(activeQuoteId, line.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-xs text-t3">
                      No items yet. Click "Add Item" to start building the quote.
                    </div>
                  )}
                </div>

                {/* Terms */}
                <div className="card p-4">
                  <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 12, fontSize: 13 }}>
                    Terms & Conditions
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Payment Terms</div>
                      <div style={{ color: 'var(--text-1)' }}>{activeQuote.paymentTerms}</div>
                    </div>
                    {activeQuote.deliveryTerms && (
                      <div>
                        <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Delivery Terms</div>
                        <div style={{ color: 'var(--text-1)' }}>{activeQuote.deliveryTerms}</div>
                      </div>
                    )}
                    {activeQuote.warranty && (
                      <div>
                        <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Warranty</div>
                        <div style={{ color: 'var(--text-1)' }}>{activeQuote.warranty}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="flex flex-col gap-3">
                {/* Pricing Summary */}
                <div className="card p-4">
                  <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 12, fontSize: 13 }}>
                    Pricing Summary
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-3)' }}>Subtotal</span>
                      <span className="font-mono" style={{ color: 'var(--text-1)' }}>
                        {fmtKes(activeQuote.subtotal)}
                      </span>
                    </div>
                    {activeQuote.discountAmount > 0 && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-3)' }}>
                          Discount ({activeQuote.discountPercent}%)
                        </span>
                        <span className="font-mono" style={{ color: '#F79009' }}>
                          -{fmtKes(activeQuote.discountAmount)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-3)' }}>Tax (16%)</span>
                      <span className="font-mono" style={{ color: 'var(--text-1)' }}>
                        {fmtKes(activeQuote.taxTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-gray-100">
                      <span style={{ color: 'var(--text-1)', fontWeight: 700 }}>TOTAL</span>
                      <span className="font-mono font-bold" style={{ color: 'var(--text-1)', fontSize: 16 }}>
                        {fmtKes(activeQuote.total)}
                      </span>
                    </div>
                  </div>

                  {activeQuote.internalNotes && (
                    <div className="mt-3 p-2 rounded-lg text-[10px]" style={{ background: 'var(--bg-surface)', color: 'var(--text-3)' }}>
                      Internal: {activeQuote.internalNotes}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="card p-4">
                  <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 12, fontSize: 13 }}>
                    Quote Actions
                  </div>
                  <div className="space-y-2">
                    {activeQuote.status === 'draft' && activeQuote.lines.length > 0 && activeQuote.source !== 'repair' && (
                      <button className="btn-primary w-full text-[11px]" onClick={() => sendQuote(activeQuote.id)}>
                        Send to Customer
                      </button>
                    )}

                    {(activeQuote.status === 'sent' || activeQuote.status === 'viewed') && (
                      activeQuote.source === 'repair' ? (
                        <>
                          <button className="btn-primary w-full text-[11px]" onClick={() => {
                            const result = convertRepairQuoteToSOAndInvoice(activeQuote.id)
                            if (result) showToast(`${result.so.ref} & ${result.invoice.ref} created`, 'success')
                          }}>
                            ✓ Client Approved → Create SO & Invoice
                          </button>
                          <button
                            className="btn-outline w-full text-[11px]"
                            style={{ color: '#F04438' }}
                            onClick={() => {
                              const reason = prompt('Rejection reason:')
                              if (reason) rejectQuote(activeQuote.id, reason)
                            }}
                          >
                            Client Rejected
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn-primary w-full text-[11px]" onClick={() => acceptQuote(activeQuote.id)}>
                            Accept Quote
                          </button>
                          <button
                            className="btn-outline w-full text-[11px]"
                            style={{ color: '#F04438' }}
                            onClick={() => {
                              const reason = prompt('Rejection reason:')
                              if (reason) rejectQuote(activeQuote.id, reason)
                            }}
                          >
                            Reject Quote
                          </button>
                        </>
                      )
                    )}

                    {activeQuote.status === 'accepted' && !activeQuote.saleOrderId && activeQuote.source !== 'repair' && (
                      <button className="btn-primary w-full text-[11px]" onClick={() => {
                        const so = convertQuoteToSaleOrder(activeQuote.id)
                        if (so) showToast(`Sale Order ${so.ref} created`, 'success')
                      }}>
                        Convert to Sale Order
                      </button>
                    )}

                    {activeQuote.status === 'accepted' && activeQuote.source === 'repair' && activeQuote.saleOrderId && (
                      <div className="p-2 rounded-lg text-center text-[11px]" style={{ background: '#DCFCE7', color: '#059669' }}>
                        ✓ {saleOrders.find(s => s.id === activeQuote.saleOrderId)?.ref} & Invoice created
                      </div>
                    )}

                    {!['accepted', 'expired', 'revised'].includes(activeQuote.status) && activeQuote.source !== 'repair' && (
                      <button
                        className="btn-outline w-full text-[11px]"
                        onClick={() => {
                          const changes = prompt('Revision notes:')
                          if (changes) {
                            const newQuote = reviseQuote(activeQuote.id, changes)
                            setActiveQuoteId(newQuote.id)
                          }
                        }}
                      >
                        Revise Quote
                      </button>
                    )}

                    {activeQuote.status === 'draft' && activeQuote.source !== 'repair' && (
                      <button
                        className="btn-outline w-full text-[11px]"
                        style={{ color: '#F04438' }}
                        onClick={() => {
                          setPendingConfirm({ msg: 'Delete this quote?', action: () => { deleteQuote(activeQuote.id); setActiveQuoteId(null) } })
                        }}
                      >
                        Delete Quote
                      </button>
                    )}
                  </div>
                </div>

                {/* Tracking */}
                <div className="card p-4">
                  <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 12, fontSize: 13 }}>
                    Tracking
                  </div>
                  <div className="space-y-2 text-xs">
                    {activeQuote.sentDate && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-3)' }}>Sent</span>
                        <span style={{ color: 'var(--text-1)' }}>{fmtDate(activeQuote.sentDate)}</span>
                      </div>
                    )}
                    {activeQuote.viewCount > 0 && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-3)' }}>Views</span>
                        <span style={{ color: 'var(--text-1)' }}>{activeQuote.viewCount}×</span>
                      </div>
                    )}
                    {activeQuote.viewedDate && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-3)' }}>Last Viewed</span>
                        <span style={{ color: 'var(--text-1)' }}>{fmtDate(activeQuote.viewedDate)}</span>
                      </div>
                    )}
                    {activeQuote.acceptedDate && (
                      <div className="text-center p-2 rounded-lg mt-2" style={{ background: '#DCFCE7', color: '#10B981' }}>
                        ✓ Accepted on {fmtDate(activeQuote.acceptedDate)}
                      </div>
                    )}
                    {activeQuote.rejectedDate && (
                      <div className="p-2 rounded-lg mt-2" style={{ background: '#FEE2E2', color: '#EF4444' }}>
                        ✗ Rejected: {activeQuote.rejectionReason}
                      </div>
                    )}
                    {activeQuote.parentQuoteId && (
                      <div className="text-center p-2 rounded-lg mt-2" style={{ background: '#EDE9FE', color: '#8B5CF6' }}>
                        Revised from v{activeQuote.version - 1}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Add Line Modal */}
            {showAddLineModal && (
              <Modal title="Add Line Item" onClose={() => setShowAddLineModal(false)} width={520}>
                <Field label="Product" required>
                  <Select
                    value={lineForm.productId}
                    onChange={value => {
                      const product = products.find(p => p.id === value)
                      setLineForm(prev => ({ 
                        ...prev, 
                        productId: value,
                        customPrice: product ? String(product.salePrice) : '',
                      }))
                    }}
                    options={products.filter(p => p.canBeSold && p.isActive).map(p => ({
                      value: p.id,
                      label: `${p.name} (${fmtKes(p.salePrice)})`,
                    }))}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Quantity">
                    <Input
                      type="number"
                      value={lineForm.qty}
                      onChange={value => setLineForm(prev => ({ ...prev, qty: value }))}
                    />
                  </Field>
                  <Field label="Discount (%)">
                    <Input
                      type="number"
                      value={lineForm.discount}
                      onChange={value => setLineForm(prev => ({ ...prev, discount: value }))}
                    />
                  </Field>
                </div>
                <Field label="Custom Price (optional)" hint="Leave blank to use product price">
                  <Input
                    type="number"
                    value={lineForm.customPrice}
                    onChange={value => setLineForm(prev => ({ ...prev, customPrice: value }))}
                    placeholder="Override unit price"
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <button className="btn-outline" onClick={() => setShowAddLineModal(false)}>Cancel</button>
                  <button className="btn-primary" onClick={handleAddLine}>Add to Quote</button>
                </div>
              </Modal>
            )}
          </div>
        ) : (
          /* Quote List */
          <div className="card overflow-hidden">
            <PanelHeader title="All Quotes" count={filteredQuotes.length}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
                placeholder="Search ref, company…" value={quoteSearch} onChange={e => setQuoteSearch(e.target.value)} />
              <select className="form-select text-[11px] py-1.5" style={{ width: 120 }}
                value={quoteStatusFilter} onChange={e => setQuoteStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                {['draft','sent','accepted','rejected','expired','converted'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </PanelHeader>
            <div className="divide-y divide-gray-100">
              {filteredQuotes.map(quote => {
                const opp = opportunities.find(o => o.id === quote.opportunityId)
                const isExpired = new Date(quote.validUntil) < new Date() && quote.status === 'sent'

                return (
                  <div
                    key={quote.id}
                    className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setActiveQuoteId(quote.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                            {quote.ref}
                          </span>
                          <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>v{quote.version}</span>
                          <Badge status={isExpired ? 'expired' : quote.status} label={isExpired ? 'Expired' : quote.status} />
                          {quote.source === 'repair' && (
                            <span className="badge badge-purple text-[9px]">🔧 Repair</span>
                          )}
                        </div>
                        <div className="text-sm mb-1" style={{ color: 'var(--text-1)' }}>
                          {quote.companyName}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                          {quote.contactPersonName} · {quote.opportunityName}
                        </div>
                        <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                          Issued: {fmtDate(quote.issueDate)} · Valid: {fmtDate(quote.validUntil)}
                          {quote.viewCount > 0 && ` · ${quote.viewCount} views`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                          {fmtKes(quote.total)}
                        </div>
                        <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                          {quote.lines.length} items
                        </div>
                        {quote.discountPercent > 0 && (
                          <div className="text-[9px] mt-1" style={{ color: '#F79009' }}>
                            {quote.discountPercent}% discount
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* New Quote Modal */}
        {showNewQuoteModal && (
          <Modal title="Create Quote" onClose={() => setShowNewQuoteModal(false)} width={720}>
            <Field label="Opportunity" required>
              <Select
                value={quoteForm.opportunityId}
                onChange={value => {
                  const opp = opportunities.find(o => o.id === value)
                  if (opp) {
                    setQuoteForm(prev => ({
                      ...prev,
                      opportunityId: value,
                      opportunityName: opp.name,
                      companyId: opp.companyId,
                      companyName: opp.companyName,
                      contactPersonId: opp.contactPersonId,
                      contactPersonName: opp.contactPersonName,
                    }))
                  }
                }}
                options={opportunities
                  .filter(o => !['closed_won', 'closed_lost'].includes(o.stage))
                  .map(o => ({ value: o.id, label: `${o.ref} - ${o.name}` }))}
              />
            </Field>

            {quoteForm.companyId && (
              <>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs">
                  <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>
                    {quoteForm.companyName}
                  </div>
                  <div style={{ color: 'var(--text-3)' }}>
                    Contact: {quoteForm.contactPersonName}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valid for (days)">
                    <Input
                      type="number"
                      value={quoteForm.validDays}
                      onChange={value => setQuoteForm(prev => ({ ...prev, validDays: value }))}
                    />
                  </Field>
                </div>

                <Field label="Payment Terms">
                  <Input
                    value={quoteForm.paymentTerms}
                    onChange={value => setQuoteForm(prev => ({ ...prev, paymentTerms: value }))}
                  />
                </Field>

                <Field label="Delivery Terms">
                  <Input
                    value={quoteForm.deliveryTerms}
                    onChange={value => setQuoteForm(prev => ({ ...prev, deliveryTerms: value }))}
                    placeholder="Ex-works, delivery within X days, etc."
                  />
                </Field>

                <Field label="Warranty">
                  <Input
                    value={quoteForm.warranty}
                    onChange={value => setQuoteForm(prev => ({ ...prev, warranty: value }))}
                  />
                </Field>

                <Field label="Customer Notes">
                  <Textarea
                    value={quoteForm.notes}
                    onChange={value => setQuoteForm(prev => ({ ...prev, notes: value }))}
                    placeholder="Notes visible to customer..."
                  />
                </Field>

                <Field label="Internal Notes">
                  <Textarea
                    value={quoteForm.internalNotes}
                    onChange={value => setQuoteForm(prev => ({ ...prev, internalNotes: value }))}
                    placeholder="Internal notes (not visible to customer)"
                  />
                </Field>
              </>
            )}

            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setShowNewQuoteModal(false)}>Cancel</button>
              <button 
                className="btn-primary" 
                onClick={handleCreateQuote}
                disabled={!quoteForm.opportunityId}
              >
                Create Quote
              </button>
            </div>
          </Modal>
        )}
        {pendingConfirm && (
          <Confirm
            message={pendingConfirm.msg}
            onConfirm={() => { pendingConfirm.action(); setPendingConfirm(null) }}
            onCancel={() => setPendingConfirm(null)}
          />
        )}
      </div>
    )
  }

  // Pipeline Tab - Visual Analytics
  if (tab === 'pipeline') {
    const pipelineData = ['prospecting', 'qualification', 'proposal', 'negotiation'].map(stage => {
      const stageOpps = opportunities.filter(o => o.stage === stage)
      const value = stageOpps.reduce((sum, o) => sum + o.expectedValue, 0)
      const weighted = stageOpps.reduce((sum, o) => sum + (o.expectedValue * o.probability / 100), 0)

      return {
        stage,
        label: stage.charAt(0).toUpperCase() + stage.slice(1),
        count: stageOpps.length,
        value,
        weighted,
      }
    })

    return (
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="card p-4">
          <div className="flex gap-2">
            {['quotes', 'pipeline', 'analytics'].map(t => (
              <button
                key={t}
                className={`btn-${tab === t ? 'primary' : 'outline'} text-[11px]`}
                onClick={() => setTab(t as Tab)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Pipeline Forecast */}
        <div className="card p-4">
          <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 16, fontSize: 14 }}>
            Sales Pipeline Forecast
          </div>
          <div className="space-y-3">
            {pipelineData.map(item => (
              <div key={item.stage}>
                <div className="flex items-center justify-between mb-1 text-xs">
                  <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{item.label}</span>
                  <span style={{ color: 'var(--text-3)' }}>{item.count} deals</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 rounded-full bg-gray-100 h-2 overflow-hidden">
                    <div 
                      className="h-full rounded-full"
                      style={{ 
                        width: `${(item.weighted / stats.quoted) * 100}%`,
                        background: '#1B2762',
                      }}
                    />
                  </div>
                  <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text-1)', minWidth: 100, textAlign: 'right' }}>
                    {fmtKes(item.weighted)}
                  </span>
                </div>
                <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                  Total: {fmtKes(item.value)} · Weighted: {fmtKes(item.weighted)}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-6 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--text-1)', fontWeight: 700 }}>Total Forecast</span>
              <span className="font-mono font-bold" style={{ color: '#1B2762', fontSize: 16 }}>
                {fmtKes(pipelineData.reduce((sum, item) => sum + item.weighted, 0))}
              </span>
            </div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)', textAlign: 'right' }}>
              Best case: {fmtKes(pipelineData.reduce((sum, item) => sum + item.value, 0))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Analytics Tab
  if (tab === 'analytics') {
    const wonOpps = opportunities.filter(o => o.stage === 'closed_won')
    const lostOpps = opportunities.filter(o => o.stage === 'closed_lost')
    const totalClosed = wonOpps.length + lostOpps.length
    const wonValue = wonOpps.reduce((sum, o) => sum + o.actualValue, 0)
    const avgDealSize = wonOpps.length > 0 ? wonValue / wonOpps.length : 0

    // Deal cycle time
    const closedWithDates = opportunities.filter(o => 
      (o.stage === 'closed_won' || o.stage === 'closed_lost') && o.actualCloseDate
    )
    const avgCycle = closedWithDates.length > 0
      ? Math.round(closedWithDates.reduce((sum, o) => {
          const days = Math.round((new Date(o.actualCloseDate!).getTime() - new Date(o.createdDate).getTime()) / (1000 * 60 * 60 * 24))
          return sum + days
        }, 0) / closedWithDates.length)
      : 0

    return (
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="card p-4">
          <div className="flex gap-2">
            {['quotes', 'pipeline', 'analytics'].map(t => (
              <button
                key={t}
                className={`btn-${tab === t ? 'primary' : 'outline'} text-[11px]`}
                onClick={() => setTab(t as Tab)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="stat-grid-4">
          <StatCard label="Deals Closed" value={totalClosed} sub={`${wonOpps.length} won, ${lostOpps.length} lost`} color="#8B5CF6" icon={<Fa icon={faChartBar} />} />
          <StatCard label="Win Rate" value={`${stats.conversionRate}%`} sub="acceptance rate" color="#12B76A" icon={<Fa icon={faCircleCheck} />} />
          <StatCard label="Revenue Won" value={fmtKes(wonValue)} sub="actual value" color="#10B981" icon={<Fa icon={faMoneyBillWave} />} />
          <StatCard label="Avg Cycle" value={`${avgCycle}d`} sub="days to close" color="#2E90FA" icon={<Fa icon={faClock} />} />
        </div>

        {/* Loss Analysis */}
        <div className="card p-4">
          <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 16, fontSize: 14 }}>
            Loss Analysis
          </div>
          {lostOpps.length > 0 ? (
            <div className="space-y-2 text-xs">
              {Array.from(new Set(lostOpps.map(o => o.lostReason).filter(Boolean))).map(reason => {
                const count = lostOpps.filter(o => o.lostReason === reason).length
                return (
                  <div key={reason} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                    <span style={{ color: 'var(--text-1)' }}>{reason}</span>
                    <span className="badge badge-red text-[9px]">{count}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center text-xs py-4" style={{ color: 'var(--text-3)' }}>
              No lost opportunities yet
            </div>
          )}
        </div>

        {/* Competitors */}
        <div className="card p-4">
          <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 16, fontSize: 14 }}>
            Competitor Analysis
          </div>
          {lostOpps.filter(o => o.lostToCompetitor).length > 0 ? (
            <div className="space-y-2 text-xs">
              {Array.from(new Set(lostOpps.map(o => o.lostToCompetitor).filter(Boolean))).map(competitor => {
                const count = lostOpps.filter(o => o.lostToCompetitor === competitor).length
                return (
                  <div key={competitor} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                    <span style={{ color: 'var(--text-1)' }}>{competitor}</span>
                    <span className="badge badge-amber text-[9px]">{count} losses</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center text-xs py-4" style={{ color: 'var(--text-3)' }}>
              No competitor data yet
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}
