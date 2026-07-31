/**
 * Multi-currency foundation — KES-first.
 *
 * Functional / books currency is always KES. Document amounts may be stamped
 * in another currency with an exchangeRateToBase snapshot so PDFs and history
 * stay correct even if company display currency later changes.
 *
 * No FX journal posting / multi-currency CoA in this slice.
 */

export const FUNCTIONAL_CURRENCY = 'KES' as const

export const SUPPORTED_CURRENCIES = ['KES', 'USD', 'EUR', 'GBP'] as const
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]

export interface DocumentMoneySnapshot {
  /** Currency the document amounts are denominated in. */
  currencyCode: CurrencyCode
  /** Always KES — books / functional currency. */
  baseCurrencyCode: typeof FUNCTIONAL_CURRENCY
  /** Multiply document amount by this to get KES. Always 1 when currency is KES. */
  exchangeRateToBase: number
}

export interface ExchangeRateRow {
  id: string
  fromCurrency: CurrencyCode
  toCurrency: typeof FUNCTIONAL_CURRENCY
  rate: number
  effectiveDate: string
  source?: string
  notes?: string
  createdAt?: string
  updatedAt?: string
}

export function isSupportedCurrency(code: string | null | undefined): code is CurrencyCode {
  return !!code && (SUPPORTED_CURRENCIES as readonly string[]).includes(code.toUpperCase())
}

export function normalizeCurrencyCode(code?: string | null): CurrencyCode {
  const upper = String(code || FUNCTIONAL_CURRENCY).trim().toUpperCase()
  return isSupportedCurrency(upper) ? upper : FUNCTIONAL_CURRENCY
}

export function isFunctionalCurrency(code?: string | null): boolean {
  return normalizeCurrencyCode(code) === FUNCTIONAL_CURRENCY
}

/** Build a money snapshot for a new Quote / SO / Invoice. */
export function documentMoneySnapshot(opts?: {
  currencyCode?: string | null
  exchangeRateToBase?: number | null
}): DocumentMoneySnapshot {
  const currencyCode = normalizeCurrencyCode(opts?.currencyCode)
  const rateRaw = Number(opts?.exchangeRateToBase)
  const exchangeRateToBase =
    currencyCode === FUNCTIONAL_CURRENCY
      ? 1
      : Number.isFinite(rateRaw) && rateRaw > 0
        ? rateRaw
        : 1
  return {
    currencyCode,
    baseCurrencyCode: FUNCTIONAL_CURRENCY,
    exchangeRateToBase,
  }
}

export function toBaseAmount(amount: number, exchangeRateToBase = 1): number {
  const n = Number(amount) || 0
  const rate = Number(exchangeRateToBase)
  const safe = Number.isFinite(rate) && rate > 0 ? rate : 1
  return Math.round(n * safe * 100) / 100
}

export function formatMoney(amount: number, currencyCode?: string | null): string {
  const code = normalizeCurrencyCode(currencyCode)
  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: code === 'KES' ? 0 : 2,
    }).format(Number(amount) || 0)
  } catch {
    return `${code} ${Math.round(Number(amount) || 0).toLocaleString('en-KE')}`
  }
}

/** Prefer the latest rate for from→KES on or before asOf (ISO date). */
export function findExchangeRate(
  rates: ExchangeRateRow[],
  fromCurrency: string,
  asOf?: string,
): number | null {
  const from = normalizeCurrencyCode(fromCurrency)
  if (from === FUNCTIONAL_CURRENCY) return 1
  const day = (asOf || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const matches = rates
    .filter(r => normalizeCurrencyCode(r.fromCurrency) === from && r.toCurrency === FUNCTIONAL_CURRENCY)
    .filter(r => String(r.effectiveDate).slice(0, 10) <= day)
    .sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)))
  const hit = matches[0]
  if (!hit) return null
  const rate = Number(hit.rate)
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

export function resolveDocumentCurrency(
  doc: { currencyCode?: string | null; exchangeRateToBase?: number | null } | null | undefined,
  companyCurrency?: string | null,
): DocumentMoneySnapshot {
  if (doc?.currencyCode) {
    return documentMoneySnapshot({
      currencyCode: doc.currencyCode,
      exchangeRateToBase: doc.exchangeRateToBase,
    })
  }
  return documentMoneySnapshot({ currencyCode: companyCurrency || FUNCTIONAL_CURRENCY, exchangeRateToBase: 1 })
}
