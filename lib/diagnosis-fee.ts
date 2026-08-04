/**
 * Diagnosis First mandatory diagnosis fee.
 *
 * Policy (Service Charges & Pricing — Aug 2026, revised):
 * - Flat KES 1,000 for walk-in & corporate Diagnosis First jobs
 * - Effective from 3 Aug 2026, 3:00pm EAT — jobs received before then are exempt
 * - Not credited against the repair bill (labour/parts stay separate)
 * - Fee is billed on the final invoice with the repair (walk-in & corporate)
 * - Optional early collection allowed; does not block diagnosis or repair start
 * - Warranty (full): exempt
 * - Company mistake / goodwill (billingExempt): exempt
 * - Client declines diagnosis (Direct Repair / instructed scope): no fee
 * - VAT on diagnosis fee is always 0%
 *
 * Stored amounts live on the repair blob (`deed_repairs_v2`).
 */

export type DeviceTier = 'regular' | 'high_end'

export type DiagnosisFeeStatus =
  | 'pending'
  | 'applicable'
  | 'paid'
  | 'waived'
  | 'invoiced'
  | 'not_applicable'

/** When the fee is collected relative to the job. */
export type DiagnosisFeeBilling = 'upfront' | 'invoice'

export type CustomerBillingType = 'walk_in' | 'corporate'

export const DIAGNOSIS_FEE_LINE_DESCRIPTION = 'Diagnosis Fee'
/** Policy default — flat fee for all Diagnosis First jobs. */
export const DEFAULT_DIAGNOSIS_FEE_KES = 1000
/** @deprecated Prefer DEFAULT_DIAGNOSIS_FEE_KES — kept for older settings blobs. */
export const DEFAULT_DIAGNOSIS_FEE_REGULAR_KES = DEFAULT_DIAGNOSIS_FEE_KES
/** @deprecated Prefer DEFAULT_DIAGNOSIS_FEE_KES — kept for older settings blobs. */
export const DEFAULT_DIAGNOSIS_FEE_HIGH_END_KES = DEFAULT_DIAGNOSIS_FEE_KES

/**
 * Mandatory flat diagnosis fee starts at this instant (Africa/Nairobi).
 * Repairs with intakeDate before this are not charged the new fee.
 */
export const DIAGNOSIS_FEE_POLICY_EFFECTIVE_AT = '2026-08-03T15:00:00+03:00'

export type DiagnosisFeeSettings = {
  /** Flat Diagnosis First fee (KES). Preferred. */
  diagnosisFeeKes?: number
  /** @deprecated Legacy tier amount — used only if diagnosisFeeKes is unset. */
  diagnosisFeeRegularKes?: number
  /** @deprecated Legacy tier amount — ignored for flat policy amount. */
  diagnosisFeeHighEndKes?: number
}

export type DiagnosisFeeRepair = {
  repairPath?: string | null
  /** Job received timestamp — used for the Aug 2026 policy cutoff. */
  intakeDate?: string | null
  deviceTier?: DeviceTier | string | null
  diagnosisFee?: number | null
  diagnosisFeeStatus?: DiagnosisFeeStatus | string | null
  diagnosisFeeBilling?: DiagnosisFeeBilling | string | null
  diagnosisFeePaidAt?: string | null
  customerBillingType?: CustomerBillingType | string | null
  underWarranty?: boolean
  warrantyCoverage?: 'full' | 'partial' | 'void' | string | null
  /** Company mistake / goodwill — no customer fee or invoice. */
  billingExempt?: boolean | null
}

export function isDiagnosisFeeLine(line: {
  isDiagnosisFee?: boolean
  description?: string
  type?: string
}): boolean {
  if (line.isDiagnosisFee) return true
  const desc = String(line.description ?? '').trim().toLowerCase()
  return desc === DIAGNOSIS_FEE_LINE_DESCRIPTION.toLowerCase()
    || desc.startsWith('diagnosis fee')
}

export function normalizeDeviceTier(value: unknown): DeviceTier | null {
  if (value === 'regular' || value === 'high_end') return value
  return null
}

export function deviceTierLabel(tier: unknown): string {
  return normalizeDeviceTier(tier) === 'high_end' ? 'High-end' : 'Regular'
}

/** Flat diagnosis fee from settings (policy: KES 1,000). */
export function diagnosisFeeAmount(settings?: DiagnosisFeeSettings | null): number {
  const flat = Number(settings?.diagnosisFeeKes)
  // Prefer an explicit flat fee whenever it is a finite number (including 0),
  // but never keep the old shipped tier defaults (1,500 / 2,500).
  if (Number.isFinite(flat) && flat >= 0) {
    if (flat === 1500 || flat === 2500) return DEFAULT_DIAGNOSIS_FEE_KES
    return flat
  }

  // Legacy tier fields: ignore the old shipped defaults (1,500 / 2,500) so
  // environments that never wrote diagnosisFeeKes do not keep charging 1,500.
  const legacy = Number(settings?.diagnosisFeeRegularKes)
  if (Number.isFinite(legacy) && legacy >= 0 && legacy !== 1500 && legacy !== 2500) {
    return legacy
  }
  return DEFAULT_DIAGNOSIS_FEE_KES
}

