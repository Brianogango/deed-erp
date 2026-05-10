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
              onClick={() => setShowEmployeeModal(true)}
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
                  {employees.map(e => (
                    <tr key={e.id} className="hover:bg-[var(--bg-surface)] transition-colors">
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
                        <button className="p-1.5 text-[var(--text-4)] hover:text-primary-600 transition-colors">
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
                <button className="btn-primary flex items-center gap-2">
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
                      <button className="text-primary-600 hover:underline">Download</button>
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
    </div>
  )
}
