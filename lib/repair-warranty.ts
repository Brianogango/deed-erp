export interface RepairWarrantyRecord {
  id: string
  ref: string
  serialNumber: string
  startDate?: string
  endDate?: string
  status?: 'active' | 'expiring' | 'expired' | string
}

export interface RepairWarrantyDecision {
  normalizedSerial: string
  warranty?: RepairWarrantyRecord
  covered: boolean
  verificationStatus: 'not_checked' | 'verified' | 'pending_manual_review' | 'excluded_client_damage'
  reason: 'serial_missing' | 'serial_too_short' | 'not_found' | 'not_started' | 'expired' | 'inactive' | 'covered' | 'manual_review' | 'client_damage'
}

export const CLOSED_REPAIR_STATUSES = new Set([
  'delivered', 'closed', 'cancelled', 'returned', 'collected',
  'unrepairable', 'retained',
])

/**
 * Canonical comparison key only. Preserve the entered serial for display.
 * Formatting separators, whitespace and letter case must not change identity.
 */
export function normalizeRepairSerial(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function dateStart(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parsed = Date.parse(text.length === 10 ? `${text}T00:00:00.000Z` : text)
  return Number.isFinite(parsed) ? parsed : null
}

function dateEnd(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parsed = Date.parse(text.length === 10 ? `${text}T23:59:59.999Z` : text)
  return Number.isFinite(parsed) ? parsed : null
}

export function resolveRepairWarranty(
  warranties: readonly RepairWarrantyRecord[],
  serial: unknown,
  options: {
    now?: Date
    serialException?: boolean
    clientCausedDamage?: boolean
  } = {},
): RepairWarrantyDecision {
  const normalizedSerial = normalizeRepairSerial(serial)
  if (options.serialException) {
    return { normalizedSerial, covered: false, verificationStatus: 'pending_manual_review', reason: 'manual_review' }
  }
  if (options.clientCausedDamage) {
    return { normalizedSerial, covered: false, verificationStatus: 'excluded_client_damage', reason: 'client_damage' }
  }
  if (!normalizedSerial) {
    return { normalizedSerial, covered: false, verificationStatus: 'pending_manual_review', reason: 'serial_missing' }
  }
  if (normalizedSerial.length < 4) {
    return { normalizedSerial, covered: false, verificationStatus: 'not_checked', reason: 'serial_too_short' }
  }

  const matches = warranties.filter(w => normalizeRepairSerial(w.serialNumber) === normalizedSerial)
  if (matches.length === 0) {
    return { normalizedSerial, covered: false, verificationStatus: 'not_checked', reason: 'not_found' }
  }

  const now = (options.now ?? new Date()).getTime()
  const eligible = matches
    .filter(w => w.status === 'active' || w.status === 'expiring')
    .filter(w => {
      const start = dateStart(w.startDate)
      const end = dateEnd(w.endDate)
      return (start == null || start <= now) && end != null && end >= now
    })
    .sort((a, b) => (dateEnd(b.endDate) ?? 0) - (dateEnd(a.endDate) ?? 0))

  if (eligible[0]) {
    return {
      normalizedSerial,
      warranty: eligible[0],
      covered: true,
      verificationStatus: 'verified',
      reason: 'covered',
    }
  }

  const future = matches.some(w => {
    const start = dateStart(w.startDate)
    return start != null && start > now
  })
  if (future) return { normalizedSerial, covered: false, verificationStatus: 'not_checked', reason: 'not_started' }

  const expired = matches.some(w => {
    const end = dateEnd(w.endDate)
    return w.status === 'expired' || (end != null && end < now)
  })
  return {
    normalizedSerial,
    covered: false,
    verificationStatus: 'not_checked',
    reason: expired ? 'expired' : 'inactive',
  }
}

export function warrantyPatchFromDecision(decision: RepairWarrantyDecision) {
  return decision.covered && decision.warranty
    ? {
        underWarranty: true,
        warrantyId: decision.warranty.id,
        warrantyCoverage: 'full' as const,
        warrantyVerificationStatus: 'verified' as const,
      }
    : {
        underWarranty: false,
        warrantyId: undefined,
        warrantyCoverage: undefined,
        warrantyVerificationStatus: decision.verificationStatus,
      }
}

export function findOpenRepairWithSerial<T extends { id?: string; serialNumber?: string; status?: string }>(
  repairs: readonly T[],
  serial: unknown,
  excludeId?: string,
): T | undefined {
  const key = normalizeRepairSerial(serial)
  if (key.length < 4) return undefined
  return repairs.find(repair =>
    repair.id !== excludeId &&
    normalizeRepairSerial(repair.serialNumber) === key &&
    !CLOSED_REPAIR_STATUSES.has(String(repair.status ?? '').toLowerCase())
  )
}
