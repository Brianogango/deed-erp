import prisma from '@/lib/prisma'
import { optionalUuid } from '@/lib/legacy-compat'
import { saveStoreKeys } from '@/lib/server-store'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'

/** Quote fields and status rules shared by the quote routes. */

export async function broadcastQuotes() {
  try {
    const all = await prisma.quote.findMany({ include: { items: true, client: true, opportunity: true }, orderBy: { quoteDate: 'desc' } })
    void saveStoreKeys({ deed_quotes: JSON.stringify(normalizeQuotesForClient(all)) })
  } catch {}
}

export function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || body?.source === 'repair' || /repair/i.test(String(body?.opportunityName ?? '')))
}

export const QUOTE_STATUS_MAP: Record<string, string> = {
  sent:     'pending_approval',
  viewed:   'pending_approval',
  accepted: 'approved',
  expired:  'cancelled',
  revised:  'draft',
}

export const VALID_STATUSES = new Set([
  'draft', 'pending_approval', 'approved', 'rejected', 'invoiced',
  'dispatched', 'delivered', 'paid', 'partially_paid', 'cancelled', 'voided',
])

export function mapQuoteItems(lines: any[]) {
  return lines.map((l: any) => {
    const qty = Number(l.qty ?? 1)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw Object.assign(new Error('Quote line quantity must be greater than zero'), { status: 400 })
    }
    const unitPrice = Number(l.unitPrice ?? 0)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw Object.assign(new Error('Quote line unit price cannot be negative'), { status: 400 })
    }
    const discountPct = Number(l.discount ?? l.discountPct ?? 0)
    const taxRate = Number(l.taxRate ?? 0)
    const lineSubtotal = Number(l.subtotal ?? l.lineSubtotal ?? Math.round(qty * unitPrice * (1 - discountPct / 100)))
    const lineTax = Number(l.lineTax ?? l.taxAmount ?? Math.round(lineSubtotal * taxRate / 100))
    return {
      description: l.description ?? l.productName ?? '',
      qty,
      unitPrice,
      discountPct,
      taxRate,
      lineSubtotal,
      lineTax,
      lineTotal: Number(l.lineTotal ?? lineSubtotal + lineTax),
      ...(optionalUuid(l.productId) ? { productId: optionalUuid(l.productId) } : {}),
    }
  })
}
