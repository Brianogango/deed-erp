// @ts-nocheck
import { create } from 'zustand'
import { useLS } from './useLS'
import type { SaleOrder, SaleOrderLine, SOStatus, Invoice, InvoiceLine, InvoiceType, InvoiceStatus, Delivery, DeliveryLine, POSOrder, Quote, QuoteLineItem, QuoteStatus, Opportunity } from '../lib/store'
import type { Product } from '../lib/store'
import { seq } from '../lib/data'
import { calcSO } from '../lib/store'
import { now, addDays } from '../lib/data'

interface SalesState {
  // Sales Orders
  saleOrders: SaleOrder[]
  createSaleOrder: (customerId: string, customerName: string) => SaleOrder
  updateSaleOrder: (id: string, p: Partial<SaleOrder>) => void
  addSOLine: (orderId: string, product: Product, qty: number, discount?: number) => void
  assignSerialToSOLine: (orderId: string, lineId: string, serialId: string) => void
  removeSOLine: (orderId: string, lineId: string) => void
  confirmSO: (id: string) => void
  resetSOToDraft: (id: string) => void
  cancelSO: (id: string) => void
  deleteSaleOrder: (id: string) => void

  // Quotes
  quotes: Quote[]
  opportunities: Opportunity[]
  createQuote: (quote: Omit<Quote, 'id' | 'ref' | 'version' | 'issueDate' | 'viewCount' | 'createdBy' | 'createdByName'>) => Quote
  updateQuote: (id: string, p: Partial<Quote>) => void
  addQuoteLine: (quoteId: string, product: Product, qty: number, discount?: number, customPrice?: number) => void
  removeQuoteLine: (quoteId: string, lineId: string) => void
  sendQuote: (id: string) => void
  acceptQuote: (id: string) => void
  rejectQuote: (id: string, reason: string) => void
  convertQuoteToSaleOrder: (quoteId: string) => SaleOrder
  reviseQuote: (quoteId: string, changes: string) => Quote
  deleteQuote: (id: string) => void

  // Invoices & Deliveries
  invoices: Invoice[]
  deliveries: Delivery[]
  createInvoiceFromSO: (orderId: string) => Invoice
  updateInvoice: (id: string, p: Partial<Invoice>) => void
  postInvoice: (id: string) => void
  registerPayment: (invoiceId: string, amount: number) => void

  // POS
  posOrders: POSOrder[]
  posSessionOpen: boolean
  posSessionOpeningCash: number
  openPOSSession: (openingCash: number) => void
  closePOSSession: (closingCash: number) => void
  createPOSOrder: (lines: POSOrder['lines'], payment: POSOrder['payment'], customerId?: string, customerName?: string) => void
}

const SEED_SALE_ORDERS: SaleOrder[] = []
const SEED_QUOTES: Quote[] = []
const SEED_OPPORTUNITIES: Opportunity[] = []
const SEED_INVOICES: Invoice[] = []
const SEED_DELIVERIES: Delivery[] = []
const SEED_POS_ORDERS: POSOrder[] = []

