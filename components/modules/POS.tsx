'use client'
import { useState, useRef, useEffect } from 'react'
import { useCommerceStore, fmtKes, fmtDate } from '@/lib/store'
import { Modal, Field, Input, Badge, ModuleSkeleton } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  Fa, faCashRegister, faReceipt, faCamera, faCartShopping, faStar,
  faCircleCheck, faPrint, faMobileScreenButton, faMoneyBillWave, faCreditCard,
} from '@/components/icons'
import { BarcodeScannerModal } from '@/components/BarcodeScanner'
import { matchPosScan, normalizeScanCode } from '@/lib/barcode-scan'

function ReceiptPrintView({ order, companySettings, onDone }: { order: any, companySettings: any, onDone: () => void }) {
  useEffect(() => {
    const handleAfterPrint = () => {
      onDone()
      window.removeEventListener('afterprint', handleAfterPrint)
    }
    window.addEventListener('afterprint', handleAfterPrint)
    const timer = setTimeout(() => window.print(), 300)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [onDone])

  return (
    <div className="print-receipt-container bg-white text-black" style={{ fontFamily: 'monospace', fontSize: '12px', width: '300px', margin: '0 auto', padding: '16px' }}>
      <div className="text-center pb-4 mb-4" style={{ borderBottom: '1px dashed #ccc' }}>
        {companySettings.logoUrl ? (
          <img src={companySettings.logoUrl} style={{ maxHeight: 60, margin: '0 auto 8px', objectFit: 'contain' }} alt="Logo" />
        ) : (
          <h2 className="font-bold text-lg mb-1">{companySettings.name}</h2>
        )}
        {companySettings.logoUrl && <h2 className="font-bold text-sm mb-1">{companySettings.name}</h2>}
        <p>{companySettings.address}, {companySettings.city}</p>
        <p>Tel: {companySettings.phone}</p>
        {companySettings.kraPin && <p>PIN: {companySettings.kraPin}</p>}
      </div>
      <div className="flex justify-between mb-4">
        <div>
          <p>Receipt: <strong>{order.ref}</strong></p>
          <p>Cashier: {order.createdByName || 'System'}</p>
          {order.customerName && <p>Customer: {order.customerName}</p>}
        </div>
        <div className="text-right">
          <p>Date: {fmtDate(order.date)}</p>
          <p>Time: {order.createdAt ? new Date(order.createdAt).toLocaleTimeString('en-KE', {hour: '2-digit', minute: '2-digit'}) : '--:--'}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 mb-4">
        <div className="flex justify-between font-bold pb-1 mb-1" style={{ borderBottom: '1px solid #eee' }}>
          <span>Item</span>
          <span>Total</span>
        </div>
        {order.lines.map((l: any, i: number) => (
          <div key={i} className="flex justify-between">
            <span>{l.productName} <br/><span className="text-[10px] text-gray-500">{l.qty} × {fmtKes(l.price)}</span></span>
            <span className="font-semibold">{fmtKes(l.subtotal)}</span>
          </div>
        ))}
      </div>
      <div className="pt-2 mb-4" style={{ borderTop: '1px dashed #ccc' }}>
        <div className="flex justify-between mb-1"><span>Subtotal</span><span>{fmtKes(order.subtotal)}</span></div>
        {order.taxTotal > 0 && <div className="flex justify-between mb-1"><span>VAT</span><span>{fmtKes(order.taxTotal)}</span></div>}
        {order.pointsRedeemed ? (<div className="flex justify-between mb-1 text-red-600"><span>Points Redeemed</span><span>-{fmtKes(order.pointsRedeemed)}</span></div>) : null}
        <div className="flex justify-between font-bold text-sm pt-2 mt-2" style={{ borderTop: '1px solid #ccc' }}>
          <span>FINAL TOTAL</span><span>{fmtKes(order.total)}</span>
        </div>
        <div className="flex justify-between mt-2">
          <span>Payment Mode</span><span className="uppercase">{order.payment}</span>
        </div>
      </div>
      <div className="text-center pt-4" style={{ borderTop: '1px dashed #ccc' }}>
        {order.pointsEarned ? (
          <p className="font-semibold mb-2">+{order.pointsEarned} Loyalty Points Earned!</p>
        ) : null}
        <p>{companySettings.invoiceFooter || 'Thank you for your business!'}</p>
      </div>
      <div className="no-print-area text-center mt-6">
        <p className="text-xs text-gray-500">Printing receipt...</p>
        <button className="btn-outline mt-2" onClick={onDone}>Cancel / Done</button>
      </div>
      <style>{`
        @media print { 
          @page { margin: 0; }
          body * { visibility: hidden; } 
          .print-receipt-container, .print-receipt-container * { visibility: visible; } 
          .print-receipt-container { position: absolute; left: 0; top: 0; width: 80mm; margin: 0; padding: 4mm; font-family: monospace; font-size: 12px; color: #000; } 
          .no-print-area, .no-print-area * { display: none !important; } 
        }
      `}</style>
    </div>
  )
}

export default function PointOfSale() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const { products, serials, contacts, createPOSOrder, posOrders, openPOSSession, closePOSSession, posSessionOpen, posSessionOpeningCash, showToast, companySettings, getCustomerCreditStatus } = useCommerceStore()

  const [cart, setCart] = useState<{ lineId: string; productId: string; productName: string; barcode: string; price: number; listPrice: number; qty: number; image: string; serialId?: string; serialNumber?: string }[]>([])
  const [scanInput, setScanInput] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [payMethod, setPayMethod] = useState<'cash' | 'mpesa' | 'card'>('mpesa')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
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

  const sellableLocations = new Set(['warehouse', 'shop'])
  const getSellableQty = (productId: string, requiresSerial: boolean) => requiresSerial
    ? serials.filter(s => s.productId === productId && s.status === 'available' && sellableLocations.has(s.location)).length
    : (products.find(p => p.id === productId)?.stockQty ?? 0)

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
  const pointsToEarn = customerId ? Math.floor(cartTotal / 100) : 0

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
        return [...prev, { lineId: chosen.id, productId: product.id, productName: product.name, barcode: product.barcode, price: product.salePrice, listPrice: product.salePrice, qty: 1, image: product.image ?? '📦', serialId: chosen.id, serialNumber: chosen.serial }]
      })
      showToast(`${product.name} (${chosen.serial}) added`, 'success')
    } else {
      setCart(prev => {
        const ex = prev.find(i => i.productId === product.id)
        if (ex) return prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i)
        return [...prev, { lineId: product.id, productId: product.id, productName: product.name, barcode: product.barcode, price: product.salePrice, listPrice: product.salePrice, qty: 1, image: product.image ?? '📦' }]
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

  const charge = () => {
    if (cart.length === 0) { showToast('Cart is empty', 'error'); return }
    if (!posSessionOpen) { showToast('No active POS session', 'error'); return }

    if (customerId) {
      const cs = getCustomerCreditStatus(customerId)
      if (cs.isLocked) { showToast(cs.message, 'error'); return }
    }

    const order = createPOSOrder(
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
      customerName || undefined,
      pointsToRedeem || 0,
      applyVat
    ) as any

    if (order) {
      setCart([])
      setCustomerId('')
      setCustomerName('')
      setRedeemPoints('')
      setReceiptOrder(order)
      setIsPrinting(true)
    }
  }

  // Auto-focus scan input
  useEffect(() => { scanRef.current?.focus() }, [posSessionOpen])

  if (!mounted) return <ModuleSkeleton />
  if (isPrinting && receiptOrder) return <ReceiptPrintView order={receiptOrder} companySettings={companySettings} onDone={() => setIsPrinting(false)} />

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Boot screen if no session */}
      {!posSessionOpen && (
        <div className="flex-1 flex flex-col items-center justify-center bg-surface p-6 text-center">
          <div className="text-6xl mb-6">🏪</div>
          <h2 className="text-2xl font-black text-t1 mb-2">POS Terminal</h2>
          <p className="text-t3 mb-8 max-w-sm">Open a new session to start processing retail sales and managing your till.</p>
          <button className="btn-primary px-10 py-4 text-lg" onClick={() => setShowOpenSession(true)}>Open New Session</button>
          {showOpenSession && (
            <Modal title="Open Session" subtitle="Enter opening cash balance" width={380} onClose={() => setShowOpenSession(false)}>
              <Field label="Opening Cash Count (KES)"><Input value={openingCash} onChange={setOpeningCash} type="number" autoFocus /></Field>
              <button className="btn-primary w-full mt-4" onClick={() => { openPOSSession(Number(openingCash)); setShowOpenSession(false) }}>Start Session</button>
            </Modal>
          )}
        </div>
      )}

      {posSessionOpen && (
        <div className="flex flex-col lg:flex-row gap-2 sm:gap-3 h-full min-h-0">
          {/* Left — Products */}
          <div className="flex flex-col gap-2 flex-1 min-w-0 overflow-hidden min-h-0">
            {/* Header with History Button */}
            <div className="flex items-center justify-between gap-2 pb-1">
               <h2 className="text-xs font-bold text-t1 uppercase tracking-wider">Retail Till</h2>
               <div className="flex items-center gap-2">
                 <button className="btn-secondary text-[10px] py-1 px-3" onClick={() => setShowHistory(true)}>
                   <Fa icon={faReceipt} /> Transaction History
                 </button>
                 <button className="btn-outline text-[10px] py-1 px-3" style={{ color: 'var(--danger)', borderColor: '#FCA5A5' }}
                   onClick={() => setShowCloseSession(true)}>Close Session</button>
               </div>
            </div>

            {/* Scanner bar */}
            <div className="flex gap-2 items-center p-3 rounded-xl" style={{ background: 'var(--info-bg)', border: '1px solid #C7D2FE' }}>
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
            <p className="text-[10px] text-t4 px-1">Phone camera or USB scanner. Serialized units need the unit label (INV-…), not only the product SKU.</p>

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
                    background: category === c ? '#E8F3FA' : 'var(--bg-surface)',
                    color: category === c ? 'var(--navy)' : 'var(--text-3)',
                    border: `1px solid ${category === c ? '#A8D4E8' : 'var(--border-lt)'}`,
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
                      <div className="text-2xl sm:text-3xl mb-2 sm:mb-3 group-hover:scale-110 transition-transform duration-300">{p.image ?? '📦'}</div>
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
                      {p.requiresSerial && <div className="absolute top-2 right-2 badge badge-indigo text-[8px] px-1 py-0">SERIAL</div>}
                    </div>
                  )
                })}
              </div>
              {filteredProducts.length === 0 && (
                <div className="py-12 flex flex-col items-center justify-center opacity-40">
                  <div className="text-4xl mb-2">🔍</div>
                  <p className="text-xs font-bold text-t3">No products found</p>
                </div>
              )}
            </div>
          </div>

          {/* Right — Cart */}
          <div className="w-full lg:w-80 flex flex-col bg-surface border-l border-border min-h-0">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="text-xs font-black text-t1 uppercase tracking-widest">Cart ({cart.length})</h3>
              <button className="text-[10px] text-red-600 font-bold hover:underline" onClick={() => setCart([])}>Clear All</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {cart.map(i => (
                <div key={i.lineId} className="flex flex-col gap-2 p-3 rounded-xl bg-[var(--bg-muted)] border border-border-lt relative">
                  <button className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-border flex items-center justify-center text-[10px] shadow-sm hover:bg-red-50 hover:text-red-600 transition-all"
                    onClick={() => removeFromCart(i.lineId)}>✕</button>
                  <div className="flex gap-3">
                    <div className="text-xl">{i.image}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-t1 truncate">{i.productName}</p>
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
                      <button className="w-6 h-6 rounded bg-white border border-border flex items-center justify-center text-xs hover:bg-muted"
                        onClick={() => setQty(i.lineId, i.qty - 1)}>−</button>
                      <span className="w-8 text-center text-xs font-bold">{i.qty}</span>
                      <button className="w-6 h-6 rounded bg-white border border-border flex items-center justify-center text-xs hover:bg-muted"
                        onClick={() => setQty(i.lineId, i.qty + 1)}>+</button>
                    </div>
                    <p className="text-[11px] font-black text-t1">{fmtKes(i.price * i.qty)}</p>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="py-20 text-center">
                  <div className="text-3xl mb-3 opacity-20" aria-hidden="true"><Fa icon={faCartShopping} /></div>
                  <p className="text-xs text-t3 text-center px-4">Scan or click products to add to cart</p>
                </div>
              )}
            </div>

            <div className="p-4 bg-[var(--bg-muted)] border-t border-border space-y-4">
              <div className="space-y-2">
                <Field label="Customer (optional)">
                  <select className="form-input text-xs" value={customerId} onChange={e => {
                    const c = customers.find(x => x.id === e.target.value)
                    setCustomerId(e.target.value)
                    setCustomerName(c?.name || '')
                  }}>
                    <option value="">Walk-in Customer</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.phone || 'no phone'})</option>)}
                  </select>
                </Field>
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
                {pointsToEarn > 0 && <p className="text-[10px] text-center font-bold text-indigo-600 pt-1">✨ Earns {pointsToEarn} loyalty points</p>}
              </div>

              <div className="flex gap-1.5 pt-2">
                {(['mpesa', 'cash', 'card'] as const).map(m => (
                  <button key={m} onClick={() => setPayMethod(m)}
                    className="flex-1 py-2 rounded-xl text-[10px] font-semibold uppercase cursor-pointer transition-all min-h-[40px]"
                    style={{
                      background: payMethod === m ? '#E8F3FA' : 'var(--bg-surface)',
                      color: payMethod === m ? 'var(--navy)' : 'var(--text-3)',
                      border: `1px solid ${payMethod === m ? '#A8D4E8' : 'var(--border-lt)'}`,
                      fontWeight: payMethod === m ? 600 : 400,
                    }}>
                    {m === 'mpesa' ? <><Fa icon={faMobileScreenButton} /> M-Pesa</> : m === 'cash' ? <><Fa icon={faMoneyBillWave} /> Cash</> : <><Fa icon={faCreditCard} /> Card</>}
                  </button>
                ))}
              </div>
              <button className="btn-primary w-full py-3 text-sm font-semibold min-h-[48px]" onClick={charge}
                style={{ background: cart.length > 0 ? '#12B76A' : 'var(--border-lt)', color: cart.length > 0 ? '#fff' : 'var(--text-3)', cursor: cart.length > 0 ? 'pointer' : 'default' }}>
                {cart.length > 0 ? `Charge ${fmtKes(cartTotal)}` : 'Add items to cart'}
              </button>
            </div>
          </div>

          {/* Receipt modal */}
          {receiptOrder && (
            <Modal title="Order Complete" subtitle="Transaction successful" width={480} onClose={() => setReceiptOrder(null)}>
              {/* Receipt content is now in ReceiptPrintView, we can just show a summary here */}
              <div className="text-center py-4"><div className="text-5xl mb-4" style={{ color: 'var(--success)' }} aria-hidden="true"><Fa icon={faCircleCheck} /></div><p className="text-lg font-semibold mb-2">{receiptOrder.payment.toUpperCase()} Payment Received</p><p className="text-3xl font-bold font-mono" style={{ color: 'var(--success)' }}>{fmtKes(receiptOrder.total)}</p>{receiptOrder.pointsEarned ? (<p className="text-sm font-semibold mt-2" style={{ color: '#4F46E5' }}><Fa icon={faStar} /> +{receiptOrder.pointsEarned} Loyalty Points Earned!</p>) : null}</div>
              <div className="flex gap-2 justify-end flex-wrap">
                <button className="btn-outline min-h-[40px] flex-1 sm:flex-none" onClick={() => setIsPrinting(true)}><Fa icon={faPrint} /> Print Receipt</button>
                <button className="btn-primary min-h-[40px] flex-1 sm:flex-none" onClick={() => { setReceiptOrder(null); scanRef.current?.focus() }}>New Order</button>
              </div>
            </Modal>
          )}

          {showCloseSession && (
            <Modal title="Close Session" width={480} onClose={() => setShowCloseSession(false)}>
              <Field label="Closing Cash Count (KES)"><Input value={closingCash} onChange={setClosingCash} type="number" autoFocus /></Field>
              <div className="p-3 rounded text-xs" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                <p>Session orders: <strong>{posOrders.length}</strong></p>
                <p className="mt-1">Total revenue: <strong className="font-mono" style={{ color: 'var(--success)' }}>{fmtKes(posOrders.reduce((a, o) => a + o.total, 0))}</strong></p>
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-outline" onClick={() => setShowCloseSession(false)}>Cancel</button>
                <button className="btn-primary" style={{ background: '#F04438' }} onClick={() => { closePOSSession(Number(closingCash)); setShowCloseSession(false) }}>Close Session</button>
              </div>
            </Modal>
          )}

          {/* History modal */}
          {showHistory && (
            <Modal title="POS Transactions History" onClose={() => setShowHistory(false)} width={740}>
              <DataTable
                tableId="pos-transactions-history"
                columns={[
                  {
                    key: 'ref', label: 'Receipt Ref', priority: 1, width: '110px',
                    render: o => <span className="font-mono text-[11px] font-bold text-brand-navy">{o.ref}</span>,
                    exportValue: o => o.ref,
                  },
                  {
                    key: 'customer', label: 'Customer', priority: 1, width: '1fr',
                    render: o => <span className="text-xs truncate">{o.customerName || 'Walk-in'}</span>,
                    exportValue: o => o.customerName || 'Walk-in',
                  },
                  {
                    key: 'date', label: 'Date & Time', priority: 2, width: '110px',
                    render: o => (
                      <span className="text-[10px] text-t3">
                        {fmtDate(o.date)}{o.createdAt ? ` ${new Date(o.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : ''}
                      </span>
                    ),
                    exportValue: o => o.date,
                  },
                  {
                    key: 'payment', label: 'Payment', priority: 2, width: '80px',
                    render: o => <span className="text-[10px] uppercase font-semibold">{o.payment}</span>,
                    exportValue: o => o.payment,
                  },
                  {
                    key: 'total', label: 'Total', priority: 1, width: '100px', align: 'right',
                    render: o => <span className="font-mono text-[11px] font-bold text-emerald-600">{fmtKes(o.total)}</span>,
                    exportValue: o => o.total,
                  },
                ] as ColumnDef<(typeof posOrders)[number]>[]}
                rows={posOrders}
                rowKey={o => o.id}
                searchPlaceholder="Search receipt, customer…"
                emptyMessage="No transactions found."
                perPage={50}
                rowActions={o => (
                  <button
                    className="btn-secondary text-[10px] py-1"
                    onClick={() => { setReceiptOrder(o); setIsPrinting(true); setShowHistory(false) }}
                  >
                    <Fa icon={faPrint} /> Reprint
                  </button>
                )}
              />
            </Modal>
          )}
        </div>
      )}
    </div>
  )
}
