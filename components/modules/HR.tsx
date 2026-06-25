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
  Textarea,
  ModuleSkeleton,
  useMounted,
  TabContent,
  TabBar,
} from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { SOPCategory, HRSOP, PerfStatus, PerfPeriod, PerformanceTarget, type Employee, type User } from '@/lib/store'
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

  const employeeColumns: ColumnDef<Employee>[] = [
    {
      key: 'employee', label: 'Employee', priority: 1, width: '1.4fr',
      render: e => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xs">
            {e.fullName.slice(0, 1)}
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
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: e => <Badge status={e.status === 'active' ? 'active' : 'cancelled'} label={e.status} />,
      exportValue: e => e.status,
    },
    {
      key: 'department', label: 'Department', priority: 2, width: '130px',
      render: e => <span className="capitalize">{e.departmentId}</span>,
      exportValue: e => e.departmentId,
    },
    {
      key: 'jobTitle', label: 'Job Title', priority: 3, width: '150px',
      render: e => e.jobTitle,
      exportValue: e => e.jobTitle,
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

  const userColumns: ColumnDef<User>[] = [
    {
      key: 'name', label: 'Name', priority: 1, width: '1.2fr',
      render: u => <span className="font-medium text-[var(--text-1)]">{u.name}</span>,
      exportValue: u => u.name,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: u => u.active !== false
        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700"><Fa icon={faCircleCheck} />Active</span>
        : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-600"><Fa icon={faCircleXmark} />Inactive</span>,
      exportValue: u => u.active !== false ? 'Active' : 'Inactive',
    },
    {
      key: 'username', label: 'Username', priority: 2, width: '140px',
      render: u => <span className="text-[var(--text-3)] text-sm font-mono">{u.username}</span>,
      exportValue: u => u.username,
    },
    {
      key: 'role', label: 'Role', priority: 2, width: '140px',
      render: u => <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-500/10 text-primary-600">{formatRoleLabel(u.role)}</span>,
      exportValue: u => formatRoleLabel(u.role),
    },
  ]

  function userRowActions(u: User) {
    return (
      <div className="flex items-center justify-end gap-1">
        <button title="Edit" className="p-1.5 text-[var(--text-4)] hover:text-primary-600 transition-colors" onClick={e => { e.stopPropagation(); setEditUserId(u.id); setUserForm({ name: u.name || '', username: u.username, email: u.email || '', role: u.role, password: '', modules: [...u.modules] }); setShowUserModal(true) }}>
          <Fa icon={faPen} />
        </button>
        {u.active !== false
          ? <button title="Deactivate" className="p-1.5 text-[var(--text-4)] hover:text-amber-600 transition-colors" onClick={e => { e.stopPropagation(); setPendingConfirm({ msg: `Deactivate ${u.name}? They will not be able to log in.`, action: () => deactivateUser(u.id) }) }}>
              <Fa icon={faCircleXmark} />
            </button>
          : <button title="Reactivate" className="p-1.5 text-[var(--text-4)] hover:text-green-600 transition-colors" onClick={e => { e.stopPropagation(); reactivateUser(u.id) }}>
              <Fa icon={faCircleCheck} />
            </button>
        }
        {u.id !== currentUserId && <button title="Delete" className="p-1.5 text-[var(--text-4)] hover:text-red-600 transition-colors" onClick={e => { e.stopPropagation(); setPendingConfirm({ msg: `Permanently delete ${u.name}? This cannot be undone.`, action: () => deleteUser(u.id) }) }}>
          <Fa icon={faTrash} />
        </button>}
      </div>
    )
  }

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
      <div className="px-4 py-3 kpi-grid-compact border-b border-border-lt bg-surface">
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
      <TabBar
        tabs={[
          { id: 'self_service', label: 'My Portal', icon: <Fa icon={faCircleUser} /> },
          { id: 'salary_advances', label: 'Salary Advance', icon: <Fa icon={faMoneyBill} /> },
          { id: 'employees', label: 'Employees', icon: <Fa icon={faUsers} /> },
          { id: 'leave', label: 'Leave', icon: <Fa icon={faCalendarMinus} /> },
          { id: 'payroll', label: 'Payroll', icon: <Fa icon={faMoneyBillWave} /> },
          { id: 'recruitment', label: 'Recruitment', icon: <Fa icon={faUserTie} /> },
          { id: 'assets', label: 'Assets', icon: <Fa icon={faBoxOpen} /> },
          { id: 'system_users', label: 'System Users', icon: <Fa icon={faGear} /> },
        ].filter(t => allowedTabs.includes(t.id as HRTab))}
        active={tab}
        onChange={id => setTab(id as HRTab)}
        maxVisibleMobile={4}
        maxVisibleTablet={6}
        maxVisibleDesktop={7}
      />

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
                  onChange={e => setEmpSearch(e.target.value)}
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]">
                  🔍
                </div>
              </div>
            </div>
            <DataTable
              tableId="hr_employees"
              columns={employeeColumns}
              rows={filteredEmployees}
              rowKey={e => e.id}
              hideSearch
              emptyMessage={employees.length === 0 ? 'No employees yet' : 'No employees match your search'}
              emptyAction={employees.length === 0 ? <button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => setShowEmployeeModal(true)}>+ Add Employee</button> : undefined}
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
            <DataTable
              tableId="hr_system_users"
              columns={userColumns}
              rows={users.filter(u => !userSearch || u.name?.toLowerCase().includes(userSearch.toLowerCase()) || u.username.toLowerCase().includes(userSearch.toLowerCase()))}
              rowKey={u => u.id}
              hideSearch
              emptyMessage="No system users match your search"
              rowActions={userRowActions}
              exportTitle="System Users"
              exportFilename="system-users"
            />
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
                <button className="btn-secondary flex items-center gap-2" onClick={() => setTab('salary_advances')}>
                  <Fa icon={faMoneyBill} />
                  <span>Salary Advance</span>
                </button>
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
              <button
                type="button"
                onClick={() => setTab('salary_advances')}
                className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)] text-left transition-all hover:shadow-lg active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-1)] mb-1">Salary Advance</h3>
                    <p className="text-xs text-[var(--text-3)] leading-relaxed">Apply for an advance and track approval, payout, and payroll deductions.</p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-600 flex items-center justify-center">
                    <Fa icon={faMoneyBill} />
                  </div>
                </div>
                <span className="btn-primary mt-4 text-[11px] inline-flex">Apply / View</span>
              </button>
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
