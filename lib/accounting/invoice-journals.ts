import 'server-only'
import { persistStoreJournalEntry } from '@/lib/accounting/journal-service'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'

type InvoiceLike = {
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
  lines?: Array<{ productId?: string; subtotal?: number; accountCode?: string; description?: string }>
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

/**
 * Build + persist invoice posting journal to Prisma (idempotent on ref).
 * Uses existing Deed CoA labels (1800 AR, revenue buckets, VAT) — not a greenfield CoA.
 */
export async function postInvoiceJournalToPrisma(invoice: InvoiceLike, opts?: { createdById?: string }) {
  const ref = String(invoice.ref || invoice.invoiceNumber || invoice.id)
  const partner = invoice.partnerName || invoice.clientName || 'Customer'
  const total = money(invoice.total ?? invoice.totalAmount)
  const subtotal = money(invoice.subtotal ?? total)
  const tax = money(invoice.taxTotal ?? invoice.taxAmount)
  const isVendor = invoice.type === 'vendor_bill'

  if (isVendor) {
    const costLabel = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.costAccountCode, [])
    const lines = [
      { account: costLabel, description: `Purchase: ${partner}`, debit: subtotal, credit: 0 },
      ...(tax > 0 ? [{ account: '1150 - VAT Input', description: `VAT input on ${ref}`, debit: tax, credit: 0 }] : []),
      { account: '3000 - Accounts Payable', description: `AP: ${partner}`, debit: 0, credit: total },
    ]
    return persistStoreJournalEntry({
      ref: `JRN/${ref}`,
      source: 'bill',
      description: `Bill ${ref} — ${partner}`,
      invoiceId: invoice.id,
      lines,
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
  }, { createdById: params.createdById, journalCode: isVendor ? 'PUR' : (String(params.method).toLowerCase() === 'cash' ? 'CSH' : 'BNK') })
}
