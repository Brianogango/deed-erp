import 'server-only'
import prisma from '@/lib/prisma'
import { broadcastOpportunities } from '@/lib/opportunity-server'

const EARLY_STAGES = new Set(['new', 'lead', 'prospecting', 'qualification', 'qualified'])
const CLOSED = new Set(['closed_won', 'closed_lost', 'won', 'lost'])

type Order = { id: string; orderNumber?: string | null; totalAmount?: unknown }

function extrasOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
}

/**
 * A quotation was raised from a deal. The quotation used to carry the deal
 * only as text in its notes, so the deal never learned about it: it stayed in
 * Qualification and listed every order the customer had ever placed.
 */
export async function dealQuotationRaised(opportunityId: string | null | undefined, order: Order) {
  if (!opportunityId) return
  try {
    const opp = await prisma.opportunity.findUnique({ where: { id: opportunityId } })
    if (!opp || CLOSED.has(opp.stage)) return
    const extras = extrasOf(opp.screenExtras)
    const ids = Array.isArray(extras.saleOrderIds) ? (extras.saleOrderIds as string[]) : []
    extras.saleOrderIds = ids.includes(order.id) ? ids : [...ids, order.id]
    extras.lastActivityDate = new Date().toISOString()
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: {
        screenExtras: extras as object,
        ...(EARLY_STAGES.has(opp.stage) ? { stage: 'proposal', probability: Math.max(opp.probability, 50) } : {}),
        ...(Number(opp.value) <= 0 && Number(order.totalAmount) > 0 ? { value: Number(order.totalAmount) } : {}),
      },
    })
    await broadcastOpportunities()
  } catch (err) {
    console.error('[crm] could not link quotation to deal', opportunityId, err)
  }
}

/** The quotation was confirmed into a sale: the deal is won, at the order's value. */
export async function dealWon(opportunityId: string | null | undefined, order: Order) {
  if (!opportunityId) return
  try {
    const opp = await prisma.opportunity.findUnique({ where: { id: opportunityId } })
    if (!opp || opp.stage === 'closed_won' || opp.stage === 'won') return
    const extras = extrasOf(opp.screenExtras)
    const ids = Array.isArray(extras.saleOrderIds) ? (extras.saleOrderIds as string[]) : []
    const now = new Date().toISOString()
    Object.assign(extras, {
      saleOrderIds: ids.includes(order.id) ? ids : [...ids, order.id],
      actualValue: Number(order.totalAmount) || 0,
      actualCloseDate: now.slice(0, 10),
      wonReason: `Confirmed as ${order.orderNumber ?? 'a sale order'}`,
      lastActivityDate: now,
    })
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { stage: 'closed_won', probability: 100, screenExtras: extras as object },
    })
    await broadcastOpportunities()
  } catch (err) {
    console.error('[crm] could not mark deal won', opportunityId, err)
  }
}
