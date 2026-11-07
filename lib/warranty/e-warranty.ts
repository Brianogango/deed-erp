/**
 * E-warranties. Every serial-numbered machine we sell gets a warranty — sold
 * on a sale order delivery, at the POS, or on Kilimall — and each warranty
 * has a private link (`/portal/warranty/<token>`) to a certificate with
 * Deed's printed warranty terms. Staff copy, send or download it by hand.
 *
 * Warranties are worked out on the server from what was actually sold (see
 * e-warranty.server.ts), so a sale made on any screen, and every past sale,
 * gets one exactly once. Pure helpers.
 */
import { addWarrantyMonths, resolveWarrantyMonths } from '@/lib/warranty-period'

export type WarrantySource = 'delivery' | 'pos' | 'kilimall'

export type WarrantyRow = {
  id: string; ref: string
  customerId: string; customerName: string
  productId: string; productName: string; serialId: string; serialNumber: string
  deliveryId: string; saleOrderRef: string
  startDate: string; endDate: string
  status: 'active' | 'expiring' | 'expired' | 'cancelled'
  months: number
  cancelledAt?: string; cancelledReason?: string; cancelledByRef?: string
  /** Where the sale was made, and its id: "pos:<id>", "delivery:<id>", "kilimall:<id>". */
  source?: WarrantySource
  sourceKey?: string
  issuedAt?: string
  specs?: string
}

type Line = { productId: string; productName?: string; serialId?: string; serialIds?: string[] }
export type SaleSources = {
  deliveries: Array<{ id: string; ref?: string; status: string; date?: string; saleOrderRef?: string; customerId?: string; customerName?: string; lines?: Line[] }>
  posOrders: Array<{ id: string; ref: string; date?: string; createdAt?: string; customerId?: string; customerName?: string; lines?: Line[]; status?: string; voided?: boolean; refunded?: boolean }>
  kilimallOrders: Array<{ id: string; ref: string; kilimallRef?: string; status: string; orderDate?: string; dispatchedAt?: string; customerName?: string; productId: string; productName?: string; fulfilledProductId?: string; fulfilledProductName?: string; serialId?: string }>
  serials: Array<{ id: string; serial: string; productId: string; productName?: string; status: string; soldDate?: string; specs?: string }>
  products: Array<{ id: string; name?: string; warrantyMonths?: number }>
  defaultMonths?: number
}

/** One warranty to issue (no id, ref or token yet). */
export type WarrantyCandidate = Omit<WarrantyRow, 'id' | 'ref' | 'issuedAt'>

const day = (v?: string) => (v ? String(v).slice(0, 10) : '')

/** The source key of a warranty made before sources were recorded (deliveries only). */
export const sourceKeyOf = (w: Pick<WarrantyRow, 'sourceKey' | 'deliveryId'>) => w.sourceKey || (w.deliveryId ? `delivery:${w.deliveryId}` : '')

/**
 * The warranties still to issue. A machine gets one per sale, only while it
 * is still with the customer (serial status "sold") — a refunded or
 * returned machine gets none — and never a second while one is open.
 */
