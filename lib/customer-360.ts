/**
 * What a customer has and what is waiting on them — for the person on the
 * phone with them.
 *
 * Pure: the contact page hands in the store lists.
 */

type Row = Record<string, any>

type CustomerDevice = { serial: string; product: string; how: string; href: string }
type CustomerWaiting = { label: string; detail: string; href: string; tone: 'money' | 'action' }

export function customerDevices(input: { contactId: string; saleOrders: Row[]; serials: Row[]; repairs: Row[] }): CustomerDevice[] {
  const orderIds = new Set(input.saleOrders.filter(o => o.customerId === input.contactId).map(o => o.id))
  const bought = input.serials
    .filter(s => s.status === 'sold' && s.saleOrderId && orderIds.has(s.saleOrderId))
    .map(s => ({
      serial: String(s.serial ?? ''),
      product: String(s.productName ?? ''),
      how: s.soldDate ? `Bought ${String(s.soldDate).slice(0, 10)}` : 'Bought',
      href: `/sales?id=${encodeURIComponent(s.saleOrderId)}`,
    }))
  const seen = new Set(bought.map(d => d.serial.toUpperCase()))
  const repaired = input.repairs
    .filter(r => r.customerId === input.contactId && r.serialNumber && !seen.has(String(r.serialNumber).toUpperCase()))
    .map(r => ({
      serial: String(r.serialNumber),
      product: String(r.productName ?? ''),
      how: `Repair ${r.ref} · ${String(r.status ?? '').replace(/_/g, ' ')}`,
      href: `/repairs?id=${encodeURIComponent(r.id)}`,
    }))
  return [...bought, ...repaired]
}

export function customerWaiting(input: {
  contactId: string
  repairs: Row[]
  saleOrders: Row[]
  invoices: Row[]
  invoiceHref: (id: string) => string
  residual: (invoice: Row) => number
}): CustomerWaiting[] {
  const kes = (n: unknown) => `KES ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`
  const out: CustomerWaiting[] = []
  for (const r of input.repairs.filter(x => x.customerId === input.contactId)) {
    if (r.status === 'awaiting_approval') {
      out.push({ label: `Approve the quote for ${r.ref}`, detail: `${r.productName ?? ''} · ${kes(r.quote?.total)}`, href: `/repairs?id=${encodeURIComponent(r.id)}`, tone: 'action' })
    } else if (['ready', 'verified_released'].includes(r.status)) {
      out.push({ label: `Collect ${r.productName ?? 'the device'}`, detail: `${r.ref} is ready`, href: `/repairs?id=${encodeURIComponent(r.id)}`, tone: 'action' })
    }
  }
  for (const o of input.saleOrders.filter(x => x.customerId === input.contactId && ['quotation', 'quotation_sent'].includes(String(x.status)))) {
    out.push({ label: `Decide on quotation ${o.ref ?? o.orderNumber}`, detail: kes(o.total), href: `/sales?id=${encodeURIComponent(o.id)}`, tone: 'action' })
  }
  for (const i of input.invoices.filter(x => x.partnerId === input.contactId && x.type === 'customer_invoice' && !['draft', 'cancelled'].includes(String(x.status)))) {
    const due = input.residual(i)
    if (due > 1) out.push({ label: `Pay ${i.ref}`, detail: `${kes(due)} due${i.dueDate ? ` by ${String(i.dueDate).slice(0, 10)}` : ''}`, href: input.invoiceHref(i.id), tone: 'money' })
  }
  return out
}
