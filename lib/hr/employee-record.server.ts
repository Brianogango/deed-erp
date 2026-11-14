import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

/** Employee input parsing and the client shape, shared by the employee routes. */
const DEPARTMENT_NAMES = [
  'HR',
  'Sales',
  'Marketing',
  'Finance',
  'Engineering',
  'Logistics & Supply Chain Management',
  'Strategy & R&D',
  'Administration',
  'Circular Computing Centre',
  'Managed IT Services',
  'AI & Automation',
  'Training & Certification',
  'ESG & Sustainability',
  'Investor Relations & Capital Raising',
  'Regional Expansion / New Markets',
  'Deed Foundation',
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const slugifyDepartment = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const departmentNameFromInput = (value?: string | null) => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const normalized = raw.toLowerCase()
  return (
    DEPARTMENT_NAMES.find(name => name.toLowerCase() === normalized || slugifyDepartment(name) === normalized) ?? raw
  )
}

export const splitName = (fullName?: string) => {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || 'Employee',
    lastName: parts.slice(1).join(' ') || parts[0] || 'Employee',
  }
}

export const normalizeGender = (value?: string | null): string | null => {
  const g = String(value ?? '').trim().toLowerCase()
  return g === 'male' || g === 'female' ? g : null
}

export const resolveDepartmentId = async (value?: string | null) => {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  if (UUID_RE.test(raw)) {
    const existing = await prisma.department.findUnique({ where: { id: raw } })
    if (existing) return existing.id
  }

  const name = departmentNameFromInput(raw)
  if (!name) return null

  const department = await prisma.department.upsert({
    where: { name },
    update: { isActive: true },
    create: { name, description: `${name} department`, isActive: true },
  })

  return department.id
}

// undefined = leave the column alone; '' / null clears it.
export const dateField = (v: unknown): Date | null | undefined => {
  if (v === undefined) return undefined
  const raw = String(v ?? '').trim()
  if (!raw) return null
  const d = new Date(`${raw.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? undefined : d
}
// undefined = leave alone; '' clears; anything that is not a UUID, or is the employee themselves, is ignored.
export const managerField = (v: unknown, selfId?: string): string | null | undefined => {
  if (v === undefined) return undefined
  const raw = String(v ?? '').trim()
  if (!raw) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) || raw === selfId) return undefined
  return raw
}
export const textField = (v: unknown, max: number): string | null | undefined =>
  v === undefined ? undefined : (String(v ?? '').trim().slice(0, max) || null)
export const checklistField = (v: unknown) => {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length === 0) return Prisma.DbNull
  return v.slice(0, 40).map(item => ({
    id: String((item as { id?: unknown })?.id ?? '').slice(0, 60),
    label: String((item as { label?: unknown })?.label ?? '').slice(0, 160),
    done: Boolean((item as { done?: unknown })?.done),
    doneAt: (item as { doneAt?: unknown })?.doneAt ? String((item as { doneAt?: unknown }).doneAt).slice(0, 40) : undefined,
    key: (item as { key?: unknown })?.key ? String((item as { key?: unknown }).key).slice(0, 40) : undefined,
    instructions: (item as { instructions?: unknown })?.instructions ? String((item as { instructions?: unknown }).instructions).slice(0, 800) : undefined,
    owner: ['hr', 'it', 'finance', 'manager', 'employee'].includes(String((item as { owner?: unknown })?.owner)) ? (item as { owner: string }).owner : undefined,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String((item as { dueDate?: unknown })?.dueDate ?? '')) ? (item as { dueDate: string }).dueDate : undefined,
    link: ['create_login', 'welcome_email', 'assets', 'training', 'create_mailbox', 'disable_mailbox'].includes(String((item as { link?: unknown })?.link)) ? (item as { link: string }).link : undefined,
  })) as Prisma.InputJsonValue
}

export type DbEmployee = Awaited<ReturnType<typeof prisma.employee.findFirst>> & {
  department?: { name: string } | null
  user?: { id: string } | null
}

// Full record including compensation + PII — only for HR/finance roles.
export const toClientEmployee = (employee: NonNullable<DbEmployee>) => ({
  id: employee.id,
  employeeNo: employee.employeeNumber,
  fullName: `${employee.firstName} ${employee.lastName}`.trim(),
  email: employee.email ?? '',
  workEmail: employee.workEmail ?? '',
  phone: employee.phone ?? '',
  nationalId: employee.idNumber ?? '',
  kraPin: employee.kraPin ?? '',
  nssfNumber: employee.nssfNumber ?? '',
  gender: employee.gender ?? '',
  departmentId: employee.department?.name ?? employee.departmentId ?? '',
  jobTitle: employee.jobTitle ?? '',
  shift: employee.shift ?? '',
  startDate: employee.startDate.toISOString().slice(0, 10),
  status: employee.isActive ? 'active' : 'exited',
  userId: employee.user?.id,
  basicSalary: Number(employee.basicSalary ?? 0),
  housingAllowance: Number(employee.housingAllowance ?? 0),
  transportAllowance: Number(employee.transportAllowance ?? 0),
  paymentMode: employee.paymentMode,
  mpesaNumber: employee.mpesaNumber ?? '',
  managerEmployeeId: employee.managerId ?? '',
  exitDate: employee.endDate ? employee.endDate.toISOString().slice(0, 10) : '',
  exitReason: employee.exitReason ?? '',
  exitNotes: employee.exitNotes ?? '',
  probationEndDate: employee.probationEndDate ? employee.probationEndDate.toISOString().slice(0, 10) : '',
  onboardingChecklist: Array.isArray(employee.onboardingChecklist) ? employee.onboardingChecklist : [],
  exitChecklist: Array.isArray(employee.exitChecklist) ? employee.exitChecklist : [],
  bankName: employee.bankName ?? '',
  bankAccount: employee.bankAccount ?? '',
})

export const employeeInclude = {
  department: { select: { name: true } },
  user: { select: { id: true } },
} as const
