'use client'

import { useEffect, useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { Employee, Payslip } from '@/lib/store'
import ClockCard from '@/components/hr/ClockCard'
import { MyPolicies } from './HRPolicies'
import HRMyDocuments from './HRMyDocuments'
import AppraisalsPanel from './HRAppraisals'

type Balance = { employeeId: string; leaveType: string; year: number; entitlement: number; used: number; pending: number; carryForward: number }
type Toast = (msg: string, type?: 'success' | 'error' | 'info') => void

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthName = (m: string | number) => MONTHS[(Number(m) || 1) - 1] ?? String(m)
const left = (b?: Balance) => (b ? Math.max(0, b.entitlement + (b.carryForward || 0) - b.used - b.pending) : 0)

/**
 * The employee's own HR home: clock in, what leave is left, the latest
 * payslip, equipment held, then policies, documents and appraisals.
 */
export default function HRMyPortal({ name, employee, department, payslips, assets, attendanceOn, leaveOn, onRequestLeave, onSalaryAdvance, onPayslips, downloadPayslip, showToast }: {
  name: string
  employee: Employee | null
  department: string
  payslips: Payslip[]
  assets: Array<{ id: string; productName: string; serial?: string }>
  attendanceOn: boolean
  leaveOn: boolean
  onRequestLeave: () => void
  onSalaryAdvance: () => void
  onPayslips: () => void
  downloadPayslip: (id: string) => void
  showToast: Toast
}) {
  const [balances, setBalances] = useState<Balance[] | null>(null)
  const [pendingLeave, setPendingLeave] = useState(0)
  const year = new Date().getFullYear()

  useEffect(() => {
    if (!employee || !leaveOn) return
    let live = true
    fetch('/api/leave-requests', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live || !d) return
        const mine = (Array.isArray(d.balances) ? d.balances : []).filter((b: Balance) => b.employeeId === employee.id && b.year === year)
        setBalances(mine)
        setPendingLeave((Array.isArray(d.requests) ? d.requests : []).filter((r: { employeeId: string; status: string }) => r.employeeId === employee.id && String(r.status).startsWith('pending')).length)
      })
      .catch(() => { if (live) setBalances([]) })
    return () => { live = false }
  }, [employee, leaveOn, year])

  const annual = balances?.find(b => b.leaveType === 'annual')
  const sick = balances?.find(b => b.leaveType === 'sick')
  const latest = [...payslips].sort((a, b) => (Number(b.year) * 100 + Number(b.month)) - (Number(a.year) * 100 + Number(a.month)))[0]

  return (
    <div className="hr-portal">
      <header className="hr-portal__hero">
        <div className="hr-portal__avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
        <div className="hr-portal__who">
          <h2>{name}</h2>
          <p>{[employee?.jobTitle, department, employee?.employeeNo].filter(Boolean).join(' · ') || 'Your login is not linked to an employee record yet — ask HR.'}</p>
        </div>
        <div className="hr-portal__actions">
          {leaveOn && <button type="button" className="btn-primary" onClick={onRequestLeave}>Request leave</button>}
          <button type="button" className="btn-outline" onClick={onSalaryAdvance}>Salary advance</button>
        </div>
      </header>

      {attendanceOn && <ClockCard showToast={showToast} />}

      <div className="hr-portal__grid">
        {leaveOn && (
          <section className="hr-portal__card" aria-label="Leave">
            <h3>Leave {year}</h3>
            {balances === null ? <p className="hr-portal__muted">Loading…</p> : !annual ? <p className="hr-portal__muted">No leave set up for {year} yet.</p> : (
              <>
                <p className="hr-portal__big">{left(annual)} <span>of {annual.entitlement + (annual.carryForward || 0)} annual days left</span></p>
                <div className="hr-portal__bar"><span style={{ width: `${Math.min(100, (left(annual) / Math.max(1, annual.entitlement + (annual.carryForward || 0))) * 100)}%` }} /></div>
                <p className="hr-portal__muted">
                  {annual.used} used{annual.pending ? ` · ${annual.pending} waiting for approval` : ''}{sick ? ` · sick leave ${left(sick)} of ${sick.entitlement} left` : ''}
                </p>
              </>
            )}
            {pendingLeave > 0 && <p className="hr-portal__note">{pendingLeave} request{pendingLeave === 1 ? '' : 's'} waiting for approval</p>}
            <button type="button" className="hr-portal__link" onClick={onRequestLeave}>My leave requests</button>
          </section>
        )}

        <section className="hr-portal__card" aria-label="Pay">
          <h3>Pay</h3>
          {latest ? (
            <>
              <p className="hr-portal__big">{fmtKes(latest.netPay)} <span>take-home, {monthName(latest.month)} {latest.year}</span></p>
              <p className="hr-portal__muted">Gross {fmtKes(latest.grossPay)} · deductions {fmtKes(latest.deductions)}</p>
              <div className="hr-portal__row">
                <button type="button" className="btn-outline" onClick={() => downloadPayslip(latest.id)}>Download payslip</button>
                <button type="button" className="hr-portal__link" onClick={onPayslips}>All payslips</button>
              </div>
            </>
          ) : <p className="hr-portal__muted">No published payslips yet.</p>}
        </section>

        <section className="hr-portal__card" aria-label="Equipment">
          <h3>Equipment you hold</h3>
          {assets.length ? (
            <ul className="hr-portal__list">
              {assets.map(a => <li key={a.id}>{a.productName}{a.serial ? <span> · {a.serial}</span> : null}</li>)}
            </ul>
          ) : <p className="hr-portal__muted">Nothing assigned to you.</p>}
        </section>
      </div>

      <MyPolicies />
      <HRMyDocuments />
      <AppraisalsPanel manage={false} />
    </div>
  )
}
