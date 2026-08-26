/**
 * Book depreciation and PPE account mapping for Company Property.
 * Tax written-down value lives in lib/tax/kra-capital-allowances.ts — do not mix.
 */

export const DEPRECIATION_METHODS = ['straight_line', 'reducing_balance'] as const
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number]

type AssetCategory = 'furniture' | 'fittings' | 'office_equipment' | 'it_non_trading' | 'other'

export type BookAsset = {
  ref?: string
  name?: string
  supplierName?: string
  serialNumber?: string
  category: AssetCategory
  assetClass: 'capital' | 'expensed'
  status: string
  costKes: number
  residualKes?: number
  accumDeprKes?: number
  usefulLifeMonths?: number
  depreciationMethod?: DepreciationMethod
  ppeAccountCode?: string
  acquiredVia?: string
  billRef?: string
  serialId?: string
  capitaliseJournalRef?: string
  lastDepreciatedPeriod?: string
  qty: number
}

export const PPE_COST_ACCOUNTS = ['1701', '1702', '1703', '1704'] as const
export type PpeCostAccount = (typeof PPE_COST_ACCOUNTS)[number]

export const ACCUM_DEPR_BY_PPE: Record<PpeCostAccount, string> = {
  '1701': '1751',
  '1702': '1752',
  '1703': '1753',
  '1704': '1754',
}

export const PPE_COST_LABELS: Record<PpeCostAccount, string> = {
  '1701': '1701 — Computer & Accessories',
  '1702': '1702 — Furniture & Fittings',
  '1703': '1703 — Office Equipment',
  '1704': '1704 — Software',
}

export const ACCUM_DEPR_LABELS: Record<string, string> = {
  '1751': '1751 — Accum. Depr. Computer & Accessories',
  '1752': '1752 — Accum. Depr. Furniture & Fittings',
  '1753': '1753 — Accum. Depr. Office Equipment',
  '1754': '1754 — Accum. Depr. Software',
}

export const DEPR_EXPENSE_CODE = '6517'
export const DEPR_EXPENSE_LABEL = '6517 — Depreciation and Amortization'
export const DISPOSAL_GAIN_CODE = '5203'
export const DISPOSAL_GAIN_LABEL = '5203 — Profit / Surplus on Disposal of Assets'
export const DISPOSAL_LOSS_CODE = '6515'
export const DISPOSAL_LOSS_LABEL = '6515 — Loss on Disposal of Assets'
export const INVENTORY_CODE = '1200'
export const INVENTORY_LABEL = '1200 — Inventory'
export const AP_CODE = '3000'
export const AP_LABEL = '3000 — Accounts Payable'

export function isPpeCostAccount(code?: string | null): code is PpeCostAccount {
  return PPE_COST_ACCOUNTS.includes(String(code ?? '').trim() as PpeCostAccount)
}

export function accumDeprAccountForPpe(costCode?: string | null): string | undefined {
  if (!isPpeCostAccount(costCode)) return undefined
  return ACCUM_DEPR_BY_PPE[costCode]
}

export function defaultUsefulLifeMonths(category: AssetCategory): number {
  if (category === 'it_non_trading') return 36
  if (category === 'office_equipment') return 60
  if (category === 'furniture' || category === 'fittings') return 96
  return 60
}

export function defaultBookMethod(category: AssetCategory): DepreciationMethod {
  return category === 'it_non_trading' ? 'reducing_balance' : 'straight_line'
}

/** Annual rate used only for book reducing-balance (not KRA class rates). */
export function bookReducingAnnualRate(usefulLifeMonths: number): number {
  const years = Math.max(1, usefulLifeMonths / 12)
  return Math.min(1, 1 / years)
}

export function moneyKes(n: unknown): number {
  return Math.round(Number(n || 0))
}

export function bookNbv(asset: Pick<BookAsset, 'costKes' | 'accumDeprKes'>): number {
  return Math.max(0, moneyKes(asset.costKes) - moneyKes(asset.accumDeprKes))
}

export function depreciableBase(asset: Pick<BookAsset, 'costKes' | 'residualKes'>): number {
  return Math.max(0, moneyKes(asset.costKes) - moneyKes(asset.residualKes))
}

