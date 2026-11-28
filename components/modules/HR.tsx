'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { faUserPlus, faPen } from '@fortawesome/free-solid-svg-icons'

import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { useHrStore, refreshHrListsFromBrowser } from '@/hooks/useHrStore'
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
import { Confirm, Field, Input, Modal, Select, ModuleSkeleton, useMounted } from '@/components/ui'
import { SecondaryActionMenu } from '@/components/erp'
import { type Employee } from '@/lib/store'
import { Fa } from '@/components/icons'
import EmployeeLifecyclePanel from './hr/HREmployeeLifecycle'
import HROrgChart from './hr/HROrgChart'
import HREmployeeProfile, { avatarColor } from './hr/HREmployeeProfile'
import { employeeSetup, type EmployeeSetup } from '@/lib/hr/employee-setup'
import { documentExpiry } from '@/lib/hr/document-status'
import { userCan } from '@/lib/auth/can'
import { initials } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

type HRTab =
  | 'employees'
  | 'targets'
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

const MANAGEMENT_TABS: HRTab[] = ['employees', 'attendance', 'departments', 'assets', 'org_chart', 'recruitment', 'training', 'documents', 'performance', 'targets', 'reports']
const SELF_SERVICE_TABS: HRTab[] = ['self_service', 'leave', 'salary_advances', 'payroll']

