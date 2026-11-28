import type { BankAccount, CompanySettings, Contact } from '@/lib/store'
import { downloadCommercialPdf } from '@/lib/commercial-pdf'
import type { ExchangeDocumentView } from '@/lib/after-sales/exchange-document'

const kes = (n: number) => `KSh ${Math.abs(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`

/** How the exchange's balance was settled, in a sentence for the note. */
export function exchangeSettlementText(view: ExchangeDocumentView, invoiceRef?: string, creditRef?: string): string {
  if (view.balance > 0) return `Balance of ${kes(view.balance)} payable by the customer${invoiceRef ? ` on invoice ${invoiceRef}` : ''}.`
  if (view.balance < 0) return `${kes(view.balance)} owed to the customer${creditRef ? ` as store credit ${creditRef}` : ''}.`
  return 'Even exchange: nothing to pay either way.'
}

/**
 * The exchange note: both machines (serials, values), the balance and how it
 * was settled, with a line for the customer to sign for the machine given.
 * For exchanges with no invoice (store credit or even) it is the only paper.
 */
export async function downloadExchangeNotePdf(opts: {
  view: ExchangeDocumentView
  customerName: string
  contact?: Contact
  company: CompanySettings
  bankAccounts?: BankAccount[]
  settlement: string
}) {
  const { view, contact } = opts
  await downloadCommercialPdf({
    title: 'Exchange Note',
    ref: view.ref,
    date: view.date,
    sourceRef: view.originalSORef,
    customerName: opts.customerName,
    customerAddress: [contact?.address, contact?.city].filter(Boolean).join(', ') || undefined,
    customerCountry: contact?.country || 'Kenya',
    customerPhone: contact?.phone || contact?.mobile || undefined,
    customerEmail: contact?.email || undefined,
    lines: view.rows.map(r => ({ description: r.description, qty: r.qty, unitPrice: r.unitPrice, taxRate: 0, subtotal: r.subtotal, serial: r.serial })),
    subtotal: view.balance,
    taxTotal: 0,
    total: view.balance,
    notes: opts.settlement,
    exchange: { ref: view.ref, returned: view.returned, given: view.given },
    showPaymentDetails: false,
    showReceiptAcknowledgement: true,
  }, opts.company, opts.bankAccounts ?? [], `Exchange Note - ${view.ref}.pdf`)
}
