'use client'

import { useEffect, useRef, useState } from 'react'
import { fmtKes, useApp } from '@/lib/store'
import type { Employee, Payslip } from '@/lib/store'
import ClockCard from '@/components/hr/ClockCard'
import { MyPolicies } from './HRPolicies'
import HRMyDocuments from './HRMyDocuments'
import AppraisalsPanel from './HRAppraisals'

type Balance = { employeeId: string; leaveType: string; year: number; entitlement: number; used: number; pending: number; carryForward: number }
type Toast = (msg: string, type?: 'success' | 'error' | 'info') => void
type Asset = { id: string; productName: string; serial?: string; acknowledged?: boolean; assignedDate?: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (m: string | number) => MONTHS[(Number(m) || 1) - 1] ?? String(m)
const left = (b?: Balance) => (b ? Math.max(0, b.entitlement + (b.carryForward || 0) - b.used - b.pending) : 0)
const ring = (pct: number, color = '#0b5fd1') => ({ background: `conic-gradient(${color} 0 ${Math.max(0, Math.min(100, pct))}%, #e2e8f0 ${Math.max(0, Math.min(100, pct))}% 100%)` })

/**
 * HR mock H — the employee's own HR home: clock in at a glance, then the few
 * things HR needs from them (each one tap), then leave, days worked and pay.
 */
export default function HRMyPortal({ name, employee, payslips, assets, attendanceOn, leaveOn, onRequestLeave, onSalaryAdvance, onPayslips, downloadPayslip, showToast }: {
  name: string
  employee: Employee | null
  department: string
  payslips: Payslip[]
  assets: Asset[]
  attendanceOn: boolean
  leaveOn: boolean
  onRequestLeave: () => void
  onSalaryAdvance: () => void
  onPayslips: () => void
  downloadPayslip: (id: string) => void
  showToast: Toast
}) {
  const { acknowledgeEmployeeAsset, uploadMyDocument } = useApp()
  const [balances, setBalances] = useState<Balance[] | null>(null)
  const [month, setMonth] = useState<{ worked: number; of: number } | null>(null)
  const [myDocTypes, setMyDocTypes] = useState<string[] | null>(null)
  const [selfReview, setSelfReview] = useState<{ cycle: string; due: string } | null>(null)
  const [acked, setAcked] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const reviewsRef = useRef<HTMLDivElement>(null)
  const year = new Date().getFullYear()
  const firstName = (employee?.fullName || name).split(/\s+/)[0] ?? ''

  useEffect(() => {
    if (!employee) return
    let live = true
    if (leaveOn) {
      fetch('/api/leave-requests', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
        if (live && d) setBalances((Array.isArray(d.balances) ? d.balances : []).filter((b: Balance) => b.employeeId === employee.id && b.year === year))
      }).catch(() => { if (live) setBalances([]) })
    }
    fetch('/api/hr-documents/mine', { cache: 'no-store' }).then(r => (r.ok ? r.json() : [])).then(d => {
      if (live) setMyDocTypes(Array.isArray(d) ? d.map((x: { type: string }) => x.type) : [])
    }).catch(() => { if (live) setMyDocTypes([]) })
    fetch('/api/appraisals', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(d => {
      if (!live || !d) return
      const mine = (Array.isArray(d.appraisals) ? d.appraisals : []).find((a: { employeeId: string; status: string }) => a.employeeId === employee.id && a.status === 'pending_self')
      const cycle = mine ? (Array.isArray(d.cycles) ? d.cycles : []).find((c: { id: string }) => c.id === mine.cycleId) : null
      setSelfReview(mine ? { cycle: cycle?.name ?? 'Your review', due: cycle?.periodEnd ?? '' } : null)
    }).catch(() => {})
    return () => { live = false }
  }, [employee, leaveOn, year])

  const uploadId = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) { showToast('The file is larger than 4 MB', 'error'); return }
    setUploading(true)
    try {
      const doc = uploadMyDocument({ type: 'id_copy', title: `ID & KRA PIN — ${employee?.fullName ?? name}`, status: 'active', visibility: 'employee_visible', fileName: file.name, fileSize: file.size, fileType: file.type })
      const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Could not read the file')); r.readAsDataURL(file) })
      const res = await fetch(`/api/hr-documents/${doc.id}/file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl, fileName: file.name }) })
      if (!res.ok) showToast('Saved, but the file did not upload — try again', 'error')
      setMyDocTypes(t => [...(t ?? []), 'id_copy'])
    } catch { /* uploadMyDocument already said why */ } finally { setUploading(false) }
  }

  // What HR needs from this person, each done in one tap.
  type Todo = { id: string; icon: string; tone: string; title: string; sub: string; button: React.ReactNode }
  const todos: Todo[] = []
  if (employee && myDocTypes && !myDocTypes.includes('id_copy')) {
    todos.push({ id: 'id', icon: '⇪', tone: 'b', title: 'Upload your ID & KRA PIN', sub: 'A photo of each is enough', button: <button type="button" className="hrb-btn is-p" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'Uploading…' : 'Upload photo'}</button> })
  }
  for (const a of assets.filter(x => !x.acknowledged && !acked.has(x.id)).slice(0, 2)) {
    todos.push({ id: `kit-${a.id}`, icon: '✓', tone: 'a', title: `Confirm your ${a.productName.split(' ').slice(0, 3).join(' ')}`, sub: [a.productName, a.serial].filter(Boolean).join(' · '), button: <button type="button" className="hrb-btn" onClick={() => { acknowledgeEmployeeAsset(a.id); setAcked(s => new Set([...s, a.id])) }}>I have it</button> })
  }
  if (selfReview) {
    todos.push({ id: 'review', icon: '★', tone: 'v', title: `${selfReview.cycle}: self review`, sub: selfReview.due ? `Due ${new Date(`${selfReview.due}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'Waiting for you', button: <button type="button" className="hrb-btn" onClick={() => reviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Start</button> })
  }

  const annual = balances?.find(b => b.leaveType === 'annual')
  const sick = balances?.find(b => b.leaveType === 'sick')
  const annualTotal = annual ? annual.entitlement + (annual.carryForward || 0) : 0
  const latest = [...payslips].sort((a, b) => (Number(b.year) * 100 + Number(b.month)) - (Number(a.year) * 100 + Number(a.month)))[0]
  const monthEnd = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0) })()

  return (
    <div className="hrh-portal">
      {attendanceOn ? <ClockCard variant="hero" firstName={firstName} showToast={showToast} onMonth={setMonth} /> : (
        <section className="hrh-hero">
          <div><div className="hrh-hero__date">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</div><h2>Hello{firstName ? `, ${firstName}` : ''}</h2><p>{employee ? 'Your leave, pay and equipment.' : 'Your login is not linked to an employee record yet — ask HR.'}</p></div>
        </section>
      )}

      {todos.length > 0 && (
        <>
          <div className="hrh-todo-head"><b>HR needs {todos.length} thing{todos.length === 1 ? '' : 's'} from you</b><span>Done in about {Math.max(1, todos.length)} minute{todos.length === 1 ? '' : 's'}</span></div>
          <div className="hrh-todo">
            {todos.map(t => (
              <div key={t.id} className={`hrh-td is-${t.tone}`}>
                <div className="hrh-td__ic" aria-hidden="true">{t.icon}</div>
                <b>{t.title}</b>
                <span>{t.sub}</span>
                {t.button}
              </div>
            ))}
          </div>
          <input ref={fileRef} type="file" hidden accept="image/*,application/pdf" capture="environment" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadId(f); e.target.value = '' }} />
        </>
      )}

      <div className="hrh-tiles">
        {leaveOn && (
          <div className="hrh-tile">
            <div className="hrh-ring" style={ring(annualTotal ? (left(annual) / annualTotal) * 100 : 0)}><div>{annual ? left(annual) : '—'}</div></div>
            <div className="min-w-0">
              <b>Annual leave</b>
              <span>{annual ? `${left(annual)} of ${annualTotal} days left` : `No leave set up for ${year}`}{sick ? ` · sick ${left(sick)}` : ''}</span>
              <button type="button" className="hrb-btn hrh-ghost" onClick={onRequestLeave}>Request leave</button>
            </div>
          </div>
        )}
        <div className="hrh-tile">
          <div className="hrh-ring" style={ring(month && month.of ? (month.worked / month.of) * 100 : 0)}><div>{month ? month.worked : '—'}</div></div>
          <div className="min-w-0">
            <b>Days worked</b>
            <span>{month ? `of ${month.of} this month` : 'This month'}</span>
            <button type="button" className="hrh-link" onClick={onPayslips}>My pay ›</button>
          </div>
        </div>
        <div className="hrh-tile">
          <div className="min-w-0">
            <b>Next payslip</b>
            <div className="hrh-big">{monthEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
            <span>{latest ? `Last: ${fmtKes(latest.netPay)} (${monthName(latest.month)})` : 'No payslips yet'}</span>
            <div className="hrh-links">
              {latest && <button type="button" className="hrh-link" onClick={() => downloadPayslip(latest.id)}>Download last ›</button>}
              <button type="button" className="hrh-link" onClick={onSalaryAdvance}>Ask for an advance ›</button>
            </div>
          </div>
        </div>
      </div>

      <MyPolicies />
      <HRMyDocuments />
      <div ref={reviewsRef}><AppraisalsPanel manage={false} /></div>
    </div>
  )
}
