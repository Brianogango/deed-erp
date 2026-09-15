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

export function invoiceErrorMessage(data: unknown, fallback: string): string {
  const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined
  return typeof error === 'string' && error.trim() ? error : fallback
}

export function createdInvoiceId(data: unknown, fallbackId: string): string {
  if (!data || typeof data !== 'object') return fallbackId
  const id = (data as { id?: unknown }).id
  return typeof id === 'string' && id.trim() ? id : fallbackId
}

/**
 * Confirm Vendor Bill PUTs a blob draft that often never reached Prisma
 * (createBillFromPO used to fire-and-forget POST). Creating as draft then
 * posting uses the server id — a new UUID must not 404 on the blob id again.
 */
export async function putInvoiceOrCreateThenPost(
  id: string,
  postedInvoice: Record<string, unknown>,
): Promise<{ res: Response; data: unknown; id: string }> {
  let { res, data } = await putInvoiceWithLockRetry(id, postedInvoice)
  let effectiveId = id
  if (res.status !== 404) return { res, data, id: effectiveId }

  const create = await fetch('/api/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...invoicePersistBody(postedInvoice), status: 'draft' }),
  })
  const created = await create.json().catch(() => null)
  if (!create.ok) return { res: create, data: created, id }

  effectiveId = createdInvoiceId(created, id)
  ;({ res, data } = await putInvoiceWithLockRetry(effectiveId, { ...postedInvoice, id: effectiveId }))
  return { res, data, id: effectiveId }
}
