'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  faUsers,
  faFolderOpen,
  faLaptop,
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
  faBoxesStacked,
  faBuilding,
  faPen,
  faTrash,
  faEye,
  faCalendarDays,
  faCalendarCheck,
  faChartSimple,
  faEnvelope,
  faPhone,
  faLink,
  faCircleExclamation,
  faIdCard,
  faBuildingColumns,
  faFileSignature,
  faChartLine,
  faChevronDown,
  faChevronUp,
} from '@fortawesome/free-solid-svg-icons'

import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { useUrlRecordId, useUrlUiState } from '@/hooks/useUrlRecordId'
import { downloadPdf, printPdf } from '@/lib/pdf'
import { calculatePayroll } from '@/lib/payroll'
import HRLeaveTab from './hr/HRLeaveTab'
import HRPayrollTab from './hr/HRPayrollTab'
import HRRecruitmentTab from './hr/HRRecruitmentTab'
import HRAssetsTab from './hr/HRAssetsTab'
import HRSalaryAdvanceTab from './hr/HRSalaryAdvanceTab'
import HRPerformanceTab from './hr/HRPerformanceTab'
import { HRTrainingTab, HRDocumentsTab, HRReportsTab } from './hr/HRExtraTabs'
import {
  Badge,
  Confirm,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  ModuleSkeleton,
  useMounted,
  TabContent,
  TabBar,
  ModuleHeader,
} from '@/components/ui'
import { PrimaryActionButton, SecondaryActionMenu } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { SOPCategory, HRSOP, PerfStatus, PerfPeriod, PerformanceTarget, type Employee } from '@/lib/store'
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
  | 'performance'
  | 'system_users'

const MANAGEMENT_TABS: HRTab[] = ['employees', 'recruitment', 'training', 'documents', 'performance', 'reports']
const SELF_SERVICE_TABS: HRTab[] = ['self_service', 'leave', 'salary_advances', 'payroll', 'assets']

const SOP_CATEGORIES: {
  id: SOPCategory
  label: string
  color: string
  bg: string
  border: string
}[] = [
  { id: 'recruitment', label: 'Recruitment', color: 'var(--primary-dark)', bg: 'var(--primary-light)', border: '#BFDBFE' },
  { id: 'onboarding', label: 'Onboarding', color: 'var(--success-text)', bg: 'var(--success-bg)', border: '#A7F3D0' },
  { id: 'leave', label: 'Leave', color: 'var(--warning-text)', bg: 'var(--warning-bg)', border: '#FDE68A' },
  { id: 'payroll', label: 'Payroll', color: '#5B21B6', bg: '#EDE9FE', border: '#DDD6FE' },
  { id: 'offboarding', label: 'Offboarding', color: '#9F1239', bg: '#FFE4E6', border: '#FECDD3' },
  { id: 'conduct', label: 'Conduct', color: '#0E7490', bg: '#CFFAFE', border: '#A5F3FC' },
  { id: 'general', label: 'General', color: 'var(--text-3)', bg: 'var(--bg-muted)', border: 'var(--border-lt)' },
]

