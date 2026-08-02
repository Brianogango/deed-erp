/**
 * Kenya withholding tax helpers (vendor bill payments / service invoices).
 * Rates are configurable; default 5% is a common professional-services rate.
 */

export const DEFAULT_WHT_RATE_PCT = 5

export type WhtComputation = {
  gross: number
  ratePct: number
  whtAmount: number
  netPayable: number
}

export function resolveWhtRate(ratePct?: number | null): number {
  const n = Number(ratePct)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_WHT_RATE_PCT
  return Math.min(100, Math.round(n * 100) / 100)
}

export function computeWht(gross: number, ratePct?: number | null): WhtComputation {
  const g = Math.max(0, Math.round(Number(gross) || 0))
  const rate = resolveWhtRate(ratePct)
  const whtAmount = Math.round(g * (rate / 100))
  return {
    gross: g,
    ratePct: rate,
    whtAmount,
    netPayable: Math.max(0, g - whtAmount),
  }
}

export function shouldApplyWhtOnInvoice(args: {
  enabled: boolean
  invoiceType?: string
  /** Optional per-invoice override; undefined means follow global setting. */
  withhold?: boolean
}): boolean {
  if (!args.enabled) return false
  if (args.invoiceType && args.invoiceType !== 'vendor_bill') return false
  if (args.withhold === false) return false
  return true
}
