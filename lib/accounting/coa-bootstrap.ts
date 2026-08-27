import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { mirrorAccountsToPrisma } from '@/lib/accounting/account-journal-mirror'
import {
  buildZeroBalanceCoaTemplate,
  coaTemplateToBlobAccounts,
} from '@/lib/accounting/coa-template'

function asAccounts(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

const BANK_SEEDS: Array<{ name: string; accountNumber: string; glCode: string }> = [
  { name: 'NCBA Current Account', accountNumber: '1005157785', glCode: '2201' },
  { name: 'ABSA Current Account', accountNumber: '2043953071', glCode: '2201' },
  { name: 'I&M Current Account', accountNumber: '00105512776350', glCode: '2201' },
  { name: 'Equity Bank Account', accountNumber: '0020284195905', glCode: '2202' },
  { name: 'Credit Bank Current', accountNumber: '0131006000351', glCode: '2201' },
  { name: 'M-Pesa Paybill', accountNumber: '880100', glCode: '2210' },
  { name: 'Petty Cash Float', accountNumber: 'CASH', glCode: '2211' },
]

/**
 * Insert any Chart of Accounts, bank, and fiscal-period rows required by the
 * accounting recommendations that are missing on a live database. Never
 * overwrites existing account balances or names.
 */
export async function ensureMissingControlAccounts() {
  const template = buildZeroBalanceCoaTemplate()
  const existing = await prisma.accountCode.findMany({ select: { code: true } })
  const have = new Set(existing.map(r => r.code))
  let accountsCreated = 0
  for (const row of template) {
    if (have.has(row.code)) continue
    await prisma.accountCode.create({
      data: {
        code: row.code,
        name: row.name,
        accountType: row.type,
        accountGroup: row.group,
        subGroup: row.subGroup,
        isActive: true,
        isDynamic: Boolean(row.isDynamic),
        dynamicKey: row.dynamicKey ?? null,
        notes: row.notes ?? null,
        balance: 0,
      },
    })
    have.add(row.code)
    accountsCreated += 1
  }

  const state = await loadAppState(['deed_accounts'])
  const blob = asAccounts(state.deed_accounts)
  if (blob.length > 0) {
    const blobCodes = new Set(blob.map((a: any) => String(a?.code || '')))
    const extras = template.filter(t => !blobCodes.has(t.code)).map(t => ({
      id: `coa-control-${t.code}`,
      code: t.code,
      name: t.name,
      type: t.type,
      group: t.group,
      subGroup: t.subGroup,
      isActive: true,
      balance: 0,
      isDynamic: Boolean(t.isDynamic),
      dynamicKey: t.dynamicKey,
      notes: t.notes,
    }))
    if (extras.length) {
      await saveStoreKeys({ deed_accounts: JSON.stringify([...blob, ...extras]) })
    }
  }

  const glByCode = new Map(
    (await prisma.accountCode.findMany({ select: { id: true, code: true } })).map(r => [r.code, r.id]),
  )
  let banksCreated = 0
  for (const bank of BANK_SEEDS) {
    const glId = glByCode.get(bank.glCode)
      || (bank.glCode === '2210' ? glByCode.get('2211') : null)
    if (!glId) continue
    const exists = await prisma.bankAccount.findFirst({ where: { name: bank.name } })
    if (exists) continue
    await prisma.bankAccount.create({
      data: {
        name: bank.name,
        accountNumber: bank.accountNumber,
        currencyCode: 'KES',
        glAccountId: glId,
        isActive: true,
      },
    })
    banksCreated += 1
  }

  const year = new Date().getUTCFullYear()
  const dateFrom = new Date(Date.UTC(year, 0, 1))
  const dateTo = new Date(Date.UTC(year, 11, 31))
  const existingPeriod = await prisma.fiscalPeriod.findFirst({
    where: { dateFrom, dateTo },
  })
  let periodCreated = 0
  if (!existingPeriod) {
    await prisma.fiscalPeriod.create({
      data: {
        name: String(year),
        dateFrom,
        dateTo,
        state: 'open',
      },
    })
    periodCreated = 1
  }

  return { accountsCreated, banksCreated, periodCreated }
}

/**
 * Ensure deed_accounts exists and is dual-written — never deletes keys,
 * never overwrites live relational balances with seed demo numbers.
 */
export async function bootstrapChartOfAccounts() {
  const state = await loadAppState(['deed_accounts'])
  const blob = asAccounts(state.deed_accounts)
  let result: Record<string, unknown>
  if (blob.length > 0) {
    const mirror = await mirrorAccountsToPrisma(blob, { force: true })
    result = {
      source: 'blob' as const,
      blobCount: blob.length,
      mirror,
      note: 'deed_accounts already present — mirrored metadata only',
    }
  } else {
    const relational = await prisma.accountCode.findMany({ orderBy: { code: 'asc' } })
    if (relational.length > 0) {
      const fromPrisma = relational.map((r) => ({
        id: `coa-prisma-${r.code}`,
        code: r.code,
        name: r.name,
        type: r.accountType,
        group: r.accountGroup || 'General',
        subGroup: r.subGroup || 'General',
        isActive: r.isActive,
        balance: 0,
        isDynamic: r.isDynamic,
        dynamicKey: r.dynamicKey || undefined,
        notes: r.notes || undefined,
      }))
      await saveStoreKeys({ deed_accounts: JSON.stringify(fromPrisma) })
      result = {
        source: 'prisma' as const,
        blobCount: fromPrisma.length,
        mirror: { mirrored: 0, skipped: relational.length, failed: 0 },
        note: 'Synthesized deed_accounts from account_codes (balances zeroed for blob; TB from journals)',
      }
    } else {
      const template = coaTemplateToBlobAccounts(buildZeroBalanceCoaTemplate())
      await saveStoreKeys({ deed_accounts: JSON.stringify(template) })
      const mirror = await mirrorAccountsToPrisma(template, { force: true })
      result = {
        source: 'template' as const,
        blobCount: template.length,
        mirror,
        note: 'Created zero-balance CoA template into deed_accounts + account_codes',
      }
    }
  }
  const controls = await ensureMissingControlAccounts()
  return { ...result, controls }
}
