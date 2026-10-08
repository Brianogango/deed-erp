import 'server-only'
import prisma from '@/lib/prisma'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { buildZeroBalanceCoaTemplate } from '@/lib/accounting/coa-template'

/**
 * Create the named chart-template accounts a live chart is missing (account_codes,
 * which the Finance account list reads). Only those codes — never any other template
 * account, never a balance, never a rename of an existing account.
 */
export async function ensureTemplateAccounts(codes: string[]): Promise<void> {
  const wanted = buildZeroBalanceCoaTemplate().filter(row => codes.includes(row.code))
  if (!wanted.length) return
  const existing = new Set((await prisma.accountCode.findMany({
    where: { code: { in: wanted.map(r => r.code) } },
    select: { code: true },
  })).map(r => r.code))
  const missing = wanted.filter(row => !existing.has(row.code))
  for (const row of missing) {
    await prisma.accountCode.create({
      data: {
        code: row.code,
        name: row.name,
        accountType: row.type,
        accountGroup: row.group,
        subGroup: row.subGroup,
        isActive: true,
        isDynamic: false,
        notes: row.notes ?? null,
        balance: 0,
      },
    }).catch(err => {
      if (String((err as { code?: string })?.code) !== 'P2002') throw err // another request created it
    })
  }
  if (missing.length) await notifyStoreKeysChanged(['deed_accounts'])
}
