// Zustand slice for the HR domain (employees, leave, recruitment, training, HR documents).
// Ported verbatim from the corresponding state/actions in lib/store.tsx's StoreProvider —
// see C:\Users\PC\.claude\plans\effervescent-painting-garden.md for the migration rationale.
//
// Cross-cutting dependencies this domain's actions need (currentUser, users, showToast,
// addAuditLog, pushNotif, workflowApprovals) intentionally stay owned by the legacy
// Context — they're injected once via setHrContext() rather than imported here, so this
// store doesn't reach back into lib/store.tsx's StoreProvider.
import { create } from 'zustand'
import {
  uid, now, seq, canManageHR, debouncedServerSync,
  type Employee, type Department, type LeaveBalance, type LeaveRequest, type HRDocument,
  type JobPosting, type Candidate, type TrainingProgram, type EmployeeTraining,
  type User, type WorkflowApproval, type AppNotification,
} from '@/lib/store'
import { entitlementFor, isLeaveTypeAllowedForGender, noticeDaysGiven, requiredNotice, decemberClosureDays, type StoreLeaveType } from '@/lib/leave-utils'

// ─── localStorage + debounced server sync (mirrors lib/store.tsx's useLS) ───────────────
function readLS<T>(key: string, seedValue: T): T {
  if (typeof window === 'undefined') return seedValue
  try {
    const stored = window.localStorage.getItem(key)
    if (stored !== null) return JSON.parse(stored) as T
  } catch { /* corrupted — fall through to seed */ }
  return seedValue
}

function writeLS(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { return }
  if (serialized.length <= 512 * 1024) {
    try { window.localStorage.setItem(key, serialized) } catch { /* quota exceeded */ }
  } else {
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
  }
  debouncedServerSync(key, serialized)
}

const seedDepartments: Department[] = [
  { id: 'HR', name: 'HR', description: 'Human resources and people operations' },
  { id: 'Sales', name: 'Sales', description: 'Sales and revenue operations' },
  { id: 'Marketing', name: 'Marketing', description: 'Marketing and demand generation' },
  { id: 'Finance', name: 'Finance', description: 'Finance, accounting, and controls' },
  { id: 'Engineering', name: 'Engineering', description: 'Engineering and technical delivery' },
  { id: 'Logistics & Supply Chain Management', name: 'Logistics & Supply Chain Management', description: 'Logistics, procurement, warehousing, and supply chain' },
  { id: 'Strategy & R&D', name: 'Strategy & R&D', description: 'Strategy, research, and development' },
  { id: 'Administration', name: 'Administration', description: 'Administration and office operations' },
  { id: 'Circular Computing Centre', name: 'Circular Computing Centre', description: 'Circular computing centre operations' },
  { id: 'Managed IT Services', name: 'Managed IT Services', description: 'Managed IT services delivery' },
  { id: 'AI & Automation', name: 'AI & Automation', description: 'AI, automation, and workflow transformation' },
  { id: 'Training & Certification', name: 'Training & Certification', description: 'Training, certification, and enablement' },
  { id: 'ESG & Sustainability', name: 'ESG & Sustainability', description: 'ESG reporting and sustainability programs' },
  { id: 'Investor Relations & Capital Raising', name: 'Investor Relations & Capital Raising', description: 'Investor relations and capital raising' },
  { id: 'Regional Expansion / New Markets', name: 'Regional Expansion / New Markets', description: 'Regional expansion and new market development' },
  { id: 'Deed Foundation', name: 'Deed Foundation', description: 'Deed Foundation programs and impact initiatives' },
]

// ─── Cross-cutting context, injected by StoreProvider (see lib/store.tsx) ───────────────
export interface HrCtx {
  currentUser: () => User | null
  users: User[]
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  addAuditLog: (action: string, documentRef: string, details: string) => void
  pushNotif: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => void
  workflowApprovals: WorkflowApproval[]
  setWorkflowApprovals: (updater: (prev: WorkflowApproval[]) => WorkflowApproval[]) => void
}

const noopCtx: HrCtx = {
  currentUser: () => null,
  users: [],
  showToast: () => {},
  addAuditLog: () => {},
  pushNotif: () => {},
  workflowApprovals: [],
  setWorkflowApprovals: () => {},
}

type Updater<T> = T | ((prev: T) => T)
const resolve = <T,>(updater: Updater<T>, prev: T): T => (typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater)

