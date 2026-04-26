// Kenya Payroll Tax Calculations (2024/2025)

export interface PayrollBreakdown {
  grossSalary: number
  nssf: number           // Employee NSSF contribution
  taxablePay: number     // Gross - NSSF
  paye: number           // After personal relief
  shif: number           // Social Health Insurance Fund (2.75% of gross)
  totalDeductions: number
  netSalary: number
}

// NSSF: Tier I (6% up to 7,000) + Tier II (6% of 7,001–36,000)
export function calcNSSF(gross: number): number {
  if (gross <= 0) return 0
  const tierI = Math.min(gross, 7000) * 0.06
  const tierII = gross > 7000 ? (Math.min(gross, 36000) - 7000) * 0.06 : 0
  return Math.round(tierI + tierII)
}

// SHIF (Social Health Insurance Fund): 2.75% of gross, minimum 300
export function calcSHIF(gross: number): number {
  if (gross <= 0) return 0
  return Math.max(300, Math.round(gross * 0.0275))
}

// PAYE — KRA monthly tax bands (2024/2025)
// Bands: 0–24,000 @ 10%, 24,001–32,333 @ 25%, 32,334+ @ 30%, 500,001+ @ 35%
// Personal Relief: KES 2,400/month
export function calcPAYE(taxablePay: number): number {
  if (taxablePay <= 0) return 0

  let tax = 0
  if (taxablePay > 500000) {
    tax += (taxablePay - 500000) * 0.35
    taxablePay = 500000
  }
  if (taxablePay > 32333) {
    tax += (taxablePay - 32333) * 0.30
    taxablePay = 32333
  }
  if (taxablePay > 24000) {
    tax += (taxablePay - 24000) * 0.25
    taxablePay = 24000
  }
  tax += taxablePay * 0.10

  const personalRelief = 2400
  return Math.max(0, Math.round(tax - personalRelief))
}

export function calculatePayroll(basic: number, housing: number, transport: number): PayrollBreakdown {
  const grossSalary = basic + housing + transport
  const nssf = calcNSSF(grossSalary)
  const taxablePay = Math.max(0, grossSalary - nssf)
  const paye = calcPAYE(taxablePay)
  const shif = calcSHIF(grossSalary)
  const totalDeductions = nssf + paye + shif
  const netSalary = Math.max(0, grossSalary - totalDeductions)

  return { grossSalary, nssf, taxablePay, paye, shif, totalDeductions, netSalary }
}
