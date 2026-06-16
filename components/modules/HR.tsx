'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  faUsers,
  faCalendarMinus,
  faMoneyBillWave,
  faFolderOpen,
  faLaptop,
  faCircleUser,
  faChartBar,
  faUserPlus,
  faCalendarPlus,
  faPlus,
  faCheck,
  faXmark,
  faDownload,
  faPrint,
  faTriangleExclamation,
  faCircleCheck,
  faCircleXmark,
  faMoneyBill,
  faFileLines,
  faBoxesStacked,
  faBuilding,
  faPen,
  faTrash,
  faEye,
  faCalendarDays,
  faCalendarCheck,
  faUserTie,
  faChartSimple,
  faArrowTrendUp,
  faEnvelope,
  faPhone,
  faLink,
  faGraduationCap,
  faCircleExclamation,
  faIdCard,
  faBuildingColumns,
  faGear,
  faFileSignature,
  faChartLine,
  faChevronDown,
  faChevronUp,
  faBoxOpen,
} from '@fortawesome/free-solid-svg-icons'

import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { downloadPdf, printPdf } from '@/lib/pdf'
import { calculatePayroll } from '@/lib/payroll'
import HRLeaveTab from './hr/HRLeaveTab'
import HRPayrollTab from './hr/HRPayrollTab'
import HRRecruitmentTab from './hr/HRRecruitmentTab'
import HRAssetsTab from './hr/HRAssetsTab'
import HRSalaryAdvanceTab from './hr/HRSalaryAdvanceTab'
import {
  Badge,
  Confirm,
  Field,
  Input,
  Modal,
  PanelHeader,
  Select,
  StatCard,
  Table,
  Textarea,
  ModuleSkeleton,
  useMounted,
  TabContent,
  TabBar,
} from '@/components/ui'
import { SOPCategory, HRSOP, PerfStatus, PerfPeriod, PerformanceTarget } from '@/lib/store'
import { MODULE_IDS, USER_ROLES, ROLE_DEFAULT_MODULES } from '@/lib/auth/types'
import { formatRoleLabel } from '@/lib/auth/access'
import { Fa } from '@/components/icons'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

type HRTab =
  | 'employees'
  | 'recruitment'
  | 'training'
  | 'leave'
  | 'payroll'
  | 'salary_advances'
  | 'documents'
  | 'assets'
  | 'self_service'
  | 'sops'
  | 'reports'
  | 'system_users'

