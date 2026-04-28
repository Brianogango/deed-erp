'use client'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { downloadPdf, printPdf } from '@/lib/pdf'
import { calculatePayroll } from '@/lib/payroll'
import { Badge, Field, Input, Modal, PanelHeader, Select, StatCard, Table, Textarea, ModuleSkeleton, TabContent, TabBar } from '@/components/ui'
import { SOPCategory, HRSOP, PerfStatus, PerfPeriod, PerformanceTarget } from '@/lib/store'
import { MODULE_IDS, USER_ROLES, ROLE_DEFAULT_MODULES } from '@/lib/auth/types'
import { formatRoleLabel } from '@/lib/auth/access'
import { Fa } from '@/components/icons'
import {
  faUsers, faCalendarMinus, faMoneyBillWave, faFolderOpen, faLaptop,
  faCircleUser, faChartBar, faUserPlus, faCalendarPlus, faPlus,
  faCheck, faXmark, faDownload, faPrint,
  faTriangleExclamation, faCircleCheck, faCircleXmark, faMoneyBill, faFileLines,
  faBoxesStacked, faBuilding, faPen, faTrash, faEye,
  faCalendarDays, faCalendarCheck, faUserTie,
  faChartSimple, faArrowTrendUp, faEnvelope, faPhone, faLink, faGraduationCap,
  faCircleExclamation, faIdCard, faBuildingColumns, faGear,
  faFileSignature, faChartLine, faChevronDown, faChevronUp,
} from '@fortawesome/free-solid-svg-icons'

type HRTab = 'employees' | 'recruitment' | 'training' | 'leave' | 'payroll' | 'documents' | 'assets' | 'self_service' | 'sops' | 'performance' | 'reports'

