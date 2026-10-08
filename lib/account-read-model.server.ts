import 'server-only'

import prisma from '@/lib/prisma'
import type { AccountCode, Prisma } from '@prisma/client'
import { z } from 'zod'
import { getRequiredSession } from '@/lib/auth/api'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'

/**
 * The chart of accounts as the screens use it, read from account_codes (the
 * deed_accounts screen copy is frozen — see lib/invoice-read-model.server.ts
 * for the same step on invoices). Accounts are created and edited through
 * /api/accounting/accounts, which writes the table.
 *
 * Each account keeps the id the screens already used for it (screen_id), so
 * anything that points at that id still resolves. Accounts only the frozen
 * copy has stay listed so nothing disappears from a screen.
 */

type Row = Record<string, any>

/** Who may add or edit accounts: the same people the deed_accounts write policy allowed. */
export async function requireAccountEditor() {
  const session = await getRequiredSession()
  if (!canWriteStoreKey(session.user, 'deed_accounts')) {
    const error = new Error('You do not have permission to change the chart of accounts')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }
  return session.user
}

export function toScreenAccount(a: AccountCode): Row {
  return {
    id: a.screenId || a.id,
    code: a.code,
    name: a.name,
    type: a.accountType,
    group: a.accountGroup ?? '',
    ...(a.subGroup ? { subGroup: a.subGroup } : {}),
    isActive: a.isActive,
    balance: Number(a.balance),
    ...(a.isDynamic ? { isDynamic: true } : {}),
    ...(a.dynamicKey ? { dynamicKey: a.dynamicKey } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
    ...(a.bankAccountId ? { bankAccountId: a.bankAccountId } : {}),
  }
}

export async function loadScreenAccounts(screenCopy: unknown): Promise<Row[]> {
  const copy = Array.isArray(screenCopy) ? screenCopy as Row[] : []
  const rows = await prisma.accountCode.findMany({ orderBy: { code: 'asc' } })
  const out = rows.map(toScreenAccount)
  const codes = new Set(rows.map(r => r.code))
  for (const r of copy) {
    if (r?.code && !codes.has(String(r.code).trim())) out.push(r)
  }
  return out
}

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const
const DYNAMIC_KEYS = ['ar', 'ap', 'revenue', 'salaries', 'net_profit'] as const
const optText = (max: number) => z.string().trim().max(max).nullable().optional()

export const accountBodySchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  type: z.enum(TYPES),
  group: z.string().trim().max(120),
  subGroup: optText(120),
  isActive: z.boolean().optional(),
  balance: z.coerce.number().finite().optional(),
  isDynamic: z.boolean().optional(),
  dynamicKey: z.enum(DYNAMIC_KEYS).nullable().optional(),
  notes: optText(2000),
  bankAccountId: optText(120),
})

export type AccountBody = z.infer<typeof accountBodySchema>

/** Table columns for a create or an edit. Keys the body leaves out are not touched. */
export function accountData(body: Partial<AccountBody>): Prisma.AccountCodeUpdateInput {
  const data: Prisma.AccountCodeUpdateInput = {}
  if (body.code !== undefined) data.code = body.code
  if (body.name !== undefined) data.name = body.name
  if (body.type !== undefined) data.accountType = body.type
  if (body.group !== undefined) data.accountGroup = body.group || null
  if (body.subGroup !== undefined) data.subGroup = body.subGroup || null
  if (body.isActive !== undefined) data.isActive = body.isActive
  if (body.balance !== undefined) data.balance = Math.round(body.balance * 100) / 100
  if (body.isDynamic !== undefined) data.isDynamic = body.isDynamic
  if (body.dynamicKey !== undefined) data.dynamicKey = body.dynamicKey || null
  if (body.notes !== undefined) data.notes = body.notes || null
  if (body.bankAccountId !== undefined) data.bankAccountId = body.bankAccountId || null
  return data
}

/** The account a screen id names: the id it was shown with, or the table id. */
export async function findAccountByScreenId(id: string) {
  const byScreen = await prisma.accountCode.findFirst({ where: { screenId: id } })
  if (byScreen) return byScreen
  return z.string().uuid().safeParse(id).success ? prisma.accountCode.findUnique({ where: { id } }) : null
}