interface HrState {
  ctx: HrCtx
  setHrContext: (ctx: HrCtx) => void

  departments: Department[]
  employees: Employee[]
  leaveBalances: LeaveBalance[]
  leaveRequests: LeaveRequest[]
  hrDocuments: HRDocument[]
  jobPostings: JobPosting[]
  candidates: Candidate[]
  trainingPrograms: TrainingProgram[]
  employeeTrainings: EmployeeTraining[]

  // Raw setters — used by StoreProvider's existing fetch/SSE wiring and internally.
  setEmployees: (u: Updater<Employee[]>) => void
  setLeaveRequests: (u: Updater<LeaveRequest[]>) => void
  setLeaveBalances: (u: Updater<LeaveBalance[]>) => void
  setDepartments: (u: Updater<Department[]>) => void
  setHRDocuments: (u: Updater<HRDocument[]>) => void
  setJobPostings: (u: Updater<JobPosting[]>) => void
  setCandidates: (u: Updater<Candidate[]>) => void
  setTrainingPrograms: (u: Updater<TrainingProgram[]>) => void
  setEmployeeTrainings: (u: Updater<EmployeeTraining[]>) => void

  // Actions — ported verbatim from lib/store.tsx.
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<Employee>
  updateEmployee: (id: string, patch: Partial<Employee>) => void
  addLeaveRequest: (request: Omit<LeaveRequest, 'id' | 'ref' | 'submittedDate' | 'status' | 'isSystemGenerated'>) => LeaveRequest
  decideLeaveRequest: (id: string, approved: boolean, note?: string) => void
  cancelLeaveRequest: (id: string) => void
  updateLeaveBalance: (id: string, patch: Partial<Pick<LeaveBalance, 'entitlement' | 'used' | 'carryForward'>>) => void
  initYearBalances: (year: number) => void
  applyDecemberClosure: (year: number) => void
  expireYearEndBalances: (year: number) => void
  addHRDocument: (document: Omit<HRDocument, 'id'>) => HRDocument
  addJobPosting: (p: Omit<JobPosting, 'id' | 'postedDate'>) => void
  updateJobPosting: (id: string, p: Partial<JobPosting>) => void
  addCandidate: (c: Omit<Candidate, 'id' | 'appliedDate'>) => void
  updateCandidate: (id: string, p: Partial<Candidate>) => void
  addTrainingProgram: (t: Omit<TrainingProgram, 'id'>) => void
  enrollEmployeeTraining: (employeeId: string, trainingId: string) => void
  updateTrainingStatus: (id: string, status: EmployeeTraining['status'], score?: number) => void
}

// Generic-sync setter factory — mirrors useLS's effect body for the 6 fields that
// persist via localStorage + debouncedServerSync (departments, hrDocuments, jobPostings,
// candidates, trainingPrograms, employeeTrainings). employees/leaveRequests/leaveBalances
// are fetched from dedicated routes instead (see StoreProvider's wiring) and skip this.
function makeSyncedSetter<K extends keyof HrState>(
  set: (fn: (state: HrState) => Partial<HrState>) => void,
  get: () => HrState,
  field: K,
  lsKey: string,
) {
  return (updater: Updater<any>) => {
    const next = resolve(updater, get()[field] as any)
    set(() => ({ [field]: next } as Partial<HrState>))
    writeLS(lsKey, next)
  }
}