export function warrantiesToIssue(existing: WarrantyRow[], src: SaleSources): WarrantyCandidate[] {
  const serialById = new Map(src.serials.map(s => [s.id, s]))
  const productById = new Map(src.products.map(p => [p.id, p]))
  const haveKey = new Set(existing.map(w => `${sourceKeyOf(w)}|${w.serialId}`))
  const open = new Set(existing.filter(w => w.status !== 'cancelled').map(w => w.serialId))
  const out: WarrantyCandidate[] = []

  const add = (source: WarrantySource, id: string, docRef: string, serialId: string | undefined, productId: string, productName: string | undefined, start: string, customerId: string | undefined, customerName: string | undefined, deliveryId = '') => {
    if (!serialId) return
    const serial = serialById.get(serialId)
    if (!serial || serial.status !== 'sold') return
    const sourceKey = `${source}:${id}`
    if (haveKey.has(`${sourceKey}|${serialId}`) || open.has(serialId)) return
    const pid = productId || serial.productId
    const product = productById.get(pid)
    const months = resolveWarrantyMonths(product?.warrantyMonths, src.defaultMonths)
    const startDate = day(start) || day(serial.soldDate) || day(new Date().toISOString())
    out.push({
      customerId: customerId || '', customerName: (customerName || '').trim() || 'Walk-in customer',
      productId: pid, productName: productName || product?.name || serial.productName || '',
      serialId, serialNumber: serial.serial,
      deliveryId, saleOrderRef: docRef,
      startDate, endDate: addWarrantyMonths(startDate, months), months,
      status: 'active', source, sourceKey,
      ...(serial.specs ? { specs: serial.specs } : {}),
    })
    haveKey.add(`${sourceKey}|${serialId}`)
    open.add(serialId)
  }

  for (const d of src.deliveries) {
    if (d.status !== 'done') continue
    for (const l of d.lines ?? []) for (const sid of l.serialIds ?? []) {
      add('delivery', d.id, d.saleOrderRef || d.ref || '', sid, l.productId, l.productName, serialById.get(sid)?.soldDate || d.date || '', d.customerId, d.customerName, d.id)
    }
  }
  for (const o of src.posOrders) {
    if (o.voided || o.refunded || o.status === 'voided' || o.status === 'refunded') continue
    for (const l of o.lines ?? []) {
      add('pos', o.id, o.ref, l.serialId, l.productId, l.productName, o.date || o.createdAt || '', o.customerId, o.customerName)
    }
  }
  for (const k of src.kilimallOrders) {
    if (!['dispatched', 'delivered'].includes(k.status)) continue
    add('kilimall', k.id, k.kilimallRef ? `Kilimall ${k.kilimallRef}` : k.ref, k.serialId, k.fulfilledProductId || k.productId, k.fulfilledProductName || k.productName, (k.serialId && serialById.get(k.serialId)?.soldDate) || k.dispatchedAt || k.orderDate || '', '', k.customerName)
  }
  return out
}

/** Next WAR/#### number after the highest one in use. */
export function nextWarrantyRefs(existing: Array<{ ref?: string }>, count: number): string[] {
  const top = existing.reduce((m, w) => Math.max(m, Number(/^WAR\/(\d+)$/.exec(String(w.ref ?? ''))?.[1]) || 0), 0)
  return Array.from({ length: count }, (_, i) => `WAR/${String(top + i + 1).padStart(4, '0')}`)
}

export type WarrantyState = 'valid' | 'expired' | 'void'

export function warrantyState(w: Pick<WarrantyRow, 'status' | 'endDate'>, now = new Date()): WarrantyState {
  if (w.status === 'cancelled') return 'void'
  return day(w.endDate) < now.toISOString().slice(0, 10) ? 'expired' : 'valid'
}

/** "Wycliffe Ouma Sumba" → "Wycliffe O. S." — enough to recognise, not to expose. */
export function maskedName(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  return [parts[0], ...parts.slice(1).map(p => `${p[0].toUpperCase()}.`)].join(' ')
}

export const warrantyPath = (token: string) => `/portal/warranty/${encodeURIComponent(token)}`

/** Deed Technologies Limited Warranty, as printed on the paper certificate. */
export const WARRANTY_INTRO = 'This Limited Warranty (referred to as the “Warranty”) is provided by Deed Technologies (referred to as the “Seller”) to the original purchaser (referred to as the “Buyer”) of a refurbished computer/laptop (referred to as the “Product”).'

