import 'server-only'
import prisma from '@/lib/prisma'
import { persistStoreJournalEntryInTx } from '@/lib/accounting/journal-service'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import {
  ACCUM_DEPR_LABELS,
  DEPR_EXPENSE_LABEL,
  PPE_COST_LABELS,
  accumDeprAccountForPpe,
  isPpeCostAccount,
  monthlyBookDepreciation,
  moneyKes,
} from '@/lib/company-property-ppe'
import { depreciationJournalRef } from '@/lib/accounting/ppe-journals'
import { roundMoney } from '@/lib/accounting/money'

const CLASS_TO_PPE: Record<string, string> = {
  computer: '1701',
  it_non_trading: '1701',
  furniture: '1702',
  fittings: '1702',
  office_equipment: '1703',
  software: '1704',
}

export async function listFixedAssets() {
  return prisma.fixedAsset.findMany({ orderBy: { assetNumber: 'asc' } })
}

export async function createFixedAsset(params: {
  assetNumber: string
  name: string
  assetClass: string
  acquisitionDate: string
  acquisitionCost: number
  residualValue?: number
  usefulLifeMonths: number
  depreciationMethod?: string
  createdById?: string
}) {
  const cost = roundMoney(params.acquisitionCost)
  const residual = roundMoney(params.residualValue || 0)
  const ppe = CLASS_TO_PPE[params.assetClass] || (isPpeCostAccount(params.assetClass) ? params.assetClass : '1702')
  const ppeLabel = PPE_COST_LABELS[ppe as keyof typeof PPE_COST_LABELS] || `${ppe} — PPE`

  return prisma.$transaction(async tx => {
    const journal = await persistStoreJournalEntryInTx(tx, {
      ref: `JRN/AST-CAP/${params.assetNumber}`,
      date: params.acquisitionDate,
      source: 'adjustment',
      description: `Capitalise ${params.assetNumber} — ${params.name}`,
      lines: [
        { account: ppeLabel, description: `Acquire ${params.name}`, debit: cost, credit: 0 },
        { account: '3000 - Accounts Payable', description: `AP capitalise ${params.assetNumber}`, debit: 0, credit: cost },
      ],
    }, { createdById: params.createdById, journalCode: 'MISC' })

    const asset = await tx.fixedAsset.create({
      data: {
        assetNumber: params.assetNumber,
        name: params.name,
        assetClass: params.assetClass,
        acquisitionDate: new Date(`${params.acquisitionDate}T00:00:00Z`),
        inServiceDate: new Date(`${params.acquisitionDate}T00:00:00Z`),
        acquisitionCost: cost,
        residualValue: residual,
        usefulLifeMonths: params.usefulLifeMonths,
        depreciationMethod: params.depreciationMethod || 'straight_line',
        accumulatedDepreciation: 0,
        carryingValue: cost,
        status: 'active',
        acquisitionJournalId: journal.id,
      },
    })

    await writeFinancialAuditInTx(tx, {
      userId: params.createdById,
      action: 'create_fixed_asset',
      entityType: 'fixed_asset',
      entityId: asset.id,
      relatedJournalId: journal.id,
      newValues: { assetNumber: asset.assetNumber, cost },
    })

    return { asset, journal }
  }, { isolationLevel: 'Serializable' })
}

export async function postPeriodDepreciation(params: { period: string; createdById?: string }) {
  if (!/^\d{4}-\d{2}$/.test(params.period)) {
    throw Object.assign(new Error('period must be YYYY-MM'), { status: 400 })
  }
  const assets = await prisma.fixedAsset.findMany({ where: { status: 'active' } })
  const charges: Array<{ asset: typeof assets[number]; amount: number }> = []
  for (const asset of assets) {
    const existing = await prisma.assetDepreciationEntry.findUnique({
      where: { fixedAssetId_period: { fixedAssetId: asset.id, period: params.period } },
    })
    if (existing?.journalEntryId) continue
    const amount = monthlyBookDepreciation({
      costKes: Number(asset.acquisitionCost),
      residualKes: Number(asset.residualValue),
      accumDeprKes: Number(asset.accumulatedDepreciation),
      usefulLifeMonths: asset.usefulLifeMonths,
      depreciationMethod: asset.depreciationMethod === 'reducing_balance' ? 'reducing_balance' : 'straight_line',
      category: 'furniture',
    })
    if (amount <= 0) continue
    charges.push({ asset, amount })
  }
  if (charges.length === 0) {
    return { posted: 0, period: params.period, journal: null }
  }

  const byAccum = new Map<string, number>()
  let total = 0
  for (const row of charges) {
    const ppe = CLASS_TO_PPE[row.asset.assetClass] || '1702'
    const accum = accumDeprAccountForPpe(ppe) || '1752'
    byAccum.set(accum, moneyKes((byAccum.get(accum) ?? 0) + row.amount))
    total += row.amount
  }

  const lines = [
    { account: DEPR_EXPENSE_LABEL, description: `Depreciation ${params.period}`, debit: moneyKes(total), credit: 0 },
    ...Array.from(byAccum.entries()).map(([code, amount]) => ({
      account: ACCUM_DEPR_LABELS[code] || `${code} — Accum. Depr.`,
      description: `Accum. depr. ${params.period}`,
      debit: 0,
      credit: amount,
    })),
  ]

  const periodEnd = `${params.period}-${String(new Date(Number(params.period.slice(0, 4)), Number(params.period.slice(5, 7)), 0).getDate()).padStart(2, '0')}`

  return prisma.$transaction(async tx => {
    const journal = await persistStoreJournalEntryInTx(tx, {
      ref: depreciationJournalRef(params.period),
      date: periodEnd,
      source: 'adjustment',
      description: `Monthly depreciation ${params.period}`,
      lines,
    }, { createdById: params.createdById, journalCode: 'MISC' })

    for (const row of charges) {
      const nextAccum = roundMoney(Number(row.asset.accumulatedDepreciation) + row.amount)
      const nextCarry = roundMoney(Math.max(0, Number(row.asset.acquisitionCost) - nextAccum))
      await tx.assetDepreciationEntry.upsert({
        where: { fixedAssetId_period: { fixedAssetId: row.asset.id, period: params.period } },
        create: {
          fixedAssetId: row.asset.id,
          period: params.period,
          depreciationAmount: row.amount,
          journalEntryId: journal.id,
          postedAt: new Date(),
        },
        update: {
          depreciationAmount: row.amount,
          journalEntryId: journal.id,
          postedAt: new Date(),
        },
      })
      await tx.fixedAsset.update({
        where: { id: row.asset.id },
        data: { accumulatedDepreciation: nextAccum, carryingValue: nextCarry },
      })
    }

    await writeFinancialAuditInTx(tx, {
      userId: params.createdById,
      action: 'post_depreciation',
      entityType: 'fixed_asset',
      entityId: charges[0]?.asset.id,
      relatedJournalId: journal.id,
      newValues: { period: params.period, assetCount: charges.length, total },
    })

    return { posted: charges.length, period: params.period, journal }
  }, { isolationLevel: 'Serializable' })
}
