/**
 * Two leftovers the integrity controls found, both pure bookkeeping:
 *
 *  - Deposit receipts and refunds booked twice. The browser used to post its
 *    own copy (JRN/DEP/<ref>/<first 8 of the payment id>, JRN/REFUND/<ref>)
 *    beside the server's (JRN/DEP/<ref>/<full payment id>,
 *    JRN/DEP/REFUND/<ref>/<id>). The refs never matched, so both stayed live
 *    and customer deposits (3100) were moved twice. The browser copy is the
 *    one reversed; it was removed from the code in store.tsx.
 *  - Booked invoices and bills with VAT but no VAT record (tax_transactions),
 *    so the VAT return missed them. See invoice-tax.server.ts.
 *
 * Pure — ledger-cleanup.server.ts reads and applies.
 */

type JournalLite = { ref: string; sourceType: string | null; amount: number; date: string }

export type DepositDuplicate = {
  /** The browser copy to reverse. */
  ref: string
  amount: number
  date: string
  /** The server entry that stays. */
  keeps: string
}

const SERVER_SOURCES = new Set(['deposit_receipt', 'deposit_refund'])
const same = (a: number, b: number) => Math.abs(a - b) < 0.01

export function planDepositDuplicates(entries: JournalLite[]): DepositDuplicate[] {
  const server = entries.filter(e => SERVER_SOURCES.has(String(e.sourceType)))
  const browser = entries.filter(e => !SERVER_SOURCES.has(String(e.sourceType)))
  const out: DepositDuplicate[] = []
  const used = new Set<string>()
  const take = (e: JournalLite, match: JournalLite | undefined) => {
    if (!match) return false
    used.add(match.ref)
    out.push({ ref: e.ref, amount: e.amount, date: e.date, keeps: match.ref })
    return true
  }
  const receipts = browser.flatMap(e => {
    const m = /^JRN\/DEP\/(?!REFUND\/|APPLY\/)(.+)\/([0-9a-f]{8})$/i.exec(e.ref)
    return m ? [{ e, deposit: m[1], idPrefix: m[2].toLowerCase() }] : []
  })
  const free = (deposit: string, amount: number) => (s: JournalLite) => !used.has(s.ref) && s.sourceType === 'deposit_receipt'
    && s.ref.startsWith(`JRN/DEP/${deposit}/`) && same(s.amount, amount)
  const pending: typeof receipts = []
  // Same payment id first; then the browser copy that carried its own id is
  // paired with a remaining server receipt of the same deposit and amount.
  for (const r of receipts) {
    if (!take(r.e, server.find(s => free(r.deposit, r.e.amount)(s) && s.ref.slice(`JRN/DEP/${r.deposit}/`.length).toLowerCase().startsWith(r.idPrefix) && s.ref.length > r.e.ref.length))) pending.push(r)
  }
  for (const r of pending) take(r.e, server.find(s => free(r.deposit, r.e.amount)(s) && s.ref.length > r.e.ref.length))
  for (const e of browser) {
    const m = /^JRN\/REFUND\/(.+)$/i.exec(e.ref)
    if (m) take(e, server.find(s => !used.has(s.ref) && s.sourceType === 'deposit_refund'
      && s.ref.startsWith(`JRN/DEP/REFUND/${m[1]}/`) && same(s.amount, e.amount)))
  }
  return out
}

/**
 * Customer credit applied to an invoice was booked twice: the browser posted
 * JRN/CAPP/<invoice>/<time> and /api/invoices/[id]/payments booked the same
 * application as a payment entry (Dr 3313 / Cr 1800). Each browser copy is
 * paired with a server entry for the same invoice and amount and reversed;
 * one with no server twin may be the only booking, so it is only listed.
 */
export type CreditEntry = { ref: string; invoiceId: string; amount: number }
export type CreditApplicationDuplicate = { ref: string; invoiceId: string; amount: number; keeps: string }

export function planCreditApplicationDuplicates(browser: CreditEntry[], server: CreditEntry[]): { reverse: CreditApplicationDuplicate[]; unpaired: CreditEntry[] } {
  const used = new Set<string>()
  const reverse: CreditApplicationDuplicate[] = []
  const unpaired: CreditEntry[] = []
  for (const b of [...browser].sort((x, y) => x.ref.localeCompare(y.ref))) {
    const twin = server.find(s => !used.has(s.ref) && s.invoiceId === b.invoiceId && Math.abs(s.amount - b.amount) < 0.01)
    if (!twin) { unpaired.push(b); continue }
    used.add(twin.ref)
    reverse.push({ ...b, keeps: twin.ref })
  }
  return { reverse, unpaired }
}