/**
 * True when stored settings still reflect the pre–Aug 2026 tier amounts and
 * should be rewritten to the flat KES 1,000 policy.
 */
export function needsDiagnosisFeeSettingsMigration(settings?: DiagnosisFeeSettings | null): boolean {
  if (!settings) return false
  const flat = Number(settings.diagnosisFeeKes)
  const regular = Number(settings.diagnosisFeeRegularKes)
  const highEnd = Number(settings.diagnosisFeeHighEndKes)
  const hasLegacyDefault = regular === 1500 || regular === 2500 || highEnd === 1500 || highEnd === 2500
  if (!Number.isFinite(flat)) return hasLegacyDefault || !Number.isFinite(regular)
  if (flat === 1500 || flat === 2500) return true
  // Flat already correct, but sibling legacy fields still need cleanup.
  if (hasLegacyDefault && flat === DEFAULT_DIAGNOSIS_FEE_KES) return true
  return false
}

export function migratedDiagnosisFeeSettings(
  settings?: DiagnosisFeeSettings | null,
): Required<Pick<DiagnosisFeeSettings, 'diagnosisFeeKes' | 'diagnosisFeeRegularKes' | 'diagnosisFeeHighEndKes'>> {
  const flat = Number(settings?.diagnosisFeeKes)
  const amount = (
    Number.isFinite(flat) && flat >= 0 && flat !== 1500 && flat !== 2500
  ) ? flat : DEFAULT_DIAGNOSIS_FEE_KES
  return {
    diagnosisFeeKes: amount,
    diagnosisFeeRegularKes: amount,
    diagnosisFeeHighEndKes: amount,
  }
}

/**
 * @deprecated Flat fee policy — tier no longer changes the amount.
 * Kept so call sites compile; always returns diagnosisFeeAmount(settings).
 */
export function diagnosisFeeAmountForTier(
  _tier: unknown,
  settings?: DiagnosisFeeSettings | null,
): number {
  return diagnosisFeeAmount(settings)
}

/**
 * True when the job was received on/after the policy effective instant
 * (3 Aug 2026, 3:00pm EAT). Missing intake dates are treated as pre-policy
 * so legacy jobs are not charged.
 *
 * Date-only values (`YYYY-MM-DD`) are interpreted as start-of-day UTC. That
 * means the effective calendar day (3 Aug) stays pre-policy for jobs that
 * never stored a time — matching noon bookings that must not be charged —
 * while full ISO timestamps honor the 3:00pm EAT cutoff.
 */
export function isDiagnosisFeePolicyInEffect(intakeDate?: string | null): boolean {
  const effectiveMs = Date.parse(DIAGNOSIS_FEE_POLICY_EFFECTIVE_AT)
  if (!Number.isFinite(effectiveMs)) return false
  const raw = String(intakeDate ?? '').trim()
  if (!raw) return false
  const intakeMs = Date.parse(raw)
  if (!Number.isFinite(intakeMs)) return false
  return intakeMs >= effectiveMs
}

/**
 * Normalize an unpaid open job that still carries the old tier amount (1,500 /
 * 2,500) so the UI and invoices show the flat KES 1,000 policy fee.
 */
export function normalizeStoredDiagnosisFee(
  repair: DiagnosisFeeRepair,
  settings?: DiagnosisFeeSettings | null,
): number {
  const resolved = resolveDiagnosisFee(repair, settings)
  if (resolved.status === 'paid' || resolved.status === 'invoiced' || resolved.status === 'waived') {
    return Math.max(0, Number(repair.diagnosisFee) || resolved.amount)
  }
  return resolved.amount
}

/** Fee is billed on the final invoice for both walk-in and corporate. */
export function resolveDiagnosisFeeBilling(
  _clientType?: 'individual' | 'company' | string | null,
): DiagnosisFeeBilling {
  return 'invoice'
}

export function resolveCustomerBillingType(
  clientType: 'individual' | 'company' | string | null | undefined,
): CustomerBillingType {
  return clientType === 'company' ? 'corporate' : 'walk_in'
}

/**
 * Full warranty → no fee. Direct Repair (declined diagnosis) → not applicable.
 * Pre-policy intake (before 3 Aug 2026 3pm EAT) → not charged.
 */
export function shouldChargeDiagnosisFee(repair: DiagnosisFeeRepair): boolean {
  if (repair.repairPath === 'direct_repair') return false
  if (repair.billingExempt) return false
  if (repair.diagnosisFeeStatus === 'waived' || repair.diagnosisFeeStatus === 'not_applicable') return false
  if (repair.underWarranty && repair.warrantyCoverage === 'full') return false
  if (!isDiagnosisFeePolicyInEffect(repair.intakeDate)) return false
  // Default: diagnosis_first (including missing path treated as diagnosis_first elsewhere)
  return repair.repairPath !== 'direct_repair'
}

