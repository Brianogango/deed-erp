import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

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

type DbEmployee = Awaited<ReturnType<typeof prisma.employee.findFirst>> & {
  department?: { name: string } | null
  user?: { id: string } | null
}

const toClientEmployee = (employee: NonNullable<DbEmployee>) => ({
  id: employee.id,
  employeeNo: employee.employeeNumber,
  fullName: `${employee.firstName} ${employee.lastName}`.trim(),
  email: employee.email ?? '',
  phone: employee.phone ?? '',
  nationalId: employee.idNumber ?? '',
  kraPin: employee.kraPin ?? '',
  nssfNumber: employee.nssfNumber ?? '',
  departmentId: employee.department?.name ?? employee.departmentId ?? '',
  jobTitle: employee.jobTitle ?? '',
  shift: employee.shift ?? '',
  startDate: employee.startDate.toISOString().slice(0, 10),
  status: employee.isActive ? 'active' : 'exited',
  userId: employee.user?.id,
  basicSalary: Number(employee.basicSalary ?? 0),
  housingAllowance: 0,
  transportAllowance: 0,
  bankName: employee.bankName ?? '',
  bankAccount: employee.bankAccount ?? '',
})

const employeeInclude = {
  department: { select: { name: true } },
  user: { select: { id: true } },
} as const

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const employees = await prisma.employee.findMany({
      include: employeeInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })
    return NextResponse.json(employees.map(toClientEmployee))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    const { firstName, lastName } = splitName(body.fullName)
    const departmentId = await resolveDepartmentId(body.departmentId)

    const employee = await prisma.employee.create({
      data: {
        employeeNumber: String(body.employeeNo ?? body.employeeNumber ?? '').trim(),
        firstName,
        lastName,
        email: String(body.email ?? '').trim() || null,
        phone: String(body.phone ?? '').trim() || null,
        idNumber: String(body.nationalId ?? body.idNumber ?? '').trim() || null,
        kraPin: String(body.kraPin ?? '').trim() || null,
        nssfNumber: String(body.nssfNumber ?? '').trim() || null,
        nhifNumber: String(body.nhifNumber ?? '').trim() || null,
        shift: String(body.shift ?? '').trim() || null,
        departmentId,
        jobTitle: String(body.jobTitle ?? '').trim() || null,
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        basicSalary: Number(body.basicSalary) || 0,
        bankName: String(body.bankName ?? '').trim() || null,
        bankAccount: String(body.bankAccount ?? '').trim() || null,
        isActive: body.status !== 'exited',
      },
      include: employeeInclude,
    })

    return NextResponse.json(toClientEmployee(employee), { status: 201 })
  })
}
