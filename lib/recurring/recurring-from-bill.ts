/**
 * "Repeat this bill" on the vendor bill form: the bill just saved becomes a
 * recurring bill, with this period already counted as done so the next one
 * is the first that shows as due.
 */
import { roundMoney } from '@/lib/accounting/money'
import type { Frequency, RecurringLine } from '@/lib/recurring/recurring-bills'

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const PERIOD_WORDS = new RegExp(`\\s*(?:\\bfor\\s+)?(?:\\b${MONTH}\\b\\.?(?:\\s*[-/,]?\\s*(?:20\\d{2}|\\d{2}\\b))?|\\b20\\d{2}(?:[-/]\\d{1,2})?\\b|\\bq[1-4]\\b)`, 'gi')

/** "Office rent October 2026" → "Office rent": the month belongs to one bill, not to every one after it. */
export function withoutPeriod(text: string): string {
  const cleaned = text.replace(PERIOD_WORDS, ' ').replace(/\s+/g, ' ').replace(/[\s,.:;\-–—(]+$/, '').replace(/\(\s*\)/g, '').trim()
  return cleaned || text.trim()
}

type PreviewLine = { lineType?: string; description: string; accountCode?: string; subtotal: number; taxRate?: number }

export function recurringFromBill(input: {
  vendorId: string
  vendorName: string
  billDate: string
  frequency: Frequency
  amountChanges: boolean
  vatRate: number
  lines: PreviewLine[]
  notes?: string
}) {
  const items = input.lines.filter(l => l.lineType !== 'section' && roundMoney(l.subtotal) > 0)
  // A bill with VAT per line (not "VAT on all lines") repeats with that rate when every line shares it.
  const rates = [...new Set(items.map(l => Number(l.taxRate) || 0))]
  const vatRate = input.vatRate || (rates.length === 1 ? rates[0] : 0)
  const lines: RecurringLine[] = items.map(l => ({
    description: withoutPeriod(l.description).slice(0, 200),
    accountCode: String(l.accountCode ?? '').trim() || undefined,
    amount: input.amountChanges ? null : roundMoney(l.subtotal),
  }))
  return {
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    title: (items[0] ? withoutPeriod(items[0].description) : `${input.vendorName} bill`).slice(0, 120),
    frequency: input.frequency,
    dayOfMonth: Number(input.billDate.slice(8, 10)) || 1,
    startDate: input.billDate,
    vatRate,
    lines,
    notes: input.notes || undefined,
  }
}

/** Saves it. Resolves to an error message, or null when saved. */
export async function saveBillAsRecurring(input: Parameters<typeof recurringFromBill>[0] & { bill: { id: string; ref: string } }): Promise<string | null> {
  const send = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({})) as { error?: string; item?: { id: string } }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }
  try {
    // One request: this period is saved as already billed together with the
    // recurring bill, so it can never show as due a second time.
    await send('/api/recurring-bills', 'POST', {
      ...recurringFromBill(input),
      alreadyBilled: { billDate: input.billDate, invoiceId: input.bill.id, invoiceRef: input.bill.ref },
    })
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'could not reach the server'
  }
}
