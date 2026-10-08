import 'server-only'
import prisma from '@/lib/prisma'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { buildZeroBalanceCoaTemplate } from '@/lib/accounting/coa-template'
import { OPENING_BALANCE_EQUITY_CODE } from '@/lib/finance/opening-balance'

/**
 * 4004 Opening Balance Equity is in the chart template, but a live chart may
 * predate it. Create that one account (ledger and the Finance account list)
 * when it is missing — never any other template account, never a balance.
 */
export async function ensureOpeningBalanceEquityAccount(): Promise<void> {
  const template = buildZeroBalanceCoaTemplate().find(row => row.code === OPENING_BALANCE_EQUITY_CODE)
  if (!template) return
  const existing = await prisma.accountCode.findUnique({ where: { code: template.code }, select: { id: true } })
  if (!existing) {
    await prisma.accountCode.create({
      data: {
        code: template.code,
        name: template.name,
        accountType: template.type,
        accountGroup: template.group,
        subGroup: template.subGroup,
        isActive: true,
        isDynamic: false,
        notes: template.notes ?? null,
        balance: 0,
      },
    }).catch(err => {
      // Another request created it first.
      if (String((err as { code?: string })?.code) !== 'P2002') throw err
    })
    await notifyStoreKeysChanged(['deed_accounts'])
  }
}
