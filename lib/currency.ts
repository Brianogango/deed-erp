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

interface DocumentMoneySnapshot {
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

function isSupportedCurrency(code: string | null | undefined): code is CurrencyCode {
  return !!code && (SUPPORTED_CURRENCIES as readonly string[]).includes(code.toUpperCase())
}

export function normalizeCurrencyCode(code?: string | null): CurrencyCode {
  const upper = String(code || FUNCTIONAL_CURRENCY).trim().toUpperCase()
  return isSupportedCurrency(upper) ? upper : FUNCTIONAL_CURRENCY
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

