/** Shapes returned by the payroll report endpoints; safe to import from client code. */

export interface StatutoryRow {
  employeeId: string
  employeeNo: string
  employeeName: string
  firstName: string
  lastName: string
  idNumber: string
  kraPin: string
  nssfNumber: string
  /** The employee `shift` field holds the SHA / SHIF member number in this ERP. */
  shaNumber: string
  paymentMode: string
  bankName: string
  bankAccount: string
  mpesaNumber: string
  basic: number
  housingAllowance: number
  transportAllowance: number
  commission: number
  overtimePay: number
  otherAdditions: number
  gross: number
  nssf: number
  employerNssf: number
  shif: number
  housingLevy: number
  employerHousingLevy: number
  pension: number
  personalRelief: number
  paye: number
  loanDeductions: number
  otherDeductions: number
  advanceDeductions: number
  totalDeductions: number
  net: number
  paymentStatus: string
}

export interface StatutoryReport {
  run: { id: string; reference: string; month: string; year: number; status: string; periodStart: string; periodEnd: string }
  rows: StatutoryRow[]
  totals: Record<string, number>
}

export interface AnnualEmployeeRow {
  employeeId: string
  employeeNo: string
  employeeName: string
  kraPin: string
  months: Array<{
    month: number
    basic: number
    benefits: number
    gross: number
    nssf: number
    shif: number
    housingLevy: number
    pension: number
    taxablePay: number
    taxCharged: number
    personalRelief: number
    paye: number
  }>
}

export interface PayslipDetail {
  id: string
  reference: string
  status: string
  paymentStatus: string
  paidAt: string | null
  period: { month: string; year: number; start: string; end: string; runReference: string }
  employee: {
    id: string; number: string; name: string; jobTitle: string; department: string
    kraPin: string; nssfNumber: string; shaNumber: string; idNumber: string
    paymentMode: string; bankName: string; bankAccount: string; mpesaNumber: string
  }
  earnings: Array<{ label: string; amount: number }>
  deductions: Array<{ label: string; amount: number }>
  employer: Array<{ label: string; amount: number }>
  advances: Array<{ ref: string; amount: number; remainingAfter: number }>
  gross: number
  totalDeductions: number
  net: number
  ytd: { gross: number; paye: number; nssf: number; net: number }
}
