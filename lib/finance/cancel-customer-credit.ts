/**
 * Cancelling customer credit given in error (a double credit, a credit that
 * should never have been issued): the credit goes down and nothing is paid
 * out. The journal undoes what created the credit, in its own proportion:
 * the entry that credited Customer Credits debited something (Sales and
 * VAT for a credit note or a cancelled invoice, Trade-in purchases for a
 * buy-back); cancelling credits those back and debits Customer Credits.
 */
type Line = { accountLabel: string; debit: number; credit: number }

const round2 = (n: number) => Math.round(n * 100) / 100

export function cancelCreditJournalLines(
  original: Line[],
  amount: number,
  creditsAccountLabel: string,
  creditRef: string,
): Array<{ accountLabel: string; label: string; debit: number; credit: number }> | null {
  const code = creditsAccountLabel.split(' ')[0]
  const isCredits = (l: Line) => l.accountLabel === creditsAccountLabel || l.accountLabel.split(' ')[0] === code
  const sources = original.filter(l => Number(l.debit) > 0 && !isCredits(l))
  const totalDebit = round2(sources.reduce((s, l) => s + Number(l.debit), 0))
  const v = round2(amount)
  if (!sources.length || totalDebit <= 0 || v <= 0) return null
  const back = sources.map(l => ({
    accountLabel: l.accountLabel,
    label: `Credit ${creditRef} cancelled — put back`,
    debit: 0,
    credit: round2(v * Number(l.debit) / totalDebit),
  }))
  // Rounding goes on the largest line, so the entry always balances.
  const diff = round2(v - back.reduce((s, l) => s + l.credit, 0))
  if (diff !== 0) {
    const big = back.reduce((m, l) => (l.credit > m.credit ? l : m), back[0])
    big.credit = round2(big.credit + diff)
  }
  return [{ accountLabel: creditsAccountLabel, label: `Credit ${creditRef} cancelled (not paid out)`, debit: v, credit: 0 }, ...back]
}
