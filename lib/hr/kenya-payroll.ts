/**
 * Versioned Kenya payroll rules. Historical payroll must retain the ruleVersion
 * and calculated components; never recompute a posted payslip with a newer rule.
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

export const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

function progressiveTax(taxablePay: number, bands: KenyaPayrollRules['payeBands']) {
  let remaining = Math.max(0, taxablePay)
  let previousLimit = 0
  let tax = 0
  for (const band of bands) {
    const width = band.limit == null ? remaining : Math.max(0, band.limit - previousLimit)
    const taxableInBand = Math.min(remaining, width)
    tax += taxableInBand * band.rate
    remaining -= taxableInBand
    if (remaining <= 0) break
    if (band.limit != null) previousLimit = band.limit
  }
  return money(tax)
}

export function calculateKenyaPayroll(
  basicSalary: number,
  housingAllowance: number,
  transportAllowance: number,
  opts?: {
    commission?: number
    overtimePay?: number
    otherAdditions?: number
    pensionContribution?: number
    otherTaxDeductible?: number
    resident?: boolean
    otherDeductions?: number
    loanDeductions?: number
    advanceDeductions?: number
    rules?: KenyaPayrollRules
  },
) {
  const rules = opts?.rules ?? KENYA_PAYROLL_RULES_2026_02
  const basic = money(Math.max(0, Number(basicSalary) || 0))
  const housing = money(Math.max(0, Number(housingAllowance) || 0))
  const transport = money(Math.max(0, Number(transportAllowance) || 0))
  const commission = money(Math.max(0, Number(opts?.commission) || 0))
  const overtime = money(Math.max(0, Number(opts?.overtimePay) || 0))
  const additions = money(Math.max(0, Number(opts?.otherAdditions) || 0))
  const grossSalary = money(basic + housing + transport + commission + overtime + additions)

  const tier1Base = Math.min(grossSalary, rules.nssfLowerEarningsLimit)
  const tier2Base = Math.max(0, Math.min(grossSalary, rules.nssfUpperEarningsLimit) - rules.nssfLowerEarningsLimit)
  const nssfTier1 = money(tier1Base * rules.nssfEmployeeRate)
  const nssfTier2 = money(tier2Base * rules.nssfEmployeeRate)
  const nssf = money(nssfTier1 + nssfTier2)
  const employerNssf = money(tier1Base * rules.nssfEmployerRate + tier2Base * rules.nssfEmployerRate)

  const housingLevy = money(grossSalary * rules.housingLevyEmployeeRate)
  const employerHousingLevy = money(grossSalary * rules.housingLevyEmployerRate)
  const shif = grossSalary <= 0 ? 0 : money(Math.max(rules.shifMinimum, grossSalary * rules.shifRate))
  const pensionContribution = money(Math.min(
    Math.max(0, Number(opts?.pensionContribution) || 0),
    rules.pensionDeductionMonthlyLimit,
  ))
  const otherTaxDeductible = money(Math.max(0, Number(opts?.otherTaxDeductible) || 0))
  const taxablePay = money(Math.max(0, grossSalary - nssf - shif - housingLevy - pensionContribution - otherTaxDeductible))
  const grossPaye = progressiveTax(taxablePay, rules.payeBands)
  const personalRelief = opts?.resident === false ? 0 : rules.personalRelief
  const paye = money(Math.max(0, grossPaye - personalRelief))

  const otherDeductions = money(Math.max(0, Number(opts?.otherDeductions) || 0))
  const loanDeductions = money(Math.max(0, Number(opts?.loanDeductions) || 0))
  const advanceDeductions = money(Math.max(0, Number(opts?.advanceDeductions) || 0))
  const totalDeductions = money(
    nssf + shif + housingLevy + pensionContribution + paye
    + otherDeductions + loanDeductions + advanceDeductions,
  )
  const netSalary = money(grossSalary - totalDeductions)

  return {
    ruleVersion: rules.version,
    basicSalary: basic,
    houseAllowance: housing,
    transportAllowance: transport,
    commission,
    overtimePay: overtime,
    otherAdditions: additions,
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
    otherDeductions,
    loanDeductions,
    advanceDeductions,
    totalDeductions,
    netSalary,
  }
}