export const useHrStore = create<HrState>((set, get) => ({
  ctx: noopCtx,
  setHrContext: (ctx) => set({ ctx }),

  departments: readLS('deed_departments', seedDepartments),
  employees: [],
  leaveBalances: [],
  leaveRequests: [],
  hrDocuments: readLS('deed_hrDocuments', [] as HRDocument[]),
  jobPostings: readLS('deed_jobPostings', [] as JobPosting[]),
  candidates: readLS('deed_candidates', [] as Candidate[]),
  trainingPrograms: readLS('deed_trainingPrograms', [] as TrainingProgram[]),
  employeeTrainings: readLS('deed_employeeTrainings', [] as EmployeeTraining[]),

  setEmployees: (u) => set(state => ({ employees: resolve(u, state.employees) })),
  setLeaveRequests: (u) => set(state => ({ leaveRequests: resolve(u, state.leaveRequests) })),
  setLeaveBalances: (u) => set(state => ({ leaveBalances: resolve(u, state.leaveBalances) })),
  setDepartments: makeSyncedSetter(set, get, 'departments', 'deed_departments'),
  setHRDocuments: makeSyncedSetter(set, get, 'hrDocuments', 'deed_hrDocuments'),
  setJobPostings: makeSyncedSetter(set, get, 'jobPostings', 'deed_jobPostings'),
  setCandidates: makeSyncedSetter(set, get, 'candidates', 'deed_candidates'),
  setTrainingPrograms: makeSyncedSetter(set, get, 'trainingPrograms', 'deed_trainingPrograms'),
  setEmployeeTrainings: makeSyncedSetter(set, get, 'employeeTrainings', 'deed_employeeTrainings'),

  addEmployee: async (employee) => {
    const { ctx } = get()
    if (!canManageHR(ctx.currentUser())) { ctx.showToast('Only HR admins can create employees', 'error'); throw new Error('Unauthorized employee creation') }
    const tempId = uid()
    const record = { ...employee, id: tempId }
    get().setEmployees(prev => [record, ...prev])

    try {
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employee),
      })
      if (!response.ok) {
        const payload = await response.json().catch(async () => ({ message: await response.text() }))
        throw new Error(payload?.message ?? 'Unable to save employee')
      }
      const saved = await response.json() as Employee
      get().setEmployees(prev => prev.map(emp => emp.id === tempId ? saved : emp))
      ctx.addAuditLog('create_employee', saved.employeeNo, `Created employee ${saved.fullName}`)
      ctx.showToast('Employee created')
      return saved
    } catch (error) {
      get().setEmployees(prev => prev.filter(emp => emp.id !== tempId))
      ctx.showToast(`Employee was not saved to the database: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
      throw error
    }
  },

  updateEmployee: (id, patch) => {
    const { ctx } = get()
    if (!canManageHR(ctx.currentUser())) { ctx.showToast('Only HR admins can update employees', 'error'); return }
    const before = get().employees.find(e => e.id === id)
    get().setEmployees(prev => prev.map(emp => emp.id === id ? { ...emp, ...patch } : emp))
    const updated = get().employees.find(e => e.id === id)
    if (updated) {
      fetch(`/api/employees/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        .then(async response => {
          if (!response.ok) throw new Error(await response.text())
          return response.json() as Promise<Employee>
        })
        .then(saved => get().setEmployees(current => current.map(emp => emp.id === id ? saved : emp)))
        .catch(error => {
          if (before) get().setEmployees(current => current.map(emp => emp.id === id ? before : emp))
          ctx.showToast(`Employee update was not saved to the database: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
        })
    }
    ctx.addAuditLog('update_employee', id, `Updated employee ${id}`)
    ctx.showToast('Employee updated')
  },

  addLeaveRequest: (request) => {
    const { ctx } = get()
    const user = ctx.currentUser()
    if (!user) { ctx.showToast('You must be logged in to apply for leave', 'error'); throw new Error('Not authenticated') }

    if (request.leaveType === 'december_closure') {
      ctx.showToast('December closure is applied automatically — no manual request needed', 'error')
      throw new Error('december_closure is system-managed')
    }

    const required = requiredNotice(request.leaveType, request.days)
    if (required > 0) {
      const given = noticeDaysGiven(request.startDate)
      if (given < required) {
        ctx.showToast(
          `Insufficient notice: ${request.days <= 3 ? '≤3 day leave requires 5' : '>3 day leave requires 14'} working days notice. ` +
          `Only ${given} working day${given !== 1 ? 's' : ''} until your start date.`,
          'error'
        )
        throw new Error('Insufficient notice period')
      }
    }

    const conflict = get().leaveRequests.find(r =>
      r.employeeId === request.employeeId &&
      r.status !== 'rejected' && r.status !== 'cancelled' &&
      new Date(r.startDate) <= new Date(request.endDate) &&
      new Date(r.endDate) >= new Date(request.startDate)
    )
    if (conflict) {
      ctx.showToast(`Dates overlap with existing request ${conflict.ref} (${conflict.startDate} – ${conflict.endDate})`, 'error')
      throw new Error('Leave dates overlap')
    }

    const year = new Date(request.startDate).getFullYear()
    const requestEmpGender = get().employees.find(e => e.id === request.employeeId)?.gender
    if (!isLeaveTypeAllowedForGender(request.leaveType, requestEmpGender)) {
      ctx.showToast(`${request.leaveType === 'maternity' ? 'Maternity' : 'Paternity'} leave is not applicable to this employee`, 'error')
      throw new Error('Leave type not applicable for gender')
    }
    const existingBalance = get().leaveBalances.find(b => b.employeeId === request.employeeId && b.leaveType === request.leaveType && b.year === year)
    if (request.leaveType !== 'unpaid') {
      const bal = existingBalance ?? {
        id: uid(), employeeId: request.employeeId, leaveType: request.leaveType, year,
        entitlement: entitlementFor(request.leaveType, requestEmpGender), carryForward: 0, used: 0, pending: 0,
      }
      if (bal) {
        const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
        if (request.days > available) {
          ctx.showToast(`Insufficient ${request.leaveType.replace(/_/g, ' ')} balance — ${available} day(s) available, ${request.days} requested`, 'error')
          throw new Error('Insufficient balance')
        }
      }
    }

    const isHRBooking = ['director', 'admin_officer'].includes(user.role)
    const leave: LeaveRequest = {
      ...request,
      id: uid(),
      ref: seq('LV', 'ret'),
      submittedDate: now(),
      status: isHRBooking ? 'approved' : 'pending_hr',
      submittedByUserId: user.id,
      ...(isHRBooking ? { hrApprovalBy: user.name, hrDecisionDate: now() } : {}),
    }
    get().setLeaveRequests(prev => [leave, ...prev])
    let nextBalancesForEmployee: LeaveBalance[] = []
    get().setLeaveBalances(prev => {
      const hasExisting = prev.some(b => b.employeeId === leave.employeeId && b.leaveType === leave.leaveType && b.year === year)
      const base = hasExisting ? prev : [
        ...prev,
        { id: uid(), employeeId: leave.employeeId, leaveType: leave.leaveType, year, entitlement: entitlementFor(leave.leaveType, requestEmpGender), carryForward: 0, used: 0, pending: 0 } as LeaveBalance,
      ]
      const next = base.map(b =>
        b.employeeId === leave.employeeId && b.leaveType === leave.leaveType && b.year === year
          ? isHRBooking ? { ...b, used: b.used + leave.days } : { ...b, pending: b.pending + leave.days }
          : b
      )
      nextBalancesForEmployee = next.filter(b => b.employeeId === leave.employeeId)
      return next
    })
    if (!isHRBooking) {
      const approval: WorkflowApproval = { id: uid(), process: 'leave', ref: leave.ref, targetId: leave.id, targetName: `${leave.employeeName} — ${leave.leaveType.replace(/_/g, ' ')}`, stepName: 'HR Approval', approverRole: 'director', status: 'pending', requestedBy: leave.employeeName, requestedDate: now() }
      ctx.setWorkflowApprovals(prev => [approval, ...prev])
      ctx.users.filter(u => u.role === 'director').forEach(u => ctx.pushNotif({
        userId: u.id, type: 'leave',
        title: `Leave request from ${leave.employeeName}`,
        body: `${leave.days} day(s) ${leave.leaveType.replace(/_/g, ' ')} — ${leave.startDate} to ${leave.endDate}. Reason: ${leave.reason}`,
        module: 'hr', path: '?tab=leave', icon: '🌴',
      }))
    } else {
      const emp = get().employees.find(e => e.id === leave.employeeId)
      if (emp?.userId) ctx.pushNotif({
        userId: emp.userId, type: 'leave',
        title: 'Leave booked for you',
        body: `${user.name} has booked ${leave.days} day(s) ${leave.leaveType.replace(/_/g, ' ')} for you — ${leave.startDate} to ${leave.endDate}.`,
        module: 'hr', path: '?tab=self_service', icon: '🌴',
      })
    }
    ctx.addAuditLog('create_leave', leave.ref, isHRBooking ? `Leave booked for ${leave.employeeName} by ${user.name} (auto-approved)` : `Leave request created for ${leave.employeeName}`)
    ctx.showToast(isHRBooking ? `Leave booked and approved for ${leave.employeeName}` : 'Leave application submitted — awaiting HR approval')

    // Roll back the optimistic insert if the server rejects (or never receives)
    // the request, so the UI never shows leave that was not actually saved.
    const rollback = (message: string) => {
      get().setLeaveRequests(prev => prev.filter(r => r.id !== leave.id))
      get().setLeaveBalances(prev => prev.map(b =>
        b.employeeId === leave.employeeId && b.leaveType === leave.leaveType && b.year === year
          ? isHRBooking ? { ...b, used: Math.max(0, b.used - leave.days) } : { ...b, pending: Math.max(0, b.pending - leave.days) }
          : b))
      ctx.setWorkflowApprovals(prev => prev.filter(flow => flow.targetId !== leave.id))
      ctx.showToast(message, 'error')
    }
    // Only HR bookings may carry a balances snapshot — the server computes
    // balance arithmetic itself for self-service requests.
    const payload = isHRBooking ? { ...leave, balances: nextBalancesForEmployee } : leave
    fetch('/api/leave-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(async response => {
        if (response.ok) {
          // The server owns the canonical id/reference — swap them into the
          // optimistic row so approvals and displays target the real record.
          const data = await response.json().catch(() => null) as { request?: LeaveRequest } | null
          const saved = data?.request
          if (saved?.id) {
            get().setLeaveRequests(prev => prev.map(r => r.id === leave.id ? { ...r, ...saved } : r))
            ctx.setWorkflowApprovals(prev => prev.map(flow => flow.targetId === leave.id ? { ...flow, targetId: saved.id, ref: saved.ref } : flow))
          }
          return
        }
        const err = await response.json().catch(() => null) as { error?: string } | null
        rollback(`Leave request was not saved: ${err?.error ?? `server error (${response.status})`}`)
      })
      .catch(() => rollback('Leave request was not saved — could not reach the server. Please try again.'))
    return leave
  },

  decideLeaveRequest: (id, approved, note) => {
    const { ctx } = get()
    const leave = get().leaveRequests.find(req => req.id === id)
    if (!leave) return
    const user = ctx.currentUser()

    let canApprove = false
    if (['director', 'admin_officer', 'finance_officer'].includes(user?.role ?? '')) canApprove = true
    if (user?.role === 'technical_lead') {
      const targetEmp = get().employees.find(e => e.id === leave.employeeId)
      const targetUser = ctx.users.find(u => u.id === targetEmp?.userId)
      if (targetUser?.role === 'technician') canApprove = true
    }
    if (!canApprove) { ctx.showToast('Only an Admin or Lead Tech (for Technicians) can approve or reject leave requests', 'error'); return }

    const nextStatus: LeaveRequest['status'] = approved ? 'approved' : 'rejected'
    const year = new Date(leave.startDate).getFullYear()

    get().setLeaveRequests(prev => {
      const nextReqs = prev.map(req => req.id === id ? { ...req, status: nextStatus, hrApprovalBy: user!.name, hrDecisionDate: now() } : req)
      const updatedReq = nextReqs.find(r => r.id === id)
      get().setLeaveBalances(balPrev => {
        const nextBals = balPrev.map(b => b.employeeId === leave.employeeId && b.leaveType === leave.leaveType && b.year === year
          ? (approved ? { ...b, pending: Math.max(0, b.pending - leave.days), used: b.used + leave.days } : { ...b, pending: Math.max(0, b.pending - leave.days) }) : b)
        if (updatedReq) fetch(`/api/leave-requests/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: updatedReq, balances: nextBals.filter(b => b.employeeId === leave.employeeId) }) }).catch(() => {})
        return nextBals
      })
      return nextReqs
    })

    ctx.setWorkflowApprovals(prev => prev.map(flow => flow.targetId === id && flow.status === 'pending' ? { ...flow, status: approved ? 'approved' : 'rejected', approverUserId: user!.id, decisionDate: now() } : flow))
    const emp = get().employees.find(e => e.id === leave.employeeId)
    const empUserId = emp?.userId
    if (empUserId) {
      ctx.pushNotif({
        userId: empUserId, type: 'leave',
        title: approved ? 'Leave request approved ✓' : 'Leave request rejected',
        body: `Your ${leave.leaveType.replace(/_/g, ' ')} request (${leave.days} day${leave.days !== 1 ? 's' : ''}, ${leave.startDate} – ${leave.endDate}) has been ${approved ? 'approved' : 'rejected'} by ${user!.name}.`,
        module: 'hr', path: '?tab=self_service', icon: approved ? '✅' : '❌',
      })
    }
    ctx.addAuditLog('decide_leave', leave.ref, `Leave request ${approved ? 'approved' : 'rejected'} by ${user!.name}${note ? ': ' + note : ''}`)
    ctx.showToast(`Leave ${approved ? 'approved' : 'rejected'} successfully`)
  },

  cancelLeaveRequest: (id) => {
    const { ctx } = get()
    const user = ctx.currentUser()
    const req = get().leaveRequests.find(r => r.id === id)
    if (!req) return
    if (req.status === 'rejected' || req.status === 'cancelled') { ctx.showToast('This request is already closed', 'error'); return }
    const isHR = ['director', 'admin_officer', 'finance_officer'].includes(user?.role ?? '')
    const isOwn = req.submittedByUserId === user?.id
    if (!isHR && !isOwn) { ctx.showToast('You can only cancel your own leave requests', 'error'); return }
    const year = new Date(req.startDate).getFullYear()
    get().setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' as const } : r))
    get().setLeaveBalances(prev => prev.map(b => {
      if (b.employeeId !== req.employeeId || b.leaveType !== req.leaveType || b.year !== year) return b
      if (req.status === 'pending_hr') return { ...b, pending: Math.max(0, b.pending - req.days) }
      if (req.status === 'approved') return { ...b, used: Math.max(0, b.used - req.days) }
      return b
    }))
    ctx.addAuditLog('cancel_leave', req.ref, `Leave request cancelled by ${user?.name}`)
    ctx.showToast('Leave request cancelled')
    const cancelledBals = get().leaveBalances.filter(b => b.employeeId === req.employeeId)
    fetch(`/api/leave-requests/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: { ...req, status: 'cancelled' }, balances: cancelledBals }) }).catch(() => {})
  },

  updateLeaveBalance: (id, patch) => {
    const { ctx } = get()
    if (!canManageHR(ctx.currentUser())) { ctx.showToast('Only HR admins can adjust leave balances', 'error'); return }
    get().setLeaveBalances(prev => {
      const next = prev.map(b => b.id === id ? { ...b, ...patch } : b)
      const bal = next.find(b => b.id === id)
      if (bal) fetch('/api/leave-requests/balances', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ balances: next.filter(b => b.employeeId === bal.employeeId) }) }).catch(() => {})
      return next
    })
    ctx.addAuditLog('adjust_leave_balance', id, `Balance adjusted by ${ctx.currentUser()?.name}`)
    ctx.showToast('Leave balance updated')
  },

  initYearBalances: (year) => {
    const { ctx } = get()
    if (!canManageHR(ctx.currentUser())) { ctx.showToast('Only HR admins can initialise leave balances', 'error'); return }
    const ALL_TYPES: StoreLeaveType[] = ['annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid', 'december_closure']
    const activeEmps = get().employees.filter(e => e.status === 'active')
    let created = 0
    get().setLeaveBalances(prev => {
      const next = [...prev]
      for (const emp of activeEmps) {
        // Gender-restricted types (maternity/paternity) are skipped for the other gender.
        for (const type of ALL_TYPES.filter(t => isLeaveTypeAllowedForGender(t, emp.gender))) {
          if (!next.find(b => b.employeeId === emp.id && b.leaveType === type && b.year === year)) {
            next.push({ id: uid(), employeeId: emp.id, leaveType: type, year, entitlement: entitlementFor(type, emp.gender), used: 0, pending: 0, carryForward: 0 })
            created++
          }
        }
      }
      return next
    })
    ctx.addAuditLog('init_leave_balances', String(year), `Balances initialised for ${year} (${created} records)`)
    ctx.showToast(`Leave balances initialised for ${year} — ${created} record(s) created`)
    fetch('/api/leave-requests/balances', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ balances: get().leaveBalances }) }).catch(() => {})
  },

  applyDecemberClosure: (year) => {
    const { ctx } = get()
    if (!canManageHR(ctx.currentUser())) { ctx.showToast('Only HR admins can apply December closure', 'error'); return }
    const activeEmps = get().employees.filter(e => e.status === 'active')
    const startDate = `${year}-12-23`
    const endDate = `${year + 1}-01-02`
    const days = decemberClosureDays(year)
    let applied = 0
    const newReqs: LeaveRequest[] = []
    for (const emp of activeEmps) {
      const alreadyApplied = get().leaveRequests.some(r =>
        r.employeeId === emp.id && r.leaveType === 'december_closure' &&
        r.startDate === startDate && r.status !== 'rejected' && r.status !== 'cancelled'
      )
      if (alreadyApplied) continue
      newReqs.push({
        id: uid(), ref: seq('LV', 'ret'),
        employeeId: emp.id, employeeName: emp.fullName,
        leaveType: 'december_closure',
        startDate, endDate, days,
        reason: `Deed Technologies mandatory year-end closure ${year}/${year + 1}`,
        status: 'approved', submittedDate: now(), isSystemGenerated: true,
      })
      applied++
    }
    if (newReqs.length > 0) {
      get().setLeaveRequests(prev => [...newReqs, ...prev])
      get().setLeaveBalances(prev => prev.map(b => {
        if (b.leaveType !== 'december_closure' || b.year !== year) return b
        if (!newReqs.find(r => r.employeeId === b.employeeId)) return b
        return { ...b, used: b.used + days }
      }))
    }
    ctx.addAuditLog('apply_dec_closure', String(year), `December closure ${year} applied to ${applied} employees (${days} working days each)`)
    ctx.showToast(applied > 0
      ? `December closure applied to ${applied} employee${applied !== 1 ? 's' : ''} (${days} working days)`
      : 'December closure already applied to all active employees'
    )
    if (newReqs.length > 0) {
      fetch('/api/leave-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bulkRequests: newReqs, balances: get().leaveBalances }) }).catch(() => {})
    }
  },

  expireYearEndBalances: (year) => {
    const { ctx } = get()
    if (!canManageHR(ctx.currentUser())) { ctx.showToast('Only HR admins can expire leave balances', 'error'); return }
    let expired = 0
    get().setLeaveBalances(prev => prev.map(b => {
      if (b.leaveType !== 'annual' || b.year !== year) return b
      const remaining = b.entitlement + b.carryForward - b.used - b.pending
      if (remaining <= 0) return b
      expired++
      return { ...b, used: b.entitlement + b.carryForward - b.pending }
    }))
    ctx.addAuditLog('expire_leave', String(year), `Year-end forfeiture: ${expired} employee(s) lost unused annual days for ${year}`)
    ctx.showToast(expired > 0
      ? `Expired: ${expired} employee${expired !== 1 ? 's' : ''} forfeited unused annual days for ${year}`
      : `No unused annual leave to expire for ${year}`
    )
    fetch('/api/leave-requests/balances', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ balances: get().leaveBalances }) }).catch(() => {})
  },

  addHRDocument: (document) => {
    const { ctx } = get()
    if (!canManageHR(ctx.currentUser())) { ctx.showToast('Only HR admins can add HR documents', 'error'); throw new Error('Unauthorized HR document creation') }
    const doc = { ...document, id: uid() }
    get().setHRDocuments(prev => [doc, ...prev])
    ctx.addAuditLog('add_hr_document', doc.title, `Added document ${doc.title}`)
    ctx.showToast('HR document added')
    return doc
  },

  addJobPosting: (p) => {
    get().setJobPostings(prev => [{ ...p, id: uid(), postedDate: now() }, ...prev])
    get().ctx.showToast('Job posting added', 'success')
  },
  updateJobPosting: (id, p) => {
    get().setJobPostings(prev => prev.map(j => j.id === id ? { ...j, ...p } : j))
    get().ctx.showToast('Job posting updated')
  },
  addCandidate: (c) => {
    get().setCandidates(prev => [{ ...c, id: uid(), appliedDate: now() }, ...prev])
    get().ctx.showToast('Candidate added', 'success')
  },
  updateCandidate: (id, p) => {
    get().setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...p } : c))
    get().ctx.showToast('Candidate updated')
  },
  addTrainingProgram: (t) => {
    get().setTrainingPrograms(prev => [{ ...t, id: uid() }, ...prev])
    get().ctx.showToast('Training program added', 'success')
  },
  enrollEmployeeTraining: (employeeId, trainingId) => {
    get().setEmployeeTrainings(prev => [{ id: uid(), employeeId, trainingId, status: 'not_started', enrolledDate: now() }, ...prev])
    get().ctx.showToast('Employee enrolled in training', 'success')
  },
  updateTrainingStatus: (id, status, score) => {
    get().setEmployeeTrainings(prev => prev.map(t => t.id === id ? { ...t, status, score, completedDate: status === 'completed' ? now() : t.completedDate } : t))
    get().ctx.showToast('Training status updated')
  },
}))
