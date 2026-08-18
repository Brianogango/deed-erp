'use client'
import { useState, useRef, useEffect } from 'react'
import { useCommerceStore, useInventoryStore, fmtKes, fmtDate, isPosBankPayment } from '@/lib/store'
import { Modal, Field, Input, Select, Badge, ModuleSkeleton } from '@/components/ui'
import { PosTransactionHistory } from '@/components/pos/PosTransactionHistory'
import {
  Fa, faCashRegister, faReceipt, faCamera, faCartShopping, faStar,
  faCircleCheck, faPrint, faMobileScreenButton, faMoneyBillWave, faBuildingColumns,
  faStore, faBox, faMagnifyingGlass, faMinus, faPlus,
} from '@/components/icons'
import { BarcodeScannerModal } from '@/components/BarcodeScanner'
import { matchPosScan, normalizeScanCode } from '@/lib/barcode-scan'
import { isOrphanedPosSession, posOrdersForSession } from '@/lib/pos-session'
import { loyaltyPointsEarned } from '@/lib/loyalty'
import { resolvePosLineSerial } from '@/lib/pos-transaction-history'
import {
  darkenLogoForThermalPrint,
  receiptLogoSrc,
  resolvePosReceiptCustomer,
} from '@/lib/pos-receipt-print'

function ReceiptPrintView({
  order,
  companySettings,
  bankAccounts,
  serials = [],
  stockMoves = [],
  invoices = [],
  onDone,
}: {
  order: any
  companySettings: any
  bankAccounts?: { id: string; name: string }[]
  serials?: { id: string; serial?: string }[]
  stockMoves?: { documentRef?: string; productId?: string; serialNumbers?: string[] }[]
  invoices?: { id?: string; ref?: string; partnerName?: string; notes?: string }[]
  onDone: () => void
}) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null)
  const buyerName = resolvePosReceiptCustomer(order, invoices)

  useEffect(() => {
    let cancelled = false
    const candidate = receiptLogoSrc(companySettings?.logoUrl)
    void darkenLogoForThermalPrint(candidate).then(src => {
      if (!cancelled) setLogoSrc(src)
    })
    return () => { cancelled = true }
  }, [companySettings?.logoUrl])

  useEffect(() => {
    if (!logoSrc) return
    const handleAfterPrint = () => {
      onDone()
      window.removeEventListener('afterprint', handleAfterPrint)
    }
    window.addEventListener('afterprint', handleAfterPrint)
    const timer = setTimeout(() => window.print(), 250)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [logoSrc, onDone])

  return (
    <div
      className="print-receipt-container bg-white"
      style={{ fontFamily: 'monospace', fontSize: '12px', width: '300px', margin: '0 auto', padding: '16px', color: 'var(--text-1)' }}
    >
      <div className="text-center pb-4 mb-4" style={{ borderBottom: '1px dashed var(--border)' }}>
        {logoSrc ? (
          <img
            src={logoSrc}
            className="print-receipt-logo"
            style={{
              display: 'block',
              maxHeight: 210,
              maxWidth: '100%',
              width: 'auto',
              height: 'auto',
              margin: '0 auto 10px',
              objectFit: 'contain',
            }}
            alt="Logo"
          />
        ) : null}
        <h2 className="font-bold text-sm mb-1">{companySettings.name}</h2>
        <p>{companySettings.address}, {companySettings.city}</p>
        <p>Tel: {companySettings.phone}</p>
        {companySettings.kraPin && <p>PIN: {companySettings.kraPin}</p>}
      </div>
      <div className="flex justify-between mb-4">
        <div>
          <p>Receipt: <strong>{order.ref}</strong></p>
          <p>Cashier: {order.createdByName || 'System'}</p>
          <p>Customer: {buyerName}</p>
        </div>
        <div className="text-right">
          <p>Date: {fmtDate(order.date)}</p>
          <p>Time: {order.createdAt ? new Date(order.createdAt).toLocaleTimeString('en-KE', {hour: '2-digit', minute: '2-digit'}) : '--:--'}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 mb-4">
        <div className="flex justify-between font-bold pb-1 mb-1" style={{ borderBottom: '1px solid var(--border-lt)' }}>
          <span>Item</span>
          <span>Total</span>
        </div>
        {order.lines.map((l: any, i: number) => {
          const serial = resolvePosLineSerial(l, serials, stockMoves, order.ref)
          return (
            <div key={i} className="flex justify-between">
              <span>
                {l.productName}
                <br />
                <span className="text-[10px] text-t3">{l.qty} × {fmtKes(l.price)}</span>
                {serial ? (
                  <>
                    <br />
                    <span className="text-[10px] font-mono">SN: {serial}</span>
                  </>
                ) : null}
              </span>
              <span className="font-semibold">{fmtKes(l.subtotal)}</span>
            </div>
          )
        })}
      </div>
      <div className="pt-2 mb-4" style={{ borderTop: '1px dashed var(--border)' }}>
        <div className="flex justify-between mb-1"><span>Subtotal</span><span>{fmtKes(order.subtotal)}</span></div>
        {order.taxTotal > 0 && <div className="flex justify-between mb-1"><span>VAT</span><span>{fmtKes(order.taxTotal)}</span></div>}
        {order.pointsRedeemed ? (<div className="flex justify-between mb-1" style={{ color: 'var(--danger)' }}><span>Points Redeemed</span><span>-{fmtKes(order.pointsRedeemed)}</span></div>) : null}
        <div className="flex justify-between font-bold text-sm pt-2 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <span>FINAL TOTAL</span><span>{fmtKes(order.total)}</span>
        </div>
        <div className="flex justify-between mt-1 font-bold">
          <span>Amount Paid</span><span>{fmtKes(order.total)}</span>
        </div>
        <div className="flex justify-between mt-2">
          <span>Payment Mode</span>
          <span className="uppercase">{isPosBankPayment(order.payment) ? 'bank' : order.payment}</span>
        </div>
        {order.bankAccountId ? (
          <div className="flex justify-between mt-1 text-[11px]">
            <span>Bank</span>
            <span>{bankAccounts?.find(b => b.id === order.bankAccountId)?.name || order.bankAccountId}</span>
          </div>
        ) : null}
        {order.paymentReference ? (
          <div className="flex justify-between mt-1 text-[11px]">
            <span>Reference</span><span>{order.paymentReference}</span>
          </div>
        ) : null}
      </div>
      <div className="text-center pt-4" style={{ borderTop: '1px dashed var(--border)' }}>
        {order.pointsEarned ? (
          <p className="font-semibold mb-2">+{order.pointsEarned} Loyalty Points Earned!</p>
        ) : null}
        <p>{companySettings.invoiceFooter || 'Thank you for your business!'}</p>
      </div>
      <div className="no-print-area text-center mt-6">
        <p className="text-xs text-t3">Printing receipt...</p>
        <button className="btn-outline mt-2" onClick={onDone}>Cancel / Done</button>
      </div>
      <style>{`
        @media print {
          /* visibility (not display:none) so ancestors in the app shell do not
             blank the receipt — display:none on parents hides children forever. */
          @page {
            size: 80mm auto;
            margin: 0;
          }
          html, body {
            width: 80mm !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          body * {
            visibility: hidden !important;
          }
          .print-receipt-container,
          .print-receipt-container * {
            visibility: visible !important;
          }
          .print-receipt-container {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 80mm !important;
            max-width: 80mm !important;
            height: auto !important;
            margin: 0 !important;
            padding: 3mm 4mm 6mm !important;
            font-family: monospace !important;
            font-size: 12px !important;
            color: var(--text-1) !important;
            background: white !important;
            box-shadow: none !important;
          }
          .print-receipt-container img,
          .print-receipt-logo {
            visibility: visible !important;
            display: block !important;
            max-height: 56mm !important;
            max-width: 74mm !important;
            width: auto !important;
            height: auto !important;
            filter: none !important;
            -webkit-filter: none !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .no-print-area,
          .no-print-area * {
            display: none !important;
            visibility: hidden !important;
          }
        }
      `}</style>
    </div>
  )
}

