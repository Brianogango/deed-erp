/**
 * Onboarding and exit task templates. Each task carries written instructions,
 * who owns it, and a due date counted from the start (or last working) day.
 */
import type { EmployeeChecklistItem } from '@/lib/store'

export type ChecklistOwner = 'hr' | 'it' | 'finance' | 'manager' | 'employee'
export type ChecklistLink = 'create_login' | 'welcome_email' | 'assets' | 'training'

interface TaskTemplate {
  key: string
  label: string
  instructions: string
  owner: ChecklistOwner
  /** Days after the start date (onboarding) or last working day (exit). Negative = before. */
  dueOffsetDays: number
  link?: ChecklistLink
}

export const OWNER_LABELS: Record<ChecklistOwner, string> = {
  hr: 'HR', it: 'IT', finance: 'Finance', manager: 'Line manager', employee: 'Employee',
}

export const LINK_LABELS: Record<ChecklistLink, string> = {
  create_login: 'Create ERP login',
  welcome_email: 'Send welcome email',
  assets: 'Issue equipment',
  training: 'Enrol in training',
}

export const ONBOARDING_TEMPLATES: TaskTemplate[] = [
  {
    key: 'welcome_email', label: 'Send the welcome email', owner: 'hr', dueOffsetDays: -3, link: 'welcome_email',
    instructions: 'Email the new hire their start date, who to report to, what to bring, and their work email address. Use the button here so the message is logged. Do this before day one.',
  },
  {
    key: 'documents', label: 'Collect ID, KRA PIN certificate, NSSF and SHA numbers', owner: 'hr', dueOffsetDays: 1,
    instructions: 'Collect copies of the national ID, KRA PIN certificate, NSSF number and SHA (SHIF) number. Enter them on the employee profile (Edit) and upload copies under HR > Documents. Payroll cannot file PAYE, NSSF or SHIF correctly without them.',
  },
  {
    key: 'contract', label: 'Signed employment contract on file', owner: 'hr', dueOffsetDays: 1,
    instructions: 'Issue the contract before or on day one. Upload the signed copy under HR > Documents with type Contract. The Employment Act requires written particulars within two months of starting.',
  },
  {
    key: 'payment', label: 'Bank or M-Pesa payment details captured', owner: 'finance', dueOffsetDays: 3,
    instructions: 'On the employee profile set "Salary paid by", then enter the bank name and account, or the M-Pesa number. Set the house and transport allowance if the contract includes them. Confirm basic salary matches the offer.',
  },
  {
    key: 'work_email', label: 'Work email created', owner: 'it', dueOffsetDays: -1,
    instructions: 'Create the mailbox in your email provider (for example firstname.lastname@yourdomain). Then enter it in the Work email field on the employee profile so leave and payslip emails reach it. Share the temporary password with the new hire in person or by phone, never by email.',
  },
  {
    key: 'erp_login', label: 'ERP login created and role assigned', owner: 'it', dueOffsetDays: 0, link: 'create_login',
    instructions: 'Use the button here to create the login. The new hire receives a temporary password by email and must change it on first sign-in. Pick the role that matches their job; modules are set from the role and can be adjusted later under Settings > Users.',
  },
  {
    key: 'equipment', label: 'Equipment issued and acknowledged', owner: 'it', dueOffsetDays: 0, link: 'assets',
    instructions: 'Issue the laptop, phone and accessories under HR > Assets so the serial numbers are recorded against the employee. The employee must acknowledge receipt there.',
  },
  {
    key: 'induction', label: 'Induction and mandatory training scheduled', owner: 'hr', dueOffsetDays: 2, link: 'training',
    instructions: 'Enrol the employee in the programmes marked mandatory for new hires under HR > Training, and book the company induction with their line manager.',
  },
  {
    key: 'first_week', label: 'First-week check-in with line manager', owner: 'manager', dueOffsetDays: 7,
    instructions: 'Meet the new hire at the end of the first week. Confirm they have access to everything they need, agree their first 30-day goals, and note any problems for HR.',
  },
  {
    key: 'probation', label: 'Probation review date agreed', owner: 'hr', dueOffsetDays: 7,
    instructions: 'Set the probation end date on the Onboarding tab (usually 3 or 6 months from the start date). The system shows a reminder as it approaches.',
  },
]

export const EXIT_TEMPLATES: TaskTemplate[] = [
  { key: 'letter', label: 'Resignation or termination letter on file', owner: 'hr', dueOffsetDays: -14, instructions: 'File the signed letter under HR > Documents. Confirm the notice period in the contract and the last working day.' },
  { key: 'handover', label: 'Handover of work completed', owner: 'manager', dueOffsetDays: -2, instructions: 'The line manager agrees a written handover: open tasks, customer contacts, passwords held in shared tools, and who takes over each item.' },
  { key: 'equipment', label: 'Company equipment returned and inspected', owner: 'it', dueOffsetDays: 0, link: 'assets', instructions: 'Record the return of each item under HR > Assets with its condition. Unreturned items show on the final dues screen.' },
  { key: 'interview', label: 'Exit interview held', owner: 'hr', dueOffsetDays: -1, instructions: 'Hold the exit interview and record the main reasons for leaving in the exit notes.' },
  { key: 'accounts', label: 'System accounts and work email disabled', owner: 'it', dueOffsetDays: 0, instructions: 'On the last working day deactivate the ERP login (Settings > Users) and disable the mailbox. Forward important mail to the line manager.' },
  { key: 'dues_agreed', label: 'Final dues statement agreed and signed', owner: 'finance', dueOffsetDays: 3, instructions: 'Generate the final dues statement on the Exit tab, review the figures with the employee, and have both parties sign it.' },
  { key: 'dues_paid', label: 'Final dues paid', owner: 'finance', dueOffsetDays: 7, instructions: 'Pay the agreed amount through payroll. Employment Act s.18 expects dues to be paid on the last working day or promptly after.' },
  { key: 'certificate', label: 'Certificate of service issued', owner: 'hr', dueOffsetDays: 7, instructions: 'Generate the certificate of service from the Exit tab and hand it over.' },
]

const addDays = (iso: string, days: number): string | undefined => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return undefined
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function buildChecklist(templates: TaskTemplate[], anchorDate: string, newId: () => string): EmployeeChecklistItem[] {
  return templates.map(t => ({
    id: newId(), key: t.key, label: t.label, done: false,
    instructions: t.instructions, owner: t.owner, link: t.link, dueDate: addDays(anchorDate, t.dueOffsetDays),
  }))
}

export type DueState = 'done' | 'overdue' | 'due_soon' | 'upcoming' | 'none'

/** Overdue and due-soon (within 3 days) states for the checklist display. */
export function dueState(item: Pick<EmployeeChecklistItem, 'done' | 'dueDate'>, today: Date = new Date()): DueState {
  if (item.done) return 'done'
  if (!item.dueDate) return 'none'
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const due = new Date(`${item.dueDate}T00:00:00`).getTime()
  if (Number.isNaN(due)) return 'none'
  const days = Math.round((due - start) / 86400000)
  return days < 0 ? 'overdue' : days <= 3 ? 'due_soon' : 'upcoming'
}

// Plain label lists, kept for places that only need the wording.
export const ONBOARDING_ITEMS = ONBOARDING_TEMPLATES.map(t => t.label)
export const EXIT_ITEMS = EXIT_TEMPLATES.map(t => t.label)
