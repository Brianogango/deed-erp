/**
 * Kenya wear-and-tear (capital allowances) vs book depreciation.
 *
 * Book journals never use these rates. Tax WDV is reporting-only.
 * Rates follow the Income Tax Act Second Schedule classes commonly applied
 * to office PPE: Class II 30% (computers / software), Class IV 12.5%
 * (furniture, fittings, other office machinery).
 */

import { moneyKes } from '@/lib/company-property-ppe'

export type KraWearTearClass = 'II' | 'IV'

export const KRA_CLASS_RATES: Record<KraWearTearClass, number> = {
  II: 0.30,
  IV: 0.125,
}

export function kraClassForPpe(ppeAccountCode?: string | null): KraWearTearClass {
  const code = String(ppeAccountCode ?? '').trim()
  if (code === '1701' || code === '1704') return 'II'
  return 'IV'
}

export function kraAnnualRate(ppeAccountCode?: string | null): number {
  return KRA_CLASS_RATES[kraClassForPpe(ppeAccountCode)]
}

export function kraClassLabel(ppeAccountCode?: string | null): string {
  const cls = kraClassForPpe(ppeAccountCode)
  const pct = Math.round(KRA_CLASS_RATES[cls] * 1000) / 10
  return `Class ${cls} (${pct}% reducing balance)`
}

/** Annual wear-and-tear on the tax written-down value. */
export function kraAnnualAllowance(taxWdvKes: number, ppeAccountCode?: string | null): number {
  const wdv = moneyKes(taxWdvKes)
  if (wdv <= 0) return 0
  return moneyKes(wdv * kraAnnualRate(ppeAccountCode))
}

export function applyKraAnnualAllowance<T extends { taxWdvKes?: number; ppeAccountCode?: string; taxLastAllowanceYear?: number; costKes?: number }>(
  asset: T,
  year: number,
): { asset: T; allowance: number } {
  if (asset.taxLastAllowanceYear != null && asset.taxLastAllowanceYear >= year) {
    return { asset, allowance: 0 }
  }
  const opening = moneyKes(asset.taxWdvKes ?? asset.costKes)
  const allowance = kraAnnualAllowance(opening, asset.ppeAccountCode)
  return {
    asset: {
      ...asset,
      taxWdvKes: Math.max(0, opening - allowance),
      taxLastAllowanceYear: year,
    },
    allowance,
  }
}

export function initialTaxWdv(costKes: number): number {
  return moneyKes(costKes)
}