export default function PointOfSale() {
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  useEffect(() => { setMounted(true) }, [])

  const { products, serials, contacts, invoices, createPOSOrder, posOrders, openPOSSession, closePOSSession, posSessionOpen, posSessionOpeningCash, posSessionId, posSessions, showToast, companySettings, getCustomerCreditStatus, bankAccounts } = useCommerceStore()
  const tenderBanks = bankAccounts.filter(b => b.active && b.id !== 'mpesa' && b.id !== 'cash')
  const { getStockByLocation, stockMoves } = useInventoryStore()

  const [cart, setCart] = useState<{ lineId: string; productId: string; productName: string; barcode: string; price: number; listPrice: number; qty: number; image: string; serialId?: string; serialNumber?: string }[]>([])
  const [scanInput, setScanInput] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [payMethod, setPayMethod] = useState<'cash' | 'mpesa' | 'bank'>('mpesa')
  const [bankAccountId, setBankAccountId] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [walkInBuyerName, setWalkInBuyerName] = useState('')
  const [showOpenSession, setShowOpenSession] = useState(false)
  const [showCloseSession, setShowCloseSession] = useState(false)
  const [openingCash, setOpeningCash] = useState('50000')
  const [closingCash, setClosingCash] = useState('')
  const [receiptOrder, setReceiptOrder] = useState<typeof posOrders[0] | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [redeemPoints, setRedeemPoints] = useState<number | ''>('')
  const [applyVat, setApplyVat] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  // Sell only from warehouse — shop is the "With Issues" bin, not a sales floor.
  const sellableLocations = new Set(['warehouse'])
  const getSellableQty = (productId: string, requiresSerial: boolean) => requiresSerial
    ? serials.filter(s => s.productId === productId && s.status === 'available' && sellableLocations.has(s.location)).length
    : (getStockByLocation(productId).warehouse ?? 0)

  const sellable = products.filter(p =>
    p.canBeSold &&
    p.isActive &&
    (p.unit === 'service' || getSellableQty(p.id, p.requiresSerial) > 0)
  )

  const categories = ['All', ...Array.from(new Set(sellable.map(p => p.category)))]
  const customers = contacts.filter(c => c.isCustomer)

  // Search matches product name/SKU/barcode, and also serial numbers or SKUs of
  // ready-for-sale units so a cashier can find the exact unit to sell.
  const searchTerm = search.trim().toLowerCase()
  const serialMatchByProduct = new Map<string, typeof serials[0]>()
  if (searchTerm) {
    serials.forEach(s => {
      if (s.status !== 'available' || !sellableLocations.has(s.location)) return
      const hit = (s.serial || '').toLowerCase().includes(searchTerm)
        || (s.barcode || '').toLowerCase().includes(searchTerm)
        || (s.sku || '').toLowerCase().includes(searchTerm)
      if (hit && !serialMatchByProduct.has(s.productId)) serialMatchByProduct.set(s.productId, s)
    })
  }

  const filteredProducts = sellable.filter(p => {
    const matchCat = category === 'All' || p.category === category
    const matchSearch = !searchTerm
      || p.name.toLowerCase().includes(searchTerm)
      || (p.barcode || '').toLowerCase().includes(searchTerm)
      || (p.sku || '').toLowerCase().includes(searchTerm)
      || serialMatchByProduct.has(p.id)
    return matchCat && matchSearch
  })

  const cartSubtotal = cart.reduce((a, i) => a + i.price * i.qty, 0)
  const cartTax = applyVat && companySettings.vatRate > 0 ? Math.round(cartSubtotal * companySettings.vatRate / 100) : 0
  const cartTotalBeforePoints = cartSubtotal + cartTax
  const customerInfo = customers.find(c => c.id === customerId)
  const maxPoints = customerInfo ? Math.min(customerInfo.loyaltyPoints || 0, cartTotalBeforePoints) : 0
  const pointsToRedeem = Math.min(Number(redeemPoints) || 0, maxPoints)
  const cartTotal = cartTotalBeforePoints - pointsToRedeem
  const pointsToEarn = customerId ? loyaltyPointsEarned(cartTotal) : 0

  const processScan = (code: string) => {
    const trimmed = normalizeScanCode(code)
    if (!trimmed) return

    const result = matchPosScan({
      code: trimmed,
      serials,
      products,
      sellableLocations,
      getSellableQty,
    })

    if (result.kind === 'serial') {
      const product = products.find(p => p.id === result.serial.productId)
      if (!product) {
        showToast(`Serial ${trimmed} is not linked to a product`, 'error')
        return
      }
      addToCart(product, result.serial.id)
      return
    }

    if (result.kind === 'out_of_stock') {
      showToast(`${result.product.name} is not available in ready-for-sale stock`, 'error')
      return
    }

    if (result.kind === 'product') {
      if (result.needsUnitScan) {
        showToast(`Scan the unit barcode on the device label for ${result.product.name} (not the product SKU)`, 'info')
        return
      }
      addToCart(result.product as typeof products[0])
      showToast(`${result.product.name} added`, 'success')
      return
    }

    showToast(`Barcode "${trimmed}" not found — check the label or type the code`, 'error')
  }

  // Barcode scanner — reads quickly typed characters (scanner emits chars fast then Enter)
  const handleScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      processScan(scanInput)
      setScanInput('')
      scanRef.current?.focus()
    }
  }

  const addToCart = (product: typeof products[0], serialId?: string) => {
    if (product.requiresSerial) {
      const avail = serials.filter(s => s.productId === product.id && s.status === 'available' && sellableLocations.has(s.location))
      if (avail.length === 0) { showToast(`No ready-for-sale units available for ${product.name}`, 'error'); return }
      const chosen = serialId ? avail.find(s => s.id === serialId || s.barcode === serialId || s.serial === serialId) : null
      if (!chosen) {
        showToast(`Scan/select the exact serial barcode for ${product.name}`, 'info')
        return
      }
      setCart(prev => {
        if (prev.some(i => i.serialId === chosen.id)) {
          showToast(`${chosen.serial} is already in cart`, 'info')
          return prev
        }
        return [...prev, { lineId: chosen.id, productId: product.id, productName: product.name, barcode: product.barcode, price: product.salePrice, listPrice: product.salePrice, qty: 1, image: product.image ?? '', serialId: chosen.id, serialNumber: chosen.serial }]
      })
      showToast(`${product.name} (${chosen.serial}) added`, 'success')
    } else {
      setCart(prev => {
        const ex = prev.find(i => i.productId === product.id)
        if (ex) return prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i)
        return [...prev, { lineId: product.id, productId: product.id, productName: product.name, barcode: product.barcode, price: product.salePrice, listPrice: product.salePrice, qty: 1, image: product.image ?? '' }]
      })
    }
  }

  const removeFromCart = (lineId: string) => setCart(prev => prev.filter(i => i.lineId !== lineId))
  const setQty = (lineId: string, qty: number) => {
    if (qty <= 0) { removeFromCart(lineId); return }
    setCart(prev => prev.map(i => {
      if (i.lineId !== lineId) return i
      if (i.serialId && qty !== 1) {
        showToast('Serialized POS items stay at quantity 1. Add another serial separately.', 'info')
        return i
      }
      return { ...i, qty: Math.max(1, Math.floor(qty)) }
    }))
  }

  const setPrice = (lineId: string, price: number) => {
    setCart(prev => prev.map(i => i.lineId === lineId ? { ...i, price: Math.max(0, Math.round((Number(price) || 0) * 100) / 100) } : i))
  }

  const resetPrice = (lineId: string) => {
    setCart(prev => prev.map(i => i.lineId === lineId ? { ...i, price: i.listPrice } : i))
  }

  const [charging, setCharging] = useState(false)
  const [openingSession, setOpeningSession] = useState(false)
  const [closingSession, setClosingSession] = useState(false)
  const orphanedSession = isOrphanedPosSession({
    posSessionOpen,
    posSessionId,
    posSessions,
  })

  const charge = async () => {
    if (cart.length === 0) { showToast('Cart is empty', 'error'); return }
    if (!posSessionOpen) { showToast('No active POS session', 'error'); return }
    if (charging) return

    if (customerId) {
      const cs = getCustomerCreditStatus(customerId)
      if (cs.isLocked) { showToast(cs.message, 'error'); return }
    }

    const selectedBankId = bankAccountId || tenderBanks.find(b => b.id === 'ncba')?.id || tenderBanks[0]?.id || ''
    if (payMethod === 'bank' && !selectedBankId) {
      showToast('Select a bank account before charging', 'error')
      return
    }

    setCharging(true)
    try {
      const order = await createPOSOrder(
        cart.map(i => ({
          productId: i.productId,
          productName: i.productName,
          barcode: i.barcode,
          price: i.price,
          qty: i.qty,
          subtotal: i.price * i.qty,
          serialId: i.serialId,
          serialNumber: i.serialNumber
        })) as any,
        payMethod,
        customerId || undefined,
        (customerName || walkInBuyerName.trim()) || undefined,
        pointsToRedeem || 0,
        applyVat,
        payMethod === 'bank'
          ? { bankAccountId: selectedBankId, paymentReference: paymentReference.trim() || undefined }
          : undefined,
      )

      if (order) {
        setCart([])
        setCustomerId('')
        setCustomerName('')
        setWalkInBuyerName('')
        setRedeemPoints('')
        setPaymentReference('')
        setReceiptOrder(order)
        setIsPrinting(true)
      }
    } finally {
      setCharging(false)
    }
  }

  // Auto-focus scan input
  useEffect(() => { scanRef.current?.focus() }, [posSessionOpen])

  if (!mounted) return <ModuleSkeleton />
  if (isPrinting && receiptOrder) return <ReceiptPrintView order={receiptOrder} companySettings={companySettings} bankAccounts={bankAccounts} serials={serials} stockMoves={stockMoves} invoices={invoices} onDone={() => setIsPrinting(false)} />

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Boot screen if no session */}
      {!posSessionOpen && (
        <div className="flex-1 flex flex-col items-center justify-center bg-surface p-6 text-center">
          <div className="text-6xl mb-6 text-t4" aria-hidden="true"><Fa icon={faStore} /></div>
          <h2 className="text-2xl font-black text-t1 mb-2">POS Terminal</h2>
          <p className="text-t3 mb-8 max-w-sm">Open a new session to start processing retail sales and managing your till.</p>
          <button type="button" className="btn-primary px-10 py-4 text-lg" onClick={() => setShowOpenSession(true)}>Open New Session</button>
          {showOpenSession && (
            <Modal title="Open Session" subtitle="Enter opening cash balance" width={380} onClose={() => setShowOpenSession(false)}>
              <Field label="Opening Cash Count (KES)"><Input value={openingCash} onChange={setOpeningCash} type="number" autoFocus /></Field>
              <button
                type="button"
                className="btn-primary w-full mt-4"
                disabled={openingSession}
                onClick={() => {
                  setOpeningSession(true)
                  try {
                    openPOSSession(Number(openingCash))
                    setShowOpenSession(false)
                  } finally {
                    setOpeningSession(false)
                  }
                }}
              >
                {openingSession ? 'Starting…' : 'Start Session'}
              </button>
            </Modal>
          )}
        </div>
      )}

      {posSessionOpen && (
        <div className="flex flex-col lg:flex-row lg:items-start gap-2 sm:gap-3 min-h-0">
          {/* Left — Products */}
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            {/* Header with History Button */}
            <div className="flex items-center justify-between gap-2 pb-1">
               <h2 className="text-xs font-bold text-t1 uppercase tracking-wider">Retail Till</h2>
               <div className="flex items-center gap-2">
                 <button className="btn-secondary text-[10px] py-1 px-3" onClick={() => setShowHistory(true)}>
                   <Fa icon={faReceipt} /> Transaction History
                 </button>
                 <button className="btn-outline text-[10px] py-1 px-3" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)' }}
                   onClick={() => setShowCloseSession(true)}>Close Session</button>
               </div>
            </div>

            {orphanedSession && (
              <div className="p-3 rounded-xl text-xs border" style={{ background: 'var(--danger-bg)', borderColor: 'color-mix(in srgb, var(--danger) 24%, transparent)', color: 'var(--danger-text)' }}>
                <p className="font-bold mb-1">Session state is stuck</p>
                <p className="mb-2">The till shows open but no session can be recovered. Clear the flag, then open a fresh session. Do not use this if sales are still going through.</p>
                <button
                  type="button"
                  className="btn-primary text-[10px] py-1.5 px-3"
                  style={{ background: 'var(--danger)' }}
                  disabled={closingSession}
                  onClick={() => {
                    setClosingSession(true)
                    try {
                      closePOSSession(0)
                    } finally {
                      setClosingSession(false)
                    }
                  }}
                >
                  {closingSession ? 'Clearing…' : 'Clear stuck session'}
                </button>
              </div>
            )}
            {/* Scanner bar */}
            <div className="flex gap-2 items-center p-3 rounded-xl" style={{ background: 'var(--info-bg)', border: '1px solid color-mix(in srgb, var(--info) 35%, transparent)' }}>
              <button
                type="button"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 hover:scale-110 transition-transform cursor-pointer"
                onClick={() => setShowCamera(true)}
                title="Open phone camera scanner"
                aria-label="Open phone camera scanner"
              >
                <Fa icon={faCamera} style={{ color: 'var(--primary)', fontSize: 20 }} />
              </button>
              <input ref={scanRef} className="form-input flex-1 font-mono" placeholder="Scan barcode / QR or type + Enter…"
                value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={handleScanKey} />
              <span className="badge badge-green text-[10px] hidden sm:inline">Scanner Ready</span>
            </div>
            <p className="text-[10px] text-t4 px-1">Phone camera or USB scanner. Serialized units: scan the serial number on the device label.</p>

            <BarcodeScannerModal
              open={showCamera}
              onClose={() => setShowCamera(false)}
              title="Scan product or unit label"
              hint="Use the rear camera. Good light helps. Serial stock: scan the unit QR/barcode on the device label."
              onScan={(code) => {
                processScan(code)
              }}
            />

            {/* Search + Category filter */}
            <div className="flex flex-col sm:flex-row gap-2">
              <input aria-label="Search products by name, SKU, or serial number" className="form-input flex-1 text-[11px] py-1.5" placeholder="Search by name, SKU or serial number..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
              {categories.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className="px-3 py-1 rounded-full text-[10px] cursor-pointer flex-shrink-0 whitespace-nowrap transition-all"
                  style={{
                    background: category === c ? 'var(--primary-light)' : 'var(--bg-surface)',
                    color: category === c ? 'var(--navy)' : 'var(--text-3)',
                    border: `1px solid ${category === c ? 'var(--primary)' : 'var(--border-lt)'}`,
                    fontWeight: category === c ? 600 : 400,
                  }}>
                  {c}
                </button>
              ))}
            </div>

            {/* Products grid */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
                {filteredProducts.map(p => {
                  const matchedSerial = serialMatchByProduct.get(p.id)
                  return (
                    <div key={p.id} onClick={() => addToCart(p, matchedSerial?.id)}
                      className="group flex flex-col p-2.5 sm:p-3 rounded-2xl bg-surface border border-border hover:border-brand-blue hover:shadow-xl transition-all cursor-pointer relative overflow-hidden">
                      <div className="text-2xl sm:text-3xl mb-2 sm:mb-3 text-t4 group-hover:opacity-80 transition-opacity duration-200" aria-hidden="true">
                        {p.image && !/^\p{Extended_Pictographic}/u.test(String(p.image))
                          ? <img src={p.image} alt="" className="w-10 h-10 object-contain mx-auto" />
                          : <Fa icon={faBox} />}
                      </div>
                      <p className="text-[11px] sm:text-xs font-bold text-t1 leading-tight mb-1 line-clamp-2">{p.name}</p>
                      {matchedSerial && (
                        <p className="text-[9px] font-bold text-emerald-600 font-mono truncate mb-1" title={matchedSerial.serial}>
                          SN: {matchedSerial.serial}
                        </p>
                      )}
                      <div className="mt-auto pt-2 flex items-center justify-between border-t border-border-lt">
                        <p className="text-[11px] sm:text-xs font-black text-brand-blue">{fmtKes(p.salePrice)}</p>
                        <p className="text-[9px] font-bold text-t4">{getSellableQty(p.id, p.requiresSerial)} in stock</p>
                      </div>
                      {p.requiresSerial && <div className="absolute top-2 right-2 badge badge-indigo text-[9px] px-1 py-0">SERIAL</div>}
                    </div>
                  )
                })}
              </div>
              {filteredProducts.length === 0 && (
                <div className="py-12 flex flex-col items-center justify-center opacity-40">
                  <div className="text-4xl mb-2 text-t4" aria-hidden="true"><Fa icon={faMagnifyingGlass} /></div>
                  <p className="text-xs font-bold text-t3">No products found</p>
                </div>
              )}
            </div>
          </div>

          {/* Right — Cart: sticky panel sized to viewport, not stretched to product grid height */}
          <div className="w-full lg:w-80 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6.5rem)] flex flex-col bg-surface border border-border rounded-xl self-start shrink-0 overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="text-xs font-black text-t1 uppercase tracking-widest">Cart ({cart.length})</h3>
              <button className="text-[10px] text-red-600 font-bold hover:underline" onClick={() => setCart([])}>Clear All</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {cart.map(i => (
                <div key={i.lineId} className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--bg-muted)] border border-border-lt relative">
                  <button className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-border flex items-center justify-center text-[10px] shadow-sm hover:bg-red-50 hover:text-red-600 transition-all"
                    onClick={() => removeFromCart(i.lineId)}>✕</button>
                  <div className="flex gap-3">
                    <div className="text-xl text-t4" aria-hidden="true">
                      {i.image && !/^\p{Extended_Pictographic}/u.test(String(i.image))
                        ? <img src={i.image} alt="" className="w-8 h-8 object-contain" />
                        : <Fa icon={faBox} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-t1 truncate" title={i.productName}>{i.productName}</p>
                      {i.serialNumber && <p className="text-[9px] font-mono text-brand-blue font-bold">SN: {i.serialNumber}</p>}
                      <div className="flex items-center gap-2 mt-1">
                         <input type="number" className="bg-transparent border-none p-0 text-[11px] font-black text-brand-blue w-20 focus:ring-0"
                           value={i.price} onChange={e => setPrice(i.lineId, Number(e.target.value))} />
                         {i.price !== i.listPrice && <button className="text-[9px] text-t4 hover:underline" onClick={() => resetPrice(i.lineId)}>Reset</button>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Decrease quantity of ${i.productName}`}
                        onClick={() => setQty(i.lineId, i.qty - 1)}
                      >
                        <Fa icon={faMinus} aria-hidden="true" />
                      </button>
                      <span className="w-8 text-center text-xs font-bold">{i.qty}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Increase quantity of ${i.productName}`}
                        onClick={() => setQty(i.lineId, i.qty + 1)}
                      >
                        <Fa icon={faPlus} aria-hidden="true" />
                      </button>
                    </div>
                    <p className="text-[11px] font-black text-t1">{fmtKes(i.price * i.qty)}</p>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="py-8 text-center">
                  <div className="text-3xl mb-3 opacity-20" aria-hidden="true"><Fa icon={faCartShopping} /></div>
                  <p className="text-xs text-t3 text-center px-4">Scan or click products to add to cart</p>
                </div>
              )}
            </div>

            <div className="p-4 bg-[var(--bg-muted)] border-t border-border space-y-4 shrink-0">
              <div className="space-y-2">
                <Field label="Customer (optional)">
                  <select className="form-input text-xs" value={customerId} onChange={e => {
                    const c = customers.find(x => x.id === e.target.value)
                    setCustomerId(e.target.value)
                    setCustomerName(c?.name || '')
                    if (e.target.value) setWalkInBuyerName('')
                  }}>
                    <option value="">Walk-in Customer</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.phone || 'no phone'})</option>)}
                  </select>
                </Field>
                {!customerId && (
                  <Field label="Buyer name">
                    <Input
                      value={walkInBuyerName}
                      onChange={setWalkInBuyerName}
                      placeholder="Name on the receipt"
                    />
                  </Field>
                )}
                {customerInfo && (customerInfo.loyaltyPoints || 0) > 0 && (
                  <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50 animate-in zoom-in-95 duration-200">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[10px] font-black text-indigo-700 uppercase tracking-wider">Redeem Points</p>
                      <p className="text-[10px] font-bold text-indigo-600">{(customerInfo.loyaltyPoints || 0)} available</p>
                    </div>
                    <div className="flex gap-2">
                      <input type="number" aria-label="Loyalty points to redeem" className="form-input flex-1 py-1.5 text-xs" placeholder="Points to use"
                        value={redeemPoints} onChange={e => setRedeemPoints(e.target.value === '' ? '' : Number(e.target.value))} />
                      <button className="btn-secondary py-1.5 px-3 text-[10px]" onClick={() => setRedeemPoints(maxPoints)}>Max</button>
                    </div>
                    {pointsToRedeem > 0 && <p className="text-[9px] text-indigo-500 mt-1 font-medium">Discount: -{fmtKes(pointsToRedeem)}</p>}
                  </div>
                )}
                <div className="flex items-center gap-2 cursor-pointer select-none py-1" onClick={() => setApplyVat(!applyVat)}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${applyVat ? 'bg-brand-blue border-brand-blue' : 'bg-white border-border'}`}>
                    {applyVat && <span className="text-[10px] text-white">✓</span>}
                  </div>
                  <span className="text-[11px] font-bold text-t2">Apply {companySettings.vatRate}% VAT</span>
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-border-lt">
                <div className="flex justify-between text-[11px] text-t3"><span>Subtotal</span><span>{fmtKes(cartSubtotal)}</span></div>
                {cartTax > 0 && <div className="flex justify-between text-[11px] text-t3"><span>VAT ({companySettings.vatRate}%)</span><span>{fmtKes(cartTax)}</span></div>}
                {pointsToRedeem > 0 && <div className="flex justify-between text-[11px] text-indigo-600 font-bold"><span>Points Discount</span><span>-{fmtKes(pointsToRedeem)}</span></div>}
                <div className="flex justify-between text-lg font-black text-t1 pt-1"><span>Total</span><span>{fmtKes(cartTotal)}</span></div>
                {pointsToEarn > 0 && <p className="text-[10px] text-center font-bold text-indigo-600 pt-1">Earns {pointsToEarn} loyalty points</p>}
              </div>

              <div className="flex gap-1.5 pt-2">
                {(['mpesa', 'cash', 'bank'] as const).map(m => (
                  <button key={m} type="button" onClick={() => {
                    setPayMethod(m)
                    if (m === 'bank' && !bankAccountId) {
                      setBankAccountId(tenderBanks.find(b => b.id === 'ncba')?.id || tenderBanks[0]?.id || '')
                    }
                  }}
                    className="flex-1 py-2 rounded-xl text-[10px] font-semibold uppercase cursor-pointer transition-all min-h-[40px]"
                    style={{
                      background: payMethod === m ? 'var(--primary-light)' : 'var(--bg-surface)',
                      color: payMethod === m ? 'var(--navy)' : 'var(--text-3)',
                      border: `1px solid ${payMethod === m ? 'var(--primary)' : 'var(--border-lt)'}`,
                      fontWeight: payMethod === m ? 600 : 400,
                    }}>
                    {m === 'mpesa' ? <><Fa icon={faMobileScreenButton} /> M-Pesa</> : m === 'cash' ? <><Fa icon={faMoneyBillWave} /> Cash</> : <><Fa icon={faBuildingColumns} /> Bank</>}
                  </button>
                ))}
              </div>
              {payMethod === 'bank' && (
                <div className="space-y-2 pt-1">
                  <Field label="Bank account">
                    <Select
                      value={bankAccountId || tenderBanks.find(b => b.id === 'ncba')?.id || tenderBanks[0]?.id || ''}
                      onChange={setBankAccountId}
                      options={tenderBanks.map(b => ({ value: b.id, label: b.name }))}
                    />
                  </Field>
                  <Field label="Payment reference (optional)">
                    <Input
                      value={paymentReference}
                      onChange={setPaymentReference}
                      placeholder="Transfer / deposit ref"
                    />
                  </Field>
                </div>
              )}
              <button
                type="button"
                className="btn-primary w-full py-3 text-sm font-semibold min-h-[48px]"
                onClick={() => { void charge() }}
                disabled={cart.length === 0 || charging}
                style={{
                  background: cart.length > 0 ? 'var(--success)' : 'var(--border-lt)',
                  color: cart.length > 0 ? '#FFFFFF' : 'var(--text-3)',
                  cursor: cart.length > 0 && !charging ? 'pointer' : 'default',
                }}
              >
                {charging ? 'Charging…' : cart.length > 0 ? `Charge ${fmtKes(cartTotal)}` : 'Add items to cart'}
              </button>
            </div>
          </div>

          {/* Receipt modal */}
          {receiptOrder && (
            <Modal title="Order Complete" subtitle="Transaction successful" width={480} onClose={() => setReceiptOrder(null)}>
              {/* Receipt content is now in ReceiptPrintView, we can just show a summary here */}
              <div className="text-center py-4"><div className="text-5xl mb-4" style={{ color: 'var(--success)' }} aria-hidden="true"><Fa icon={faCircleCheck} /></div><p className="text-lg font-semibold mb-2">{(isPosBankPayment(receiptOrder.payment) ? 'BANK' : receiptOrder.payment.toUpperCase())} Payment Received</p>{receiptOrder.paymentReference ? <p className="text-xs text-t3 mt-1">Ref: {receiptOrder.paymentReference}</p> : null}<p className="text-3xl font-bold font-mono" style={{ color: 'var(--success)' }}>{fmtKes(receiptOrder.total)}</p>{receiptOrder.pointsEarned ? (<p className="text-sm font-semibold mt-2" style={{ color: 'var(--navy)' }}><Fa icon={faStar} /> +{receiptOrder.pointsEarned} Loyalty Points Earned!</p>) : null}</div>
              <div className="flex gap-2 justify-end flex-wrap">
                <button className="btn-outline min-h-[40px] flex-1 sm:flex-none" onClick={() => setIsPrinting(true)}><Fa icon={faPrint} /> Print Receipt</button>
                <button className="btn-primary min-h-[40px] flex-1 sm:flex-none" onClick={() => { setReceiptOrder(null); scanRef.current?.focus() }}>New Order</button>
              </div>
            </Modal>
          )}

          {showCloseSession && (() => {
            const liveSession = posSessions.find(s => s.id === posSessionId)
            const sessionOrders = posOrdersForSession(posOrders, posSessionId || '', liveSession?.openedAt)
            const totalCash = sessionOrders.filter(o => o.payment === 'cash').reduce((a, o) => a + o.total, 0)
            const totalMpesa = sessionOrders.filter(o => o.payment === 'mpesa').reduce((a, o) => a + o.total, 0)
            const totalBank = sessionOrders.filter(o => isPosBankPayment(o.payment)).reduce((a, o) => a + o.total, 0)
            const totalSales = sessionOrders.reduce((a, o) => a + o.total, 0)
            const expectedCash = posSessionOpeningCash + totalCash
            const counted = Number(closingCash) || 0
            const variance = counted - expectedCash
            return (
              <Modal title="Close Session" subtitle="Count till and post session settlement" width={480} onClose={() => setShowCloseSession(false)}>
                <Field label="Closing Cash Count (KES)"><Input value={closingCash} onChange={setClosingCash} type="number" autoFocus /></Field>
                <div className="p-3 rounded text-xs space-y-1" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                  <p>Session orders: <strong>{sessionOrders.length}</strong></p>
                  <p>Total sales: <strong className="font-mono" style={{ color: 'var(--success)' }}>{fmtKes(totalSales)}</strong></p>
                  <p>Cash / M-Pesa / Bank: <strong className="font-mono">{fmtKes(totalCash)}</strong> · <strong className="font-mono">{fmtKes(totalMpesa)}</strong> · <strong className="font-mono">{fmtKes(totalBank)}</strong></p>
                  <p>Opening cash: <strong className="font-mono">{fmtKes(posSessionOpeningCash)}</strong></p>
                  <p>Expected cash: <strong className="font-mono">{fmtKes(expectedCash)}</strong></p>
                  <p>Variance: <strong className="font-mono" style={{ color: variance === 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtKes(variance)}</strong></p>
                  <p className="text-[10px] text-t3 mt-1">Closing posts a session journal (tender totals + cash over/short). Each sale already decremented stock and posted revenue.</p>
                </div>
                <div className="flex gap-2 justify-end">
                  <button className="btn-outline" onClick={() => setShowCloseSession(false)}>Cancel</button>
                  <button
                    className="btn-primary"
                    style={{ background: 'var(--danger)' }}
                    disabled={closingSession}
                    onClick={() => {
                      setClosingSession(true)
                      try {
                        closePOSSession(counted)
                        setShowCloseSession(false)
                        setClosingCash('')
                      } finally {
                        setClosingSession(false)
                      }
                    }}
                  >
                    {closingSession ? 'Closing…' : 'Close Session'}
                  </button>
                </div>
              </Modal>
            )
          })()}

          {/* History modal */}
          {showHistory && (
            <Modal title="POS Transactions History" onClose={() => setShowHistory(false)} width={740}>
              <PosTransactionHistory
                orders={posOrders}
                serials={serials}
                stockMoves={stockMoves}
                onReprint={o => { setReceiptOrder(o); setIsPrinting(true); setShowHistory(false) }}
              />
            </Modal>
          )}
        </div>
      )}
    </div>
  )
}
