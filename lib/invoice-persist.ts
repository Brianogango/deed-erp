/**
 * Draft invoice edits PUT the full client row, then Confirm immediately PUTs
 * again. The first write increments Prisma `lockVersion`; the client never
 * reads that new version back (updateInvoice fire-and-forgets). Confirm then
 * 409s with "Record was modified by another user".
 *
 * Same omit pattern as sale-order persist / Confirm: drop the stale lock so
 * sequential same-tab writes claim the live row. A single retry absorbs the
 * updateMany race whose 409 may or may not include `lockVersion`.
 */
import { readLockVersionFromResponse } from '@/lib/optimistic-lock'

export function invoicePersistBody<T extends Record<string, unknown>>(
  invoice: T,
): Omit<T, 'lockVersion' | 'expectedVersion'> {
  const {
    lockVersion: _lockVersion,
    expectedVersion: _expectedVersion,
    ...body
  } = invoice
  return body
}

export function isInvoiceLockConflict(status: number, body: unknown): boolean {
  if (status !== 409) return false
  const error = String((body as { error?: string } | null)?.error || '')
  return /modified by another user/i.test(error)
}

export async function putInvoiceWithLockRetry(
  id: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; data: unknown }> {
  const send = async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null)
    return { res, data }
  }

  const unlocked = invoicePersistBody(body)
  let { res, data } = await send(unlocked)
  if (isInvoiceLockConflict(res.status, data)) {
    const conflictLock = readLockVersionFromResponse(data)
    const retryPayload = conflictLock !== undefined
      ? { ...unlocked, lockVersion: conflictLock }
      : unlocked
    ;({ res, data } = await send(retryPayload))
  }
  return { res, data }
}
