'use client'

import { useEffect, useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { Employee, HRDocument } from '@/lib/store'
import { documentExpiry } from '@/lib/hr/document-status'
import { payableDays, type AttendanceDay } from '@/lib/hr/attendance-core'

type Balance = { employeeId: string; leaveType: string; year: number; entitlement: number; used: number; pending: number; carryForward: number }

/**
 * The few facts HR looks for first on a person: how and how much they are
 * paid, leave left, this month's attendance, documents running out.
 */
export default function HREmployeeSummary({ employee, documents, canSeePay }: { employee: Employee; documents: HRDocument[]; canSeePay: boolean }) {
  const [basis, setBasis] = useState<{ basis: 'monthly' | 'daily'; dailyRate: number } | null>(null)
  const [leave, setLeave] = useState<Balance | null | undefined>(undefined)
  const [days, setDays] = useState<AttendanceDay[] | null>(null)
  const month = new Date().toISOString().slice(0, 7)
  const year = new Date().getFullYear()

  useEffect(() => {
    let live = true
    if (canSeePay) {
      fetch('/api/attendance/pay-basis', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
        if (!live || !d) return
        const row = (Array.isArray(d.payBasis) ? d.payBasis : []).find((r: { employeeId: string }) => r.employeeId === employee.id)
        setBasis(row ? { basis: row.basis, dailyRate: Number(row.dailyRate) || 0 } : { basis: 'monthly', dailyRate: 0 })
      }).catch(() => {})
    }
    fetch('/api/leave-requests', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
      if (!live) return
      const b = (Array.isArray(d?.balances) ? d.balances : []).find((x: Balance) => x.employeeId === employee.id && x.leaveType === 'annual' && x.year === year)
      setLeave(b ?? null)
    }).catch(() => { if (live) setLeave(null) })
    fetch(`/api/attendance?month=${month}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
      if (live && d && Array.isArray(d.days)) setDays(d.days.filter((x: AttendanceDay) => x.employeeId === employee.id))
    }).catch(() => {})
    return () => { live = false }
  }, [employee.id, canSeePay, month, year])

  const expiring = documents.filter(d => d.employeeId === employee.id && documentExpiry(d.expiryDate).status !== 'active')
  const paidBy = employee.paymentMode === 'bank'
    ? `Bank${employee.bankName ? ` · ${employee.bankName}` : ''}`
    : employee.paymentMode === 'cash' ? 'Cash' : `M-Pesa${employee.mpesaNumber || employee.phone ? ` · ${employee.mpesaNumber || employee.phone}` : ''}`
  const leaveLeft = leave ? Math.max(0, leave.entitlement + (leave.carryForward || 0) - leave.used - leave.pending) : null

  const tiles: Array<{ label: string; value: string; sub?: string; warn?: boolean }> = [
    ...(canSeePay ? [{
      label: 'Pay',
      value: basis?.basis === 'daily' ? `${fmtKes(basis.dailyRate)} a day` : fmtKes(employee.basicSalary),
      sub: basis?.basis === 'daily' ? 'By the day' : 'Monthly salary',
    }] : []),
    { label: 'Paid by', value: paidBy },
    { label: 'Annual leave', value: leaveLeft === null ? '—' : `${leaveLeft} days left`, sub: leave ? `${leave.used} used` : undefined },
    ...(days ? [{ label: 'This month', value: `${payableDays(days)} days`, sub: `${days.filter(d => d.status === 'pending').length} waiting approval` }] : []),
    { label: 'Documents', value: expiring.length ? `${expiring.length} to renew` : 'Up to date', warn: expiring.length > 0 },
  ]

  return (
    <div className="hr-emp-summary">
      {tiles.map(t => (
        <div key={t.label} className={`hr-emp-summary__tile${t.warn ? ' is-warn' : ''}`}>
          <span>{t.label}</span>
          <strong>{t.value}</strong>
          {t.sub && <small>{t.sub}</small>}
        </div>
      ))}
    </div>
  )
}
