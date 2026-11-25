'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { faUsers, faUserPlus, faPen, faEye } from '@fortawesome/free-solid-svg-icons'

import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { useUrlRecordId, useUrlUiState } from '@/hooks/useUrlRecordId'
import { downloadPdf } from '@/lib/pdf'
import HRLeaveTab from './hr/HRLeaveTab'
import HRPayrollTab from './hr/HRPayrollTab'
import HRRecruitmentTab from './hr/HRRecruitmentTab'
import HRAssetsTab from './hr/HRAssetsTab'
import HRSalaryAdvanceTab from './hr/HRSalaryAdvanceTab'
import HRPerformanceTab from './hr/HRPerformanceTab'
import HRAttendanceTab from './hr/HRAttendanceTab'
import HRMyPortal from './hr/HRMyPortal'
import HRDepartments from './hr/HRDepartments'
import HREmployeeSummary from './hr/HREmployeeSummary'
import { HRTrainingTab, HRDocumentsTab, HRReportsTab } from './hr/HRExtraTabs'
import { Badge, Confirm, Field, Input, Modal, Select, ModuleSkeleton, useMounted, TabBar, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton, SecondaryActionMenu } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { type Employee } from '@/lib/store'
import { Fa } from '@/components/icons'
import EmployeeLifecyclePanel from './hr/HREmployeeLifecycle'
import HROrgChart from './hr/HROrgChart'
import { documentExpiry } from '@/lib/hr/document-status'
import { userCan } from '@/lib/auth/can'
import { initials } from '@/lib/utils'
import { OperationalSummary } from '@/components/erp/OperationalSummary'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

type HRTab =
  | 'employees'
  | 'recruitment'
  | 'training'
  | 'leave'
  | 'payroll'
  | 'attendance'
  | 'departments'
  | 'salary_advances'
  | 'documents'
  | 'assets'
  | 'self_service'
  | 'sops'
  | 'reports'
  | 'performance'
  | 'org_chart'
  | 'system_users'

const MANAGEMENT_TABS: HRTab[] = ['employees', 'attendance', 'departments', 'assets', 'org_chart', 'recruitment', 'training', 'documents', 'performance', 'reports']
const SELF_SERVICE_TABS: HRTab[] = ['self_service', 'leave', 'salary_advances', 'payroll']

/** HR's sections, grouped the way the work is: who people are, their time, their pay, their growth. */
const TAB_GROUPS: Array<{ id: string; label: string; tabs: Array<{ id: HRTab; label: string }> }> = [
  { id: 'portal', label: 'My portal', tabs: [{ id: 'self_service', label: 'My portal' }] },
  { id: 'people', label: 'People', tabs: [{ id: 'employees', label: 'Employees' }, { id: 'org_chart', label: 'Org chart' }, { id: 'departments', label: 'Departments' }, { id: 'documents', label: 'Documents' }, { id: 'assets', label: 'Equipment' }] },
  { id: 'time', label: 'Time', tabs: [{ id: 'attendance', label: 'Attendance' }, { id: 'leave', label: 'Leave' }] },
  { id: 'pay', label: 'Pay', tabs: [{ id: 'payroll', label: 'Payroll' }, { id: 'salary_advances', label: 'Salary advances' }] },
  { id: 'growth', label: 'Growth', tabs: [{ id: 'performance', label: 'Performance' }, { id: 'training', label: 'Training' }, { id: 'recruitment', label: 'Recruitment' }] },
  { id: 'reports', label: 'Reports', tabs: [{ id: 'reports', label: 'Reports' }] },
]
const STAFF_TAB_LABELS: Partial<Record<HRTab, string>> = { self_service: 'My portal', leave: 'My leave', salary_advances: 'Salary advance', payroll: 'Payslips' }




// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function HR() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <HRContent />
    </Suspense>
  )
}

