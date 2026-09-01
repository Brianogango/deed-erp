'use client'
import { useState, useMemo } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Badge, Field, Input, Modal, PanelHeader, Select, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faCircleExclamation, faCheck, faXmark, faCircleCheck, faCircleXmark } from '@fortawesome/free-solid-svg-icons'
import { CALENDAR_DAY_TYPES, employeeLeaveTypesFor, formatLocalDate, isLeaveTypeAllowedForGender, leaveDaysForRange, LEAVE_LABELS, type StoreLeaveType } from '@/lib/leave-utils'
import { useUrlUiState } from '@/hooks/useUrlRecordId'

// Days are always derived from the date range so a request can never claim
// more (or fewer) days than the dates cover — maternity/paternity count
// calendar days, everything else working days (Mon–Sat, excl. public holidays).
function daysForRange(leaveType: string, startDate: string, endDate: string): number {
  return leaveDaysForRange(leaveType as StoreLeaveType, startDate, endDate)
}

const leaveTypeColors: Record<string, { bg: string; color: string }> = {
  annual:                { bg: 'rgba(16,185,129,0.1)',  color: 'var(--success-text)' },
  maternity:             { bg: 'rgba(139,92,246,0.1)', color: '#5B21B6' },
  paternity:             { bg: 'rgba(59,130,246,0.1)', color: 'var(--primary-dark)' },
  compassionate:         { bg: 'rgba(249,115,22,0.1)', color: '#9A3412' },
  study:                 { bg: 'rgba(14,165,233,0.1)', color: '#075985' },
  december_closure:      { bg: 'rgba(245,158,11,0.1)', color: 'var(--warning-text)' },
  annual_leave:          { bg: 'rgba(16,185,129,0.1)',  color: 'var(--success-text)' },
  sick_leave:            { bg: 'rgba(239,68,68,0.1)',   color: '#991B1B' },
  maternity_leave:       { bg: 'rgba(139,92,246,0.1)', color: '#5B21B6' },
  paternity_leave:       { bg: 'rgba(59,130,246,0.1)', color: 'var(--primary-dark)' },
  study_leave:           { bg: 'rgba(139,92,246,0.1)', color: '#5B21B6' },
  unpaid_leave:          { bg: 'rgba(107,114,128,0.1)', color: 'var(--text-3)' },
  flexible_leave:        { bg: 'rgba(59,130,246,0.1)', color: 'var(--navy)' },
  december_leave:        { bg: 'rgba(245,158,11,0.1)', color: 'var(--warning-text)' },
  maternity_paternity:   { bg: 'rgba(139,92,246,0.1)', color: '#5B21B6' },
  unpaid:                { bg: 'rgba(107,114,128,0.1)', color: 'var(--text-3)' },
  sick:                  { bg: 'rgba(239,68,68,0.1)',  color: '#991B1B' },
}

function leaveTypeChip(type: string) {
  const c = leaveTypeColors[type] ?? { bg: 'rgba(107,114,128,0.1)', color: 'var(--text-3)' }
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: c.bg, color: c.color, fontWeight: 500, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
      {type.replace(/_/g, ' ')}
    </span>
  )
}

function leaveBadge(status: string) {
  return (
    <Badge
      status={status === 'approved' ? 'active' : status === 'rejected' ? 'cancelled' : 'pending'}
      label={status.replace('_', ' ')}
    />
  )
}

