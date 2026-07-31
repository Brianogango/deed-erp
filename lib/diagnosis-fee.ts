/**
 * Diagnosis First mandatory diagnosis fee.
 * Labor / parts are always separate — never credited against this fee.
 * VAT on diagnosis fee is always 0% (policy).
 * Stored amounts live on the repair blob (`deed_repairs_v2`).
 */

export type DeviceTier = 'regular' | 'high_end'

export type DiagnosisFeeStatus =
  | 'pending'
  | 'applicable'
  | 'waived'
  | 'invoiced'
  | 'not_applicable'

export const DIAGNOSIS_FEE_LINE_DESCRIPTION = 'Diagnosis Fee'
export const DEFAULT_DIAGNOSIS_FEE_REGULAR_KES = 1500
export const DEFAULT_DIAGNOSIS_FEE_HIGH_END_KES = 2500

export type DiagnosisFeeSettings = {
  diagnosisFeeRegularKes?: number
  diagnosisFeeHighEndKes?: number
}

export type DiagnosisFeeRepair = {
  repairPath?: string | null
  deviceTier?: DeviceTier | string | null
  diagnosisFee?: number | null
  diagnosisFeeStatus?: DiagnosisFeeStatus | string | null
  underWarranty?: boolean
  warrantyCoverage?: 'full' | 'partial' | 'void' | string | null
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

export function diagnosisFeeAmountForTier(
  tier: unknown,
  settings?: DiagnosisFeeSettings | null,
): number {
  const regular = Math.max(0, Number(settings?.diagnosisFeeRegularKes ?? DEFAULT_DIAGNOSIS_FEE_REGULAR_KES) || 0)
  const highEnd = Math.max(0, Number(settings?.diagnosisFeeHighEndKes ?? DEFAULT_DIAGNOSIS_FEE_HIGH_END_KES) || 0)
  return normalizeDeviceTier(tier) === 'high_end' ? highEnd : regular
}

/** Full warranty → no diagnosis fee. Direct Repair → not applicable. */
export function shouldChargeDiagnosisFee(repair: DiagnosisFeeRepair): boolean {
  if (repair.repairPath === 'direct_repair') return false
  if (repair.diagnosisFeeStatus === 'waived' || repair.diagnosisFeeStatus === 'not_applicable') return false
  if (repair.underWarranty && repair.warrantyCoverage === 'full') return false
  // Default: diagnosis_first (including missing path treated as diagnosis_first elsewhere)
  return repair.repairPath !== 'direct_repair'
}

export function resolveDiagnosisFee(
  repair: DiagnosisFeeRepair,
  settings?: DiagnosisFeeSettings | null,
): { amount: number; status: DiagnosisFeeStatus; tier: DeviceTier | null } {
  if (repair.repairPath === 'direct_repair') {
    return { amount: 0, status: 'not_applicable', tier: normalizeDeviceTier(repair.deviceTier) }
  }
  if (repair.diagnosisFeeStatus === 'waived') {
    return {
      amount: 0,
      status: 'waived',
      tier: normalizeDeviceTier(repair.deviceTier),
    }
  }
  if (repair.underWarranty && repair.warrantyCoverage === 'full') {
    return {
      amount: 0,
      status: 'not_applicable',
      tier: normalizeDeviceTier(repair.deviceTier),
    }
  }
  const tier = normalizeDeviceTier(repair.deviceTier) ?? 'regular'
  const amount = diagnosisFeeAmountForTier(tier, settings)
  return { amount, status: amount > 0 ? 'applicable' : 'not_applicable', tier }
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
 * when the fee applies. Labor/parts are left untouched.
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