function HRContent() {
  const mounted = useMounted()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const {
    users,
    currentUserId,
    payrollRuns,
    payslips,
    employeeAssetAssignments,
    showToast,
    systemSettings,
  } = useApp()

  const {
    departments,
    employees,
    leaveRequests,
    hrDocuments,
    addEmployee,
    updateEmployee,
  } = useHrStore()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin = userCan(currentUser, 'manageHR')
  const canManageHR = userCan(currentUser, 'viewHrRecords')
  const normalizeUserText = (value?: string | null) => (value ?? '').trim().toLowerCase()
  const currentUsername = normalizeUserText(currentUser?.username)
  const userMatchesEmployee = (employee: typeof employees[number]) => {
    if (!currentUser) return false
    const employeeEmailUser = normalizeUserText(employee.email?.split('@')[0])
    return employee.userId === currentUser.id ||
      normalizeUserText(employee.fullName) === normalizeUserText(currentUser.name) ||
      (!!employeeEmailUser && employeeEmailUser === currentUsername) ||
      normalizeUserText(employee.employeeNo) === currentUsername
  }

  const myEmployee = employees.find(userMatchesEmployee) ?? null
  // Employees carry their department's name (see /api/employees); older screens kept ids.
  const departmentName = (value?: string) => (value ? departments.find(d => d.id === value || d.name === value)?.name ?? value : '')
  const myDepartmentName = departmentName(myEmployee?.departmentId)
  const myPayslips = payslips.filter(p => p.employeeId === myEmployee?.id && p.status === 'published')
  const myAssets = employeeAssetAssignments.filter(
    a => a.employeeId === myEmployee?.id && a.status === 'assigned'
  )

  const leaveOn = systemSettings?.hrLeaves !== false
  const allowedTabs = useMemo<HRTab[]>(
    () => (canManageHR ? [...MANAGEMENT_TABS, ...SELF_SERVICE_TABS] : SELF_SERVICE_TABS).filter(t => leaveOn || t !== 'leave'),
    [canManageHR, leaveOn],
  )
  const defaultTab: HRTab = canManageHR ? 'employees' : 'self_service'
  const queryTab = searchParams.get('tab') as HRTab | null
  const initialTab = queryTab && allowedTabs.includes(queryTab) ? queryTab : defaultTab

  const [tab, setLocalTab] = useState<HRTab>(initialTab)
  const visibleGroups = TAB_GROUPS
    .map(g => ({ ...g, tabs: g.tabs.filter(t => allowedTabs.includes(t.id)) }))
    .filter(g => g.tabs.length > 0)
  const activeGroup = visibleGroups.find(g => g.tabs.some(t => t.id === tab)) ?? visibleGroups[0]

  const setTab = (newTab: HRTab) => {
    if (!allowedTabs.includes(newTab)) {
      newTab = defaultTab
    }
    setLocalTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  // Follow the URL, not the local tab. Depending on `tab` here made the effect
  // run right after a click, while the URL still held the old tab, and snap the
  // selection back before the navigation landed (a visible flicker).
  useEffect(() => {
    const urlTab = searchParams.get('tab') as HRTab | null
    const safeTab = urlTab && allowedTabs.includes(urlTab) ? urlTab : defaultTab
    setLocalTab(current => (current === safeTab ? current : safeTab))
    if (urlTab && safeTab !== urlTab) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', safeTab)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
  }, [searchParams, defaultTab, allowedTabs, router, pathname])

  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [empSearch, setEmpSearchValue] = useUrlUiState('employeeQ', '')
  const [empPageValue, setEmpPageValue] = useUrlUiState('employeePage', '1')
  const empPage = Math.max(1, Number.parseInt(empPageValue, 10) || 1)
  const setEmpSearch = (value: string) => setEmpSearchValue(value, { queryPatch: { employeePage: null } })
  const setEmpPage = (page: number) => setEmpPageValue(String(Math.max(1, page)))
  const [viewEmpId, setViewEmpId] = useUrlRecordId({ param: 'emp' })
  const [editEmpId, setEditEmpId] = useState<string | null>(null)

  // The department list HR edits (People → Departments); the employee's own one stays listed even if switched off.
  const [deptNames, setDeptNames] = useState<string[]>([])
  const loadDepartments = async () => {
    try {
      const r = await fetch('/api/departments', { cache: 'no-store' })
      const d = await r.json()
      if (Array.isArray(d.departments)) setDeptNames(d.departments.filter((x: { active: boolean }) => x.active).map((x: { name: string }) => x.name))
    } catch { /* keep what is shown */ }
  }
  useEffect(() => { void loadDepartments() }, [])

  type EmpFormState = {
    fullName: string; employeeNo: string; email: string; workEmail: string; phone: string
    nationalId: string; kraPin: string; nssfNumber: string; gender: string; departmentId: string; jobTitle: string
    shift: string; startDate: string; status: 'active' | 'on_leave' | 'exited'
    basicSalary: string; housingAllowance: string; transportAllowance: string; bankName: string; bankAccount: string; paymentMode: string; mpesaNumber: string; managerEmployeeId: string
  }
  const blankEmp = (): EmpFormState => ({
    fullName: '', employeeNo: '', email: '', workEmail: '', phone: '', nationalId: '',
    kraPin: '', nssfNumber: '', gender: '', departmentId: '', jobTitle: '',
    shift: '', startDate: '',
    status: 'active', basicSalary: '', housingAllowance: '',
    transportAllowance: '', bankName: '', bankAccount: '', paymentMode: 'mpesa', mpesaNumber: '', managerEmployeeId: '',
  })
  // ── Shared saving flag ─────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)

  const [empForm, setEmpForm] = useState<EmpFormState>(blankEmp)
  // Monthly salary or a daily rate (kept with attendance, see /api/attendance/pay-basis).
  const canSetPayBasis = userCan(currentUser, 'managePayroll')
  const [payBasis, setPayBasis] = useState<{ basis: 'monthly' | 'daily'; rate: string; loaded: { basis: 'monthly' | 'daily'; rate: number } }>({ basis: 'monthly', rate: '', loaded: { basis: 'monthly', rate: 0 } })
  const loadPayBasis = async (employeeId: string | null) => {
    const none = { basis: 'monthly' as const, rate: '', loaded: { basis: 'monthly' as const, rate: 0 } }
    setPayBasis(none)
    if (!employeeId || !canSetPayBasis) return
    try {
      const res = await fetch('/api/attendance/pay-basis', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      const row = Array.isArray(data.payBasis) ? data.payBasis.find((r: { employeeId: string }) => r.employeeId === employeeId) : null
      if (row) setPayBasis({ basis: row.basis, rate: row.dailyRate ? String(row.dailyRate) : '', loaded: { basis: row.basis, rate: Number(row.dailyRate) || 0 } })
    } catch { /* keep monthly */ }
  }
  /** Save the pay type when it changed. Returns false (and says why) when it could not be saved. */
  const savePayBasis = async (employeeId: string): Promise<boolean> => {
    if (!canSetPayBasis) return true
    const rate = Number(payBasis.rate) || 0
    if (payBasis.basis === payBasis.loaded.basis && (payBasis.basis === 'monthly' || rate === payBasis.loaded.rate)) return true
    try {
      const res = await fetch('/api/attendance/pay-basis', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId, basis: payBasis.basis, dailyRate: rate }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save how they are paid')
      return true
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save how they are paid', 'error')
      return false
    }
  }
  const setEF = (k: keyof EmpFormState) => (v: string) => setEmpForm(p => ({ ...p, [k]: v }))

  /** The employee form as the add / update calls expect it. */
  const employeePayload = () => ({
      fullName: empForm.fullName.trim(),
      employeeNo: empForm.employeeNo.trim(),
      email: empForm.email.trim(),
      workEmail: empForm.workEmail.trim(),
      phone: empForm.phone.trim(),
      nationalId: empForm.nationalId.trim(),
      kraPin: empForm.kraPin.trim(),
      nssfNumber: empForm.nssfNumber.trim(),
      gender: empForm.gender as 'male' | 'female' | '',
      departmentId: empForm.departmentId,
      jobTitle: empForm.jobTitle.trim(),
      shift: empForm.shift.trim(),
      startDate: empForm.startDate,
      status: empForm.status,
      basicSalary: Number(empForm.basicSalary) || 0,
      housingAllowance: Number(empForm.housingAllowance) || 0,
      transportAllowance: Number(empForm.transportAllowance) || 0,
      bankName: empForm.bankName.trim(),
      bankAccount: empForm.bankAccount.trim(),
      paymentMode: empForm.paymentMode as 'bank' | 'mpesa' | 'cash',
      mpesaNumber: empForm.mpesaNumber.trim(),
      managerEmployeeId: empForm.managerEmployeeId || undefined,
  })

  const handleAddEmployee = async () => {
    if (!empForm.fullName.trim() || !empForm.employeeNo.trim()) {
      showToast('Full name and employee number are required', 'error')
      return
    }
    const missingEmp: string[] = []
    if (!empForm.departmentId) missingEmp.push('Department')
    if (!empForm.startDate) missingEmp.push('Start Date')
    if (payBasis.basis === 'daily' && !(Number(payBasis.rate) > 0)) missingEmp.push('Daily rate')
    if (missingEmp.length) {
      showToast(`Please fill in: ${missingEmp.join(', ')}`, 'error')
      return
    }
    if (saving) return
    setSaving(true)
    try {
      const saved = await addEmployee(employeePayload())
      await savePayBasis(saved.id)
      setShowEmployeeModal(false)
      setEmpForm(blankEmp())
    } catch {
      // addEmployee already displays the server error and rolls back the optimistic row.
    } finally { setSaving(false) }
  }

  const handleUpdateEmployee = async () => {
    if (!editEmpId) return
    if (!empForm.fullName.trim() || !empForm.employeeNo.trim()) {
      showToast('Full name and employee number are required', 'error')
      return
    }
    if (!empForm.departmentId) {
      showToast('Department is required', 'error')
      return
    }
    if (payBasis.basis === 'daily' && !(Number(payBasis.rate) > 0)) {
      showToast('Enter the daily rate', 'error')
      return
    }
    if (saving) return
    setSaving(true)
    try {
      if (!(await savePayBasis(editEmpId))) return
      await updateEmployee(editEmpId, employeePayload())
      setEditEmpId(null)
      setViewEmpId(null)
      setEmpForm(blankEmp())
    } catch {
      // updateEmployee already displays the server error
    } finally { setSaving(false) }
  }

  const filteredEmployees = employees.filter(e => {
    const q = empSearch.toLowerCase()
    return !q || e.fullName.toLowerCase().includes(q) || e.employeeNo.toLowerCase().includes(q) || e.jobTitle.toLowerCase().includes(q)
  })

  const employeeColumns: ColumnDef<Employee>[] = [
    {
      key: 'employee', label: 'Employee', priority: 1, width: '1.4fr',
      render: e => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-[10px] shrink-0">
            {initials(e.fullName)}
          </div>
          <div>
            <p className="text-xs font-bold text-[var(--text-1)]">{e.fullName}</p>
            <p className="text-[10px] text-[var(--text-4)]">{e.employeeNo}</p>
          </div>
        </div>
      ),
      exportValue: e => e.fullName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '90px',
      render: e => e.status === 'active'
        ? <span className="text-[var(--text-4)]">—</span>
        : <Badge status="cancelled" label={e.status} />,
      // The export is a data file, not a screen: every row keeps its status.
      exportValue: e => e.status,
    },
    {
      key: 'department', label: 'Department', priority: 2, width: '150px',
      render: e => <span className="capitalize">{e.departmentId}</span>,
      exportValue: e => e.departmentId,
    },
    {
      key: 'jobTitle', label: 'Job title', priority: 2, width: '210px',
      render: e => e.jobTitle || <span className="text-[var(--text-4)]">—</span>,
      exportValue: e => e.jobTitle,
    },
    {
      key: 'startDate', label: 'Start date', priority: 3, width: '105px',
      render: e => <span className="whitespace-nowrap">{fmtDate(e.startDate)}</span>,
      exportValue: e => e.startDate,
    },
  ]

  const downloadPayslipPdf = (id: string) => {
    const payslip = payslips.find(p => p.id === id)
    if (!payslip) return
    const canDownload = isAdmin || (!!myEmployee && payslip.employeeId === myEmployee.id)
    if (!canDownload || payslip.status !== 'published') {
      showToast('You can only download your own published payslip', 'error')
      return
    }
    const emp  = employees.find(e => e.id === payslip.employeeId)
    const dept = departments.find(d => d.id === emp?.departmentId)
    downloadPdf(`Payslip-${payslip.ref.replaceAll('/', '-')}.pdf`, [
      { text: 'PAYSLIP', x: 40, y: 810, size: 16, bold: true },
      { text: `Ref: ${payslip.ref}`, x: 40, y: 790, size: 10 },
      { text: `Employee: ${payslip.employeeName}`, x: 40, y: 772, size: 10 },
      { text: `Employee No: ${emp?.employeeNo ?? 'N/A'}`, x: 40, y: 754, size: 10 },
      { text: `Department: ${dept?.name ?? 'N/A'}`, x: 40, y: 736, size: 10 },
      { text: `Job Title: ${emp?.jobTitle ?? 'N/A'}`, x: 40, y: 718, size: 10 },
      { text: `Pay Period: ${payslip.month}/${payslip.year}`, x: 40, y: 700, size: 10 },
      { text: '────────────────────────────', x: 40, y: 684, size: 10 },
      { text: `Gross Pay:   ${fmtKes(payslip.grossPay)}`, x: 40, y: 666, size: 10 },
      { text: `Deductions:  ${fmtKes(payslip.deductions)}`, x: 40, y: 648, size: 10 },
      { text: `Net Pay:     ${fmtKes(payslip.netPay)}`, x: 40, y: 630, size: 12, bold: true },
      { text: '────────────────────────────', x: 40, y: 614, size: 10 },
      { text: `Generated: ${fmtDate(payslip.generatedDate)}`, x: 40, y: 596, size: 9 },
    ])
  }

  const viewEmployee = employees.find(e => e.id === viewEmpId) ?? null

  if (!mounted) return <ModuleSkeleton />

  // What HR must act on. A group with nothing in it is left out, and the panel with it.
  const pendingLeave = leaveRequests.filter(req => req.status === 'pending_hr')
  const openPayroll = payrollRuns.filter(run => run.status !== 'posted')
  const onLeaveCount = employees.filter(e => e.status === 'on_leave').length
  const dayMs = 86400000
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  type AttentionItem = { id: string; title: string; sub: string; when: string; open?: () => void }
  const attention: Array<{ title: string; open: () => void; items: AttentionItem[] }> = [
    {
      title: 'Leave approvals', open: () => setTab('leave'),
      items: pendingLeave.slice(0, 3).map(req => ({ id: req.id, title: req.employeeName, sub: `${req.leaveType.replaceAll('_', ' ')} leave`, when: fmtDate(req.startDate) })),
    },
    {
      title: 'Asset acknowledgements', open: () => setTab('assets'),
      items: employeeAssetAssignments.filter(a => a.status === 'assigned').slice(0, 3).map(a => ({ id: a.id, title: a.employeeName, sub: a.productName, when: 'Pending' })),
    },
    {
      title: 'Payroll review', open: () => setTab('payroll'),
      items: openPayroll.slice(0, 2).map(run => ({ id: run.id, title: run.ref, sub: `${run.lines.length} employees`, when: run.status.replaceAll('_', ' ') })),
    },
    {
      title: 'Probation reviews', open: () => setTab('employees'),
      items: employees
        .filter(e => e.status === 'active' && e.probationEndDate)
        .map(e => ({ e, days: Math.round((new Date(`${e.probationEndDate}T00:00:00`).getTime() - todayStart) / dayMs) }))
        .filter(x => x.days <= 30 && x.days >= -14)
        .sort((a, b) => a.days - b.days)
        .slice(0, 3)
        .map(({ e, days }) => ({ id: e.id, title: e.fullName, sub: e.jobTitle || 'Probation', when: days < 0 ? `${-days}d overdue` : days === 0 ? 'Today' : `${days}d`, open: () => { setTab('employees'); setViewEmpId(e.id) } })),
    },
    {
      title: 'Documents to renew', open: () => setTab('documents'),
      items: hrDocuments
        .map(d => ({ d, x: documentExpiry(d.expiryDate) }))
        .filter(x => x.x.status !== 'active')
        .sort((a, b) => (a.x.daysLeft ?? 0) - (b.x.daysLeft ?? 0))
        .slice(0, 3)
        .map(({ d, x }) => ({ id: d.id, title: d.title, sub: employees.find(e => e.id === d.employeeId)?.fullName ?? '', when: x.status === 'expired' ? 'Expired' : `${x.daysLeft}d` })),
    },
  ].filter(group => group.items.length > 0)

  /** One-tap choices (pay type, payment method, gender, status). */
  const seg = <T extends string>(label: string, value: T, onChange: (v: T) => void, options: Array<[T, string]>) => (
    <div className="emp-form__seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-active' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  )

  /** Employee form, shared by the Add and Edit modals: grouped the way HR thinks about a person. */
  const employeeFormFields = (isNew: boolean) => (
    <div className="emp-form">
      <section className="emp-form__section">
        <h3>Person</h3>
        <div className="emp-form__grid">
          <Field label="Full name" required><Input value={empForm.fullName} onChange={setEF('fullName')} placeholder="e.g. Jane Wanjiku" /></Field>
          <Field label="Employee no." required><Input value={empForm.employeeNo} onChange={setEF('employeeNo')} placeholder="e.g. EMP-001" /></Field>
          <Field label="Phone"><Input value={empForm.phone} onChange={setEF('phone')} type="tel" placeholder="07xx xxx xxx" /></Field>
          <Field label="Gender">{seg('Gender', empForm.gender as '' | 'male' | 'female', setEF('gender'), [['female', 'Female'], ['male', 'Male'], ['', 'Not set']])}</Field>
          <Field label="Personal email"><Input type="email" value={empForm.email} onChange={setEF('email')} placeholder="jane@example.com" /></Field>
          <Field label="Work email"><Input type="email" value={empForm.workEmail} onChange={setEF('workEmail')} placeholder="jane@deedtechnologies.com" /></Field>
        </div>
      </section>

      <section className="emp-form__section">
        <h3>Job</h3>
        <div className="emp-form__grid">
          <Field label="Department" required>
            <Select value={empForm.departmentId} onChange={setEF('departmentId')} options={[...(isNew || !empForm.departmentId ? [{ value: '', label: 'Select department…' }] : []), ...[...new Set([...deptNames, ...(empForm.departmentId ? [empForm.departmentId] : [])])].map(n => ({ value: n, label: n }))]} />
          </Field>
          <Field label="Job title"><Input value={empForm.jobTitle} onChange={setEF('jobTitle')} placeholder="e.g. Senior Technician" /></Field>
          <Field label="Start date" required={isNew}>
            <input type="date" className="form-input" value={empForm.startDate} onChange={e => setEF('startDate')(e.target.value)} />
          </Field>
          <Field label="Reports to">
            <Select value={empForm.managerEmployeeId} onChange={setEF('managerEmployeeId')} options={[
              { value: '', label: 'No one (top of the chart)' },
              ...employees.filter(x => x.status !== 'exited' && x.id !== editEmpId).map(x => ({ value: x.id, label: `${x.fullName}${x.jobTitle ? ` · ${x.jobTitle}` : ''}` })),
            ]} />
          </Field>
          {!isNew && (
            <div className="emp-form__wide">
              <Field label="Status">{seg('Status', empForm.status, v => setEmpForm(p => ({ ...p, status: v })), [['active', 'Active'], ['on_leave', 'On leave'], ['exited', 'Exited']])}</Field>
            </div>
          )}
        </div>
      </section>

      <section className="emp-form__section">
        <h3>Pay</h3>
        {canSetPayBasis ? (
          <>
            {seg('How they are paid', payBasis.basis, v => setPayBasis(b => ({ ...b, basis: v })), [['monthly', 'Monthly salary'], ['daily', 'By the day']])}
            <p className="emp-form__hint">
              {payBasis.basis === 'daily'
                ? 'Payroll pays the approved attendance days of the month × the daily rate.'
                : 'Payroll pays the same basic salary every month.'}
            </p>
          </>
        ) : payBasis.basis === 'daily' ? <p className="emp-form__hint">Paid by the day ({fmtKes(Number(payBasis.rate) || 0)} a day).</p> : null}
        <div className="emp-form__grid emp-form__grid--3">
          {payBasis.basis === 'daily'
            ? <Field label="Daily rate (KES)" required><Input type="number" value={payBasis.rate} onChange={v => setPayBasis(b => ({ ...b, rate: String(v) }))} placeholder="e.g. 800" disabled={!canSetPayBasis} /></Field>
            : <Field label="Basic salary / month (KES)"><Input type="number" value={empForm.basicSalary} onChange={setEF('basicSalary')} placeholder="0" /></Field>}
          <Field label="Housing allowance"><Input type="number" value={empForm.housingAllowance} onChange={setEF('housingAllowance')} placeholder="0" /></Field>
          <Field label="Transport allowance"><Input type="number" value={empForm.transportAllowance} onChange={setEF('transportAllowance')} placeholder="0" /></Field>
        </div>
      </section>

      <section className="emp-form__section">
        <h3>Paid by</h3>
        {seg('Salary paid by', empForm.paymentMode as 'mpesa' | 'bank' | 'cash', setEF('paymentMode'), [['mpesa', 'M-Pesa'], ['bank', 'Bank'], ['cash', 'Cash']])}
        {empForm.paymentMode === 'mpesa' && (
          <div className="emp-form__grid">
            <Field label="M-Pesa number"><Input value={empForm.mpesaNumber} onChange={setEF('mpesaNumber')} type="tel" placeholder={empForm.phone || '07xx xxx xxx'} /></Field>
          </div>
        )}
        {empForm.paymentMode === 'bank' && (
          <div className="emp-form__grid">
            <Field label="Bank"><Input value={empForm.bankName} onChange={setEF('bankName')} placeholder="e.g. KCB Bank Kenya" /></Field>
            <Field label="Account number"><Input value={empForm.bankAccount} onChange={setEF('bankAccount')} placeholder="e.g. 1234567890" /></Field>
          </div>
        )}
      </section>

      <section className="emp-form__section">
        <h3>Statutory numbers</h3>
        <div className="emp-form__grid">
          <Field label="National ID"><Input value={empForm.nationalId} onChange={setEF('nationalId')} placeholder="ID number" /></Field>
          <Field label="KRA PIN"><Input value={empForm.kraPin} onChange={setEF('kraPin')} placeholder="e.g. A012345678B" /></Field>
          <Field label="NSSF number"><Input value={empForm.nssfNumber} onChange={setEF('nssfNumber')} placeholder="e.g. 123456789" /></Field>
          <Field label="SHIF number"><Input value={empForm.shift} onChange={setEF('shift')} placeholder="e.g. SHIF-12345678" /></Field>
        </div>
      </section>
    </div>
  )

  return (
    <div className="mod-page hr-workspace">
      <ModuleHeader
        title="Human resources"
        subtitle="People, leave and payroll operations"
        icon={<Fa icon={faUsers} />}
        count={employees.length}
        color="var(--navy)"
        primaryAction={isAdmin ? (
          <PrimaryActionButton
            icon={<Fa icon={faUserPlus} />}
            onClick={() => { setTab('employees'); void loadPayBasis(null); setShowEmployeeModal(true) }}
          >
            Add employee
          </PrimaryActionButton>
        ) : undefined}
        overflowActions={canManageHR ? (
          <SecondaryActionMenu
            actions={[
              { id: 'users', label: 'System users', onClick: () => router.push('/settings?tab=users') },
            ]}
          />
        ) : undefined}
      />

      {canManageHR ? (
        <>
          <TabBar
            tabs={visibleGroups.map(g => ({ id: g.id, label: g.label }))}
            active={activeGroup.id}
            onChange={id => { const g = visibleGroups.find(x => x.id === id); if (g) setTab(g.tabs[0].id) }}
            maxVisibleMobile={6}
            maxVisibleTablet={6}
            maxVisibleDesktop={6}
            ariaLabel="HR sections"
          />
          {activeGroup.tabs.length > 1 && (
            <nav className="hr-subnav" aria-label={`${activeGroup.label} sections`}>
              {activeGroup.tabs.map(t => (
                <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </nav>
          )}
        </>
      ) : (
        <TabBar
          tabs={allowedTabs.map(id => ({ id, label: STAFF_TAB_LABELS[id] ?? id }))}
          active={tab}
          onChange={id => setTab(id as HRTab)}
          maxVisibleMobile={4}
          maxVisibleTablet={6}
          maxVisibleDesktop={6}
          ariaLabel="HR sections"
        />
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="mod-body">
      <div className="hr-content-shell card overflow-hidden m-3 sm:m-4">
        {tab === 'employees' && canManageHR ? (
          <div className="hr-employees-view">
            <OperationalSummary
              items={[
                { id: 'active', label: 'active', value: employees.filter(e => e.status === 'active').length },
                ...(onLeaveCount > 0 ? [{ id: 'on-leave', label: 'on leave', value: onLeaveCount }] : []),
                ...(pendingLeave.length > 0 ? [{ id: 'leave', label: `leave request${pendingLeave.length === 1 ? '' : 's'} to approve`, value: pendingLeave.length, tone: 'warning' as const, onClick: () => setTab('leave') }] : []),
                ...(openPayroll.length > 0 ? [{ id: 'payroll', label: `payroll run${openPayroll.length === 1 ? '' : 's'} to review`, value: openPayroll.length, tone: 'warning' as const, onClick: () => setTab('payroll') }] : []),
              ]}
            />
            <div className={attention.length > 0 ? 'hr-employees-grid' : undefined}>
              <section className="hr-directory card overflow-hidden">
            <DataTable
              tableId="hr_employees"
              columns={employeeColumns}
              rows={filteredEmployees}
              rowKey={e => e.id}
              searchValue={empSearch}
              onSearchChange={setEmpSearch}
              clientSearch={false}
              page={empPage}
              onPageChange={setEmpPage}
              searchPlaceholder="Search employees…"
              emptyMessage={employees.length === 0 ? 'No employees yet' : 'No employees match your search'}
              emptyAction={employees.length === 0 ? <button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => { void loadPayBasis(null); setShowEmployeeModal(true) }}>+ Add Employee</button> : undefined}
              onRowClick={e => setViewEmpId(e.id)}
              rowActions={e => (
                <button className="p-1.5 text-[var(--text-4)] hover:text-primary-600 transition-colors" onClick={ev => { ev.stopPropagation(); setViewEmpId(e.id) }}>
                  <Fa icon={faEye} />
                </button>
              )}
              renderCard={e => (
                <div
                  key={e.id}
                  className="rounded-xl border border-[var(--border-lt)] p-4 cursor-pointer hover:bg-[var(--bg-surface)] transition-colors"
                  onClick={() => setViewEmpId(e.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xs flex-shrink-0">
                        {e.fullName.slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[var(--text-1)] truncate">{e.fullName}</p>
                        <p className="text-[10px] text-[var(--text-4)]">{e.employeeNo} · {e.jobTitle}</p>
                      </div>
                    </div>
                    <Badge status={e.status === 'active' ? 'active' : 'cancelled'} label={e.status} />
                  </div>
                </div>
              )}
              exportTitle="Employees"
              exportFilename="employees"
            />
              </section>
              {attention.length > 0 && (
                <aside className="hr-attention card" aria-label="HR needs attention">
                  <div className="hr-attention__title">Needs attention</div>
                  {attention.map(group => (
                    <section key={group.title}>
                      <header><strong>{group.title}</strong><button type="button" onClick={group.open}>View all</button></header>
                      {group.items.map(item => (
                        <button key={item.id} type="button" className="hr-attention__item" onClick={item.open ?? group.open}>
                          <span><strong>{item.title}</strong><small>{item.sub}</small></span>
                          <span>{item.when}</span>
                        </button>
                      ))}
                    </section>
                  ))}
                </aside>
              )}
            </div>
          </div>
        ) : tab === 'attendance' && canManageHR ? (
          <HRAttendanceTab />
        ) : tab === 'leave' ? (
          <HRLeaveTab />
        ) : tab === 'salary_advances' ? (
          <HRSalaryAdvanceTab />
        ) : tab === 'payroll' ? (
          <HRPayrollTab />
        ) : tab === 'recruitment' && canManageHR ? (
          <HRRecruitmentTab />
        ) : tab === 'org_chart' && canManageHR ? (
          <HROrgChart />
        ) : tab === 'training' && canManageHR ? (
          <HRTrainingTab />
        ) : tab === 'documents' && canManageHR ? (
          <HRDocumentsTab />
        ) : tab === 'performance' && canManageHR ? (
          <HRPerformanceTab />
        ) : tab === 'reports' && canManageHR ? (
          <HRReportsTab />
        ) : tab === 'assets' ? (
          <HRAssetsTab />
        ) : tab === 'departments' && canManageHR ? (
          <HRDepartments canManage={isAdmin} showToast={showToast} onChanged={() => void loadDepartments()} />
        ) : tab === 'self_service' ? (
          <HRMyPortal
            name={currentUser?.name ?? ''}
            employee={myEmployee}
            department={myDepartmentName}
            payslips={myPayslips}
            assets={myAssets.map(a => ({ id: a.id, productName: a.productName, serial: (a as { serialNumber?: string }).serialNumber }))}
            attendanceOn={!!systemSettings?.hrAttendance}
            leaveOn={leaveOn}
            onRequestLeave={() => setTab('leave')}
            onSalaryAdvance={() => setTab('salary_advances')}
            onPayslips={() => setTab('payroll')}
            downloadPayslip={id => void downloadPayslipPdf(id)}
            showToast={showToast}
          />
        ) : (
          <div className="p-20 text-center">
            <p className="text-sm text-[var(--text-4)]">This section is coming soon</p>
          </div>
        )}
      </div>

      {/* ── Add Employee Modal ── */}
      {showEmployeeModal && (
        <Modal
          title="Add employee"
          variant="enterprise"
          onClose={() => { setShowEmployeeModal(false); setEmpForm(blankEmp()) }}
          width={680}
          footer={(
            <>
              <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => { setShowEmployeeModal(false); setEmpForm(blankEmp()) }}>Cancel</button>
              <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={handleAddEmployee} disabled={saving}>{saving ? 'Saving…' : 'Add employee'}</button>
            </>
          )}
        >
          {employeeFormFields(true)}
        </Modal>
      )}

      {/* ── View Employee Modal ── */}
      {viewEmployee && (
        <Modal 
          title={editEmpId === viewEmployee.id ? `Edit ${viewEmployee.fullName}` : "Employee Details"} 
          variant={editEmpId === viewEmployee.id ? 'enterprise' : 'default'}
          onClose={() => { setViewEmpId(null); setEditEmpId(null); setEmpForm(blankEmp()) }} 
          width={editEmpId === viewEmployee.id ? 680 : 520}
          footer={editEmpId === viewEmployee.id ? (
            <>
              <button type="button" className="btn-outline min-h-11 px-5 text-sm" onClick={() => { setEditEmpId(null); setEmpForm(blankEmp()) }}>Cancel</button>
              <button type="button" className="btn-primary min-h-11 px-5 text-sm" onClick={handleUpdateEmployee} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </>
          ) : undefined}
        >
          <div className="hr-employee-detail flex flex-col gap-4">
            {editEmpId === viewEmployee.id ? (
              // Edit Mode
              <>
                {employeeFormFields(false)}
              </>
            ) : (
              // View Mode
              <>
                <div className="hr-employee-profile__hero flex items-center gap-4 pb-3 border-b border-[var(--border-lt)]">
                  <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xl">
                    {viewEmployee.fullName.slice(0, 1)}
                  </div>
                  <div>
                    <p className="text-base font-bold text-[var(--text-1)]">{viewEmployee.fullName}</p>
                    <p className="text-xs text-[var(--text-3)]">{viewEmployee.jobTitle}</p>
                    <p className="text-xs text-[var(--text-4)]">{viewEmployee.employeeNo}</p>
                  </div>
                </div>
                <HREmployeeSummary employee={viewEmployee} documents={hrDocuments} canSeePay={canSetPayBasis} />
                <div className="hr-employee-profile__facts grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div><span className="text-[var(--text-4)]">Department</span><p className="font-semibold">{departmentName(viewEmployee.departmentId) || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Status</span><p className="font-semibold capitalize">{viewEmployee.status}</p></div>
                  <div><span className="text-[var(--text-4)]">Work email</span><p className="font-semibold">{viewEmployee.workEmail || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Personal email</span><p className="font-semibold">{viewEmployee.email || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Phone</span><p className="font-semibold">{viewEmployee.phone || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">National ID</span><p className="font-semibold">{viewEmployee.nationalId || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">KRA PIN</span><p className="font-semibold">{viewEmployee.kraPin || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">NSSF Number</span><p className="font-semibold">{viewEmployee.nssfNumber || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">SHIF Number</span><p className="font-semibold">{viewEmployee.shift || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Start Date</span><p className="font-semibold">{fmtDate(viewEmployee.startDate)}</p></div>
                  <div><span className="text-[var(--text-4)]">Bank Name</span><p className="font-semibold">{viewEmployee.bankName || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Bank Account Number</span><p className="font-semibold">{viewEmployee.bankAccount || '—'}</p></div>
                </div>
                <EmployeeLifecyclePanel key={viewEmployee.id} employee={viewEmployee} canManage={canManageHR} />
                <div className="hr-employee-profile__actions flex gap-3 justify-end pt-2">
                  <button className="btn-secondary px-6" onClick={() => setViewEmpId(null)}>Close</button>
                  <button className="btn-primary px-6 flex items-center gap-2" onClick={() => { setEmpForm({ fullName: viewEmployee.fullName, employeeNo: viewEmployee.employeeNo, email: viewEmployee.email || '', workEmail: viewEmployee.workEmail || '', phone: viewEmployee.phone || '', nationalId: viewEmployee.nationalId || '', kraPin: viewEmployee.kraPin || '', nssfNumber: viewEmployee.nssfNumber || '', gender: viewEmployee.gender || '', departmentId: viewEmployee.departmentId || '', jobTitle: viewEmployee.jobTitle || '', shift: viewEmployee.shift || '', startDate: viewEmployee.startDate, status: viewEmployee.status as any, basicSalary: String(viewEmployee.basicSalary), housingAllowance: String(viewEmployee.housingAllowance ?? 0), transportAllowance: String(viewEmployee.transportAllowance ?? 0), bankName: viewEmployee.bankName || '', bankAccount: viewEmployee.bankAccount || '', paymentMode: viewEmployee.paymentMode || 'mpesa', mpesaNumber: viewEmployee.mpesaNumber || '', managerEmployeeId: viewEmployee.managerEmployeeId || '' }); setEditEmpId(viewEmployee.id); void loadPayBasis(viewEmployee.id) }}>
                    <Fa icon={faPen} />
                    <span>Edit</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      </div>{/* mod-body */}
      {pendingConfirm && (
        <Confirm
          message={pendingConfirm.msg}
          onConfirm={() => { pendingConfirm.action(); setPendingConfirm(null) }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  )
}
