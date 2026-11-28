'use client'

import { useEffect, useState } from 'react'
import { fmtDate, fmtKes } from '@/lib/store'
import type { Employee, HRDocument, LeaveRequest, Payslip } from '@/lib/store'
import { documentExpiry } from '@/lib/hr/document-status'
import { initials } from '@/lib/utils'
import { payableDays, type AttendanceDay } from '@/lib/hr/attendance-core'
import type { EmployeeSetup, SetupItem } from '@/lib/hr/employee-setup'
import EmployeeLifecyclePanel from './HREmployeeLifecycle'

type Asset = { id: string; productName: string; serialNumber?: string; assignedDate?: string; acknowledgedByEmployee?: boolean }
type Section = 'overview' | 'documents' | 'equipment' | 'leave' | 'pay' | 'performance' | 'exit'
type Appraisal = { id: string; employeeId: string; status: string; cycleName?: string; cycleId?: string; overallScore?: number | null; selfSubmittedAt?: string | null; managerSubmittedAt?: string | null }

const DOC_LABEL: Record<string, string> = { contract: 'Contract', nda: 'NDA', id_copy: 'ID copy', certification: 'Certificate', work_permit: 'Work permit', other: 'Other' }
const REVIEW_LABEL: Record<string, string> = { pending_self: 'Self review to do', pending_manager: 'With the manager', completed: 'Done' }
export const AVATAR_COLORS = ['#db2777', '#2563eb', '#0d9488', '#ea580c', '#7c3aed', '#0891b2', '#b45309', '#4f46e5']
export function avatarColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/**
 * One person (HR mock B): who they are, onboarding with the button that
 * finishes each step, what HR looks for at a glance, and their documents,
 * equipment, leave, pay and reviews. Offboarding opens the exit checklist.
 */
