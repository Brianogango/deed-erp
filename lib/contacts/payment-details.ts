/**
 * How a vendor is paid, read back from the contact's bank fields (the form
 * stores M-Pesa there too, so no new columns are needed):
 *   Bank           bankName = bank,             bankBranch = branch,  bankAccount = account
 *   M-Pesa Paybill bankName = "M-Pesa Paybill", bankBranch = paybill, bankAccount = account
 *   M-Pesa Till    bankName = "M-Pesa Till",    bankAccount = till number
 *   Send money     bankName = "M-Pesa",         bankAccount = phone number
 */
type PaySource = { bankName?: string | null; bankAccount?: string | null; bankBranch?: string | null }
export type PaymentRow = { label: string; value: string; mono?: boolean }

export function paymentDetailRows(c: PaySource): PaymentRow[] {
  const name = String(c.bankName ?? '').trim()
  const account = String(c.bankAccount ?? '').trim()
  const branch = String(c.bankBranch ?? '').trim()
  const rows: PaymentRow[] = []
  const add = (label: string, value: string, mono = false) => { if (value) rows.push({ label, value, mono }) }
  switch (name.toLowerCase()) {
    case 'm-pesa paybill':
      add('Pay via', 'M-Pesa Paybill'); add('Paybill', branch, true); add('Account', account, true); break
    case 'm-pesa till':
      add('Pay via', 'M-Pesa Till'); add('Till number', account, true); break
    case 'm-pesa':
      add('Pay via', 'M-Pesa (send money)'); add('Number', account, true); break
    default:
      add('Bank', name); add('Branch', branch); add('Account', account, true)
  }
  return rows
}

/** One line, e.g. "M-Pesa Paybill 247247 · acc 0712345678". */
export function paymentDetailSummary(c: PaySource): string {
  const name = String(c.bankName ?? '').trim()
  const account = String(c.bankAccount ?? '').trim()
  const branch = String(c.bankBranch ?? '').trim()
  switch (name.toLowerCase()) {
    case 'm-pesa paybill': return [`M-Pesa Paybill ${branch}`.trim(), account && `acc ${account}`].filter(Boolean).join(' · ')
    case 'm-pesa till': return `M-Pesa Till ${account}`.trim()
    case 'm-pesa': return `M-Pesa ${account}`.trim()
    default: return [name, branch, account].filter(Boolean).join(' · ')
  }
}
