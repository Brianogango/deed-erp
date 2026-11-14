import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { hasPermission } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { splitName, resolveDepartmentId, normalizeGender, dateField, managerField, textField, checklistField, toClientEmployee, employeeInclude, type DbEmployee } from '@/lib/hr/employee-record.server'

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
    const actor = await requirePermission('manageHR')
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
        managerId: managerField(body.managerEmployeeId),
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
