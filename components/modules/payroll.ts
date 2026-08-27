/**
 * Kenya payroll statutory calculation.
 *
 * Rules are versioned so a later law/rate change never changes a historical
 * payslip. The default below is the rule set effective from 1 February 2026.
 * Persist the ruleVersion returned by this function on the payroll run.
 */
export type KenyaPayrollRules = {
  version: string
  effectiveFrom: string
  nssfEmployeeRate: number
  nssfEmployerRate: number
  nssfLowerEarningsLimit: number
  nssfUpperEarningsLimit: number
  shifRate: number
  shifMinimum: number
  housingLevyEmployeeRate: number
  housingLevyEmployerRate: number
  pensionDeductionMonthlyLimit: number
  personalRelief: number
  payeBands: Array<{ limit: number | null; rate: number }>
}

export const KENYA_PAYROLL_RULES_2026_02: KenyaPayrollRules = {
  version: 'KE-2026-02',
  effectiveFrom: '2026-02-01',
  nssfEmployeeRate: 0.06,
  nssfEmployerRate: 0.06,
  nssfLowerEarningsLimit: 9000,
  nssfUpperEarningsLimit: 108000,
  shifRate: 0.0275,
  shifMinimum: 300,
  housingLevyEmployeeRate: 0.015,
  housingLevyEmployerRate: 0.015,
  pensionDeductionMonthlyLimit: 30000,
  personalRelief: 2400,
  payeBands: [
    { limit: 24000, rate: 0.10 },
    { limit: 32333, rate: 0.25 },
    { limit: 500000, rate: 0.30 },
    { limit: 800000, rate: 0.325 },
    { limit: null, rate: 0.35 },
  ],
}

function money(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function progressiveTax(taxablePay: number, bands: KenyaPayrollRules['payeBands']) {
  let remaining = Math.max(0, taxablePay)
  let previousLimit = 0
  let tax = 0
  for (const band of bands) {
    const upper = band.limit
    const width = upper == null ? remaining : Math.max(0, upper - previousLimit)
    const taxableInBand = Math.min(remaining, width)
    tax += taxableInBand * band.rate
    remaining -= taxableInBand
    if (remaining <= 0) break
    if (upper != null) previousLimit = upper
  }
  return money(tax)
}

export function calculatePayroll(
  basicSalary: number,
  housingAllowance: number,
  transportAllowance: number,
  opts?: {
    pensionContribution?: number
    otherTaxDeductible?: number
    resident?: boolean
    rules?: KenyaPayrollRules
  },
) {
  const rules = opts?.rules ?? KENYA_PAYROLL_RULES_2026_02
  const grossSalary = money(
    Math.max(0, Number(basicSalary) || 0)
    + Math.max(0, Number(housingAllowance) || 0)
    + Math.max(0, Number(transportAllowance) || 0),
  )

  const nssfTier1Base = Math.min(grossSalary, rules.nssfLowerEarningsLimit)
  const nssfTier2Base = Math.max(
    0,
    Math.min(grossSalary, rules.nssfUpperEarningsLimit) - rules.nssfLowerEarningsLimit,
  )
  const nssfTier1 = money(nssfTier1Base * rules.nssfEmployeeRate)
  const nssfTier2 = money(nssfTier2Base * rules.nssfEmployeeRate)
  const nssf = money(nssfTier1 + nssfTier2)
  const employerNssf = money(
    nssfTier1Base * rules.nssfEmployerRate
    + nssfTier2Base * rules.nssfEmployerRate,
  )

  const housingLevy = money(grossSalary * rules.housingLevyEmployeeRate)
  const employerHousingLevy = money(grossSalary * rules.housingLevyEmployerRate)
  const shif = money(Math.max(rules.shifMinimum, grossSalary * rules.shifRate))
  const pensionContribution = money(Math.min(
    Math.max(0, Number(opts?.pensionContribution) || 0),
    rules.pensionDeductionMonthlyLimit,
  ))
  const otherTaxDeductible = money(Math.max(0, Number(opts?.otherTaxDeductible) || 0))

  // KRA employer guidance requires employee SHIF and AHL, plus qualifying
  // pension deductions, to be applied before PAYE. NSSF is also deductible.
  const taxablePay = money(Math.max(
    0,
    grossSalary - nssf - shif - housingLevy - pensionContribution - otherTaxDeductible,
  ))
  const grossPaye = progressiveTax(taxablePay, rules.payeBands)
  const personalRelief = opts?.resident === false ? 0 : rules.personalRelief
  const paye = money(Math.max(0, grossPaye - personalRelief))

  const totalDeductions = money(nssf + shif + housingLevy + pensionContribution + paye)
  const netSalary = money(grossSalary - totalDeductions)

  return {
    ruleVersion: rules.version,
    grossSalary,
    taxablePay,
    nssfTier1,
    nssfTier2,
    nssf,
    employerNssf,
    shif,
    housingLevy,
    employerHousingLevy,
    pensionContribution,
    personalRelief: money(personalRelief),
    paye,
    totalDeductions,
    netSalary,
  }
}
