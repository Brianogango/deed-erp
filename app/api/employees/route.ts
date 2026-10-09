import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { hasPermission } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'

const WRITE_ROLES = ['director', 'admin_officer']

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

const splitName = (fullName?: string) => {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || 'Employee',
    lastName: parts.slice(1).join(' ') || parts[0] || 'Employee',
  }
}

const normalizeGender = (value?: string | null): string | null => {
  const g = String(value ?? '').trim().toLowerCase()
  return g === 'male' || g === 'female' ? g : null
}

const resolveDepartmentId = async (value?: string | null) => {
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
const dateField = (v: unknown): Date | null | undefined => {
  if (v === undefined) return undefined
  const raw = String(v ?? '').trim()
  if (!raw) return null
  const d = new Date(`${raw.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? undefined : d
}
const textField = (v: unknown, max: number): string | null | undefined =>
  v === undefined ? undefined : (String(v ?? '').trim().slice(0, max) || null)
const checklistField = (v: unknown) => {
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
    link: ['create_login', 'welcome_email', 'assets', 'training'].includes(String((item as { link?: unknown })?.link)) ? (item as { link: string }).link : undefined,
  })) as Prisma.InputJsonValue
}

type DbEmployee = Awaited<ReturnType<typeof prisma.employee.findFirst>> & {
  department?: { name: string } | null
  user?: { id: string } | null
}

// Full record including compensation + PII — only for HR/finance roles.
const toClientEmployee = (employee: NonNullable<DbEmployee>) => ({
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
  exitDate: employee.endDate ? employee.endDate.toISOString().slice(0, 10) : '',
  exitReason: employee.exitReason ?? '',
  exitNotes: employee.exitNotes ?? '',
  probationEndDate: employee.probationEndDate ? employee.probationEndDate.toISOString().slice(0, 10) : '',
  onboardingChecklist: Array.isArray(employee.onboardingChecklist) ? employee.onboardingChecklist : [],
  exitChecklist: Array.isArray(employee.exitChecklist) ? employee.exitChecklist : [],
  bankName: employee.bankName ?? '',
  bankAccount: employee.bankAccount ?? '',
})

// Safe staff directory — no salary, bank, or national/tax identifiers. Returned
// to non-HR roles so name/department/title resolution works across the app
// without leaking compensation or PII.
const toDirectoryEmployee = (employee: NonNullable<DbEmployee>) => ({
  id: employee.id,
  employeeNo: employee.employeeNumber,
  fullName: `${employee.firstName} ${employee.lastName}`.trim(),
  email: employee.email ?? '',
  workEmail: employee.workEmail ?? '',
  phone: '',
  nationalId: '',
  kraPin: '',
  nssfNumber: '',
  gender: employee.gender ?? '',
  departmentId: employee.department?.name ?? employee.departmentId ?? '',
  jobTitle: employee.jobTitle ?? '',
  shift: employee.shift ?? '',
  startDate: employee.startDate.toISOString().slice(0, 10),
  status: employee.isActive ? 'active' : 'exited',
  userId: employee.user?.id,
  basicSalary: 0,
  housingAllowance: 0,
  transportAllowance: 0,
  bankName: '',
  bankAccount: '',
})

const employeeInclude = {
  department: { select: { name: true } },
  user: { select: { id: true } },
} as const

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const canSeeSensitive = hasPermission(session.user, 'viewEmployeeSensitive')
    const employees = await prisma.employee.findMany({
      include: employeeInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })
    if (canSeeSensitive) {
      return NextResponse.json(employees.map(toClientEmployee))
    }
    // Non-HR: safe directory for everyone, plus the caller's OWN full record
    // (their own salary/bank is theirs to see) matched via User.employeeId.
    const ownId = session.user.employeeId ?? null
    return NextResponse.json(employees.map(e => (ownId && e.id === ownId ? toClientEmployee(e) : toDirectoryEmployee(e))))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const body = await request.json()
    const { firstName, lastName } = splitName(body.fullName)
    const departmentId = await resolveDepartmentId(body.departmentId)

    const employee = await prisma.employee.create({
      data: {
        employeeNumber: String(body.employeeNo ?? body.employeeNumber ?? '').trim(),
        firstName,
        lastName,
        email: String(body.email ?? '').trim() || null,
        workEmail: body.workEmail === undefined ? undefined : (String(body.workEmail ?? '').trim().toLowerCase() || null),
        phone: String(body.phone ?? '').trim() || null,
        idNumber: String(body.nationalId ?? body.idNumber ?? '').trim() || null,
        kraPin: String(body.kraPin ?? '').trim() || null,
        nssfNumber: String(body.nssfNumber ?? '').trim() || null,
        nhifNumber: String(body.nhifNumber ?? '').trim() || null,
        gender: normalizeGender(body.gender),
        shift: String(body.shift ?? '').trim() || null,
        departmentId,
        jobTitle: String(body.jobTitle ?? '').trim() || null,
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        basicSalary: Number(body.basicSalary) || 0,
        housingAllowance: body.housingAllowance === undefined ? undefined : Math.max(0, Number(body.housingAllowance) || 0),
        transportAllowance: body.transportAllowance === undefined ? undefined : Math.max(0, Number(body.transportAllowance) || 0),
        paymentMode: ['bank', 'mpesa', 'cash'].includes(String(body.paymentMode)) ? String(body.paymentMode) : undefined,
        mpesaNumber: body.mpesaNumber === undefined ? undefined : (String(body.mpesaNumber ?? '').trim() || null),
        endDate: dateField(body.exitDate),
        probationEndDate: dateField(body.probationEndDate),
        exitReason: textField(body.exitReason, 60),
        exitNotes: textField(body.exitNotes, 4000),
        onboardingChecklist: checklistField(body.onboardingChecklist),
        exitChecklist: checklistField(body.exitChecklist),
        bankName: String(body.bankName ?? '').trim() || null,
        bankAccount: String(body.bankAccount ?? '').trim() || null,
        isActive: body.status !== 'exited',
      },
      include: employeeInclude,
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'create_employee',
      entityType: 'employee',
      entityId: employee.id,
      newValues: { employeeNumber: employee.employeeNumber, name: `${employee.firstName} ${employee.lastName}`.trim(), jobTitle: employee.jobTitle },
    })

    return NextResponse.json(toClientEmployee(employee), { status: 201 })
  })
}
