import { isUuid } from '@/lib/legacy-compat'

/**
 * `bank_account_id` columns are UUID foreign keys to `bank_accounts`, but the
 * cashbook screens still identify accounts by their legacy blob ids ('im',
 * 'ncba', 'mpesa', …). Writing one of those straight into Prisma made the
 * whole payment transaction fail with
 *   `invalid input syntax for type uuid: "im"`
 * so the receipt, its allocations, the GL journal and the audit row were all
 * rolled back while the browser had already shown the payment.
 *
 * The legacy id still decides the cash/bank GL account (see
 * cashAccountRoleForBankId) and is kept in the payment notes; only the
 * foreign key is dropped when it does not point at a real bank_accounts row.
 */
export function bankAccountFk(value: unknown): string | null {
  return isUuid(value) ? value : null
}

/**
 * The legacy cashbook id ('absa', 'ncba', 'im', or a later account's random id)
 * the payment was booked against. `bank_account_id` drops it (see above), but
 * the payment route also writes it into the payment notes as "Account: <id>",
 * so the screens can still show the account that was actually paid from.
 */
export function legacyBankIdFromNotes(notes: unknown): string | null {
  const match = /(?:^|·)\s*Account:\s*([^\s·]+)/.exec(String(notes ?? ''))
  return match ? match[1] : null
}
