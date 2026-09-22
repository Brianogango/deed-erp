'use client'
import { useState } from 'react'
import { useApp, fmtDate, LeaveRequest, LeaveBalance } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Badge, Field, Input, Textarea, Modal, Select, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import {
  faCalendarDays, faCalendarCheck, faCalendarXmark,
  faHourglassHalf, faPlus, faCheck, faXmark, faCircleInfo,
  faTriangleExclamation, faGear, faBan,
} from '@fortawesome/free-solid-svg-icons'
import {
  StoreLeaveType,
  LEAVE_LABELS, LEAVE_COLORS, LEAVE_ENTITLEMENTS,
  CALENDAR_DAY_TYPES, NOTICE_EXEMPT_TYPES, NOTICE_SHORT_DAYS, NOTICE_LONG_DAYS, NOTICE_THRESHOLD_DAYS,
  employeeLeaveTypesFor, isLeaveTypeAllowedForGender, entitlementFor,
  leaveDaysForRange, formatLocalDate, noticeDaysGiven, requiredNotice, remainingBalance,
} from '@/lib/leave-utils'

// ── Day calc helper (respects calendar vs working days per type) ──────────────
function calcDaysForType(type: StoreLeaveType, start: string, end: string): number {
  if (!start || !end) return 0
  return leaveDaysForRange(type, start, end)
}

