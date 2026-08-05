import 'server-only'

import { getFiscalLockDate } from '@/lib/accounting/journal-service'
import {
  fiscalLockConflictMessage,
  isDocumentDateFiscalLocked,
} from '@/lib/finance-controls'

/**
 * Server-side fiscal lock gate (audit FIN-004 / AGENT-BE-002).
 * Returns 409 payload when `date` falls on or before the active lock date.
 */
export async function checkFiscalLock(
  date: Date | string | null | undefined,
): Promise<{ ok: true } | { ok: false; status: 409; error: string }> {
  if (date == null || date === '') return { ok: true }
  const lockDate = await getFiscalLockDate()
  if (!lockDate || !isDocumentDateFiscalLocked(date, lockDate)) {
    return { ok: true }
  }
  return {
    ok: false,
    status: 409,
    error: fiscalLockConflictMessage(lockDate),
  }
}
