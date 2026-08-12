/**
 * Serial-level COGS resolution (Finance Phase 12).
 * Prefer DeviceSerialCost when serial IDs are provided; else product average.
 */

import { roundMoney } from '@/lib/accounting/money'

export type SerialCostRow = {
  serialId: string
  currentCost: number
}

export type SerialCogsResolution = {
  mode: 'serial' | 'average' | 'mixed'
  unitCost: number
  totalCost: number
  serialCosts: Array<{ serialId: string; unitCost: number }>
  missingSerialIds: string[]
}

export function resolveSerialCogs(params: {
  qty: number
  serialIds?: string[] | null
  serialCosts?: SerialCostRow[] | null
  averageCost: number
}): SerialCogsResolution {
  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  const averageCost = Math.max(0, Number(params.averageCost) || 0)
  const serialIds = (params.serialIds || []).map(String).filter(Boolean)
  const costById = new Map(
    (params.serialCosts || []).map(r => [String(r.serialId), Math.max(0, Number(r.currentCost) || 0)]),
  )

  if (serialIds.length === 0 || qty === 0) {
    return {
      mode: 'average',
      unitCost: averageCost,
      totalCost: roundMoney(qty * averageCost),
      serialCosts: [],
      missingSerialIds: [],
    }
  }

  const serialCosts: Array<{ serialId: string; unitCost: number }> = []
  const missingSerialIds: string[] = []
  let total = 0
  let found = 0

  for (const sid of serialIds.slice(0, qty)) {
    if (costById.has(sid)) {
      const unitCost = costById.get(sid)!
      serialCosts.push({ serialId: sid, unitCost })
      total += unitCost
      found += 1
    } else {
      missingSerialIds.push(sid)
      serialCosts.push({ serialId: sid, unitCost: averageCost })
      total += averageCost
    }
  }

  // If fewer serials than qty, fill remainder at average.
  for (let i = serialIds.length; i < qty; i += 1) {
    total += averageCost
  }

  const mode: SerialCogsResolution['mode'] =
    found === 0 ? 'average' : missingSerialIds.length > 0 || serialIds.length < qty ? 'mixed' : 'serial'

  return {
    mode,
    unitCost: qty > 0 ? roundMoney(total / qty) : 0,
    totalCost: roundMoney(total),
    serialCosts,
    missingSerialIds,
  }
}
