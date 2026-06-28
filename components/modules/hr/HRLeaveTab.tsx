'use client'
import { useState, useMemo } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Badge, Field, Input, Modal, PanelHeader, Select, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faCircleExclamation, faCheck, faXmark, faCircleCheck, faCircleXmark } from '@fortawesome/free-solid-svg-icons'

const leaveTypeColors: Record<string, { bg: string; color: string }> = {
  annual_leave:          { bg: 'rgba(16,185,129,0.1)',  color: '#065F46' },
  sick_leave:            { bg: 'rgba(239,68,68,0.1)',   color: '#991B1B' },
  maternity_leave:       { bg: 'rgba(139,92,246,0.1)', color: '#5B21B6' },
  paternity_leave:       { bg: 'rgba(59,130,246,0.1)', color: '#1D4ED8' },
  study_leave:           { bg: 'rgba(139,92,246,0.1)', color: '#5B21B6' },
  unpaid_leave:          { bg: 'rgba(107,114,128,0.1)', color: '#374151' },
  flexible_leave:        { bg: 'rgba(59,130,246,0.1)', color: '#1B2762' },
  december_leave:        { bg: 'rgba(245,158,11,0.1)', color: '#92400E' },
  maternity_paternity:   { bg: 'rgba(139,92,246,0.1)', color: '#5B21B6' },
  unpaid:                { bg: 'rgba(107,114,128,0.1)', color: '#374151' },
  sick:                  { bg: 'rgba(239,68,68,0.1)',  color: '#991B1B' },
}

