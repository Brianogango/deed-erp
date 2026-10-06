/**
 * The director's morning brief: one notification each working morning with
 * everything waiting on a director or costing money — bills to pay, money
 * customers owe, leave / advances / payroll to approve, purchase orders and
 * stock checkouts to approve, equipment not returned, and machines invoiced
 * but never delivered. Sections with nothing in them are left out. Pure.
 */

export type BriefSection = {
  key: string
  heading: string
  count: number
  amount?: number
  lines: string[]
}

export type DirectorBriefInput = {
  billsOverdue: Array<{ ref: string; supplier?: string | null; balance: number; dueDate: string }>
  billsDueSoon: Array<{ ref: string; supplier?: string | null; balance: number; dueDate: string }>
  invoicesOverdue: Array<{ ref: string; customer?: string | null; balance: number; dueDate: string }>
  leavePending: Array<{ ref: string; employee: string; type: string; from: string; to: string; days: number }>
  advancesPending: Array<{ ref: string; employee: string; amount: number }>
  payrollPending: Array<{ ref: string }>
  posAwaitingApproval: Array<{ ref: string; supplier?: string | null; total: number }>
  checkoutsPending: Array<{ ref: string; product: string; qty: number; receiver: string }>
  checkoutsOverdue: Array<{ ref: string; product: string; qty: number; receiver: string; expected: string }>
  invoicedNotDelivered: Array<{ ref: string; customer: string; units: number }>
}

export const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const sum = (rows: Array<{ balance?: number; amount?: number; total?: number }>) =>
  rows.reduce((s, r) => s + (r.balance ?? r.amount ?? r.total ?? 0), 0)
const top = <T>(rows: T[], line: (r: T) => string, limit = 5) => [
  ...rows.slice(0, limit).map(line),
  ...(rows.length > limit ? [`…and ${rows.length - limit} more`] : []),
]

export function buildDirectorBrief(input: DirectorBriefInput): BriefSection[] {
  const sections: BriefSection[] = []
  const add = (s: BriefSection) => { if (s.count > 0) sections.push(s) }
  const byBalance = <T extends { balance: number }>(rows: T[]) => [...rows].sort((a, b) => b.balance - a.balance)
  const party = (name?: string | null) => (name ? ` ${name}` : '')

  add({
    key: 'bills_overdue',
    heading: `Bills overdue — ${plural(input.billsOverdue.length, 'bill')}, ${kes(sum(input.billsOverdue))}`,
    count: input.billsOverdue.length,
    amount: sum(input.billsOverdue),
    lines: top(byBalance(input.billsOverdue), b => `${b.ref}${party(b.supplier)} — ${kes(b.balance)} (due ${b.dueDate})`),
  })
  add({
    key: 'bills_due',
    heading: `Bills due in the next 7 days — ${plural(input.billsDueSoon.length, 'bill')}, ${kes(sum(input.billsDueSoon))}`,
    count: input.billsDueSoon.length,
    amount: sum(input.billsDueSoon),
    lines: top([...input.billsDueSoon].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), b => `${b.ref}${party(b.supplier)} — ${kes(b.balance)} (due ${b.dueDate})`),
  })
  add({
    key: 'leave',
    heading: `Leave to approve — ${plural(input.leavePending.length, 'request')}`,
    count: input.leavePending.length,
    lines: top(input.leavePending, l => `${l.employee} — ${l.type.replaceAll('_', ' ')}, ${l.from} to ${l.to} (${plural(l.days, 'day')})`),
  })
  add({
    key: 'advances',
    heading: `Salary advances to approve — ${plural(input.advancesPending.length, 'request')}, ${kes(sum(input.advancesPending))}`,
    count: input.advancesPending.length,
    amount: sum(input.advancesPending),
    lines: top(input.advancesPending, a => `${a.employee} — ${kes(a.amount)}`),
  })
  add({
    key: 'payroll',
    heading: `Payroll to approve — ${plural(input.payrollPending.length, 'run')}`,
    count: input.payrollPending.length,
    lines: top(input.payrollPending, p => p.ref),
  })
  add({
    key: 'purchase_orders',
    heading: `Purchase orders to approve — ${plural(input.posAwaitingApproval.length, 'order')}, ${kes(sum(input.posAwaitingApproval))}`,
    count: input.posAwaitingApproval.length,
    amount: sum(input.posAwaitingApproval),
    lines: top(input.posAwaitingApproval, p => `${p.ref}${party(p.supplier)} — ${kes(p.total)}`),
  })
  add({
    key: 'checkouts_pending',
    heading: `Stock checkouts to approve — ${plural(input.checkoutsPending.length, 'request')}`,
    count: input.checkoutsPending.length,
    lines: top(input.checkoutsPending, c => `${c.ref} — ${c.qty} × ${c.product} for ${c.receiver}`),
  })
  add({
    key: 'checkouts_overdue',
    heading: `Checked-out stock not returned — ${plural(input.checkoutsOverdue.length, 'checkout')}`,
    count: input.checkoutsOverdue.length,
    lines: top(input.checkoutsOverdue, c => `${c.ref} — ${c.qty} × ${c.product} with ${c.receiver} (due back ${c.expected})`),
  })
  add({
    key: 'invoices_overdue',
    heading: `Customers owing past due date — ${plural(input.invoicesOverdue.length, 'invoice')}, ${kes(sum(input.invoicesOverdue))}`,
    count: input.invoicesOverdue.length,
    amount: sum(input.invoicesOverdue),
    lines: top(byBalance(input.invoicesOverdue), i => `${i.ref}${party(i.customer)} — ${kes(i.balance)} (due ${i.dueDate})`),
  })
  add({
    key: 'invoiced_not_delivered',
    heading: `Invoiced but not delivered — ${plural(input.invoicedNotDelivered.length, 'order')}`,
    count: input.invoicedNotDelivered.length,
    lines: top(input.invoicedNotDelivered, o => `${o.ref} ${o.customer} — ${plural(o.units, 'machine')} still in stock`),
  })
  return sections
}

export function directorBriefTitle(sections: BriefSection[]): string {
  const pay = sections.filter(s => s.key === 'bills_overdue' || s.key === 'bills_due').reduce((n, s) => n + (s.amount ?? 0), 0)
  const approvals = sections
    .filter(s => ['leave', 'advances', 'payroll', 'purchase_orders', 'checkouts_pending'].includes(s.key))
    .reduce((n, s) => n + s.count, 0)
  const parts = [
    pay > 0 ? `${kes(pay)} of bills to pay` : null,
    approvals > 0 ? `${plural(approvals, 'approval')} waiting` : null,
  ].filter(Boolean)
  return `Morning brief${parts.length ? ` — ${parts.join(', ')}` : ` — ${plural(sections.length, 'item')} to review`}`
}

export function directorBriefBody(sections: BriefSection[]): string {
  return sections.map(s => [s.heading, ...s.lines.map(l => `• ${l}`)].join('\n')).join('\n\n')
}
