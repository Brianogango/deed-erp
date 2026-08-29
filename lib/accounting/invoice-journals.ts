import 'server-only'
import prisma from '@/lib/prisma'
import { createJournalEntry, persistStoreJournalEntry, reverseJournalEntry, type CreateJournalEntryInput } from '@/lib/accounting/journal-service'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel, aggregateLinesByAccount } from '@/lib/product-accounts'
import { nextInvoiceJournalRef } from '@/lib/finance-invoice'
import {
  buildVendorBillPerpetualLines,
  buildVendorCreditPerpetualLines,
} from '@/lib/accounting/vendor-bill-perpetual'
import { loadAppState } from '@/lib/server-store'
import { inferProductKind } from '@/lib/product-kind'
import { isPpeCostAccount } from '@/lib/company-property-ppe'
import {
  CUSTOMER_CREDITS_ACCOUNT,
  CUSTOMER_DEPOSITS_ACCOUNT,
} from '@/lib/accounting/liability-accounts'
import { labelForRole } from '@/lib/accounting/coa-roles'

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
  repairId?: string | null
  invoiceDate?: string | Date
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
    const ppeAccountCode = isPpeCostAccount(line.accountCode) ? String(line.accountCode).trim() : undefined
    return {
      productId: line.productId,
      qty: Math.abs(Number(line.qty) || 0),
      unitPrice: Math.abs(Number(line.unitPrice) || 0),
      subtotal: Math.abs(Number(line.subtotal) || 0),
      accountCode: line.accountCode,
      ppeAccountCode,
      isStocked: Boolean(invoice.purchaseOrderId) && isStocked && !ppeAccountCode,
      receiptUnitCost: Math.max(0, Number(poLine?.unitPrice ?? line.unitPrice) || 0),
    }
  })
}

export function invoiceJournalRef(invoice: Pick<InvoiceLike, 'ref' | 'invoiceNumber' | 'id'>) {
  return `JRN/${String(invoice.ref || invoice.invoiceNumber || invoice.id)}`
}

/**
 * Canonical posting uses `JRN/${number}`. After Reset to Draft the original
 * row stays (isReversed), so the next post must take `.../2`, `.../3`, …
 * If the canonical ref exists and is still live, return it so the journal
 * service can reject a double-post instead of silently minting a sibling.
 */
export async function allocateInvoiceJournalRef(canonical: string): Promise<string> {
  const existing = await prisma.journalEntry.findMany({
    where: {
      OR: [
        { ref: canonical },
        { ref: { startsWith: `${canonical}/` } },
      ],
    },
    select: { ref: true, isReversed: true },
  })
  const canonicalRow = existing.find(row => row.ref === canonical)
  if (!canonicalRow || !canonicalRow.isReversed) return canonical
  return nextInvoiceJournalRef(canonical, existing.map(row => row.ref))
}

/**
 * Build + persist invoice posting journal to Prisma (idempotent on ref).
 * Vendor bills with PO + automated valuation clear GRNI instead of double-expensing.
 */