export default function LeaveApplication() {
  const { users, currentUserId, showToast } = useApp()
  const {
    employees,
    leaveRequests, leaveBalances, departments,
    addLeaveRequest, decideLeaveRequest, cancelLeaveRequest,
    updateLeaveBalance, initYearBalances, applyDecemberClosure,
    expireYearEndBalances,
  } = useHrStore()

  const currentUser  = users.find(u => u.id === currentUserId) ?? null
  const isAdmin      = currentUser?.role === 'director'
  const isHRAdmin    = ['director', 'admin_officer', 'finance_officer'].includes(currentUser?.role ?? '')
  const isLeadTech   = currentUser?.role === 'technical_lead'
  const isManager    = isHRAdmin || isLeadTech
  const myEmployee   = employees.find(e => e.userId === currentUserId) ?? null
  const myDept       = departments.find(d => d.id === myEmployee?.departmentId)
  const currentYear  = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1 // 1–12

  const myLeaves   = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const storedBalances = leaveBalances.filter(b => b.employeeId === myEmployee?.id && b.year === currentYear)
  // Always surface entitlements even before HR seeds balance rows.
  const myBalances: LeaveBalance[] = myEmployee
    ? employeeLeaveTypesFor(myEmployee.gender).map(leaveType => {
        const existing = storedBalances.find(b => b.leaveType === leaveType)
        if (existing) return existing
        return {
          id: `${myEmployee.id}-${leaveType}-${currentYear}`,
          employeeId: myEmployee.id,
          leaveType,
          year: currentYear,
          entitlement: entitlementFor(leaveType, myEmployee.gender),
          carryForward: 0,
          used: 0,
          pending: 0,
        }
      })
    : []

  const canDecideLeave = (req: LeaveRequest) => {
    if (isHRAdmin) return true
    if (isLeadTech) {
      const emp = employees.find(e => e.id === req.employeeId)
      const u   = users.find(u => u.id === emp?.userId)
      return u?.role === 'technician'
    }
    return false
  }

  const managedLeaves = isLeadTech && !isHRAdmin
    ? leaveRequests.filter(r => {
        const emp = employees.find(e => e.id === r.employeeId)
        const u   = users.find(u => u.id === emp?.userId)
        return u?.role === 'technician'
      })
    : leaveRequests

  type TabId = 'my_leaves' | 'all_requests' | 'hr_admin'
  const [tab, setTab]           = useState<TabId>(isManager ? 'all_requests' : 'my_leaves')
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [fType, setFType]       = useState<StoreLeaveType | ''>('')
  const [fStart, setFStart]     = useState('')
  const [fEnd, setFEnd]         = useState('')
  const [fReason, setFReason]   = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Admin approve/reject
  const [decideId, setDecideId]   = useState<string | null>(null)
  const [decideNote, setDecideNote] = useState('')
  const [decideError, setDecideError] = useState('')

  // Admin list filter
  const [adminFilter, setAdminFilter] = useState<'all' | LeaveRequest['status']>('all')

  // Balance adjustment (HR admin)
  const [adjustBalId, setAdjustBalId]   = useState<string | null>(null)
  const [adjustEntitlement, setAdjustEntitlement] = useState('')
  const [adjustUsed, setAdjustUsed]     = useState('')

  // HR admin confirmations
  const [confirmAction, setConfirmAction] = useState<null | 'init' | 'closure' | 'expire'>(null)
  const [actionYear, setActionYear] = useState('')

  const getBalance = (type: StoreLeaveType) => {
    const b = myBalances.find(b => b.leaveType === type)
    if (!b) return null
    return { ...b, available: remainingBalance(b) }
  }

  const computedDays = fType && fStart && fEnd ? calcDaysForType(fType, fStart, fEnd) : 0
  const noticeGiven  = fStart ? noticeDaysGiven(fStart) : 0
  const noticeReq    = fType ? requiredNotice(fType, computedDays) : 0
  const noticeLack   = noticeReq > 0 && computedDays > 0 && noticeGiven < noticeReq
  const balanceForType = fType ? getBalance(fType) : null
  const balanceAvailable = balanceForType?.available ?? 0
  const balanceExhausted = !!fType && fType !== 'unpaid' && balanceAvailable <= 0
  const balanceLack = !!fType && fType !== 'unpaid' && computedDays > 0 && computedDays > balanceAvailable
  const fTypeLabel = fType ? (LEAVE_LABELS[fType] ?? fType) : ''
  const todayLocal = formatLocalDate(new Date())

  const pendingAll  = managedLeaves.filter(r => r.status === 'pending_hr')
  const filteredAll = adminFilter === 'all'
    ? managedLeaves
    : managedLeaves.filter(r => r.status === adminFilter)

  // Oct warning: annual leave >7 days remaining after 1 Oct
  const annualBal        = getBalance('annual')
  const showOctWarning   = currentMonth >= 10 && !!annualBal && annualBal.available > 7

  const handleSubmit = () => {
    if (!myEmployee) { showToast('No employee record linked. Contact HR.', 'error'); return }
    const missing: string[] = []
    if (!fType) missing.push('Leave Type')
    if (!fStart) missing.push('Start Date')
    if (!fEnd) missing.push('End Date')
    if (!fReason.trim()) missing.push('Reason / Details')
    if (missing.length || !fType) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    if (computedDays <= 0) { showToast('End date must be after start date', 'error'); return }
    if (balanceExhausted) {
      showToast(`No remaining ${fTypeLabel} balance — you cannot apply for this leave type`, 'error')
      return
    }
    if (balanceLack) {
      showToast(`Insufficient ${fTypeLabel} balance — ${balanceAvailable} day(s) available, ${computedDays} requested`, 'error')
      return
    }
    if (noticeLack) {
      showToast(`Insufficient notice: ${noticeReq} working days required before the start date (you have ${noticeGiven})`, 'error')
      return
    }
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
      setFType(''); setFStart(''); setFEnd(''); setFReason('')
      setTab('my_leaves')
    } catch {
      // toast already shown by store
    } finally {
      setSubmitting(false)
    }
  }

  const handleDecide = (approved: boolean) => {
    if (!decideId) return
    const note = decideNote.trim()
    if (!approved && !note) {
      setDecideError('Add a note so the applicant knows why the leave was declined.')
      return
    }
    decideLeaveRequest(decideId, approved, note || undefined)
    setDecideId(null); setDecideNote(''); setDecideError('')
  }

  const statusColor = (s: LeaveRequest['status']) =>
    s === 'approved' ? 'var(--success)' : s === 'rejected' ? 'var(--danger)' : s === 'cancelled' ? 'var(--text-4)' : 'var(--warning)'
  const statusIcon  = (s: LeaveRequest['status']) =>
    s === 'approved' ? faCalendarCheck : s === 'rejected' ? faCalendarXmark : s === 'cancelled' ? faBan : faHourglassHalf
  const statusLabel = (s: LeaveRequest['status']) =>
    s === 'pending_hr' ? 'Pending' : s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : 'Cancelled'

  return (
    <div className="mod-page">
      <ModuleHeader
        title="Leave requests"
        subtitle="21 days annual · 13 discretionary · 8 mandatory closure"
        icon={<Fa icon={faCalendarDays} />}
        color="var(--primary)"
        primaryAction={myEmployee ? (
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => setShowForm(true)} hideLabelOnMobile={false}>
            Apply for leave
          </PrimaryActionButton>
        ) : undefined}
      />

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-3">

        {/* ── Oct warning ── */}
        {showOctWarning && (
          <div className="flex items-start gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50">
            <Fa icon={faTriangleExclamation} style={{ color: 'var(--warning)', fontSize: 16, marginTop: 2, flexShrink: 0 }} />
            <div>
              <p className="text-xs font-bold text-amber-800">Year-end leave reminder</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                You have <strong>{annualBal!.available} annual days</strong> remaining. Annual leave expires on 31 December — plan and book before year end.
              </p>
            </div>
          </div>
        )}

        {/* ── Employee card ── */}
        {myEmployee ? (
          <div className="card p-4 flex items-center gap-6 flex-wrap">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--accent-cyan), var(--navy))' }}>
              {myEmployee.fullName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-sm">{myEmployee.fullName}</p>
              <p className="text-[11px] text-t3">{myEmployee.jobTitle} · {myDept?.name ?? 'No Department'}</p>
              <p className="text-[11px] text-t3">Staff No: {myEmployee.employeeNo}</p>
            </div>
          </div>
        ) : (
          <div className="card p-5 text-center" style={{ border: '1px dashed var(--border-lt)' }}>
            <Fa icon={faCircleInfo} style={{ fontSize: 24, color: 'var(--warning)', marginBottom: 8 }} />
            <p className="text-sm font-semibold mb-1">No Employee Record Found</p>
            <p className="text-xs text-t3">Your account is not linked to an employee record. Please contact HR.</p>
          </div>
        )}

        {/* ── Balance cards ── */}
        {myEmployee && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))' }}>
            {myBalances
              .filter(b => b.leaveType !== 'december_closure' || b.used > 0)
              // Hide gender-inapplicable maternity/paternity cards (unless they hold history)
              .filter(b => isLeaveTypeAllowedForGender(b.leaveType as StoreLeaveType, myEmployee?.gender) || b.used > 0 || b.pending > 0)
              .map(b => {
                const avail = remainingBalance(b)
                const color = LEAVE_COLORS[b.leaveType as StoreLeaveType] ?? 'var(--text-4)'
                const isAnnual = b.leaveType === 'annual'
                const warn = isAnnual && currentMonth >= 10 && avail > 7
                const exhausted = b.leaveType !== 'unpaid' && avail <= 0
                return (
                  <div key={b.id} className="card p-3 relative" style={{ borderTop: `3px solid ${exhausted ? 'var(--danger)' : color}` }}>
                    {warn && (
                      <div className="absolute top-2 right-2">
                        <Fa icon={faTriangleExclamation} style={{ color: 'var(--warning)', fontSize: 11 }} />
                      </div>
                    )}
                    <p className="text-[10px] uppercase tracking-wider mb-1 pr-4" style={{ color: 'var(--text-3)' }}>
                      {LEAVE_LABELS[b.leaveType as StoreLeaveType] ?? b.leaveType}
                    </p>
                    <p className="text-xl font-bold" style={{ color: exhausted ? 'var(--danger)' : color }}>{avail}</p>
                    <p className="text-[10px] text-t3">
                      {exhausted
                        ? 'balance used up'
                        : CALENDAR_DAY_TYPES.includes(b.leaveType as StoreLeaveType) ? 'calendar days left' : 'working days left'}
                    </p>
                    <div className="flex gap-3 mt-2 text-[10px] text-t3 flex-wrap">
                      <span>{b.entitlement} total</span>
                      <span>{b.used} used</span>
                      {b.pending > 0 && <span style={{ color: 'var(--warning)' }}>{b.pending} pending</span>}
                      {b.carryForward > 0 && <span style={{ color: 'var(--success)' }}>+{b.carryForward} c/f</span>}
                    </div>
                    {b.leaveType === 'sick' && (
                      <p className="text-[9px] text-t3 mt-1">First 7 days full pay · next 7 half pay</p>
                    )}
                    {isAnnual && (
                      <p className="text-[9px] mt-1" style={{ color: warn ? 'var(--warning)' : 'var(--text-4)' }}>
                        Use by 31 Dec — no carry-over
                      </p>
                    )}
                    {isHRAdmin && storedBalances.some(sb => sb.id === b.id) && (
                      <button
                        className="text-[9px] text-blue-500 hover:underline mt-1"
                        onClick={() => {
                          setAdjustBalId(b.id)
                          setAdjustEntitlement(String(b.entitlement))
                          setAdjustUsed(String(b.used))
                        }}
                      >
                        Adjust
                      </button>
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-1 -mt-1 -mx-1 flex-wrap">
          {[
            { key: 'my_leaves' as const, label: 'My Leaves', count: myLeaves.length },
            ...(isManager ? [{ key: 'all_requests' as const, label: isLeadTech && !isHRAdmin ? 'Team Requests' : 'All Requests', count: managedLeaves.length }] : []),
            ...(isHRAdmin ? [{ key: 'hr_admin' as const, label: 'HR Admin', count: 0 }] : []),
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`mod-tab ${tab === t.key ? 'active' : ''}`}>
              {t.label}
              {t.count > 0 && <span className="badge badge-gray text-[9px] ml-1">{t.count}</span>}
            </button>
          ))}
        </div>

        <div className="card overflow-hidden">

          {/* ── My Leave Requests ── */}
          {tab === 'my_leaves' && (
            <DataTable
              tableId="leave-my-requests"
              columns={[
                {
                  key: 'ref', label: 'Ref', priority: 1, width: '80px',
                  render: (r: LeaveRequest) => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{r.ref}</span>,
                  exportValue: (r: LeaveRequest) => r.ref,
                },
                {
                  key: 'type', label: 'Type', priority: 1, width: '160px',
                  render: (r: LeaveRequest) => (
                    <span className="text-[11px]" style={{ color: LEAVE_COLORS[r.leaveType as StoreLeaveType] ?? 'var(--text-4)' }}>
                      {LEAVE_LABELS[r.leaveType as StoreLeaveType] ?? r.leaveType}
                    </span>
                  ),
                  exportValue: (r: LeaveRequest) => LEAVE_LABELS[r.leaveType as StoreLeaveType] ?? r.leaveType,
                },
                {
                  key: 'from', label: 'From', priority: 2, width: '100px',
                  render: (r: LeaveRequest) => <span className="text-[11px] text-t3">{fmtDate(r.startDate)}</span>,
                  exportValue: (r: LeaveRequest) => r.startDate,
                },
                {
                  key: 'to', label: 'To', priority: 2, width: '100px',
                  render: (r: LeaveRequest) => <span className="text-[11px] text-t3">{fmtDate(r.endDate)}</span>,
                  exportValue: (r: LeaveRequest) => r.endDate,
                },
                {
                  key: 'days', label: 'Days', priority: 1, width: '60px', align: 'center',
                  render: (r: LeaveRequest) => <span className="text-[11px] font-semibold">{r.days}</span>,
                  exportValue: (r: LeaveRequest) => r.days,
                },
                {
                  key: 'status', label: 'Status', priority: 1, width: '90px',
                  render: (r: LeaveRequest) => (
                    <span className="flex items-center gap-1">
                      <Fa icon={statusIcon(r.status)} style={{ fontSize: 10, color: statusColor(r.status) }} />
                      <span className="text-[10px]" style={{ color: statusColor(r.status) }}>{statusLabel(r.status)}</span>
                    </span>
                  ),
                  accessor: (r: LeaveRequest) => statusLabel(r.status),
                  exportValue: (r: LeaveRequest) => statusLabel(r.status),
                },
                {
                  key: 'reason', label: 'Reason', priority: 3, width: '1fr',
                  render: (r: LeaveRequest) => <span className="text-[11px] text-t3 truncate">{r.reason}</span>,
                  exportValue: (r: LeaveRequest) => r.reason,
                },
                {
                  key: 'hrNote', label: 'HR note', priority: 2, width: '1fr',
                  render: (r: LeaveRequest) => <span className="text-[11px] text-t3 truncate">{r.reviewNotes || '—'}</span>,
                  exportValue: (r: LeaveRequest) => r.reviewNotes ?? '',
                },
                {
                  key: 'submitted', label: 'Submitted', priority: 3, width: '90px',
                  render: (r: LeaveRequest) => <span className="text-[10px] text-t3">{fmtDate(r.submittedDate)}</span>,
                  exportValue: (r: LeaveRequest) => r.submittedDate,
                },
              ] as ColumnDef<LeaveRequest>[]}
              rows={myLeaves}
              rowKey={r => r.id}
              searchPlaceholder="Search leave…"
              emptyMessage="No leave requests yet"
              emptyAction={myEmployee ? (
                <button className="btn-primary text-[11px]" onClick={() => setShowForm(true)}>Apply for Leave</button>
              ) : undefined}
              rowActions={r => (r.status === 'pending_hr') && !r.isSystemGenerated ? (
                <button
                  onClick={() => cancelLeaveRequest(r.id)}
                  className="text-[10px] text-red-500 hover:underline"
                  title="Cancel this request"
                >
                  Cancel
                </button>
              ) : null}
              exportTitle="My Leave Requests"
              exportFilename="my-leave-requests"
            />
          )}

          {/* ── All Leave Requests (manager) ── */}
          {tab === 'all_requests' && isManager && (
            <>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
                {([
                  { value: 'all',        label: 'All',       count: managedLeaves.length },
                  { value: 'pending_hr', label: 'Pending',   count: pendingAll.length },
                  { value: 'approved',   label: 'Approved',  count: managedLeaves.filter(r => r.status === 'approved').length },
                  { value: 'rejected',   label: 'Rejected',  count: managedLeaves.filter(r => r.status === 'rejected').length },
                  { value: 'cancelled',  label: 'Cancelled', count: managedLeaves.filter(r => r.status === 'cancelled').length },
                ] as { value: typeof adminFilter; label: string; count: number }[]).map(f => (
                  <button key={f.value} onClick={() => setAdminFilter(f.value)}
                    style={{
                      fontSize: 10, padding: '3px 10px', borderRadius: 20, border: '1px solid', cursor: 'pointer',
                      background:  adminFilter === f.value ? 'var(--primary-light)' : 'transparent',
                      color:       adminFilter === f.value ? 'var(--navy)'  : 'var(--text-3)',
                      borderColor: adminFilter === f.value ? 'var(--border)'  : 'var(--border-lt)',
                      fontWeight:  adminFilter === f.value ? 600 : 400,
                    }}>
                    {f.label} {f.count > 0 && `(${f.count})`}
                  </button>
                ))}
              </div>
              <DataTable
                tableId="leave-all-requests"
                columns={[
                  {
                    key: 'ref', label: 'Ref', priority: 1, width: '80px',
                    render: (r: LeaveRequest) => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{r.ref}</span>,
                    exportValue: (r: LeaveRequest) => r.ref,
                  },
                  {
                    key: 'employee', label: 'Employee', priority: 1, width: '1.1fr',
                    render: (r: LeaveRequest) => <span className="font-medium text-[11px]">{r.employeeName}</span>,
                    exportValue: (r: LeaveRequest) => r.employeeName,
                  },
                  {
                    key: 'type', label: 'Type', priority: 2, width: '160px',
                    render: (r: LeaveRequest) => (
                      <span className="text-[11px]" style={{ color: LEAVE_COLORS[r.leaveType as StoreLeaveType] ?? 'var(--text-4)' }}>
                        {LEAVE_LABELS[r.leaveType as StoreLeaveType] ?? r.leaveType}
                      </span>
                    ),
                    exportValue: (r: LeaveRequest) => LEAVE_LABELS[r.leaveType as StoreLeaveType] ?? r.leaveType,
                  },
                  {
                    key: 'from', label: 'From', priority: 2, width: '90px',
                    render: (r: LeaveRequest) => <span className="text-[11px] text-t3">{fmtDate(r.startDate)}</span>,
                    exportValue: (r: LeaveRequest) => r.startDate,
                  },
                  {
                    key: 'to', label: 'To', priority: 3, width: '90px',
                    render: (r: LeaveRequest) => <span className="text-[11px] text-t3">{fmtDate(r.endDate)}</span>,
                    exportValue: (r: LeaveRequest) => r.endDate,
                  },
                  {
                    key: 'days', label: 'Days', priority: 1, width: '50px', align: 'center',
                    render: (r: LeaveRequest) => <span className="text-[11px] font-semibold">{r.days}</span>,
                    exportValue: (r: LeaveRequest) => r.days,
                  },
                  {
                    key: 'status', label: 'Status', priority: 1, width: '90px',
                    render: (r: LeaveRequest) => (
                      <span className="flex items-center gap-1">
                        <Fa icon={statusIcon(r.status)} style={{ fontSize: 10, color: statusColor(r.status) }} />
                        <span className="text-[10px]" style={{ color: statusColor(r.status) }}>{statusLabel(r.status)}</span>
                      </span>
                    ),
                    accessor: (r: LeaveRequest) => statusLabel(r.status),
                    exportValue: (r: LeaveRequest) => statusLabel(r.status),
                  },
                  {
                    key: 'reason', label: 'Reason', priority: 3, width: '1fr',
                    render: (r: LeaveRequest) => <span className="text-[11px] text-t3 truncate">{r.reason}</span>,
                    exportValue: (r: LeaveRequest) => r.reason,
                  },
                  {
                    key: 'hrNote', label: 'HR note', priority: 2, width: '1fr',
                    render: (r: LeaveRequest) => <span className="text-[11px] text-t3 truncate">{r.reviewNotes || '—'}</span>,
                    exportValue: (r: LeaveRequest) => r.reviewNotes ?? '',
                  },
                ] as ColumnDef<LeaveRequest>[]}
                rows={filteredAll}
                rowKey={r => r.id}
                hideSearch
                emptyMessage="No leave requests"
                rowActions={r => (
                  <div className="flex gap-1.5">
                    {r.status === 'pending_hr' && canDecideLeave(r) ? (
                      <button
                        style={{ background: 'var(--success-bg)', border: '1px solid var(--success-bg)', cursor: 'pointer', color: 'var(--success)', fontSize: 10, borderRadius: 4, padding: '3px 9px', fontWeight: 600 }}
                        onClick={() => { setDecideId(r.id); setDecideNote(''); setDecideError('') }}>
                        <Fa icon={faCheck} className="mr-0.5" /> Decide
                      </button>
                    ) : (
                      <span className="text-[10px] text-t3 italic">
                        {r.status === 'pending_hr' ? 'Pending' : r.hrDecisionDate ? fmtDate(r.hrDecisionDate) : '—'}
                      </span>
                    )}
                    {r.status !== 'cancelled' && r.status !== 'rejected' && !r.isSystemGenerated && isHRAdmin && (
                      <button
                        onClick={() => cancelLeaveRequest(r.id)}
                        className="text-[10px] text-red-400 hover:text-red-600 hover:underline ml-1"
                        title="Cancel"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
                exportTitle="Leave Requests"
                exportFilename="leave-requests"
              />
            </>
          )}

          {/* ── HR Admin ── */}
          {tab === 'hr_admin' && isHRAdmin && (
            <div className="p-5 flex flex-col gap-6">
              <div>
                <p className="text-xs font-bold text-[var(--text-1)] mb-1">Year *</p>
                <input
                  type="number"
                  className="form-input w-32"
                  placeholder="Year"
                  value={actionYear}
                  onChange={e => setActionYear(e.target.value)}
                />
              </div>

              {/* Action cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  {
                    key: 'init' as const,
                    title: 'Initialise Year Balances',
                    desc: `Create leave balance records for all active employees for ${actionYear}. Safe to run multiple times — skips existing records.`,
                    color: 'var(--navy)',
                    icon: faGear,
                  },
                  {
                    key: 'closure' as const,
                    title: 'Apply December Closure',
                    desc: `Auto-create approved December closure leave (22 Dec – 2 Jan) for all active employees in ${actionYear}. Skips employees already applied.`,
                    color: 'var(--warning)',
                    icon: faCalendarDays,
                  },
                  {
                    key: 'expire' as const,
                    title: 'Expire Year-End Balances',
                    desc: `Forfeit unused annual leave for ${actionYear}. Run on 31 Dec. This is irreversible — ensure all approvals are done first.`,
                    color: 'var(--danger)',
                    icon: faTriangleExclamation,
                  },
                ].map(a => (
                  <div key={a.key} className="flex flex-col gap-3 p-4 rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: a.color + '18', color: a.color }}>
                        <Fa icon={a.icon} style={{ fontSize: 13 }} />
                      </div>
                      <p className="text-xs font-bold text-[var(--text-1)]">{a.title}</p>
                    </div>
                    <p className="text-[11px] text-[var(--text-3)] leading-relaxed flex-1">{a.desc}</p>
                    <button
                      className="text-xs font-bold px-3 py-2 rounded-xl text-white"
                      style={{ background: a.color }}
                      onClick={() => {
                        const yr = Number(actionYear)
                        if (!actionYear.trim()) { showToast('Please fill in: Year', 'error'); return }
                        if (!Number.isInteger(yr) || yr < 2000 || yr > 2100) { showToast('Year must be a valid four-digit year', 'error'); return }
                        setConfirmAction(a.key)
                      }}
                    >
                      {actionYear ? `Run for ${actionYear}` : 'Run'}
                    </button>
                  </div>
                ))}
              </div>

              {/* Policy summary */}
              <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-lt)]">
                <p className="text-xs font-bold text-[var(--text-1)] mb-3">Policy Entitlements (v1.0 Jan 2026)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(Object.entries(LEAVE_ENTITLEMENTS) as [StoreLeaveType, number][])
                    .filter(([t]) => t !== 'unpaid')
                    .map(([type, days]) => (
                      <div key={type} className="text-center p-3 rounded-xl bg-white border border-[var(--border-lt)]">
                        <p className="text-xl font-extrabold" style={{ color: LEAVE_COLORS[type] }}>{days}</p>
                        <p className="text-[10px] text-[var(--text-3)] mt-0.5">{LEAVE_LABELS[type]}</p>
                        <p className="text-[9px] text-[var(--text-4)]">
                          {CALENDAR_DAY_TYPES.includes(type) ? 'calendar days' : 'working days'}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Apply for Leave modal ── */}
        {showForm && (
          <Modal title="Apply for Leave" subtitle={myEmployee ? `${myEmployee.fullName} · ${myEmployee.jobTitle}` : undefined} width={520} onClose={() => setShowForm(false)}>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Leave Type *">
                  <Select
                    value={fType}
                    onChange={v => { setFType(v as StoreLeaveType | ''); setFStart(''); setFEnd('') }}
                    options={[{ value: '', label: 'Select leave type…' }, ...employeeLeaveTypesFor(myEmployee?.gender).map(v => {
                      const avail = getBalance(v)?.available
                      const suffix = v === 'unpaid' ? '' : avail === undefined ? '' : ` (${Math.max(0, avail)} left)`
                      return { value: v, label: `${LEAVE_LABELS[v]}${suffix}` }
                    })]}
                  />
                </Field>
              </div>

              {balanceExhausted && (
                <div className="col-span-2 px-3 py-2 rounded-lg text-[11px] bg-red-50 border border-red-200 text-red-700">
                  <Fa icon={faTriangleExclamation} className="mr-1" />
                  Your <strong>{fTypeLabel}</strong> balance is used up ({balanceAvailable} day(s) left). You cannot apply until HR adjusts the balance.
                </div>
              )}

              {/* Notice requirement hint */}
              {!!fType && !NOTICE_EXEMPT_TYPES.includes(fType) && (
                <div className="col-span-2 px-3 py-2 rounded-lg text-[11px]"
                  style={{ background: 'var(--info-bg)', border: '1px solid var(--border)', color: 'var(--info-text)' }}>
                  <Fa icon={faCircleInfo} className="mr-1" />
                  <>Requires <strong>{NOTICE_SHORT_DAYS} working days</strong> notice for ≤{NOTICE_THRESHOLD_DAYS} days, <strong>{NOTICE_LONG_DAYS} working days</strong> for longer periods.</>
                </div>
              )}

              <Field label="Start Date *">
                <input className="form-input" type="date" value={fStart}
                  onChange={e => setFStart(e.target.value)}
                  min={todayLocal} />
              </Field>
              <Field label="End Date *">
                <input className="form-input" type="date" value={fEnd}
                  onChange={e => setFEnd(e.target.value)}
                  min={fStart || todayLocal} />
              </Field>

              {computedDays > 0 && (
                <div className={`col-span-2 px-3 py-2 rounded-lg text-[11px] ${noticeLack || balanceLack ? 'bg-red-50 border-red-200 text-red-700' : 'bg-indigo-50 border-indigo-200 text-indigo-800'}`}
                  style={{ border: '1px solid' }}>
                  <p>
                    <span className="font-bold">{computedDays} {fType && CALENDAR_DAY_TYPES.includes(fType) ? 'calendar' : 'working'} day{computedDays !== 1 ? 's' : ''}</span>
                    {fType !== 'unpaid' && (
                      <span className="ml-2" style={{ color: (balanceLack || balanceExhausted) ? 'var(--danger)' : 'var(--success)' }}>
                        · {balanceAvailable} day{balanceAvailable !== 1 ? 's' : ''} available {(balanceLack || balanceExhausted) ? '(insufficient)' : ''}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5" style={{ color: 'var(--text-4)' }}>Working days are Monday–Saturday (Sunday and public holidays excluded).</p>
                  {balanceLack && (
                    <p className="mt-1">
                      <Fa icon={faTriangleExclamation} className="mr-1" />
                      You have no remaining days for this leave type — reduce the date range or contact HR.
                    </p>
                  )}
                  {noticeLack && (
                    <p className="mt-1">
                      <Fa icon={faTriangleExclamation} className="mr-1" />
                      Only {noticeGiven} working day{noticeGiven !== 1 ? 's' : ''} notice given — {noticeReq} required for this request.
                    </p>
                  )}
                  {!noticeLack && !balanceLack && noticeReq > 0 && noticeGiven > 0 && (
                    <p className="mt-0.5" style={{ color: 'var(--success)' }}>
                      Notice: {noticeGiven} working days given ✓
                    </p>
                  )}
                </div>
              )}

              <div className="col-span-2">
                <Field label="Reason / Details *">
                  <textarea className="form-input" rows={3}
                    placeholder={
                      fType === 'sick'        ? 'Brief description of illness...' :
                      fType === 'compassionate' ? 'Relationship to deceased/ill person and circumstances...' :
                      fType === 'study'        ? 'Course / exam name and date...' :
                      'Briefly describe the reason for your leave...'
                    }
                    value={fReason} onChange={e => setFReason(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </Field>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={submitting || noticeLack || balanceLack || balanceExhausted}
                onClick={handleSubmit}
                title={
                  balanceExhausted ? 'No leave balance remaining'
                    : balanceLack ? 'Insufficient leave balance'
                    : noticeLack ? `Insufficient notice period (${noticeGiven}/${noticeReq} working days)`
                      : undefined
                }
              >
                {submitting ? 'Submitting...'
                  : balanceExhausted ? 'No leave balance remaining'
                  : balanceLack ? 'Insufficient leave balance'
                  : noticeLack ? `Need ${noticeReq} working days notice`
                  : 'Submit Application'}
              </button>
            </div>
          </Modal>
        )}

        {/* ── Decide leave modal ── */}
        {decideId && (() => {
          const req = leaveRequests.find(r => r.id === decideId)
          if (!req) return null
          return (
            <Modal title="Leave Decision" subtitle={`${req.ref} · ${req.employeeName}`} width={480} onClose={() => setDecideId(null)}>
              <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                  <p className="text-t3 text-[10px] mb-1">Leave Type</p>
                  <p className="font-semibold" style={{ color: LEAVE_COLORS[req.leaveType as StoreLeaveType] ?? 'var(--text-4)' }}>
                    {LEAVE_LABELS[req.leaveType as StoreLeaveType] ?? req.leaveType}
                  </p>
                </div>
                <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                  <p className="text-t3 text-[10px] mb-1">Period</p>
                  <p className="font-semibold">{fmtDate(req.startDate)} → {fmtDate(req.endDate)}</p>
                  <p className="text-t3">{req.days} day{req.days !== 1 ? 's' : ''}</p>
                </div>
                <div className="col-span-2 p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
                  <p className="text-t3 text-[10px] mb-1">Reason</p>
                  <p>{req.reason}</p>
                </div>
              </div>
              <Field label="Note to applicant" hint="Required when declining. Included in the decision email and leave history.">
                <Textarea
                  value={decideNote}
                  onChange={v => { setDecideNote(v); if (decideError) setDecideError('') }}
                  rows={3}
                  placeholder="e.g. Approved — cover confirmed / Declined — insufficient cover that week"
                />
              </Field>
              {decideError && (
                <p className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{decideError}</p>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button className="btn-outline" onClick={() => { setDecideId(null); setDecideError('') }}>Cancel</button>
                <button
                  style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  onClick={() => handleDecide(false)}>
                  <Fa icon={faXmark} className="mr-1" /> Reject
                </button>
                <button className="btn-primary" style={{ background: 'var(--success)' }} onClick={() => handleDecide(true)}>
                  <Fa icon={faCheck} className="mr-1" /> Approve
                </button>
              </div>
            </Modal>
          )
        })()}

        {/* ── Balance adjustment modal ── */}
        {adjustBalId && (() => {
          const bal = leaveBalances.find(b => b.id === adjustBalId)
          if (!bal) return null
          const emp = employees.find(e => e.id === bal.employeeId)
          return (
            <Modal title="Adjust Leave Balance" subtitle={`${emp?.fullName} · ${LEAVE_LABELS[bal.leaveType as StoreLeaveType] ?? bal.leaveType} ${bal.year}`} width={400} onClose={() => setAdjustBalId(null)}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Entitlement (days)">
                  <Input type="number" value={adjustEntitlement} onChange={setAdjustEntitlement} />
                </Field>
                <Field label="Used (days)">
                  <Input type="number" value={adjustUsed} onChange={setAdjustUsed} />
                </Field>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <button className="btn-outline" onClick={() => setAdjustBalId(null)}>Cancel</button>
                <button className="btn-primary" onClick={() => {
                  updateLeaveBalance(adjustBalId, {
                    entitlement: Number(adjustEntitlement) || 0,
                    used: Number(adjustUsed) || 0,
                  })
                  setAdjustBalId(null)
                }}>Save</button>
              </div>
            </Modal>
          )
        })()}

        {/* ── HR action confirmation modal ── */}
        {confirmAction && (
          <Modal
            title={
              confirmAction === 'init'    ? `Initialise ${actionYear} Leave Balances` :
              confirmAction === 'closure' ? `Apply December Closure ${actionYear}` :
              `Expire ${actionYear} Annual Leave`
            }
            width={420}
            onClose={() => setConfirmAction(null)}
          >
            <p className="text-xs text-[var(--text-3)] mb-4">
              {confirmAction === 'init' && `This will create leave balance records for all active employees for ${actionYear}. Already-existing records will be skipped.`}
              {confirmAction === 'closure' && `This will auto-approve 8 days of December closure leave (23 Dec ${actionYear} – 2 Jan ${parseInt(actionYear) + 1}) for all active employees. Employees already applied will be skipped.`}
              {confirmAction === 'expire' && `This will forfeit any unused annual leave for ${actionYear}. This action is irreversible. Run only on 31 December after all approvals are finalised.`}
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                className="btn-primary"
                style={{ background: confirmAction === 'expire' ? 'var(--danger)' : 'var(--navy)' }}
                onClick={() => {
                  const yr = Number(actionYear)
                  if (!Number.isInteger(yr) || yr < 2000 || yr > 2100) { showToast('Year must be a valid four-digit year', 'error'); return }
                  if (confirmAction === 'init')    initYearBalances(yr)
                  if (confirmAction === 'closure') applyDecemberClosure(yr)
                  if (confirmAction === 'expire')  expireYearEndBalances(yr)
                  setConfirmAction(null)
                }}
              >
                Confirm
              </button>
            </div>
          </Modal>
        )}

      </div>{/* mod-body */}
    </div>
  )
}
