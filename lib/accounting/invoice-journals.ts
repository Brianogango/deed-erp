import 'server-only'
import { persistStoreJournalEntry, reverseJournalEntry } from '@/lib/accounting/journal-service'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'
import {
  buildVendorBillPerpetualLines,
  buildVendorCreditPerpetualLines,
} from '@/lib/accounting/vendor-bill-perpetual'
import { loadAppState } from '@/lib/server-store'
import { inferProductKind } from '@/lib/product-kind'
import {
  CUSTOMER_CREDITS_ACCOUNT,
  CUSTOMER_DEPOSITS_ACCOUNT,
} from '@/lib/accounting/liability-accounts'

export type InvoiceLike = {
  id: string
  ref?: string
  invoiceNumber?: string
  type?: string
  partnerName?: string
  clientName?: string
  total?: number
  totalAmount?: number
  subtotal?: number
  taxTotal?: number
  taxAmount?: number
  purchaseOrderId?: string
  lines?: Array<{
    productId?: string
    qty?: number
    unitPrice?: number
    subtotal?: number
    accountCode?: string
    description?: string
  }>
}

function money(n: unknown) {
  return Math.round(Number(n || 0) * 100) / 100
}

function methodAccountLabel(method?: string): string {
  switch (String(method || '').toLowerCase()) {
    case 'mpesa': return '2211 - Petty Cash / Mobile Money'
    case 'bank_transfer':
    case 'bank': return '2201 - ABSA Bank'
    case 'cash':
    default: return '2211 - Petty Cash / Mobile Money'
  }
}

function isCustomerCreditMethod(method?: string) {
  const m = String(method || '').toLowerCase()
  return m === 'customer_credit' || m === 'credit_note' || m === 'credit'
}

function isDepositApplyMethod(method?: string) {
  const m = String(method || '').toLowerCase()
  return m === 'deposit' || m === 'deposit_apply' || m === 'customer_deposit'
}

async function isPerpetualValuationEnabled(): Promise<boolean> {
  try {
    const state = await loadAppState(['deed_systemSettings'])
    const ss = state.deed_systemSettings as { invAutomatedValuation?: boolean } | null
    if (ss && typeof ss === 'object' && ss.invAutomatedValuation === false) return false
  } catch { /* default on */ }
  return true
}

async function resolveVendorBillLineMeta(invoice: InvoiceLike) {
  const state = await loadAppState(['deed_products', 'deed_purchaseOrders'])
  const products = Array.isArray(state.deed_products) ? state.deed_products as any[] : []
  const pos = Array.isArray(state.deed_purchaseOrders) ? state.deed_purchaseOrders as any[] : []
  const po = invoice.purchaseOrderId
    ? pos.find(p => p?.id === invoice.purchaseOrderId)
    : null
  const poLines: any[] = Array.isArray(po?.lines) ? po.lines : []

  return (invoice.lines || []).map(line => {
    const product = products.find(p => p?.id === line.productId)
    const kind = inferProductKind({
      productKind: product?.productKind,
      category: product?.category,
      unit: product?.unit,
      trackingMethod: product?.trackingMethod,
      requiresSerial: product?.requiresSerial,
    })
    const isStocked = kind === 'storable' || kind === 'consumable'
    const poLine = poLines.find(l => l.productId && line.productId && l.productId === line.productId)
    return {
      productId: line.productId,
      qty: Math.abs(Number(line.qty) || 0),
      unitPrice: Math.abs(Number(line.unitPrice) || 0),
      subtotal: Math.abs(Number(line.subtotal) || 0),
      accountCode: line.accountCode,
      isStocked: Boolean(invoice.purchaseOrderId) && isStocked,
      receiptUnitCost: Math.max(0, Number(poLine?.unitPrice ?? line.unitPrice) || 0),
    }
  })
}

export function invoiceJournalRef(invoice: Pick<InvoiceLike, 'ref' | 'invoiceNumber' | 'id'>) {
  return `JRN/${String(invoice.ref || invoice.invoiceNumber || invoice.id)}`
}

/**
 * Build + persist invoice posting journal to Prisma (idempotent on ref).
 * Vendor bills with PO + automated valuation clear GRNI instead of double-expensing.
 */