export async function buildInvoiceJournalInput(
  invoice: InvoiceLike,
  opts?: { createdById?: string },
): Promise<CreateJournalEntryInput> {
  const ref = String(invoice.ref || invoice.invoiceNumber || invoice.id)
  const partner = invoice.partnerName || invoice.clientName || 'Customer'
  const total = money(invoice.total ?? invoice.totalAmount)
  const subtotal = money(invoice.subtotal ?? total)
  const tax = money(invoice.taxTotal ?? invoice.taxAmount)
  const isVendor = invoice.type === 'vendor_bill'
  const isCredit = isVendor && total < 0

  if (total <= 0 && !isCredit) {
    throw new Error(`Invoice ${ref} has no positive posting amount`)
  }

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
    return {
      ref: `JRN/${ref}`.slice(0, 80),
      journalCode: 'PUR',
      date: invoice.invoiceDate,
      description: `${isCredit ? 'Vendor credit' : 'Bill'} ${ref} — ${partner}`,
      sourceType: 'bill',
      sourceId: invoice.id,
      invoiceId: invoice.id,
      createdById: opts?.createdById,
      skipIfExists: false,
      lines: built.map(l => ({
        accountLabel: l.account,
        label: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    }
  }

  const saleLabel = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.saleAccountCode, [])
  // Revenue splits per line: product → category → company fallback. Repair
  // service lines (labor, logistics, diagnosis — no product) post to 5121
  // Hardware Support per the official chart.
  const isRepair = Boolean(invoice.repairId)
  const productState = await loadAppState(['deed_products'])
  const products = Array.isArray(productState.deed_products) ? productState.deed_products as any[] : []
  const revenueBuckets = aggregateLinesByAccount({
    lines: (invoice.lines ?? []).map(l => ({
      productId: l.productId,
      subtotal: money(l.subtotal),
      accountCode: l.accountCode ?? (isRepair && !l.productId ? '5121' : undefined),
    })),
    resolveProduct: (id) => products.find(p => p?.id === id),
    side: 'revenue',
    accounts: [],
  })
  const revenueJournalLines = revenueBuckets.length
    ? revenueBuckets.map(b => ({
        accountLabel: b.account,
        label: `Revenue: ${ref}`,
        debit: 0,
        credit: b.amount,
      }))
    : [{ accountLabel: saleLabel, label: `Revenue: ${ref}`, debit: 0, credit: subtotal }]
  return {
    ref: `JRN/${ref}`.slice(0, 80),
    journalCode: 'SAL',
    date: invoice.invoiceDate,
    description: `Invoice ${ref} — ${partner}`,
    sourceType: 'invoice',
    sourceId: invoice.id,
    invoiceId: invoice.id,
    createdById: opts?.createdById,
    skipIfExists: false,
    lines: [
      { accountLabel: labelForRole('ar'), label: `AR: ${partner}`, debit: total, credit: 0 },
      ...revenueJournalLines,
      ...(tax > 0 ? [{ accountLabel: labelForRole('output_vat'), label: `VAT on ${ref}`, debit: 0, credit: tax }] : []),
    ],
  }
}

/**
 * Canonical invoice posting path. There is no feature-flagged best-effort
 * branch anymore: all invoice journals use the same validated journal service.
 */
export async function postInvoiceJournalToPrisma(invoice: InvoiceLike, opts?: { createdById?: string }) {
  const input = await buildInvoiceJournalInput(invoice, opts)
  input.ref = await allocateInvoiceJournalRef(input.ref)
  return createJournalEntry(input)
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
        { account: labelForRole('ar'), description: `AR settlement: ${ref}`, debit: 0, credit: amount },
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
        { account: labelForRole('ar'), description: `AR settlement: ${ref}`, debit: 0, credit: amount },
      ],
    }, { createdById: params.createdById, journalCode: 'SAL' })
  }

  const bank = methodAccountLabel(params.method)
  const lines = isVendor
    ? [
        { account: labelForRole('ap'), description: `AP settlement: ${partner}`, debit: amount, credit: 0 },
        { account: bank, description: `Payment out: ${ref}`, debit: 0, credit: amount },
      ]
    : [
        { account: bank, description: `Received from ${partner}`, debit: amount, credit: 0 },
        { account: labelForRole('ar'), description: `AR settlement: ${ref}`, debit: 0, credit: amount },
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
        ? [{ account: labelForRole('output_vat'), description: `Credit VAT ${params.creditRef}`, debit: vatReversal, credit: 0 }]
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
    ? labelForRole('ar')
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
  const live = await prisma.journalEntry.findFirst({
    where: {
      invoiceId: invoice.id,
      isReversed: false,
      sourceType: { in: ['invoice', 'bill'] },
      NOT: { ref: { startsWith: 'REV/' } },
    },
    orderBy: { postedAt: 'desc' },
    select: { ref: true },
  })
  const ref = live?.ref ?? invoiceJournalRef(invoice)
  try {
    return await reverseJournalEntry(ref, userId)
  } catch (err: any) {
    if (String(err?.code) === 'P2025' || /No .* found/i.test(String(err?.message || ''))) {
      return null
    }
    throw err
  }
}