/** HR's sections, grouped the way the work is: who people are, their time, their pay, their growth. */
const TAB_GROUPS: Array<{ id: string; label: string; tabs: Array<{ id: HRTab; label: string }> }> = [
  { id: 'portal', label: 'My portal', tabs: [{ id: 'self_service', label: 'My portal' }] },
  { id: 'people', label: 'People', tabs: [{ id: 'employees', label: 'Employees' }, { id: 'departments', label: 'Departments' }, { id: 'documents', label: 'Documents' }, { id: 'assets', label: 'Equipment' }, { id: 'org_chart', label: 'Org chart' }] },
  { id: 'time', label: 'Time', tabs: [{ id: 'attendance', label: 'Attendance' }, { id: 'leave', label: 'Leave' }] },
  { id: 'pay', label: 'Pay', tabs: [{ id: 'payroll', label: 'Payroll' }, { id: 'salary_advances', label: 'Salary advances' }] },
  { id: 'growth', label: 'Growth', tabs: [{ id: 'performance', label: 'Reviews' }, { id: 'targets', label: 'Targets' }, { id: 'training', label: 'Training' }, { id: 'recruitment', label: 'Recruitment' }] },
  { id: 'reports', label: 'Reports', tabs: [{ id: 'reports', label: 'Reports' }] },
]
const DOC_TYPE_SHORT: Record<string, string> = { contract: 'Contract', nda: 'NDA', id_copy: 'ID', certification: 'Certificate', work_permit: 'Work permit', other: 'Paper' }
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
    leaveBalances,
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
  const setEmpSearch = (value: string) => setEmpSearchValue(value, { queryPatch: { employeePage: null } })
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
  // The HR lists the server sent after this page opened (documents, departments…).
  useEffect(() => { refreshHrListsFromBrowser(); const t = window.setTimeout(refreshHrListsFromBrowser, 1500); return () => window.clearTimeout(t) }, [])

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

  // Which people the list shows: active, records still incomplete, leavers, or everyone.
  const [peopleFilterValue, setPeopleFilterValue] = useUrlUiState('people', 'active')
  const peopleFilter = (['active', 'onboarding', 'leavers', 'all'] as const).includes(peopleFilterValue as never)
    ? peopleFilterValue as 'active' | 'onboarding' | 'leavers' | 'all'
    : 'active'
  const setPeopleFilter = (v: 'active' | 'onboarding' | 'leavers' | 'all') => setPeopleFilterValue(v, { queryPatch: { employeePage: null } })
  // A person's checklist opens the document / equipment form already filled in.
  const [docPrefill, setDocPrefill] = useState<{ employeeId: string; type: string } | null>(null)
  const [assignPrefill, setAssignPrefill] = useState<string | null>(null)
  // Daily or monthly per person (Pay column, onboarding "Payroll set up").
  const [payBasisById, setPayBasisById] = useState<Map<string, { basis: 'monthly' | 'daily'; dailyRate: number }>>(new Map())
  // Reviews waiting in an open cycle ("Reviews due").
  const [reviewsDue, setReviewsDue] = useState<{ due: number; openCycle: boolean } | null>(null)
  useEffect(() => {
    if (!canManageHR) return
    let live = true
    fetch('/api/attendance/pay-basis', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
      if (!live || !Array.isArray(d?.payBasis)) return
      setPayBasisById(new Map(d.payBasis.map((r: { employeeId: string; basis: 'monthly' | 'daily'; dailyRate: number }) => [r.employeeId, { basis: r.basis, dailyRate: Number(r.dailyRate) || 0 }])))
    }).catch(() => {})
    fetch('/api/appraisals', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
      if (!live || !d) return
      const open = new Set((Array.isArray(d.cycles) ? d.cycles : []).filter((c: { status: string }) => c.status !== 'closed').map((c: { id: string }) => c.id))
      const due = (Array.isArray(d.appraisals) ? d.appraisals : []).filter((a: { status: string; cycleId?: string }) => a.status !== 'completed' && (!a.cycleId || open.has(a.cycleId))).length
      setReviewsDue({ due, openCycle: open.size > 0 })
    }).catch(() => {})
    return () => { live = false }
  }, [canManageHR])
  const heldAssets = useMemo(() => {
    const by = new Map<string, typeof employeeAssetAssignments>()
    for (const a of employeeAssetAssignments) {
      if (a.status !== 'assigned') continue
      by.set(a.employeeId, [...(by.get(a.employeeId) ?? []), a])
    }
    return by
  }, [employeeAssetAssignments])
  const setupById = useMemo(() => {
    const out = new Map<string, EmployeeSetup>()
    for (const e of employees) out.set(e.id, employeeSetup(e, hrDocuments, heldAssets.get(e.id)?.length ?? 0, payBasisById.get(e.id)))
    return out
  }, [employees, hrDocuments, heldAssets, payBasisById])

  const filteredEmployees = employees.filter(e => {
    const left = e.status === 'exited'
    if (peopleFilter === 'active' && left) return false
    if (peopleFilter === 'leavers' && !left) return false
    if (peopleFilter === 'onboarding' && (left || setupById.get(e.id)?.complete)) return false
    const q = empSearch.toLowerCase()
    return !q || e.fullName.toLowerCase().includes(q) || e.employeeNo.toLowerCase().includes(q) || e.jobTitle.toLowerCase().includes(q)
  })



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

  /** "since 12 Nov", "3 yrs", "8 mo" — how long someone has been here. */
  const tenure = (e: Employee) => {
    if (e.status === 'exited') return e.exitDate ? `${e.exitDate > new Date().toISOString().slice(0, 10) ? 'leaving' : 'left'} ${fmtDate(e.exitDate).replace(/ \d{4}$/, '')}` : 'left'
    if (!e.startDate) return ''
    const months = Math.floor((Date.now() - new Date(`${e.startDate}T00:00:00`).getTime()) / (30.44 * 86400000))
    if (months < 3) return `since ${fmtDate(e.startDate).replace(/ \d{4}$/, '')}`
    return months >= 12 ? `${Math.floor(months / 12)} yr${months >= 24 ? 's' : ''}` : `${months} mo`
  }
  /** Open the edit form for a person, filled with their record. */
  const startEdit = (emp: Employee) => { setEmpForm({ fullName: emp.fullName, employeeNo: emp.employeeNo, email: emp.email || '', workEmail: emp.workEmail || '', phone: emp.phone || '', nationalId: emp.nationalId || '', kraPin: emp.kraPin || '', nssfNumber: emp.nssfNumber || '', gender: emp.gender || '', departmentId: emp.departmentId || '', jobTitle: emp.jobTitle || '', shift: emp.shift || '', startDate: emp.startDate, status: emp.status as any, basicSalary: String(emp.basicSalary), housingAllowance: String(emp.housingAllowance ?? 0), transportAllowance: String(emp.transportAllowance ?? 0), bankName: emp.bankName || '', bankAccount: emp.bankAccount || '', paymentMode: emp.paymentMode || 'mpesa', mpesaNumber: emp.mpesaNumber || '', managerEmployeeId: emp.managerEmployeeId || '' }); setEditEmpId(emp.id); void loadPayBasis(emp.id) }

  if (!mounted) return <ModuleSkeleton />

  // What HR must act on. A group with nothing in it is left out, and the panel with it.
  const within30 = (d?: string) => { if (!d) return false; const x = documentExpiry(d); return x.status === 'expired' || (x.daysLeft ?? 999) <= 30 }
  const papersExpiring = hrDocuments.filter(d => within30(d.expiryDate) && employees.some(e => e.id === d.employeeId && e.status !== 'exited'))
  const kitToCollect = employeeAssetAssignments.filter(a => a.status === 'assigned' && employees.find(e => e.id === a.employeeId)?.status === 'exited')
  const onboardingOpen = employees.filter(e => e.status !== 'exited' && !setupById.get(e.id)?.complete).length
  // HR mock A: the four things HR acts on, each opening the list that fixes it.
  const attentionTiles: Array<{ id: string; n: number; title: string; sub: string; tone: 'bad' | 'warn' | 'calm'; open: () => void }> = [
    { id: 'onboarding', n: onboardingOpen, title: 'Onboarding open', sub: 'papers or kit missing', tone: onboardingOpen ? 'bad' : 'calm', open: () => { setTab('employees'); setPeopleFilter('onboarding') } },
    { id: 'papers', n: papersExpiring.length, title: 'Papers expiring', sub: 'within 30 days', tone: papersExpiring.length ? 'warn' : 'calm', open: () => setTab('documents') },
    { id: 'kit', n: kitToCollect.length, title: 'Kit to collect', sub: kitToCollect.length === 1 ? 'from a leaver' : 'from leavers', tone: kitToCollect.length ? 'warn' : 'calm', open: () => setTab('assets') },
    { id: 'reviews', n: reviewsDue?.due ?? 0, title: 'Reviews due', sub: reviewsDue?.openCycle ? 'in the open cycle' : 'no cycle open', tone: reviewsDue?.due ? 'warn' : 'calm', open: () => setTab('performance') },
  ]

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
      {/* HR mock: one white header — title, people count, actions, then the
          sections; the chosen section's pages sit on the strip below it. */}
      <header className="hrh">
        <div className="hrh-row">
          <h1>Human resources</h1>
          <span className="hrh-count">{employees.filter(e => e.status !== 'exited').length} people</span>
          <div className="hrh-actions">
            {canManageHR && (
              <SecondaryActionMenu
                label="More"
                actions={[{ id: 'users', label: 'System users', onClick: () => router.push('/settings?tab=users') }]}
              />
            )}
            {isAdmin && (
              <button type="button" className="hrb-btn is-p hrh-add" onClick={() => { setTab('employees'); void loadPayBasis(null); setShowEmployeeModal(true) }}>
                <Fa icon={faUserPlus} /> Add employee
              </button>
            )}
          </div>
        </div>
        <nav className="hrh-tabs" aria-label="HR sections">
          {(canManageHR ? visibleGroups.map(g => ({ id: g.id, label: g.label, go: () => setTab(g.tabs[0].id), on: activeGroup.id === g.id }))
            : allowedTabs.map(id => ({ id, label: STAFF_TAB_LABELS[id] ?? id, go: () => setTab(id), on: tab === id }))
          ).map(t => (
            <button key={t.id} type="button" aria-current={t.on ? 'page' : undefined} onClick={t.go}>{t.label}</button>
          ))}
        </nav>
      </header>
      {canManageHR && activeGroup.tabs.length > 1 && (
        <nav className="hrh-sub" aria-label={`${activeGroup.label} sections`}>
          {activeGroup.tabs.filter(t => t.id !== 'org_chart' || tab === 'org_chart').map(t => (
            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => { setViewEmpId(null); setTab(t.id) }}>{t.label}</button>
          ))}
        </nav>
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="mod-body">
      <div className="hr-content-shell hrx-body">
        {viewEmployee && editEmpId !== viewEmployee.id && canManageHR ? (
          <HREmployeeProfile
            employee={viewEmployee}
            department={departmentName(viewEmployee.departmentId)}
            manager={employees.find(e => e.id === viewEmployee.managerEmployeeId)?.fullName ?? ''}
            documents={hrDocuments}
            assets={(heldAssets.get(viewEmployee.id) ?? []).map(a => ({ id: a.id, productName: a.productName, serialNumber: a.serialNumber, assignedDate: a.assignedDate, acknowledgedByEmployee: a.acknowledgedByEmployee }))}
            setup={setupById.get(viewEmployee.id) ?? employeeSetup(viewEmployee, hrDocuments, 0, payBasisById.get(viewEmployee.id))}
            payBasis={payBasisById.get(viewEmployee.id)}
            leaveRequests={leaveRequests}
            leaveLeft={(() => {
              const b = leaveBalances.find(x => x.employeeId === viewEmployee.id && x.leaveType === 'annual' && x.year === new Date().getFullYear())
              if (!b) return null
              const total = b.entitlement + (b.carryForward || 0)
              return { left: Math.max(0, total - b.used - b.pending), total }
            })()}
            payslips={payslips}
            canManage={isAdmin}
            onBack={() => setViewEmpId(null)}
            onEdit={() => startEdit(viewEmployee)}
            onAddDocument={type => { setDocPrefill({ employeeId: viewEmployee.id, type }); setViewEmpId(null); setTab('documents') }}
            onIssueEquipment={() => { setAssignPrefill(viewEmployee.id); setViewEmpId(null); setTab('assets') }}
          />
        ) : tab === 'employees' && canManageHR ? (
          <div className="hr-employees-view">
            <div className="hra-att" role="list" aria-label="Needs attention">
              {attentionTiles.map(t => (
                <button key={t.id} type="button" role="listitem" className={`hra-at is-${t.tone}`} onClick={t.open}>
                  <strong>{t.n}</strong><span><b>{t.title}</b><small>{t.sub}</small></span>
                </button>
              ))}
            </div>
            <section className="hra-card">
              <div className="hra-ch">
                <div className="hra-seg" role="tablist" aria-label="Which people">
                  {([
                    ['active', `Active · ${employees.filter(e => e.status !== 'exited').length}`],
                    ['onboarding', `Onboarding · ${onboardingOpen}`],
                    ['leavers', `Leavers · ${employees.filter(e => e.status === 'exited').length}`],
                    ['all', 'All'],
                  ] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={peopleFilter === id} onClick={() => setPeopleFilter(id)}>{label}</button>
                  ))}
                </div>
                <div className="hra-tools">
                  <input className="hra-search" type="search" placeholder="Search people…" aria-label="Search people" value={empSearch} onChange={ev => setEmpSearch(ev.target.value)} />
                  <button type="button" className="hrb-btn" onClick={() => setTab('org_chart')}>Org chart</button>
                </div>
              </div>
              <div className="hra-table-wrap">
              <table className="hra-table">
                <thead><tr><th>Person</th><th>Department</th><th>Pay</th><th>Onboarding</th><th /></tr></thead>
                <tbody>
                  {filteredEmployees.length === 0 && (
                    <tr><td colSpan={5} className="hra-empty">{employees.length === 0 ? 'No employees yet — add the first one.' : 'No one matches.'}</td></tr>
                  )}
                  {filteredEmployees.map(e => {
                    const st = setupById.get(e.id)
                    const left = e.status === 'exited'
                    const leaving = left && !!e.exitDate && e.exitDate > new Date().toISOString().slice(0, 10)
                    const kit = heldAssets.get(e.id)?.length ?? 0
                    const basis = payBasisById.get(e.id)?.basis ?? 'monthly'
                    const ending = !left && st?.complete
                      ? hrDocuments.filter(d => d.employeeId === e.id && d.expiryDate && documentExpiry(d.expiryDate).status !== 'active').sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)))[0]
                      : undefined
                    return (
                      <tr key={e.id} onClick={() => setViewEmpId(e.id)}>
                        <td>
                          <div className="hra-who">
                            <span className="hra-av" style={{ background: avatarColor(e.fullName) }} aria-hidden="true">{initials(e.fullName)}</span>
                            <div className="min-w-0"><b>{e.fullName}</b><small>{[e.jobTitle, tenure(e)].filter(Boolean).join(' · ')}</small></div>
                          </div>
                        </td>
                        <td>{departmentName(e.departmentId) || '—'}</td>
                        <td><span className={`hra-chip ${basis === 'daily' ? 'is-v' : 'is-s'}`}>{basis === 'daily' ? 'Daily' : 'Monthly'}</span></td>
                        <td className="hra-onb">
                          {left
                            ? <span className="hra-chip is-r">{leaving ? 'Leaving' : 'Left'}</span>
                            : st?.complete
                              ? <span className="hra-chip is-g">Done</span>
                              : st && (
                                <>
                                  <div className="hra-bar"><i style={{ width: `${Math.round((st.done / st.total) * 100)}%` }} /></div>
                                  <small>{st.done} of {st.total} · {st.missing.slice(0, 2).join(', ')}{st.missing.length > 2 ? ` +${st.missing.length - 2}` : ''} left</small>
                                </>
                              )}
                        </td>
                        <td className="hra-r" onClick={ev => ev.stopPropagation()}>
                          {left
                            ? (kit > 0 ? <button type="button" className="hrb-btn" onClick={() => setViewEmpId(e.id)}>Offboard</button> : null)
                            : !st?.complete
                              ? <button type="button" className="hrb-btn" onClick={() => setViewEmpId(e.id)}>Continue</button>
                              : ending
                                ? <span className="hra-chip is-a">{(DOC_TYPE_SHORT[ending.type] ?? 'Paper')} {documentExpiry(ending.expiryDate).status === 'expired' ? 'expired' : `ends ${fmtDate(ending.expiryDate!).replace(/ \d{4}$/, '')}`}</span>
                                : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </section>
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
          <HRDocumentsTab prefill={docPrefill} onPrefillUsed={() => setDocPrefill(null)} />
        ) : tab === 'performance' && canManageHR ? (
          <HRPerformanceTab view="reviews" onTargets={() => setTab('targets')} onTraining={() => setTab('training')} />
        ) : tab === 'targets' && canManageHR ? (
          <HRPerformanceTab view="targets" />
        ) : tab === 'reports' && canManageHR ? (
          <HRReportsTab />
        ) : tab === 'assets' ? (
          <HRAssetsTab prefillEmployeeId={assignPrefill} onPrefillUsed={() => setAssignPrefill(null)} />
        ) : tab === 'departments' && canManageHR ? (
          <HRDepartments canManage={isAdmin} showToast={showToast} onChanged={() => void loadDepartments()} employees={employees} payBasis={payBasisById} canSeePay={canSetPayBasis} />
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
      {viewEmployee && (editEmpId === viewEmployee.id || !canManageHR) && (
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
                  <button className="btn-primary px-6 flex items-center gap-2" onClick={() => startEdit(viewEmployee)}>
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