const PERF_STATUS: Record<
  PerfStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  on_track: { label: 'On Track', color: 'var(--success-text)', bg: 'var(--success-bg)', border: '#A7F3D0' },
  at_risk: { label: 'At Risk', color: 'var(--warning-text)', bg: 'var(--warning-bg)', border: '#FDE68A' },
  achieved: { label: 'Achieved', color: 'var(--primary-dark)', bg: 'var(--primary-light)', border: '#BFDBFE' },
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
    contracts,
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
    createPayrollRun,
    approvePayrollRun,
    postPayrollRun,
    assignAssetToEmployee,
    acknowledgeEmployeeAsset,
    returnEmployeeAsset,
    reassignEmployeeAsset,
    systemSettings,
    showToast,
    hrSops: sops,
    saveHrSops: saveSops,
    hrPerfTargets: targets,
    saveHrPerfTargets: saveTargets,
  } = useApp()

  const {
    departments,
    employees,
    leaveBalances,
    leaveRequests,
    hrDocuments,
    jobPostings,
    candidates,
    trainingPrograms,
    employeeTrainings,
    addEmployee,
    updateEmployee,
    addLeaveRequest,
    decideLeaveRequest,
    addHRDocument,
    addJobPosting,
    updateJobPosting,
    addCandidate,
    updateCandidate,
    addTrainingProgram,
    enrollEmployeeTraining,
    updateTrainingStatus,
  } = useHrStore()

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

  const allowedTabs = useMemo<HRTab[]>(
    () => canManageHR ? [...MANAGEMENT_TABS, ...SELF_SERVICE_TABS] : SELF_SERVICE_TABS,
    [canManageHR],
  )
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
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
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
  const [empSearch, setEmpSearchValue] = useUrlUiState('employeeQ', '')
  const [empPageValue, setEmpPageValue] = useUrlUiState('employeePage', '1')
  const empPage = Math.max(1, Number.parseInt(empPageValue, 10) || 1)
  const setEmpSearch = (value: string) => setEmpSearchValue(value, { queryPatch: { employeePage: null } })
  const setEmpPage = (page: number) => setEmpPageValue(String(Math.max(1, page)))
  const [viewEmpId, setViewEmpId] = useUrlRecordId({ param: 'emp' })
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
    nationalId: string; kraPin: string; nssfNumber: string; gender: string; departmentId: string; jobTitle: string
    shift: string; startDate: string; status: 'active' | 'on_leave' | 'exited'
    basicSalary: string; housingAllowance: string; transportAllowance: string; bankName: string; bankAccount: string
  }
  const blankEmp = (): EmpFormState => ({
    fullName: '', employeeNo: '', email: '', phone: '', nationalId: '',
    kraPin: '', nssfNumber: '', gender: '', departmentId: '', jobTitle: '',
    shift: '', startDate: '',
    status: 'active', basicSalary: '', housingAllowance: '',
    transportAllowance: '', bankName: '', bankAccount: '',
  })
  // ── Shared saving flag ─────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)

  const [empForm, setEmpForm] = useState<EmpFormState>(blankEmp)
  const setEF = (k: keyof EmpFormState) => (v: string) => setEmpForm(p => ({ ...p, [k]: v }))

  const handleAddEmployee = async () => {
    if (!empForm.fullName.trim() || !empForm.employeeNo.trim()) {
      showToast('Full name and employee number are required', 'error')
      return
    }
    const missingEmp: string[] = []
    if (!empForm.departmentId) missingEmp.push('Department')
    if (!empForm.startDate) missingEmp.push('Start Date')
    if (missingEmp.length) {
      showToast(`Please fill in: ${missingEmp.join(', ')}`, 'error')
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

  // Distinct employees whose approved leave covers today — not the all-time
  // count of approved requests.
  const todayStr = new Date().toISOString().slice(0, 10)
  const onLeaveTodayCount = new Set(
    leaveRequests
      .filter(r => r.status === 'approved' && r.startDate <= todayStr && r.endDate >= todayStr)
      .map(r => r.employeeId),
  ).size

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
      key: 'jobTitle', label: 'Job title', priority: 2, width: '150px',
      render: e => e.jobTitle,
      exportValue: e => e.jobTitle,
    },
    {
      key: 'startDate', label: 'Start date', priority: 3, width: '105px',
      render: e => <span className="whitespace-nowrap">{fmtDate(e.startDate)}</span>,
      exportValue: e => e.startDate,
    },
    {
      key: 'nextAction', label: 'Next action', priority: 3, width: '115px',
      render: e => (
        <button type="button" className="hr-table-link" onClick={event => { event.stopPropagation(); setViewEmpId(e.id) }}>
          View profile
        </button>
      ),
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
            onClick={() => { setTab('employees'); setShowEmployeeModal(true) }}
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

      <TabBar
        tabs={[
          { id: 'self_service', label: 'My portal' },
          { id: 'salary_advances', label: 'Salary advance' },
          { id: 'employees', label: 'Employees' },
          { id: 'leave', label: 'Leave' },
          { id: 'payroll', label: 'Payroll' },
          { id: 'recruitment', label: 'Recruitment' },
          { id: 'training', label: 'Training' },
          { id: 'documents', label: 'Documents' },
          { id: 'performance', label: 'Performance' },
          { id: 'reports', label: 'Reports' },
          { id: 'assets', label: 'Assets' },
        ].filter(t => allowedTabs.includes(t.id as HRTab))}
        active={tab}
        onChange={id => setTab(id as HRTab)}
        maxVisibleMobile={4}
        maxVisibleTablet={6}
        maxVisibleDesktop={6}
        ariaLabel="HR sections"
      />

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="mod-body">
      <div className="hr-content-shell card overflow-hidden m-3 sm:m-4">
        {tab === 'employees' && canManageHR ? (
          <div className="hr-employees-view">
            <div className="hr-kpi-strip" aria-label="HR overview">
              <div className="hr-kpi-card">
                <span className="hr-kpi-icon"><Fa icon={faUsers} /></span>
                <span><small>Active employees</small><strong>{employees.filter(e => e.status === 'active').length}</strong></span>
              </div>
              <div className="hr-kpi-card">
                <span className="hr-kpi-icon"><Fa icon={faCalendarDays} /></span>
                <span><small>On leave</small><strong>{employees.filter(e => e.status === 'on_leave').length}</strong></span>
              </div>
              <div className="hr-kpi-card">
                <span className="hr-kpi-icon"><Fa icon={faCalendarCheck} /></span>
                <span><small>Leave requests</small><strong>{leaveRequests.filter(req => req.status === 'pending_hr').length}</strong></span>
              </div>
              <div className="hr-kpi-card">
                <span className="hr-kpi-icon"><Fa icon={faFileSignature} /></span>
                <span><small>Payroll to review</small><strong>{payrollRuns.filter(run => run.status !== 'posted').length}</strong></span>
              </div>
            </div>
            <div className="hr-employees-grid">
              <section className="hr-directory card overflow-hidden">
            <div className="hr-directory-toolbar p-4 border-b border-[var(--border-lt)]">
              <h2>Employee directory</h2>
            </div>
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
              </section>
              <aside className="hr-attention card" aria-label="HR needs attention">
                <div className="hr-attention__title">Needs attention</div>
                <section>
                  <header><strong>Leave approvals</strong><button type="button" onClick={() => setTab('leave')}>View all</button></header>
                  {leaveRequests.filter(req => req.status === 'pending_hr').slice(0, 3).map(req => (
                    <button key={req.id} type="button" className="hr-attention__item" onClick={() => setTab('leave')}>
                      <span><strong>{req.employeeName}</strong><small>{req.leaveType.replaceAll('_', ' ')} leave</small></span>
                      <span>{fmtDate(req.startDate)}</span>
                    </button>
                  ))}
                  {leaveRequests.every(req => req.status !== 'pending_hr') && <p className="hr-attention__empty">No leave approvals pending.</p>}
                </section>
                <section>
                  <header><strong>Asset acknowledgements</strong><button type="button" onClick={() => setTab('assets')}>View all</button></header>
                  {employeeAssetAssignments.filter(a => a.status === 'assigned').slice(0, 3).map(a => (
                    <button key={a.id} type="button" className="hr-attention__item" onClick={() => setTab('assets')}>
                      <span><strong>{a.employeeName}</strong><small>{a.productName}</small></span>
                      <span>Pending</span>
                    </button>
                  ))}
                  {employeeAssetAssignments.every(a => a.status !== 'assigned') && <p className="hr-attention__empty">No asset acknowledgements pending.</p>}
                </section>
                <section>
                  <header><strong>Payroll review</strong><button type="button" onClick={() => setTab('payroll')}>View all</button></header>
                  {payrollRuns.filter(run => run.status !== 'posted').slice(0, 2).map(run => (
                    <button key={run.id} type="button" className="hr-attention__item" onClick={() => setTab('payroll')}>
                      <span><strong>{run.ref}</strong><small>{run.lines.length} employees</small></span>
                      <span>{run.status.replaceAll('_', ' ')}</span>
                    </button>
                  ))}
                  {payrollRuns.every(run => run.status === 'posted') && <p className="hr-attention__empty">No payroll reviews pending.</p>}
                </section>
              </aside>
            </div>
          </div>
        ) : tab === 'leave' ? (
          <HRLeaveTab />
        ) : tab === 'salary_advances' ? (
          <HRSalaryAdvanceTab />
        ) : tab === 'payroll' ? (
          <HRPayrollTab />
        ) : tab === 'recruitment' && canManageHR ? (
          <HRRecruitmentTab />
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
        ) : tab === 'self_service' ? (
          <div className="hr-self-service p-6 flex flex-col gap-8">
            <div className="hr-self-service__hero flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="hr-self-service__identity flex items-center gap-4">
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
              <div className="hr-self-service__actions flex items-center gap-2">
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

            <div className="hr-self-service__grid grid grid-cols-1 md:grid-cols-3 gap-6">
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
              <Field label="Gender">
                <Select
                  value={empForm.gender}
                  onChange={setEF('gender')}
                  options={[
                    { value: '', label: 'Not specified' },
                    { value: 'male', label: 'Male' },
                    { value: 'female', label: 'Female' },
                  ]}
                />
              </Field>
              <Field label="Department" required>
                <Select
                  value={empForm.departmentId}
                  onChange={setEF('departmentId')}
                  options={[{ value: '', label: 'Select department…' }, ...DEPARTMENTS]}
                />
              </Field>
              <Field label="Job Title">
                <Input value={empForm.jobTitle} onChange={setEF('jobTitle')} placeholder="e.g. Senior Technician" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Start Date" required>
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
          <div className="hr-employee-detail flex flex-col gap-4">
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
                  <Field label="Gender">
                    <Select
                      value={empForm.gender}
                      onChange={setEF('gender')}
                      options={[
                        { value: '', label: 'Not specified' },
                        { value: 'male', label: 'Male' },
                        { value: 'female', label: 'Female' },
                      ]}
                    />
                  </Field>
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
                <div className="hr-employee-profile__facts grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
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
                <div className="hr-employee-profile__actions flex gap-3 justify-end pt-2">
                  <button className="btn-secondary px-6" onClick={() => setViewEmpId(null)}>Close</button>
                  <button className="btn-primary px-6 flex items-center gap-2" onClick={() => { setEmpForm({ fullName: viewEmployee.fullName, employeeNo: viewEmployee.employeeNo, email: viewEmployee.email || '', phone: viewEmployee.phone || '', nationalId: viewEmployee.nationalId || '', kraPin: viewEmployee.kraPin || '', nssfNumber: viewEmployee.nssfNumber || '', gender: viewEmployee.gender || '', departmentId: viewEmployee.departmentId || '', jobTitle: viewEmployee.jobTitle || '', shift: viewEmployee.shift || '', startDate: viewEmployee.startDate, status: viewEmployee.status as any, basicSalary: String(viewEmployee.basicSalary), housingAllowance: String(viewEmployee.housingAllowance ?? 0), transportAllowance: String(viewEmployee.transportAllowance ?? 0), bankName: viewEmployee.bankName || '', bankAccount: viewEmployee.bankAccount || '' }); setEditEmpId(viewEmployee.id) }}>
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
