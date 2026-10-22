/**
 * Which product line (sales account) a sale belongs to, for the cashbook and
 * its month-end summary: Laptops, Desktops, Accessories, Repairs and so on.
 *
 * A line linked to a product uses that product's sales account. A line typed
 * by hand ("HP EliteBook 840 G5") has no product, so it is read from its
 * description; only when nothing matches does it stay on general sales (5000).
 */
import { COMPANY_ACCOUNT_FALLBACKS, resolveProductAccounts, type AccountableProduct } from '@/lib/product-accounts'
import { isOperatingExpenseCode } from '@/lib/accounting/bill-expense-accounts'

export const GENERAL_SALES_CODE = COMPANY_ACCOUNT_FALLBACKS.saleAccountCode // 5000

type Rule = { code: string; test: RegExp }

// Order matters: the first match wins (a "laptop repair" is a repair, "toner" is not a printer).
const RULES: Rule[] = [
  // Services
  { code: '5107', test: /\bdata recovery\b/i },
  { code: '5106', test: /\b(backup service|data backup)\b/i },
  { code: '5122', test: /\b(software|windows|os|office|antivirus)\b.*\b(install\w*|support|configur\w*|setup)\b|\b(install\w*|configur\w*|setup)\b.*\b(software|windows|os|office|antivirus)\b/i },
  { code: '5121', test: /\b(repair\w*|diagnos\w*|labou?r|servicing|maintenance|reball\w*|re-?paste|installation|technical support|call ?out)\b/i },
  { code: '5009', test: /\b(licen[cs]e\w*|windows 1[01]|microsoft 365|office 365|office 20\d\d|antivirus|kaspersky|eset|norton|mcafee|bitdefender|autocad|adobe)\b/i },
  { code: '5011', test: /\b(toner|cartridge|ink|drum unit|ribbon)\b/i },
  { code: '5008', test: /\b(printer|laserjet|deskjet|officejet|ecotank|scanner|photocopier|mfp)\b/i },
  { code: '5005', test: /\b(server|poweredge|proliant|primergy|rack ?mount)\b/i },
  // Machines by model name, even when the line lists RAM / SSD specs
  { code: '5003', test: /\b(optiplex|prodesk|elitedesk|thinkcentre|imac|mac mini|all[- ]in[- ]one|aio|veriton|elite ?one|pro ?one)\b/i },
  { code: '5001', test: /\b(elitebook|probook|zbook|latitude|thinkpad|ideapad|yoga|vostro|inspiron|xps|macbook|surface (pro|laptop|book|go)|chromebook|spectre|envy|aspire|travelmate|vivobook|zenbook|dynabook|toshiba|omen|victus|legion|expertbook)\b/i },
  // A processor spec means a whole computer
  { code: '5003', test: /\b(core ?i[3579]|i[3579]-?\d{3,5}\w*|ryzen|celeron|pentium|xeon)\b.*\b(desktop|tower|sff|mini pc|combo)\b|\b(desktop|tower|sff|mini pc|combo)\b.*\b(core ?i[3579]|i[3579]-?\d{3,5}\w*|ryzen|celeron|pentium|xeon)\b/i },
  { code: '5001', test: /\b(core ?i[3579]|i[3579]-?\d{3,5}\w*|ryzen|celeron|pentium|apple m[1-4])\b/i },
  { code: '5004', test: /\b(monitor|display)\b/i },
  { code: '5007', test: /\b(ups|inverter|apc|surge protector|power backup|stabili[sz]er|avr)\b/i },
  { code: '5012', test: /\b(router|switch|access point|ubiquiti|unifi|mikrotik|cisco|tp-?link|cat ?6|cat ?5e?|patch (cord|panel)|networking|firewall|wi-?fi extender)\b/i },
  { code: '5002', test: /\b(mouse|keyboard|charger|adapter|adaptor|bag|sleeve|backpack|headset|headphones?|cable|hdmi|vga|docking|dock|webcam|usb hub|hub|cooling pad|power bank|extension)\b/i },
  { code: '5006', test: /\b(ssd|hdd|hard (disk|drive)|external drive|nas|flash ?(disk|drive)|memory card|sd card|pen ?drive|usb drive|nvme)\b/i },
  { code: '5010', test: /\b(ram|ddr\d|motherboard|battery|lcd|hinge|fan|heat ?sink|dc jack|palm ?rest|bottom (case|cover)|spares?|parts?)\b/i },
  { code: '5003', test: /\b(desktop|tower|sff|mini pc|combo)\b/i },
  { code: '5001', test: /\b(laptops?|notebooks?)\b/i },
  { code: '5013', test: /\b(phone|iphone|ipad|tablet|galaxy|smart ?watch|tv|television|earbuds|airpods|speaker)\b/i },
]

/** The sales account a description points to, if any. */
export function salesCodeFromText(...texts: Array<string | undefined | null>): string | undefined {
  const text = texts.filter(Boolean).join(' ')
  if (!text.trim()) return undefined
  return RULES.find(r => r.test.test(text))?.code
}

