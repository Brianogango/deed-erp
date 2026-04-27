/**
 * Calculates Kenyan Payroll based on official KRA 2024 brackets.
 * Includes NSSF (New Act), SHIF (2.75%), Affordable Housing Levy (1.5%), and PAYE.
 */
export function calculatePayroll(basicSalary: number, housingAllowance: number, transportAllowance: number) {
  const grossSalary = basicSalary + housingAllowance + transportAllowance;

  // 1. NSSF Calculation (2024 Limits)
  // Tier 1: 6% of pensionable pay up to 8,000
  // Tier 2: 6% of pensionable pay between 8,000 and 36,000
  const tier1 = Math.min(grossSalary, 8000) * 0.06;
  const tier2 = Math.max(0, Math.min(grossSalary - 8000, 28000)) * 0.06;
  const nssf = Math.round(tier1 + tier2);

  // 2. Affordable Housing Levy (1.5% of Gross)
  const housingLevy = Math.round(grossSalary * 0.015);

  // 3. SHIF - Social Health Insurance Fund (2.75% of Gross)
  const shif = Math.round(grossSalary * 0.0275);

  // 4. PAYE Calculation
  // Taxable pay reduces by NSSF
  const taxablePay = grossSalary - nssf;
  
  let paye = 0;
  if (taxablePay <= 24000) {
    paye = taxablePay * 0.1;
  } else if (taxablePay <= 32333) {
    paye = (24000 * 0.1) + ((taxablePay - 24000) * 0.25);
  } else if (taxablePay <= 500000) {
    paye = (24000 * 0.1) + (8333 * 0.25) + ((taxablePay - 32333) * 0.3);
  } else if (taxablePay <= 800000) {
    paye = (24000 * 0.1) + (8333 * 0.25) + (467667 * 0.3) + ((taxablePay - 500000) * 0.325);
  } else {
    paye = (24000 * 0.1) + (8333 * 0.25) + (467667 * 0.3) + (300000 * 0.325) + ((taxablePay - 800000) * 0.35);
  }

  // Less Personal Relief
  const personalRelief = 2400;
  const finalPaye = Math.max(0, Math.round(paye - personalRelief));

  const totalDeductions = nssf + shif + housingLevy + finalPaye;
  const netSalary = grossSalary - totalDeductions;

  return {
    grossSalary,
    taxablePay,
    nssf,
    shif,
    housingLevy,
    paye: finalPaye,
    netSalary,
  };
}