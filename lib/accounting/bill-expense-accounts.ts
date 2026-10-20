/**
 * Which account a vendor bill line is charged to.
 *
 * A bill line with no account goes to Purchases (6101, stock bought for
 * resale). That is right for a supplier of laptops, wrong for the landlord or
 * the power company: their bills belong in an operating expense account
 * (6401–6799), or rent and electricity show up as cost of sales.
 *
 * Each vendor can have a default account, kept in the app_state key below as
 * { [vendorId]: '6508' }. Bills from that vendor start with it.
 */

export const VENDOR_EXPENSE_ACCOUNTS_KEY = 'deed_vendorExpenseAccounts'

export type VendorExpenseAccounts = Record<string, string>

const code = (value: unknown) => String(value ?? '').trim().split(/\s+/)[0]

/** Any 6xxx account a bill line may use. */
export function isBillExpenseCode(value: unknown): boolean {
  return /^6\d{3}$/.test(code(value))
}

/** Operating expenses: selling, admin, staff and finance costs (6401–6799). */
export function isOperatingExpenseCode(value: unknown): boolean {
  const c = code(value)
  return /^6\d{3}$/.test(c) && Number(c) >= 6401 && Number(c) <= 6799
}

/** Blank, or a cost-of-sales account (6001–6399): what stock purchases use. */
export function goesToPurchases(value: unknown): boolean {
  const c = code(value)
  if (!c) return true
  return /^6\d{3}$/.test(c) && Number(c) < 6401
}

/** Clean a stored map: only real vendor ids and 6xxx codes survive. */
export function cleanVendorExpenseAccounts(raw: unknown): VendorExpenseAccounts {
  const out: VendorExpenseAccounts = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [vendorId, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(vendorId).trim()
    if (id && isBillExpenseCode(value)) out[id] = code(value)
  }
  return out
}

const HINTS: Array<{ test: RegExp; code: string }> = [
  { test: /\b(rent|rental|service charge|landlord|lease)\b/i, code: '6508' },
  { test: /\b(electric\w*|power|kplc|token|water|sewer\w*|utilit\w*)\b/i, code: '6506' },
  { test: /\b(internet|wi-?fi|broadband|fibre|fiber|airtime|telephone|phone bill|data bundle|safaricom|airtel|zuku|faiba)\b/i, code: '6510' },
  { test: /\b(insurance|premium)\b/i, code: '6704' },
  { test: /\b(bank charges?|ledger fees?)\b/i, code: '6703' },
  { test: /\b(fuel|petrol|diesel|uber|bolt|taxi|transport)\b/i, code: '6507' },
  { test: /\b(courier|g4s|wells fargo|fargo|dhl|sendy)\b/i, code: '6519' },
  { test: /\b(stationery|printing|paper)\b/i, code: '6504' },
  { test: /\b(audit\w*)\b/i, code: '6502' },
  { test: /\b(legal|advocates?|lawyer)\b/i, code: '6509' },
  { test: /\b(advert\w*|marketing|promotion|facebook ads|google ads)\b/i, code: '6501' },
  { test: /\b(cleaning|security|office)\b/i, code: '6518' },
]

/** An operating expense account a description or vendor name points to, if any. */
export function suggestExpenseAccount(...texts: Array<string | undefined>): string | undefined {
  const text = texts.filter(Boolean).join(' ')
  if (!text.trim()) return undefined
  return HINTS.find(h => h.test.test(text))?.code
}

/**
 * Lines of a bill for an overhead vendor that would land in Purchases.
 * A vendor with purchase orders supplies stock, so Purchases is expected there.
 */
export function overheadLinesInPurchases<T extends { accountCode?: string; lineType?: string }>(
  lines: T[],
  vendorSuppliesStock: boolean,
): T[] {
  if (vendorSuppliesStock) return []
  return lines.filter(l => l.lineType !== 'section' && goesToPurchases(l.accountCode))
}
