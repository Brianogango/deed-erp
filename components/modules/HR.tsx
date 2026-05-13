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
} from '@fortawesome/free-solid-svg-icons'

import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { downloadPdf, printPdf } from '@/lib/pdf'
import { calculatePayroll } from '@/lib/payroll'
import HRLeaveTab from './hr/HRLeaveTab'
import HRPayrollTab from './hr/HRPayrollTab'
import {
  Badge,
  Field,
  Input,
  Modal,
  PanelHeader,
  Select,
  StatCard,
  Table,
  Textarea,
  ModuleSkeleton,
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
  | 'documents'
  | 'assets'
  | 'self_service'
  | 'sops'
  | 'performance'
  | 'reports'

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

const uid = () => Math.random().toString(36).slice(2, 9)

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
  const isAdmin = currentUser?.role === 'admin'
  const isFinance = currentUser?.role === 'finance'

  const myEmployee = employees.find(e => e.userId === currentUserId) ?? null
  const myDepartment = departments.find(d => d.id === myEmployee?.departmentId)
  const myLeaves = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const myPayslips = payslips.filter(p => p.employeeId === myEmployee?.id)
  const myAssets = employeeAssetAssignments.filter(
    a => a.employeeId === myEmployee?.id && a.status === 'assigned'
  )

  const defaultTab: HRTab = isAdmin ? 'employees' : 'self_service'
  const queryTab = searchParams.get('tab') as HRTab | null
  const initialTab = queryTab ?? defaultTab

  const [tab, setLocalTab] = useState<HRTab>(initialTab)

  const setTab = (newTab: HRTab) => {
    setLocalTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlTab = searchParams.get('tab') as HRTab | null
    if (urlTab && urlTab !== tab) {
      setLocalTab(urlTab)
    }
  }, [searchParams, tab])

  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [empSearch, setEmpSearch] = useState('')
  const [viewEmpId, setViewEmpId] = useState<string | null>(null)

  const SHIF_SCHEMES = [
    { value: 'SHIF-001', label: 'SHIF Standard' },
    { value: 'SHIF-002', label: 'SHIF Premium' },
    { value: 'SHIF-003', label: 'SHIF Executive' },
    { value: 'NONE', label: 'No Medical Scheme' },
  ]

  type EmpFormState = {
    fullName: string; employeeNo: string; email: string; phone: string
    nationalId: string; kraPin: string; nssfNumber: string; departmentId: string; jobTitle: string
    shift: string; startDate: string; status: 'active' | 'on_leave' | 'exited'
    basicSalary: string; housingAllowance: string; transportAllowance: string; bankName: string; bankAccount: string
  }
  const blankEmp = (): EmpFormState => ({
    fullName: '', employeeNo: '', email: '', phone: '', nationalId: '',
    kraPin: '', nssfNumber: '', departmentId: departments[0]?.id ?? '', jobTitle: '',
    shift: SHIF_SCHEMES[0].value, startDate: new Date().toISOString().slice(0, 10),
    status: 'active', basicSalary: '', housingAllowance: '',
    transportAllowance: '', bankName: '', bankAccount: '',
  })
  const [empForm, setEmpForm] = useState<EmpFormState>(blankEmp)
  const setEF = (k: keyof EmpFormState) => (v: string) => setEmpForm(p => ({ ...p, [k]: v }))

  const handleAddEmployee = () => {
    if (!empForm.fullName.trim() || !empForm.employeeNo.trim()) {
      showToast('Full name and employee number are required', 'error')
      return
    }
    if (!empForm.departmentId) {
      showToast('Department is required', 'error')
      return
    }
    addEmployee({
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
  }

  const filteredEmployees = employees.filter(e => {
    const q = empSearch.toLowerCase()
    return !q || e.fullName.toLowerCase().includes(q) || e.employeeNo.toLowerCase().includes(q) || e.jobTitle.toLowerCase().includes(q)
  })

  const downloadPayslipPdf = (id: string) => {
    const payslip = payslips.find(p => p.id === id)
    if (!payslip) return
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

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-[var(--text-1)]">Human Resources</h1>
          <p className="text-xs text-[var(--text-3)]">Manage employees, payroll, and leave</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
              <button
                onClick={() => { setTab('employees'); setShowEmployeeModal(true) }}
                className="flex-1 sm:flex-none btn-primary flex items-center justify-center gap-2"
              >
                <Fa icon={faUserPlus} />
                <span>Add Employee</span>
              </button>
          )}
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Employees"
          value={employees.length}
          sub="Active staff members"
          color="#0891B2"
          icon={<Fa icon={faUsers} />}
        />
        <StatCard
          label="On Leave"
          value={leaveRequests.filter(r => r.status === 'approved').length}
          sub="Currently out of office"
          color="#F59E0B"
          icon={<Fa icon={faCalendarMinus} />}
        />
        <StatCard
          label="Payroll"
          value={fmtKes(payrollRuns.reduce((a, r) => a + r.totalNet, 0))}
          sub="Total net pay this month"
          color="#10B981"
          icon={<Fa icon={faMoneyBillWave} />}
        />
        <StatCard
          label="Open Jobs"
          value={jobPostings.filter(j => j.status === 'open').length}
          sub="Active recruitments"
          color="#8B5CF6"
          icon={<Fa icon={faUserTie} />}
        />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {(
          [
            { id: 'employees', label: 'Employees', icon: faUsers },
            { id: 'leave', label: 'Leave', icon: faCalendarMinus },
            { id: 'payroll', label: 'Payroll', icon: faMoneyBillWave },
            { id: 'recruitment', label: 'Recruitment', icon: faUserTie },
            { id: 'performance', label: 'Performance', icon: faChartLine },
            { id: 'self_service', label: 'My Portal', icon: faCircleUser },
          ] as const
        ).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap
              ${
                tab === t.id
                  ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                  : 'bg-white text-[var(--text-3)] hover:bg-[var(--bg-surface)] border border-[var(--border-lt)]'
              }
            `}
          >
            <Fa icon={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {tab === 'employees' ? (
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
                  {filteredEmployees.map(e => (
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
                        {departments.find(d => d.id === e.departmentId)?.name}
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
          </div>
        ) : tab === 'leave' ? (
          <HRLeaveTab />
        ) : tab === 'payroll' ? (
          <HRPayrollTab />
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
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Department" required>
                <Select
                  value={empForm.departmentId}
                  onChange={setEF('departmentId')}
                  options={departments.length ? departments.map(d => ({ value: d.id, label: d.name })) : [{ value: '', label: 'No departments configured' }]}
                />
              </Field>
              <Field label="Job Title">
                <Input value={empForm.jobTitle} onChange={setEF('jobTitle')} placeholder="e.g. Senior Technician" />
              </Field>
              <Field label="SHIF (Medical Scheme)">
                <Select
                  value={empForm.shift}
                  onChange={setEF('shift')}
                  options={SHIF_SCHEMES}
                />
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
              <button className="btn-primary px-8" onClick={handleAddEmployee}>Save Employee</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── View Employee Modal ── */}
      {viewEmployee && (
        <Modal title="Employee Details" onClose={() => setViewEmpId(null)} width={520}>
          <div className="flex flex-col gap-4">
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
              <div><span className="text-[var(--text-4)]">Department</span><p className="font-semibold">{departments.find(d => d.id === viewEmployee.departmentId)?.name ?? '—'}</p></div>
              <div><span className="text-[var(--text-4)]">Status</span><p className="font-semibold capitalize">{viewEmployee.status}</p></div>
              <div><span className="text-[var(--text-4)]">Email</span><p className="font-semibold">{viewEmployee.email || '—'}</p></div>
              <div><span className="text-[var(--text-4)]">Phone</span><p className="font-semibold">{viewEmployee.phone || '—'}</p></div>
              <div><span className="text-[var(--text-4)]">National ID</span><p className="font-semibold">{viewEmployee.nationalId || '—'}</p></div>
              <div><span className="text-[var(--text-4)]">KRA PIN</span><p className="font-semibold">{viewEmployee.kraPin || '—'}</p></div>
              <div><span className="text-[var(--text-4)]">NSSF Number</span><p className="font-semibold">{viewEmployee.nssfNumber || '—'}</p></div>
              <div><span className="text-[var(--text-4)]">SHIF (Medical Scheme)</span><p className="font-semibold">{viewEmployee.shift || '—'}</p></div>
              <div><span className="text-[var(--text-4)]">Start Date</span><p className="font-semibold">{fmtDate(viewEmployee.startDate)}</p></div>
              <div><span className="text-[var(--text-4)]">Bank Name</span><p className="font-semibold">{viewEmployee.bankName || '—'}</p></div>
              <div><span className="text-[var(--text-4)]">Bank Account Number</span><p className="font-semibold">{viewEmployee.bankAccount || '—'}</p></div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button className="btn-secondary px-6" onClick={() => setViewEmpId(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
