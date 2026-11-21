/**
 * How a bank / cash account reads in a picker: the bank, then the account's
 * last four digits — "NCBA Bank · ••4521". The account name is often the
 * holder ("Deed Technologies Ltd"), the same on every account, so a list of
 * them told the payer nothing. An account with no bank name (petty cash, an
 * M-Pesa paybill) reads as its own name.
 *
 * Pure.
 */
export function bankChoiceLabel(account: { name?: string | null; bankName?: string | null; accountNo?: string | null; id?: string | null }): string {
  const bank = String(account.bankName ?? '').trim()
  const name = String(account.name ?? '').trim()
  const digits = String(account.accountNo ?? '').replace(/\s+/g, '')
  const tail = digits.length > 4 ? `••${digits.slice(-4)}` : digits
  const base = bank || name || String(account.id ?? '')
  return tail ? `${base} · ${tail}` : base
}
