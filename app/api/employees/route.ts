import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { Employee } from '@/lib/store'

const config = {
  storeKey: 'deed_employees',
  build: (body: Record<string, unknown>): Employee | string => {
    if (!body.fullName) return 'fullName is required'
    return {
      id: `emp_${Date.now()}`,
      employeeNo: `EMP-${Date.now()}`,
      fullName: String(body.fullName),
      email: String(body.email ?? ''),
      phone: String(body.phone ?? ''),
      nationalId: String(body.nationalId ?? ''),
      kraPin: String(body.kraPin ?? ''),
      departmentId: String(body.departmentId ?? ''),
      jobTitle: String(body.jobTitle ?? ''),
      startDate: new Date().toISOString().slice(0, 10),
      status: 'active',
      basicSalary: Number(body.basicSalary ?? 0),
      housingAllowance: Number(body.housingAllowance ?? 0),
      transportAllowance: Number(body.transportAllowance ?? 0),
      bankAccount: String(body.bankAccount ?? ''),
      ...(body as Partial<Employee>),
    } as Employee
  },
  filter: (items: Employee[], params: URLSearchParams) => {
    let result = items
    const status = params.get('status')
    const dept = params.get('department')
    const q = params.get('q')?.toLowerCase()
    if (status) result = result.filter(e => e.status === status)
    if (dept) result = result.filter(e => e.departmentId === dept)
    if (q) result = result.filter(e =>
      e.fullName.toLowerCase().includes(q) ||
      e.employeeNo.toLowerCase().includes(q) ||
      e.jobTitle.toLowerCase().includes(q)
    )
    return result
  },
  // Salary fields are sensitive — redacted from list; still available via PATCH
  redact: ['basicSalary', 'housingAllowance', 'transportAllowance', 'bankAccount', 'nationalId', 'kraPin'] as (keyof Employee)[],
}

export const { GET, POST } = makeCollectionHandlers(config)
