import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { splitName, resolveDepartmentId, normalizeGender, dateField, managerField, textField, checklistField, toClientEmployee, employeeInclude } from '@/lib/hr/employee-record.server'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('hr.employees.finance')
    const body = await request.json()
    const { firstName, lastName } = splitName(body.fullName)
    const departmentId = await resolveDepartmentId(body.departmentId)

    const before = await prisma.employee.findUnique({ where: { id: resolvedParams.id }, select: { basicSalary: true, isActive: true } })

    const employee = await prisma.employee.update({
      where: { id: resolvedParams.id },
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
        managerId: managerField(body.managerEmployeeId, resolvedParams.id),
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

    const salaryChanged = before && Number(before.basicSalary ?? 0) !== Number(employee.basicSalary ?? 0)
    const statusChanged = before && before.isActive !== employee.isActive
    await writeFinancialAudit({
      userId: actor.id,
      action: statusChanged && !employee.isActive ? 'exit_employee' : salaryChanged ? 'change_employee_salary' : 'update_employee',
      entityType: 'employee',
      entityId: employee.id,
      oldValues: before ? { basicSalary: Number(before.basicSalary ?? 0), active: before.isActive } : undefined,
      newValues: { basicSalary: Number(employee.basicSalary ?? 0), active: employee.isActive },
    })

    return NextResponse.json(toClientEmployee(employee))
  })
}
