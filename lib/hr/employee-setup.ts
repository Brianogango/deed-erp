/**
 * Whether a person's HR record is complete: the details payroll and the law
 * need, and the papers HR keeps on file. Worked out from the record itself,
 * so it is right for people hired before the checklist existed too.
 *
 * Equipment is shown but not counted — not everyone is issued a machine.
 * Pure.
 */
import type { Employee, HRDocument } from '@/lib/store'

export type SetupItem = {
  key: 'details' | 'pay' | 'id_copy' | 'contract' | 'tasks' | 'equipment'
  label: string
  done: boolean
  /** What is missing, in a few words. */
  hint: string
  /** Counted towards "complete". */
  required: boolean
}

export type EmployeeSetup = { items: SetupItem[]; done: number; total: number; complete: boolean; missing: string[] }

const has = (v: unknown) => String(v ?? '').trim().length > 0

export function employeeSetup(
  e: Pick<Employee, 'id' | 'phone' | 'nationalId' | 'kraPin' | 'nssfNumber' | 'shift' | 'paymentMode' | 'bankAccount' | 'mpesaNumber' | 'onboardingChecklist'>,
  documents: Array<Pick<HRDocument, 'employeeId' | 'type'>>,
  assetCount = 0,
): EmployeeSetup {
  const mine = documents.filter(d => d.employeeId === e.id)
  const missingDetails = [
    !has(e.phone) && 'phone',
    !has(e.nationalId) && 'ID number',
    !has(e.kraPin) && 'KRA PIN',
  ].filter(Boolean) as string[]
  const payTo = e.paymentMode === 'bank' ? has(e.bankAccount) : e.paymentMode === 'cash' ? true : has(e.mpesaNumber) || has(e.phone)
  const missingPay = [
    !payTo && (e.paymentMode === 'bank' ? 'bank account' : 'M-Pesa number'),
    !has(e.nssfNumber) && 'NSSF',
    !has(e.shift) && 'SHIF',
  ].filter(Boolean) as string[]
  const tasks = e.onboardingChecklist ?? []
  const tasksLeft = tasks.filter(t => !t.done).length

  const items: SetupItem[] = [
    { key: 'details', label: 'Contact & ID details', done: missingDetails.length === 0, hint: missingDetails.length ? `Missing ${missingDetails.join(', ')}` : 'Phone, ID number and KRA PIN', required: true },
    { key: 'pay', label: 'Pay details', done: missingPay.length === 0, hint: missingPay.length ? `Missing ${missingPay.join(', ')}` : 'Where pay goes, NSSF and SHIF', required: true },
    { key: 'id_copy', label: 'ID copy on file', done: mine.some(d => d.type === 'id_copy'), hint: mine.some(d => d.type === 'id_copy') ? 'Uploaded' : 'Upload a photo or scan', required: true },
    { key: 'contract', label: 'Signed contract on file', done: mine.some(d => d.type === 'contract'), hint: mine.some(d => d.type === 'contract') ? 'Uploaded' : 'Upload the signed copy', required: true },
    ...(tasks.length ? [{ key: 'tasks' as const, label: 'Onboarding tasks', done: tasksLeft === 0, hint: tasksLeft ? `${tasksLeft} of ${tasks.length} left` : `All ${tasks.length} done`, required: true }] : []),
    { key: 'equipment', label: 'Equipment issued', done: assetCount > 0, hint: assetCount ? `${assetCount} item${assetCount === 1 ? '' : 's'}` : 'If they need a machine or phone', required: false },
  ]
  const required = items.filter(i => i.required)
  const done = required.filter(i => i.done).length
  return {
    items, done, total: required.length, complete: done === required.length,
    missing: required.filter(i => !i.done).map(i => i.label.replace(/ on file$/, '').toLowerCase()),
  }
}