/** Fee already collected early or posted on an invoice. */
export function isDiagnosisFeeSettled(repair: DiagnosisFeeRepair): boolean {
  const status = String(repair.diagnosisFeeStatus ?? '')
  if (status === 'paid' || status === 'invoiced' || status === 'waived' || status === 'not_applicable') return true
  if (repair.diagnosisFeePaidAt) return true
  return false
}

/**
 * Upfront collection is optional — never blocks diagnosis or repair start.
 * Kept for call-site compatibility; always returns false.
 */
export function mustCollectDiagnosisFeeUpfront(_repair: DiagnosisFeeRepair): boolean {
  return false
}

function billingMeta(repair: DiagnosisFeeRepair): {
  billing: DiagnosisFeeBilling
  customerType: CustomerBillingType
} {
  const customerType: CustomerBillingType =
    repair.customerBillingType === 'corporate' || repair.customerBillingType === 'walk_in'
      ? repair.customerBillingType
      : 'walk_in'
  const billing: DiagnosisFeeBilling =
    repair.diagnosisFeeBilling === 'upfront' || repair.diagnosisFeeBilling === 'invoice'
      ? repair.diagnosisFeeBilling
      : 'invoice'
  return { billing, customerType }
}

export function resolveDiagnosisFee(
  repair: DiagnosisFeeRepair,
  settings?: DiagnosisFeeSettings | null,
): {
  amount: number
  status: DiagnosisFeeStatus
  tier: DeviceTier | null
  billing: DiagnosisFeeBilling
  customerType: CustomerBillingType
} {
  const meta = billingMeta(repair)
  if (repair.repairPath === 'direct_repair') {
    return { amount: 0, status: 'not_applicable', tier: normalizeDeviceTier(repair.deviceTier), ...meta }
  }
  if (repair.billingExempt) {
    return {
      amount: 0,
      status: 'not_applicable',
      tier: normalizeDeviceTier(repair.deviceTier),
      ...meta,
    }
  }
  if (repair.diagnosisFeeStatus === 'waived') {
    return {
      amount: 0,
      status: 'waived',
      tier: normalizeDeviceTier(repair.deviceTier),
      ...meta,
    }
  }
  if (repair.underWarranty && repair.warrantyCoverage === 'full') {
    return {
      amount: 0,
      status: 'not_applicable',
      tier: normalizeDeviceTier(repair.deviceTier),
      ...meta,
    }
  }
  // Preserve settlements already recorded, even on pre-policy jobs.
  if (repair.diagnosisFeeStatus === 'paid' || repair.diagnosisFeePaidAt) {
    const amount = Math.max(0, Number(repair.diagnosisFee) || diagnosisFeeAmount(settings))
    return {
      amount,
      status: 'paid',
      tier: normalizeDeviceTier(repair.deviceTier),
      ...meta,
    }
  }
  if (repair.diagnosisFeeStatus === 'invoiced') {
    const amount = Math.max(0, Number(repair.diagnosisFee) || diagnosisFeeAmount(settings))
    return {
      amount,
      status: 'invoiced',
      tier: normalizeDeviceTier(repair.deviceTier),
      ...meta,
    }
  }
  if (!isDiagnosisFeePolicyInEffect(repair.intakeDate)) {
    return {
      amount: 0,
      status: 'not_applicable',
      tier: normalizeDeviceTier(repair.deviceTier),
      ...meta,
    }
  }
  const amount = diagnosisFeeAmount(settings)
  return {
    amount,
    status: amount > 0 ? 'applicable' : 'not_applicable',
    tier: normalizeDeviceTier(repair.deviceTier),
    ...meta,
  }
}

export function buildDiagnosisFeeQuoteLine(amount: number): {
  type: 'service'
  description: string
  qty: number
  unitPrice: number
  subtotal: number
  isDiagnosisFee: true
} {
  const unitPrice = Math.max(0, Number(amount) || 0)
  return {
    type: 'service',
    description: DIAGNOSIS_FEE_LINE_DESCRIPTION,
    qty: 1,
    unitPrice,
    subtotal: unitPrice,
    isDiagnosisFee: true,
  }
}

/**
 * Ensure incoming quote lines include exactly one locked diagnosis fee line
 * when the fee applies. Labor/parts are left untouched — never credited against the fee.
 */
export function ensureDiagnosisFeeInQuoteLines<T extends {
  type: string
  description: string
  qty: number
  unitPrice: number
  subtotal: number
  isDiagnosisFee?: boolean
}>(
  lines: T[],
  amount: number,
  charge: boolean,
): T[] {
  const withoutFee = lines.filter(l => !isDiagnosisFeeLine(l))
  if (!charge || amount <= 0) return withoutFee
  const feeLine = {
    ...buildDiagnosisFeeQuoteLine(amount),
  } as unknown as T
  return [feeLine, ...withoutFee]
}

/** Taxable base excludes diagnosis fee (0% VAT policy). */
export function taxableQuoteSubtotal(lines: { subtotal: number; isDiagnosisFee?: boolean; description?: string; type?: string }[]): number {
  return lines
    .filter(l => !isDiagnosisFeeLine(l))
    .reduce((sum, l) => sum + (Number(l.subtotal) || 0), 0)
}