const SOP_CATEGORIES: {
  id: SOPCategory
  label: string
  color: string
  bg: string
  border: string
}[] = [
  { id: 'recruitment', label: 'Recruitment', color: '#1D4ED8', bg: '#DBEAFE', border: '#BFDBFE' },
  { id: 'onboarding', label: 'Onboarding', color: '#065F46', bg: '#D1FAE5', border: '#A7F3D0' },
  { id: 'leave', label: 'Leave', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  { id: 'payroll', label: 'Payroll', color: '#5B21B6', bg: '#EDE9FE', border: '#DDD6FE' },
  { id: 'offboarding', label: 'Offboarding', color: '#9F1239', bg: '#FFE4E6', border: '#FECDD3' },
  { id: 'conduct', label: 'Conduct', color: '#0E7490', bg: '#CFFAFE', border: '#A5F3FC' },
  { id: 'general', label: 'General', color: '#374151', bg: '#F3F4F6', border: '#E5E7EB' },
]

const PERF_STATUS: Record<
  PerfStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  on_track: { label: 'On Track', color: '#065F46', bg: '#D1FAE5', border: '#A7F3D0' },
  at_risk: { label: 'At Risk', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  achieved: { label: 'Achieved', color: '#1D4ED8', bg: '#DBEAFE', border: '#BFDBFE' },
  missed: { label: 'Missed', color: '#9F1239', bg: '#FFE4E6', border: '#FECDD3' },
}

const uid = () => crypto.randomUUID()

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
    departments,
    employees,
    contracts,
    leaveBalances,
    leaveRequests,
    hrDocuments,
    workflowApprovals,
    payrollRuns,
    payslips,
    journalEntries,
    employeeAssetAssignments,
    products,
    serials,
    repairs,
    saleOrders,
    kilimallOrders,
    expenses,
    addEmployee,
    updateEmployee,
    addLeaveRequest,
    decideLeaveRequest,
    createPayrollRun,
    approvePayrollRun,
    postPayrollRun,
    assignAssetToEmployee,
    acknowledgeEmployeeAsset,
    returnEmployeeAsset,
    reassignEmployeeAsset,
    addHRDocument,
    createUser,
    updateUser,
    deleteUser,
    deactivateUser,
    reactivateUser,
    systemSettings,
    showToast,
    jobPostings,
    candidates,
    trainingPrograms,
    employeeTrainings,
    addJobPosting,
    updateJobPosting,
    addCandidate,
    updateCandidate,
    addTrainingProgram,
    enrollEmployeeTraining,
    updateTrainingStatus,
    hrSops: sops,
    saveHrSops: saveSops,
    hrPerfTargets: targets,
    saveHrPerfTargets: saveTargets,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin = currentUser?.role === 'director'
  const isFinance = currentUser?.role === 'finance_officer'
  const canManageHR = isAdmin || isFinance
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
  const myDepartment = departments.find(d => d.id === myEmployee?.departmentId)
  const myLeaves = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const myPayslips = payslips.filter(p => p.employeeId === myEmployee?.id && p.status === 'published')
  const myAssets = employeeAssetAssignments.filter(
    a => a.employeeId === myEmployee?.id && a.status === 'assigned'
  )

  const managementTabs: HRTab[] = ['employees', 'recruitment', 'system_users']
  const selfServiceTabs: HRTab[] = ['self_service', 'leave', 'salary_advances', 'payroll', 'assets']
  const allowedTabs: HRTab[] = canManageHR ? [...managementTabs, ...selfServiceTabs] : selfServiceTabs
  const defaultTab: HRTab = canManageHR ? 'employees' : 'self_service'
  const queryTab = searchParams.get('tab') as HRTab | null
  const initialTab = queryTab && allowedTabs.includes(queryTab) ? queryTab : defaultTab

  const [tab, setLocalTab] = useState<HRTab>(initialTab)

  const setTab = (newTab: HRTab) => {
    if (!allowedTabs.includes(newTab)) {
      newTab = defaultTab
    }
    setLocalTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlTab = searchParams.get('tab') as HRTab | null
    const safeTab = urlTab && allowedTabs.includes(urlTab) ? urlTab : defaultTab
    if (safeTab !== tab) {
      setLocalTab(safeTab)
      if (urlTab && safeTab !== urlTab) {
        const params = new URLSearchParams(searchParams.toString())
        params.set('tab', safeTab)
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      }
    }
  }, [searchParams, tab, defaultTab, allowedTabs, router, pathname])

  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [empSearch, setEmpSearch] = useState('')
  const [viewEmpId, setViewEmpId] = useState<string | null>(null)
  const [editEmpId, setEditEmpId] = useState<string | null>(null)

  const DEPARTMENTS = [
    { value: 'HR', label: 'HR' },
    { value: 'Sales', label: 'Sales' },
    { value: 'Marketing', label: 'Marketing' },
    { value: 'Finance', label: 'Finance' },
    { value: 'Engineering', label: 'Engineering' },
    { value: 'Logistics & Supply Chain Management', label: 'Logistics & Supply Chain Management' },
    { value: 'Strategy & R&D', label: 'Strategy & R&D' },
    { value: 'Administration', label: 'Administration' },
    { value: 'Circular Computing Centre', label: 'Circular Computing Centre' },
    { value: 'Managed IT Services', label: 'Managed IT Services' },
    { value: 'AI & Automation', label: 'AI & Automation' },
    { value: 'Training & Certification', label: 'Training & Certification' },
    { value: 'ESG & Sustainability', label: 'ESG & Sustainability' },
    { value: 'Investor Relations & Capital Raising', label: 'Investor Relations & Capital Raising' },
    { value: 'Regional Expansion / New Markets', label: 'Regional Expansion / New Markets' },
    { value: 'Deed Foundation', label: 'Deed Foundation' },
  ]

  type EmpFormState = {
    fullName: string; employeeNo: string; email: string; phone: string
    nationalId: string; kraPin: string; nssfNumber: string; departmentId: string; jobTitle: string
    shift: string; startDate: string; status: 'active' | 'on_leave' | 'exited'
    basicSalary: string; housingAllowance: string; transportAllowance: string; bankName: string; bankAccount: string
  }
  const blankEmp = (): EmpFormState => ({
    fullName: '', employeeNo: '', email: '', phone: '', nationalId: '',
    kraPin: '', nssfNumber: '', departmentId: DEPARTMENTS[0].value, jobTitle: '',
    shift: '', startDate: new Date().toISOString().slice(0, 10),
    status: 'active', basicSalary: '', housingAllowance: '',
    transportAllowance: '', bankName: '', bankAccount: '',
  })
  // ── Shared saving flag ─────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)

  // ── System Users state ──────────────────────────────────────────────────────
  const [showUserModal, setShowUserModal] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [editUserId, setEditUserId] = useState<string | null>(null)
  const blankUserForm = () => ({ name: '', username: '', email: '', role: 'sales_rep' as import('@/lib/auth/types').UserRole, password: '', modules: [] as import('@/lib/auth/types').ModuleId[] })
  const [userForm, setUserForm] = useState(blankUserForm)
  const setUF = (k: string) => (v: string) => setUserForm(p => ({ ...p, [k]: v }))
  const handleSaveUser = async () => {
    if (!userForm.name.trim() || !userForm.username.trim()) {
      showToast('Name and username are required', 'error')
      return
    }
    if (saving) return
    setSaving(true)
    try {
      if (editUserId) {
        await updateUser(editUserId, { name: userForm.name, username: userForm.username, email: userForm.email || undefined, role: userForm.role, modules: userForm.modules.length ? userForm.modules : ROLE_DEFAULT_MODULES[userForm.role], ...(userForm.password ? { password: userForm.password } : {}) })
      } else {
        if (!userForm.password.trim()) { showToast('Password is required for new users', 'error'); return }
        await createUser({ name: userForm.name, username: userForm.username, email: userForm.email || undefined, role: userForm.role, modules: userForm.modules.length ? userForm.modules : ROLE_DEFAULT_MODULES[userForm.role], password: userForm.password, mustChangePassword: true })
      }
      setShowUserModal(false); setEditUserId(null); setUserForm(blankUserForm())
    } catch {
    } finally { setSaving(false) }
  }
  const [empForm, setEmpForm] = useState<EmpFormState>(blankEmp)
  const setEF = (k: keyof EmpFormState) => (v: string) => setEmpForm(p => ({ ...p, [k]: v }))

  const handleAddEmployee = async () => {
    if (!empForm.fullName.trim() || !empForm.employeeNo.trim()) {
      showToast('Full name and employee number are required', 'error')
      return
    }
    if (!empForm.departmentId) {
      showToast('Department is required', 'error')
      return
    }
    if (saving) return
    setSaving(true)
    try {
      await addEmployee({
        fullName: empForm.fullName.trim(),
        employeeNo: empForm.employeeNo.trim(),
        email: empForm.email.trim(),
        phone: empForm.phone.trim(),
        nationalId: empForm.nationalId.trim(),
        kraPin: empForm.kraPin.trim(),
        nssfNumber: empForm.nssfNumber.trim(),
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
      })
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
    if (saving) return
    setSaving(true)
    try {
      await updateEmployee(editEmpId, {
        fullName: empForm.fullName.trim(),
        employeeNo: empForm.employeeNo.trim(),
        email: empForm.email.trim(),
        phone: empForm.phone.trim(),
        nationalId: empForm.nationalId.trim(),
        kraPin: empForm.kraPin.trim(),
        nssfNumber: empForm.nssfNumber.trim(),
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
      })
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

  const [empPage, setEmpPage] = useState(1)
  const EMP_PAGE_SIZE = 50
  const empTotalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMP_PAGE_SIZE))
  const paginatedEmployees = filteredEmployees.slice((empPage - 1) * EMP_PAGE_SIZE, empPage * EMP_PAGE_SIZE)

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

  return (
    <div className="mod-page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#0891B215', color: '#0891B2' }}>
            <Fa icon={faUsers} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-extrabold text-text-1">Human Resources</h1>
              <span className="badge badge-gray text-[9px]">{employees.length}</span>
            </div>
            <p className="text-[10px] text-text-3 mt-0.5">Employees, payroll &amp; leave</p>
          </div>
        </div>
        {isAdmin && (
          <button onClick={() => { setTab('employees'); setShowEmployeeModal(true) }} className="btn-primary flex items-center gap-2 flex-shrink-0">
            <Fa icon={faUserPlus} />
            <span className="hidden sm:inline">Add Employee</span>
          </button>
        )}
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 stat-grid-4 border-b border-border-lt bg-surface">
        {canManageHR ? (<>
          <StatCard label="Total Employees" value={employees.length} sub="Active staff members" color="#0891B2" icon={<Fa icon={faUsers} />} />
          <StatCard label="On Leave" value={leaveRequests.filter(r => r.status === 'approved').length} sub="Currently out of office" color="#F59E0B" icon={<Fa icon={faCalendarMinus} />} />
          <StatCard label="Payroll" value={fmtKes(payrollRuns.reduce((a, r) => a + r.totalNet, 0))} sub="Total net pay" color="#10B981" icon={<Fa icon={faMoneyBillWave} />} />
          <StatCard label="Open Jobs" value={jobPostings.filter(j => j.status === 'open').length} sub="Active recruitments" color="#8B5CF6" icon={<Fa icon={faUserTie} />} />
        </>) : (<>
          <StatCard label="My Leave" value={myLeaves.length} sub="your leave requests" color="#F59E0B" icon={<Fa icon={faCalendarMinus} />} />
          <StatCard label="My Payslips" value={myPayslips.length} sub="published for you" color="#10B981" icon={<Fa icon={faMoneyBillWave} />} />
          <StatCard label="My Assets" value={myAssets.length} sub="assigned to you" color="#0891B2" icon={<Fa icon={faBoxOpen} />} />
          <StatCard label="My Profile" value={myEmployee ? 'Linked' : 'Not linked'} sub="employee record" color="#8B5CF6" icon={<Fa icon={faCircleUser} />} />
        </>)}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="mod-tabs">
        {[
          { id: 'employees', label: 'Employees', icon: faUsers },
          { id: 'leave', label: 'Leave', icon: faCalendarMinus },
          { id: 'salary_advances', label: 'Salary Advance', icon: faMoneyBill },
          { id: 'payroll', label: 'Payroll', icon: faMoneyBillWave },
          { id: 'recruitment', label: 'Recruitment', icon: faUserTie },
          { id: 'assets', label: 'Assets', icon: faBoxOpen },
          { id: 'system_users', label: 'System Users', icon: faGear },
          { id: 'self_service', label: 'My Portal', icon: faCircleUser },
        ].filter(t => allowedTabs.includes(t.id as HRTab)).map(t => (
          <button key={t.id} onClick={() => setTab(t.id as HRTab)} className={`mod-tab ${tab === t.id ? 'active' : ''}`}>
            <Fa icon={t.icon} className="mr-1.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="mod-body">
      <div className="card overflow-hidden m-3 sm:m-4">
        {tab === 'employees' && canManageHR ? (
          <div className="flex flex-col">
            <div className="p-4 border-b border-[var(--border-lt)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  placeholder="Search employees..."
                  className="form-input pl-9"
                  value={empSearch}
                  onChange={e => { setEmpSearch(e.target.value); setEmpPage(1) }}
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]">
                  🔍
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                      Employee
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                      Department
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                      Job Title
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                      Status
                    </th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-14 text-center">
                        {employees.length === 0 ? (
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center">
                              <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-[var(--text-2)]">No employees yet</p>
                              <p className="text-[11px] text-[var(--text-4)] mt-0.5">Add your first employee to get started</p>
                            </div>
                            <button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => setShowEmployeeModal(true)}>+ Add Employee</button>
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--text-4)]">No employees match your search</p>
                        )}
                      </td>
                    </tr>
                  )}
                  {paginatedEmployees.map(e => (
                    <tr key={e.id} className="hover:bg-[var(--bg-surface)] transition-colors cursor-pointer" onClick={() => setViewEmpId(e.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xs">
                            {e.fullName.slice(0, 1)}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-[var(--text-1)]">{e.fullName}</p>
                            <p className="text-[10px] text-[var(--text-4)]">{e.employeeNo}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-2)]">
                        <span className="capitalize">{e.departmentId}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-2)]">{e.jobTitle}</td>
                      <td className="px-4 py-3">
                        <Badge
                          status={e.status === 'active' ? 'active' : 'cancelled'}
                          label={e.status}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="p-1.5 text-[var(--text-4)] hover:text-primary-600 transition-colors" onClick={ev => { ev.stopPropagation(); setViewEmpId(e.id) }}>
                          <Fa icon={faEye} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {empTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-lt)] text-xs text-[var(--text-3)]">
                <span>{filteredEmployees.length} employees · page {empPage} of {empTotalPages}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEmpPage(p => Math.max(1, p - 1))} disabled={empPage === 1}
                    className="px-2.5 py-1 rounded border border-[var(--border-lt)] disabled:opacity-40 hover:bg-[var(--bg-surface)] transition-colors">‹ Prev</button>
                  {Array.from({ length: Math.min(5, empTotalPages) }, (_, i) => {
                    const p = empTotalPages <= 5 ? i + 1 : Math.max(1, Math.min(empPage - 2, empTotalPages - 4)) + i
                    return (
                      <button key={p} onClick={() => setEmpPage(p)}
                        className={`px-2.5 py-1 rounded border transition-colors ${p === empPage ? 'bg-primary-600 text-white border-primary-600' : 'border-[var(--border-lt)] hover:bg-[var(--bg-surface)]'}`}>
                        {p}
                      </button>
                    )
                  })}
                  <button onClick={() => setEmpPage(p => Math.min(empTotalPages, p + 1))} disabled={empPage === empTotalPages}
                    className="px-2.5 py-1 rounded border border-[var(--border-lt)] disabled:opacity-40 hover:bg-[var(--bg-surface)] transition-colors">Next ›</button>
                </div>
              </div>
            )}
          </div>
        ) : tab === 'leave' ? (
          <HRLeaveTab />
        ) : tab === 'salary_advances' ? (
          <HRSalaryAdvanceTab />
        ) : tab === 'payroll' ? (
          <HRPayrollTab />
        ) : tab === 'recruitment' && canManageHR ? (
          <HRRecruitmentTab />
        ) : tab === 'assets' ? (
          <HRAssetsTab />
        ) : tab === 'system_users' && canManageHR ? (
          <div className="flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-[var(--border-lt)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <input type="text" placeholder="Search users..." className="form-input pl-9" value={userSearch} onChange={e => setUserSearch(e.target.value)} />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]">🔍</div>
              </div>
              <button className="btn-primary flex items-center gap-2 whitespace-nowrap" onClick={() => { setEditUserId(null); setUserForm(blankUserForm()); setShowUserModal(true) }}>
                <Fa icon={faPlus} /><span>Add User</span>
              </button>
            </div>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Name</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Username</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Role</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Status</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.filter(u => !userSearch || u.name?.toLowerCase().includes(userSearch.toLowerCase()) || u.username.toLowerCase().includes(userSearch.toLowerCase())).map(u => (
                    <tr key={u.id} className="border-b border-[var(--border-lt)] hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--text-1)]">{u.name}</td>
                      <td className="px-4 py-3 text-[var(--text-3)] text-sm font-mono">{u.username}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-500/10 text-primary-600">{formatRoleLabel(u.role)}</span>
                      </td>
                      <td className="px-4 py-3">
                        {(u as any).active !== false
                          ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700"><Fa icon={faCircleCheck} />Active</span>
                          : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600"><Fa icon={faCircleXmark} />Inactive</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button title="Edit" className="p-1.5 text-[var(--text-4)] hover:text-primary-600 transition-colors" onClick={() => { setEditUserId(u.id); setUserForm({ name: u.name || '', username: u.username, email: (u as any).email || '', role: u.role, password: '', modules: [...u.modules] }); setShowUserModal(true) }}>
                            <Fa icon={faPen} />
                          </button>
                          {(u as any).active !== false
                            ? <button title="Deactivate" className="p-1.5 text-[var(--text-4)] hover:text-amber-600 transition-colors" onClick={() => setPendingConfirm({ msg: `Deactivate ${u.name}? They will not be able to log in.`, action: () => deactivateUser(u.id) })}>
                                <Fa icon={faCircleXmark} />
                              </button>
                            : <button title="Reactivate" className="p-1.5 text-[var(--text-4)] hover:text-green-600 transition-colors" onClick={() => reactivateUser(u.id)}>
                                <Fa icon={faCircleCheck} />
                              </button>
                          }
                          {u.id !== currentUserId && <button title="Delete" className="p-1.5 text-[var(--text-4)] hover:text-red-600 transition-colors" onClick={() => setPendingConfirm({ msg: `Permanently delete ${u.name}? This cannot be undone.`, action: () => deleteUser(u.id) })}>
                            <Fa icon={faTrash} />
                          </button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Add/Edit User Modal */}
            {showUserModal && (
              <Modal title={editUserId ? 'Edit User' : 'Add System User'} onClose={() => { setShowUserModal(false); setEditUserId(null); setUserForm(blankUserForm()) }} width={480}>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Full Name" required><Input value={userForm.name} onChange={setUF('name')} placeholder="e.g. Jane Wanjiku" /></Field>
                    <Field label="Username" required><Input value={userForm.username} onChange={setUF('username')} placeholder="e.g. jane.wanjiku" /></Field>
                  </div>
                  <Field label="Email"><Input type="email" value={userForm.email} onChange={setUF('email')} placeholder="jane@deed.africa" /></Field>
                  <Field label="Role" required>
                    <Select value={userForm.role} onChange={setUF('role')} options={USER_ROLES.map(r => ({ value: r, label: formatRoleLabel(r) }))} />
                  </Field>
                  <Field label={editUserId ? 'New Password (leave blank to keep)' : 'Temporary Password'} required={!editUserId}>
                    <Input type="password" value={userForm.password} onChange={setUF('password')} placeholder={editUserId ? 'Leave blank to keep current' : 'Set a temporary password'} />
                  </Field>
                  <div className="flex gap-3 justify-end pt-2">
                    <button className="btn-secondary px-6" onClick={() => { setShowUserModal(false); setEditUserId(null); setUserForm(blankUserForm()) }}>Cancel</button>
                    <button className="btn-primary px-8" onClick={handleSaveUser} disabled={saving}>{saving ? 'Saving…' : editUserId ? 'Save Changes' : 'Create User'}</button>
                  </div>
                </div>
              </Modal>
            )}
          </div>
        ) : tab === 'self_service' ? (
          <div className="p-6 flex flex-col gap-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-primary-500/10 flex items-center justify-center text-primary-600 text-2xl font-bold border border-primary-500/20">
                  {currentUser?.name?.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-1)]">{currentUser?.name}</h2>
                  <p className="text-xs text-[var(--text-3)]">
                    {myEmployee?.jobTitle} · {myDepartment?.name}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-primary flex items-center gap-2" onClick={() => setTab('leave')}>
                  <Fa icon={faCalendarPlus} />
                  <span>Request Leave</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
                <h3 className="text-sm font-bold text-[var(--text-1)] mb-4">Leave Balance</h3>
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-3)]">Annual Leave</span>
                    <span className="font-bold">12 / 21 days</span>
                  </div>
                  <div className="h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full" style={{ width: '60%' }} />
                  </div>
                </div>
              </div>
              <div className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
                <h3 className="text-sm font-bold text-[var(--text-1)] mb-4">Recent Payslips</h3>
                <div className="flex flex-col gap-2">
                  {myPayslips.slice(0, 3).map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-2)]">{p.month} {p.year}</span>
                      <button className="text-primary-600 hover:underline" onClick={() => downloadPayslipPdf(p.id)}>Download</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
                <h3 className="text-sm font-bold text-[var(--text-1)] mb-4">My Assets</h3>
                <div className="flex flex-col gap-2">
                  {myAssets.length > 0 ? (
                    myAssets.map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <Fa icon={faLaptop} className="text-[var(--text-4)]" />
                        <span className="text-[var(--text-2)]">{a.productName}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-[var(--text-4)]">No assets assigned</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-20 text-center">
            <p className="text-sm text-[var(--text-4)]">This section is coming soon</p>
          </div>
        )}
      </div>

      {/* ── Add Employee Modal ── */}
      {showEmployeeModal && (
        <Modal
          title="Add Employee"
          onClose={() => { setShowEmployeeModal(false); setEmpForm(blankEmp()) }}
          width={580}
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" required>
                <Input value={empForm.fullName} onChange={setEF('fullName')} placeholder="e.g. Jane Wanjiku" />
              </Field>
              <Field label="Employee No." required>
                <Input value={empForm.employeeNo} onChange={setEF('employeeNo')} placeholder="e.g. EMP-001" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Email">
                <Input type="email" value={empForm.email} onChange={setEF('email')} placeholder="jane@example.com" />
              </Field>
              <Field label="Phone">
                <Input value={empForm.phone} onChange={setEF('phone')} placeholder="+254 7xx xxx xxx" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="National ID">
                <Input value={empForm.nationalId} onChange={setEF('nationalId')} placeholder="National ID number" />
              </Field>
              <Field label="KRA PIN">
                <Input value={empForm.kraPin} onChange={setEF('kraPin')} placeholder="e.g. A012345678B" />
              </Field>
              <Field label="NSSF Number">
                <Input value={empForm.nssfNumber} onChange={setEF('nssfNumber')} placeholder="e.g. 123456789" />
              </Field>
              <Field label="SHIF Number">
                <Input value={empForm.shift} onChange={setEF('shift')} placeholder="e.g. SHIF-12345678" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Department" required>
                <Select
                  value={empForm.departmentId}
                  onChange={setEF('departmentId')}
                  options={DEPARTMENTS}
                />
              </Field>
              <Field label="Job Title">
                <Input value={empForm.jobTitle} onChange={setEF('jobTitle')} placeholder="e.g. Senior Technician" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Start Date">
                <input type="date" className="form-input" value={empForm.startDate} onChange={e => setEF('startDate')(e.target.value)} />
              </Field>
              <Field label="Status">
                <Select
                  value={empForm.status}
                  onChange={setEF('status')}
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'on_leave', label: 'On Leave' },
                    { value: 'exited', label: 'Exited' },
                  ]}
                />
              </Field>
            </div>
            <div className="pt-2 border-t border-[var(--border-lt)]">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-3">Compensation</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Basic Salary (KES)">
                  <Input type="number" value={empForm.basicSalary} onChange={setEF('basicSalary')} placeholder="0" />
                </Field>
                <Field label="Housing Allowance">
                  <Input type="number" value={empForm.housingAllowance} onChange={setEF('housingAllowance')} placeholder="0" />
                </Field>
                <Field label="Transport Allowance">
                  <Input type="number" value={empForm.transportAllowance} onChange={setEF('transportAllowance')} placeholder="0" />
                </Field>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Bank Name">
                <Input value={empForm.bankName} onChange={setEF('bankName')} placeholder="e.g. KCB Bank Kenya" />
              </Field>
              <Field label="Bank Account Number">
                <Input value={empForm.bankAccount} onChange={setEF('bankAccount')} placeholder="e.g. 1234567890" />
              </Field>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button className="btn-secondary px-6" onClick={() => { setShowEmployeeModal(false); setEmpForm(blankEmp()) }}>Cancel</button>
              <button className="btn-primary px-8" onClick={handleAddEmployee} disabled={saving}>{saving ? 'Saving…' : 'Save Employee'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── View Employee Modal ── */}
      {viewEmployee && (
        <Modal 
          title={editEmpId === viewEmployee.id ? "Edit Employee" : "Employee Details"} 
          onClose={() => { setViewEmpId(null); setEditEmpId(null); setEmpForm(blankEmp()) }} 
          width={editEmpId === viewEmployee.id ? 580 : 520}
        >
          <div className="flex flex-col gap-4">
            {editEmpId === viewEmployee.id ? (
              // Edit Mode
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Full Name" required>
                    <Input value={empForm.fullName} onChange={setEF('fullName')} placeholder="e.g. Jane Wanjiku" />
                  </Field>
                  <Field label="Employee No." required>
                    <Input value={empForm.employeeNo} onChange={setEF('employeeNo')} placeholder="e.g. EMP-001" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Email">
                    <Input type="email" value={empForm.email} onChange={setEF('email')} placeholder="jane@example.com" />
                  </Field>
                  <Field label="Phone">
                    <Input value={empForm.phone} onChange={setEF('phone')} placeholder="+254 7xx xxx xxx" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="National ID">
                    <Input value={empForm.nationalId} onChange={setEF('nationalId')} placeholder="National ID number" />
                  </Field>
                  <Field label="KRA PIN">
                    <Input value={empForm.kraPin} onChange={setEF('kraPin')} placeholder="e.g. A012345678B" />
                  </Field>
                  <Field label="NSSF Number">
                    <Input value={empForm.nssfNumber} onChange={setEF('nssfNumber')} placeholder="e.g. 123456789" />
                  </Field>
                  <Field label="SHIF Number">
                    <Input value={empForm.shift} onChange={setEF('shift')} placeholder="e.g. SHIF-12345678" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Department" required>
                    <Select
                      value={empForm.departmentId}
                      onChange={setEF('departmentId')}
                      options={DEPARTMENTS}
                    />
                  </Field>
                  <Field label="Job Title">
                    <Input value={empForm.jobTitle} onChange={setEF('jobTitle')} placeholder="e.g. Senior Technician" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Start Date">
                    <input type="date" className="form-input" value={empForm.startDate} onChange={e => setEF('startDate')(e.target.value)} />
                  </Field>
                  <Field label="Status">
                    <Select
                      value={empForm.status}
                      onChange={setEF('status')}
                      options={[
                        { value: 'active', label: 'Active' },
                        { value: 'on_leave', label: 'On Leave' },
                        { value: 'exited', label: 'Exited' },
                      ]}
                    />
                  </Field>
                </div>
                <div className="pt-2 border-t border-[var(--border-lt)]">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-4)] mb-3">Compensation</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field label="Basic Salary (KES)">
                      <Input type="number" value={empForm.basicSalary} onChange={setEF('basicSalary')} placeholder="0" />
                    </Field>
                    <Field label="Housing Allowance">
                      <Input type="number" value={empForm.housingAllowance} onChange={setEF('housingAllowance')} placeholder="0" />
                    </Field>
                    <Field label="Transport Allowance">
                      <Input type="number" value={empForm.transportAllowance} onChange={setEF('transportAllowance')} placeholder="0" />
                    </Field>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Bank Name">
                    <Input value={empForm.bankName} onChange={setEF('bankName')} placeholder="e.g. KCB Bank Kenya" />
                  </Field>
                  <Field label="Bank Account Number">
                    <Input value={empForm.bankAccount} onChange={setEF('bankAccount')} placeholder="e.g. 1234567890" />
                  </Field>
                </div>
                <div className="flex gap-3 justify-end pt-2">
                  <button className="btn-secondary px-6" onClick={() => { setEditEmpId(null); setEmpForm(blankEmp()) }}>Cancel</button>
                  <button className="btn-primary px-8" onClick={handleUpdateEmployee} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
                </div>
              </>
            ) : (
              // View Mode
              <>
                <div className="flex items-center gap-4 pb-3 border-b border-[var(--border-lt)]">
                  <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xl">
                    {viewEmployee.fullName.slice(0, 1)}
                  </div>
                  <div>
                    <p className="text-base font-bold text-[var(--text-1)]">{viewEmployee.fullName}</p>
                    <p className="text-xs text-[var(--text-3)]">{viewEmployee.jobTitle}</p>
                    <p className="text-xs text-[var(--text-4)]">{viewEmployee.employeeNo}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div><span className="text-[var(--text-4)]">Department</span><p className="font-semibold capitalize">{viewEmployee.departmentId || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Status</span><p className="font-semibold capitalize">{viewEmployee.status}</p></div>
                  <div><span className="text-[var(--text-4)]">Email</span><p className="font-semibold">{viewEmployee.email || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Phone</span><p className="font-semibold">{viewEmployee.phone || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">National ID</span><p className="font-semibold">{viewEmployee.nationalId || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">KRA PIN</span><p className="font-semibold">{viewEmployee.kraPin || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">NSSF Number</span><p className="font-semibold">{viewEmployee.nssfNumber || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">SHIF Number</span><p className="font-semibold">{viewEmployee.shift || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Start Date</span><p className="font-semibold">{fmtDate(viewEmployee.startDate)}</p></div>
                  <div><span className="text-[var(--text-4)]">Bank Name</span><p className="font-semibold">{viewEmployee.bankName || '—'}</p></div>
                  <div><span className="text-[var(--text-4)]">Bank Account Number</span><p className="font-semibold">{viewEmployee.bankAccount || '—'}</p></div>
                </div>
                <div className="flex gap-3 justify-end pt-2">
                  <button className="btn-secondary px-6" onClick={() => setViewEmpId(null)}>Close</button>
                  <button className="btn-primary px-6 flex items-center gap-2" onClick={() => { setEmpForm({ fullName: viewEmployee.fullName, employeeNo: viewEmployee.employeeNo, email: viewEmployee.email || '', phone: viewEmployee.phone || '', nationalId: viewEmployee.nationalId || '', kraPin: viewEmployee.kraPin || '', nssfNumber: viewEmployee.nssfNumber || '', departmentId: viewEmployee.departmentId || '', jobTitle: viewEmployee.jobTitle || '', shift: viewEmployee.shift || '', startDate: viewEmployee.startDate, status: viewEmployee.status as any, basicSalary: String(viewEmployee.basicSalary), housingAllowance: String(viewEmployee.housingAllowance ?? 0), transportAllowance: String(viewEmployee.transportAllowance ?? 0), bankName: viewEmployee.bankName || '', bankAccount: viewEmployee.bankAccount || '' }); setEditEmpId(viewEmployee.id) }}>
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
