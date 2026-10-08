import 'server-only'
import prisma from '@/lib/prisma'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { buildZeroBalanceCoaTemplate } from '@/lib/accounting/coa-template'

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
async function ensureMissingControlAccounts() {
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

  if (accountsCreated) await notifyStoreKeysChanged(['deed_accounts'])

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
 * Make sure the chart of accounts exists in account_codes (which the screens
 * read): the zero-balance template when the table is empty, then any control
 * accounts it is missing. Never deletes or renames an account, never touches a
 * balance.
 */
export async function bootstrapChartOfAccounts() {
  const before = await prisma.accountCode.count()
  const controls = await ensureMissingControlAccounts()
  return {
    source: before > 0 ? 'table' as const : 'template' as const,
    accountsBefore: before,
    controls,
  }
}
