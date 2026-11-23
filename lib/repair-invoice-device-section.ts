/**
 * Repair invoices used to print bare charge lines — "Service", "Labor &
 * Service Charges" — with nothing on the page saying which machine they were
 * for. Quotations group their lines under a heading per device; a repair
 * invoice now does the same, with the device the work was done on.
 *
 * This is applied when the PDF is drawn, not stored on the invoice: the stored
 * lines are what reconciles against the repair's quote and sale order, and a
 * heading row there would be one more line for every comparison to skip.
 */

export type RepairDeviceLike = {
  id?: string | null
  ref?: string | null
  productName?: string | null
  deviceType?: string | null
  deviceBrand?: string | null
  deviceModel?: string | null
  serialNumber?: string | null
  deviceSerial?: string | null
  invoiceId?: string | null
  linkedInvoiceId?: string | null
  previousInvoiceIds?: string[] | null
}

type SectionableLine = { lineType?: 'item' | 'section'; description: string }

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** "HP EliteBook 840 G8 · S/N 5CG1234XYZ", or '' when the repair names no device. */
export function repairDeviceHeading(repair: RepairDeviceLike): string {
  const brandModel = [clean(repair.deviceBrand), clean(repair.deviceModel)].filter(Boolean).join(' ')
  const name = clean(repair.productName) || brandModel || clean(repair.deviceType)
  if (!name) return ''
  const serial = clean(repair.serialNumber) || clean(repair.deviceSerial)
  return serial && !name.includes(serial) ? `${name} · S/N ${serial}` : name
}

/** The repair an invoice bills, however the two were linked. */
export function findRepairForInvoice<R extends RepairDeviceLike>(
  invoice: { id: string; repairId?: string | null },
  repairs: R[] | null | undefined,
  saleOrderRepairId?: string | null,
): R | undefined {
  const list = repairs ?? []
  const byId = (id?: string | null) => (id ? list.find(r => r.id === id) : undefined)
  return byId(invoice.repairId)
    ?? list.find(r => r.invoiceId === invoice.id || r.linkedInvoiceId === invoice.id)
    ?? byId(saleOrderRepairId)
    ?? list.find(r => (r.previousInvoiceIds ?? []).includes(invoice.id))
}

/**
 * Put the device heading above a repair invoice's lines. Lines that already
 * carry headings — a consolidated invoice has one per repair, or Finance added
 * their own — are left as they are.
 */
export function withRepairDeviceSection<L extends SectionableLine>(
  lines: L[],
  repair: RepairDeviceLike | null | undefined,
): L[] {
  return withDeviceHeading(lines, repair ? repairDeviceHeading(repair) : '')
}

/** The same, from a heading already worked out (by the server, for example). */
export function withDeviceHeading<L extends SectionableLine>(lines: L[], heading: string | null | undefined): L[] {
  if (!heading || !lines.length) return lines
  if (lines.some(line => line.lineType === 'section')) return lines
  return [{ lineType: 'section', description: heading, qty: 0, unitPrice: 0, subtotal: 0 } as unknown as L, ...lines]
}
