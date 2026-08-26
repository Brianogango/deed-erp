/**
 * PPE journals for Company Property Phase 2.
 * Blob journals stay balanced; refs are idempotent.
 */

import type { BookAsset } from '@/lib/company-property-ppe'
import {
  ACCUM_DEPR_LABELS,
  AP_LABEL,
  DEPR_EXPENSE_LABEL,
  DISPOSAL_GAIN_LABEL,
  DISPOSAL_LOSS_LABEL,
  INVENTORY_LABEL,
  PPE_COST_LABELS,
  accumDeprAccountForPpe,
  disposalAmounts,
  isPpeCostAccount,
  moneyKes,
} from '@/lib/company-property-ppe'

export type PpeJournalLine = {
  account: string
  description: string
  debit: number
  credit: number
}

export type PpeJournalDraft = {
  ref: string
  date: string
  description: string
  source: 'adjustment'
  lines: PpeJournalLine[]
  totalDebit: number
  totalCredit: number
}

function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

function ppeLabel(code?: string | null): string {
  return isPpeCostAccount(code) ? PPE_COST_LABELS[code] : `${code} — PPE`
}

function accumLabel(costCode?: string | null): string {
  const accum = accumDeprAccountForPpe(costCode)
  return accum ? (ACCUM_DEPR_LABELS[accum] ?? `${accum} — Accum. Depr.`) : '1752 — Accum. Depr. Furniture & Fittings'
}

function pack(lines: PpeJournalLine[], meta: Omit<PpeJournalDraft, 'lines' | 'totalDebit' | 'totalCredit'>): PpeJournalDraft {
  const cleaned = lines.filter(l => round2(l.debit) !== 0 || round2(l.credit) !== 0)
  const totalDebit = round2(cleaned.reduce((s, l) => s + l.debit, 0))
  const totalCredit = round2(cleaned.reduce((s, l) => s + l.credit, 0))
  return { ...meta, lines: cleaned, totalDebit, totalCredit }
}

export function capitaliseJournalRef(assetRef?: string): string {
  return `JRN/AST-CAP/${assetRef || 'AST'}`
}

export function depreciationJournalRef(period: string): string {
  return `JRN/AST-DEP/${period}`
}

export function disposalJournalRef(assetRef: string, suffix?: string): string {
  return suffix ? `JRN/AST-DISP/${assetRef}/${suffix}` : `JRN/AST-DISP/${assetRef}`
}

export function buildCapitaliseFromApJournal(asset: Pick<BookAsset, 'ref' | 'name' | 'costKes' | 'ppeAccountCode' | 'supplierName'>, date: string): PpeJournalDraft | null {
  const cost = moneyKes(asset.costKes)
  if (cost <= 0 || !isPpeCostAccount(asset.ppeAccountCode)) return null
  const partner = asset.supplierName?.trim() || 'Vendor'
  const ref = asset.ref || 'AST'
  return pack([
    { account: ppeLabel(asset.ppeAccountCode), description: `Capitalise ${ref} — ${asset.name}`, debit: cost, credit: 0 },
    { account: AP_LABEL, description: `AP: ${partner} (${ref})`, debit: 0, credit: cost },
  ], {
    ref: capitaliseJournalRef(ref),
    date,
    description: `Capitalise ${ref} from purchase (PPE, not inventory 1200)`,
    source: 'adjustment',
  })
}

export function buildCapitaliseFromInventoryJournal(asset: Pick<BookAsset, 'ref' | 'name' | 'costKes' | 'ppeAccountCode' | 'serialNumber'>, date: string): PpeJournalDraft | null {
  const cost = moneyKes(asset.costKes)
  if (cost <= 0 || !isPpeCostAccount(asset.ppeAccountCode)) return null
  const ref = asset.ref || 'AST'
  return pack([
    { account: ppeLabel(asset.ppeAccountCode), description: `Capitalise demo ${ref} — ${asset.name}`, debit: cost, credit: 0 },
    { account: INVENTORY_LABEL, description: `Remove trading serial ${asset.serialNumber || ref} from 1200`, debit: 0, credit: cost },
  ], {
    ref: capitaliseJournalRef(ref),
    date,
    description: `Capitalise trading serial into ${ref} (Dr PPE / Cr inventory 1200)`,
    source: 'adjustment',
  })
}

export function buildDepreciationJournal(
  period: string,
  charges: Array<{ asset: Pick<BookAsset, 'ref' | 'name' | 'ppeAccountCode'>; amount: number }>,
  date: string,
): PpeJournalDraft | null {
  const byAccum = new Map<string, number>()
  let total = 0
  for (const row of charges) {
    const amount = moneyKes(row.amount)
    if (amount <= 0) continue
    const accum = accumDeprAccountForPpe(row.asset.ppeAccountCode)
    if (!accum) continue
    byAccum.set(accum, moneyKes((byAccum.get(accum) ?? 0) + amount))
    total += amount
  }
  if (total <= 0) return null
  const lines: PpeJournalLine[] = [
    { account: DEPR_EXPENSE_LABEL, description: `Depreciation ${period}`, debit: moneyKes(total), credit: 0 },
  ]
  for (const [code, amount] of byAccum) {
    lines.push({
      account: ACCUM_DEPR_LABELS[code] ?? `${code} — Accum. Depr.`,
      description: `Accum. depr. ${period}`,
      debit: 0,
      credit: amount,
    })
  }
  return pack(lines, {
    ref: depreciationJournalRef(period),
    date,
    description: `Monthly depreciation ${period}`,
    source: 'adjustment',
  })
}

export function buildDisposalJournal(
  asset: Pick<BookAsset, 'ref' | 'name' | 'costKes' | 'accumDeprKes' | 'qty' | 'ppeAccountCode'>,
  qty: number,
  proceedsKes: number,
  date: string,
  cashAccountLabel = '2211 - Petty Cash',
  refSuffix?: string,
): PpeJournalDraft | null {
  if (!isPpeCostAccount(asset.ppeAccountCode)) return null
  const { cost, accum, proceeds, gain } = disposalAmounts(asset, qty, proceedsKes)
  if (cost <= 0 && accum <= 0 && proceeds <= 0) return null
  const lines: PpeJournalLine[] = []
  if (proceeds > 0) {
    lines.push({ account: cashAccountLabel, description: `Proceeds ${asset.ref}`, debit: proceeds, credit: 0 })
  }
  if (accum > 0) {
    lines.push({ account: accumLabel(asset.ppeAccountCode), description: `Clear accum. depr. ${asset.ref}`, debit: accum, credit: 0 })
  }
  if (gain < 0) {
    lines.push({ account: DISPOSAL_LOSS_LABEL, description: `Loss on disposal ${asset.ref}`, debit: moneyKes(-gain), credit: 0 })
  }
  if (cost > 0) {
    lines.push({ account: ppeLabel(asset.ppeAccountCode), description: `Clear cost ${asset.ref}`, debit: 0, credit: cost })
  }
  if (gain > 0) {
    lines.push({ account: DISPOSAL_GAIN_LABEL, description: `Gain on disposal ${asset.ref}`, debit: 0, credit: gain })
  }
  return pack(lines, {
    ref: disposalJournalRef(asset.ref || 'AST', refSuffix),
    date,
    description: `Dispose ${asset.ref} — ${asset.name}`,
    source: 'adjustment',
  })
}