export default function HREmployeeProfile({
  employee, department, manager, documents, assets, setup, payBasis, leaveRequests, leaveLeft, payslips,
  canManage, onBack, onEdit, onAddDocument, onIssueEquipment,
}: {
  employee: Employee
  department: string
  manager: string
  documents: HRDocument[]
  assets: Asset[]
  setup: EmployeeSetup
  payBasis?: { basis: 'monthly' | 'daily'; dailyRate: number } | null
  leaveRequests: LeaveRequest[]
  leaveLeft: { left: number; total: number } | null
  payslips: Payslip[]
  canManage: boolean
  onBack: () => void
  onEdit: () => void
  onAddDocument: (type: string) => void
  onIssueEquipment: () => void
}) {
  const exited = employee.status === 'exited'
  const [section, setSection] = useState<Section>(exited ? 'exit' : 'overview')
  const [days, setDays] = useState<AttendanceDay[] | null>(null)
  const [reviews, setReviews] = useState<Appraisal[] | null>(null)
  const month = new Date().toISOString().slice(0, 7)
  useEffect(() => {
    let live = true
    fetch(`/api/attendance?month=${month}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
      if (live && d && Array.isArray(d.days)) setDays(d.days.filter((x: AttendanceDay) => x.employeeId === employee.id))
    }).catch(() => {})
    fetch('/api/appraisals', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
      if (!live || !d) return
      const cycles = new Map<string, string>((Array.isArray(d.cycles) ? d.cycles : []).map((c: { id: string; name: string }) => [c.id, c.name]))
      setReviews((Array.isArray(d.appraisals) ? d.appraisals : []).filter((a: Appraisal) => a.employeeId === employee.id).map((a: Appraisal) => ({ ...a, cycleName: a.cycleName ?? (a.cycleId ? cycles.get(a.cycleId) : undefined) })))
    }).catch(() => { if (live) setReviews([]) })
    return () => { live = false }
  }, [employee.id, month])

  const docs = documents.filter(d => d.employeeId === employee.id)
  const mineLeave = leaveRequests.filter(r => r.employeeId === employee.id).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))
  const mineSlips = payslips.filter(p => p.employeeId === employee.id).sort((a, b) => b.year - a.year || String(b.month).localeCompare(String(a.month)))
  const daily = payBasis?.basis === 'daily' && payBasis.dailyRate > 0
  const worked = days ? payableDays(days) : null
  const monthEnd = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10) })()
  const nextPay = daily
    ? (worked === null ? null : worked * payBasis!.dailyRate)
    : Number(employee.basicSalary || 0) + Number(employee.housingAllowance || 0) + Number(employee.transportAllowance || 0)
  const openReview = reviews?.find(r => r.status !== 'completed')

  const action = (item: SetupItem) => {
    if (!canManage || item.done) return null
    if (item.key === 'details' || item.key === 'payroll') return <button type="button" className="hrb-btn" onClick={onEdit}>Fill in</button>
    if (item.key === 'id_copy') return <button type="button" className="hrb-btn is-p" onClick={() => onAddDocument('id_copy')}>Upload</button>
    if (item.key === 'contract') return <button type="button" className="hrb-btn is-p" onClick={() => onAddDocument('contract')}>Upload</button>
    if (item.key === 'equipment' && !exited) return <button type="button" className="hrb-btn" onClick={onIssueEquipment}>Issue</button>
    return null
  }

  const subtitle = [
    employee.jobTitle, department, manager ? `reports to ${manager}` : '',
    daily ? `daily ${fmtKes(payBasis!.dailyRate)}` : '',
  ].filter(Boolean).join(' · ')

  const tabs: Array<[Section, string]> = [
    ['overview', 'Overview'],
    ['documents', `Documents ${docs.length}`],
    ['equipment', `Equipment ${assets.length}`],
    ['leave', 'Leave'],
    ['pay', 'Pay'],
    ['performance', 'Performance'],
    ...(section === 'exit' || exited ? [['exit', exited ? 'Exit' : 'Offboarding'] as [Section, string]] : []),
  ]

  return (
    <div className="hrb">
      <button type="button" className="hrb-back" onClick={onBack}>‹ People</button>
      <div className="hrb-card">
        <div className="hrb-head">
          <div className="hrb-who">
            <span className="hrb-av" style={{ background: avatarColor(employee.fullName) }} aria-hidden="true">{initials(employee.fullName)}</span>
            <div className="min-w-0"><b>{employee.fullName}</b><span>{subtitle}</span></div>
          </div>
          <span className={`hrb-chip ${exited ? 'is-s' : setup.complete ? 'is-g' : 'is-a'}`}>
            {exited ? `Left${employee.exitDate ? ` ${fmtDate(employee.exitDate)}` : ''}` : setup.complete ? 'Onboarded' : `Onboarding ${setup.done}/${setup.total}`}
          </span>
        </div>
        <nav className="hrb-sub" aria-label="Employee sections">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>
          ))}
        </nav>

        {section === 'overview' && (
          <div className="hrb-cols">
            <div>
              <div className="hrb-ch"><b>Onboarding</b><span>{employee.startDate ? `started ${fmtDate(employee.startDate)}` : ''}</span></div>
              <ul className="hrb-chk">
                {setup.items.map(item => (
                  <li key={item.key} className={item.done ? 'is-done' : ''}>
                    <span className="hrb-dot" aria-hidden="true">{item.done ? '✓' : ''}</span>
                    <div className="min-w-0"><b>{item.label}</b><small>{item.hint}</small></div>
                    {action(item)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="hrb-side">
              <div className="hrb-ch"><b>At a glance</b></div>
              <dl className="hrb-glance">
                <dt>Leave left</dt><dd>{leaveLeft ? `${leaveLeft.left} of ${leaveLeft.total} days` : '—'}</dd>
                <dt>This month</dt><dd>{worked === null ? '—' : `${worked} day${worked === 1 ? '' : 's'} worked`}</dd>
                <dt>Next pay</dt><dd>{nextPay === null || !(nextPay > 0) ? '—' : `${fmtKes(nextPay)} · ${fmtDate(monthEnd)}`}</dd>
                <dt>Review</dt><dd>{reviews === null ? '—' : openReview ? REVIEW_LABEL[openReview.status] ?? openReview.status : 'None open'}</dd>
              </dl>
              {canManage && (
                <div className="hrb-actions">
                  <button type="button" className="hrb-btn" onClick={onEdit}>Edit details</button>
                  <button type="button" className="hrb-btn" onClick={() => setSection('exit')}>{exited ? 'Exit & final dues' : 'Start offboarding'}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'documents' && (
          <>
            <div className="hrb-ch"><b>Documents</b>{canManage && <button type="button" className="hrb-btn is-p" onClick={() => onAddDocument('')}>+ Add document</button>}</div>
            {docs.length === 0 ? <p className="hrb-empty">Nothing on file yet — start with the signed contract and an ID copy.</p> : (
              <ul className="hrb-rows">
                {docs.map(d => {
                  const x = documentExpiry(d.expiryDate)
                  return (
                    <li key={d.id}>
                      <div className="min-w-0"><b>{d.title}</b><small>{DOC_LABEL[d.type] ?? d.type}{d.fileName ? ` · ${d.fileName}` : ''}</small></div>
                      <span className={`hrb-chip ${x.status === 'expired' ? 'is-r' : x.status === 'expiring' ? 'is-a' : 'is-g'}`}>{d.expiryDate ? (x.status === 'expired' ? 'Expired' : `Until ${fmtDate(d.expiryDate)}`) : 'On file'}</span>
                      {d.fileName && <a className="hrb-link" href={`/api/hr-documents/${d.id}/file`} target="_blank" rel="noreferrer">View</a>}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}

        {section === 'equipment' && (
          <>
            <div className="hrb-ch"><b>Equipment</b>{canManage && !exited && <button type="button" className="hrb-btn is-p" onClick={onIssueEquipment}>+ Issue equipment</button>}</div>
            {assets.length === 0 ? <p className="hrb-empty">Nothing issued.</p> : (
              <ul className="hrb-rows">
                {assets.map(a => (
                  <li key={a.id}>
                    <div className="min-w-0"><b>{a.productName}</b><small>{[a.serialNumber, a.assignedDate ? `since ${fmtDate(a.assignedDate)}` : ''].filter(Boolean).join(' · ')}</small></div>
                    {exited
                      ? <span className="hrb-chip is-r">To collect</span>
                      : <span className={`hrb-chip ${a.acknowledgedByEmployee ? 'is-g' : 'is-a'}`}>{a.acknowledgedByEmployee ? 'Acknowledged' : 'Waiting'}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {section === 'leave' && (
          <>
            <div className="hrb-ch"><b>Leave</b><span>{leaveLeft ? `${leaveLeft.left} of ${leaveLeft.total} annual days left` : ''}</span></div>
            {mineLeave.length === 0 ? <p className="hrb-empty">No leave taken or requested.</p> : (
              <ul className="hrb-rows">
                {mineLeave.slice(0, 12).map(r => (
                  <li key={r.id}>
                    <div className="min-w-0"><b className="capitalize">{r.leaveType.replace(/_/g, ' ')} · {r.days} day{r.days === 1 ? '' : 's'}</b><small>{fmtDate(r.startDate)} → {fmtDate(r.endDate)}{r.reason ? ` · ${r.reason}` : ''}</small></div>
                    <span className={`hrb-chip ${r.status === 'approved' ? 'is-g' : r.status === 'pending_hr' ? 'is-a' : 'is-s'}`}>{r.status === 'pending_hr' ? 'Waiting' : r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {section === 'pay' && (
          <>
            <div className="hrb-ch"><b>Pay</b><span>{daily ? `Daily rate ${fmtKes(payBasis!.dailyRate)}` : `Monthly ${fmtKes(employee.basicSalary)}`}</span></div>
            {mineSlips.length === 0 ? <p className="hrb-empty">No payslips yet.</p> : (
              <ul className="hrb-rows">
                {mineSlips.slice(0, 12).map(p => (
                  <li key={p.id}>
                    <div className="min-w-0"><b>{p.month} {p.year}</b><small>Gross {fmtKes(p.grossPay)} · deductions {fmtKes(p.deductions)}</small></div>
                    <b>{fmtKes(p.netPay)}</b>
                    <span className={`hrb-chip ${p.status === 'published' ? 'is-g' : 'is-s'}`}>{p.status === 'published' ? 'Paid' : 'Draft'}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {section === 'performance' && (
          <>
            <div className="hrb-ch"><b>Performance</b></div>
            {!reviews?.length ? <p className="hrb-empty">No reviews yet.</p> : (
              <ul className="hrb-rows">
                {reviews.map(r => (
                  <li key={r.id}>
                    <div className="min-w-0"><b>{r.cycleName ?? 'Review'}</b><small>{REVIEW_LABEL[r.status] ?? r.status}</small></div>
                    <b>{r.overallScore ? Number(r.overallScore).toFixed(1) : '—'}</b>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {section === 'exit' && (
          <div className="hrb-pad"><EmployeeLifecyclePanel key={employee.id} employee={employee} canManage={canManage} /></div>
        )}
      </div>
    </div>
  )
}
