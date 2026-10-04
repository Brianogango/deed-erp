import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { periodKey, validateTemplate, type RecurringBill } from '@/lib/recurring/recurring-bills'

export const dynamic = 'force-dynamic'

const KEY = 'deed_recurringBills'

/**
 * PATCH /api/recurring-bills/:id
 *   { action: 'pause' | 'resume' }
 *   { action: 'end', endDate }
 *   { action: 'update', lines?, vatRate?, dayOfMonth? }   — applies to future periods only
 *   { action: 'recordGenerated', billDate, invoiceId, invoiceRef } — one bill per period
 */
export async function PATCH(request: NextRequest, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => ({}))

    const state = await loadAppState([KEY])
    const items: RecurringBill[] = Array.isArray(state[KEY]) ? (state[KEY] as RecurringBill[]) : []
    const item = items.find(i => i.id === id)
    if (!item) return NextResponse.json({ error: 'Recurring bill not found' }, { status: 404 })

    switch (body.action) {
      case 'pause': item.paused = true; break
      case 'resume': item.paused = false; break
      case 'end': {
        const endDate = String(body.endDate ?? '').trim()
        const problem = validateTemplate({ ...item, endDate })
        if (problem) return NextResponse.json({ error: problem }, { status: 422 })
        item.endDate = endDate
        break
      }
      case 'update': {
        const next = {
          ...item,
          ...(body.lines ? { lines: body.lines } : {}),
          ...(body.vatRate != null ? { vatRate: Number(body.vatRate) } : {}),
          ...(body.dayOfMonth != null ? { dayOfMonth: Number(body.dayOfMonth) } : {}),
        }
        const problem = validateTemplate(next)
        if (problem) return NextResponse.json({ error: problem }, { status: 422 })
        item.lines = next.lines
        item.vatRate = next.vatRate
        item.dayOfMonth = next.dayOfMonth
        break
      }
      case 'recordGenerated': {
        const billDate = String(body.billDate ?? '').trim()
        const period = periodKey(billDate, item.frequency)
        if (!period) return NextResponse.json({ error: 'billDate is required' }, { status: 422 })
        if (item.generated.some(g => g.period === period)) {
          return NextResponse.json({ error: `A bill for ${period} was already generated` }, { status: 409 })
        }
        item.generated = [
          ...item.generated,
          { period, invoiceId: String(body.invoiceId ?? ''), invoiceRef: String(body.invoiceRef ?? ''), billDate },
        ]
        break
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    await saveStoreKeys({ [KEY]: JSON.stringify(items) })
    return NextResponse.json({ item })
  })
}
