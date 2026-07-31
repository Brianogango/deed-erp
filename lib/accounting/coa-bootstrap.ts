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

/**
 * Ensure deed_accounts exists and is dual-written — never deletes keys,
 * never overwrites live relational balances with seed demo numbers.
 */
export async function bootstrapChartOfAccounts() {
  const state = await loadAppState(['deed_accounts'])
  const blob = asAccounts(state.deed_accounts)
  if (blob.length > 0) {
    const mirror = await mirrorAccountsToPrisma(blob, { force: true })
    return {
      source: 'blob' as const,
      blobCount: blob.length,
      mirror,
      note: 'deed_accounts already present — mirrored metadata only',
    }
  }

  const relational = await prisma.accountCode.findMany({ orderBy: { code: 'asc' } })
  if (relational.length > 0) {
    const fromPrisma = relational.map((r, i) => ({
      id: `coa-prisma-${r.code}`,
      code: r.code,
      name: r.name,
      type: r.accountType,
      group: r.accountGroup || 'General',
      subGroup: r.subGroup || 'General',
      isActive: r.isActive,
      balance: 0, // live TB uses journal lines; do not push static balances into UI seed
      isDynamic: r.isDynamic,
      dynamicKey: r.dynamicKey || undefined,
      notes: r.notes || undefined,
    }))
    await saveStoreKeys({ deed_accounts: JSON.stringify(fromPrisma) })
    return {
      source: 'prisma' as const,
      blobCount: fromPrisma.length,
      mirror: { mirrored: 0, skipped: relational.length, failed: 0 },
      note: 'Synthesized deed_accounts from account_codes (balances zeroed for blob; TB from journals)',
    }
  }

  const template = coaTemplateToBlobAccounts(buildZeroBalanceCoaTemplate())
  await saveStoreKeys({ deed_accounts: JSON.stringify(template) })
  const mirror = await mirrorAccountsToPrisma(template, { force: true })
  return {
    source: 'template' as const,
    blobCount: template.length,
    mirror,
    note: 'Created zero-balance CoA template into deed_accounts + account_codes',
  }
}