export const useSalesStore = create<SalesState>((set: any, get: any) => ({
  saleOrders: SEED_SALE_ORDERS,
  quotes: SEED_QUOTES,
  opportunities: SEED_OPPORTUNITIES,
  invoices: SEED_INVOICES,
  deliveries: SEED_DELIVERIES,
  posOrders: SEED_POS_ORDERS,
  posSessionOpen: false,
  posSessionOpeningCash: 0,

  createSaleOrder: (customerId, customerName) => {
    const so: SaleOrder = {
      id: crypto.randomUUID(),
      ref: seq('SO', 'so'),
      status: 'quotation',
      customerId, customerName,
      date: now(),
      validUntil: addDays(now(), 30),
      lines: [],
      subtotal: 0, taxTotal: 0, total: 0,
      notes: '',
    }
    set((state) => ({ saleOrders: [...state.saleOrders, so] }))
    return so
  },

  updateSaleOrder: (id, p) => {
    set((state) => ({
      saleOrders: state.saleOrders.map(s => s.id === id ? { ...s, ...p } : s)
    }))
  },

  addSOLine: (orderId, product, qty, discount = 0) => {
    const order = get().saleOrders.find(s => s.id === orderId)
    if (!order) return
    const ex = order.lines.find(l => l.productId === product.id)
    let lines: SaleOrderLine[]
    if (ex) {
      lines = order.lines.map(l => l.productId === product.id 
        ? { ...l, qty: l.qty + qty, subtotal: Math.round(product.salePrice * (l.qty + qty) * (1 - l.discount / 100)) } 
        : l
      )
    } else {
      const sub = Math.round(product.salePrice * qty * (1 - discount / 100))
      lines = [...order.lines, {
        id: crypto.randomUUID(),
        productId: product.id,
        productName: product.name,
        qty, unitPrice: product.salePrice,
        discount, taxRate: product.taxRate,
        subtotal: sub,
        serialIds: [],
        accountCode: product.saleAccountCode
      }]
    }
    set((state) => ({
      saleOrders: state.saleOrders.map(s => s.id === orderId ? { ...s, lines, ...calcSO(lines) } : s)
    }))
  },

  assignSerialToSOLine: (orderId, lineId, serialId) => {
    set((state) => ({
      saleOrders: state.saleOrders.map(s => {
        if (s.id !== orderId) return s
        const lines = s.lines.map(l => {
          if (l.id !== lineId || l.serialIds.includes(serialId) || l.serialIds.length >= l.qty) return l
          return { ...l, serialIds: [...l.serialIds, serialId] }
        })
        return { ...s, lines }
      })
    }))
  },

  removeSOLine: (orderId, lineId) => {
    set((state) => ({
      saleOrders: state.saleOrders.map(s => {
        if (s.id !== orderId) return s
        const lines = s.lines.filter(l => l.id !== lineId)
        return { ...s, lines, ...calcSO(lines) }
      })
    }))
  },

  confirmSO: (id) => {
    // TODO: validation
    const so = get().saleOrders.find(s => s.id === id)
    if (!so) return
    set((state) => ({
      saleOrders: state.saleOrders.map(s => s.id === id ? { ...s, status: 'confirmed' } : s)
    }))
  },

  resetSOToDraft: (id) => {
    set((state) => ({
      saleOrders: state.saleOrders.map(s => s.id === id ? { ...s, status: 'quotation' } : s)
    }))
  },

  cancelSO: (id) => {
    set((state) => ({
      saleOrders: state.saleOrders.map(s => s.id === id ? { ...s, status: 'cancelled' } : s)
    }))
  },

  deleteSaleOrder: (id) => {
    set((state) => ({
      saleOrders: state.saleOrders.filter(s => s.id !== id)
    }))
  },

  // Quotes (simplified)
  createQuote: (quote) => {
    const q: Quote = {
      ...quote,
      id: crypto.randomUUID(),
      ref: seq('QTE', 'quote'),
      version: 1,
      issueDate: now(),
      viewCount: 0
    }
    set((state) => ({ quotes: [...state.quotes, q] }))
    return q
  },

  updateQuote: (id, p) => set((state) => ({
    quotes: state.quotes.map(q => q.id === id ? { ...q, ...p } : q)
  })),

  addQuoteLine: (quoteId, product, qty, discount, customPrice) => {
    // Implementation similar to addSOLine...
  },

  removeQuoteLine: (quoteId, lineId) => {
    // Implementation...
  },

  sendQuote: (id) => set((state) => ({
    quotes: state.quotes.map(q => q.id === id ? { ...q, status: 'sent' } : q)
  })),

  acceptQuote: (id) => set((state) => ({
    quotes: state.quotes.map(q => q.id === id ? { ...q, status: 'accepted' } : q)
  })),

  rejectQuote: (id, reason) => set((state) => ({
    quotes: state.quotes.map(q => q.id === id ? { ...q, status: 'rejected', rejectionReason: reason } : q)
  })),

  convertQuoteToSaleOrder: (quoteId) => {
    const quote = get().quotes.find(q => q.id === quoteId)
    if (!quote) return null as any
    return get().createSaleOrder(quote.companyId, quote.companyName)
  },

  reviseQuote: (quoteId, changes) => {
    // Implementation...
    return null as any
  },

  deleteQuote: (id) => set((state) => ({
    quotes: state.quotes.filter(q => q.id !== id)
  })),

  createInvoiceFromSO: (orderId) => {
    const so = get().saleOrders.find(s => s.id === orderId)
    if (!so) return null as any
    const inv: Invoice = {
      id: crypto.randomUUID(),
      ref: seq('INV', 'inv'),
      type: 'customer_invoice',
      status: 'draft',
      partnerId: so.customerId,
      partnerName: so.customerName,
      date: now(),
      dueDate: addDays(now(), 30),
      lines: so.lines.map(l => ({
        id: crypto.randomUUID(),
        description: `${l.productName} ×${l.qty}`,
        qty: l.qty,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        subtotal: l.subtotal
      })),
      subtotal: so.subtotal,
      taxTotal: so.taxTotal,
      total: so.total,
      amountPaid: 0,
      saleOrderId: orderId
    }
    set((state) => ({ invoices: [...state.invoices, inv] }))
    return inv
  },

  updateInvoice: (id, p) => set((state) => ({
    invoices: state.invoices.map(i => i.id === id ? { ...i, ...p } : i)
  })),

  postInvoice: (id) => set((state) => ({
    invoices: state.invoices.map(i => i.id === id ? { ...i, status: 'posted' } : i)
  })),

  registerPayment: (invoiceId, amount) => {
    set((state) => ({
      invoices: state.invoices.map(inv => {
        if (inv.id !== invoiceId) return inv
        const paid = inv.amountPaid + amount
        return { ...inv, amountPaid: paid, status: paid >= inv.total ? 'paid' : 'posted' }
      })
    }))
  },

  openPOSSession: (openingCash) => set({ posSessionOpen: true, posSessionOpeningCash: openingCash }),
  closePOSSession: (closingCash) => set({ posSessionOpen: false }),
  createPOSOrder: (lines, payment, customerId, customerName) => {
    const order: POSOrder = {
      id: crypto.randomUUID(),
      ref: seq('POS', 'pos'),
      sessionId: 'current',
      lines,
      subtotal: lines.reduce((sum, l) => sum + l.subtotal, 0),
      taxTotal: 0,
      total: lines.reduce((sum, l) => sum + l.subtotal, 0),
      payment,
      customerId,
      customerName,
      date: now()
    }
    set((state) => ({ posOrders: [...state.posOrders, order] }))
    return order
  }
}))

