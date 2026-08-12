/**
 * Mailbox-level advisory lock so concurrent cron polls do not double-process.
 * Uses session-scoped try/lock; fails open if Postgres lock infra is unavailable.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { SALES_INBOX_LOCK_KEY } from '@/lib/crm/inbox/lock-keys'

export { SALES_INBOX_LOCK_KEY, salesInboxMessageLockKey } from '@/lib/crm/inbox/lock-keys'

export type LockOutcome<T> =
  | { acquired: true; result: T }
  | { acquired: false }

export async function withSalesInboxAdvisoryLock<T>(
  fn: () => Promise<T>,
  opts?: { lockKey?: number; failOpen?: boolean },
): Promise<LockOutcome<T>> {
  const lockKey = opts?.lockKey ?? SALES_INBOX_LOCK_KEY
  const failOpen = opts?.failOpen !== false

  let acquired = false
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
      'SELECT pg_try_advisory_lock($1::bigint) AS ok',
      lockKey,
    )
    acquired = Boolean(rows?.[0]?.ok)
  } catch (err) {
    if (failOpen) {
      return { acquired: true, result: await fn() }
    }
    throw err
  }

  if (!acquired) return { acquired: false }

  try {
    return { acquired: true, result: await fn() }
  } finally {
    try {
      await prisma.$queryRawUnsafe(
        'SELECT pg_advisory_unlock($1::bigint)',
        lockKey,
      )
    } catch {
      /* unlock best-effort */
    }
  }
}
