'use client'
import { Fragment, useState, useEffect, useRef } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Badge, Field, Input, Modal, PanelHeader, Select, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faCheck, faXmark, faCircleCheck, faCircleXmark } from '@fortawesome/free-solid-svg-icons'
import { CALENDAR_DAY_TYPES, employeeLeaveTypesFor, isLeaveTypeAllowedForGender, leaveDaysForRange, LEAVE_LABELS, type StoreLeaveType } from '@/lib/leave-utils'
import { useUrlUiState } from '@/hooks/useUrlRecordId'
import HRLeaveCalendar, { usePublicHolidays } from './HRLeaveCalendar'
import { useCan } from '@/hooks/useCan'

// Days are always derived from the date range so a request can never claim
// more (or fewer) days than the dates cover — maternity/paternity count
// calendar days, everything else working days (Mon–Sat, excl. public holidays).
function daysForRange(leaveType: string, startDate: string, endDate: string): number {
  if (!leaveType || !startDate || !endDate) return 0
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
  const { currentUserId, showToast } = useApp()
  const {
    employees, leaveRequests, leaveBalances,
    addLeaveRequest, decideLeaveRequest, closeApprovedLeaveEarly,
  } = useHrStore()

  const can = useCan()
  const isAdmin = can('manageHR')
  const canViewTeamHR = can('viewHrRecords')
  const { holidays, reload: reloadHolidays, version: holidayVersion } = usePublicHolidays()

  const [decideId, setDecideId] = useState<string | null>(null)
  const [decideNote, setDecideNote] = useState('')
  const [decideError, setDecideError] = useState('')
  // Approved leave not taken, or cut short.
  const [earlyId, setEarlyId] = useState<string | null>(null)
  const [earlyKind, setEarlyKind] = useState<'not_taken' | 'returned_early'>('returned_early')
  const [earlyLastDay, setEarlyLastDay] = useState('')
  const [earlyNote, setEarlyNote] = useState('')
  const [earlyError, setEarlyError] = useState('')
  const [earlySaving, setEarlySaving] = useState(false)

  const myEmployee      = employees.find(e => e.userId === currentUserId) ?? null
  const myLeaves        = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const myLeaveBalances = leaveBalances.filter(b => b.employeeId === myEmployee?.id && b.year === new Date().getFullYear())


  const canDecideLeaveFor = (req: { employeeId: string }) => {
    // Own requests are decided by someone else, whatever the caller's role.
    if (myEmployee && req.employeeId === myEmployee.id) return false
    if (canViewTeamHR) return true
    return false
  }

  // A leave email's Approve / Decline button links here (?leave=<id>): once the
  // request is loaded, open its decision window. Login and permissions apply.
  const [linkedLeaveId, setLinkedLeaveId] = useUrlUiState('leave', '')
  const handledLinkRef = useRef('')
  useEffect(() => {
    if (!linkedLeaveId || handledLinkRef.current === linkedLeaveId) return
    const req = leaveRequests.find(r => r.id === linkedLeaveId)
    if (!req) return
    handledLinkRef.current = linkedLeaveId
    setLinkedLeaveId('')
    if (req.status !== 'pending_hr') {
      showToast(`${req.ref} is already ${req.status.replace(/_/g, ' ')}.`, 'info')
      return
    }
    if (!canDecideLeaveFor(req)) {
      showToast(`You can't decide ${req.ref}.`, 'error')
      return
    }
    setDecideId(req.id)
    setDecideNote('')
    setDecideError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedLeaveId, leaveRequests])

  // ── Local state ──
  const [leaveSearch, setLeaveSearchValue] = useUrlUiState('leaveQ', '')
  const [leavePageValue, setLeavePageValue] = useUrlUiState('leavePage', '1')
  const leavePage = Math.max(1, Number.parseInt(leavePageValue, 10) || 1)
  const setLeaveSearch = (value: string) => setLeaveSearchValue(value, { queryPatch: { leavePage: null } })
  const setLeavePage = (page: number) => setLeavePageValue(String(Math.max(1, page)))
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showSelfLeaveModal, setShowSelfLeaveModal] = useState(false)

  const emptyLeaveForm = () => ({ employeeId: '', leaveType: '', startDate: '', endDate: '', reason: '' })
  const emptySelfLeaveForm = () => ({ leaveType: '', startDate: '', endDate: '', reason: '' })
  const [leaveForm, setLeaveForm] = useState(emptyLeaveForm)
  const [selfLeaveForm, setSelfLeaveForm] = useState(emptySelfLeaveForm)
  const openLeaveModal = () => {
    if (canViewTeamHR) { setLeaveForm(emptyLeaveForm()); setShowLeaveModal(true) }
    else { setSelfLeaveForm(emptySelfLeaveForm()); setShowSelfLeaveModal(true) }
  }

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
    const missing: string[] = []
    if (!emp) missing.push('Employee')
    if (!leaveForm.leaveType) missing.push('Leave Type')
    if (!leaveForm.startDate) missing.push('Start Date')
    if (!leaveForm.endDate) missing.push('End Date')
    if (missing.length || !emp) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    if (leaveDays <= 0) { showToast('The selected dates contain no leave days — check the date range', 'error'); return }
    if (hrLeaveInsufficient) { showToast('Cannot book more days than the available balance', 'error'); return }
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
    if (!myEmployee) { showToast('Your user account is not linked to an employee record — contact HR', 'error'); return }
    const missing: string[] = []
    if (!selfLeaveForm.leaveType) missing.push('Leave Type')
    if (!selfLeaveForm.startDate) missing.push('Start Date')
    if (!selfLeaveForm.endDate) missing.push('End Date')
    if (!selfLeaveForm.reason.trim()) missing.push('Reason / Notes')
    if (missing.length) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    if (selfLeaveDays <= 0) { showToast('The selected dates contain no leave days — check the date range', 'error'); return }
    if (selfLeaveInsufficient) { showToast('You cannot request more days than you have available', 'error'); return }
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
    setSelfLeaveForm(emptySelfLeaveForm())
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
        {req.status === 'approved' && !req.isSystemGenerated && canDecideLeaveFor(req) && (
          <button
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-2)', padding: '2px 7px', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}
            title="The employee did not go, or came back before the end date"
            onClick={e => { e.stopPropagation(); setEarlyId(req.id); setEarlyKind('returned_early'); setEarlyLastDay(''); setEarlyNote(''); setEarlyError('') }}
          >
            Not taken / back early
          </button>
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

  // Phone view: one card per person with every leave type as a chip. The
  // table's own phone cards gave each person one tall card per leave type —
  // six screens of cards for a single employee.
  const [balanceSearch, setBalanceSearch] = useState('')
  const balanceAvailable = (bal: BalanceRow) => bal.entitlement + bal.carryForward - bal.used - bal.pending
  const balancesByPerson = (() => {
    const q = balanceSearch.trim().toLowerCase()
    const groups = new Map<string, { name: string; rows: BalanceRow[] }>()
    for (const bal of balanceRows) {
      if (q && !bal.employeeName.toLowerCase().includes(q)) continue
      const g = groups.get(bal.employeeId) ?? { name: bal.employeeName, rows: [] }
      g.rows.push(bal)
      groups.set(bal.employeeId, g)
    }
    return [...groups.entries()]
  })()

  // Desktop: one row per person, one column per leave type. A row per
  // person *and* type gave 12 people about 90 rows.
  const TYPE_ORDER = ['annual', 'sick', 'compassionate', 'study', 'december_closure', 'maternity', 'paternity', 'unpaid']
  const balanceTypes = [...new Set(balanceRows.map(b => b.leaveType as string))]
    .sort((x, y) => (TYPE_ORDER.indexOf(x) + 1 || 99) - (TYPE_ORDER.indexOf(y) + 1 || 99))
  type PersonBalances = { id: string; name: string; byType: Map<string, BalanceRow> }
  const personRows: PersonBalances[] = balancesByPerson.map(([id, g]) => ({ id, name: g.name, byType: new Map(g.rows.map(r => [r.leaveType as string, r])) }))
  const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
  const balanceColumns: ColumnDef<PersonBalances>[] = [
    ...(canViewTeamHR ? [{
      key: 'employee', label: 'Employee', priority: 1 as const, width: '190px',
      render: (r: PersonBalances) => <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 12 }}>{r.name}</span>,
      exportValue: (r: PersonBalances) => r.name,
    }] : []),
    ...balanceTypes.map(t => ({
      key: `t_${t}`, label: typeLabel(t), priority: (t === 'annual' || t === 'sick' ? 1 : 2) as 1 | 2,
      render: (r: PersonBalances) => {
        const bal = r.byType.get(t)
        if (!bal) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>—</span>
        const total = bal.entitlement + bal.carryForward
        const left = balanceAvailable(bal)
        if (total === 0 && bal.used === 0 && bal.pending === 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>—</span>
        return (
          <span title={`${bal.entitlement}d entitled · ${bal.carryForward}d carried · ${bal.used}d used · ${bal.pending}d pending`} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            <b style={{ color: left > 0 ? 'var(--success)' : 'var(--danger)' }}>{left}</b>
            <span style={{ color: 'var(--text-4)' }}> / {total}d</span>
            {bal.pending > 0 && <span style={{ color: 'var(--warning)', marginLeft: 4 }}>· {bal.pending} pending</span>}
          </span>
        )
      },
      exportValue: (r: PersonBalances) => { const bal = r.byType.get(t); return bal ? balanceAvailable(bal) : '' },
    })),
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
      {canViewTeamHR && (() => {
        // HR mock J: requests to decide, with the balance after and who else is off.
        const pending = leaveRequests.filter(r => r.status === 'pending_hr').sort((x, y) => String(x.startDate).localeCompare(String(y.startDate)))
        const overlaps = (r: { id: string; employeeId: string; startDate: string; endDate: string }) => leaveRequests
          .filter(o => o.id !== r.id && o.employeeId !== r.employeeId && (o.status === 'approved' || o.status === 'pending_hr') && o.startDate <= r.endDate && o.endDate >= r.startDate)
        const deptOf = (id: string) => employees.find(e => e.id === id)?.departmentId ?? ''
        const color = (name: string) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return ['#db2777', '#2563eb', '#0d9488', '#ea580c', '#7c3aed', '#0891b2', '#b45309', '#4f46e5'][h % 8] }
        const ini = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
        const shortName = (name: string) => { const [x, y] = name.split(/\s+/); return y ? `${x} ${y[0]}.` : x }
        const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
        const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
        // Two weeks from this Monday.
        const start = (() => { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d })()
        const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d.toLocaleDateString('en-CA') })
        const todayIso = new Date().toLocaleDateString('en-CA')
        const away = leaveRequests.filter(r => (r.status === 'approved' || r.status === 'pending_hr') && r.startDate <= days[13] && r.endDate >= days[0])
        const people = [...new Set(away.map(r => r.employeeId))]
        const barColor = (r: { status: string; leaveType: string }) => r.status === 'pending_hr' ? 'repeating-linear-gradient(45deg,#f59e0b 0 6px,#fbbf24 6px 12px)' : /sick/.test(r.leaveType) ? '#7c3aed' : '#3b82f6'
        return (
          <>
            <section className="hra-card hrj">
              <div className="hra-ch"><b className="hrc-title">{pending.length ? `${pending.length} request${pending.length === 1 ? '' : 's'} to decide` : 'No requests to decide'}</b><button type="button" className="hrb-btn" onClick={openLeaveModal}>+ Record leave for someone</button></div>
              {pending.map(r => {
                const bal = leaveBalances.find(b => b.employeeId === r.employeeId && b.leaveType === r.leaveType && b.year === new Date(`${r.startDate}T00:00:00`).getFullYear())
                const total = bal ? bal.entitlement + bal.carryForward : 0
                const left = bal ? bal.entitlement + bal.carryForward - bal.used - bal.pending + r.days : null
                const clash = overlaps(r)
                const canDecide = canDecideLeaveFor(r)
                return (
                  <div key={r.id} className="hrj-req">
                    <div className="hrj-who">
                      <span className="hrj-av" style={{ background: color(r.employeeName) }}>{ini(r.employeeName)}</span>
                      <div className="min-w-0">
                        <b>{r.employeeName}</b> <span className="hra-chip is-b">{LEAVE_LABELS[r.leaveType as StoreLeaveType] ?? r.leaveType.replace(/_/g, ' ')}</span>
                        <div className="hrj-when">{dayLabel(r.startDate)} → {dayLabel(r.endDate)} · <b>{r.days} working day{r.days === 1 ? '' : 's'}</b></div>
                        {left !== null && total > 0 && (
                          <>
                            <div className="hrj-bal"><i style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} /></div>
                            <div className="hrj-small">{left} of {total} days left → {Math.max(0, left - r.days)} after this</div>
                          </>
                        )}
                        {clash.length > 0 && <div className="hrj-warn">{clash.map(o => `${o.employeeName}${deptOf(o.employeeId) ? ` (${deptOf(o.employeeId)})` : ''}`).join(', ')} {clash.length === 1 ? 'is' : 'are'} also off {weekday(clash[0].startDate > r.startDate ? clash[0].startDate : r.startDate)}–{weekday(clash[0].endDate < r.endDate ? clash[0].endDate : r.endDate)}</div>}
                      </div>
                    </div>
                    {canDecide && (
                      <div className="hrj-btns">
                        <button type="button" className="hrb-btn" onClick={() => { setDecideId(r.id); setDecideNote(''); setDecideError('') }}>Reject</button>
                        <button type="button" className="hrb-btn is-g" onClick={() => { decideLeaveRequest(r.id, true); showToast(`${r.employeeName}'s leave approved`, 'success') }}>Approve</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
            <section className="hra-card">
              <div className="hra-ch"><b className="hrc-title">Who&apos;s away · next two weeks</b><div className="hrj-legend"><span className="hra-chip is-b">Annual</span><span className="hra-chip is-v">Sick</span><span className="hra-chip is-a">Pending</span></div></div>
              {people.length === 0 ? <p className="hrb-empty">No one is off in the next two weeks.</p> : (
                <div className="hra-table-wrap">
                  <div className="hrj-cal" style={{ gridTemplateColumns: `150px repeat(14, minmax(34px, 1fr))` }}>
                    <div className="hrj-h" />
                    {days.map((d, i) => {
                      const dt = new Date(`${d}T00:00:00`)
                      const we = dt.getDay() === 0 || dt.getDay() === 6
                      return <div key={d} className={`hrj-h${we ? ' is-we' : ''}${d === todayIso ? ' is-today' : ''}`}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'][dt.getDay()]} {dt.getDate()}{i === 0 ? '' : ''}</div>
                    })}
                    {people.map(pid => {
                      const name = employees.find(e => e.id === pid)?.fullName ?? away.find(r => r.employeeId === pid)?.employeeName ?? '—'
                      const mine = away.filter(r => r.employeeId === pid)
                      return (
                        <Fragment key={pid}>
                          <div className="hrj-nm"><span className="hrj-av is-sm" style={{ background: color(name) }}>{ini(name)}</span>{shortName(name)}</div>
                          {days.map(d => {
                            const dt = new Date(`${d}T00:00:00`)
                            const we = dt.getDay() === 0 || dt.getDay() === 6
                            const starts = mine.filter(r => (r.startDate <= days[0] ? days[0] : r.startDate) === d)
                            return (
                              <div key={d} className={`hrj-c${we ? ' is-we' : ''}`}>
                                {starts.map(r => {
                                  const last = r.endDate > days[13] ? days[13] : r.endDate
                                  const span = days.indexOf(last) - days.indexOf(d) + 1
                                  return <div key={r.id} className="hrj-bar" style={{ width: `calc(${span * 100}% - 6px)`, background: barColor(r) }}>{(LEAVE_LABELS[r.leaveType as StoreLeaveType] ?? r.leaveType).replace(/ leave$/i, '')}{r.status === 'pending_hr' ? ' · pending' : ''}</div>
                                })}
                              </div>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          </>
        )
      })()}

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
            onClick={openLeaveModal}>
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

      {canViewTeamHR && (
        <HRLeaveCalendar canManage={isAdmin} holidays={holidays} onChanged={reloadHolidays} version={holidayVersion} />
      )}

      {/* Leave balances */}
      <div className="hr-submodule-panel card overflow-hidden">
        <PanelHeader
          title={`Leave Balances — ${new Date().getFullYear()}`}
          count={personRows.length}
        />
        <div className="md:hidden">
          {balanceRows.length > 0 && canViewTeamHR && (
            <div className="border-b px-3 py-2" style={{ borderColor: 'var(--border-lt)' }}>
              <input
                className="form-input w-full text-[12px]"
                placeholder="Search employee…"
                value={balanceSearch}
                onChange={e => setBalanceSearch(e.target.value)}
              />
            </div>
          )}
          {balancesByPerson.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-t3">No leave balances found</p>
          ) : (
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border-lt)' }}>
              {balancesByPerson.map(([employeeId, group]) => (
                <li key={employeeId} className="px-3 py-2.5">
                  {canViewTeamHR && <p className="mb-1.5 text-[12px] font-semibold text-t1">{group.name}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {group.rows.map(bal => {
                      const left = balanceAvailable(bal)
                      return (
                        <span
                          key={bal.id}
                          className="inline-flex items-baseline gap-1 rounded-md border px-2 py-0.5 text-[11px]"
                          style={{ borderColor: 'var(--border-lt)' }}
                          title={`${bal.entitlement}d entitled · ${bal.carryForward}d carried · ${bal.used}d used · ${bal.pending}d pending`}
                        >
                          <span className="capitalize text-t2">{bal.leaveType.replace(/_/g, ' ')}</span>
                          <span className="font-semibold" style={{ color: left > 0 ? 'var(--success)' : 'var(--danger)' }}>{left}d</span>
                        </span>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="hidden md:block">
          <p className="px-4 pt-3 text-[11px] text-t3">Days left / days available this year. Hover a figure for used and pending days.</p>
          <DataTable
            tableId="hr_leave_balances_by_person"
            columns={balanceColumns}
            rows={personRows}
            rowKey={r => r.id}
            emptyMessage="No leave balances found"
            exportTitle="Leave Balances"
            exportFilename="leave-balances"
          />
        </div>
      </div>

      {/* HR-side leave modal (admin creates on behalf of employee) */}
      {showLeaveModal && (
        <Modal title="New Leave Request (HR)" onClose={() => setShowLeaveModal(false)} width={520}>
          <Field label="Employee" required>
            <Select value={leaveForm.employeeId}
              onChange={v => setLeaveForm(p => {
                const emp = employees.find(e => e.id === v)
                const typeOk = isLeaveTypeAllowedForGender(p.leaveType as StoreLeaveType, emp?.gender)
                return { ...p, employeeId: v, leaveType: typeOk ? p.leaveType : '' }
              })}
              options={[{ value: '', label: 'Select employee…' }, ...employees.map(e => ({ value: e.id, label: e.fullName }))]} />
          </Field>
          <Field label="Leave Type" required>
            <Select value={leaveForm.leaveType} onChange={v => setLeaveForm(p => ({ ...p, leaveType: v }))} options={[{ value: '', label: 'Select leave type…' }, ...leaveTypeOptionsForEmp]} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Date" required><Input type="date" value={leaveForm.startDate} onChange={v => setLeaveForm(p => ({ ...p, startDate: v }))} /></Field>
            <Field label="End Date" required><Input type="date" value={leaveForm.endDate} onChange={v => setLeaveForm(p => ({ ...p, endDate: v }))} /></Field>
          </div>
          {(!leaveForm.leaveType || !leaveForm.startDate || !leaveForm.endDate) ? (
            <div className="rounded-lg p-2 text-[11px]" style={{ background: 'var(--bg-muted)', color: 'var(--text-3)' }}>Select a leave type and the start and end dates to see the duration.</div>
          ) : (
          <div className="rounded-lg p-2 text-[11px]" style={{ background: leaveDays > 0 && !hrLeaveInsufficient ? 'var(--success-bg)' : 'var(--danger-bg)', color: leaveDays > 0 && !hrLeaveInsufficient ? 'var(--success)' : 'var(--danger)' }}>
            {leaveDays > 0
              ? <>Duration: <strong>{leaveDays} {CALENDAR_DAY_TYPES.includes(leaveForm.leaveType as StoreLeaveType) ? 'calendar' : 'working'} day(s)</strong> (Mon–Sat working week)</>
              : 'The selected dates contain no leave days — check the date order and that the range is not only Sunday/public holidays'}
          </div>
          )}
          {hrLeaveAvailable !== null && leaveForm.leaveType !== 'unpaid' && (
            <div className="rounded-lg p-2 text-[11px] mt-2" style={{ background: hrLeaveInsufficient ? 'var(--danger-bg)' : 'var(--success-bg)', color: hrLeaveInsufficient ? 'var(--danger)' : 'var(--success)' }}>
              Balance: {Math.max(0, hrLeaveAvailable)} day(s) available · Requesting {leaveDays} day(s)
              {hrLeaveInsufficient && <> — cannot book more days than available</>}
            </div>
          )}
          <Field label="Reason"><Textarea value={leaveForm.reason} onChange={v => setLeaveForm(p => ({ ...p, reason: v }))} /></Field>
          <div className="hr-modal-actions flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setShowLeaveModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={submitLeave}>Submit Leave</button>
          </div>
        </Modal>
      )}

      {/* Self-service leave modal (employee books own leave) */}
      {showSelfLeaveModal && (
        <Modal title="Book Leave" onClose={() => setShowSelfLeaveModal(false)} width={480}>
          <div className="rounded-xl p-3 mb-3 text-[12px]" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', color: 'var(--navy-dark)' }}>
            Submitting as: <strong>{myEmployee?.fullName}</strong> · Your request will go to HR for approval.
          </div>
          <Field label="Leave Type" required>
            <Select value={selfLeaveForm.leaveType} onChange={v => setSelfLeaveForm(p => ({ ...p, leaveType: v }))}
              options={[{ value: '', label: 'Select leave type…' }, ...employeeLeaveTypesFor(myEmployee?.gender).map(t => ({ value: t, label: LEAVE_LABELS[t] }))]} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Date" required><Input type="date" value={selfLeaveForm.startDate} onChange={v => setSelfLeaveForm(p => ({ ...p, startDate: v }))} /></Field>
            <Field label="End Date" required><Input type="date" value={selfLeaveForm.endDate} onChange={v => setSelfLeaveForm(p => ({ ...p, endDate: v }))} /></Field>
          </div>
          {(!selfLeaveForm.leaveType || !selfLeaveForm.startDate || !selfLeaveForm.endDate) ? (
            <div className="rounded-lg p-2 text-[11px]" style={{ background: 'var(--bg-muted)', color: 'var(--text-3)' }}>Select a leave type and the start and end dates to see the duration.</div>
          ) : (
          <div className="rounded-lg p-2 text-[11px]" style={{ background: selfLeaveDays > 0 ? 'var(--success-bg)' : 'var(--danger-bg)', color: selfLeaveDays > 0 ? 'var(--success)' : 'var(--danger)' }}>
            {selfLeaveDays > 0
              ? <>Requesting <strong>{selfLeaveDays} {CALENDAR_DAY_TYPES.includes(selfLeaveForm.leaveType as StoreLeaveType) ? 'calendar' : 'working'} day(s)</strong> (calculated from the selected dates)</>
              : 'The selected dates contain no leave days — check the date order and that the range is not only Sunday/public holidays'}
          </div>
          )}
          <Field label="Reason / Notes" required>
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
            <button className="btn-primary" onClick={submitSelfLeave}>Submit Request</button>
          </div>
        </Modal>
      )}
      {earlyId && (() => {
        const req = leaveRequests.find(r => r.id === earlyId)
        if (!req) return null
        const close = () => { if (!earlySaving) { setEarlyId(null); setEarlyError('') } }
        const validDay = /^\d{4}-\d{2}-\d{2}$/.test(earlyLastDay) && earlyLastDay >= req.startDate.slice(0, 10) && earlyLastDay < req.endDate.slice(0, 10)
        const taken = earlyKind === 'returned_early' && validDay ? leaveDaysForRange(req.leaveType as StoreLeaveType, req.startDate.slice(0, 10), earlyLastDay) : 0
        const returned = earlyKind === 'not_taken' ? req.days : validDay ? Math.max(0, req.days - taken) : 0
        const submit = async () => {
          if (earlyKind === 'returned_early' && !validDay) {
            setEarlyError(`Pick the last day they were on leave, from ${fmtDate(req.startDate)} to the day before ${fmtDate(req.endDate)}.`)
            return
          }
          if (returned <= 0) { setEarlyError('No leave days fall after that date — nothing to return.'); return }
          setEarlySaving(true)
          const ok = await closeApprovedLeaveEarly(req.id, earlyKind === 'not_taken' ? { kind: 'not_taken' } : { kind: 'returned_early', lastDayTaken: earlyLastDay }, earlyNote)
          setEarlySaving(false)
          if (ok) setEarlyId(null)
        }
        return (
          <Modal title="Leave not taken or cut short" subtitle={`${req.ref} · ${req.employeeName} · ${fmtDate(req.startDate)} → ${fmtDate(req.endDate)} · ${req.days} day${req.days !== 1 ? 's' : ''}`} onClose={close} width={480}>
            <div className="flex flex-col gap-2 text-xs mb-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" checked={earlyKind === 'returned_early'} onChange={() => { setEarlyKind('returned_early'); setEarlyError('') }} />
                <span><strong>Came back early</strong> — record the last day they were on leave; the days after it go back to their balance.</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" checked={earlyKind === 'not_taken'} onChange={() => { setEarlyKind('not_taken'); setEarlyError('') }} />
                <span><strong>Did not go at all</strong> — cancel the leave; all {req.days} day{req.days !== 1 ? 's' : ''} go back to their balance.</span>
              </label>
            </div>
            {earlyKind === 'returned_early' && (
              <Field label="Last day on leave" required>
                <Input type="date" value={earlyLastDay} onChange={v => { setEarlyLastDay(v); if (earlyError) setEarlyError('') }} />
              </Field>
            )}
            {returned > 0 && (
              <div className="rounded-lg p-2 text-[11px] mt-2" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                {earlyKind === 'returned_early' ? `${taken} of ${req.days} day(s) taken · ` : ''}{returned} day{returned !== 1 ? 's' : ''} back to {req.employeeName}'s {LEAVE_LABELS[req.leaveType as StoreLeaveType] ?? 'leave'} balance
              </div>
            )}
            <Field label="Note" hint="Kept on the leave's history.">
              <Textarea value={earlyNote} onChange={setEarlyNote} rows={2} placeholder="e.g. Called back for the stock count / trip cancelled" />
            </Field>
            {earlyError && <p className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{earlyError}</p>}
            <div className="hr-modal-actions flex justify-end gap-2 pt-3">
              <button className="btn-outline" onClick={close} disabled={earlySaving}>Cancel</button>
              <button className="btn-primary" onClick={() => void submit()} disabled={earlySaving}>{earlySaving ? 'Saving…' : 'Return days to balance'}</button>
            </div>
          </Modal>
        )
      })()}
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
