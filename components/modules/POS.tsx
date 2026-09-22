'use client'
import { useState, useRef, useEffect } from 'react'
import { useCommerceStore, useInventoryStore, fmtKes, fmtDate, isPosBankPayment } from '@/lib/store'
import { Modal, Field, Input, Select, Badge, ModuleSkeleton } from '@/components/ui'
import { PosTransactionHistory } from '@/components/pos/PosTransactionHistory'
import { SalespersonCloserField } from '@/components/sales/SalespersonCloserField'
import { CustomerPickerField } from '@/components/tradein/CustomerPickerField'
import {
  Fa, faCashRegister, faReceipt, faCamera, faCartShopping, faStar,
  faCircleCheck, faPrint, faMobileScreenButton, faMoneyBillWave, faBuildingColumns,
  faStore, faMagnifyingGlass, faMinus, faPlus,
} from '@/components/icons'
import { BarcodeScannerModal } from '@/components/BarcodeScanner'
import { matchPosScan, normalizeScanCode } from '@/lib/barcode-scan'
import { isOrphanedPosSession, posOrdersForSession } from '@/lib/pos-session'
import { loyaltyPointsEarned } from '@/lib/loyalty'
import { customerCreditBalance } from '@/lib/customer-credit-view'
import { canApplyCustomerCredit } from '@/lib/finance-controls'
import { resolvePosLineSerial } from '@/lib/pos-transaction-history'
import { unitSellingName } from '@/lib/reconfiguration/unit-selling-name'
import { productThumbUrl } from '@/lib/product-images'
import { PosProductThumb } from '@/components/pos/PosProductThumb'
import {
  darkenLogoForThermalPrint,
  receiptLogoSrc,
  resolvePosReceiptCustomer,
} from '@/lib/pos-receipt-print'
import { fetchMpesaStatus, sendMpesaStk, waitForMpesaStk } from '@/lib/mpesa/client'
import { normalizeMpesaPhone } from '@/lib/mpesa/phone'

