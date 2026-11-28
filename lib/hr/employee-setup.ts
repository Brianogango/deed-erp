/**
 * A person's onboarding, as the HR screens show it: the five things a new
 * hire needs before they are fully set up. Worked out from the record
 * itself, so it is right for people hired before the checklist existed too.
 * Pure.
 */
import type { Employee, HRDocument } from '@/lib/store'

export type SetupItem = {
  key: 'details' | 'id_copy' | 'payroll' | 'contract' | 'equipment'
  label: string
  done: boolean
  /** What is there, or what is missing, in a few words. */
  hint: string
}

export type EmployeeSetup = { items: SetupItem[]; done: number; total: number; complete: boolean; missing: string[] }

const has = (v: unknown) => String(v ?? '').trim().length > 0
const SHORT: Record<SetupItem['key'], string> = { details: 'details', id_copy: 'ID', payroll: 'payroll', contract: 'contract', equipment: 'kit' }

export function employeeSetup(
  e: Pick<Employee, 'id' | 'phone' | 'nationalId' | 'kraPin' | 'nssfNumber' | 'shift' | 'paymentMode' | 'bankAccount' | 'bankName' | 'mpesaNumber' | 'basicSalary'>,
  documents: Array<Pick<HRDocument, 'employeeId' | 'type'>>,
  assetCount = 0,
  payBasis?: { basis: 'monthly' | 'daily'; dailyRate: number } | null,
): EmployeeSetup {
  const mine = documents.filter(d => d.employeeId === e.id)
  const payTo = e.paymentMode === 'bank' ? has(e.bankAccount) : e.paymentMode === 'cash' ? true : has(e.mpesaNumber) || has(e.phone)
  const missingDetails = [
    !has(e.phone) && 'phone',
    !has(e.nationalId) && 'ID number',
    !has(e.kraPin) && 'KRA PIN',
    !payTo && (e.paymentMode === 'bank' ? 'bank account' : 'M-Pesa number'),
  ].filter(Boolean) as string[]
  const paidWhere = e.paymentMode === 'bank' ? (e.bankName || 'Bank') : e.paymentMode === 'cash' ? 'Cash' : 'M-Pesa'
  const idCopies = mine.filter(d => d.type === 'id_copy').length
  const daily = payBasis?.basis === 'daily' && payBasis.dailyRate > 0
  const paySet = daily || Number(e.basicSalary) > 0
  const missingPayroll = [!paySet && 'pay', !has(e.nssfNumber) && 'NSSF', !has(e.shift) && 'SHIF'].filter(Boolean) as string[]

  const items: SetupItem[] = [
    { key: 'details', label: 'Personal & bank details', done: missingDetails.length === 0, hint: missingDetails.length ? `Missing ${missingDetails.join(', ')}` : `${paidWhere} · ID ${String(e.nationalId).slice(0, 4)}…` },
    { key: 'id_copy', label: 'ID & KRA PIN copies', done: idCopies > 0, hint: idCopies ? `${idCopies} document${idCopies === 1 ? '' : 's'}` : 'Upload a photo or scan' },
    { key: 'payroll', label: 'Payroll set up', done: missingPayroll.length === 0, hint: missingPayroll.length ? `Missing ${missingPayroll.join(', ')}` : daily ? 'Daily rate · clocks in' : 'Monthly salary' },
    { key: 'contract', label: 'Contract signed', done: mine.some(d => d.type === 'contract'), hint: mine.some(d => d.type === 'contract') ? 'On file' : 'Upload the signed copy' },
    { key: 'equipment', label: 'Equipment issued', done: assetCount > 0, hint: assetCount ? `${assetCount} item${assetCount === 1 ? '' : 's'}` : 'Laptop, phone…' },
  ]
  const done = items.filter(i => i.done).length
  return { items, done, total: items.length, complete: done === items.length, missing: items.filter(i => !i.done).map(i => SHORT[i.key]) }
}
