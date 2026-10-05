import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import { hasValidatedDeliveryForInvoice } from '@/lib/odoo-sales-flow'
import { serialInvoiceBlock, serialInvoiceRuleApplies, type SerialInvoiceDoc } from '@/lib/sales/serial-invoice-gate'

const normalName = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Server check for lib/sales/serial-invoice-gate.ts: refusal message or null. */
export async function serialInvoiceGateError(
  doc: SerialInvoiceDoc,
  lines: Array<{ productId?: unknown; description?: unknown; desc?: unknown; productName?: unknown }>,
): Promise<string | null> {
  if (!serialInvoiceRuleApplies(doc)) return null
  const productIds = [...new Set(lines.map(l => String(l?.productId ?? '')).filter(Boolean))]
  // Lines typed by hand carry no product; their wording still names one.
  const typed = new Set(lines
    .filter(l => !l?.productId)
    .map(l => normalName(l?.description ?? l?.desc ?? l?.productName))
    .filter(Boolean))
  if (!productIds.length && !typed.size) return null
  const saleOrderId = String(doc.saleOrderId ?? '')
  const state = await loadAppState(saleOrderId ? ['deed_products', 'deed_deliveries'] : ['deed_products'])
  // Either copy may carry the flag: Prisma trackingMethod, or the catalogue's
  // requiresSerial / trackingMethod.
  const names = new Map<string, string>()
  const uuids = productIds.filter(id => UUID.test(id))
  if (uuids.length) {
    const rows = await prisma.product.findMany({
      where: { id: { in: uuids }, trackingMethod: 'SERIAL' },
      select: { id: true, name: true },
    })
    for (const row of rows) names.set(row.id, row.name)
  }
  const wanted = new Set(productIds)
  const catalogue = Array.isArray(state.deed_products) ? state.deed_products as Array<Record<string, unknown>> : []
  for (const p of catalogue) {
    const id = String(p?.id ?? '')
    if (names.has(id)) continue
    if (!wanted.has(id) && !typed.has(normalName(p?.name))) continue
    if (p.requiresSerial === true || String(p.trackingMethod ?? '').toUpperCase() === 'SERIAL') names.set(id, String(p.name ?? 'This product'))
  }
  if (!names.size) return null
  let deliveryValidated = false
  if (saleOrderId) {
    const deliveries = Array.isArray(state.deed_deliveries) ? state.deed_deliveries as Parameters<typeof hasValidatedDeliveryForInvoice>[0] : []
    deliveryValidated = hasValidatedDeliveryForInvoice(deliveries, saleOrderId)
  }
  return serialInvoiceBlock({ doc, serialProductNames: [...names.values()], deliveryValidated })
}