export async function postInvoiceJournalToPrisma(invoice: InvoiceLike, opts?: { createdById?: string }) {
  const ref = String(invoice.ref || invoice.invoiceNumber || invoice.id)
  const partner = invoice.partnerName || invoice.clientName || 'Customer'
  const total = money(invoice.total ?? invoice.totalAmount)
  const subtotal = money(invoice.subtotal ?? total)
  const tax = money(invoice.taxTotal ?? invoice.taxAmount)
  const isVendor = invoice.type === 'vendor_bill'
  const isCredit = isVendor && total < 0

  if (isVendor) {
    const perpetual = Boolean(invoice.purchaseOrderId) && (await isPerpetualValuationEnabled())
    const lineMeta = await resolveVendorBillLineMeta(invoice)
    const built = isCredit
      ? buildVendorCreditPerpetualLines({
          partnerName: partner,
          ref,
          subtotal,
          taxTotal: tax,
          total,
          lines: lineMeta,
          perpetual,
        })
      : buildVendorBillPerpetualLines({
          partnerName: partner,
          ref,
          subtotal,
          taxTotal: tax,
          total,
          lines: lineMeta,
          perpetual,
        })
    return persistStoreJournalEntry({
      ref: `JRN/${ref}`,
      source: 'bill',
      description: `${isCredit ? 'Vendor credit' : 'Bill'} ${ref} — ${partner}`,
      invoiceId: invoice.id,
      lines: built.map(l => ({
        account: l.account,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    }, { createdById: opts?.createdById, journalCode: 'PUR' })
  }

  const saleLabel = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, [])
  const lines = [
    { account: '1800 - Accounts Receivable', description: `AR: ${partner}`, debit: total, credit: 0 },
    { account: saleLabel, description: `Revenue: ${ref}`, debit: 0, credit: subtotal },
    ...(tax > 0 ? [{ account: '3301 - Output VAT Payable', description: `VAT on ${ref}`, debit: 0, credit: tax }] : []),
  ]
  return persistStoreJournalEntry({
    ref: `JRN/${ref}`,
    source: 'invoice',
    description: `Invoice ${ref} — ${partner}`,
    invoiceId: invoice.id,
    lines,
  }, { createdById: opts?.createdById, journalCode: 'SAL' })
}

export async function postInvoicePaymentJournalToPrisma(params: {
  invoice: InvoiceLike
  amount: number
  paymentId: string
  method?: string
  createdById?: string
}) {
  const ref = String(params.invoice.ref || params.invoice.invoiceNumber || params.invoice.id)
  const partner = params.invoice.partnerName || params.invoice.clientName || 'Customer'
  const amount = money(params.amount)
  const isVendor = params.invoice.type === 'vendor_bill'
  const method = String(params.method || '').toLowerCase()

  if (!isVendor && isCustomerCreditMethod(method)) {
    return persistStoreJournalEntry({
      ref: `JRN/PAY/${ref}/${params.paymentId}`.slice(0, 80),
      source: 'payment',
      description: `Customer credit applied to ${ref} — ${partner}`,
      invoiceId: params.invoice.id,
      paymentId: params.paymentId,
      lines: [
        { account: CUSTOMER_CREDITS_ACCOUNT, description: `Apply credit: ${partner}`, debit: amount, credit: 0 },
        { account: '1800 - Accounts Receivable', description: `AR settlement: ${ref}`, debit: 0, credit: amount },
      ],
    }, { createdById: params.createdById, journalCode: 'SAL' })
  }

  if (!isVendor && isDepositApplyMethod(method)) {
    return persistStoreJournalEntry({
      ref: `JRN/PAY/${ref}/${params.paymentId}`.slice(0, 80),
      source: 'payment',
      description: `Deposit applied to ${ref} — ${partner}`,
      invoiceId: params.invoice.id,
      paymentId: params.paymentId,
      lines: [
        { account: CUSTOMER_DEPOSITS_ACCOUNT, description: `Clear deposit liability: ${partner}`, debit: amount, credit: 0 },
        { account: '1800 - Accounts Receivable', description: `AR settlement: ${ref}`, debit: 0, credit: amount },
      ],
    }, { createdById: params.createdById, journalCode: 'SAL' })
  }

  const bank = methodAccountLabel(params.method)
  const lines = isVendor
    ? [
        { account: '3000 - Accounts Payable', description: `AP settlement: ${partner}`, debit: amount, credit: 0 },
        { account: bank, description: `Payment out: ${ref}`, debit: 0, credit: amount },
      ]
    : [
        { account: bank, description: `Received from ${partner}`, debit: amount, credit: 0 },
        { account: '1800 - Accounts Receivable', description: `AR settlement: ${ref}`, debit: 0, credit: amount },
      ]

  return persistStoreJournalEntry({
    ref: `JRN/PAY/${ref}/${params.paymentId}`.slice(0, 80),
    source: isVendor ? 'purchase_payment' : 'payment',
    description: `Payment for ${ref} — ${partner}`,
    invoiceId: params.invoice.id,
    paymentId: params.paymentId,
    lines,
  }, { createdById: params.createdById, journalCode: isVendor ? 'PUR' : (method === 'cash' ? 'CSH' : 'BNK') })
}

/** Credit note liability from cancelling a paid customer invoice. */
export async function postCustomerCreditJournalToPrisma(params: {
  invoice: InvoiceLike
  creditRef: string
  amount: number
  createdById?: string
}) {
  const invRef = String(params.invoice.ref || params.invoice.invoiceNumber || params.invoice.id)
  const partner = params.invoice.partnerName || params.invoice.clientName || 'Customer'
  const amount = money(params.amount)
  const total = money(params.invoice.total ?? params.invoice.totalAmount) || amount
  const subtotal = money(params.invoice.subtotal ?? total)
  const tax = money(params.invoice.taxTotal ?? params.invoice.taxAmount)
  const subtotalRatio = total > 0 ? subtotal / total : 1
  const taxRatio = total > 0 ? tax / total : 0
  const revenueReversal = money(amount * subtotalRatio)
  const vatReversal = money(amount * taxRatio)
  const saleLabel = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, [])

  return persistStoreJournalEntry({
    ref: `JRN/${params.creditRef}`,
    source: 'manual',
    description: `Credit note ${params.creditRef} for cancelled paid invoice ${invRef}`,
    invoiceId: params.invoice.id,
    lines: [
      { account: saleLabel, description: `Credit note ${params.creditRef}: reverse ${invRef}`, debit: revenueReversal, credit: 0 },
      ...(vatReversal > 0
        ? [{ account: '3301 - Output VAT Payable', description: `Credit VAT ${params.creditRef}`, debit: vatReversal, credit: 0 }]
        : []),
      { account: CUSTOMER_CREDITS_ACCOUNT, description: `Customer credit: ${partner}`, debit: 0, credit: amount },
    ],
  }, { createdById: params.createdById, journalCode: 'SAL' })
}

/** Clear deposit liability into AR when goods are collected against an invoice. */
export async function postDepositClearJournalToPrisma(params: {
  depositRef: string
  depositId: string
  amount: number
  partnerName: string
  invoiceId?: string
  invoiceRef?: string
  createdById?: string
}) {
  const amount = money(params.amount)
  if (amount <= 0) return null
  const creditAccount = params.invoiceId
    ? '1800 - Accounts Receivable'
    : formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, [])
  const creditDesc = params.invoiceId
    ? `AR settlement via deposit ${params.depositRef}${params.invoiceRef ? ` → ${params.invoiceRef}` : ''}`
    : `Revenue recognition on deposit collect ${params.depositRef}`

  return persistStoreJournalEntry({
    ref: `JRN/DEPCLR/${params.depositRef}`.slice(0, 80),
    source: 'manual',
    description: `Deposit collected — clear liability ${params.depositRef}`,
    invoiceId: params.invoiceId,
    lines: [
      { account: CUSTOMER_DEPOSITS_ACCOUNT, description: `Clear deposit: ${params.partnerName}`, debit: amount, credit: 0 },
      { account: creditAccount, description: creditDesc, debit: 0, credit: amount },
    ],
  }, { createdById: params.createdById, journalCode: 'SAL' })
}

/** Reverse the posting journal for an invoice (reset / unpaid cancel / void). */
export async function reverseInvoiceJournalInPrisma(invoice: InvoiceLike, userId?: string) {
  const ref = invoiceJournalRef(invoice)
  try {
    return await reverseJournalEntry(ref, userId)
  } catch (err: any) {
    if (String(err?.code) === 'P2025' || /No .* found/i.test(String(err?.message || ''))) {
      return null
    }
    throw err
  }
}