export function canDepreciateAsset(
  asset: Pick<BookAsset, 'assetClass' | 'status' | 'costKes' | 'ppeAccountCode'>,
): boolean {
  if (asset.assetClass !== 'capital') return false
  if (asset.status === 'draft' || asset.status === 'disposed' || asset.status === 'written_off') return false
  if (!isPpeCostAccount(asset.ppeAccountCode)) return false
  return moneyKes(asset.costKes) > 0
}

export function shouldPostCapitaliseJournal(
  asset: Pick<BookAsset, 'assetClass' | 'acquiredVia' | 'status' | 'costKes' | 'billRef' | 'serialId' | 'capitaliseJournalRef'>,
): 'ap' | 'inventory' | null {
  if (asset.capitaliseJournalRef) return null
  if (asset.assetClass !== 'capital') return null
  if (asset.status === 'draft') return null
  if (moneyKes(asset.costKes) <= 0) return null
  if (asset.acquiredVia === 'opening' || asset.acquiredVia === 'donation') return null
  // Demo unit off stock. Checked before billRef so a serialised capitalisation
  // posts Dr PPE / Cr 1200 even if a bill number is recorded for reference.
  if (asset.serialId) return 'inventory'
  if (String(asset.billRef || '').trim()) return null
  if (asset.acquiredVia === 'purchase' || asset.acquiredVia === 'transfer') return 'ap'
  return null
}

export function withBookDefaults<T extends {
  category: AssetCategory
  costKes: number
  usefulLifeMonths?: number
  residualKes?: number
  depreciationMethod?: DepreciationMethod
  accumDeprKes?: number
}>(input: T): T & {
  usefulLifeMonths: number
  residualKes: number
  depreciationMethod: DepreciationMethod
  accumDeprKes: number
} {
  return {
    ...input,
    usefulLifeMonths: Number(input.usefulLifeMonths) > 0
      ? Math.round(Number(input.usefulLifeMonths))
      : defaultUsefulLifeMonths(input.category),
    residualKes: Math.max(0, moneyKes(input.residualKes)),
    depreciationMethod: input.depreciationMethod === 'reducing_balance' || input.depreciationMethod === 'straight_line'
      ? input.depreciationMethod
      : defaultBookMethod(input.category),
    accumDeprKes: Math.max(0, moneyKes(input.accumDeprKes)),
  }
}

export function monthlyBookDepreciation(
  asset: Pick<BookAsset, 'costKes' | 'residualKes' | 'accumDeprKes' | 'usefulLifeMonths' | 'depreciationMethod' | 'category'>,
): number {
  const nbv = bookNbv(asset)
  const residual = moneyKes(asset.residualKes)
  const remaining = Math.max(0, nbv - residual)
  if (remaining <= 0) return 0
  const life = Math.max(1, Number(asset.usefulLifeMonths) || defaultUsefulLifeMonths(asset.category))
  const method = asset.depreciationMethod === 'reducing_balance' ? 'reducing_balance' : 'straight_line'
  if (method === 'reducing_balance') {
    const annual = bookReducingAnnualRate(life)
    return Math.min(remaining, moneyKes(nbv * (annual / 12)))
  }
  return Math.min(remaining, moneyKes(depreciableBase(asset) / life))
}

export function periodKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function periodAlreadyRun(lastPeriod: string | undefined, period: string): boolean {
  return Boolean(lastPeriod && lastPeriod >= period)
}

export function applyBookDepreciationCharge<T extends BookAsset>(asset: T, charge: number, period: string): T {
  if (charge <= 0) return { ...asset, lastDepreciatedPeriod: period }
  return {
    ...asset,
    accumDeprKes: moneyKes(asset.accumDeprKes) + charge,
    lastDepreciatedPeriod: period,
  }
}

export function disposalAmounts(
  asset: Pick<BookAsset, 'costKes' | 'accumDeprKes' | 'qty'>,
  qty: number,
  proceedsKes = 0,
): {
  cost: number
  accum: number
  nbv: number
  proceeds: number
  gain: number
} {
  const fraction = Math.min(1, Math.max(0, qty / Math.max(1, Number(asset.qty) || 1)))
  const cost = moneyKes(moneyKes(asset.costKes) * fraction)
  const accum = moneyKes(moneyKes(asset.accumDeprKes) * fraction)
  const nbv = Math.max(0, cost - accum)
  const proceeds = moneyKes(proceedsKes)
  return { cost, accum, nbv, proceeds, gain: proceeds - nbv }
}
