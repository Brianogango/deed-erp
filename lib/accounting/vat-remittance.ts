/**
 * VAT remittance journal builder (Finance Phase 12).
 * Dr Output VAT 3301 / Cr Input VAT 1150 (net) + Cr/Dr cash for settlement.
 */

import { labelForRole, cashAccountRoleForMethod, type CoaRole } from '@/lib/accounting/coa-roles'
import { roundMoney } from '@/lib/accounting/money'

export type VatRemittanceInput = {
  taxPeriodCode: string
  outputVat: number
  inputVat: number
  paymentMethod?: string
  /** When true, settle net payable/refundable against cash. Default true. */
  settleCash?: boolean
}

export type VatRemittanceLine = {
  role?: CoaRole
  accountLabel: string
  description: string
  debit: number
  credit: number
}

export function vatRemittanceRef(periodCode: string): string {
  return `JRN/VAT/REMIT/${periodCode}`.slice(0, 80)
}

export function buildVatRemittanceLines(input: VatRemittanceInput): {
  lines: VatRemittanceLine[]
  vatPayable: number
} {
  const output = roundMoney(Math.max(0, Number(input.outputVat) || 0))
  const inputVat = roundMoney(Math.max(0, Number(input.inputVat) || 0))
  const vatPayable = roundMoney(output - inputVat)
  const settle = input.settleCash !== false
  const lines: VatRemittanceLine[] = []
  const desc = `VAT remittance ${input.taxPeriodCode}`

  if (output > 0) {
    lines.push({
      role: 'output_vat',
      accountLabel: labelForRole('output_vat'),
      description: desc,
      debit: output,
      credit: 0,
    })
  }
  if (inputVat > 0) {
    lines.push({
      role: 'input_vat',
      accountLabel: labelForRole('input_vat'),
      description: desc,
      debit: 0,
      credit: inputVat,
    })
  }

  if (settle && Math.abs(vatPayable) > 0.005) {
    const cashRole = cashAccountRoleForMethod(input.paymentMethod || 'bank_transfer')
    if (vatPayable > 0) {
      // Net payable — pay KRA from bank
      lines.push({
        role: cashRole,
        accountLabel: labelForRole(cashRole),
        description: `${desc} settlement`,
        debit: 0,
        credit: vatPayable,
      })
    } else {
      // Net refundable — cash/bank receipt
      lines.push({
        role: cashRole,
        accountLabel: labelForRole(cashRole),
        description: `${desc} refund`,
        debit: -vatPayable,
        credit: 0,
      })
    }
  }

  const d = roundMoney(lines.reduce((s, l) => s + l.debit, 0))
  const c = roundMoney(lines.reduce((s, l) => s + l.credit, 0))
  if (Math.abs(d - c) > 0.02) {
    throw new Error(`VAT remittance unbalanced: debit=${d} credit=${c}`)
  }

  return { lines, vatPayable }
}
