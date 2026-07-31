import 'server-only'
import { createJournalEntry } from '@/lib/accounting/journal-service'

/** Plausible CoA labels — gain is other income; loss matches seeded financial expenses. */
export const FX_GAIN_ACCOUNT = '5206 - Realized Exchange Gain'
export const FX_LOSS_ACCOUNT = '6705 - Realized and Unrealized Exchange Loss'

function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

export type PostFxGainLossInput = {
  amountBase: number
  amountForeign: number
  rate: number
  accountGain?: string
  accountLoss?: string
  ref: string
  date?: Date | string
  userId?: string
  /** Receivable/payable or bank account being revalued */
  balanceAccountLabel: string
  description?: string
}

/**
 * Post a balanced FX revaluation journal.
 * Gain: Dr balance / Cr gain. Loss: Dr loss / Cr balance.
 */
export async function postFxGainLoss(params: PostFxGainLossInput) {
  const impliedBase = round2(params.amountForeign * params.rate)
  const bookedBase = round2(params.amountBase)
  const diff = round2(impliedBase - bookedBase)
  if (Math.abs(diff) < 0.01) {
    return { skipped: true as const, reason: 'no_fx_difference', diff: 0 }
  }

  const gainAccount = params.accountGain ?? FX_GAIN_ACCOUNT
  const lossAccount = params.accountLoss ?? FX_LOSS_ACCOUNT
  const journalRef = `JRN/FX/${String(params.ref).replace(/\s+/g, '').slice(0, 60)}`
  const isGain = diff > 0
  const amount = Math.abs(diff)

  await createJournalEntry({
    ref: journalRef,
    journalCode: 'MISC',
    date: params.date ?? new Date(),
    description: params.description ?? `FX revaluation ${params.ref} (${isGain ? 'gain' : 'loss'} KES ${amount})`,
    sourceType: 'fx_revaluation',
    sourceId: params.ref,
    createdById: params.userId,
    skipIfExists: true,
    lines: isGain
      ? [
          { accountLabel: params.balanceAccountLabel, label: 'FX revaluation', debit: amount, credit: 0 },
          { accountLabel: gainAccount, label: 'Exchange gain', debit: 0, credit: amount },
        ]
      : [
          { accountLabel: lossAccount, label: 'Exchange loss', debit: amount, credit: 0 },
          { accountLabel: params.balanceAccountLabel, label: 'FX revaluation', debit: 0, credit: amount },
        ],
  })

  return { skipped: false as const, diff, isGain, amount, journalRef }
}