export default function HRLeaveTab() {
  const { users, currentUserId } = useApp()
  const {
    employees, leaveRequests, leaveBalances,
    addLeaveRequest, decideLeaveRequest,
  } = useHrStore()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin     = currentUser?.role === 'director'
  const isFinance   = currentUser?.role === 'finance_officer'
  const isAdminOfficer = currentUser?.role === 'admin_officer'
  const isLeadTech  = currentUser?.role === 'technical_lead'
  const canViewTeamHR = isAdmin || isFinance || isAdminOfficer || isLeadTech

  const [decideId, setDecideId] = useState<string | null>(null)
  const [decideNote, setDecideNote] = useState('')
  const [decideError, setDecideError] = useState('')

  const myEmployee      = employees.find(e => e.userId === currentUserId) ?? null
  const myLeaves        = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const myLeaveBalances = leaveBalances.filter(b => b.employeeId === myEmployee?.id && b.year === new Date().getFullYear())

  const pendingLeaves = useMemo(() => leaveRequests.filter(r => r.status === 'pending_hr').length, [leaveRequests])

  const canDecideLeaveFor = (req: { employeeId: string }) => {
    // Own requests are decided by someone else, whatever the caller's role.
    if (myEmployee && req.employeeId === myEmployee.id) return false
    if (isAdmin || isFinance || isAdminOfficer) return true
    if (isLeadTech) {
      const emp = employees.find(e => e.id === req.employeeId)
      const u   = users.find(u => u.id === emp?.userId)
      return u?.role === 'technician'
    }
    return false
  }

  // ── Local state ──
  const [leaveSearch, setLeaveSearchValue] = useUrlUiState('leaveQ', '')
  const [leavePageValue, setLeavePageValue] = useUrlUiState('leavePage', '1')
  const leavePage = Math.max(1, Number.parseInt(leavePageValue, 10) || 1)
  const setLeaveSearch = (value: string) => setLeaveSearchValue(value, { queryPatch: { leavePage: null } })
  const setLeavePage = (page: number) => setLeavePageValue(String(Math.max(1, page)))
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showSelfLeaveModal, setShowSelfLeaveModal] = useState(false)

  const todayLocal = formatLocalDate(new Date())
  const [leaveForm, setLeaveForm] = useState({
    employeeId: '', leaveType: 'annual',
    startDate: todayLocal,
    endDate: todayLocal,
    reason: '',
  })

  const [selfLeaveForm, setSelfLeaveForm] = useState({
    leaveType: 'annual',
    startDate: todayLocal,
    endDate: todayLocal,
    reason: '',
  })

  const leaveDays     = daysForRange(leaveForm.leaveType, leaveForm.startDate, leaveForm.endDate)
  const selfLeaveDays = daysForRange(selfLeaveForm.leaveType, selfLeaveForm.startDate, selfLeaveForm.endDate)

  // Remaining balance for the type the worker is applying for (null when no
  // balance row exists yet — e.g. a future-year application).
  const selfLeaveBalance = myLeaveBalances.find(b => b.leaveType === selfLeaveForm.leaveType) ?? null
  const selfLeaveAvailable = selfLeaveBalance
    ? selfLeaveBalance.entitlement + selfLeaveBalance.carryForward - selfLeaveBalance.used - selfLeaveBalance.pending
    : null
  const selfLeaveInsufficient = selfLeaveForm.leaveType !== 'unpaid' && selfLeaveAvailable !== null && selfLeaveDays > selfLeaveAvailable

  const hrTargetYear = Number(leaveForm.startDate.slice(0, 4)) || new Date().getFullYear()
  const hrLeaveBalance = leaveBalances.find(b =>
    b.employeeId === leaveForm.employeeId && b.leaveType === leaveForm.leaveType && b.year === hrTargetYear,
  ) ?? null
  const hrLeaveAvailable = hrLeaveBalance
    ? hrLeaveBalance.entitlement + hrLeaveBalance.carryForward - hrLeaveBalance.used - hrLeaveBalance.pending
    : null
  const hrLeaveInsufficient = leaveForm.leaveType !== 'unpaid' && hrLeaveAvailable !== null && leaveDays > hrLeaveAvailable

  const submitLeave = () => {
    const emp = employees.find(e => e.id === leaveForm.employeeId)
    if (!emp) return
    try {
      addLeaveRequest({
        employeeId: emp.id, employeeName: emp.fullName,
        leaveType: leaveForm.leaveType as any,
        startDate: leaveForm.startDate, endDate: leaveForm.endDate,
        days: leaveDays, reason: leaveForm.reason,
      })
    } catch {
      return // validation failed — a toast explains why; keep the modal open
    }
    setShowLeaveModal(false)
  }

  const submitSelfLeave = () => {
    if (!myEmployee) return
    try {
      addLeaveRequest({
        employeeId: myEmployee.id, employeeName: myEmployee.fullName,
        leaveType: selfLeaveForm.leaveType as any,
        startDate: selfLeaveForm.startDate, endDate: selfLeaveForm.endDate,
        days: selfLeaveDays, reason: selfLeaveForm.reason,
      })
    } catch {
      return // validation failed — a toast explains why; keep the modal open
    }
    setShowSelfLeaveModal(false)
    setSelfLeaveForm(p => ({ ...p, reason: '' }))
  }

  const displayList = canViewTeamHR ? leaveRequests : myLeaves
  const filtered    = displayList.filter(r => {
    const s = leaveSearch.toLowerCase()
    return !s || r.ref.toLowerCase().includes(s) || r.employeeName.toLowerCase().includes(s) ||
      r.leaveType.toLowerCase().includes(s) || (r.reason ?? '').toLowerCase().includes(s)
  })

  type LeaveRequestRow = typeof filtered[number]

  const leaveColumns: ColumnDef<LeaveRequestRow>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: req => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{req.ref}</span>,
    },
    ...(canViewTeamHR ? [{
      key: 'employee', label: 'Employee', priority: 1 as const, width: '150px',
      render: (req: LeaveRequestRow) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 12 }}>{req.employeeName}</div>
          <div style={{ color: 'var(--text-4)', fontSize: 10 }}>Submitted {fmtDate(req.submittedDate)}</div>
        </div>
      ),
      exportValue: (req: LeaveRequestRow) => req.employeeName,
    }] : []),
    {
      key: 'leaveType', label: 'Leave Type', priority: 1, width: '130px',
      render: req => leaveTypeChip(req.leaveType),
      exportValue: req => req.leaveType,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: req => leaveBadge(req.status),
      exportValue: req => req.status,
    },
    {
      key: 'from', label: 'From', priority: 2, width: '100px',
      render: req => <span style={{ fontSize: 11 }}>{fmtDate(req.startDate)}</span>,
      exportValue: req => req.startDate,
    },
    {
      key: 'to', label: 'To', priority: 2, width: '100px',
      render: req => <span style={{ fontSize: 11 }}>{fmtDate(req.endDate)}</span>,
      exportValue: req => req.endDate,
    },
    {
      key: 'days', label: 'Days', priority: 2, width: '70px',
      render: req => <span style={{ fontWeight: 600 }}>{req.days}d</span>,
      exportValue: req => req.days,
    },
    {
      key: 'reason', label: 'Reason', priority: 3, width: '1.3fr',
      render: req => <span style={{ fontSize: 11, color: 'var(--text-4)' }} className="truncate">{req.reason || '—'}</span>,
      exportValue: req => req.reason ?? '',
    },
    {
      key: 'hrNote', label: 'HR note', priority: 3, width: '1.2fr',
      render: req => <span style={{ fontSize: 11, color: 'var(--text-3)' }} className="truncate">{req.reviewNotes || '—'}</span>,
      exportValue: req => req.reviewNotes ?? '',
    },
  ]

  function leaveRowActions(req: LeaveRequestRow) {
    return (
      <span className="flex gap-1 items-center flex-wrap">
        {req.status === 'pending_hr' && canDecideLeaveFor(req) && (
          <button
            style={{ background: 'var(--primary-light)', border: 'none', borderRadius: 6, color: 'var(--navy)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={e => { e.stopPropagation(); setDecideId(req.id); setDecideNote(''); setDecideError('') }}
          >
            <Fa icon={faCheck} style={{ fontSize: 9 }} /> Decide
          </button>
        )}
        {req.status === 'approved' && (
          <span className="flex items-center gap-1" style={{ color: 'var(--success)', fontSize: 10 }}>
            <Fa icon={faCircleCheck} style={{ fontSize: 10 }} /> {req.hrApprovalBy}
          </span>
        )}
        {req.status === 'rejected' && (
          <span className="flex items-center gap-1" style={{ color: 'var(--danger)', fontSize: 10 }} title={req.reviewNotes || undefined}>
            <Fa icon={faCircleXmark} style={{ fontSize: 10 }} /> Rejected
          </span>
        )}
      </span>
    )
  }

  const currentYear = new Date().getFullYear()
  const balanceRows = canViewTeamHR
    ? employees.flatMap(emp =>
        leaveBalances
          .filter(b => b.employeeId === emp.id && b.year === currentYear)
          .map(bal => ({ ...bal, employeeName: emp.fullName }))
      )
    : myLeaveBalances.map(bal => ({ ...bal, employeeName: myEmployee?.fullName ?? '' }))

  type BalanceRow = typeof balanceRows[number]

  const balanceColumns: ColumnDef<BalanceRow>[] = [
    ...(canViewTeamHR ? [{
      key: 'employee', label: 'Employee', priority: 1 as const, width: '150px',
      render: (bal: BalanceRow) => <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 11 }}>{bal.employeeName}</span>,
      exportValue: (bal: BalanceRow) => bal.employeeName,
    }] : []),
    {
      key: 'leaveType', label: 'Leave Type', priority: 1, width: '140px',
      render: bal => <span style={{ textTransform: 'capitalize', fontSize: 11 }}>{bal.leaveType.replace(/_/g, ' ')}</span>,
      exportValue: bal => bal.leaveType,
    },
    {
      key: 'available', label: 'Available', priority: 1, width: '90px',
      render: bal => {
        const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
        return <span style={{ fontWeight: 600, fontSize: 11, color: available > 0 ? 'var(--success)' : 'var(--danger)' }}>{available}d</span>
      },
      exportValue: bal => bal.entitlement + bal.carryForward - bal.used - bal.pending,
    },
    {
      key: 'entitlement', label: 'Entitlement', priority: 2, width: '90px',
      render: bal => <span style={{ fontSize: 11 }}>{bal.entitlement}d</span>,
      exportValue: bal => bal.entitlement,
    },
    {
      key: 'carryForward', label: 'Carry Fwd', priority: 2, width: '90px',
      render: bal => <span style={{ fontSize: 11, color: bal.carryForward > 0 ? 'var(--navy)' : 'var(--text-4)' }}>{bal.carryForward}d</span>,
      exportValue: bal => bal.carryForward,
    },
    {
      key: 'used', label: 'Used', priority: 2, width: '80px',
      render: bal => <span style={{ fontSize: 11, color: 'var(--danger)' }}>{bal.used}d</span>,
      exportValue: bal => bal.used,
    },
    {
      key: 'pending', label: 'Pending', priority: 3, width: '80px',
      render: bal => <span style={{ fontSize: 11, color: bal.pending > 0 ? 'var(--warning)' : 'var(--text-4)' }}>{bal.pending}d</span>,
      exportValue: bal => bal.pending,
    },
  ]

  const leaveTypeOptions = [
    { value: 'annual',        label: 'Annual Leave' },
    { value: 'sick',          label: 'Sick Leave' },
    { value: 'maternity',     label: 'Maternity Leave' },
    { value: 'paternity',     label: 'Paternity Leave' },
    { value: 'compassionate', label: 'Compassionate / Bereavement' },
    { value: 'study',         label: 'Study / Exam Leave' },
    { value: 'unpaid',        label: 'Unpaid Leave' },
  ]

  // Maternity is female-only; paternity male-only (two weeks). Filter the HR
  // booking options by the selected employee's recorded gender.
  const selectedLeaveEmp = employees.find(e => e.id === leaveForm.employeeId)
  const leaveTypeOptionsForEmp = leaveTypeOptions.filter(o =>
    isLeaveTypeAllowedForGender(o.value as StoreLeaveType, selectedLeaveEmp?.gender))

  return (
    <div className="hr-submodule hr-leave flex flex-col gap-3">
      {/* Pending approvals callout */}
      {pendingLeaves > 0 && canViewTeamHR && (
        <div className="hr-submodule-alert rounded-xl p-3 flex items-center gap-3" style={{ background: 'var(--warning-bg)', border: '1px solid #FDE68A' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--warning)', color: '#fff' }}>
            <Fa icon={faCircleExclamation} />
          </div>
          <div className="text-[12px]" style={{ color: 'var(--warning-text)' }}>
            <span className="font-bold">{pendingLeaves} leave request{pendingLeaves > 1 ? 's' : ''} pending approval.</span>
            {' '}Review and action them below.
          </div>
        </div>
      )}

      {/* Leave requests table */}
      <div className="hr-submodule-panel card overflow-hidden">
        <PanelHeader
          title={canViewTeamHR ? 'All Leave Requests' : 'My Leave Requests'}
          count={filtered.length}
        >
          <input
            className="form-input text-[11px] py-1.5" style={{ width: 180 }}
            placeholder="Search type, reason…"
            value={leaveSearch} onChange={e => setLeaveSearch(e.target.value)}
          />
          <button className="btn-primary text-[11px]"
            onClick={() => canViewTeamHR ? setShowLeaveModal(true) : setShowSelfLeaveModal(true)}>
            {canViewTeamHR ? '+ New Request (HR)' : '+ Apply for Leave'}
          </button>
        </PanelHeader>
        <DataTable
          tableId="hr_leave_requests"
          columns={leaveColumns}
          rows={filtered}
          rowKey={req => req.id}
          hideSearch
          page={leavePage}
          onPageChange={setLeavePage}
          emptyMessage="No leave requests found"
          rowActions={leaveRowActions}
          exportTitle="Leave Requests"
          exportFilename="leave-requests"
        />
      </div>

      {/* Leave balances */}
      <div className="hr-submodule-panel card overflow-hidden">
        <PanelHeader
          title={`Leave Balances — ${new Date().getFullYear()}`}
          count={canViewTeamHR
            ? leaveBalances.filter(b => b.year === new Date().getFullYear()).length
            : myLeaveBalances.length}
        />
        <DataTable
          tableId="hr_leave_balances"
          columns={balanceColumns}
          rows={balanceRows}
          rowKey={bal => bal.id}
          emptyMessage="No leave balances found"
          exportTitle="Leave Balances"
          exportFilename="leave-balances"
        />
      </div>

      {/* HR-side leave modal (admin creates on behalf of employee) */}
      {showLeaveModal && (
        <Modal title="New Leave Request (HR)" onClose={() => setShowLeaveModal(false)} width={520}>
          <Field label="Employee">
            <Select value={leaveForm.employeeId}
              onChange={v => setLeaveForm(p => {
                const emp = employees.find(e => e.id === v)
                const typeOk = isLeaveTypeAllowedForGender(p.leaveType as StoreLeaveType, emp?.gender)
                return { ...p, employeeId: v, leaveType: typeOk ? p.leaveType : 'annual' }
              })}
              options={employees.map(e => ({ value: e.id, label: e.fullName }))} />
          </Field>
          <Field label="Leave Type">
            <Select value={leaveForm.leaveType} onChange={v => setLeaveForm(p => ({ ...p, leaveType: v }))} options={leaveTypeOptionsForEmp} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Date"><Input type="date" value={leaveForm.startDate} onChange={v => setLeaveForm(p => ({ ...p, startDate: v }))} /></Field>
            <Field label="End Date"><Input type="date" value={leaveForm.endDate} onChange={v => setLeaveForm(p => ({ ...p, endDate: v }))} /></Field>
          </div>
          <div className="rounded-lg p-2 text-[11px]" style={{ background: leaveDays > 0 && !hrLeaveInsufficient ? 'var(--success-bg)' : 'var(--danger-bg)', color: leaveDays > 0 && !hrLeaveInsufficient ? 'var(--success)' : 'var(--danger)' }}>
            {leaveDays > 0
              ? <>Duration: <strong>{leaveDays} {CALENDAR_DAY_TYPES.includes(leaveForm.leaveType as StoreLeaveType) ? 'calendar' : 'working'} day(s)</strong> (Mon–Sat working week)</>
              : 'The selected dates contain no leave days — check the date order and that the range is not only Sunday/public holidays'}
          </div>
          {hrLeaveAvailable !== null && leaveForm.leaveType !== 'unpaid' && (
            <div className="rounded-lg p-2 text-[11px] mt-2" style={{ background: hrLeaveInsufficient ? 'var(--danger-bg)' : 'var(--success-bg)', color: hrLeaveInsufficient ? 'var(--danger)' : 'var(--success)' }}>
              Balance: {Math.max(0, hrLeaveAvailable)} day(s) available · Requesting {leaveDays} day(s)
              {hrLeaveInsufficient && <> — cannot book more days than available</>}
            </div>
          )}
          <Field label="Reason"><Textarea value={leaveForm.reason} onChange={v => setLeaveForm(p => ({ ...p, reason: v }))} /></Field>
          <div className="hr-modal-actions flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setShowLeaveModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={submitLeave} disabled={!leaveForm.employeeId || leaveDays <= 0 || hrLeaveInsufficient}>Submit Leave</button>
          </div>
        </Modal>
      )}

      {/* Self-service leave modal (employee books own leave) */}
      {showSelfLeaveModal && (
        <Modal title="Book Leave" onClose={() => setShowSelfLeaveModal(false)} width={480}>
          <div className="rounded-xl p-3 mb-3 text-[12px]" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', color: 'var(--navy-dark)' }}>
            Submitting as: <strong>{myEmployee?.fullName}</strong> · Your request will go to HR for approval.
          </div>
          <Field label="Leave Type">
            <Select value={selfLeaveForm.leaveType} onChange={v => setSelfLeaveForm(p => ({ ...p, leaveType: v }))}
              options={employeeLeaveTypesFor(myEmployee?.gender).map(t => ({ value: t, label: LEAVE_LABELS[t] }))} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Date"><Input type="date" value={selfLeaveForm.startDate} onChange={v => setSelfLeaveForm(p => ({ ...p, startDate: v }))} /></Field>
            <Field label="End Date"><Input type="date" value={selfLeaveForm.endDate} onChange={v => setSelfLeaveForm(p => ({ ...p, endDate: v }))} /></Field>
          </div>
          <div className="rounded-lg p-2 text-[11px]" style={{ background: selfLeaveDays > 0 ? 'var(--success-bg)' : 'var(--danger-bg)', color: selfLeaveDays > 0 ? 'var(--success)' : 'var(--danger)' }}>
            {selfLeaveDays > 0
              ? <>Requesting <strong>{selfLeaveDays} {CALENDAR_DAY_TYPES.includes(selfLeaveForm.leaveType as StoreLeaveType) ? 'calendar' : 'working'} day(s)</strong> (calculated from the selected dates)</>
              : 'The selected dates contain no leave days — check the date order and that the range is not only Sunday/public holidays'}
          </div>
          <Field label="Reason / Notes">
            <Textarea value={selfLeaveForm.reason} onChange={v => setSelfLeaveForm(p => ({ ...p, reason: v }))} placeholder="Briefly explain your leave reason" />
          </Field>
          {selfLeaveAvailable !== null && selfLeaveForm.leaveType !== 'unpaid' && (
            <div className="rounded-lg p-2 text-[11px] mt-2" style={{ background: selfLeaveInsufficient ? 'var(--danger-bg)' : 'var(--success-bg)', color: selfLeaveInsufficient ? 'var(--danger)' : 'var(--success)' }}>
              Balance: {Math.max(0, selfLeaveAvailable)} day(s) available · Requesting {selfLeaveDays} day(s)
              {selfLeaveInsufficient && <> — you cannot request more days than you have available</>}
            </div>
          )}
          <div className="hr-modal-actions flex justify-end gap-2 mt-2">
            <button className="btn-outline" onClick={() => setShowSelfLeaveModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={submitSelfLeave} disabled={!selfLeaveForm.reason.trim() || selfLeaveDays <= 0 || selfLeaveInsufficient}>Submit Request</button>
          </div>
        </Modal>
      )}
      {decideId && (() => {
        const req = leaveRequests.find(r => r.id === decideId)
        if (!req) return null
        const submit = (approved: boolean) => {
          const note = decideNote.trim()
          if (!approved && !note) {
            setDecideError('Add a note so the applicant knows why the leave was declined.')
            return
          }
          decideLeaveRequest(req.id, approved, note || undefined)
          setDecideId(null)
          setDecideNote('')
          setDecideError('')
        }
        return (
          <Modal title="Leave decision" subtitle={`${req.ref} · ${req.employeeName}`} onClose={() => { setDecideId(null); setDecideError('') }} width={480}>
            <div className="hr-decision-summary grid grid-cols-2 gap-3 text-xs mb-3">
              <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                <p className="text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>Leave type</p>
                <p className="font-semibold" style={{ textTransform: 'capitalize' }}>{req.leaveType.replace(/_/g, ' ')}</p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                <p className="text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>Period</p>
                <p className="font-semibold">{fmtDate(req.startDate)} → {fmtDate(req.endDate)}</p>
                <p style={{ color: 'var(--text-3)' }}>{req.days} day{req.days !== 1 ? 's' : ''}</p>
              </div>
              <div className="col-span-2 p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                <p className="text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>Applicant reason</p>
                <p>{req.reason || '—'}</p>
              </div>
            </div>
            <Field label="Note to applicant" hint="Required when declining. Shown in their leave email and leave history.">
              <Textarea
                value={decideNote}
                onChange={v => { setDecideNote(v); if (decideError) setDecideError('') }}
                rows={3}
                placeholder="e.g. Approved — enjoy your time off / Declined — insufficient cover that week"
              />
            </Field>
            {decideError && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{decideError}</p>
            )}
            <div className="hr-modal-actions hr-modal-actions--decision flex gap-2 justify-end pt-3">
              <button className="btn-outline" onClick={() => { setDecideId(null); setDecideError('') }}>Cancel</button>
              <button
                style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                onClick={() => submit(false)}
              >
                <Fa icon={faXmark} style={{ fontSize: 10, marginRight: 4 }} /> Decline
              </button>
              <button className="btn-primary" style={{ background: 'var(--success)' }} onClick={() => submit(true)}>
                <Fa icon={faCheck} style={{ fontSize: 10, marginRight: 4 }} /> Approve
              </button>
            </div>
          </Modal>
        )
      })()}

    </div>
  )
}
