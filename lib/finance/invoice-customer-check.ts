/**
 * Invoices filed under the wrong customer.
 *
 * Until the fix in lib/legacy-compat.ts (resolveClientId), an invoice whose
 * customer the server did not yet hold was matched to any contact sharing an
 * email or phone — so a POS sale to Derrick could be filed under John, who
 * happened to carry the shop's own email. The source document still says who
 * bought: the till ticket, the sale order, or the repair. Pure.
 */

export type InvoiceForCheck = {
  id: string
  ref: string
  date: string
  total: number
  clientId: string
  clientName: string
  saleOrderId: string | null
  repairId: string | null
  isPosInvoice: boolean
}

export type SourceCustomer = { clientId: string | null; name: string }

export type MisfiledInvoice = {
  invoiceId: string
  ref: string
  date: string
  total: number
  filedUnder: string
  shouldBe: string
  /** Contact id the source names (may not be a server contact yet). */
  targetClientId: string | null
  source: 'pos' | 'sale_order' | 'repair'
}

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const WALK_IN = new Set(['', 'walk-in customer', 'walk-in', 'walk in customer', 'walk in'])

export function findMisfiledInvoices(input: {
  invoices: InvoiceForCheck[]
  /** POS ticket per invoice id. */
  posByInvoiceId: Map<string, SourceCustomer>
  saleOrders: Map<string, SourceCustomer>
  repairs: Map<string, SourceCustomer>
}): MisfiledInvoice[] {
  const out: MisfiledInvoice[] = []
  for (const inv of input.invoices) {
    let source: MisfiledInvoice['source'] | null = null
    let expected: SourceCustomer | undefined
    if (inv.isPosInvoice || input.posByInvoiceId.has(inv.id)) {
      source = 'pos'
      expected = input.posByInvoiceId.get(inv.id)
    } else if (inv.saleOrderId) {
      source = 'sale_order'
      expected = input.saleOrders.get(inv.saleOrderId)
    } else if (inv.repairId) {
      source = 'repair'
      expected = input.repairs.get(inv.repairId)
    }
    if (!source || !expected) continue
    if (WALK_IN.has(norm(expected.name)) && !expected.clientId) continue
    if (expected.clientId && expected.clientId === inv.clientId) continue
    // A different record of the same person (same name) is not a mix-up.
    if (norm(expected.name) && norm(expected.name) === norm(inv.clientName)) continue
    if (!norm(expected.name) && !expected.clientId) continue
    out.push({
      invoiceId: inv.id,
      ref: inv.ref,
      date: inv.date,
      total: inv.total,
      filedUnder: inv.clientName,
      shouldBe: expected.name || '(contact on the source document)',
      targetClientId: expected.clientId,
      source,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
