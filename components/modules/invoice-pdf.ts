import { Invoice, SaleOrder, Delivery, SerialNumber, CompanySettings, BankAccount } from '@/lib/store'
import { generateCommercialDocumentHtml } from '@/lib/commercial-print-template'

export function generateInvoicesHtml(
  invs: Invoice[],
  saleOrders: SaleOrder[],
  deliveries: Delivery[],
  serials: SerialNumber[],
  companySettings: CompanySettings,
  bankAccounts: BankAccount[]
): string {
  return generateCommercialDocumentHtml(invs.map(inv => {
    const so = saleOrders?.find(s => s.id === inv.saleOrderId)
    return {
      title: inv.type === 'customer_invoice' ? 'Invoice' : 'Bill',
      ref: inv.ref,
      status: inv.status,
      date: inv.date,
      dueDate: inv.dueDate,
      customerName: inv.partnerName,
      sourceRef: so?.ref,
      lines: inv.lines.map(l => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate, subtotal: l.subtotal })),
      subtotal: inv.subtotal,
      taxTotal: inv.taxTotal,
      total: inv.total,
      amountPaid: inv.amountPaid,
      notes: inv.notes,
    }
  }), companySettings, bankAccounts)
}