const POS_MOBILE_PAGE_SIZE = 6

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
  bankAccounts?: { id: string; name: string; bankName?: string }[]
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
          {order.salespersonName && order.salespersonId && order.salespersonId !== order.createdByUserId ? (
            <p>Salesperson: {order.salespersonName}</p>
          ) : null}
          <p>Customer: {buyerName}</p>
        </div>
        <div className="text-right">
          <p>Date: {fmtDate(order.date)}</p>
          <p>Time: {order.createdAt ? new Date(order.createdAt).toLocaleTimeString('en-KE', {timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit'}) : '--:--'}</p>
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
        {order.customerCreditAmount ? (
          <div className="flex justify-between mb-1"><span>Client Credit</span><span>-{fmtKes(order.customerCreditAmount)}</span></div>
        ) : null}
        <div className="flex justify-between font-bold text-sm pt-2 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <span>FINAL TOTAL</span><span>{fmtKes(order.total)}</span>
        </div>
        <div className="flex justify-between mt-1 font-bold">
          <span>Amount Paid</span><span>{fmtKes(order.total)}</span>
        </div>
        <div className="flex justify-between mt-2">
          <span>Payment Mode</span>
          <span className="uppercase">{order.customerCreditAmount
            ? `${order.customerCreditAmount >= order.total ? 'client credit' : `client credit + ${isPosBankPayment(order.payment) ? 'bank' : order.payment}`}`
            : (isPosBankPayment(order.payment) ? 'bank' : order.payment)}</span>
        </div>
        {order.bankAccountId ? (
          <div className="flex justify-between mt-1 text-[11px]">
            <span>Bank</span>
            <span>{(() => { const b = bankAccounts?.find(b => b.id === order.bankAccountId); return b ? (b.bankName || b.name) : order.bankAccountId })()}</span>
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

  const { products, serials, contacts, invoices, createPOSOrder, posOrders, openPOSSession, closePOSSession, posSessionOpen, posSessionOpeningCash, posSessionId, posSessions, showToast, companySettings, getCustomerCreditStatus, bankAccounts, users, currentUserId, customerCredits, systemSettings } = useCommerceStore()
  const tenderBanks = bankAccounts.filter(b => b.active && b.id !== 'mpesa' && b.id !== 'cash')
  const { getStockByLocation, stockMoves } = useInventoryStore()

  const [cart, setCart] = useState<{ lineId: string; productId: string; productName: string; barcode: string; price: number; listPrice: number; qty: number; image: string; serialId?: string; serialNumber?: string }[]>([])
  const [scanInput, setScanInput] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [payMethod, setPayMethod] = useState<'' | 'cash' | 'mpesa' | 'bank'>('')
  const [mpesaPhone, setMpesaPhone] = useState('')
  const [darajaReady, setDarajaReady] = useState(false)
  const [stkStatus, setStkStatus] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [walkInBuyerName, setWalkInBuyerName] = useState('')
  const [showOpenSession, setShowOpenSession] = useState(false)
  const [showCloseSession, setShowCloseSession] = useState(false)
  const [openingCash, setOpeningCash] = useState('')
  const [closingCash, setClosingCash] = useState('')
  const [receiptOrder, setReceiptOrder] = useState<typeof posOrders[0] | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [redeemPoints, setRedeemPoints] = useState<number | ''>('')
  const [applyVat, setApplyVat] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [salespersonId, setSalespersonId] = useState('')
  const [salespersonName, setSalespersonName] = useState('')
  const [mobilePage, setMobilePage] = useState(1)
  const [useClientCredit, setUseClientCredit] = useState(false)
  const [clientCreditInput, setClientCreditInput] = useState('')
  const scanRef = useRef<HTMLInputElement>(null)
  const cashier = users.find(u => u.id === currentUserId)
  const canUseClientCredit = canApplyCustomerCredit(cashier?.role)

  useEffect(() => {
    if (salespersonId || !cashier?.id) return
    setSalespersonId(cashier.id)
    setSalespersonName(cashier.name || '')
  }, [cashier, salespersonId])

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
  const mobilePageCount = Math.max(1, Math.ceil(filteredProducts.length / POS_MOBILE_PAGE_SIZE))

  useEffect(() => { setMobilePage(1) }, [category, searchTerm])
  useEffect(() => {
    if (mobilePage > mobilePageCount) setMobilePage(mobilePageCount)
  }, [mobilePage, mobilePageCount])

  const cartSubtotal = cart.reduce((a, i) => a + i.price * i.qty, 0)
  const cartTax = applyVat && companySettings.vatRate > 0 ? Math.round(cartSubtotal * companySettings.vatRate / 100) : 0
  const cartTotalBeforePoints = cartSubtotal + cartTax
  const customerInfo = customers.find(c => c.id === customerId)
  const storeCredit = customerCreditBalance(customerCredits, customerId)
  const maxPoints = customerInfo ? Math.min(customerInfo.loyaltyPoints || 0, cartTotalBeforePoints) : 0
  const pointsToRedeem = Math.min(Number(redeemPoints) || 0, maxPoints)
  const cartTotal = cartTotalBeforePoints - pointsToRedeem
  const maxClientCredit = customerId ? Math.min(storeCredit, cartTotal) : 0
  const requestedClientCredit = useClientCredit ? Math.max(0, Number(clientCreditInput) || 0) : 0
  const clientCreditToApply = Math.min(requestedClientCredit, maxClientCredit)
  const paymentDue = Math.max(0, cartTotal - clientCreditToApply)
  const pointsToEarn = customerId ? loyaltyPointsEarned(cartTotal, systemSettings.posLoyaltyKesPerPoint) : 0

  useEffect(() => {
    if (!customerId || storeCredit <= 0) {
      setUseClientCredit(false)
      setClientCreditInput('')
    }
  }, [customerId, storeCredit])

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
      setSearch('')
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
      // Prefer this serial's live specs/price after a RAM or SSD change —
      // the catalog product name may still say 16GB/512GB.
      const unitName = unitSellingName({
        productName: product.name,
        specs: chosen.specs,
      })
      const unitPrice = Number(chosen.salePriceOverride) > 0 ? Number(chosen.salePriceOverride) : product.salePrice
      let added = false
      setCart(prev => {
        if (prev.some(i => i.serialId === chosen.id)) {
          showToast(`${chosen.serial} is already in cart`, 'info')
          return prev
        }
        added = true
        return [...prev, { lineId: chosen.id, productId: product.id, productName: unitName, barcode: product.barcode, price: unitPrice, listPrice: product.salePrice, qty: 1, image: productThumbUrl(product) ?? product.image ?? '', serialId: chosen.id, serialNumber: chosen.serial }]
      })
      if (added) showToast(`${unitName} (${chosen.serial}) added`, 'success')
    } else {
      setCart(prev => {
        const ex = prev.find(i => i.productId === product.id)
        if (ex) return prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i)
        return [...prev, { lineId: product.id, productId: product.id, productName: product.name, barcode: product.barcode, price: product.salePrice, listPrice: product.salePrice, qty: 1, image: productThumbUrl(product) ?? product.image ?? '' }]
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
  const activeSession = posSessions.find(session => session.id === posSessionId)
  const sessionOpenedTime = activeSession?.openedAt
    ? new Date(activeSession.openedAt).toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' })
    : null

  useEffect(() => {
    void fetchMpesaStatus()
      .then(s => setDarajaReady(s.configured))
      .catch(() => setDarajaReady(false))
  }, [])

  useEffect(() => {
    const fromCustomer = customerInfo?.mobile || customerInfo?.phone || ''
    if (fromCustomer) setMpesaPhone(fromCustomer)
  }, [customerInfo?.mobile, customerInfo?.phone])

  const charge = async () => {
    if (cart.length === 0) { showToast('Cart is empty', 'error'); return }
    if (!posSessionOpen) { showToast('No active POS session', 'error'); return }
    if (charging) return

    if (customerId) {
      const cs = getCustomerCreditStatus(customerId)
      if (cs.isLocked) { showToast(cs.message, 'error'); return }
    }

    if (useClientCredit && !canUseClientCredit) {
      showToast('Only Finance, Admin Officer, or Director can apply client credit', 'error')
      return
    }

    if (!payMethod) {
      showToast('Select a payment method (M-Pesa, Cash or Bank)', 'error')
      return
    }
    const tender = payMethod
    const selectedBankId = bankAccountId
    if (paymentDue > 0 && payMethod === 'bank' && !selectedBankId) {
      showToast('Select a bank account before charging', 'error')
      return
    }

    let mpesaReceipt: string | undefined
    if (paymentDue > 0 && payMethod === 'mpesa' && darajaReady) {
      const phone = normalizeMpesaPhone(mpesaPhone)
      if (!phone) {
        showToast('Enter the customer M-Pesa number (07XX …)', 'error')
        return
      }
    }

    setCharging(true)
    try {
      if (paymentDue > 0 && payMethod === 'mpesa' && darajaReady) {
        const phone = normalizeMpesaPhone(mpesaPhone) as string
        setStkStatus('Sending M-Pesa prompt…')
        const pushed = await sendMpesaStk({
          phone,
          amount: paymentDue,
          accountReference: 'POS',
          transactionDesc: 'POS sale',
          source: 'pos',
        })
        setStkStatus(pushed.customerMessage || 'Ask the customer to enter their M-Pesa PIN')
        const settled = await waitForMpesaStk(pushed.checkoutRequestId)
        if (settled.status !== 'success') {
          showToast(settled.resultDesc || 'M-Pesa prompt was not completed', 'error')
          setStkStatus('')
          return
        }
        mpesaReceipt = settled.mpesaReceipt || settled.checkoutRequestId
        setStkStatus(settled.mpesaReceipt ? `Paid ${settled.mpesaReceipt}` : 'M-Pesa confirmed')
      }

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
        tender,
        customerId || undefined,
        (customerName || walkInBuyerName.trim()) || undefined,
        pointsToRedeem || 0,
        applyVat,
        {
          ...(payMethod === 'bank'
            ? { bankAccountId: selectedBankId, paymentReference: paymentReference.trim() || undefined }
            : {}),
          ...(payMethod === 'mpesa' && mpesaReceipt
            ? { paymentReference: mpesaReceipt }
            : {}),
          salespersonId: salespersonId || cashier?.id,
          salespersonName: salespersonName || cashier?.name,
          customerCreditAmount: clientCreditToApply || undefined,
        },
      )

      if (order) {
        setCart([])
        setCustomerId('')
        setCustomerName('')
        setWalkInBuyerName('')
        setRedeemPoints('')
        setPaymentReference('')
        setPayMethod('')
        setBankAccountId('')
        setUseClientCredit(false)
        setClientCreditInput('')
        setStkStatus('')
        setReceiptOrder(order)
        setIsPrinting(true)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'M-Pesa prompt failed', 'error')
      setStkStatus('')
    } finally {
      setCharging(false)
    }
  }

  // Auto-focus scan input
  useEffect(() => { scanRef.current?.focus() }, [posSessionOpen])

  if (!mounted) return <ModuleSkeleton />
  if (isPrinting && receiptOrder) return <ReceiptPrintView order={receiptOrder} companySettings={companySettings} bankAccounts={bankAccounts} serials={serials} stockMoves={stockMoves} invoices={invoices} onDone={() => setIsPrinting(false)} />

  return (
    <div className="pos-page">
      {/* Boot screen if no session */}
      {!posSessionOpen && (
        <div className="pos-boot">
          <div className="pos-boot-icon" aria-hidden="true"><Fa icon={faStore} /></div>
          <p className="pos-boot-eyebrow">Deed retail workspace</p>
          <h2 className="pos-boot-title">Point of Sale</h2>
          <p className="pos-boot-copy">Open a session to start scanning products, receiving payments, and managing your till.</p>
          <button type="button" className="pos-boot-action" onClick={() => setShowOpenSession(true)}>Open new session</button>
          {showOpenSession && (
            <Modal title="Open Session" subtitle="Enter opening cash balance" width={380} onClose={() => setShowOpenSession(false)}>
              <Field label="Opening Cash Count (KES)" required><Input value={openingCash} onChange={setOpeningCash} type="number" autoFocus /></Field>
              <button
                type="button"
                className="pos-session-submit"
                disabled={openingSession}
                onClick={() => {
                  const opening = openingCash.trim() === '' ? NaN : Number(openingCash)
                  if (!Number.isFinite(opening) || opening < 0) {
                    showToast(openingCash.trim() === '' ? 'Enter the opening cash count (KES) — use 0 if the till is empty' : 'Opening cash must be a number of 0 or more', 'error')
                    return
                  }
                  setOpeningSession(true)
                  try {
                    openPOSSession(opening)
                    setOpeningCash('')
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
        <div className="pos-workspace">
          {/* Left — Products */}
          <section className={`pos-products-pane ${cartOpen ? 'is-mobile-hidden' : ''}`}>
            {/* Header with History Button */}
            <header className="pos-terminal-header">
              <div className="pos-terminal-heading">
                <span className="pos-terminal-icon" aria-hidden="true"><Fa icon={faCashRegister} /></span>
                <div className="min-w-0">
                  <h1 className="pos-terminal-title">Point of Sale</h1>
                  <p className="pos-terminal-meta">
                    <span>{companySettings.city || 'Nairobi'} store</span>
                    <span aria-hidden="true">·</span>
                    <span className="pos-session-active">Session active</span>
                    {sessionOpenedTime ? <><span aria-hidden="true">·</span><span>Opened {sessionOpenedTime}</span></> : null}
                  </p>
                </div>
              </div>
              <div className="pos-terminal-actions">
                <button type="button" className="pos-history-action" onClick={() => setShowHistory(true)}>
                  <Fa icon={faReceipt} aria-hidden="true" />
                  <span>Transaction history</span>
                </button>
                <button type="button" className="pos-close-action" onClick={() => setShowCloseSession(true)}>
                  <span aria-hidden="true">×</span>
                  <span>Close session</span>
                </button>
              </div>
            </header>

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
            {/* Scanner and product search */}
            <div className="pos-scan-area">
              <div className="pos-scan-control">
                <span className="pos-scan-leading" aria-hidden="true"><Fa icon={faMagnifyingGlass} /></span>
                <input
                  ref={scanRef}
                  className="pos-scan-input"
                  placeholder="Scan barcode, serial, SKU or product"
                  value={scanInput}
                  onChange={e => {
                    setScanInput(e.target.value)
                    setSearch(e.target.value)
                  }}
                  onKeyDown={handleScanKey}
                  aria-label="Scan or search products"
                />
                <button
                  type="button"
                  className="pos-camera-action"
                  onClick={() => setShowCamera(true)}
                  title="Open phone camera scanner"
                  aria-label="Open phone camera scanner"
                >
                  <Fa icon={faCamera} />
                </button>
              </div>
              <span className="pos-scanner-ready"><span aria-hidden="true" />Scanner ready</span>
              <p className="pos-scan-help">Serialized stock must be scanned from the unit label.</p>
            </div>

            <BarcodeScannerModal
              open={showCamera}
              onClose={() => setShowCamera(false)}
              title="Scan product or unit label"
              hint="Use the rear camera. Good light helps. Serial stock: scan the unit QR/barcode on the device label."
              onScan={code => {
                processScan(code)
              }}
            />

            <div className="pos-category-tabs" role="tablist" aria-label="Product categories">
              {categories.map(c => (
                <button key={c} onClick={() => { setCategory(c); setMobilePage(1) }}
                  className="pos-category-tab"
                  role="tab"
                  aria-selected={category === c}
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
            <div className="pos-product-scroll">
              <div className="pos-product-grid">
                {filteredProducts.map((product, productIndex) => {
                  const matchedSerial = serialMatchByProduct.get(product.id)
                  const productMobilePage = Math.floor(productIndex / POS_MOBILE_PAGE_SIZE) + 1
                  return (
                    <button
                      type="button"
                      key={product.id}
                      onClick={() => addToCart(product, matchedSerial?.id)}
                      className={`pos-product-card ${productMobilePage === mobilePage ? 'is-mobile-page-active' : 'is-mobile-page-hidden'}`}
                    >
                      <div className="pos-product-media" aria-hidden="true">
                        <PosProductThumb product={product} />
                      </div>
                      <div className="pos-product-copy">
                        <p className="pos-product-name" title={product.name}>{product.name}</p>
                        {matchedSerial && (
                          <p className="pos-product-serial" title={matchedSerial.serial}>
                            SN: {matchedSerial.serial}
                          </p>
                        )}
                        <p className="pos-product-price">{fmtKes(product.salePrice)}</p>
                        <div className="pos-product-meta">
                          <span>{getSellableQty(product.id, product.requiresSerial)} in stock</span>
                          {product.requiresSerial && <span className="pos-serial-label">Serial tracked</span>}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
              {filteredProducts.length > POS_MOBILE_PAGE_SIZE && (
                <nav className="pos-mobile-pagination" aria-label="Product pages">
                  <button
                    type="button"
                    onClick={() => setMobilePage(page => Math.max(1, page - 1))}
                    disabled={mobilePage <= 1}
                    aria-label="Previous product page"
                  >
                    ‹
                  </button>
                  <span>Page <strong>{mobilePage}</strong> of {mobilePageCount}</span>
                  <button
                    type="button"
                    onClick={() => setMobilePage(page => Math.min(mobilePageCount, page + 1))}
                    disabled={mobilePage >= mobilePageCount}
                    aria-label="Next product page"
                  >
                    ›
                  </button>
                </nav>
              )}
              {filteredProducts.length === 0 && (
                <div className="pos-empty-products">
                  <div className="text-4xl mb-2 text-t4" aria-hidden="true"><Fa icon={faMagnifyingGlass} /></div>
                  <p className="text-xs font-bold text-t3">No products found</p>
                </div>
              )}
            </div>
            <button
              type="button"
              className="pos-mobile-cart-bar"
              onClick={() => setCartOpen(true)}
              disabled={cart.length === 0}
              aria-label={cart.length > 0 ? `View cart with ${cart.length} items, total ${fmtKes(cartTotal)}` : 'Cart is empty'}
            >
              <span>{cart.length} {cart.length === 1 ? 'item' : 'items'} · {fmtKes(cartTotal)}</span>
              <strong>{cart.length > 0 ? 'View cart' : 'Cart empty'}</strong>
            </button>
          </section>

          {/* Right — Checkout */}
          <aside className={`pos-checkout-pane ${cartOpen ? '' : 'is-mobile-hidden'}`}>
            <header className="pos-checkout-header">
              <button type="button" className="pos-checkout-back" onClick={() => setCartOpen(false)} aria-label="Back to products">‹</button>
              <div className="min-w-0">
                <h2>Current sale</h2>
                <p>{cart.length} {cart.length === 1 ? 'item' : 'items'} · Session active</p>
              </div>
              <button
                type="button"
                className="pos-clear-cart"
                onClick={() => {
                  setCart([])
                  setCartOpen(false)
                }}
                disabled={cart.length === 0}
              >
                Clear
              </button>
            </header>

            <div className="pos-cart-lines">
              {cart.map(item => (
                <div key={item.lineId} className="pos-cart-line">
                  <button
                    type="button"
                    className="pos-cart-remove"
                    onClick={() => removeFromCart(item.lineId)}
                    aria-label={`Remove ${item.productName}`}
                  >
                    ×
                  </button>
                  <div className="pos-cart-media" aria-hidden="true">
                    <PosProductThumb product={{ id: item.productId, name: item.productName, image: item.image }} />
                  </div>
                  <div className="pos-cart-copy">
                    <p className="pos-cart-name" title={item.productName}>{item.productName}</p>
                    {item.serialNumber && <p className="pos-cart-serial">SN: {item.serialNumber}</p>}
                    <div className="pos-price-edit">
                      <span>KSh</span>
                      <input
                        type="number"
                        aria-label={`Price for ${item.productName}`}
                        value={item.price}
                        onChange={e => setPrice(item.lineId, Number(e.target.value))}
                      />
                      {item.price !== item.listPrice && <button type="button" onClick={() => resetPrice(item.lineId)}>Reset</button>}
                    </div>
                  </div>
                  <div className="pos-cart-line-actions">
                    <p>{fmtKes(item.price * item.qty)}</p>
                    <div className="pos-qty-control">
                      <button type="button" aria-label={`Decrease quantity of ${item.productName}`} onClick={() => setQty(item.lineId, item.qty - 1)}>
                        <Fa icon={faMinus} aria-hidden="true" />
                      </button>
                      <span>{item.qty}</span>
                      <button type="button" aria-label={`Increase quantity of ${item.productName}`} onClick={() => setQty(item.lineId, item.qty + 1)}>
                        <Fa icon={faPlus} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="pos-empty-cart">
                  <div className="text-3xl mb-3 opacity-20" aria-hidden="true"><Fa icon={faCartShopping} /></div>
                  <p className="text-xs text-t3 text-center px-4">Scan or click products to add to cart</p>
                </div>
              )}
            </div>

            <div className="pos-checkout-summary">
              <section className="pos-customer-section">
                <h3>Customer & sale</h3>
                <Field label="Customer (optional)">
                  <CustomerPickerField
                    compact
                    allowWalkIn
                    customerId={customerId}
                    customerName={customerName}
                    onSelect={(id, name) => {
                      setCustomerId(id)
                      setCustomerName(name)
                      setWalkInBuyerName('')
                      setUseClientCredit(false)
                      setClientCreditInput('')
                    }}
                    onClear={() => {
                      setCustomerId('')
                      setCustomerName('')
                      setUseClientCredit(false)
                      setClientCreditInput('')
                    }}
                  />
                </Field>
                {storeCredit > 0 && customerId && (
                  <div className={`pos-client-credit-panel ${useClientCredit ? 'is-active' : ''}`}>
                    <div className="pos-client-credit-head">
                      <div>
                        <p>Client Credit</p>
                        <span>{canUseClientCredit ? 'Available to apply to this sale' : 'Finance approval required'}</span>
                      </div>
                      <strong>{fmtKes(storeCredit)}</strong>
                    </div>
                    <button
                      type="button"
                      className="pos-client-credit-toggle"
                      disabled={!canUseClientCredit || cartTotal <= 0}
                      aria-pressed={useClientCredit}
                      onClick={() => {
                        const next = !useClientCredit
                        setUseClientCredit(next)
                        setClientCreditInput(next ? String(maxClientCredit) : '')
                      }}
                    >
                      <span className="pos-client-credit-check" aria-hidden="true">{useClientCredit ? '✓' : ''}</span>
                      <span>Use client credit</span>
                    </button>
                    {useClientCredit && (
                      <div className="pos-client-credit-apply">
                        <label htmlFor="pos-client-credit-amount">Amount to apply</label>
                        <div>
                          <input
                            id="pos-client-credit-amount"
                            type="number"
                            min="0"
                            max={maxClientCredit}
                            inputMode="decimal"
                            value={clientCreditInput}
                            onChange={e => setClientCreditInput(e.target.value)}
                            aria-label="Client credit amount to apply"
                          />
                          <button type="button" onClick={() => setClientCreditInput(String(maxClientCredit))}>Max</button>
                        </div>
                        <p>Remaining credit after sale <strong>{fmtKes(Math.max(0, storeCredit - clientCreditToApply))}</strong></p>
                      </div>
                    )}
                  </div>
                )}
                <SalespersonCloserField
                  variant="compact"
                  id="pos-closer"
                  valueId={salespersonId}
                  valueName={salespersonName}
                  createdByName={cashier?.name}
                  onChange={(id, name) => {
                    setSalespersonId(id)
                    setSalespersonName(name)
                  }}
                />
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
                  <div className="pos-loyalty-panel">
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
                <button type="button" className="pos-vat-toggle" onClick={() => setApplyVat(!applyVat)} aria-pressed={applyVat}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${applyVat ? 'bg-brand-blue border-brand-blue' : 'bg-white border-border'}`}>
                    {applyVat && <span className="text-[10px] text-white">✓</span>}
                  </div>
                  <span>Apply {companySettings.vatRate}% VAT</span>
                </button>
              </section>

              <section className="pos-order-totals">
                <div className="flex justify-between text-[11px] text-t3"><span>Subtotal</span><span>{fmtKes(cartSubtotal)}</span></div>
                {cartTax > 0 && <div className="flex justify-between text-[11px] text-t3"><span>VAT ({companySettings.vatRate}%)</span><span>{fmtKes(cartTax)}</span></div>}
                {pointsToRedeem > 0 && <div className="flex justify-between text-[11px] text-indigo-600 font-bold"><span>Points Discount</span><span>-{fmtKes(pointsToRedeem)}</span></div>}
                {clientCreditToApply > 0 && <div className="flex justify-between text-[11px] pos-client-credit-total"><span>Less: Client Credit</span><span>-{fmtKes(clientCreditToApply)}</span></div>}
                <div className="flex justify-between text-lg font-black text-t1 pt-1"><span>Total due</span><span>{fmtKes(paymentDue)}</span></div>
                {pointsToEarn > 0 && <p className="text-[10px] text-center font-bold text-indigo-600 pt-1">Earns {pointsToEarn} loyalty points</p>}
              </section>

              <section className="pos-payment-section">
                <h3>Payment method</h3>
                <div className="pos-payment-methods">
                {(['mpesa', 'cash', 'bank'] as const).map(m => (
                  <button key={m} type="button" onClick={() => {
                    setPayMethod(m)
                  }}
                    className="pos-payment-method"
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
              </section>
              {payMethod === 'mpesa' && darajaReady && (
                <div className="pos-bank-payment">
                  <Field label="M-Pesa number">
                    <Input
                      value={mpesaPhone}
                      onChange={setMpesaPhone}
                      placeholder="07XX XXX XXX"
                    />
                  </Field>
                  {stkStatus && <p className="text-[11px] text-t2 mt-1">{stkStatus}</p>}
                </div>
              )}
              {payMethod === 'bank' && (
                <div className="pos-bank-payment">
                  <Field label="Bank account" required>
                    <Select
                      value={bankAccountId}
                      onChange={setBankAccountId}
                      options={[{ value: '', label: 'Select bank account…' }, ...tenderBanks.map(b => ({ value: b.id, label: b.bankName || b.name }))]}
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
            </div>

            <div className="pos-checkout-footer">
              <button
                type="button"
                className="pos-charge-action"
                onClick={() => { void charge() }}
                disabled={cart.length === 0 || charging}
                style={{
                  background: cart.length > 0 ? 'var(--navy)' : 'var(--border-lt)',
                  color: cart.length > 0 ? '#FFFFFF' : 'var(--text-3)',
                  cursor: cart.length > 0 && !charging ? 'pointer' : 'default',
                }}
              >
                {charging
                  ? (stkStatus || 'Charging…')
                  : cart.length > 0
                    ? (paymentDue <= 0
                      ? (clientCreditToApply > 0
                        ? `Complete sale · ${fmtKes(clientCreditToApply)} credit`
                        : 'Complete sale · No payment due')
                      : payMethod === 'mpesa' && darajaReady
                        ? `Prompt ${fmtKes(paymentDue)}`
                        : `Charge ${fmtKes(paymentDue)}`)
                    : 'Add items to cart'}
              </button>
              <div className="pos-checkout-footer-meta">
                <button type="button" className="pos-back-products" onClick={() => setCartOpen(false)}>Back to products</button>
                <p className="pos-opening-cash">Opening cash <strong>{fmtKes(posSessionOpeningCash)}</strong></p>
              </div>
            </div>
          </aside>

          {/* Receipt modal */}
          {receiptOrder && (
            <Modal title="Order Complete" subtitle="Transaction successful" width={480} onClose={() => setReceiptOrder(null)}>
              {/* Receipt content is now in ReceiptPrintView, we can just show a summary here */}
              <div className="pos-payment-success"><div className="pos-payment-success-icon" style={{ color: 'var(--success)' }} aria-hidden="true"><Fa icon={faCircleCheck} /></div><p className="text-lg font-semibold mb-2">{(isPosBankPayment(receiptOrder.payment) ? 'BANK' : receiptOrder.payment.toUpperCase())} Payment Received</p>{receiptOrder.paymentReference ? <p className="text-xs text-t3 mt-1">Ref: {receiptOrder.paymentReference}</p> : null}<p className="text-3xl font-bold font-mono" style={{ color: 'var(--success)' }}>{fmtKes(receiptOrder.total)}</p>{receiptOrder.pointsEarned ? (<p className="text-sm font-semibold mt-2" style={{ color: 'var(--navy)' }}><Fa icon={faStar} /> +{receiptOrder.pointsEarned} Loyalty Points Earned!</p>) : null}</div>
              <div className="pos-payment-success-actions">
                <button className="btn-outline min-h-[40px] flex-1 sm:flex-none" onClick={() => setIsPrinting(true)}><Fa icon={faPrint} /> Print Receipt</button>
                <button className="btn-primary min-h-[40px] flex-1 sm:flex-none" onClick={() => { setReceiptOrder(null); setCartOpen(false); scanRef.current?.focus() }}>New Order</button>
              </div>
            </Modal>
          )}

          {showCloseSession && (() => {
            const liveSession = posSessions.find(s => s.id === posSessionId)
            const sessionOrders = posOrdersForSession(posOrders, posSessionId || '', liveSession?.openedAt)
            const tenderAmount = (o: typeof sessionOrders[number]) => Math.max(0, o.total - (o.customerCreditAmount || 0))
            const totalCash = sessionOrders.filter(o => o.payment === 'cash').reduce((a, o) => a + tenderAmount(o), 0)
            const totalMpesa = sessionOrders.filter(o => o.payment === 'mpesa').reduce((a, o) => a + tenderAmount(o), 0)
            const totalBank = sessionOrders.filter(o => isPosBankPayment(o.payment)).reduce((a, o) => a + tenderAmount(o), 0)
            const totalSales = sessionOrders.reduce((a, o) => a + o.total, 0)
            const expectedCash = posSessionOpeningCash + totalCash
            const counted = Number(closingCash) || 0
            const variance = counted - expectedCash
            return (
              <Modal title="Close Session" subtitle="Count till and post session settlement" width={480} onClose={() => setShowCloseSession(false)}>
                <Field label="Closing Cash Count (KES)"><Input value={closingCash} onChange={setClosingCash} type="number" autoFocus /></Field>
                <div className="pos-session-close-summary">
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
                    className="pos-session-close-confirm"
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
