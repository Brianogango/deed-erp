import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { buildZeroBalanceCoaTemplate } from '@/lib/accounting/coa-template'

/**
 * Create the named chart-template accounts a live chart is missing (ledger
 * and the Finance account list). Only those codes — never any other template
 * account, never a balance, never a rename of an existing account.
 */
export async function ensureTemplateAccounts(codes: string[]): Promise<void> {
  const wanted = buildZeroBalanceCoaTemplate().filter(row => codes.includes(row.code))
  if (!wanted.length) return
  const existing = new Set((await prisma.accountCode.findMany({
    where: { code: { in: wanted.map(r => r.code) } },
    select: { code: true },
  })).map(r => r.code))
  for (const row of wanted) {
    if (existing.has(row.code)) continue
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
  const state = await loadAppState(['deed_accounts'])
  const blob = Array.isArray(state.deed_accounts) ? state.deed_accounts as Array<{ code?: string }> : []
  const missing = wanted.filter(row => !blob.some(a => String(a?.code) === row.code))
  if (blob.length && missing.length) {
    await saveStoreKeys({
      deed_accounts: JSON.stringify([...blob, ...missing.map(row => ({
        id: `coa-control-${row.code}`,
        code: row.code,
        name: row.name,
        type: row.type,
        group: row.group,
        subGroup: row.subGroup,
        isActive: true,
        balance: 0,
        notes: row.notes,
      }))]),
    })
  }
}