export type SaleLineInput = {
  productId?: string
  accountCode?: string
  lineType?: string
  description?: string
  productName?: string
  subtotal?: number
  qty?: number
  price?: number
  unitPrice?: number
}

const lineAmount = (l: SaleLineInput) => {
  const sub = Number(l.subtotal)
  if (Number.isFinite(sub) && sub !== 0) return sub
  const qty = Number(l.qty) || 0
  const price = Number(l.price ?? l.unitPrice) || 0
  return qty * price
}

/** The sales account of one line. */
export function saleLineCode(
  line: SaleLineInput,
  product: (AccountableProduct & { name?: string }) | undefined,
  known: (code: string) => boolean,
): string {
  const explicit = String(line.accountCode ?? '').trim().split(/\s+/)[0]
  if (/^5\d{3}$/.test(explicit) && explicit !== GENERAL_SALES_CODE && known(explicit)) return explicit
  if (product) {
    const code = resolveProductAccounts(product).saleAccountCode
    if (code && code !== GENERAL_SALES_CODE && known(code)) return code
  }
  const guess = salesCodeFromText(line.description, line.productName, product?.name)
  if (guess && known(guess)) return guess
  return GENERAL_SALES_CODE
}

/**
 * Splits money received for a sale across its product lines, in proportion to
 * each line's value. Rounded to the cent; the last share takes the remainder.
 */
export function splitSaleAmount(
  amount: number,
  lines: SaleLineInput[],
  products: Map<string, AccountableProduct & { name?: string }>,
  known: (code: string) => boolean,
): Array<{ code: string; amount: number }> {
  const byCode = new Map<string, number>()
  for (const l of lines ?? []) {
    if (l.lineType === 'section') continue
    const value = lineAmount(l)
    if (!(value > 0)) continue
    const code = saleLineCode(l, l.productId ? products.get(l.productId) : undefined, known)
    byCode.set(code, (byCode.get(code) ?? 0) + value)
  }
  const total = [...byCode.values()].reduce((s, v) => s + v, 0)
  if (!(total > 0)) return [{ code: GENERAL_SALES_CODE, amount }]
  const parts = [...byCode.entries()].sort((a, b) => b[1] - a[1])
  let left = Math.round(amount * 100)
  return parts.map(([code, value], i) => {
    const cents = i === parts.length - 1 ? left : Math.round((amount * 100 * value) / total)
    left -= cents
    return { code, amount: cents / 100 }
  })
}

/** The hand-typed lines that could not be matched to a product line ("Other sales"). */
export function unmatchedSaleLines(
  lines: SaleLineInput[],
  products: Map<string, AccountableProduct & { name?: string }>,
  known: (code: string) => boolean,
): string[] {
  return (lines ?? [])
    .filter(l => l.lineType !== 'section' && lineAmount(l) > 0)
    .filter(l => saleLineCode(l, l.productId ? products.get(l.productId) : undefined, known) === GENERAL_SALES_CODE)
    .map(l => String(l.description || l.productName || 'Line without a description').trim())
}

export type BillLineInput = SaleLineInput

/**
 * What a supplier payment paid for, split like a sale: stock bought shows its
 * product line (Laptops, Desktops…), overheads show their expense account
 * (Rent, Internet…), anything else shows the account it was booked to.
 */
export function splitBillAmount(
  amount: number,
  lines: BillLineInput[],
  products: Map<string, AccountableProduct & { name?: string }>,
  known: (code: string) => boolean,
  accountName: (code: string) => string | undefined,
): Array<{ key: string; name: string; amount: number }> {
  const groups = new Map<string, { name: string; value: number }>()
  for (const l of lines ?? []) {
    if (l.lineType === 'section') continue
    const value = lineAmount(l)
    if (!(value > 0)) continue
    const code = String(l.accountCode ?? '').trim().split(/\s+/)[0]
    let key: string
    let name: string
    if (code && isOperatingExpenseCode(code)) {
      key = `acct:${code}`
      name = accountName(code) ?? `Account ${code}`
    } else {
      const product = l.productId ? products.get(l.productId) : undefined
      const line = saleLineCode(l, product, known)
      if (line !== GENERAL_SALES_CODE) {
        key = `line:${line}`
        name = accountName(line) ?? 'Stock purchases'
      } else if (code && accountName(code)) {
        key = `acct:${code}`
        name = accountName(code)!
      } else {
        key = 'purchases'
        name = 'Other purchases'
      }
    }
    const g = groups.get(key) ?? { name, value: 0 }
    g.value += value
    groups.set(key, g)
  }
  const total = [...groups.values()].reduce((s, g) => s + g.value, 0)
  if (!(total > 0)) return [{ key: 'purchases', name: 'Supplier payment', amount }]
  const parts = [...groups.entries()].sort((a, b) => b[1].value - a[1].value)
  let left = Math.round(amount * 100)
  return parts.map(([key, g], i) => {
    const cents = i === parts.length - 1 ? left : Math.round((amount * 100 * g.value) / total)
    left -= cents
    return { key, name: g.name, amount: cents / 100 }
  })
}
