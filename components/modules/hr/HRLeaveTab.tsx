'use client'
import { useState, useMemo } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { Badge, Field, Input, Modal, PanelHeader, Select, Table, Textarea } from '@/components/ui'
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
  const {
    users, currentUserId, employees, leaveRequests, leaveBalances,
    addLeaveRequest, decideLeaveRequest,
  } = useApp()

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
    employeeId: '', leaveType: 'flexible_leave',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    days: '1', reason: '',
  })

  const [selfLeaveForm, setSelfLeaveForm] = useState({
    leaveType: 'flexible_leave',
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

  const leaveTypeOptions = [
    { value: 'flexible_leave',      label: 'Flexible Leave' },
    { value: 'december_leave',      label: 'December Leave' },
    { value: 'sick',                label: 'Sick Leave' },
    { value: 'maternity_paternity', label: 'Maternity / Paternity' },
    { value: 'unpaid',              label: 'Unpaid Leave' },
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
        <Table cols={[
          { label: 'Ref',        width: '0.8fr' },
          ...(canViewTeamHR ? [{ label: 'Employee', width: '1.3fr' }] : []),
          { label: 'Leave Type', width: '1.2fr' },
          { label: 'From',       width: '0.9fr' },
          { label: 'To',         width: '0.9fr' },
          { label: 'Days',       width: '0.5fr' },
          { label: 'Reason',     width: '1.6fr' },
          { label: 'Status',     width: '0.9fr' },
          { label: 'Actions',    width: '1.4fr' },
        ]}>
          {filtered.map(req => (
            <div key={req.id} className="table-row">
              <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{req.ref}</span>
              {canViewTeamHR && (
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
                {req.status === 'pending_hr' && canDecideLeaveFor(req) && (
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

      {/* Leave balances */}
      <div className="card overflow-hidden">
        <PanelHeader
          title={`Leave Balances — ${new Date().getFullYear()}`}
          count={canViewTeamHR
            ? leaveBalances.filter(b => b.year === new Date().getFullYear()).length
            : myLeaveBalances.length}
        />
        <Table cols={[
          ...(canViewTeamHR ? [{ label: 'Employee', width: '1.2fr' }] : []),
          { label: 'Leave Type',  width: '1.3fr' },
          { label: 'Entitlement', width: '0.8fr' },
          { label: 'Carry Fwd',  width: '0.8fr' },
          { label: 'Used',       width: '0.7fr' },
          { label: 'Pending',    width: '0.7fr' },
          { label: 'Available',  width: '0.8fr' },
        ]}>
          {canViewTeamHR
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