export function warrantyTerms(period: string): Array<{ title: string; intro?: string; items: Array<{ label?: string; text: string }> }> {
  return [
    {
      title: 'Warranty Coverage',
      items: [
        { text: `The Seller is committed to providing the Buyer with a high-quality Product. The Seller warrants that the Product shall be free from defects in material and workmanship under normal use and service for ${period} starting from the date of purchase by the Buyer.` },
        { text: 'The Warranty covers repairs or replacement of defective parts or, at the Seller’s discretion, replacement of the entire Product, without charge to the Buyer, except as otherwise specified in this Warranty.' },
      ],
    },
    {
      title: 'Warranty Exclusions',
      intro: 'This Warranty is designed to protect the Buyer’s investment in the Product. However, there are some exclusions to ensure fair and reasonable coverage:',
      items: [
        { text: 'This Warranty does not cover damage caused by accidents, misuse, abuse, negligence, improper installation, unauthorized repairs or modifications, or any other use not in accordance with the Seller’s instructions.' },
        { text: 'Damage caused by natural disasters, such as floods, fires, earthquakes, or lightning, is not covered under this Warranty.' },
        { text: 'Normal wear and tear is a natural part of product use and is not covered under this Warranty. This includes minor scratches, dents, or cosmetic damage.' },
        { text: 'The following warranty exclusions apply to consumable parts, accessories and software:' },
        { label: 'Keyboard', text: 'The Warranty does not cover defects or damages to the keyboard caused by liquid spillage. Any faults or damages resulting from liquid spillage are excluded from this Warranty.' },
        { label: 'Power', text: 'The Warranty does not cover power-related problems, including electrical surges, power outages, or fluctuations, unless directly caused by a defect in the Product.' },
        { label: 'Battery', text: 'Damage to the battery due to misuse, abuse, or normal wear and tear is not covered under this Warranty.' },
        { label: 'Hard Drive and RAM', text: 'Data loss or damages caused by software or improper handling are not covered under this Warranty.' },
        { label: 'Display', text: 'The Warranty does not cover display faults or damages caused by breakage of the screen. Any damages resulting from accidental breakage or mishandling of the display are excluded from this Warranty.' },
        { label: 'Software', text: 'Any software or data loss resulting from the use or inability to use the Product is not covered under this Warranty.' },
      ],
    },
    {
      title: 'Warranty Service',
      items: [
        { text: 'The Seller aims to provide a seamless warranty service experience for the Buyer. To obtain warranty service, the Buyer must contact the Seller’s customer support within the Warranty Period and provide proof of purchase.' },
        { text: 'The Seller may require the Buyer to return the defective Product, at the Seller’s expense, to a designated service center for inspection and repair.' },
        { text: 'The Seller is committed to resolving warranty claims in a timely manner and will prioritize repair or replacement of the defective Product. If repair or replacement is not feasible, the Seller will issue a refund or credit equal to the original purchase price of the Product.' },
      ],
    },
    {
      title: 'Limitation of Liability',
      items: [
        { text: 'The Seller understands the importance of the Buyer’s satisfaction and will make reasonable efforts to address any issues arising from the Product. However, to the maximum extent permitted by applicable law, the Seller shall not be liable for any indirect, incidental, consequential, or special damages arising out of or in connection with the Product.' },
        { text: 'The Seller’s aggregate liability arising out of or in connection with the Product shall not exceed the amount paid by the Buyer for the Product.' },
      ],
    },
    {
      title: 'Governing Law',
      items: [{ text: 'This Warranty shall be governed by and construed in accordance with the laws of the Republic of Kenya without regard to its conflict of laws principles.' }],
    },
    {
      title: 'Entire Agreement',
      items: [{ text: 'This Warranty constitutes the entire agreement between the Seller and the Buyer regarding the Product and supersedes all prior or contemporaneous agreements, understandings, or representations, whether oral or written.' }],
    },
  ]
}

/** The message staff send with the link (WhatsApp / copy). */
export function warrantyShareMessage(w: Pick<WarrantyRow, 'customerName' | 'productName' | 'serialNumber' | 'endDate' | 'ref'>, url: string): string {
  const first = String(w.customerName || '').trim().split(/\s+/)[0]
  const until = new Date(`${day(w.endDate)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return `Hello${first && first !== 'Walk-in' ? ` ${first}` : ''}, here is your Deed Technologies e-warranty ${w.ref} for your ${w.productName} (serial ${w.serialNumber}), valid until ${until}: ${url}`
}