function leaveTypeChip(type: string) {
  const c = leaveTypeColors[type] ?? { bg: 'rgba(107,114,128,0.1)', color: '#374151' }
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
  const isLeadTech  = currentUser?.role === 'technical_lead'
  const canViewTeamHR = isAdmin || isFinance || isLeadTech

  const myEmployee      = employees.find(e => e.userId === currentUserId) ?? null
  const myLeaves        = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const myLeaveBalances = leaveBalances.filter(b => b.employeeId === myEmployee?.id && b.year === new Date().getFullYear())

  const pendingLeaves = useMemo(() => leaveRequests.filter(r => r.status === 'pending_hr').length, [leaveRequests])

  const canDecideLeaveFor = (req: { employeeId: string }) => {
    if (isAdmin || isFinance) return true
    if (isLeadTech) {
      const emp = employees.find(e => e.id === req.employeeId)
      const u   = users.find(u => u.id === emp?.userId)
      return u?.role === 'technician'
    }
    return false
  }

  // ── Local state ──
  const [leaveSearch, setLeaveSearch] = useState('')
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showSelfLeaveModal, setShowSelfLeaveModal] = useState(false)

  const [leaveForm, setLeaveForm] = useState({
    employeeId: '', leaveType: 'annual',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    days: '1', reason: '',
  })

  const [selfLeaveForm, setSelfLeaveForm] = useState({
    leaveType: 'annual',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    days: '1', reason: '',
  })

  const submitLeave = () => {
    const emp = employees.find(e => e.id === leaveForm.employeeId)
    if (!emp) return
    addLeaveRequest({
      employeeId: emp.id, employeeName: emp.fullName,
      leaveType: leaveForm.leaveType as any,
      startDate: leaveForm.startDate, endDate: leaveForm.endDate,
      days: Number(leaveForm.days) || 1, reason: leaveForm.reason,
    })
    setShowLeaveModal(false)
  }

  const submitSelfLeave = () => {
    if (!myEmployee) return
    addLeaveRequest({
      employeeId: myEmployee.id, employeeName: myEmployee.fullName,
      leaveType: selfLeaveForm.leaveType as any,
      startDate: selfLeaveForm.startDate, endDate: selfLeaveForm.endDate,
      days: Number(selfLeaveForm.days) || 1, reason: selfLeaveForm.reason,
    })
    setShowSelfLeaveModal(false)
    setSelfLeaveForm(p => ({ ...p, reason: '', days: '1' }))
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
      render: req => <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{req.ref}</span>,
    },
    ...(canViewTeamHR ? [{
      key: 'employee', label: 'Employee', priority: 1 as const, width: '150px',
      render: (req: LeaveRequestRow) => (
        <div>
          <div style={{ fontWeight: 600, color: '#111827', fontSize: 12 }}>{req.employeeName}</div>
          <div style={{ color: '#9CA3AF', fontSize: 10 }}>Submitted {fmtDate(req.submittedDate)}</div>
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
      render: req => <span style={{ fontSize: 11, color: '#6B7280' }} className="truncate">{req.reason || '—'}</span>,
      exportValue: req => req.reason ?? '',
    },
  ]

  function leaveRowActions(req: LeaveRequestRow) {
    return (
      <span className="flex gap-1 items-center flex-wrap">
        {req.status === 'pending_hr' && canDecideLeaveFor(req) && (
          <>
            <button
              style={{ background: '#F0FDF4', border: 'none', borderRadius: 6, color: '#059669', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={e => { e.stopPropagation(); decideLeaveRequest(req.id, true) }}
            >
              <Fa icon={faCheck} style={{ fontSize: 9 }} /> Approve
            </button>
            <button
              style={{ background: '#FEF2F2', border: 'none', borderRadius: 6, color: '#DC2626', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={e => { e.stopPropagation(); decideLeaveRequest(req.id, false) }}
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
      render: (bal: BalanceRow) => <span style={{ fontWeight: 600, color: '#111827', fontSize: 11 }}>{bal.employeeName}</span>,
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
        return <span style={{ fontWeight: 600, fontSize: 11, color: available > 0 ? '#059669' : '#EF4444' }}>{available}d</span>
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
      render: bal => <span style={{ fontSize: 11, color: bal.carryForward > 0 ? '#1B2762' : '#9CA3AF' }}>{bal.carryForward}d</span>,
      exportValue: bal => bal.carryForward,
    },
    {
      key: 'used', label: 'Used', priority: 2, width: '80px',
      render: bal => <span style={{ fontSize: 11, color: '#EF4444' }}>{bal.used}d</span>,
      exportValue: bal => bal.used,
    },
    {
      key: 'pending', label: 'Pending', priority: 3, width: '80px',
      render: bal => <span style={{ fontSize: 11, color: bal.pending > 0 ? '#F59E0B' : '#9CA3AF' }}>{bal.pending}d</span>,
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

  return (
    <div className="flex flex-col gap-3">
      {/* Pending approvals callout */}
      {pendingLeaves > 0 && canViewTeamHR && (
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

      {/* Leave requests table */}
      <div className="card overflow-hidden">
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
          emptyMessage="No leave requests found"
          rowActions={leaveRowActions}
          exportTitle="Leave Requests"
          exportFilename="leave-requests"
        />
      </div>

      {/* Leave balances */}
      <div className="card overflow-hidden">
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
            <Select value={leaveForm.employeeId} onChange={v => setLeaveForm(p => ({ ...p, employeeId: v }))}
              options={employees.map(e => ({ value: e.id, label: e.fullName }))} />
          </Field>
          <Field label="Leave Type">
            <Select value={leaveForm.leaveType} onChange={v => setLeaveForm(p => ({ ...p, leaveType: v }))} options={leaveTypeOptions} />
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

      {/* Self-service leave modal (employee books own leave) */}
      {showSelfLeaveModal && (
        <Modal title="Book Leave" onClose={() => setShowSelfLeaveModal(false)} width={480}>
          <div className="rounded-xl p-3 mb-3 text-[12px]" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', color: '#14204F' }}>
            Submitting as: <strong>{myEmployee?.fullName}</strong> · Your request will go to HR for approval.
          </div>
          <Field label="Leave Type">
            <Select value={selfLeaveForm.leaveType} onChange={v => setSelfLeaveForm(p => ({ ...p, leaveType: v }))}
              options={[
                { value: 'flexible_leave',      label: 'Flexible Leave (13 days/year)' },
                { value: 'december_leave',      label: 'December Leave (8 days, Dec only)' },
                { value: 'sick',                label: 'Sick Leave' },
                { value: 'maternity_paternity', label: 'Maternity / Paternity' },
                { value: 'unpaid',              label: 'Unpaid Leave' },
              ]} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Date"><Input type="date" value={selfLeaveForm.startDate} onChange={v => setSelfLeaveForm(p => ({ ...p, startDate: v }))} /></Field>
            <Field label="End Date"><Input type="date" value={selfLeaveForm.endDate} onChange={v => setSelfLeaveForm(p => ({ ...p, endDate: v }))} /></Field>
          </div>
          <Field label="Number of Days"><Input type="number" value={selfLeaveForm.days} onChange={v => setSelfLeaveForm(p => ({ ...p, days: v }))} /></Field>
          <Field label="Reason / Notes">
            <Textarea value={selfLeaveForm.reason} onChange={v => setSelfLeaveForm(p => ({ ...p, reason: v }))} placeholder="Briefly explain your leave reason" />
          </Field>
          {myLeaveBalances.filter(b => b.leaveType === selfLeaveForm.leaveType).map(bal => {
            const available = bal.entitlement + bal.carryForward - bal.used - bal.pending
            return (
              <div key={bal.id} className="rounded-lg p-2 text-[11px] mt-2" style={{ background: available >= Number(selfLeaveForm.days) ? '#F0FDF4' : '#FEF2F2', color: available >= Number(selfLeaveForm.days) ? '#059669' : '#DC2626' }}>
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
    </div>
  )
}
