'use client'
import { useState, useRef, useEffect } from 'react'
import { useApp, fmtKes } from '@/lib/store'
import { Modal, Field, Input, Badge, StatCard } from '@/components/ui'

export default function PointOfSale() {
  const { products, serials, contacts, createPOSOrder, posOrders, openPOSSession, closePOSSession, posSessionOpen, posSessionOpeningCash, showToast, companySettings } = useApp()

  const [cart, setCart] = useState<{ productId: string; productName: string; barcode: string; price: number; qty: number; image: string; serialId?: string; serialNumber?: string }[]>([])
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
  const scanRef = useRef<HTMLInputElement>(null)

  const sellable = products.filter(p => p.canBeSold && p.isActive && p.stockQty > 0 || p.unit === 'service')
  const categories = ['All', ...Array.from(new Set(sellable.map(p => p.category)))]
  const customers = contacts.filter(c => c.isCustomer)

  const filteredProducts = sellable.filter(p => {
    const matchCat = category === 'All' || p.category === category
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.barcode.includes(search)
    return matchCat && matchSearch
  })

  const cartSubtotal = cart.reduce((a, i) => a + i.price * i.qty, 0)
  const cartTax = companySettings.vatRate > 0 ? Math.round(cartSubtotal * companySettings.vatRate / 100) : 0
  const cartTotal = cartSubtotal + cartTax
  const getShopQty = (productId: string, requiresSerial: boolean) => requiresSerial
    ? serials.filter(s => s.productId === productId && s.status === 'available' && s.location === 'shop').length
    : (products.find(p => p.id === productId)?.stockQty ?? 0)

  // Barcode scanner — reads quickly typed characters (scanner emits chars fast then Enter)
  const handleScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const code = scanInput.trim()
      if (!code) return
      const product = products.find(p => p.barcode === code)
      if (product) {
        if (product.unit !== 'service' && getShopQty(product.id, product.requiresSerial) <= 0) {
          showToast(`${product.name} is not available in shop stock`, 'error'); setScanInput(''); return
        }
        addToCart(product)
        showToast(`${product.name} added`, 'success')
      } else {
        showToast(`Barcode ${code} not found`, 'error')
      }
      setScanInput('')
      scanRef.current?.focus()
    }
  }

  const addToCart = (product: typeof products[0]) => {
    if (product.requiresSerial) {
      const avail = serials.filter(s => s.productId === product.id && s.status === 'available' && s.location === 'shop')
      if (avail.length === 0) { showToast(`No shop units available for ${product.name}`, 'error'); return }
      const serial = avail[0]
      setCart(prev => {
        if (prev.find(i => i.serialId === serial.id)) { showToast('Unit already in cart', 'error'); return prev }
        return [...prev, { productId: product.id, productName: product.name, barcode: product.barcode, price: product.salePrice, qty: 1, image: product.image ?? '📦', serialId: serial.id, serialNumber: serial.serial }]
      })
    } else {
      setCart(prev => {
        const ex = prev.find(i => i.productId === product.id)
        if (ex) return prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i)
        return [...prev, { productId: product.id, productName: product.name, barcode: product.barcode, price: product.salePrice, qty: 1, image: product.image ?? '📦' }]
      })
    }
  }

  const removeFromCart = (productId: string) => setCart(prev => prev.filter(i => i.productId !== productId))
  const setQty = (productId: string, qty: number) => {
    if (qty <= 0) { removeFromCart(productId); return }
    setCart(prev => prev.map(i => i.productId === productId ? { ...i, qty } : i))
  }

  const charge = () => {
    if (cart.length === 0) { showToast('Cart is empty', 'error'); return }
    if (!posSessionOpen) { showToast('No active POS session', 'error'); return }
    // Check stock
    for (const item of cart) {
      const p = products.find(x => x.id === item.productId)!
      if (p.unit !== 'service' && getShopQty(p.id, p.requiresSerial) < item.qty) {
        showToast(`Not enough shop stock for ${p.name}`, 'error'); return
      }
    }
    const lines = cart.map(i => ({ productId: i.productId, productName: i.productName, barcode: i.barcode, qty: i.qty, price: i.price, subtotal: i.price * i.qty, serialId: i.serialId, serialNumber: i.serialNumber }))
    createPOSOrder(lines, payMethod, customerId || undefined, customerName || undefined)
    // Store last order for receipt
    const lastRef = posOrders[0]  // Will be updated after createPOSOrder
    setReceiptOrder({ id: 'temp', ref: 'POS/LAST', sessionId: '', lines, subtotal: cartSubtotal, taxTotal: cartTax, total: cartTotal, payment: payMethod, date: new Date().toISOString().slice(0, 10) })
    setCart([]); setCustomerId(''); setCustomerName(''); setCartOpen(false)
    scanRef.current?.focus()
  }

  // Auto-focus scan input
  useEffect(() => { scanRef.current?.focus() }, [posSessionOpen])

  if (!posSessionOpen) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-5xl sm:text-6xl mb-4">🖥️</div>
        <h2 className="text-xl font-semibold mb-2 text-center px-4">Point of Sale</h2>
        <p className="text-sm text-t3 mb-6 text-center px-4">Open a session to issue stock from the shop location</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8 w-full max-w-2xl px-4">
          <StatCard label="Today's Sales" value={fmtKes(posOrders.reduce((a, o) => a + o.total, 0))} color="#10B981" />
          <StatCard label="Transactions" value={posOrders.length} color="#8B5CF6" />
          <StatCard label="Session" value="Closed" color="#EF4444" />
        </div>

        {posOrders.length > 0 && (
          <div className="card overflow-hidden mb-6 w-full max-w-lg mx-4">
            <div className="px-4 py-3 border-b text-xs font-semibold" style={{ borderColor: 'var(--border-lt)' }}>Recent Orders</div>
            {posOrders.slice(0, 5).map(o => (
              <div key={o.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center px-4 py-2.5 border-b text-xs gap-2" style={{ borderColor: 'var(--border-lt)' }}>
                <div>
                  <p className="font-mono font-medium">{o.ref}</p>
                  <p className="text-t3">{o.lines.length} item(s) · {o.payment.toUpperCase()}</p>
                </div>
                <span className="font-mono font-semibold sm:ml-auto" style={{ color: '#10B981' }}>{fmtKes(o.total)}</span>
              </div>
            ))}
          </div>
        )}

        <button className="btn-primary px-8 py-3 text-sm font-semibold w-full max-w-sm" onClick={() => setShowOpenSession(true)}>
          Open POS Session →
        </button>

        {showOpenSession && (
          <Modal title="Open Session" subtitle="Enter opening cash balance" width={380} onClose={() => setShowOpenSession(false)}>
            <Field label="Opening Cash (KES)"><Input value={openingCash} onChange={setOpeningCash} type="number" autoFocus /></Field>
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setShowOpenSession(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => { openPOSSession(Number(openingCash) || 0); setShowOpenSession(false) }}>Open Session</button>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  const cartItemCount = cart.reduce((a, i) => a + i.qty, 0)

  return (
    <div className="flex flex-col lg:flex-row gap-2 sm:gap-3 h-full min-h-0">
      {/* Left — Products */}
      <div className="flex flex-col gap-2 flex-1 min-w-0 overflow-hidden min-h-0">
        {/* Scanner bar */}
        <div className="flex gap-2 items-center p-3 rounded-xl" style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
          <span className="text-xl flex-shrink-0">📷</span>
          <input ref={scanRef} className="form-input flex-1 font-mono" placeholder="Scan barcode or type here + Enter..."
            value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={handleScanKey} />
          <span className="badge badge-green text-[10px]">Scanner Ready</span>
        </div>

        {/* Search + Category filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input className="form-input flex-1 text-[11px] py-1.5" placeholder="Search product..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className="px-3 py-1 rounded-full text-[10px] cursor-pointer flex-shrink-0 whitespace-nowrap transition-all"
              style={{
                background: category === c ? '#E8F3FA' : 'var(--bg-surface)',
                color: category === c ? '#1B2762' : 'var(--text-3)',
                border: `1px solid ${category === c ? '#A8D4E8' : 'var(--border-lt)'}`,
                fontWeight: category === c ? 600 : 400,
              }}>
              {c}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3 auto-rows-fr">
            {filteredProducts.map(p => {
              const inCart = cart.find(i => i.productId === p.id)
              return (
                <button key={p.id} onClick={() => addToCart(p)}
                  className="p-2 sm:p-3 rounded-xl text-left cursor-pointer transition-all flex flex-col gap-1.5 relative h-full"
                  style={{
                    background: inCart ? '#E8F3FA' : 'var(--bg-surface)',
                    border: inCart ? '1px solid #A8D4E8' : '1px solid var(--border-lt)',
                  }}>
                  {inCart && (
                    <div className="absolute top-1 right-1 w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ background: '#1B2762' }}>{inCart.qty}</div>
                  )}
                  <span className="text-xl sm:text-2xl">{p.image}</span>
                  <p className="text-[10px] sm:text-[11px] font-medium leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-[9px] sm:text-[10px] font-mono font-semibold" style={{ color: '#10B981' }}>{fmtKes(p.salePrice)}</p>
                  <p className="text-[8px] sm:text-[9px]" style={{ color: p.stockQty <= p.minStock ? '#F59E0B' : 'var(--text-3)' }}>
                    {p.unit === 'service' ? 'Service' : `${getShopQty(p.id, p.requiresSerial)} in shop`}
                  </p>
                </button>
              )
            })}
            {filteredProducts.length === 0 && (
              <p className="col-span-full py-10 text-center text-xs text-t3">No products match</p>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: floating cart toggle bar */}
      {cartItemCount > 0 && !cartOpen && (
        <button
          className="lg:hidden fixed bottom-4 left-4 right-4 z-40 flex items-center justify-between px-4 py-3 rounded-2xl shadow-2xl no-min min-h-[44px]"
          style={{ background: '#1B2762', color: '#fff', borderTop: '1px solid rgba(255,255,255,0.1)' }}
          onClick={() => setCartOpen(true)}
        >
          <span className="text-sm font-semibold flex-1 truncate">🛒 {cartItemCount} item{cartItemCount !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold font-mono ml-2">{fmtKes(cartTotal)}</span>
        </button>
      )}

      {/* Right — Cart (desktop: fixed sidebar | mobile: full-screen overlay) */}
      <div className={[
        'flex flex-col rounded-xl overflow-hidden order-2 lg:order-none lg:flex lg:flex-shrink-0',
        'lg:w-80 xl:w-96 h-screen lg:h-auto',
        cartOpen ? 'fixed inset-0 z-50 rounded-none slide-up lg:relative lg:inset-auto lg:rounded-xl lg:pos-cart-sheet' : 'hidden lg:flex',
      ].join(' ')}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-lt)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border-lt)' }}>
          <div className="flex items-center gap-2">
            <button className="lg:hidden no-min p-1 rounded-lg text-t3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', minHeight: 'unset' }}
              onClick={() => setCartOpen(false)}>← Back</button>
            <p className="text-xs font-semibold">Cart ({cartItemCount})</p>
          </div>
          <div className="flex gap-2 items-center">
            <span className="badge badge-purple">{cart.reduce((a, i) => a + i.qty, 0)} items</span>
            {cart.length > 0 && <button className="no-min" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 10, minHeight: 'unset' }} onClick={() => setCart([])}>Clear</button>}
          </div>
        </div>

        {/* Customer */}
        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-lt)' }}>
          <select className="form-select text-[11px] py-1.5" value={customerId}
            onChange={e => { const c = customers.find(x => x.id === e.target.value); setCustomerId(e.target.value); setCustomerName(c?.name ?? '') }}>
            <option value="">Walk-in Customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-3">
          {cart.length === 0
            ? <div className="flex flex-col items-center justify-center h-full opacity-40 py-8">
                <p className="text-4xl sm:text-5xl mb-4">🛒</p>
                <p className="text-xs text-t3 text-center px-4">Scan or click products to add to cart</p>
              </div>
            : cart.map(item => (
              <div key={item.productId} className="flex items-center gap-2 p-2 sm:p-2.5 rounded-lg mb-1.5 hover:shadow-sm" style={{ background: '#F9FAFB', border: '1px solid var(--border-lt)' }}>
                <span className="text-lg sm:text-base flex-shrink-0">{item.image}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">{item.productName}</p>
                  {item.serialNumber && <p className="text-[9px] font-mono" style={{ color: '#1B2762' }}>S/N: {item.serialNumber}</p>}
                  <p className="text-[10px] font-mono" style={{ color: '#10B981' }}>{fmtKes(item.price)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button style={{ background: '#F3F4F6', border: '1px solid var(--border-lt)', cursor: 'pointer', color: 'var(--text-1)', width: 24, height: 24, borderRadius: 4, fontSize: 14, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => setQty(item.productId, item.qty - 1)}>-</button>
                  <span className="text-xs font-mono w-6 text-center font-bold">{item.qty}</span>
                  <button style={{ background: '#F3F4F6', border: '1px solid var(--border-lt)', cursor: 'pointer', color: 'var(--text-1)', width: 24, height: 24, borderRadius: 4, fontSize: 14, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => setQty(item.productId, item.qty + 1)}>+</button>
                </div>
                <div className="w-20 text-right flex-shrink-0">
                  <p className="text-[11px] font-mono font-semibold">{fmtKes(item.price * item.qty)}</p>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F04438', fontSize: 10, fontWeight: 500, padding: 0 }}
                    onClick={() => removeFromCart(item.productId)}>Remove</button>
                </div>
              </div>
            ))
          }
        </div>

        {/* Totals */}
        <div className="border-t p-3 shrink-0" style={{ borderColor: 'var(--border-lt)' }}>
          <div className="flex justify-between text-xs mb-1"><span className="text-t3">Subtotal</span><span className="font-mono">{fmtKes(cartSubtotal)}</span></div>
          <div className="flex justify-between text-xs mb-2"><span className="text-t3">VAT 16%</span><span className="font-mono text-t3">{fmtKes(cartTax)}</span></div>
          <div className="flex justify-between text-base font-bold mb-4 pt-1 border-t" style={{ borderColor: 'var(--border-lt)' }}>
            <span>Total</span><span className="font-mono text-lg" style={{ color: '#10B981' }}>{fmtKes(cartTotal)}</span>
          </div>

          {/* Payment method */}
          <div className="grid grid-cols-3 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 mb-4">
            {(['mpesa', 'cash', 'card'] as const).map(m => (
              <button key={m} onClick={() => setPayMethod(m)}
                className="py-2 sm:py-1.5 rounded-lg text-[10px] sm:text-sm font-semibold uppercase cursor-pointer transition-all min-h-[40px]"
                style={{
                  background: payMethod === m ? '#E8F3FA' : 'var(--bg-surface)',
                  color: payMethod === m ? '#1B2762' : 'var(--text-3)',
                  border: `1px solid ${payMethod === m ? '#A8D4E8' : 'var(--border-lt)'}`,
                  fontWeight: payMethod === m ? 600 : 400,
                }}>
                {m === 'mpesa' ? '📱 M-Pesa' : m === 'cash' ? '💵 Cash' : '💳 Card'}
              </button>
            ))}
          </div>

          <button className="btn-primary w-full py-3 text-sm font-semibold min-h-[48px]" onClick={charge}
            style={{ background: cart.length > 0 ? '#12B76A' : '#E5E7EB', color: cart.length > 0 ? '#fff' : 'var(--text-3)', cursor: cart.length > 0 ? 'pointer' : 'default' }}>
            {cart.length > 0 ? `Charge ${fmtKes(cartTotal)}` : 'Add items to cart'}
          </button>
        </div>
      </div>

      {/* Receipt modal */}
      {receiptOrder && (
        <Modal title="Order Complete" subtitle="Transaction successful" width={480} onClose={() => setReceiptOrder(null)}>
          <div className="text-center py-4">
            <div className="text-5xl mb-4">✅</div>
            <p className="text-lg font-semibold mb-2">{receiptOrder.payment.toUpperCase()} Payment Received</p>
            <p className="text-3xl font-bold font-mono" style={{ color: '#10B981' }}>{fmtKes(receiptOrder.total)}</p>
          </div>
          <div className="flex flex-col gap-1.5 mb-4 max-h-48 overflow-y-auto">
            {receiptOrder.lines.map((l, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-t2">{l.productName} ×{l.qty}</span>
                <span className="font-mono font-semibold">{fmtKes(l.subtotal)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-bold pt-2 border-t mt-2" style={{ borderColor: 'var(--border-lt)' }}>
              <span>Total (incl. VAT)</span><span className="font-mono text-lg">{fmtKes(receiptOrder.total)}</span>
            </div>
          </div>
          <div className="flex gap-2 justify-end flex-wrap">
            <button className="btn-outline min-h-[40px] flex-1 sm:flex-none" onClick={() => window.print()}>🖨️ Print Receipt</button>
            <button className="btn-primary min-h-[40px] flex-1 sm:flex-none" onClick={() => { setReceiptOrder(null); scanRef.current?.focus() }}>New Order</button>
          </div>
        </Modal>
      )}

      {showCloseSession && (
        <Modal title="Close Session" width={480} onClose={() => setShowCloseSession(false)}>
          <Field label="Closing Cash Count (KES)"><Input value={closingCash} onChange={setClosingCash} type="number" autoFocus /></Field>
          <div className="p-3 rounded text-xs" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
            <p>Session orders: <strong>{posOrders.length}</strong></p>
            <p className="mt-1">Total revenue: <strong className="font-mono" style={{ color: '#10B981' }}>{fmtKes(posOrders.reduce((a, o) => a + o.total, 0))}</strong></p>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => setShowCloseSession(false)}>Cancel</button>
            <button className="btn-primary" style={{ background: '#F04438' }} onClick={() => { closePOSSession(Number(closingCash)); setShowCloseSession(false) }}>Close Session</button>
          </div>
        </Modal>
      )}

      {/* Close session button */}
      <div className="fixed top-4 right-4 z-30 sm:top-3">
        <button className="btn-outline text-xs py-1.5 px-2.5 shadow-sm min-h-[36px]" style={{ color: '#EF4444', borderColor: '#FCA5A5' }}
          onClick={() => setShowCloseSession(true)}>Close Session</button>
      </div>
    </div>
  )
}
