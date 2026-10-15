import 'server-only'
import type { Prisma } from '@prisma/client'
import { loadAppState } from '@/lib/server-store'
import { cashAccountRoleForBankId, labelForRole } from '@/lib/accounting/coa-roles'
import { isUuid } from '@/lib/legacy-compat'

type Db = Pick<Prisma.TransactionClient, 'bankAccount' | 'accountCode'>

export class BankAccountRefError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

type CashbookEntry = { id?: unknown; name?: unknown; bankName?: unknown; active?: unknown }

async function cashbookEntry(id: string): Promise<CashbookEntry | null> {
  const state = await loadAppState(['deed_bankAccounts'])
  const list = state['deed_bankAccounts']
  if (!Array.isArray(list)) return null
  return (list as CashbookEntry[]).find(a => a && a.id === id) ?? null
}

async function glLabel(db: Db, glAccountId: string): Promise<string> {
  const gl = await db.accountCode.findUnique({ where: { id: glAccountId } })
  if (!gl || !gl.isActive) throw new BankAccountRefError('Bank account is not mapped to an active GL account', 409)
  return `${gl.code} - ${gl.name}`
}

/**
 * The cash/bank GL label a payment through `bankAccountId` posts to.
 *
 * Three kinds of id reach here:
 * - a `bank_accounts` row id → that row's GL account;
 * - a built-in cashbook id ('im', 'ncba', 'mpesa', …) → the role map;
 * - the random id of an account added later on the Finance → Bank accounts
 *   screen (Tende, say). Those live only in the cashbook list, never in
 *   `bank_accounts`, and every payment through one used to be refused as
 *   "Invalid or inactive bank account". It now posts like any other
 *   cashbook account: through a `bank_accounts` row of the same name when
 *   one exists, else through the role map by the account's name.
 */
export async function cashLabelForBankAccount(db: Db, bankAccountId: string): Promise<string> {
  if (!isUuid(bankAccountId)) return labelForRole(cashAccountRoleForBankId(bankAccountId))

  const bank = await db.bankAccount.findUnique({ where: { id: bankAccountId } })
  if (bank) {
    if (!bank.isActive) throw new BankAccountRefError('Invalid or inactive bank account', 400)
    return glLabel(db, bank.glAccountId)
  }

  const entry = await cashbookEntry(bankAccountId)
  if (!entry || entry.active === false) throw new BankAccountRefError('Invalid or inactive bank account', 400)
  const name = String(entry.name ?? '').trim()

  if (name) {
    const sameName = await db.bankAccount.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
    if (sameName?.isActive) return glLabel(db, sameName.glAccountId)
  }
  return labelForRole(cashAccountRoleForBankId(`${name} ${String(entry.bankName ?? '')}`))
}