const SOP_CATEGORIES: { id: SOPCategory; label: string; color: string; bg: string; border: string }[] = [
  { id: 'recruitment',  label: 'Recruitment',  color: '#1D4ED8', bg: '#DBEAFE', border: '#BFDBFE' },
  { id: 'onboarding',   label: 'Onboarding',   color: '#065F46', bg: '#D1FAE5', border: '#A7F3D0' },
  { id: 'leave',        label: 'Leave',        color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  { id: 'payroll',      label: 'Payroll',      color: '#5B21B6', bg: '#EDE9FE', border: '#DDD6FE' },
  { id: 'offboarding',  label: 'Offboarding',  color: '#9F1239', bg: '#FFE4E6', border: '#FECDD3' },
  { id: 'conduct',      label: 'Conduct',      color: '#0E7490', bg: '#CFFAFE', border: '#A5F3FC' },
  { id: 'general',      label: 'General',      color: '#374151', bg: '#F3F4F6', border: '#E5E7EB' },
]

const PERF_STATUS: Record<PerfStatus, { label: string; color: string; bg: string; border: string }> = {
  on_track: { label: 'On Track',  color: '#065F46', bg: '#D1FAE5', border: '#A7F3D0' },
  at_risk:  { label: 'At Risk',   color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  achieved: { label: 'Achieved',  color: '#1D4ED8', bg: '#DBEAFE', border: '#BFDBFE' },
  missed:   { label: 'Missed',    color: '#9F1239', bg: '#FFE4E6', border: '#FECDD3' },
}
const uid = () => Math.random().toString(36).slice(2, 9)

type UserFormState = {
  id: string
  username: string
  name: string
  role: string
  modules: string[]
  active: boolean
  password: string
}

const blankUserForm: UserFormState = {
  id: '',
  username: '',
  name: '',
  role: 'sales_rep',
  modules: ['dashboard'],
  active: true,
  password: '',
}

const roleOptions = USER_ROLES.map(role => ({ value: role, label: formatRoleLabel(role) }))
const moduleOptions = MODULE_IDS.map(moduleId => ({
  value: moduleId,
  label: moduleId === 'pos' ? 'Point of Sale' : formatRoleLabel(moduleId),
}))

export default function HR() {
  return (
    <Suspense fallback={
      <ModuleSkeleton />
    }>
      <HRContent />
    </Suspense>
  )
}

function HRContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const {
    users, currentUserId, departments, employees, contracts, leaveBalances, leaveRequests, hrDocuments,
    workflowApprovals, payrollRuns, payslips, journalEntries, employeeAssetAssignments, products, serials,
    repairs, saleOrders, kilimallOrders, expenses,
    addEmployee, updateEmployee, addLeaveRequest, decideLeaveRequest,
    createPayrollRun, approvePayrollRun, postPayrollRun,
    assignAssetToEmployee, acknowledgeEmployeeAsset, returnEmployeeAsset, reassignEmployeeAsset,
    addHRDocument, createUser, updateUser, deleteUser, systemSettings, showToast,
    jobPostings, candidates, trainingPrograms, employeeTrainings,
    addJobPosting, updateJobPosting, addCandidate, updateCandidate, addTrainingProgram, enrollEmployeeTraining, updateTrainingStatus,
    hrSops: sops, saveHrSops: saveSops,
    hrPerfTargets: targets, saveHrPerfTargets: saveTargets,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin = currentUser?.role === 'admin'
  const isFinance = currentUser?.role === 'finance'
  const canSeeSalary = isFinance || !systemSettings.hrRestrictSalaryInfo

  const canManageHR = isAdmin
  const canApprovePayroll = isAdmin || isFinance
  const canDecideLeave = isAdmin

  const maskSensitive = (val?: string) => {
    if (!val) return 'N/A'
    if (isFinance) return val
    if (val.length <= 4) return '****'
    return '*'.repeat(val.length - 4) + val.slice(-4)
  }

  // Find the employee record linked to the current user (for self-service)
  const myEmployee = employees.find(e => e.userId === currentUserId) ?? null
  const myDepartment = departments.find(d => d.id === myEmployee?.departmentId)
  const myLeaves = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const myPayslips = payslips.filter(p => p.employeeId === myEmployee?.id)
  const myAssets = employeeAssetAssignments.filter(a => a.employeeId === myEmployee?.id && a.status === 'assigned')
  const myLeaveBalances = leaveBalances.filter(b => b.employeeId === myEmployee?.id && b.year === new Date().getFullYear())

  // ── My performance stats (role-specific, current month) ──────────────────────
  const thisMonth = new Date().toISOString().slice(0, 7) // YYYY-MM
  const myPerf = (() => {
    const role = currentUser?.role ?? ''
    const uid  = currentUserId ?? ''

    if (['repair_tech', 'lead_tech'].includes(role)) {
      const mine       = repairs.filter(r => r.assignedTechnicianId === uid)
      const completed  = mine.filter(r => ['closed', 'delivered'].includes(r.status) && (r.repairCompletedDate ?? r.intakeDate).startsWith(thisMonth)).length
      const inProgress = mine.filter(r => ['in_repair', 'qc'].includes(r.status)).length
      const diagnosed  = mine.filter(r => r.diagnosis?.diagnosedDate?.startsWith(thisMonth)).length
      const openTotal  = mine.filter(r => !['closed', 'delivered', 'cancelled', 'returned'].includes(r.status)).length
      return { type: 'tech' as const, completed, inProgress, diagnosed, openTotal }
    }

    if (role === 'sales_rep') {
      const mine    = saleOrders.filter(s => s.createdByUserId === uid && s.date.startsWith(thisMonth))
      const orders  = mine.filter(s => ['confirmed', 'delivered', 'invoiced'].includes(s.status)).length
      const revenue = mine.filter(s => ['confirmed', 'delivered', 'invoiced'].includes(s.status)).reduce((n, s) => n + s.total, 0)
      const quotes  = mine.length
      return { type: 'sales' as const, orders, revenue, quotes }
    }

    // All other roles: show expenses only
    const myExp = expenses.filter(e => e.submittedByUserId === uid && e.expenseDate.startsWith(thisMonth))
    return { type: 'general' as const, expCount: myExp.length, expAmount: myExp.reduce((n, e) => n + e.amount, 0) }
  })()

  // Default tab: admins/finance see employees, others go straight to self-service
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

  // ── Modal visibility ──
  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showSelfLeaveModal, setShowSelfLeaveModal] = useState(false)
  const [showPayrollModal, setShowPayrollModal] = useState(false)
  const [showDocumentModal, setShowDocumentModal] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [showAcknowledgeModal, setShowAcknowledgeModal] = useState(false)
  const [showReturnAssetModal, setShowReturnAssetModal] = useState(false)
  const [showReassignAssetModal, setShowReassignAssetModal] = useState(false)
  const [showJobModal, setShowJobModal] = useState(false)
  const [showCandidateModal, setShowCandidateModal] = useState(false)
  const [showTrainingModal, setShowTrainingModal] = useState(false)
  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [showAdvancedAccess, setShowAdvancedAccess] = useState(false)
  const [savingUser, setSavingUser] = useState(false)
  const [userForm, setUserForm] = useState<UserFormState>(blankUserForm)

  // ── Forms ──
  const [employeeForm, setEmployeeForm] = useState({
    employeeNo: '', fullName: '', email: '', phone: '', nationalId: '', kraPin: '',
    departmentId: departments[0]?.id ?? '', jobTitle: '', managerEmployeeId: '',
    startDate: new Date().toISOString().slice(0, 10),
    basicSalary: '0', housingAllowance: '0', transportAllowance: '0', bankAccount: '',
    accountPassword: '', accountRole: 'repair_tech',
    accountModules: ROLE_DEFAULT_MODULES['repair_tech'] as string[],
  })
  const blankEmployeeForm = {
    employeeNo: '', fullName: '', email: '', phone: '', nationalId: '', kraPin: '',
    departmentId: departments[0]?.id ?? '', jobTitle: '', managerEmployeeId: '',
    startDate: new Date().toISOString().slice(0, 10),
    basicSalary: '0', housingAllowance: '0', transportAllowance: '0', bankAccount: '',
    accountPassword: '', accountRole: 'repair_tech',
    accountModules: ROLE_DEFAULT_MODULES['repair_tech'] as string[],
  }

  const [leaveForm, setLeaveForm] = useState({
    employeeId: '',
    leaveType: 'flexible_leave',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    days: '1',
    reason: '',
  })

  const [selfLeaveForm, setSelfLeaveForm] = useState({
    leaveType: 'flexible_leave',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    days: '1',
    reason: '',
  })

  const [payrollMonth, setPayrollMonth] = useState(new Date().toISOString().slice(5, 7))
  const [payrollYear, setPayrollYear] = useState(String(new Date().getFullYear()))

  const [documentForm, setDocumentForm] = useState({
    employeeId: '', type: 'contract', title: '', expiryDate: '', visibility: 'hr_only', status: 'active',
  })

  const [assetForm, setAssetForm] = useState({
    employeeId: '', productId: '', serialId: '', qty: '1', handoverCondition: 'good', handoverNotes: '',
  })

  const [ackForm, setAckForm] = useState({ assignmentId: '', notes: '' })

  const [returnForm, setReturnForm] = useState({ assignmentId: '', returnLocation: 'warehouse', condition: 'good', notes: '' })
  const [reassignForm, setReassignForm] = useState({ assignmentId: '', employeeId: '' })

  const [jobForm, setJobForm] = useState({ title: '', departmentId: '', location: '', type: 'full_time', status: 'open', description: '' })
  const [candidateForm, setCandidateForm] = useState({ jobId: '', firstName: '', lastName: '', email: '', phone: '', stage: 'applied', notes: '' })
  const [trainingForm, setTrainingForm] = useState({ title: '', description: '', mandatoryForNewHires: false, durationDays: '1' })
  const [enrollForm, setEnrollForm] = useState({ employeeId: '', trainingId: '' })

  // ── HR SOPs state ──
  const [sopCatFilter, setSopCatFilter] = useState<SOPCategory | 'all'>('all')
  const [sopSearch, setSopSearch] = useState('')
  const [sopExpanded, setSopExpanded] = useState<Set<string>>(new Set())
  const [showSopModal, setShowSopModal] = useState(false)
  const [editSopId, setEditSopId] = useState<string | null>(null)
  const [sopForm, setSopForm] = useState({ title: '', category: 'general' as SOPCategory, content: '', status: 'active' as 'active' | 'draft', version: '1.0' })

  const openAddSop = () => { setEditSopId(null); setSopForm({ title: '', category: 'general', content: '', status: 'active', version: '1.0' }); setShowSopModal(true) }
  const openEditSop = (s: HRSOP) => { setEditSopId(s.id); setSopForm({ title: s.title, category: s.category, content: s.content, status: s.status, version: s.version }); setShowSopModal(true) }
  const submitSop = () => {
    if (!sopForm.title.trim() || !sopForm.content.trim()) return
    const now = new Date().toISOString().slice(0, 10)
    const byName = users.find(u => u.id === currentUserId)?.name ?? 'Admin'
    if (editSopId) {
      saveSops(sops.map(s => s.id === editSopId ? { ...s, ...sopForm, updatedAt: now } : s))
    } else {
      saveSops([{ id: uid(), ...sopForm, createdByName: byName, createdAt: now, updatedAt: now }, ...sops])
    }
    setShowSopModal(false)
  }
  const deleteSop = (id: string) => { if (window.confirm('Delete this SOP?')) saveSops(sops.filter(s => s.id !== id)) }
  const toggleSopExpand = (id: string) => setSopExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // ── Performance Targets state ──
  const [perfFilter, setPerfFilter] = useState<PerfStatus | 'all'>('all')
  const [perfEmpFilter, setPerfEmpFilter] = useState('')
  const [showPerfModal, setShowPerfModal] = useState(false)
  const [editPerfId, setEditPerfId] = useState<string | null>(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [updateTargetId, setUpdateTargetId] = useState<string | null>(null)
  const [updateValue, setUpdateValue] = useState('')
  const [perfForm, setPerfForm] = useState({
    employeeId: '', metric: '', description: '', targetValue: '', currentValue: '0',
    unit: 'KES', period: 'monthly' as PerfPeriod, periodLabel: '', dueDate: new Date().toISOString().slice(0, 10), status: 'on_track' as PerfStatus,
  })

  const openAddTarget = () => { setEditPerfId(null); setPerfForm({ employeeId: '', metric: '', description: '', targetValue: '', currentValue: '0', unit: 'KES', period: 'monthly', periodLabel: '', dueDate: new Date().toISOString().slice(0, 10), status: 'on_track' }); setShowPerfModal(true) }
  const openEditTarget = (t: PerformanceTarget) => { setEditPerfId(t.id); setPerfForm({ employeeId: t.employeeId, metric: t.metric, description: t.description, targetValue: String(t.targetValue), currentValue: String(t.currentValue), unit: t.unit, period: t.period, periodLabel: t.periodLabel, dueDate: t.dueDate, status: t.status }); setShowPerfModal(true) }
  const submitTarget = () => {
    if (!perfForm.employeeId || !perfForm.metric || !perfForm.targetValue) return
    const emp = employees.find(e => e.id === perfForm.employeeId)
    const byName = users.find(u => u.id === currentUserId)?.name ?? 'Admin'
    const now = new Date().toISOString().slice(0, 10)
    const record: PerformanceTarget = {
      id: editPerfId ?? uid(), employeeId: perfForm.employeeId, employeeName: emp?.fullName ?? '',
      metric: perfForm.metric, description: perfForm.description,
      targetValue: Number(perfForm.targetValue), currentValue: Number(perfForm.currentValue),
      unit: perfForm.unit, period: perfForm.period, periodLabel: perfForm.periodLabel,
      dueDate: perfForm.dueDate, status: perfForm.status, createdByName: byName, createdAt: now,
    }
    saveTargets(editPerfId ? targets.map(t => t.id === editPerfId ? record : t) : [record, ...targets])
    setShowPerfModal(false)
  }
  const deleteTarget = (id: string) => { if (window.confirm('Delete this target?')) saveTargets(targets.filter(t => t.id !== id)) }
  const submitUpdate = () => {
    if (!updateTargetId) return
    const val = Number(updateValue)
    saveTargets(targets.map(t => {
      if (t.id !== updateTargetId) return t
      const pct = t.targetValue > 0 ? val / t.targetValue : 0
      const status: PerfStatus = val >= t.targetValue ? 'achieved' : pct >= 0.7 ? 'on_track' : pct >= 0.4 ? 'at_risk' : 'missed'
      return { ...t, currentValue: val, status }
    }))
    setShowUpdateModal(false); setUpdateValue('')
  }

  // ── Search ──
  const [empSearch, setEmpSearch] = useState('')
  const [leaveSearch, setLeaveSearch] = useState('')
  const [payrollSearch, setPayrollSearch] = useState('')
  const [payslipSearch, setPayslipSearch] = useState('')
  const [docSearch, setDocSearch] = useState('')
  const [assetSearch, setAssetSearch] = useState('')

  // ── Stats ──
  const pendingLeaves = useMemo(() => leaveRequests.filter(r => r.status === 'pending_hr').length, [leaveRequests])
  const activeAssignments = useMemo(() => employeeAssetAssignments.filter(a => a.status === 'assigned'), [employeeAssetAssignments])
  const payrollJournals = useMemo(() => payrollRuns.filter(r => r.postedJournalId).map(r => ({
    run: r,
    journal: journalEntries.find(j => j.id === r.postedJournalId),
  })), [payrollRuns, journalEntries])
  const assignableProducts = useMemo(() => products.filter(p => p.category !== 'Services' && p.isActive), [products])
  const linkedUsers = useMemo(() => users.filter(u => u.active), [users])

  // ── Tab styling ──
  const tabStyle = (value: HRTab): React.CSSProperties => ({
    background: tab === value ? '#E8F3FA' : 'transparent',
    border: tab === value ? '1px solid #A8D4E8' : '1px solid transparent',
    borderRadius: 8,
    color: tab === value ? '#1B2762' : '#6B7280',
    fontWeight: tab === value ? 600 : 400,
    padding: '7px 14px',
    fontSize: 11,
    cursor: 'pointer',
  })

  // ── Actions ──
  const createEmployee = async () => {
    if (!employeeForm.fullName.trim()) { showToast('Full name is required', 'error'); return }
    if (!employeeForm.email.trim()) { showToast('Email is required', 'error'); return }
    if (!employeeForm.accountPassword) { showToast('Password is required', 'error'); return }
    if (employeeForm.accountPassword.length < 6) { showToast('Password must be at least 6 characters', 'error'); return }

    let linkedUserId: string | undefined

    const username = employeeForm.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_')
    try {
      const newUser = await createUser({
        username,
        name: employeeForm.fullName,
        role: employeeForm.accountRole as any,
        modules: employeeForm.accountModules as any,
        active: true,
        password: employeeForm.accountPassword,
      })
      linkedUserId = newUser.id
    } catch {
      showToast('Failed to create login account — username may already exist', 'error'); return
    }

    addEmployee({
      employeeNo: employeeForm.employeeNo,
      fullName: employeeForm.fullName,
      email: employeeForm.email,
      phone: employeeForm.phone,
      nationalId: employeeForm.nationalId,
      kraPin: employeeForm.kraPin,
      departmentId: employeeForm.departmentId,
      jobTitle: employeeForm.jobTitle,
      managerEmployeeId: employeeForm.managerEmployeeId || undefined,
      startDate: employeeForm.startDate,
      status: 'active',
      userId: linkedUserId,
      basicSalary: Number(employeeForm.basicSalary) || 0,
      housingAllowance: Number(employeeForm.housingAllowance) || 0,
      transportAllowance: Number(employeeForm.transportAllowance) || 0,
      bankAccount: employeeForm.bankAccount,
    })
    setShowEmployeeModal(false)
    setEmployeeForm(blankEmployeeForm)
  }

  const submitLeave = () => {
    const emp = employees.find(e => e.id === leaveForm.employeeId)
    if (!emp) return
    addLeaveRequest({
      employeeId: emp.id,
      employeeName: emp.fullName,
      leaveType: leaveForm.leaveType as any,
      startDate: leaveForm.startDate,
      endDate: leaveForm.endDate,
      days: Number(leaveForm.days) || 1,
      reason: leaveForm.reason,
    })
    setShowLeaveModal(false)
  }

  const submitSelfLeave = () => {
    if (!myEmployee) return
    addLeaveRequest({
      employeeId: myEmployee.id,
      employeeName: myEmployee.fullName,
      leaveType: selfLeaveForm.leaveType as any,
      startDate: selfLeaveForm.startDate,
      endDate: selfLeaveForm.endDate,
      days: Number(selfLeaveForm.days) || 1,
      reason: selfLeaveForm.reason,
    })
    setShowSelfLeaveModal(false)
    setSelfLeaveForm(prev => ({ ...prev, reason: '', days: '1' }))
  }

  const createPayroll = () => {
    createPayrollRun(payrollMonth, Number(payrollYear))
    setShowPayrollModal(false)
  }

  const saveDocument = () => {
    addHRDocument({
      employeeId: documentForm.employeeId,
      type: documentForm.type as any,
      title: documentForm.title,
      expiryDate: documentForm.expiryDate || undefined,
      visibility: documentForm.visibility as any,
      status: documentForm.status as any,
    })
    setShowDocumentModal(false)
  }

  const saveAssignment = () => {
    assignAssetToEmployee(assetForm.employeeId, assetForm.productId, Number(assetForm.qty) || 1, assetForm.serialId || undefined, assetForm.handoverCondition as any, assetForm.handoverNotes)
    setShowAssetModal(false)
  }

  const saveJob = () => {
    addJobPosting({ title: jobForm.title, departmentId: jobForm.departmentId, location: jobForm.location, type: jobForm.type as any, status: jobForm.status as any, description: jobForm.description })
    setShowJobModal(false)
    setJobForm({ title: '', departmentId: '', location: '', type: 'full_time', status: 'open', description: '' })
  }
  const saveCandidate = () => {
    addCandidate({ jobId: candidateForm.jobId, firstName: candidateForm.firstName, lastName: candidateForm.lastName, email: candidateForm.email, phone: candidateForm.phone, stage: candidateForm.stage as any, notes: candidateForm.notes })
    setShowCandidateModal(false)
    setCandidateForm({ jobId: '', firstName: '', lastName: '', email: '', phone: '', stage: 'applied', notes: '' })
  }
  const saveTraining = () => {
    addTrainingProgram({ title: trainingForm.title, description: trainingForm.description, mandatoryForNewHires: trainingForm.mandatoryForNewHires, durationDays: Number(trainingForm.durationDays) || 1 })
    setShowTrainingModal(false)
    setTrainingForm({ title: '', description: '', mandatoryForNewHires: false, durationDays: '1' })
  }
  const saveEnrollment = () => {
    enrollEmployeeTraining(enrollForm.employeeId, enrollForm.trainingId)
    setShowEnrollModal(false)
    setEnrollForm({ employeeId: '', trainingId: '' })
  }

  // ── User management ──
  const openCreateUserModal = () => { setUserForm(blankUserForm); setShowUserModal(true) }
  const openEditUserModal = (userId: string) => {
    const user = users.find(u => u.id === userId)
    if (!user) return
    setUserForm({ id: user.id, username: user.username, name: user.name, role: user.role, modules: [...user.modules], active: user.active, password: '' })
    setShowUserModal(true)
  }
  const toggleUserModule = (moduleId: string) => {
    setUserForm(prev => {
      const has = prev.modules.includes(moduleId)
      const modules = has ? prev.modules.filter(m => m !== moduleId) : [...prev.modules, moduleId]
      return { ...prev, modules: modules.length > 0 ? modules : ['dashboard'] }
    })
  }
  const saveUser = async () => {
    try {
      setSavingUser(true)
      const payload = {
        username: userForm.username.trim(),
        name: userForm.name.trim(),
        role: userForm.role as typeof USER_ROLES[number],
        modules: userForm.modules as typeof MODULE_IDS[number][],
        active: userForm.active,
        ...(userForm.password ? { password: userForm.password } : {}),
      }
      if (!payload.username || !payload.name || payload.modules.length === 0 || (!userForm.id && !userForm.password)) {
        alert('Complete required fields (name, username, modules, password for new users).')
        return
      }
      if (userForm.id) {
        await updateUser(userForm.id, payload)
      } else {
        await createUser({ username: payload.username, name: payload.name, role: payload.role, modules: payload.modules, active: payload.active, password: userForm.password })
      }
      setShowUserModal(false)
      setUserForm(blankUserForm)
    } finally {
      setSavingUser(false)
    }
  }
  const removeUser = async (userId: string) => {
    const user = users.find(u => u.id === userId)
    if (!user) return
    if (!window.confirm(`Delete user ${user.username}? This removes backend access immediately.`)) return
    await deleteUser(userId)
  }

  // ── Payslip PDF ──
  const buildPayslipLines = (payslipId: string) => {
    const payslip = payslips.find(p => p.id === payslipId)
    if (!payslip) return null
    const emp = employees.find(e => e.id === payslip.employeeId)
    const dept = departments.find(d => d.id === emp?.departmentId)
    return {
      fileName: `Payslip-${payslip.ref.replaceAll('/', '-')}.pdf`,
      lines: [
        { text: 'DEED TECHNOLOGIES LIMITED', x: 40, y: 800, size: 18, bold: true },
        { text: 'Official Payslip', x: 40, y: 782, size: 11 },
        { text: `Ref: ${payslip.ref}`, x: 40, y: 754 },
        { text: `Employee: ${payslip.employeeName}`, x: 40, y: 736 },
        { text: `Employee No: ${emp?.employeeNo ?? 'N/A'}`, x: 40, y: 718 },
        { text: `Department: ${dept?.name ?? 'N/A'}`, x: 40, y: 700 },
        { text: `Job Title: ${emp?.jobTitle ?? 'N/A'}`, x: 40, y: 682 },
        { text: `Pay Period: ${payslip.month}/${payslip.year}`, x: 40, y: 664 },
        { text: '─────────────────────────────', x: 40, y: 648 },
        { text: `Gross Pay:   ${fmtKes(payslip.grossPay)}`, x: 40, y: 630 },
        { text: `Deductions:  ${fmtKes(payslip.deductions)}`, x: 40, y: 612 },
        { text: `Net Pay:     ${fmtKes(payslip.netPay)}`, x: 40, y: 594, bold: true },
        { text: '─────────────────────────────', x: 40, y: 578 },
        { text: `Generated: ${fmtDate(payslip.generatedDate)}`, x: 40, y: 560 },
        { text: `Bank Account: ${maskSensitive(emp?.bankAccount)}`, x: 40, y: 542 },
        { text: 'Authorised by: ____________________', x: 40, y: 504 },
        { text: 'Employee sign-off: ____________________', x: 40, y: 484 },
      ],
    }
  }
  const downloadPayslipPdf = (id: string) => { const p = buildPayslipLines(id); if (p) downloadPdf(p.fileName, p.lines) }
  const printPayslipPdf = (id: string) => { const p = buildPayslipLines(id); if (p) printPdf(p.fileName, p.lines) }

  // ── Leave status badge helper ──
  const leaveBadge = (status: string) => (
    <Badge
      status={status === 'approved' ? 'active' : status === 'rejected' ? 'cancelled' : 'pending'}
      label={status.replace('_', ' ')}
    />
  )

  // ── Leave type color helper ──
  const leaveTypeColors: Record<string, { bg: string; color: string }> = {
    annual_leave:    { bg: 'rgba(16,185,129,0.1)',  color: '#059669' },
    sick_leave:      { bg: 'rgba(239,68,68,0.1)',   color: '#DC2626' },
    maternity_leave: { bg: 'rgba(236,72,153,0.1)',  color: '#9D174D' },
    paternity_leave: { bg: 'rgba(59,130,246,0.1)',  color: '#1D4ED8' },
    study_leave:     { bg: 'rgba(139,92,246,0.1)',  color: '#5B21B6' },
    unpaid_leave:    { bg: 'rgba(107,114,128,0.1)', color: '#374151' },
  }
  const leaveTypeChip = (type: string) => {
    const c = leaveTypeColors[type] ?? { bg: 'rgba(107,114,128,0.1)', color: '#374151' }
    return (
      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: c.bg, color: c.color, fontWeight: 500, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
        {type.replace(/_/g, ' ')}
      </span>
    )
  }

  // ── Contract type color helper ──
  const contractTypeChip = (type: string) => {
    const map: Record<string, { bg: string; color: string }> = {
      permanent:  { bg: 'rgba(16,185,129,0.1)',  color: '#059669' },
      contract:   { bg: 'rgba(245,158,11,0.1)',  color: '#92400E' },
      part_time:  { bg: 'rgba(59,130,246,0.1)',  color: '#1D4ED8' },
      freelance:  { bg: 'rgba(139,92,246,0.1)',  color: '#5B21B6' },
      internship: { bg: 'rgba(107,114,128,0.1)', color: '#374151' },
    }
    const c = map[type] ?? { bg: 'rgba(107,114,128,0.1)', color: '#374151' }
    return (
      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: c.bg, color: c.color, fontWeight: 500, textTransform: 'capitalize' }}>
        {type.replace(/_/g, ' ')}
      </span>
    )
  }

  // ── Tabs available per role ──
  type TabDef = { id: HRTab; label: string; icon: any }
  const allTabs: TabDef[] = [
    { id: 'employees',    label: 'Employees',    icon: faUsers },
    { id: 'recruitment',  label: 'Recruitment',  icon: faUserTie },
    { id: 'training',     label: 'Training',     icon: faGraduationCap },
    { id: 'leave',        label: 'Leave',        icon: faCalendarMinus },
    { id: 'payroll',      label: 'Payroll',      icon: faMoneyBillWave },
    { id: 'documents',    label: 'Documents',    icon: faFolderOpen },
    { id: 'assets',       label: 'Assets',       icon: faLaptop },
    { id: 'self_service', label: 'Self Service', icon: faCircleUser },
    { id: 'sops',         label: 'SOPs',         icon: faFileSignature },
    { id: 'performance',  label: 'Performance',  icon: faChartLine },
    { id: 'reports',      label: 'Reports',      icon: faChartBar },
  ]
  const visibleTabs = isAdmin
    ? allTabs
    : allTabs.filter(t => ['self_service', 'leave', 'sops', 'performance'].includes(t.id) || (isFinance && ['payroll', 'reports'].includes(t.id)))

  return (
    <div className="flex flex-col gap-4">
      {/* ── Stats (admin-only — company-wide numbers) ── */}
      {isAdmin && (
        <div className="kpi-grid">
          <StatCard label="Total Employees" value={employees.length} sub="active headcount" color="#1B2762" icon={<Fa icon={faUsers} />} />
          <StatCard label="Leave Pending" value={pendingLeaves} sub="awaiting approval" color="#F59E0B" icon={<Fa icon={faCalendarMinus} />} />
          <StatCard label="Payroll Runs" value={payrollRuns.length} sub="all cycles" color="#10B981" icon={<Fa icon={faMoneyBillWave} />} />
          <StatCard label="HR Documents" value={hrDocuments.length} sub="on record" color="#8B5CF6" icon={<Fa icon={faFolderOpen} />} />
          <StatCard label="Assets Issued" value={activeAssignments.length} sub="to employees" color="#F97316" icon={<Fa icon={faLaptop} />} />
        </div>
      )}

      {/* ── Info banner ── */}
      {isAdmin && (
        <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg, #E8F3FA 0%, #F5F3FF 100%)', border: '1px solid #A8D4E8' }}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#1B2762', color: '#fff' }}>
              <Fa icon={faUsers} size="sm" />
            </div>
            <div className="grid grid-cols-2 gap-4 text-[11px] flex-1">
              <div>
                <div className="font-bold mb-1" style={{ color: '#0D1A4A' }}>HR Operating Model</div>
                <div className="text-t2 leading-relaxed">Employee records drive leave, payroll, assets, documents, and accounting postings. All staff submit leave via Self Service — you approve here.</div>
              </div>
              <div className="space-y-1" style={{ color: '#14204F' }}>
                <div className="flex items-center gap-1.5"><Fa icon={faCalendarMinus} size="xs" /><span>Staff book leave → approve or reject in Leave tab</span></div>
                <div className="flex items-center gap-1.5"><Fa icon={faMoneyBillWave} size="xs" /><span>Payroll creates accounting journal entries</span></div>
                <div className="flex items-center gap-1.5"><Fa icon={faLaptop} size="xs" /><span>Assets assigned from inventory to employees</span></div>
                <div className="flex items-center gap-1.5"><Fa icon={faCircleUser} size="xs" /><span>Published payslips visible in Self Service</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="mb-5">
        <TabBar
          tabs={visibleTabs.map(t => ({
            id: t.id,
            label: t.label,
            icon: <Fa icon={t.icon} fixedWidth style={{ fontSize: 11 }} />,
          }))}
          active={tab}
          onChange={setTab}
        />
      </div>

      <TabContent activeKey={tab}>

      {/* ════════════════════════════════════════════
          TAB: EMPLOYEES
      ════════════════════════════════════════════ */}
      {tab === 'employees' && (
        <div className="flex flex-col gap-3">
          {/* ── Employee Master Data ── */}
          <div className="card overflow-hidden">
            <PanelHeader title="Employee Master Data" count={employees.filter(e => {
              const s = empSearch.toLowerCase()
              return !s || e.fullName.toLowerCase().includes(s) || e.employeeNo.toLowerCase().includes(s) ||
                e.email.toLowerCase().includes(s) || e.jobTitle.toLowerCase().includes(s)
            }).length}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
                placeholder="Search name, no., email…" value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
              <button className="btn-primary text-[11px]" disabled={!canManageHR} onClick={() => setShowEmployeeModal(true)}>+ Add Employee</button>
            </PanelHeader>
            <Table cols={[
              { label: 'Employee', width: '1.8fr' },
              { label: 'Department', width: '1fr' },
              { label: 'Job Title', width: '1.2fr' },
              ...(canSeeSalary ? [
                { label: 'Basic', width: '0.9fr' },
                { label: 'Net Pay', width: '0.9fr' },
              ] : []),
              { label: 'Start Date', width: '0.9fr' },
              { label: 'Status', width: '0.8fr' },
              { label: 'Login Account', width: '1.2fr' },
            ]}>
              {employees.filter(e => {
                const s = empSearch.toLowerCase()
                return !s || e.fullName.toLowerCase().includes(s) || e.employeeNo.toLowerCase().includes(s) ||
                  e.email.toLowerCase().includes(s) || e.jobTitle.toLowerCase().includes(s)
              }).map(emp => {
                const dept = departments.find(d => d.id === emp.departmentId)
                const user = users.find(u => u.id === emp.userId)
                const { netSalary } = calculatePayroll(emp.basicSalary, emp.housingAllowance, emp.transportAllowance)
                return (
                  <div key={emp.id} className="table-row">
                    <span>
                      <div style={{ color: '#111827', fontWeight: 600 }}>{emp.fullName}</div>
                      <div style={{ fontSize: 10 }}>
                        <span className="font-mono font-semibold" style={{ color: '#1B2762' }}>{emp.employeeNo}</span>
                        <span style={{ color: '#9CA3AF' }}> · {emp.email}</span>
                      </div>
                    </span>
                    <span>{dept?.name ?? '—'}</span>
                    <span>{emp.jobTitle}</span>
                    {canSeeSalary && <span className="font-mono" style={{ fontSize: 11 }}>{fmtKes(emp.basicSalary)}</span>}
                    {canSeeSalary && <span className="font-mono font-semibold" style={{ fontSize: 11, color: '#059669' }}>{fmtKes(netSalary)}</span>}
                    <span style={{ fontSize: 11 }}>{fmtDate(emp.startDate)}</span>
                    <span>
                      <Badge
                        status={emp.status === 'active' ? 'active' : emp.status === 'on_leave' ? 'pending' : 'cancelled'}
                        label={emp.status.replace('_', ' ')}
                      />
                    </span>
                    <span className="flex flex-col gap-1">
                      {user ? (
                        <>
                          <span style={{ fontSize: 11, color: '#111827', fontWeight: 500 }}>{user.name}</span>
                          <span style={{ fontSize: 10, color: user.active ? '#059669' : '#EF4444' }}>
                            {user.active ? '● Active' : '● Inactive'}
                          </span>
                          {canManageHR && (
                            <button
                              className={`text-[9px] font-semibold px-2 py-0.5 rounded border cursor-pointer transition-colors ${user.active ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' : 'bg-green-50 text-green-700 border-green-100 hover:bg-green-100'}`}
                              onClick={() => { void updateUser(user.id, { active: !user.active }) }}
                            >
                              {user.active ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                        </>
                      ) : (
                        <span style={{ color: '#9CA3AF', fontSize: 11 }}>No account</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </Table>
          </div>

          {/* ── Departments & Contracts ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="card overflow-hidden">
              <PanelHeader title="Departments" count={departments.length} />
              <Table cols={[
                { label: 'Department', width: '1.4fr' },
                { label: 'Description', width: '2fr' },
                { label: 'Headcount', width: '0.8fr' },
                ...(canSeeSalary ? [{ label: 'Gross Payroll', width: '1fr' }] : []),
              ]}>
                {departments.map(dep => {
                  const headcount = employees.filter(e => e.departmentId === dep.id)
                  const totalPayroll = headcount.reduce((s, e) => s + e.basicSalary + e.housingAllowance + e.transportAllowance, 0)
                  return (
                    <div key={dep.id} className="table-row">
                      <span style={{ fontWeight: 600, color: '#111827' }}>{dep.name}</span>
                      <span style={{ color: '#6B7280', fontSize: 11 }}>{dep.description || '—'}</span>
                      <span><span className="badge badge-blue">{headcount.length}</span></span>
                      {canSeeSalary && <span className="font-mono" style={{ fontSize: 11 }}>{fmtKes(totalPayroll)}</span>}
                    </div>
                  )
                })}
              </Table>
            </div>

            <div className="card overflow-hidden">
              <PanelHeader title="Employment Contracts" count={contracts.length} />
              <Table cols={[
                { label: 'Employee', width: '1.2fr' },
                { label: 'Type', width: '1fr' },
                { label: 'Benefits', width: '1.4fr' },
                { label: 'Gross', width: '1fr' },
              ]}>
                {contracts.map(con => {
                  const emp = employees.find(e => e.id === con.employeeId)
                  return (
                    <div key={con.id} className="table-row">
                      <span style={{ fontWeight: 600, color: '#111827' }}>{emp?.fullName ?? '—'}</span>
                      <span>{contractTypeChip(con.type)}</span>
                      <span style={{ color: '#6B7280', fontSize: 10 }}>{con.benefits.join(', ') || '—'}</span>
                      <span className="font-mono font-semibold" style={{ fontSize: 11 }}>{fmtKes(con.grossSalary)}</span>
                    </div>
                  )
                })}
              </Table>
            </div>
          </div>

        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: RECRUITMENT
      ════════════════════════════════════════════ */}
      {tab === 'recruitment' && (
        <div className="flex flex-col gap-3">
           <div className="card overflow-hidden">
             <PanelHeader title="Job Postings" count={jobPostings.length}>
               <button className="btn-primary text-[11px]" disabled={!canManageHR} onClick={() => setShowJobModal(true)}>+ New Job Posting</button>
             </PanelHeader>
             <Table cols={[
               { label: 'Title', width: '1.5fr' },
               { label: 'Department', width: '1fr' },
               { label: 'Type / Location', width: '1fr' },
               { label: 'Posted Date', width: '1fr' },
               { label: 'Status', width: '1fr' },
             ]}>
               {jobPostings.map(job => {
                 const dept = departments.find(d => d.id === job.departmentId)
                 return (
                   <div key={job.id} className="table-row">
                     <span style={{ fontWeight: 600, color: '#111827' }}>{job.title}</span>
                     <span>{dept?.name ?? '—'}</span>
                     <span>
                       <div style={{ textTransform: 'capitalize' }}>{job.type.replace('_', ' ')}</div>
                       <div style={{ fontSize: 10, color: '#6B7280' }}>{job.location}</div>
                     </span>
                     <span style={{ fontSize: 11 }}>{fmtDate(job.postedDate)}</span>
                     <span>
                       <Select value={job.status} onChange={v => updateJobPosting(job.id, { status: v as any })} options={[
                         { value: 'open', label: 'Open' }, { value: 'draft', label: 'Draft' }, { value: 'closed', label: 'Closed' }
                       ]} />
                     </span>
                   </div>
                 )
               })}
             </Table>
           </div>

           <div className="card overflow-hidden">
             <PanelHeader title="Candidates Pipeline" count={candidates.length}>
               <button className="btn-primary text-[11px]" disabled={!canManageHR} onClick={() => setShowCandidateModal(true)}>+ Add Candidate</button>
             </PanelHeader>
             <Table cols={[
               { label: 'Candidate', width: '1.5fr' },
               { label: 'Applied For', width: '1.5fr' },
               { label: 'Contact', width: '1.5fr' },
               { label: 'Applied Date', width: '1fr' },
               { label: 'Stage', width: '1.2fr' },
             ]}>
               {candidates.map(c => {
                 const job = jobPostings.find(j => j.id === c.jobId)
                 return (
                   <div key={c.id} className="table-row">
                     <span style={{ fontWeight: 600, color: '#111827' }}>{c.firstName} {c.lastName}</span>
                     <span style={{ fontWeight: 500, color: '#1B2762' }}>{job?.title ?? '—'}</span>
                     <span>
                       <div style={{ fontSize: 11 }}>{c.email}</div>
                       <div style={{ fontSize: 10, color: '#6B7280' }}>{c.phone}</div>
                     </span>
                     <span style={{ fontSize: 11 }}>{fmtDate(c.appliedDate)}</span>
                     <span>
                       <Select value={c.stage} onChange={v => updateCandidate(c.id, { stage: v as any })} options={[
                         { value: 'applied', label: 'Applied' }, { value: 'screening', label: 'Screening' },
                         { value: 'interview', label: 'Interview' }, { value: 'offered', label: 'Offered' },
                         { value: 'hired', label: 'Hired' }, { value: 'rejected', label: 'Rejected' }
                       ]} />
                     </span>
                   </div>
                 )
               })}
             </Table>
           </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: TRAINING & ONBOARDING
      ════════════════════════════════════════════ */}
      {tab === 'training' && (
        <div className="flex flex-col gap-3">
           <div className="card overflow-hidden">
             <PanelHeader title="Training Programs" count={trainingPrograms.length}>
               <button className="btn-primary text-[11px]" disabled={!canManageHR} onClick={() => setShowTrainingModal(true)}>+ New Program</button>
             </PanelHeader>
             <Table cols={[
               { label: 'Title', width: '1.5fr' },
               { label: 'Description', width: '2fr' },
               { label: 'Duration', width: '1fr' },
               { label: 'Mandatory', width: '1fr' },
             ]}>
               {trainingPrograms.map(t => (
                 <div key={t.id} className="table-row">
                   <span style={{ fontWeight: 600, color: '#111827' }}>{t.title}</span>
                   <span style={{ fontSize: 11, color: '#6B7280' }} className="truncate">{t.description}</span>
                   <span style={{ fontSize: 11 }}>{t.durationDays} day(s)</span>
                   <span>{t.mandatoryForNewHires ? <Badge status="active" label="Yes" /> : <Badge status="pending" label="No" />}</span>
                 </div>
               ))}
             </Table>
           </div>

           <div className="card overflow-hidden">
             <PanelHeader title="Employee Enrollments" count={employeeTrainings.length}>
               <button className="btn-primary text-[11px]" disabled={!canManageHR} onClick={() => setShowEnrollModal(true)}>+ Enroll Employee</button>
             </PanelHeader>
             <Table cols={[
               { label: 'Employee', width: '1.5fr' },
               { label: 'Program', width: '1.5fr' },
               { label: 'Enrolled Date', width: '1fr' },
               { label: 'Status', width: '1fr' },
               { label: 'Score (%)', width: '1fr' },
             ]}>
               {employeeTrainings.map(et => {
                 const emp = employees.find(e => e.id === et.employeeId)
                 const prog = trainingPrograms.find(t => t.id === et.trainingId)
                 return (
                   <div key={et.id} className="table-row">
                     <span style={{ fontWeight: 600, color: '#111827' }}>{emp?.fullName ?? '—'}</span>
                     <span style={{ fontWeight: 500, color: '#1B2762' }}>{prog?.title ?? '—'}</span>
                     <span style={{ fontSize: 11 }}>{fmtDate(et.enrolledDate)}</span>
                     <span>
                       <Select value={et.status} onChange={v => updateTrainingStatus(et.id, v as any, et.score)} options={[
                         { value: 'not_started', label: 'Not Started' }, { value: 'in_progress', label: 'In Progress' }, { value: 'completed', label: 'Completed' }
                       ]} />
                     </span>
                     <span>
                       <Input type="number" value={String(et.score ?? '')} onChange={v => updateTrainingStatus(et.id, et.status, Number(v) || undefined)} placeholder="—" />
                     </span>
                   </div>
                 )
               })}
             </Table>
           </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: LEAVE
      ════════════════════════════════════════════ */}
      {tab === 'leave' && (
        <div className="flex flex-col gap-3">
          {/* Pending approvals callout */}
          {pendingLeaves > 0 && (
            <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#F59E0B', color: '#fff' }}>
                <Fa icon={faCircleExclamation} />
              </div>
              <div className="text-[12px]" style={{ color: '#92400E' }}>
                <span className="font-bold">{pendingLeaves} leave request{pendingLeaves > 1 ? 's' : ''} pending approval.</span>
                {' '}Review and action them below.
              </div>
            </div>
          )}

          {/* ── Leave requests ── */}
          <div className="card overflow-hidden">
            <PanelHeader title={isAdmin ? 'All Leave Requests' : 'My Leave Requests'} count={(isAdmin ? leaveRequests : myLeaves).filter(r => {
              const s = leaveSearch.toLowerCase()
              return !s || r.ref.toLowerCase().includes(s) || r.employeeName.toLowerCase().includes(s) ||
                r.leaveType.toLowerCase().includes(s) || (r.reason ?? '').toLowerCase().includes(s)
            }).length}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 180 }}
                placeholder="Search type, reason…" value={leaveSearch} onChange={e => setLeaveSearch(e.target.value)} />
              <button className="btn-primary text-[11px]" onClick={() => canManageHR ? setShowLeaveModal(true) : setShowSelfLeaveModal(true)}>
                {canManageHR ? '+ New Request (HR)' : '+ Apply for Leave'}
              </button>
            </PanelHeader>
            <Table cols={[
              { label: 'Ref', width: '0.8fr' },
              ...(isAdmin ? [{ label: 'Employee', width: '1.3fr' }] : []),
              { label: 'Leave Type', width: '1.2fr' },
              { label: 'From', width: '0.9fr' },
              { label: 'To', width: '0.9fr' },
              { label: 'Days', width: '0.5fr' },
              { label: 'Reason', width: '1.6fr' },
              { label: 'Status', width: '0.9fr' },
              { label: 'Actions', width: '1.4fr' },
            ]}>
              {(isAdmin ? leaveRequests : myLeaves).filter(r => {
                const s = leaveSearch.toLowerCase()
                return !s || r.ref.toLowerCase().includes(s) || r.employeeName.toLowerCase().includes(s) ||
                  r.leaveType.toLowerCase().includes(s) || (r.reason ?? '').toLowerCase().includes(s)
              }).map(req => (
                <div key={req.id} className="table-row">
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{req.ref}</span>
                  {isAdmin && (
                    <span>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{req.employeeName}</div>
                      <div style={{ color: '#9CA3AF', fontSize: 10 }}>Submitted {fmtDate(req.submittedDate)}</div>
                    </span>
                  )}
                  <span>{leaveTypeChip(req.leaveType)}</span>
                  <span style={{ fontSize: 11 }}>{fmtDate(req.startDate)}</span>
                  <span style={{ fontSize: 11 }}>{fmtDate(req.endDate)}</span>
                  <span style={{ fontWeight: 600 }}>{req.days}d</span>
                  <span style={{ fontSize: 11, color: '#6B7280' }} className="truncate">{req.reason || '—'}</span>
                  <span>{leaveBadge(req.status)}</span>
                  <span className="flex gap-1 items-center flex-wrap">
                    {req.status === 'pending_hr' && canDecideLeave && (
                      <>
                        <button
                          style={{ background: '#F0FDF4', border: 'none', borderRadius: 6, color: '#059669', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => decideLeaveRequest(req.id, true)}
                        >
                          <Fa icon={faCheck} style={{ fontSize: 9 }} /> Approve
                        </button>
                        <button
                          style={{ background: '#FEF2F2', border: 'none', borderRadius: 6, color: '#DC2626', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          onClick={() => decideLeaveRequest(req.id, false)}
                        >
                          <Fa icon={faXmark} style={{ fontSize: 9 }} /> Reject
                        </button>
                      </>
                    )}
                    {req.status === 'approved' && (
                      <span className="flex items-center gap-1" style={{ color: '#059669', fontSize: 10 }}>
                        <Fa icon={faCircleCheck} style={{ fontSize: 10 }} /> {req.hrApprovalBy}
                      </span>
                    )}
                    {req.status === 'rejected' && (
                      <span className="flex items-center gap-1" style={{ color: '#EF4444', fontSize: 10 }}>
                        <Fa icon={faCircleXmark} style={{ fontSize: 10 }} /> Rejected
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </Table>
          </div>

          {/* ── Leave balances ── */}
          <div className="card overflow-hidden">
            <PanelHeader title={`Leave Balances — ${new Date().getFullYear()}`} count={isAdmin ? leaveBalances.filter(b => b.year === new Date().getFullYear()).length : myLeaveBalances.length} />
            <Table cols={[
              ...(isAdmin ? [{ label: 'Employee', width: '1.2fr' }] : []),
              { label: 'Leave Type', width: '1.3fr' },
              { label: 'Entitlement', width: '0.8fr' },
              { label: 'Carry Fwd', width: '0.8fr' },
              { label: 'Used', width: '0.7fr' },
              { label: 'Pending', width: '0.7fr' },
              { label: 'Available', width: '0.8fr' },
            ]}>
              {isAdmin
                ? employees.flatMap(emp => {
                    const empBalances = leaveBalances.filter(b => b.employeeId === emp.id && b.year === new Date().getFullYear())
                    return empBalances.map((bal, idx) => {
                      const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
                      return (
                        <div key={bal.id} className="table-row">
                          <span style={{ fontWeight: idx === 0 ? 600 : 400, color: idx === 0 ? '#111827' : '#9CA3AF', fontSize: 11 }}>
                            {idx === 0 ? emp.fullName : '↳'}
                          </span>
                          <span style={{ textTransform: 'capitalize', fontSize: 11 }}>{bal.leaveType.replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: 11 }}>{bal.entitlement}d</span>
                          <span style={{ fontSize: 11, color: bal.carryForward > 0 ? '#1B2762' : '#9CA3AF' }}>{bal.carryForward}d</span>
                          <span style={{ fontSize: 11, color: '#EF4444' }}>{bal.used}d</span>
                          <span style={{ fontSize: 11, color: bal.pending > 0 ? '#F59E0B' : '#9CA3AF' }}>{bal.pending}d</span>
                          <span style={{ fontWeight: 600, fontSize: 11, color: available > 0 ? '#059669' : '#EF4444' }}>{available}d</span>
                        </div>
                      )
                    })
                  })
                : myLeaveBalances.map(bal => {
                    const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
                    return (
                      <div key={bal.id} className="table-row">
                        <span style={{ textTransform: 'capitalize', fontSize: 11 }}>{bal.leaveType.replace(/_/g, ' ')}</span>
                        <span style={{ fontSize: 11 }}>{bal.entitlement}d</span>
                        <span style={{ fontSize: 11, color: bal.carryForward > 0 ? '#1B2762' : '#9CA3AF' }}>{bal.carryForward}d</span>
                        <span style={{ fontSize: 11, color: '#EF4444' }}>{bal.used}d</span>
                        <span style={{ fontSize: 11, color: bal.pending > 0 ? '#F59E0B' : '#9CA3AF' }}>{bal.pending}d</span>
                        <span style={{ fontWeight: 600, fontSize: 11, color: available > 0 ? '#059669' : '#EF4444' }}>{available}d</span>
                      </div>
                    )
                  })
              }
            </Table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: PAYROLL
      ════════════════════════════════════════════ */}
      {tab === 'payroll' && (
        <div className="flex flex-col gap-3">
          <div className="card overflow-hidden">
            <PanelHeader title="Payroll Runs" count={payrollRuns.filter(r => {
              const s = payrollSearch.toLowerCase()
              return !s || r.ref.toLowerCase().includes(s) || `${r.month}/${r.year}`.includes(s)
            }).length}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 160 }}
                placeholder="Search ref, period…" value={payrollSearch} onChange={e => setPayrollSearch(e.target.value)} />
              {canManageHR && (
                <button className="btn-primary text-[11px]" onClick={() => setShowPayrollModal(true)}>+ Create Payroll Run</button>
              )}
            </PanelHeader>
            <Table cols={[
              { label: 'Ref', width: '1fr' },
              { label: 'Period', width: '0.7fr' },
              { label: 'Employees', width: '0.7fr' },
              { label: 'Total Gross', width: '1fr' },
              { label: 'Deductions', width: '1fr' },
              { label: 'Net Pay', width: '1fr' },
              { label: 'Status', width: '0.9fr' },
              { label: 'Actions', width: '1.4fr' },
            ]}>
              {payrollRuns.filter(r => {
                const s = payrollSearch.toLowerCase()
                return !s || r.ref.toLowerCase().includes(s) || `${r.month}/${r.year}`.includes(s)
              }).map(run => (
                <div key={run.id} className="table-row">
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{run.ref}</span>
                  <span style={{ fontSize: 11 }}>{run.month}/{run.year}</span>
                  <span><span className="badge badge-blue">{run.lines.length}</span></span>
                  <span className="font-mono" style={{ fontSize: 11 }}>{fmtKes(run.totalGross)}</span>
                  <span className="font-mono" style={{ fontSize: 11, color: '#EF4444' }}>{fmtKes(run.totalDeductions)}</span>
                  <span className="font-mono font-semibold" style={{ fontSize: 11 }}>{fmtKes(run.totalNet)}</span>
                  <span>
                    <Badge
                      status={run.status === 'posted' ? 'posted' : run.status === 'approved' ? 'active' : 'pending'}
                      label={run.status.replace('_', ' ')}
                    />
                  </span>
                  <span className="flex gap-2 flex-wrap items-center">
                    {run.status === 'pending_approval' && canApprovePayroll && (
                      <button
                        style={{ background: '#F0FDF4', border: 'none', borderRadius: 6, color: '#059669', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => approvePayrollRun(run.id)}
                      >
                        <Fa icon={faCheck} style={{ fontSize: 9 }} /> Approve
                      </button>
                    )}
                    {run.status === 'approved' && canApprovePayroll && (
                      <button
                        style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: '#1B2762', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => postPayrollRun(run.id)}
                      >
                        <Fa icon={faMoneyBillWave} style={{ fontSize: 9 }} /> Post to Accounting
                      </button>
                    )}
                    {run.status === 'posted' && (
                      <span className="flex items-center gap-1" style={{ color: '#059669', fontSize: 10 }}>
                        <Fa icon={faCircleCheck} style={{ fontSize: 11 }} /> Posted
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </Table>
          </div>

          {/* Payslips table */}
          <div className="card overflow-hidden">
            <PanelHeader title="Payslips" count={payslips.filter(p => {
              const s = payslipSearch.toLowerCase()
              return !s || p.ref.toLowerCase().includes(s) || p.employeeName.toLowerCase().includes(s) ||
                `${p.month}/${p.year}`.includes(s)
            }).length}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 180 }}
                placeholder="Search employee, period…" value={payslipSearch} onChange={e => setPayslipSearch(e.target.value)} />
            </PanelHeader>
            <Table cols={[
              { label: 'Ref', width: '0.9fr' },
              { label: 'Employee', width: '1.3fr' },
              { label: 'Department', width: '1fr' },
              { label: 'Period', width: '0.7fr' },
              { label: 'Basic', width: '0.9fr' },
              { label: 'Deductions', width: '0.9fr' },
              { label: 'Net Pay', width: '0.9fr' },
              { label: 'Status', width: '0.8fr' },
              { label: 'Actions', width: '1.3fr' },
            ]}>
              {payslips.filter(p => {
                const s = payslipSearch.toLowerCase()
                return !s || p.ref.toLowerCase().includes(s) || p.employeeName.toLowerCase().includes(s) ||
                  `${p.month}/${p.year}`.includes(s)
              }).map(ps => {
                const emp = employees.find(e => e.id === ps.employeeId)
                const dept = departments.find(d => d.id === emp?.departmentId)
                return (
                  <div key={ps.id} className="table-row">
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{ps.ref}</span>
                    <span>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{ps.employeeName}</div>
                      <div className="font-mono text-[10px]" style={{ color: '#9CA3AF' }}>{emp?.employeeNo ?? ''}</div>
                    </span>
                    <span style={{ fontSize: 11 }}>{dept?.name ?? '—'}</span>
                    <span style={{ fontSize: 11 }}>{ps.month}/{ps.year}</span>
                    <span className="font-mono" style={{ fontSize: 11 }}>{fmtKes(ps.grossPay)}</span>
                    <span className="font-mono" style={{ fontSize: 11, color: '#EF4444' }}>{fmtKes(ps.deductions)}</span>
                    <span className="font-mono font-semibold" style={{ fontSize: 11, color: '#059669' }}>{fmtKes(ps.netPay)}</span>
                    <span><Badge status={ps.status === 'published' ? 'posted' : 'draft'} label={ps.status} /></span>
                    <span className="flex gap-1 items-center">
                      {ps.status === 'published' && (
                        <>
                          <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: '#1B2762', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => printPayslipPdf(ps.id)}><Fa icon={faPrint} style={{ fontSize: 9 }} /> Print</button>
                          <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: '#1B2762', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => downloadPayslipPdf(ps.id)}><Fa icon={faDownload} style={{ fontSize: 9 }} /> PDF</button>
                        </>
                      )}
                    </span>
                  </div>
                )
              })}
            </Table>
          </div>

          {/* Payroll → Accounting journal postings */}
          {payrollJournals.length > 0 && (
            <div className="card overflow-hidden">
              <PanelHeader title="Payroll → Accounting Journal Postings" count={payrollJournals.length} />
              <div className="p-4 space-y-3 text-[12px]">
                {payrollJournals.map(item => (
                  <div key={item.run.id} className="rounded-xl p-3" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                    <div className="flex justify-between items-center">
                      <div>
                        <div style={{ fontWeight: 700, color: '#111827' }}>{item.run.ref}</div>
                        <div style={{ color: '#6B7280' }}>Journal: {item.journal?.ref ?? '—'} · Posted {fmtDate(item.journal?.date ?? '')}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold" style={{ color: '#059669' }}>{fmtKes(item.run.totalNet)}</div>
                        <div style={{ color: '#9CA3AF', fontSize: 10 }}>Net pay</div>
                      </div>
                    </div>
                    {item.journal && (
                      <div className="mt-2 space-y-1">
                        {item.journal.lines.map(line => (
                          <div key={line.id} className="flex justify-between text-[11px]" style={{ color: '#4B5563' }}>
                            <span>{line.account}</span>
                            <span>{line.debit > 0 ? `Dr ${fmtKes(line.debit)}` : `Cr ${fmtKes(line.credit)}`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: DOCUMENTS
      ════════════════════════════════════════════ */}
      {tab === 'documents' && (
        <div className="flex flex-col gap-3">
          <div className="card overflow-hidden">
            <PanelHeader title="HR Documents" count={hrDocuments.filter(d => {
              const s = docSearch.toLowerCase()
              const emp = employees.find(e => e.id === d.employeeId)
              return !s || d.title.toLowerCase().includes(s) || d.type.toLowerCase().includes(s) ||
                (emp?.fullName ?? '').toLowerCase().includes(s)
            }).length}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 180 }}
                placeholder="Search employee, title…" value={docSearch} onChange={e => setDocSearch(e.target.value)} />
              <button className="btn-primary text-[11px]" disabled={!canManageHR} onClick={() => setShowDocumentModal(true)}>+ Add Document</button>
            </PanelHeader>
            <Table cols={[
              { label: 'Employee', width: '1.2fr' },
              { label: 'Type', width: '0.9fr' },
              { label: 'Document Title', width: '1.6fr' },
              { label: 'Recorded', width: '0.9fr' },
              { label: 'Expiry', width: '0.9fr' },
              { label: 'Uploaded By', width: '1fr' },
              { label: 'Visibility', width: '1fr' },
              { label: 'Status', width: '0.8fr' },
            ]}>
              {hrDocuments.filter(d => {
                const s = docSearch.toLowerCase()
                const emp = employees.find(e => e.id === d.employeeId)
                return !s || d.title.toLowerCase().includes(s) || d.type.toLowerCase().includes(s) ||
                  (emp?.fullName ?? '').toLowerCase().includes(s)
              }).map(doc => {
                const emp = employees.find(e => e.id === doc.employeeId)
                const isExpiringSoon = doc.expiryDate && !doc.status.includes('expired') &&
                  new Date(doc.expiryDate) < new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                return (
                  <div key={doc.id} className="table-row">
                    <span style={{ fontWeight: 600, color: '#111827' }}>{emp?.fullName ?? 'Unknown'}</span>
                    <span>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 500, background: 'rgba(139,92,246,0.1)', color: '#5B21B6', textTransform: 'capitalize' }}>
                        {doc.type.replace(/_/g, ' ')}
                      </span>
                    </span>
                    <span>
                      <div style={{ color: '#111827' }}>{doc.title}</div>
                      {doc.fileName && <div style={{ color: '#9CA3AF', fontSize: 10 }}>{doc.fileName}</div>}
                    </span>
                    <span style={{ fontSize: 11 }}>{doc.uploadedDate ? fmtDate(doc.uploadedDate) : '—'}</span>
                    <span style={{ fontSize: 11, color: isExpiringSoon ? '#F59E0B' : undefined, fontWeight: isExpiringSoon ? 600 : 400 }}>
                      {doc.expiryDate ? fmtDate(doc.expiryDate) : '—'}
                      {isExpiringSoon && <div style={{ fontSize: 9, color: '#F59E0B' }}>Expiring soon</div>}
                    </span>
                    <span style={{ fontSize: 11, color: '#6B7280' }}>{doc.uploadedByName ?? '—'}</span>
                    <span style={{ textTransform: 'capitalize', fontSize: 11 }}>{doc.visibility.replace(/_/g, ' ')}</span>
                    <span>
                      <Badge
                        status={doc.status === 'active' ? 'active' : doc.status === 'expiring' ? 'pending' : 'cancelled'}
                        label={doc.status}
                      />
                    </span>
                  </div>
                )
              })}
            </Table>
          </div>

          {/* Expiry alerts */}
          {hrDocuments.some(d => d.expiryDate && new Date(d.expiryDate) < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)) && (
            <div className="rounded-xl p-4" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <p className="text-xs font-bold mb-2 flex items-center gap-2" style={{ color: '#92400E' }}><Fa icon={faTriangleExclamation} /> Documents expiring within 90 days</p>
              <div className="space-y-2">
                {hrDocuments
                  .filter(d => d.expiryDate && new Date(d.expiryDate) < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000))
                  .map(doc => {
                    const emp = employees.find(e => e.id === doc.employeeId)
                    const daysLeft = Math.ceil((new Date(doc.expiryDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    return (
                      <div key={doc.id} className="flex items-center justify-between text-[11px]" style={{ color: '#92400E' }}>
                        <span>{emp?.fullName} — {doc.title}</span>
                        <span className="font-bold">{daysLeft} days left</span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: ASSETS
      ════════════════════════════════════════════ */}
      {tab === 'assets' && (
        <div className="flex flex-col gap-3">
          <div className="card overflow-hidden">
            <PanelHeader title="Employee Asset Assignments" count={employeeAssetAssignments.filter(a => {
              const s = assetSearch.toLowerCase()
              return !s || a.employeeName.toLowerCase().includes(s) || a.productName.toLowerCase().includes(s) ||
                (a.serialNumber ?? '').toLowerCase().includes(s)
            }).length}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 180 }}
                placeholder="Search employee, asset…" value={assetSearch} onChange={e => setAssetSearch(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn-primary text-[11px]" disabled={!canManageHR} onClick={() => setShowAssetModal(true)}>+ Assign Asset</button>
                <button className="btn-outline text-[11px]" disabled={!canManageHR} onClick={() => setShowAcknowledgeModal(true)}>Acknowledge</button>
                <button className="btn-outline text-[11px]" disabled={!canManageHR} onClick={() => setShowReturnAssetModal(true)}>Return</button>
                <button className="btn-outline text-[11px]" disabled={!canManageHR} onClick={() => setShowReassignAssetModal(true)}>Reassign</button>
              </div>
            </PanelHeader>
            <Table cols={[
              { label: 'Employee', width: '1.2fr' },
              { label: 'Asset', width: '1.2fr' },
              { label: 'Serial / Qty', width: '1fr' },
              { label: 'Condition', width: '0.8fr' },
              { label: 'Assigned', width: '0.9fr' },
              { label: 'Acknowledged', width: '1.1fr' },
              { label: 'Return Date', width: '0.9fr' },
              { label: 'Status', width: '0.8fr' },
              { label: 'Actions', width: '1.4fr' },
            ]}>
              {employeeAssetAssignments.filter(a => {
                const s = assetSearch.toLowerCase()
                return !s || a.employeeName.toLowerCase().includes(s) || a.productName.toLowerCase().includes(s) ||
                  (a.serialNumber ?? '').toLowerCase().includes(s)
              }).map(a => (
                <div key={a.id} className="table-row">
                  <span style={{ fontWeight: 600, color: '#111827' }}>{a.employeeName}</span>
                  <span>
                    <div style={{ color: '#111827' }}>{a.productName}</div>
                    {a.handoverNotes && <div style={{ color: '#9CA3AF', fontSize: 10 }} className="truncate">{a.handoverNotes}</div>}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{a.serialNumber ?? `×${a.qty}`}</span>
                  <span style={{ textTransform: 'capitalize', fontSize: 11 }}>{a.handoverCondition}</span>
                  <span style={{ fontSize: 11 }}>{fmtDate(a.assignedDate)}</span>
                  <span>
                    {a.acknowledgedByEmployee
                      ? <span className="flex items-center gap-1" style={{ color: '#059669', fontSize: 11 }}><Fa icon={faCircleCheck} style={{ fontSize: 10 }} /> {fmtDate(a.acknowledgmentDate ?? '')}</span>
                      : <span className="flex items-center gap-1" style={{ color: '#F59E0B', fontSize: 11 }}><Fa icon={faCircleExclamation} style={{ fontSize: 10 }} /> Pending</span>}
                  </span>
                  <span style={{ fontSize: 11, color: a.returnedDate ? '#6B7280' : '#9CA3AF' }}>
                    {a.returnedDate ? fmtDate(a.returnedDate) : '—'}
                    {a.returnCondition && <div style={{ fontSize: 10, textTransform: 'capitalize' }}>{a.returnCondition}</div>}
                  </span>
                  <span>
                    <Badge
                      status={a.status === 'assigned' ? 'active' : a.status === 'reassigned' ? 'pending' : 'cancelled'}
                      label={a.status}
                    />
                  </span>
                  <span className="flex gap-1 flex-wrap">
                    {a.status === 'assigned' && !a.acknowledgedByEmployee && canManageHR && (
                      <button style={{ background: '#F0FDF4', border: 'none', borderRadius: 6, color: '#059669', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500 }} onClick={() => { setAckForm({ assignmentId: a.id, notes: '' }); setShowAcknowledgeModal(true) }}>Ack</button>
                    )}
                    {a.status === 'assigned' && canManageHR && (
                      <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: '#1B2762', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500 }} onClick={() => { setReturnForm({ assignmentId: a.id, returnLocation: 'warehouse', condition: 'good', notes: '' }); setShowReturnAssetModal(true) }}>Return</button>
                    )}
                    {a.status === 'assigned' && canManageHR && (
                      <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: '#1B2762', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500 }} onClick={() => { setReassignForm({ assignmentId: a.id, employeeId: '' }); setShowReassignAssetModal(true) }}>Reassign</button>
                    )}
                  </span>
                </div>
              ))}
            </Table>
          </div>

          <div className="card overflow-hidden">
            <PanelHeader title="Assignable Inventory Items" count={assignableProducts.length} />
            <Table cols={[
              { label: 'Item', width: '1.5fr' },
              { label: 'Category', width: '1fr' },
              { label: 'Serial Tracked', width: '0.9fr' },
              { label: 'Available', width: '0.8fr' },
            ]}>
              {assignableProducts.map(p => (
                <div key={p.id} className="table-row">
                  <span style={{ fontWeight: 600, color: '#111827' }}>{p.name}</span>
                  <span style={{ fontSize: 11 }}>{p.category}</span>
                  <span style={{ fontSize: 11 }}>
                    {p.requiresSerial
                      ? <span className="flex items-center gap-1" style={{ color: '#1B2762' }}><Fa icon={faCircleCheck} style={{ fontSize: 10 }} /> Serial</span>
                      : <span style={{ color: '#9CA3AF' }}>No</span>}
                  </span>
                  <span>
                    <span className="badge badge-green" style={{ fontSize: 10 }}>
                      {p.requiresSerial
                        ? `${serials.filter(s => s.productId === p.id && s.status === 'available').length} units`
                        : `${p.stockQty} units`}
                    </span>
                  </span>
                </div>
              ))}
            </Table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: SELF SERVICE
      ════════════════════════════════════════════ */}
      {tab === 'self_service' && (
        <div className="flex flex-col gap-3">
          {!myEmployee ? (
            <div className="card p-8 text-center flex flex-col items-center gap-3" style={{ color: '#6B7280' }}>
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#F3F4F6' }}>
                <Fa icon={faLink} style={{ fontSize: 22, color: '#9CA3AF' }} />
              </div>
              <div className="font-semibold text-t1">No employee profile linked</div>
              <div className="text-sm">Your user account is not linked to an employee record. Ask your administrator to link your account.</div>
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-3">
              {/* Left column */}
              <div className="flex flex-col gap-3 flex-1 min-w-0">
                {/* My Profile */}
                <div className="card p-4">
                  <p className="text-xs font-bold text-t1 mb-3">My Profile</p>
                  <div className="space-y-2 text-[12px]">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: '#E8F3FA', color: '#1B2762' }}>
                        {myEmployee.fullName.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, color: '#111827' }}>{myEmployee.fullName}</div>
                        <div style={{ color: '#6B7280' }}>{myEmployee.jobTitle} · {myDepartment?.name}</div>
                      </div>
                    </div>
                    <div className="pt-2 space-y-1.5" style={{ color: '#6B7280' }}>
                      <div className="flex items-center gap-2"><Fa icon={faEnvelope} style={{ fontSize: 11, color: '#9CA3AF', width: 14 }} fixedWidth />{myEmployee.email}</div>
                      <div className="flex items-center gap-2"><Fa icon={faPhone} style={{ fontSize: 11, color: '#9CA3AF', width: 14 }} fixedWidth />{myEmployee.phone}</div>
                      <div className="flex items-center gap-2"><Fa icon={faBuildingColumns} style={{ fontSize: 11, color: '#9CA3AF', width: 14 }} fixedWidth />Bank: {maskSensitive(myEmployee.bankAccount)}</div>
                      <div className="flex items-center gap-2"><Fa icon={faIdCard} style={{ fontSize: 11, color: '#9CA3AF', width: 14 }} fixedWidth />ID: {maskSensitive(myEmployee.nationalId)} · KRA: {maskSensitive(myEmployee.kraPin)}</div>
                      <div className="flex items-center gap-2"><Fa icon={faCalendarDays} style={{ fontSize: 11, color: '#9CA3AF', width: 14 }} fixedWidth />Started: {fmtDate(myEmployee.startDate)}</div>
                    </div>
                    <div className="pt-1">
                      <Badge status={myEmployee.status === 'active' ? 'active' : 'pending'} label={myEmployee.status.replace('_', ' ')} />
                    </div>
                  </div>
                </div>

                {/* My Performance This Month */}
                <div className="card p-4">
                  <p className="text-xs font-bold text-t1 mb-3">
                    My Performance — {new Date().toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {myPerf.type === 'tech' && (<>
                      <div className="rounded-xl p-3" style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Completed this month</p>
                        <p className="text-[22px] font-bold" style={{ color: '#1B2762' }}>{myPerf.completed}</p>
                        <p className="text-[10px] text-t3">repairs closed/delivered</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#F5F3FF', border: '1px solid #DDD6FE' }}>
                        <p className="text-[10px] text-t3 mb-0.5">In progress now</p>
                        <p className="text-[22px] font-bold" style={{ color: '#7C3AED' }}>{myPerf.inProgress}</p>
                        <p className="text-[10px] text-t3">in repair / QC</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Diagnosed this month</p>
                        <p className="text-[22px] font-bold" style={{ color: '#059669' }}>{myPerf.diagnosed}</p>
                        <p className="text-[10px] text-t3">diagnoses logged</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Open jobs</p>
                        <p className="text-[22px] font-bold" style={{ color: '#C2410C' }}>{myPerf.openTotal}</p>
                        <p className="text-[10px] text-t3">assigned to me</p>
                      </div>
                    </>)}

                    {myPerf.type === 'sales' && (<>
                      <div className="rounded-xl p-3" style={{ background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Orders fulfilled</p>
                        <p className="text-[22px] font-bold" style={{ color: '#059669' }}>{myPerf.orders}</p>
                        <p className="text-[10px] text-t3">confirmed / delivered</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Revenue this month</p>
                        <p className="text-[18px] font-bold leading-tight" style={{ color: '#1B2762' }}>{fmtKes(myPerf.revenue)}</p>
                        <p className="text-[10px] text-t3">from my orders</p>
                      </div>
                      <div className="rounded-xl p-3 col-span-2" style={{ background: '#F0F9FF', border: '1px solid #BAE6FD' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Quotes &amp; orders created</p>
                        <p className="text-[22px] font-bold" style={{ color: '#0369A1' }}>{myPerf.quotes}</p>
                        <p className="text-[10px] text-t3">this month (all statuses)</p>
                      </div>
                    </>)}

                    {myPerf.type === 'kilimall' && (<>
                      <div className="rounded-xl p-3" style={{ background: '#FDF4FF', border: '1px solid #E9D5FF' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Orders processed</p>
                        <p className="text-[22px] font-bold" style={{ color: '#7E22CE' }}>{myPerf.total}</p>
                        <p className="text-[10px] text-t3">this month</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Dispatched</p>
                        <p className="text-[22px] font-bold" style={{ color: '#059669' }}>{myPerf.dispatched}</p>
                        <p className="text-[10px] text-t3">dispatched / delivered</p>
                      </div>
                    </>)}

                    {myPerf.type === 'general' && (<>
                      <div className="rounded-xl p-3" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Expenses this month</p>
                        <p className="text-[22px] font-bold" style={{ color: '#92400E' }}>{myPerf.expCount}</p>
                        <p className="text-[10px] text-t3">submitted</p>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}>
                        <p className="text-[10px] text-t3 mb-0.5">Expenses amount</p>
                        <p className="text-[18px] font-bold leading-tight" style={{ color: '#C2410C' }}>{fmtKes(myPerf.expAmount)}</p>
                        <p className="text-[10px] text-t3">total claimed</p>
                      </div>
                    </>)}
                  </div>
                </div>

                {/* Leave balances */}
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-t1">My Leave Balances ({new Date().getFullYear()})</p>
                    <button
                      className="btn-primary text-[11px]"
                      onClick={() => setShowSelfLeaveModal(true)}
                    >
                      + Book Leave
                    </button>
                  </div>
                  {myLeaveBalances.length === 0 ? (
                    <p className="text-xs text-t3">No leave balances configured. Contact HR.</p>
                  ) : (
                    <div className="space-y-2">
                      {myLeaveBalances.map(bal => {
                        const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
                        const pct = Math.max(0, Math.min(100, (available / (bal.entitlement + bal.carryForward)) * 100))
                        return (
                          <div key={bal.id} className="rounded-lg p-3" style={{ background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                            <div className="flex justify-between mb-1 text-[12px]">
                              <span style={{ fontWeight: 600, color: '#374151', textTransform: 'capitalize' }}>
                                {bal.leaveType.replace(/_/g, ' ')}
                              </span>
                              <span style={{ fontWeight: 700, color: available > 0 ? '#059669' : '#EF4444' }}>
                                {available} / {bal.entitlement + bal.carryForward} days
                              </span>
                            </div>
                            <div className="w-full rounded-full h-1.5" style={{ background: '#E5E7EB' }}>
                              <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: available > 3 ? '#10B981' : '#F59E0B' }} />
                            </div>
                            <div className="flex gap-3 mt-1 text-[10px]" style={{ color: '#9CA3AF' }}>
                              <span>Used: {bal.used}d</span>
                              {bal.pending > 0 && <span style={{ color: '#F59E0B' }}>Pending: {bal.pending}d</span>}
                              {bal.carryForward > 0 && <span>Carry-fwd: {bal.carryForward}d</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* My assigned assets */}
                {myAssets.length > 0 && (
                  <div className="card overflow-hidden">
                    <PanelHeader title="My Assigned Assets" count={myAssets.length} />
                    <Table cols={[
                      { label: 'Asset', width: '1.4fr' },
                      { label: 'Serial / Qty', width: '1fr' },
                      { label: 'Condition', width: '0.9fr' },
                      { label: 'Assigned', width: '0.9fr' },
                      { label: 'Acknowledged', width: '1fr' },
                    ]}>
                      {myAssets.map(a => (
                        <div key={a.id} className="table-row">
                          <span style={{ fontWeight: 600, color: '#111827' }}>{a.productName}</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{a.serialNumber ?? `×${a.qty}`}</span>
                          <span style={{ textTransform: 'capitalize', fontSize: 11 }}>{a.handoverCondition}</span>
                          <span style={{ fontSize: 11 }}>{fmtDate(a.assignedDate)}</span>
                          <span>
                            {a.acknowledgedByEmployee
                              ? <span className="flex items-center gap-1" style={{ color: '#059669', fontSize: 11 }}><Fa icon={faCircleCheck} style={{ fontSize: 10 }} /> {fmtDate(a.acknowledgmentDate ?? '')}</span>
                              : <span className="flex items-center gap-1" style={{ color: '#F59E0B', fontSize: 11 }}><Fa icon={faCircleExclamation} style={{ fontSize: 10 }} /> Pending</span>}
                          </span>
                        </div>
                      ))}
                    </Table>
                  </div>
                )}
              </div>

              {/* Right column */}
              <div className="flex flex-col gap-3 lg:flex-[1.2] min-w-0">
                {/* My leave requests */}
                <div className="card overflow-hidden">
                  <PanelHeader title="My Leave History" count={myLeaves.length}>
                    <button className="btn-primary text-[11px]" onClick={() => setShowSelfLeaveModal(true)}>+ Book Leave</button>
                  </PanelHeader>
                  {myLeaves.length === 0 ? (
                    <div className="p-4 text-xs text-t3 text-center">No leave requests yet. Click &quot;Book Leave&quot; to submit a request.</div>
                  ) : (
                    <Table cols={[
                      { label: 'Ref', width: '0.8fr' },
                      { label: 'Leave Type', width: '1.2fr' },
                      { label: 'From', width: '0.9fr' },
                      { label: 'To', width: '0.9fr' },
                      { label: 'Days', width: '0.5fr' },
                      { label: 'Reason', width: '1.5fr' },
                      { label: 'Status', width: '0.9fr' },
                      { label: 'Decision', width: '1.3fr' },
                    ]}>
                      {myLeaves.map(req => (
                        <div key={req.id} className="table-row">
                          <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{req.ref}</span>
                          <span>{leaveTypeChip(req.leaveType)}</span>
                          <span style={{ fontSize: 11 }}>{fmtDate(req.startDate)}</span>
                          <span style={{ fontSize: 11 }}>{fmtDate(req.endDate)}</span>
                          <span style={{ fontWeight: 600 }}>{req.days}d</span>
                          <span style={{ fontSize: 11, color: '#6B7280' }} className="truncate">{req.reason || '—'}</span>
                          <span>{leaveBadge(req.status)}</span>
                          <span style={{ fontSize: 10 }}>
                            {req.hrApprovalBy ? (
                              <span className="flex items-center gap-1" style={{ color: req.status === 'approved' ? '#059669' : '#EF4444' }}>
                                {req.status === 'approved'
                                  ? <Fa icon={faCircleCheck} style={{ fontSize: 10 }} />
                                  : <Fa icon={faCircleXmark} style={{ fontSize: 10 }} />}
                                {req.hrApprovalBy} · {fmtDate(req.hrDecisionDate ?? '')}
                              </span>
                            ) : <span style={{ color: '#9CA3AF' }}>Awaiting HR</span>}
                          </span>
                        </div>
                      ))}
                    </Table>
                  )}
                </div>

                {/* My payslips */}
                <div className="card overflow-hidden">
                  <PanelHeader title="My Payslips" count={myPayslips.length} />
                  {myPayslips.length === 0 ? (
                    <div className="p-4 text-xs text-t3 text-center">No published payslips yet.</div>
                  ) : (
                    <Table cols={[
                      { label: 'Ref', width: '0.9fr' },
                      { label: 'Period', width: '0.7fr' },
                      { label: 'Gross Pay', width: '1fr' },
                      { label: 'Deductions', width: '1fr' },
                      { label: 'Net Pay', width: '1fr' },
                      { label: 'Status', width: '0.8fr' },
                      { label: 'Actions', width: '1.3fr' },
                    ]}>
                      {myPayslips.map(ps => (
                        <div key={ps.id} className="table-row">
                          <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{ps.ref}</span>
                          <span style={{ fontSize: 11 }}>{ps.month}/{ps.year}</span>
                          <span className="font-mono" style={{ fontSize: 11 }}>{fmtKes(ps.grossPay)}</span>
                          <span className="font-mono" style={{ fontSize: 11, color: '#EF4444' }}>{fmtKes(ps.deductions)}</span>
                          <span className="font-mono font-semibold" style={{ fontSize: 11, color: '#059669' }}>{fmtKes(ps.netPay)}</span>
                          <span><Badge status={ps.status === 'published' ? 'posted' : 'draft'} label={ps.status} /></span>
                          <span className="flex gap-1">
                            {ps.status === 'published' && (
                              <>
                                <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: '#1B2762', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => printPayslipPdf(ps.id)}><Fa icon={faPrint} style={{ fontSize: 9 }} /> Print</button>
                                <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: '#1B2762', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => downloadPayslipPdf(ps.id)}><Fa icon={faDownload} style={{ fontSize: 9 }} /> PDF</button>
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </Table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: SOPs
      ════════════════════════════════════════════ */}
      {tab === 'sops' && (
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-50">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-gray-800">Standard Operating Procedures</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">{sops.filter(s => s.status === 'active').length} active</span>
              </div>
              <div className="flex gap-2 items-center">
                <input className="form-input text-[11px] py-1.5" style={{ width: 180 }} placeholder="Search SOPs…" value={sopSearch} onChange={e => setSopSearch(e.target.value)} />
                {canManageHR && <button className="btn-primary text-[11px] whitespace-nowrap" onClick={openAddSop}>+ Add SOP</button>}
              </div>
            </div>

            {/* Category filter */}
            <div className="flex gap-2 overflow-x-auto px-5 py-3 scrollbar-hide border-b border-gray-50">
              <button onClick={() => setSopCatFilter('all')} className="flex-shrink-0 text-[10px] font-semibold px-3 py-1.5 rounded-full transition-all border" style={{ background: sopCatFilter === 'all' ? '#1B2762' : '#F9FAFB', color: sopCatFilter === 'all' ? '#fff' : '#6B7280', borderColor: sopCatFilter === 'all' ? '#1B2762' : '#E5E7EB' }}>All ({sops.length})</button>
              {SOP_CATEGORIES.map(c => {
                const count = sops.filter(s => s.category === c.id).length
                return (
                  <button key={c.id} onClick={() => setSopCatFilter(sopCatFilter === c.id ? 'all' : c.id)} className="flex-shrink-0 text-[10px] font-semibold px-3 py-1.5 rounded-full transition-all border" style={{ background: sopCatFilter === c.id ? c.bg : '#F9FAFB', color: sopCatFilter === c.id ? c.color : '#6B7280', borderColor: sopCatFilter === c.id ? c.border : '#E5E7EB' }}>{c.label} ({count})</button>
                )
              })}
            </div>

            {/* SOP list */}
            {(() => {
              const q = sopSearch.toLowerCase()
              const visible = sops.filter(s =>
                (sopCatFilter === 'all' || s.category === sopCatFilter) &&
                (!q || s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q))
              )
              if (visible.length === 0) return (
                <div className="py-14 text-center">
                  <Fa icon={faFileSignature} style={{ fontSize: 28, color: '#E5E7EB' }} />
                  <p className="text-[12px] text-gray-400 mt-3">{sops.length === 0 ? 'No SOPs yet. Click "+ Add SOP" to get started.' : 'No SOPs match your search.'}</p>
                </div>
              )
              return (
                <div className="divide-y divide-gray-50">
                  {visible.map(s => {
                    const cat = SOP_CATEGORIES.find(c => c.id === s.category)!
                    const open = sopExpanded.has(s.id)
                    return (
                      <div key={s.id}>
                        <div className="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => toggleSopExpand(s.id)}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: cat.bg }}>
                            <Fa icon={faFileSignature} style={{ fontSize: 12, color: cat.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-0.5">
                              <p className="text-[13px] font-semibold text-gray-900">{s.title}</p>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border" style={{ background: cat.bg, color: cat.color, borderColor: cat.border }}>{cat.label}</span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>{s.status}</span>
                              <span className="text-[9px] text-gray-400">v{s.version}</span>
                            </div>
                            <p className="text-[10.5px] text-gray-400">Updated {s.updatedAt} · By {s.createdByName}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {canManageHR && (
                              <>
                                <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1B2762] border border-blue-100 cursor-pointer transition-colors" onClick={e => { e.stopPropagation(); openEditSop(s) }}>Edit</button>
                                <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 cursor-pointer transition-colors" onClick={e => { e.stopPropagation(); deleteSop(s.id) }}>Del</button>
                              </>
                            )}
                            <Fa icon={open ? faChevronUp : faChevronDown} style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 4 }} />
                          </div>
                        </div>
                        {open && (
                          <div className="px-5 pb-5 ml-11">
                            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                              <p className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap">{s.content}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: PERFORMANCE TARGETS
      ════════════════════════════════════════════ */}
      {tab === 'performance' && (
        <div className="flex flex-col gap-4">
          {/* Summary stats — scoped to current user when not admin */}
          {(() => {
            const scopedTargets = isAdmin ? targets : targets.filter(t => t.employeeId === myEmployee?.id)
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(['on_track', 'at_risk', 'achieved', 'missed'] as PerfStatus[]).map(s => {
                  const st = PERF_STATUS[s]
                  const count = scopedTargets.filter(t => t.status === s).length
                  return (
                    <div key={s} className="bg-white rounded-2xl border p-4 flex items-center gap-3 cursor-pointer transition-all hover:shadow-sm" style={{ borderColor: perfFilter === s ? st.border : '#F3F4F6' }} onClick={() => setPerfFilter(perfFilter === s ? 'all' : s)}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: st.bg }}>
                        <span className="text-base font-bold" style={{ color: st.color }}>{count}</span>
                      </div>
                      <div>
                        <p className="text-[11px] font-bold" style={{ color: st.color }}>{st.label}</p>
                        <p className="text-[10px] text-gray-400">targets</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Controls */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-50">
              <span className="text-[13px] font-bold text-gray-800">
                {isAdmin ? 'Performance Targets' : 'My Performance Targets'}
              </span>
              <div className="flex gap-2 flex-wrap">
                {isAdmin && (
                  <select className="form-input text-[11px] py-1.5" style={{ width: 160 }} value={perfEmpFilter} onChange={e => setPerfEmpFilter(e.target.value)}>
                    <option value="">All Employees</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                  </select>
                )}
                <select className="form-input text-[11px] py-1.5" style={{ width: 120 }} value={perfFilter} onChange={e => setPerfFilter(e.target.value as any)}>
                  <option value="all">All Statuses</option>
                  {(Object.keys(PERF_STATUS) as PerfStatus[]).map(s => <option key={s} value={s}>{PERF_STATUS[s].label}</option>)}
                </select>
                {canManageHR && <button className="btn-primary text-[11px] whitespace-nowrap" onClick={openAddTarget}>+ Add Target</button>}
              </div>
            </div>

            {/* Targets list */}
            {(() => {
              const visible = (isAdmin ? targets : targets.filter(t => t.employeeId === myEmployee?.id)).filter(t =>
                (perfFilter === 'all' || t.status === perfFilter) &&
                (isAdmin ? (!perfEmpFilter || t.employeeId === perfEmpFilter) : true)
              )
              if (visible.length === 0) return (
                <div className="py-14 text-center">
                  <Fa icon={faChartLine} style={{ fontSize: 28, color: '#E5E7EB' }} />
                  <p className="text-[12px] text-gray-400 mt-3">{targets.length === 0 ? 'No targets set yet. Click "+ Add Target" to get started.' : 'No targets match your filters.'}</p>
                </div>
              )
              return (
                <div className="divide-y divide-gray-50">
                  {visible.map(t => {
                    const st = PERF_STATUS[t.status]
                    const pct = t.targetValue > 0 ? Math.min(100, Math.round((t.currentValue / t.targetValue) * 100)) : 0
                    return (
                      <div key={t.id} className="p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-0.5">
                              <p className="text-[13px] font-bold text-gray-900">{t.metric}</p>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border" style={{ background: st.bg, color: st.color, borderColor: st.border }}>{st.label}</span>
                            </div>
                            <p className="text-[11px] text-gray-500">{t.employeeName} · {t.periodLabel || t.period} · Due {fmtDate(t.dueDate)}</p>
                            {t.description && <p className="text-[11px] text-gray-400 mt-0.5">{t.description}</p>}
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-green-50 hover:bg-green-100 text-green-700 border border-green-100 cursor-pointer whitespace-nowrap" onClick={() => { setUpdateTargetId(t.id); setUpdateValue(String(t.currentValue)); setShowUpdateModal(true) }}>Update</button>
                            {canManageHR && (
                              <>
                                <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1B2762] border border-blue-100 cursor-pointer" onClick={() => openEditTarget(t)}>Edit</button>
                                <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 cursor-pointer" onClick={() => deleteTarget(t.id)}>Del</button>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: st.color }} />
                          </div>
                          <span className="text-[11px] font-mono font-semibold text-gray-700 whitespace-nowrap flex-shrink-0">
                            {t.unit === 'KES' ? fmtKes(t.currentValue) : `${t.currentValue}${t.unit !== 'count' ? ' ' + t.unit : ''}`}
                            <span className="text-gray-400 font-normal"> / {t.unit === 'KES' ? fmtKes(t.targetValue) : `${t.targetValue}${t.unit !== 'count' ? ' ' + t.unit : ''}`}</span>
                            <span className="ml-1 text-[10px]" style={{ color: st.color }}>({pct}%)</span>
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: REPORTS
      ════════════════════════════════════════════ */}
      {tab === 'reports' && (
        <div className="grid grid-cols-2 gap-3">
          {/* Headcount by department */}
          <div className="card overflow-hidden">
            <PanelHeader title="Headcount by Department" count={departments.length} />
            <div className="p-4 flex flex-col gap-2">
              {departments.map(dep => {
                const count = employees.filter(e => e.departmentId === dep.id).length
                const totalPayroll = employees.filter(e => e.departmentId === dep.id).reduce((s, e) => s + e.basicSalary + e.housingAllowance + e.transportAllowance, 0)
                return (
                  <div key={dep.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
                    <div>
                      <p className="text-xs font-semibold text-t1">{dep.name}</p>
                      <p className="text-[10px] text-t3">{dep.description}</p>
                      <p className="text-[10px] text-t3 mt-0.5 font-mono">Gross payroll: {fmtKes(totalPayroll)}</p>
                    </div>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-base" style={{ background: '#E8F3FA', color: '#1B2762' }}>{count}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {/* Payroll summary */}
            <div className="card p-4">
              <p className="text-xs font-semibold text-t1 mb-3">Payroll Summary</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total Net Payroll', value: fmtKes(payrollRuns.filter(r => r.status === 'posted').reduce((s, r) => s + r.totalNet, 0)), color: '#10B981' },
                  { label: 'Total Gross Payroll', value: fmtKes(payrollRuns.filter(r => r.status === 'posted').reduce((s, r) => s + r.totalGross, 0)), color: '#1B2762' },
                  { label: 'Total Deductions', value: fmtKes(payrollRuns.filter(r => r.status === 'posted').reduce((s, r) => s + r.totalDeductions, 0)), color: '#F59E0B' },
                  { label: 'Journal Entries', value: journalEntries.filter(j => j.source === 'payroll').length, color: '#0891B2' },
                ].map(item => (
                  <div key={item.label} className="rounded-xl p-3" style={{ background: item.color + '10', border: `1px solid ${item.color}20` }}>
                    <p className="text-[9px] uppercase tracking-wider font-medium mb-1" style={{ color: item.color }}>{item.label}</p>
                    <p className="text-sm font-bold text-t1">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Leave summary */}
            <div className="card p-4">
              <p className="text-xs font-semibold text-t1 mb-3">Leave Summary</p>
              <div className="flex flex-col gap-2 text-xs">
                {[
                  { label: 'Approved', count: leaveRequests.filter(r => r.status === 'approved').length, color: '#10B981' },
                  { label: 'Pending HR Approval', count: leaveRequests.filter(r => r.status === 'pending_hr').length, color: '#F59E0B' },
                  { label: 'Rejected', count: leaveRequests.filter(r => r.status === 'rejected').length, color: '#EF4444' },
                  { label: 'Total Requests', count: leaveRequests.length, color: '#6B7280' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-1 border-b" style={{ borderColor: '#F3F4F6' }}>
                    <span className="text-t2">{item.label}</span>
                    <span className="font-bold" style={{ color: item.color }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Payroll pending */}
            <div className="card p-4">
              <p className="text-xs font-semibold text-t1 mb-3">Payroll Status Breakdown</p>
              <div className="flex flex-col gap-2 text-xs">
                {[
                  { label: 'Draft', count: payrollRuns.filter(r => r.status === 'draft').length, color: '#9CA3AF' },
                  { label: 'Pending Approval', count: payrollRuns.filter(r => r.status === 'pending_approval').length, color: '#F59E0B' },
                  { label: 'Approved', count: payrollRuns.filter(r => r.status === 'approved').length, color: '#1B2762' },
                  { label: 'Posted to Accounting', count: payrollRuns.filter(r => r.status === 'posted').length, color: '#10B981' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-1 border-b" style={{ borderColor: '#F3F4F6' }}>
                    <span className="text-t2">{item.label}</span>
                    <span className="font-bold" style={{ color: item.color }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      </TabContent>

      {/* ═══════════════════════════════════
          MODALS
      ═══════════════════════════════════ */}

      {/* ── SOP Modal ── */}
      {showSopModal && (
        <Modal title={editSopId ? 'Edit SOP' : 'Add SOP'} onClose={() => setShowSopModal(false)} width={640}>
          <div className="flex flex-col gap-3">
            <Field label="Title" required><Input value={sopForm.title} onChange={v => setSopForm(p => ({ ...p, title: v }))} placeholder="e.g. New Employee Onboarding Process" /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Category">
                <Select value={sopForm.category} onChange={v => setSopForm(p => ({ ...p, category: v as SOPCategory }))} options={SOP_CATEGORIES.map(c => ({ value: c.id, label: c.label }))} />
              </Field>
              <Field label="Status">
                <Select value={sopForm.status} onChange={v => setSopForm(p => ({ ...p, status: v as 'active' | 'draft' }))} options={[{ value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }]} />
              </Field>
              <Field label="Version"><Input value={sopForm.version} onChange={v => setSopForm(p => ({ ...p, version: v }))} placeholder="1.0" /></Field>
            </div>
            <Field label="Content / Procedure Steps" required hint="Describe the procedure steps clearly">
              <Textarea value={sopForm.content} onChange={v => setSopForm(p => ({ ...p, content: v }))} rows={8} placeholder="Step 1. …&#10;Step 2. …&#10;Step 3. …" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowSopModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={!sopForm.title.trim() || !sopForm.content.trim()} onClick={submitSop}>
              {editSopId ? 'Save Changes' : 'Add SOP'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Performance Target Modal ── */}
      {showPerfModal && (
        <Modal title={editPerfId ? 'Edit Target' : 'Add Performance Target'} onClose={() => setShowPerfModal(false)} width={580}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Field label="Employee" required>
                <Select value={perfForm.employeeId} onChange={v => setPerfForm(p => ({ ...p, employeeId: v }))} options={[{ value: '', label: 'Select employee…' }, ...employees.map(e => ({ value: e.id, label: e.fullName }))]} />
              </Field>
            </div>
            <Field label="Metric / KPI" required hint="e.g. Monthly Sales Revenue"><Input value={perfForm.metric} onChange={v => setPerfForm(p => ({ ...p, metric: v }))} placeholder="e.g. Repair Jobs Completed" /></Field>
            <Field label="Unit"><Input value={perfForm.unit} onChange={v => setPerfForm(p => ({ ...p, unit: v }))} placeholder="KES, %, jobs, units…" /></Field>
            <Field label="Target Value" required><Input type="number" value={perfForm.targetValue} onChange={v => setPerfForm(p => ({ ...p, targetValue: v }))} /></Field>
            <Field label="Current Value"><Input type="number" value={perfForm.currentValue} onChange={v => setPerfForm(p => ({ ...p, currentValue: v }))} /></Field>
            <Field label="Period">
              <Select value={perfForm.period} onChange={v => setPerfForm(p => ({ ...p, period: v as PerfPeriod }))} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'annual', label: 'Annual' }]} />
            </Field>
            <Field label="Period Label" hint="e.g. April 2026, Q2 2026"><Input value={perfForm.periodLabel} onChange={v => setPerfForm(p => ({ ...p, periodLabel: v }))} placeholder="April 2026" /></Field>
            <Field label="Due Date"><Input type="date" value={perfForm.dueDate} onChange={v => setPerfForm(p => ({ ...p, dueDate: v }))} /></Field>
            <Field label="Status">
              <Select value={perfForm.status} onChange={v => setPerfForm(p => ({ ...p, status: v as PerfStatus }))} options={(Object.keys(PERF_STATUS) as PerfStatus[]).map(s => ({ value: s, label: PERF_STATUS[s].label }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description / Notes"><Input value={perfForm.description} onChange={v => setPerfForm(p => ({ ...p, description: v }))} placeholder="Optional context or notes" /></Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowPerfModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={!perfForm.employeeId || !perfForm.metric || !perfForm.targetValue} onClick={submitTarget}>
              {editPerfId ? 'Save Changes' : 'Add Target'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Update Progress Modal ── */}
      {showUpdateModal && (() => {
        const t = targets.find(x => x.id === updateTargetId)
        if (!t) return null
        const pct = t.targetValue > 0 ? Math.min(100, Math.round((Number(updateValue) / t.targetValue) * 100)) : 0
        return (
          <Modal title={`Update: ${t.metric}`} onClose={() => setShowUpdateModal(false)} width={420}>
            <p className="text-[12px] text-gray-500 mb-4">{t.employeeName} · Target: <strong>{t.unit === 'KES' ? fmtKes(t.targetValue) : `${t.targetValue} ${t.unit}`}</strong></p>
            <Field label="Current Value" required>
              <Input type="number" value={updateValue} onChange={setUpdateValue} placeholder="Enter current progress…" />
            </Field>
            {updateValue && (
              <div className="mt-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all bg-[#1B2762]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-[#1B2762]">{pct}%</span>
                </div>
                <p className="text-[11px] text-gray-400">
                  {pct >= 100 ? '🎉 Target achieved!' : pct >= 70 ? '✅ On track' : pct >= 40 ? '⚠ At risk' : '❌ Behind target'}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-outline" onClick={() => setShowUpdateModal(false)}>Cancel</button>
              <button className="btn-primary" disabled={!updateValue} onClick={submitUpdate}>Save Progress</button>
            </div>
          </Modal>
        )
      })()}

      {/* Add Employee + System Access (combined) */}
      {showEmployeeModal && (
        <Modal title="Add Employee" subtitle="Creates the employee profile and system login in one step" onClose={() => { setShowEmployeeModal(false); setEmployeeForm(blankEmployeeForm) }} width={760}>
          <div className="max-h-[72vh] overflow-y-auto pr-1 flex flex-col gap-4">

            {/* ── Section 1: Personal Details ── */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Personal Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Full Name" required><Input value={employeeForm.fullName} onChange={v => setEmployeeForm(p => ({ ...p, fullName: v }))} placeholder="e.g. Jane Wanjiku" /></Field>
                <Field label="Email" required hint="Becomes the login username"><Input value={employeeForm.email} onChange={v => setEmployeeForm(p => ({ ...p, email: v }))} type="email" /></Field>
                <Field label="Phone"><Input value={employeeForm.phone} onChange={v => setEmployeeForm(p => ({ ...p, phone: v }))} type="tel" placeholder="+254700000000" /></Field>
                <Field label="National ID"><Input value={employeeForm.nationalId} onChange={v => setEmployeeForm(p => ({ ...p, nationalId: v }))} /></Field>
                <Field label="KRA PIN"><Input value={employeeForm.kraPin} onChange={v => setEmployeeForm(p => ({ ...p, kraPin: v }))} placeholder="A123456789X" /></Field>
                <Field label="Employee No"><Input value={employeeForm.employeeNo} onChange={v => setEmployeeForm(p => ({ ...p, employeeNo: v }))} placeholder="EMP-001" /></Field>
              </div>
            </div>

            {/* ── Section 2: Employment ── */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Employment</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Department">
                  <Select value={employeeForm.departmentId} onChange={v => setEmployeeForm(p => ({ ...p, departmentId: v }))}
                    options={[{ value: '', label: '— None —' }, ...departments.map(d => ({ value: d.id, label: d.name }))]} />
                </Field>
                <Field label="Job Title"><Input value={employeeForm.jobTitle} onChange={v => setEmployeeForm(p => ({ ...p, jobTitle: v }))} /></Field>
                <Field label="Reports To">
                  <Select value={employeeForm.managerEmployeeId} onChange={v => setEmployeeForm(p => ({ ...p, managerEmployeeId: v }))}
                    options={[{ value: '', label: 'None' }, ...employees.map(e => ({ value: e.id, label: e.fullName }))]} />
                </Field>
                <Field label="Start Date"><Input type="date" value={employeeForm.startDate} onChange={v => setEmployeeForm(p => ({ ...p, startDate: v }))} /></Field>
                <Field label="Bank Account"><Input value={employeeForm.bankAccount} onChange={v => setEmployeeForm(p => ({ ...p, bankAccount: v }))} placeholder="KCB-XXXXXXXX" /></Field>
              </div>
            </div>

            {/* ── Section 3: Salary ── */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Salary</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Basic Salary (KES)"><Input type="number" value={employeeForm.basicSalary} onChange={v => setEmployeeForm(p => ({ ...p, basicSalary: v }))} /></Field>
                <Field label="Housing Allowance"><Input type="number" value={employeeForm.housingAllowance} onChange={v => setEmployeeForm(p => ({ ...p, housingAllowance: v }))} /></Field>
                <Field label="Transport Allowance"><Input type="number" value={employeeForm.transportAllowance} onChange={v => setEmployeeForm(p => ({ ...p, transportAllowance: v }))} /></Field>
              </div>
              {(Number(employeeForm.basicSalary) > 0 || Number(employeeForm.housingAllowance) > 0) && (() => {
                const bd = calculatePayroll(Number(employeeForm.basicSalary), Number(employeeForm.housingAllowance), Number(employeeForm.transportAllowance))
                return (
                  <div className="mt-3 rounded-xl border border-[#E5E7EB] p-3" style={{ background: '#F9FAFB' }}>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-2">Payroll Preview</p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { label: 'Gross', val: bd.grossSalary, color: '#111827', bold: true },
                        { label: 'NSSF', val: -bd.nssf, color: '#EF4444' },
                        { label: 'SHIF', val: -bd.shif, color: '#EF4444' },
                        { label: 'Taxable', val: bd.taxablePay, color: '#6B7280' },
                        { label: 'PAYE', val: -bd.paye, color: '#EF4444' },
                        { label: 'Net Pay', val: bd.netSalary, color: '#059669', bold: true },
                      ].map(item => (
                        <div key={item.label} className="text-center">
                          <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mb-0.5">{item.label}</p>
                          <p className="font-mono text-[11px]" style={{ color: item.color, fontWeight: item.bold ? 700 : 500 }}>
                            {item.val < 0 ? '-' : ''}{fmtKes(Math.abs(item.val))}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* ── Section 4: System Access ── */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">System Access</p>
              <div className="rounded-xl border border-[#C7D2FE] p-4" style={{ background: '#EEF2FF' }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <p className="text-[11px] text-[#1B2762] font-medium mb-0.5">
                      Username: <span className="font-mono font-bold">{employeeForm.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_') || '—'}</span>
                      <span className="text-gray-400 font-normal"> (auto from email)</span>
                    </p>
                  </div>
                  <Field label="Temporary Password" required hint="Share this with the employee">
                    <div className="flex gap-2">
                      <Input type="text" value={employeeForm.accountPassword} onChange={v => setEmployeeForm(p => ({ ...p, accountPassword: v }))} placeholder="Min 6 characters" />
                      <button type="button" className="btn-outline px-3 py-1.5 text-[10px] whitespace-nowrap"
                        onClick={() => setEmployeeForm(p => ({ ...p, accountPassword: Math.random().toString(36).slice(-6) + 'A1!' }))}>
                        Generate
                      </button>
                    </div>
                  </Field>
                  <Field label="System Role" hint="Auto-sets module access">
                    <Select value={employeeForm.accountRole} onChange={v => {
                      const mods = ROLE_DEFAULT_MODULES[v as keyof typeof ROLE_DEFAULT_MODULES] ?? ['dashboard']
                      setEmployeeForm(p => ({ ...p, accountRole: v, accountModules: [...mods] }))
                    }} options={roleOptions} />
                  </Field>
                  <div className="sm:col-span-2">
                    <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-2">Module Access <span className="font-normal text-gray-400 normal-case">(auto-set from role — adjust if needed)</span></p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {moduleOptions.map(opt => {
                        const selected = employeeForm.accountModules.includes(opt.value)
                        return (
                          <button key={opt.value} type="button"
                            onClick={() => setEmployeeForm(p => ({
                              ...p,
                              accountModules: selected
                                ? p.accountModules.filter(m => m !== opt.value)
                                : [...p.accountModules, opt.value],
                            }))}
                            className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors"
                            style={{
                              borderColor: selected ? '#A8D4E8' : '#E5E7EB',
                              background: selected ? '#E8F3FA' : '#fff',
                              color: selected ? '#1B2762' : '#9CA3AF',
                              fontWeight: selected ? 600 : 400,
                            }}>
                            <span>{opt.label}</span>
                            <Fa icon={selected ? faCheck : faPlus} style={{ fontSize: selected ? 10 : 8 }} />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => { setShowEmployeeModal(false); setEmployeeForm(blankEmployeeForm) }}>Cancel</button>
            <button className="btn-primary" disabled={!employeeForm.fullName.trim() || !employeeForm.email.trim()} onClick={() => { void createEmployee() }}>
              Add Employee
            </button>
          </div>
        </Modal>
      )}

      {/* HR-side Leave Request (admin submits on behalf) */}
      {showLeaveModal && (
        <Modal title="New Leave Request (HR)" onClose={() => setShowLeaveModal(false)} width={520}>
          <Field label="Employee">
            <Select value={leaveForm.employeeId} onChange={v => setLeaveForm(p => ({ ...p, employeeId: v }))} options={employees.map(e => ({ value: e.id, label: e.fullName }))} />
          </Field>
          <Field label="Leave Type">
            <Select value={leaveForm.leaveType} onChange={v => setLeaveForm(p => ({ ...p, leaveType: v }))} options={[
              { value: 'flexible_leave', label: 'Flexible Leave' },
              { value: 'december_leave', label: 'December Leave' },
              { value: 'sick', label: 'Sick Leave' },
              { value: 'maternity_paternity', label: 'Maternity / Paternity' },
              { value: 'unpaid', label: 'Unpaid Leave' },
            ]} />
          </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Date"><Input type="date" value={leaveForm.startDate} onChange={v => setLeaveForm(p => ({ ...p, startDate: v }))} /></Field>
            <Field label="End Date"><Input type="date" value={leaveForm.endDate} onChange={v => setLeaveForm(p => ({ ...p, endDate: v }))} /></Field>
          </div>
          <Field label="Number of Days"><Input type="number" value={leaveForm.days} onChange={v => setLeaveForm(p => ({ ...p, days: v }))} /></Field>
          <Field label="Reason"><Textarea value={leaveForm.reason} onChange={v => setLeaveForm(p => ({ ...p, reason: v }))} /></Field>
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setShowLeaveModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={submitLeave} disabled={!leaveForm.employeeId}>Submit Leave</button>
          </div>
        </Modal>
      )}

      {/* Self-service Leave Request */}
      {showSelfLeaveModal && (
        <Modal title="Book Leave" onClose={() => setShowSelfLeaveModal(false)} width={480}>
          <div className="rounded-xl p-3 mb-3 text-[12px]" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', color: '#14204F' }}>
            Submitting as: <strong>{myEmployee?.fullName}</strong> · Your leave request will go to HR for approval.
          </div>
          <Field label="Leave Type">
            <Select value={selfLeaveForm.leaveType} onChange={v => setSelfLeaveForm(p => ({ ...p, leaveType: v }))} options={[
              { value: 'flexible_leave', label: 'Flexible Leave (13 days/year)' },
              { value: 'december_leave', label: 'December Leave (8 days, Dec only)' },
              { value: 'sick', label: 'Sick Leave' },
              { value: 'maternity_paternity', label: 'Maternity / Paternity' },
              { value: 'unpaid', label: 'Unpaid Leave' },
            ]} />
          </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Date"><Input type="date" value={selfLeaveForm.startDate} onChange={v => setSelfLeaveForm(p => ({ ...p, startDate: v }))} /></Field>
            <Field label="End Date"><Input type="date" value={selfLeaveForm.endDate} onChange={v => setSelfLeaveForm(p => ({ ...p, endDate: v }))} /></Field>
          </div>
          <Field label="Number of Days">
            <Input type="number" value={selfLeaveForm.days} onChange={v => setSelfLeaveForm(p => ({ ...p, days: v }))} />
          </Field>
          <Field label="Reason / Notes">
            <Textarea value={selfLeaveForm.reason} onChange={v => setSelfLeaveForm(p => ({ ...p, reason: v }))} placeholder="Briefly explain your leave reason" />
          </Field>
          {/* Show balance hint */}
          {myLeaveBalances.filter(b => b.leaveType === selfLeaveForm.leaveType).map(bal => {
            const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
            return (
              <div key={bal.id} className="rounded-lg p-2 text-[11px]" style={{ background: available >= Number(selfLeaveForm.days) ? '#F0FDF4' : '#FEF2F2', color: available >= Number(selfLeaveForm.days) ? '#059669' : '#DC2626' }}>
                Balance: {available} day(s) available · Requesting {selfLeaveForm.days} day(s)
              </div>
            )
          })}
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-outline" onClick={() => setShowSelfLeaveModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={submitSelfLeave} disabled={!selfLeaveForm.reason.trim()}>Submit Request</button>
          </div>
        </Modal>
      )}

      {/* Create Payroll Run */}
      {showPayrollModal && (
        <Modal title="Create Payroll Run" onClose={() => setShowPayrollModal(false)} width={420}>
          <div className="rounded-xl p-3 mb-3 text-[12px]" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#065F46' }}>
            This will calculate payroll for all {employees.filter(e => e.status === 'active').length} active employees based on their current salary data.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Month">
              <Select value={payrollMonth} onChange={setPayrollMonth} options={[
                { value: '01', label: 'January' }, { value: '02', label: 'February' }, { value: '03', label: 'March' },
                { value: '04', label: 'April' }, { value: '05', label: 'May' }, { value: '06', label: 'June' },
                { value: '07', label: 'July' }, { value: '08', label: 'August' }, { value: '09', label: 'September' },
                { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
              ]} />
            </Field>
            <Field label="Year"><Input value={payrollYear} onChange={setPayrollYear} type="number" /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-outline" onClick={() => setShowPayrollModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={createPayroll}>Create Payroll</button>
          </div>
        </Modal>
      )}

      {/* Add HR Document */}
      {showDocumentModal && (
        <Modal title="Add HR Document" onClose={() => setShowDocumentModal(false)} width={520}>
          <Field label="Employee">
            <Select value={documentForm.employeeId} onChange={v => setDocumentForm(p => ({ ...p, employeeId: v }))} options={employees.map(e => ({ value: e.id, label: e.fullName }))} />
          </Field>
          <Field label="Document Type">
            <Select value={documentForm.type} onChange={v => setDocumentForm(p => ({ ...p, type: v }))} options={[
              { value: 'contract', label: 'Employment Contract' },
              { value: 'nda', label: 'NDA' },
              { value: 'id_copy', label: 'ID Copy' },
              { value: 'certification', label: 'Certification' },
              { value: 'work_permit', label: 'Work Permit' },
            ]} />
          </Field>
          <Field label="Document Title"><Input value={documentForm.title} onChange={v => setDocumentForm(p => ({ ...p, title: v }))} placeholder="e.g. Employment Contract — John Doe" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Expiry Date (optional)"><Input type="date" value={documentForm.expiryDate} onChange={v => setDocumentForm(p => ({ ...p, expiryDate: v }))} /></Field>
            <Field label="Visibility">
              <Select value={documentForm.visibility} onChange={v => setDocumentForm(p => ({ ...p, visibility: v }))} options={[
                { value: 'hr_only', label: 'HR Only' },
                { value: 'hr_finance', label: 'HR + Finance' },
                { value: 'employee_visible', label: 'Employee Visible' },
              ]} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-outline" onClick={() => setShowDocumentModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={saveDocument} disabled={!documentForm.employeeId || !documentForm.title}>Save Document</button>
          </div>
        </Modal>
      )}

      {/* Add/Edit System User */}
      {showUserModal && (
        <Modal title={userForm.id ? 'Edit System User' : 'Add System User'} onClose={() => setShowUserModal(false)} width={620}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full Name" required><Input value={userForm.name} onChange={v => setUserForm(p => ({ ...p, name: v }))} /></Field>
            <Field label="Username" required><Input value={userForm.username} onChange={v => setUserForm(p => ({ ...p, username: v }))} maxLength={50} pattern="^[a-zA-Z0-9_\-\.]+$" /></Field>
            <Field label="Role" required>
              <Select value={userForm.role} onChange={v => setUserForm(p => ({ ...p, role: v }))} options={roleOptions} />
            </Field>
            <Field label="Status">
              <Select value={userForm.active ? 'active' : 'inactive'} onChange={v => setUserForm(p => ({ ...p, active: v === 'active' }))} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            </Field>
            <div className="col-span-2">
              <Field label={userForm.id ? 'Reset Password' : 'Password'} required={!userForm.id} hint={userForm.id ? 'Leave blank to keep current password.' : 'Min 6 characters.'}>
                <Input type="password" value={userForm.password} onChange={v => setUserForm(p => ({ ...p, password: v }))} placeholder={userForm.id ? 'Optional new password' : 'Temporary password'} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Allowed Modules" required hint="Users can only enter modules enabled here.">
                <div className="grid grid-cols-3 gap-2 rounded-xl border p-3" style={{ borderColor: '#E5E7EB', background: '#F9FAFB' }}>
                  {moduleOptions.map(opt => {
                    const selected = userForm.modules.includes(opt.value)
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                        style={{
                          borderColor: selected ? '#A8D4E8' : '#E5E7EB',
                          background: selected ? '#E8F3FA' : '#FFFFFF',
                          color: selected ? '#1B2762' : '#6B7280',
                          fontWeight: selected ? 600 : 400,
                        }}
                        onClick={() => toggleUserModule(opt.value)}
                      >
                        <span>{opt.label}</span>
                        <Fa icon={selected ? faCheck : faPlus} style={{ fontSize: selected ? 10 : 9 }} />
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-outline" onClick={() => setShowUserModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={savingUser} onClick={() => { void saveUser() }}>
              {savingUser ? 'Saving...' : userForm.id ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </Modal>
      )}

      {/* Assign Asset */}
      {showAssetModal && (
        <Modal title="Assign Asset to Employee" onClose={() => setShowAssetModal(false)} width={560}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-1 sm:col-span-2">
              <Field label="Employee">
                <Select value={assetForm.employeeId} onChange={v => setAssetForm(p => ({ ...p, employeeId: v }))} options={employees.map(e => ({ value: e.id, label: e.fullName }))} />
              </Field>
            </div>
            <Field label="Inventory Item">
              <Select value={assetForm.productId} onChange={v => setAssetForm(p => ({ ...p, productId: v, serialId: '' }))} options={assignableProducts.map(p => ({ value: p.id, label: p.name }))} />
            </Field>
            {products.find(p => p.id === assetForm.productId)?.requiresSerial ? (
              <Field label="Serial Number">
                <Select value={assetForm.serialId} onChange={v => setAssetForm(p => ({ ...p, serialId: v }))}
                  options={serials.filter(s => s.productId === assetForm.productId && s.status === 'available').map(s => ({ value: s.id, label: s.serial }))} />
              </Field>
            ) : (
              <Field label="Quantity"><Input type="number" value={assetForm.qty} onChange={v => setAssetForm(p => ({ ...p, qty: v }))} /></Field>
            )}
            <div className="col-span-1 sm:col-span-2">
              <Field label="Condition on Handover">
                <Select value={assetForm.handoverCondition} onChange={v => setAssetForm(p => ({ ...p, handoverCondition: v }))} options={[
                  { value: 'new', label: 'New' }, { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'damaged', label: 'Damaged' },
                ]} />
              </Field>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <Field label="Handover Notes">
                <Textarea value={assetForm.handoverNotes} onChange={v => setAssetForm(p => ({ ...p, handoverNotes: v }))} placeholder="Accessories, device condition, handover notes" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowAssetModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={saveAssignment} disabled={!assetForm.employeeId || !assetForm.productId}>Assign Asset</button>
          </div>
        </Modal>
      )}

      {/* Acknowledge Asset */}
      {showAcknowledgeModal && (
        <Modal title="Acknowledge Asset Handover" onClose={() => setShowAcknowledgeModal(false)} width={520}>
          <div className="flex flex-col gap-3">
            <Field label="Assignment to Acknowledge">
              <Select value={ackForm.assignmentId} onChange={v => setAckForm(p => ({ ...p, assignmentId: v }))}
                options={activeAssignments.filter(a => !a.acknowledgedByEmployee).map(a => ({ value: a.id, label: `${a.employeeName} — ${a.productName}` }))} />
            </Field>
            <Field label="Acknowledgment Note">
              <Textarea value={ackForm.notes} onChange={v => setAckForm(p => ({ ...p, notes: v }))} placeholder="Employee confirms receipt and device condition" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowAcknowledgeModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => { acknowledgeEmployeeAsset(ackForm.assignmentId, ackForm.notes); setShowAcknowledgeModal(false) }} disabled={!ackForm.assignmentId}>Confirm</button>
          </div>
        </Modal>
      )}

      {/* Return Asset */}
      {showReturnAssetModal && (
        <Modal title="Return Employee Asset" onClose={() => setShowReturnAssetModal(false)} width={520}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-1 sm:col-span-2">
              <Field label="Assignment">
                <Select value={returnForm.assignmentId} onChange={v => setReturnForm(p => ({ ...p, assignmentId: v }))}
                  options={activeAssignments.map(a => ({ value: a.id, label: `${a.employeeName} — ${a.productName}` }))} />
              </Field>
            </div>
            <Field label="Return Location">
              <Select value={returnForm.returnLocation} onChange={v => setReturnForm(p => ({ ...p, returnLocation: v }))} options={[
                { value: 'warehouse', label: 'Warehouse' }, { value: 'shop', label: 'Shop' }, { value: 'repair_unit', label: 'Repair Unit' },
              ]} />
            </Field>
            <Field label="Condition on Return">
              <Select value={returnForm.condition} onChange={v => setReturnForm(p => ({ ...p, condition: v }))} options={[
                { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'damaged', label: 'Damaged' },
              ]} />
            </Field>
            <div className="col-span-1 sm:col-span-2">
              <Field label="Inspection Notes">
                <Textarea value={returnForm.notes} onChange={v => setReturnForm(p => ({ ...p, notes: v }))} placeholder="Missing accessories, defects, or inspection comments" />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowReturnAssetModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => { returnEmployeeAsset(returnForm.assignmentId, returnForm.returnLocation as any, returnForm.condition as any, returnForm.notes); setShowReturnAssetModal(false) }} disabled={!returnForm.assignmentId}>Return Asset</button>
          </div>
        </Modal>
      )}

      {/* Reassign Asset */}
      {showReassignAssetModal && (
        <Modal title="Reassign Employee Asset" onClose={() => setShowReassignAssetModal(false)} width={520}>
          <div className="flex flex-col gap-3">
            <Field label="Current Assignment">
              <Select value={reassignForm.assignmentId} onChange={v => setReassignForm(p => ({ ...p, assignmentId: v }))}
                options={activeAssignments.map(a => ({ value: a.id, label: `${a.employeeName} — ${a.productName}` }))} />
            </Field>
            <Field label="New Employee">
              <Select value={reassignForm.employeeId} onChange={v => setReassignForm(p => ({ ...p, employeeId: v }))}
                options={employees.map(e => ({ value: e.id, label: e.fullName }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowReassignAssetModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => { reassignEmployeeAsset(reassignForm.assignmentId, reassignForm.employeeId); setShowReassignAssetModal(false) }} disabled={!reassignForm.assignmentId || !reassignForm.employeeId}>Reassign</button>
          </div>
        </Modal>
      )}

      {/* Recruitment Modals */}
      {showJobModal && (
        <Modal title="New Job Posting" onClose={() => setShowJobModal(false)} width={500}>
          <Field label="Job Title"><Input value={jobForm.title} onChange={v => setJobForm(p => ({ ...p, title: v }))} /></Field>
          <Field label="Department"><Select value={jobForm.departmentId} onChange={v => setJobForm(p => ({ ...p, departmentId: v }))} options={[{value: '', label: '— Select —'}, ...departments.map(d => ({ value: d.id, label: d.name }))]} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location"><Input value={jobForm.location} onChange={v => setJobForm(p => ({ ...p, location: v }))} placeholder="e.g. Nairobi HQ" /></Field>
            <Field label="Type"><Select value={jobForm.type} onChange={v => setJobForm(p => ({ ...p, type: v as any }))} options={[{ value: 'full_time', label: 'Full Time' }, { value: 'part_time', label: 'Part Time' }, { value: 'contract', label: 'Contract' }]} /></Field>
          </div>
          <Field label="Description"><Textarea value={jobForm.description} onChange={v => setJobForm(p => ({ ...p, description: v }))} rows={3} /></Field>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowJobModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={!jobForm.title} onClick={saveJob}>Save Job</button>
          </div>
        </Modal>
      )}

      {showCandidateModal && (
        <Modal title="Add Candidate" onClose={() => setShowCandidateModal(false)} width={500}>
          <Field label="Applying For (Job)"><Select value={candidateForm.jobId} onChange={v => setCandidateForm(p => ({ ...p, jobId: v }))} options={[{value: '', label: '— Select —'}, ...jobPostings.map(j => ({ value: j.id, label: j.title }))]} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name"><Input value={candidateForm.firstName} onChange={v => setCandidateForm(p => ({ ...p, firstName: v }))} /></Field>
            <Field label="Last Name"><Input value={candidateForm.lastName} onChange={v => setCandidateForm(p => ({ ...p, lastName: v }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><Input value={candidateForm.email} onChange={v => setCandidateForm(p => ({ ...p, email: v }))} type="email" /></Field>
            <Field label="Phone"><Input value={candidateForm.phone} onChange={v => setCandidateForm(p => ({ ...p, phone: v }))} /></Field>
          </div>
          <Field label="Stage"><Select value={candidateForm.stage} onChange={v => setCandidateForm(p => ({ ...p, stage: v as any }))} options={[{ value: 'applied', label: 'Applied' }, { value: 'screening', label: 'Screening' }, { value: 'interview', label: 'Interview' }, { value: 'offered', label: 'Offered' }, { value: 'hired', label: 'Hired' }, { value: 'rejected', label: 'Rejected' }]} /></Field>
          <Field label="Notes"><Textarea value={candidateForm.notes} onChange={v => setCandidateForm(p => ({ ...p, notes: v }))} rows={2} /></Field>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowCandidateModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={!candidateForm.firstName || !candidateForm.jobId} onClick={saveCandidate}>Save Candidate</button>
          </div>
        </Modal>
      )}

      {/* Training Modals */}
      {showTrainingModal && (
        <Modal title="New Training Program" onClose={() => setShowTrainingModal(false)} width={500}>
          <Field label="Title"><Input value={trainingForm.title} onChange={v => setTrainingForm(p => ({ ...p, title: v }))} /></Field>
          <Field label="Description"><Textarea value={trainingForm.description} onChange={v => setTrainingForm(p => ({ ...p, description: v }))} rows={3} /></Field>
          <Field label="Duration (Days)"><Input type="number" value={trainingForm.durationDays} onChange={v => setTrainingForm(p => ({ ...p, durationDays: v }))} /></Field>
          <label className="flex items-center gap-2 mt-2 text-sm text-t1 cursor-pointer">
            <input type="checkbox" checked={trainingForm.mandatoryForNewHires} onChange={e => setTrainingForm(p => ({ ...p, mandatoryForNewHires: e.target.checked }))} className="w-4 h-4" />
            Mandatory for New Hires
          </label>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowTrainingModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={!trainingForm.title} onClick={saveTraining}>Save Program</button>
          </div>
        </Modal>
      )}

      {showEnrollModal && (
        <Modal title="Enroll Employee in Training" onClose={() => setShowEnrollModal(false)} width={400}>
          <Field label="Employee"><Select value={enrollForm.employeeId} onChange={v => setEnrollForm(p => ({ ...p, employeeId: v }))} options={[{value: '', label: '— Select —'}, ...employees.map(e => ({ value: e.id, label: e.fullName }))]} /></Field>
          <Field label="Training Program"><Select value={enrollForm.trainingId} onChange={v => setEnrollForm(p => ({ ...p, trainingId: v }))} options={[{value: '', label: '— Select —'}, ...trainingPrograms.map(t => ({ value: t.id, label: t.title }))]} /></Field>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowEnrollModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={!enrollForm.employeeId || !enrollForm.trainingId} onClick={saveEnrollment}>Enroll Employee</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
