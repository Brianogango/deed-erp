'use client'
import { useState } from 'react'
import { useApp, fmtDate, LeaveRequest } from '@/lib/store'
import { Badge, Field, Input, Modal, Select, StatCard, Divider } from '@/components/ui'
import { Fa } from '@/components/icons'
import {
  faCalendarDays, faCalendarCheck, faCalendarXmark,
  faHourglassHalf, faPlus, faCheck, faXmark, faCircleInfo,
} from '@fortawesome/free-solid-svg-icons'

type LeaveType = LeaveRequest['leaveType']

const LEAVE_LABELS: Record<LeaveType, string> = {
  annual:              'Annual Leave',
  sick:                'Sick Leave',
  maternity_paternity: 'Maternity / Paternity',
  unpaid:              'Unpaid Leave',
  december_leave:      'December Leave',
  flexible_leave:      'Flexible Leave',
}

const LEAVE_COLORS: Record<LeaveType, string> = {
  annual:              '#10B981',
  sick:                '#EF4444',
  maternity_paternity: '#8B5CF6',
  unpaid:              '#6B7280',
  december_leave:      '#F59E0B',
  flexible_leave:      '#3B82F6',
}

// Calculate business days between two dates (Mon–Fri)
function calcDays(start: string, end: string): number {
  if (!start || !end) return 0
  let s = new Date(start), e = new Date(end)
  if (e < s) return 0
  let days = 0
  const cur = new Date(s)
  while (cur <= e) {
    const d = cur.getDay()
    if (d !== 0 && d !== 6) days++
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

export default function LeaveApplication() {
  const {
    employees, users, currentUserId,
    leaveRequests, leaveBalances, departments,
    addLeaveRequest, decideLeaveRequest, showToast,
  } = useApp()

  const currentUser  = users.find(u => u.id === currentUserId) ?? null
  const isAdmin      = currentUser?.role === 'admin'
  const isFinance    = currentUser?.role === 'finance'
  const isLeadTech   = currentUser?.role === 'lead_tech'
  // Anyone who can see and approve leave requests
  const isManager    = isAdmin || isFinance || isLeadTech
  const myEmployee   = employees.find(e => e.userId === currentUserId) ?? null
  const myDept       = departments.find(d => d.id === myEmployee?.departmentId)
  const myLeaves     = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const myBalances   = leaveBalances.filter(b => b.employeeId === myEmployee?.id && b.year === new Date().getFullYear())

  // lead_tech can only decide for repair_tech team members
  const canDecideLeave = (req: LeaveRequest) => {
    if (isAdmin || isFinance) return true
    if (isLeadTech) {
      const emp = employees.find(e => e.id === req.employeeId)
      const u   = users.find(u => u.id === emp?.userId)
      return u?.role === 'repair_tech'
    }
    return false
  }

  // leave list visible to managers (lead_tech sees only their team's)
  const managedLeaves = isLeadTech && !isAdmin && !isFinance
    ? leaveRequests.filter(r => {
        const emp = employees.find(e => e.id === r.employeeId)
        const u   = users.find(u => u.id === emp?.userId)
        return u?.role === 'repair_tech'
      })
    : leaveRequests

  const [tab, setTab]             = useState<'my_leaves' | 'all_requests'>(isManager ? 'all_requests' : 'my_leaves')
  const [showForm, setShowForm]   = useState(false)

  // Form state
  const [fType, setFType]         = useState<LeaveType>('annual')
  const [fStart, setFStart]       = useState('')
  const [fEnd, setFEnd]           = useState('')
  const [fReason, setFReason]     = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Admin approve/reject
  const [decideId, setDecideId]   = useState<string | null>(null)
  const [decideNote, setDecideNote] = useState('')

  // Admin list filter
  const [adminStatusFilter, setAdminStatusFilter] = useState<'all' | LeaveRequest['status']>('all')

  const computedDays = calcDays(fStart, fEnd)

  const pendingAll   = managedLeaves.filter(r => r.status === 'pending_hr')
  const filteredAll  = adminStatusFilter === 'all'
    ? managedLeaves
    : managedLeaves.filter(r => r.status === adminStatusFilter)

  const getBalance = (type: LeaveType) => {
    const b = myBalances.find(b => b.leaveType === type)
    if (!b) return null
    return { available: b.entitlement + b.carryForward - b.used - b.pending, ...b }
  }

  const handleSubmit = () => {
    if (!myEmployee) { showToast('No employee record linked. Contact HR.', 'error'); return }
    if (!fStart || !fEnd) { showToast('Select start and end dates', 'error'); return }
    if (computedDays <= 0) { showToast('End date must be after start date', 'error'); return }
    if (!fReason.trim()) { showToast('Please provide a reason', 'error'); return }

    setSubmitting(true)
    try {
      addLeaveRequest({
        employeeId:   myEmployee.id,
        employeeName: myEmployee.fullName,
        leaveType:    fType,
        startDate:    fStart,
        endDate:      fEnd,
        days:         computedDays,
        reason:       fReason.trim(),
      })
      setShowForm(false)
      setFType('annual'); setFStart(''); setFEnd(''); setFReason('')
      setTab('my_leaves')
    } catch {
      // error toast already shown by store
    } finally {
      setSubmitting(false)
    }
  }

  const handleDecide = (approved: boolean) => {
    if (!decideId) return
    decideLeaveRequest(decideId, approved, decideNote)
    setDecideId(null); setDecideNote('')
  }

  const statusColor = (s: LeaveRequest['status']) =>
    s === 'approved' ? '#10B981' : s === 'rejected' ? '#EF4444' : '#F59E0B'
  const statusIcon  = (s: LeaveRequest['status']) =>
    s === 'approved' ? faCalendarCheck : s === 'rejected' ? faCalendarXmark : faHourglassHalf

  return (
    <div className="flex flex-col gap-3">

      {/* ── Employee summary ── */}
      {myEmployee ? (
        <div className="card p-4 flex items-center gap-6 flex-wrap">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #06AED4, #0284C7)' }}>
            {myEmployee.fullName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-sm">{myEmployee.fullName}</p>
            <p className="text-[11px] text-t3">{myEmployee.jobTitle} · {myDept?.name ?? 'No Department'}</p>
            <p className="text-[11px] text-t3">Staff No: {myEmployee.employeeNo}</p>
          </div>
          <div className="ml-auto flex gap-2">
            <button className="btn-primary text-[11px]" onClick={() => setShowForm(true)}>
              <Fa icon={faPlus} className="mr-1" /> Apply for Leave
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-5 text-center" style={{ border: '1px dashed var(--border-lt)' }}>
          <Fa icon={faCircleInfo} style={{ fontSize: 24, color: '#fec84b', marginBottom: 8 }} />
          <p className="text-sm font-semibold mb-1">No Employee Record Found</p>
          <p className="text-xs text-t3">Your account is not linked to an employee record. Please contact HR to set up your employee profile.</p>
        </div>
      )}

      {/* ── Leave balance cards ── */}
      {myEmployee && myBalances.length > 0 && (
        <div className="grid grid-cols-3 gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {myBalances.map(b => {
            const avail = b.entitlement + b.carryForward - b.used - b.pending
            const color = LEAVE_COLORS[b.leaveType]
            return (
              <div key={b.id} className="card p-3">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>{LEAVE_LABELS[b.leaveType]}</p>
                <p className="text-[22px] font-bold" style={{ color }}>{avail}</p>
                <p className="text-[10px] text-t3">days available</p>
                <div className="flex gap-3 mt-2 text-[10px] text-t3">
                  <span>{b.used} used</span>
                  {b.pending > 0 && <span style={{ color: '#fec84b' }}>{b.pending} pending</span>}
                  {b.carryForward > 0 && <span style={{ color: '#10B981' }}>+{b.carryForward} c/f</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1">
        {[
          { key: 'my_leaves' as const,    label: 'My Leaves',        count: myLeaves.length },
          ...(isManager ? [{ key: 'all_requests' as const, label: isLeadTech && !isAdmin && !isFinance ? 'Team Requests' : 'All Leave Requests', count: managedLeaves.length }] : []),
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? '#E8F3FA' : 'transparent',
              border: `1px solid ${tab === t.key ? '#A8D4E8' : 'transparent'}`,
              borderRadius: 8, cursor: 'pointer',
              color: tab === t.key ? '#1B2762' : '#6B7280',
              padding: '7px 14px', fontSize: 11, fontWeight: tab === t.key ? 600 : 500,
              display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
            }}>
            {t.label}
            {t.count > 0 && <span className="badge badge-gray text-[9px]">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="card overflow-hidden">

        {/* ── My Leave Requests ── */}
        {tab === 'my_leaves' && (
          <>
            {myLeaves.length === 0 ? (
              <div className="py-14 text-center">
                <Fa icon={faCalendarDays} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
                <p className="text-xs text-t3">No leave requests yet</p>
                {myEmployee && (
                  <button className="btn-primary text-[11px] mt-4" onClick={() => setShowForm(true)}>Apply for Leave</button>
                )}
              </div>
            ) : (
              <>
                <div className="table-head" style={{ gridTemplateColumns: '80px 140px 110px 110px 60px 90px 1fr 90px' }}>
                  <span>Ref</span><span>Type</span><span>From</span><span>To</span><span>Days</span><span>Status</span><span>Reason</span><span>Submitted</span>
                </div>
                {myLeaves.map(r => (
                  <div key={r.id} className="table-row" style={{ gridTemplateColumns: '80px 140px 110px 110px 60px 90px 1fr 90px' }}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{r.ref}</span>
                    <span className="text-[11px]" style={{ color: LEAVE_COLORS[r.leaveType] }}>{LEAVE_LABELS[r.leaveType]}</span>
                    <span className="text-[11px] text-t3">{fmtDate(r.startDate)}</span>
                    <span className="text-[11px] text-t3">{fmtDate(r.endDate)}</span>
                    <span className="text-[11px] font-semibold text-center">{r.days}</span>
                    <span className="flex items-center gap-1">
                      <Fa icon={statusIcon(r.status)} style={{ fontSize: 10, color: statusColor(r.status) }} />
                      <span className="text-[10px]" style={{ color: statusColor(r.status) }}>
                        {r.status === 'pending_hr' ? 'Pending' : r.status === 'approved' ? 'Approved' : 'Rejected'}
                      </span>
                    </span>
                    <span className="text-[11px] text-t3 truncate">{r.reason}</span>
                    <span className="text-[10px] text-t3">{fmtDate(r.submittedDate)}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── All Leave Requests (Manager) ── */}
        {tab === 'all_requests' && isManager && (
          <>
            {/* Status filter */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
              {([
                { value: 'all',        label: 'All',      count: managedLeaves.length },
                { value: 'pending_hr', label: 'Pending',  count: pendingAll.length },
                { value: 'approved',   label: 'Approved', count: managedLeaves.filter(r => r.status === 'approved').length },
                { value: 'rejected',   label: 'Rejected', count: managedLeaves.filter(r => r.status === 'rejected').length },
              ] as { value: typeof adminStatusFilter; label: string; count: number }[]).map(f => (
                <button key={f.value} onClick={() => setAdminStatusFilter(f.value)}
                  style={{
                    fontSize: 10, padding: '3px 10px', borderRadius: 20, border: '1px solid',
                    cursor: 'pointer',
                    background:  adminStatusFilter === f.value ? '#E8F3FA' : 'transparent',
                    color:       adminStatusFilter === f.value ? '#1B2762' : 'var(--text-3)',
                    borderColor: adminStatusFilter === f.value ? '#A8D4E8' : 'var(--border-lt)',
                    fontWeight:  adminStatusFilter === f.value ? 600 : 400,
                  }}>
                  {f.label} {f.count > 0 && `(${f.count})`}
                </button>
              ))}
            </div>

            {filteredAll.length === 0 ? (
              <div className="py-14 text-center">
                <Fa icon={faCalendarCheck} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
                <p className="text-xs text-t3">No leave requests</p>
              </div>
            ) : (
              <>
                <div className="table-head" style={{ gridTemplateColumns: '80px 1.2fr 140px 90px 90px 50px 90px 1fr 110px' }}>
                  <span>Ref</span><span>Employee</span><span>Type</span><span>From</span><span>To</span><span>Days</span><span>Status</span><span>Reason</span><span>Actions</span>
                </div>
                {filteredAll.map(r => (
                  <div key={r.id} className="table-row" style={{ gridTemplateColumns: '80px 1.2fr 140px 90px 90px 50px 90px 1fr 110px' }}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{r.ref}</span>
                    <span className="font-medium text-[11px]">{r.employeeName}</span>
                    <span className="text-[11px]" style={{ color: LEAVE_COLORS[r.leaveType] }}>{LEAVE_LABELS[r.leaveType]}</span>
                    <span className="text-[11px] text-t3">{fmtDate(r.startDate)}</span>
                    <span className="text-[11px] text-t3">{fmtDate(r.endDate)}</span>
                    <span className="text-[11px] font-semibold text-center">{r.days}</span>
                    <span className="flex items-center gap-1">
                      <Fa icon={statusIcon(r.status)} style={{ fontSize: 10, color: statusColor(r.status) }} />
                      <span className="text-[10px]" style={{ color: statusColor(r.status) }}>
                        {r.status === 'pending_hr' ? 'Pending' : r.status === 'approved' ? 'Approved' : 'Rejected'}
                      </span>
                    </span>
                    <span className="text-[11px] text-t3 truncate">{r.reason}</span>
                    <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                      {r.status === 'pending_hr' && canDecideLeave(r) ? (
                        <button
                          style={{ background: '#DCFCE7', border: '1px solid #A7F3D0', cursor: 'pointer', color: '#059669', fontSize: 10, borderRadius: 4, padding: '3px 9px', fontWeight: 600 }}
                          onClick={() => { setDecideId(r.id); setDecideNote('') }}>
                          <Fa icon={faCheck} className="mr-0.5" /> Decide
                        </button>
                      ) : (
                        <span className="text-[10px] text-t3 italic">
                          {r.status === 'pending_hr' ? 'Pending' : r.hrDecisionDate ? fmtDate(r.hrDecisionDate) : '—'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Apply for Leave modal ── */}
      {showForm && (
        <Modal title="Apply for Leave" subtitle={myEmployee ? `${myEmployee.fullName} · ${myEmployee.jobTitle}` : undefined} width={520} onClose={() => setShowForm(false)}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Leave Type *">
                <Select value={fType} onChange={v => setFType(v as LeaveType)} options={
                  Object.entries(LEAVE_LABELS).map(([v, l]) => ({ value: v, label: l }))
                } />
              </Field>
            </div>
            <Field label="Start Date *">
              <input className="form-input" type="date" value={fStart}
                onChange={e => setFStart(e.target.value)}
                min={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="End Date *">
              <input className="form-input" type="date" value={fEnd}
                onChange={e => setFEnd(e.target.value)}
                min={fStart || new Date().toISOString().slice(0, 10)} />
            </Field>
            {computedDays > 0 && (
              <div className="col-span-2 px-3 py-2 rounded-lg text-[11px]"
                style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#1B2762' }}>
                <span style={{ fontWeight: 600 }}>{computedDays} working day{computedDays !== 1 ? 's' : ''}</span>
                {(() => {
                  const bal = getBalance(fType)
                  if (!bal) return null
                  const ok = bal.available >= computedDays
                  return <span className="ml-2" style={{ color: ok ? '#10B981' : '#EF4444' }}>
                    · {bal.available} day{bal.available !== 1 ? 's' : ''} available {ok ? '✓' : '⚠ Insufficient balance'}
                  </span>
                })()}
              </div>
            )}
            <div className="col-span-2">
              <Field label="Reason / Details *">
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="Briefly describe the reason for your leave..."
                  value={fReason}
                  onChange={e => setFReason(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </Field>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn-primary" disabled={submitting || computedDays <= 0 || !fReason.trim()} onClick={handleSubmit}>
              {submitting ? 'Submitting...' : 'Submit Application'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Approve / Reject decision modal ── */}
      {decideId && (() => {
        const req = leaveRequests.find(r => r.id === decideId)
        if (!req) return null
        const emp = employees.find(e => e.id === req.employeeId)
        return (
          <Modal title="Leave Decision" subtitle={`${req.ref} · ${req.employeeName}`} width={480} onClose={() => setDecideId(null)}>
            <div className="grid grid-cols-2 gap-3 text-xs mb-3">
              <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                <p className="text-t3 text-[10px] mb-1">Leave Type</p>
                <p className="font-semibold" style={{ color: LEAVE_COLORS[req.leaveType] }}>{LEAVE_LABELS[req.leaveType]}</p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                <p className="text-t3 text-[10px] mb-1">Period</p>
                <p className="font-semibold">{fmtDate(req.startDate)} → {fmtDate(req.endDate)}</p>
                <p className="text-t3">{req.days} working day{req.days !== 1 ? 's' : ''}</p>
              </div>
              <div className="col-span-2 p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                <p className="text-t3 text-[10px] mb-1">Reason</p>
                <p>{req.reason}</p>
              </div>
            </div>
            <Field label="Decision Note (optional)">
              <Input value={decideNote} onChange={setDecideNote} placeholder="Optional note to employee..." />
            </Field>
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-outline" onClick={() => setDecideId(null)}>Cancel</button>
              <button
                style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#EF4444', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                onClick={() => handleDecide(false)}>
                <Fa icon={faXmark} className="mr-1" /> Reject
              </button>
              <button className="btn-primary" style={{ background: '#12B76A' }} onClick={() => handleDecide(true)}>
                <Fa icon={faCheck} className="mr-1" /> Approve
              </button>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
