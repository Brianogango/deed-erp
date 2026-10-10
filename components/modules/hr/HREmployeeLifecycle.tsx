'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, fmtDate, fmtKes, uid, type Employee, type EmployeeChecklistItem } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Field, Input, Select, Textarea } from '@/components/ui'
import { calculateFinalDues, type FinalDuesInput } from '@/lib/hr/final-dues'
import { useRouter } from 'next/navigation'
import { ONBOARDING_TEMPLATES, EXIT_TEMPLATES, OWNER_LABELS, LINK_LABELS, buildChecklist, dueState, type ChecklistLink } from '@/lib/hr/checklists'
import { USER_ROLES } from '@/lib/auth/types'
import { Modal } from '@/components/ui'
import { buildCertificateOfService, buildFinalDuesPdf, lengthOfService } from '@/lib/hr/exit-documents'

const EXIT_REASONS = [
  { value: '', label: 'Select reason…' },
  { value: 'resignation', label: 'Resignation' },
  { value: 'termination', label: 'Termination' },
  { value: 'end_of_contract', label: 'End of contract' },
  { value: 'redundancy', label: 'Redundancy' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'death', label: 'Death' },
  { value: 'other', label: 'Other' },
]
const RECORD_TYPES = [
  { value: 'verbal_warning', label: 'Verbal warning' },
  { value: 'written_warning', label: 'Written warning' },
  { value: 'final_warning', label: 'Final warning' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'commendation', label: 'Commendation' },
  { value: 'other', label: 'Other' },
]

const today = () => new Date().toISOString().slice(0, 10)

type Tab = 'onboarding' | 'exit' | 'conduct' | 'history'
interface Disciplinary { id: string; recordType: string; incidentDate: string; description: string; actionTaken: string; issuedByName: string }
interface HistoryRow { id: string; action: string; at: string; by: string; oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null }

function Checklist({ items, onToggle, onAction, canManage }: {
  items: EmployeeChecklistItem[]; onToggle: (id: string) => void
  onAction: (link: ChecklistLink, item: EmployeeChecklistItem) => void; canManage: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)
  const done = items.filter(i => i.done).length
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px]" style={{ color: 'var(--text-4)' }}>{done} of {items.length} complete</p>
      {items.map(i => {
        const state = dueState(i)
        return (
          <div key={i.id} className="rounded-lg p-2" style={{ border: '1px solid var(--border-lt)' }}>
            <div className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={i.done} disabled={!canManage} onChange={() => onToggle(i.id)} className="mt-0.5" />
              <div className="flex-1">
                <span style={{ color: i.done ? 'var(--text-4)' : 'var(--text-1)', textDecoration: i.done ? 'line-through' : 'none' }}>{i.label}</span>
                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px]" style={{ color: 'var(--text-4)' }}>
                  {i.owner && <span>{OWNER_LABELS[i.owner]}</span>}
                  {i.dueDate && !i.done && <span style={{ color: state === 'overdue' ? 'var(--danger)' : state === 'due_soon' ? 'var(--warning-text)' : undefined }}>{state === 'overdue' ? 'Overdue · ' : 'Due '}{fmtDate(i.dueDate)}</span>}
                  {i.done && i.doneAt && <span>Done {fmtDate(i.doneAt)}</span>}
                  {i.instructions && <button type="button" className="underline" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Hide steps' : 'How'}</button>}
                </div>
                {open === i.id && i.instructions && <p className="mt-1 text-[11px] rounded p-2" style={{ background: 'var(--bg-muted)', color: 'var(--text-2)' }}>{i.instructions}</p>}
              </div>
              {i.link && !i.done && canManage && (
                <button className="btn-outline text-[10px] whitespace-nowrap" onClick={() => onAction(i.link!, i)}>{LINK_LABELS[i.link]}</button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const ROLE_LABELS: Record<string, string> = {
  director: 'Director', admin_officer: 'Admin officer', finance_officer: 'Finance officer', inventory_officer: 'Inventory officer',
  kilimall_officer: 'Kilimall officer', sales_rep: 'Sales rep', technical_lead: 'Technical lead', technician: 'Technician',
}

function CreateLoginModal({ employee, onClose, onCreated }: { employee: Employee; onClose: () => void; onCreated: () => void }) {
  const { showToast } = useApp()
  const [role, setRole] = useState('')
  const [saving, setSaving] = useState(false)
  const target = employee.email || employee.workEmail
  const submit = async () => {
    if (!role) { showToast('Choose the role for this login', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId: employee.id, role }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || body?.message || 'The login could not be created')
      showToast(`Login created. Sign-in details were emailed to ${body?.user?.email ?? target}`, 'success')
      onCreated()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'The login could not be created', 'error')
    } finally { setSaving(false) }
  }
  return (
    <Modal title="Create ERP login" subtitle={employee.fullName} onClose={onClose} width={440}>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
        A username is generated from the work email (or name). A temporary password is emailed to {target || 'the employee'} and they must change it on first sign-in. If the email cannot be delivered the login is not created.
      </p>
      {!target && <p className="text-[11px] mb-3" style={{ color: 'var(--danger)' }}>Add a personal or work email to the employee first.</p>}
      <Field label="Role" required>
        <Select value={role} onChange={setRole} options={[{ value: '', label: 'Select role…' }, ...USER_ROLES.map(r => ({ value: r, label: ROLE_LABELS[r] ?? r }))]} />
      </Field>
      <div className="hr-modal-actions flex justify-end gap-2 pt-3">
        <button className="btn-secondary px-4 py-2 text-xs" onClick={onClose}>Cancel</button>
        <button className="btn-primary px-4 py-2 text-xs" disabled={saving || !target} onClick={submit}>{saving ? 'Creating…' : 'Create login'}</button>
      </div>
    </Modal>
  )
}

function CreateMailboxModal({ employee, onClose, onCreated }: { employee: Employee; onClose: () => void; onCreated: () => void }) {
  const { showToast } = useApp()
  const [info, setInfo] = useState<{ configured: boolean; domain: string | null; suggested: string; existing: string | null } | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ email: string; password: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/employees/${employee.id}/work-mailbox`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'Could not check the mail server')
        if (!cancelled) { setInfo(body); setName(body.suggested) }
      })
      .catch(e => { if (!cancelled) showToast(e instanceof Error ? e.message : 'Could not check the mail server', 'error') })
    return () => { cancelled = true }
  }, [employee.id, showToast])

  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}/work-mailbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'The mailbox could not be created')
      setResult(body)
      updateLocalWorkEmail(body.email)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'The mailbox could not be created', 'error')
    } finally { setSaving(false) }
  }
  // The server saved the address; refresh the in-memory employee so the profile shows it.
  const { updateEmployee } = useHrStore()
  const updateLocalWorkEmail = (email: string) => updateEmployee(employee.id, { workEmail: email })

  return (
    <Modal title="Create work mailbox" subtitle={employee.fullName} onClose={result ? onCreated : onClose} width={480}>
      {!result && (
        <>
          {info && !info.configured && (
            <p className="text-[11px] rounded-lg p-2 mb-3" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
              cPanel is not connected yet. Ask whoever manages the server to add CPANEL_HOST, CPANEL_USER, CPANEL_API_TOKEN and CPANEL_MAIL_DOMAIN to the ERP settings. Meanwhile create the mailbox in cPanel (Email Accounts) and type the address into the Work email field on the profile.
            </p>
          )}
          <Field label="Mailbox name" required>
            <div className="flex items-center gap-2">
              <Input value={name} onChange={setName} />
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>@{info?.domain ?? '…'}</span>
            </div>
          </Field>
          {info?.existing && <p className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>This employee already has {info.existing}.</p>}
          <div className="hr-modal-actions flex justify-end gap-2 pt-3">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={onClose}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" disabled={saving || !info?.configured || !!info?.existing || !name.trim()} onClick={submit}>{saving ? 'Creating…' : 'Create mailbox'}</button>
          </div>
        </>
      )}
      {result && (
        <div className="flex flex-col gap-3 text-xs">
          <p style={{ color: 'var(--success-text)' }}>Mailbox created and saved as the work email.</p>
          <div className="rounded-lg p-3 font-mono" style={{ background: 'var(--bg-muted)' }}>
            <div>{result.email}</div>
            <div className="mt-1">{result.password}</div>
          </div>
          <p style={{ color: 'var(--warning-text)' }}>This password is shown only now and is not stored anywhere. Give it to {employee.fullName.split(' ')[0]} in person or by phone, not by email, and ask them to change it after signing in.</p>
          <div className="flex justify-end gap-2">
            <button className="btn-outline text-[11px]" onClick={() => { void navigator.clipboard?.writeText(`${result.email}\n${result.password}`); showToast('Copied', 'success') }}>Copy</button>
            <button className="btn-primary text-[11px]" onClick={onCreated}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function SuspendMailboxModal({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
  const { showToast } = useApp()
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}/work-mailbox/suspend`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'The mailbox could not be disabled')
      showToast(`Sign-in to ${body.email} is blocked. Its mail is kept.`, 'success')
      onDone()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'The mailbox could not be disabled', 'error')
    } finally { setSaving(false) }
  }
  return (
    <Modal title="Disable work mailbox" subtitle={employee.fullName} onClose={onClose} width={440}>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
        {employee.workEmail ? `This blocks sign-in to ${employee.workEmail}. The mailbox and its mail are kept, so you can add forwarding or reopen it later.` : 'This employee has no work email recorded.'}
      </p>
      <div className="hr-modal-actions flex justify-end gap-2 pt-3">
        <button className="btn-secondary px-4 py-2 text-xs" onClick={onClose}>Cancel</button>
        <button className="btn-primary px-4 py-2 text-xs" disabled={saving || !employee.workEmail} onClick={submit}>{saving ? 'Disabling…' : 'Disable mailbox'}</button>
      </div>
    </Modal>
  )
}

function WelcomeEmailModal({ employee, onClose, onSent }: { employee: Employee; onClose: () => void; onSent: () => void }) {
  const { showToast } = useApp()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const target = employee.email || employee.workEmail
  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}/welcome-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'The email could not be sent')
      showToast(`Welcome email sent to ${body.to}`, 'success')
      onSent()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'The email could not be sent', 'error')
    } finally { setSaving(false) }
  }
  return (
    <Modal title="Send welcome email" subtitle={`${employee.fullName} · starts ${fmtDate(employee.startDate)}`} onClose={onClose} width={500}>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
        Goes to {target || 'no email on file'}. It gives the start date, what to bring, and the work email address. Add anything specific below, such as the arrival time and who to ask for.
      </p>
      <Field label="Extra details (optional)"><Textarea rows={4} value={note} onChange={setNote} placeholder="e.g. Please arrive at 8:00am at the Westlands office and ask for Brian at reception." /></Field>
      <div className="hr-modal-actions flex justify-end gap-2 pt-3">
        <button className="btn-secondary px-4 py-2 text-xs" onClick={onClose}>Cancel</button>
        <button className="btn-primary px-4 py-2 text-xs" disabled={saving || !target} onClick={submit}>{saving ? 'Sending…' : 'Send email'}</button>
      </div>
    </Modal>
  )
}

export default function EmployeeLifecyclePanel({ employee, canManage }: { employee: Employee; canManage: boolean }) {
  const { showToast, companySettings, employeeAssetAssignments } = useApp()
  const { updateEmployee } = useHrStore()
  const router = useRouter()
  const [modal, setModal] = useState<null | { kind: 'login' | 'welcome' | 'mailbox' | 'suspend'; itemId: string }>(null)
  const [tab, setTab] = useState<Tab>(employee.status === 'exited' ? 'exit' : 'onboarding')

  const company = { name: companySettings.name, address: companySettings.address, city: companySettings.city, phone: companySettings.phone, email: companySettings.email, kraPin: companySettings.kraPin }

  // ── Checklists ───────────────────────────────────────────────────────────
  const onboarding = employee.onboardingChecklist?.length ? employee.onboardingChecklist : null
  const exitList = employee.exitChecklist?.length ? employee.exitChecklist : null
  const toggle = (key: 'onboardingChecklist' | 'exitChecklist', current: EmployeeChecklistItem[], id: string) => {
    updateEmployee(employee.id, {
      [key]: current.map(i => i.id === id ? { ...i, done: !i.done, doneAt: !i.done ? today() : undefined } : i),
    })
  }

  const completeItem = (key: 'onboardingChecklist' | 'exitChecklist', itemId: string) => {
    const list = employee[key]
    if (list?.some(i => i.id === itemId && !i.done)) toggle(key, list, itemId)
  }
  const runAction = (link: ChecklistLink, item: EmployeeChecklistItem) => {
    if (link === 'create_login') setModal({ kind: 'login', itemId: item.id })
    else if (link === 'welcome_email') setModal({ kind: 'welcome', itemId: item.id })
    else if (link === 'create_mailbox') setModal({ kind: 'mailbox', itemId: item.id })
    else if (link === 'disable_mailbox') setModal({ kind: 'suspend', itemId: item.id })
    else if (link === 'assets') router.push('/hr?tab=assets')
    else if (link === 'training') router.push('/hr?tab=training')
  }

  // ── Exit and final dues ──────────────────────────────────────────────────
  const [exitDate, setExitDate] = useState(employee.exitDate || today())
  const [exitReason, setExitReason] = useState(employee.exitReason || '')
  const [exitNotes, setExitNotes] = useState(employee.exitNotes || '')
  const [probation, setProbation] = useState(employee.probationEndDate || '')
  const [dues, setDues] = useState<FinalDuesInput | null>(null)
  const [duesLoading, setDuesLoading] = useState(false)
  const [assetCharge, setAssetCharge] = useState('0')

  const unreturned = useMemo(
    () => employeeAssetAssignments.filter(a => a.employeeId === employee.id && a.status === 'assigned'),
    [employeeAssetAssignments, employee.id],
  )

  const loadDues = useCallback(async () => {
    setDuesLoading(true)
    try {
      const res = await fetch(`/api/employees/${employee.id}/final-dues?exitDate=${exitDate}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Could not load final dues figures')
      setDues({
        basicSalary: body.basicSalary, housingAllowance: body.housingAllowance, transportAllowance: body.transportAllowance,
        exitDate, unusedLeaveDays: body.unusedLeaveDays, noticePayDays: 0, exitMonthSalaryPaid: false,
        outstandingLoans: body.outstandingLoans, outstandingAdvances: body.outstandingAdvances,
        unreturnedAssetsCharge: 0, otherDeductions: 0,
      })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not load final dues figures', 'error')
    } finally {
      setDuesLoading(false)
    }
  }, [employee.id, exitDate, showToast])

  const statement = useMemo(() => dues ? calculateFinalDues({ ...dues, exitDate, unreturnedAssetsCharge: Number(assetCharge) || 0 }) : null, [dues, exitDate, assetCharge])
  const setDue = (k: keyof FinalDuesInput) => (v: string) => setDues(d => d ? { ...d, [k]: Number(v) || 0 } : d)

  const exitPerson = {
    name: employee.fullName, employeeNo: employee.employeeNo, jobTitle: employee.jobTitle, department: employee.departmentId,
    idNumber: employee.nationalId, startDate: employee.startDate, exitDate,
    exitReason: EXIT_REASONS.find(r => r.value === exitReason)?.label,
  }

  const recordExit = () => {
    if (!exitReason) { showToast('Choose the reason for exit', 'error'); return }
    updateEmployee(employee.id, {
      status: 'exited', exitDate, exitReason, exitNotes,
      exitChecklist: employee.exitChecklist?.length ? employee.exitChecklist : buildChecklist(EXIT_TEMPLATES, exitDate, uid),
    })
  }
  const reinstate = () => updateEmployee(employee.id, { status: 'active', exitDate: '', exitReason: '', exitNotes: '' })

  // ── Conduct records ──────────────────────────────────────────────────────
  const [records, setRecords] = useState<Disciplinary[] | null>(null)
  const [recForm, setRecForm] = useState({ recordType: 'verbal_warning', incidentDate: today(), description: '', actionTaken: '' })
  const loadRecords = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees/${employee.id}/disciplinary`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not load conduct records')
      setRecords(await res.json())
    } catch (e) { setRecords([]); showToast(e instanceof Error ? e.message : 'Could not load conduct records', 'error') }
  }, [employee.id, showToast])
  const addRecord = async () => {
    if (!recForm.description.trim()) { showToast('Describe what happened', 'error'); return }
    const res = await fetch(`/api/employees/${employee.id}/disciplinary`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recForm) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(body?.error || 'Record was not saved', 'error'); return }
    setRecForm({ recordType: 'verbal_warning', incidentDate: today(), description: '', actionTaken: '' })
    void loadRecords()
  }
  const removeRecord = async (id: string) => {
    const res = await fetch(`/api/employees/${employee.id}/disciplinary/${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast((await res.json().catch(() => ({})))?.error || 'Only a director can remove a record', 'error'); return }
    void loadRecords()
  }

  // ── Salary and status history ────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees/${employee.id}/history`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not load history')
      setHistory(await res.json())
    } catch (e) { setHistory([]); showToast(e instanceof Error ? e.message : 'Could not load history', 'error') }
  }, [employee.id, showToast])

  useEffect(() => { if (tab === 'conduct' && records === null) void loadRecords() }, [tab, records, loadRecords])
  useEffect(() => { if (tab === 'history' && history === null) void loadHistory() }, [tab, history, loadHistory])

  const tabs: Array<[Tab, string]> = [['onboarding', 'Onboarding'], ['exit', 'Exit'], ['conduct', 'Conduct'], ['history', 'History']]
  const num = (v: unknown) => Number(v) || 0

  return (
    <div className="hr-employee-lifecycle pt-3 border-t border-[var(--border-lt)]">
      <div className="flex gap-1 mb-3">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={tab === id ? 'btn-primary text-[11px]' : 'btn-outline text-[11px]'}>{label}</button>
        ))}
      </div>

      {tab === 'onboarding' && (
        <div className="flex flex-col gap-3">
          <Field label="Probation ends">
            <div className="flex gap-2">
              <Input type="date" value={probation} onChange={setProbation} />
              {canManage && <button className="btn-outline text-[11px]" onClick={() => updateEmployee(employee.id, { probationEndDate: probation })}>Save</button>}
            </div>
          </Field>
          {employee.probationEndDate && (() => {
            const days = Math.ceil((new Date(`${employee.probationEndDate}T00:00:00`).getTime() - Date.now()) / 86400000)
            return <p className="text-[11px]" style={{ color: days < 0 ? 'var(--text-4)' : days <= 14 ? 'var(--warning-text)' : 'var(--text-3)' }}>
              {days < 0 ? `Probation ended ${fmtDate(employee.probationEndDate)}` : `Probation ends in ${days} day${days === 1 ? '' : 's'} (${fmtDate(employee.probationEndDate)})`}
            </p>
          })()}
          {onboarding
            ? <Checklist items={onboarding} canManage={canManage} onToggle={id => canManage && toggle('onboardingChecklist', onboarding, id)} onAction={runAction} />
            : canManage
              ? <button className="btn-outline text-[11px] self-start" onClick={() => updateEmployee(employee.id, { onboardingChecklist: buildChecklist(ONBOARDING_TEMPLATES, employee.startDate, uid) })}>Start onboarding checklist</button>
              : <p className="text-xs" style={{ color: 'var(--text-4)' }}>No onboarding checklist</p>}
        </div>
      )}

      {tab === 'exit' && (
        <div className="flex flex-col gap-3">
          {!canManage && <p className="text-xs" style={{ color: 'var(--text-4)' }}>Only HR can manage exits.</p>}
          {canManage && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Last working day"><Input type="date" value={exitDate} onChange={setExitDate} /></Field>
                <Field label="Reason"><Select value={exitReason} onChange={setExitReason} options={EXIT_REASONS} /></Field>
              </div>
              <Field label="Notes"><Textarea value={exitNotes} onChange={setExitNotes} rows={2} /></Field>
              <div className="flex gap-2 flex-wrap">
                {employee.status !== 'exited'
                  ? <button className="btn-primary text-[11px]" onClick={recordExit}>Record exit</button>
                  : <button className="btn-outline text-[11px]" onClick={reinstate}>Reinstate employee</button>}
                {employee.status === 'exited' && <button className="btn-outline text-[11px]" onClick={() => updateEmployee(employee.id, { exitDate, exitReason, exitNotes })}>Save exit details</button>}
                <button className="btn-outline text-[11px]" disabled={!exitDate} onClick={() => buildCertificateOfService(exitPerson, company, today()).save(`Certificate-of-service-${employee.employeeNo}.pdf`)}>Certificate of service</button>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Length of service: {lengthOfService(employee.startDate, exitDate)}</p>

              {employee.exitChecklist?.length ? <Checklist items={employee.exitChecklist} canManage={canManage} onToggle={id => toggle('exitChecklist', exitList!, id)} onAction={runAction} /> : null}

              <div className="rounded-xl p-3" style={{ border: '1px solid var(--border-lt)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Final dues</h4>
                  <button className="btn-outline text-[11px]" onClick={loadDues} disabled={duesLoading}>{duesLoading ? 'Loading…' : dues ? 'Reload figures' : 'Calculate'}</button>
                </div>
                {unreturned.length > 0 && (
                  <p className="text-[11px] mb-2" style={{ color: 'var(--warning-text)' }}>
                    Not yet returned: {unreturned.map(a => a.productName).join(', ')}. Enter a charge below only if HR decides to recover it.
                  </p>
                )}
                {dues && statement && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Field label="Unused leave days"><Input type="number" value={String(dues.unusedLeaveDays)} onChange={setDue('unusedLeaveDays')} /></Field>
                      <Field label="Notice pay days"><Input type="number" value={String(dues.noticePayDays)} onChange={setDue('noticePayDays')} /></Field>
                      <Field label="Loan outstanding"><Input type="number" value={String(dues.outstandingLoans)} onChange={setDue('outstandingLoans')} /></Field>
                      <Field label="Advance outstanding"><Input type="number" value={String(dues.outstandingAdvances)} onChange={setDue('outstandingAdvances')} /></Field>
                      <Field label="Asset charge"><Input type="number" value={assetCharge} onChange={setAssetCharge} /></Field>
                      <Field label="Other deductions"><Input type="number" value={String(dues.otherDeductions)} onChange={setDue('otherDeductions')} /></Field>
                    </div>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={dues.exitMonthSalaryPaid} onChange={e => setDues(d => d ? { ...d, exitMonthSalaryPaid: e.target.checked } : d)} /> Exit-month salary already paid through payroll</label>
                    <div className="text-xs flex flex-col gap-1">
                      {statement.earnings.map(e => <div key={e.label} className="flex justify-between"><span>{e.label}</span><span className="font-mono">{fmtKes(e.amount)}</span></div>)}
                      {statement.statutory.map(e => <div key={e.label} className="flex justify-between" style={{ color: 'var(--text-3)' }}><span>{e.label}</span><span className="font-mono">-{fmtKes(e.amount)}</span></div>)}
                      {statement.recoveries.map(e => <div key={e.label} className="flex justify-between" style={{ color: 'var(--text-3)' }}><span>{e.label}</span><span className="font-mono">-{fmtKes(e.amount)}</span></div>)}
                      <div className="flex justify-between font-bold pt-1" style={{ borderTop: '1px solid var(--border-lt)' }}>
                        <span>{statement.net >= 0 ? 'Net payable' : 'Owed by employee'}</span>
                        <span className="font-mono" style={{ color: statement.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtKes(Math.abs(statement.net))}</span>
                      </div>
                    </div>
                    <button className="btn-primary text-[11px] self-start" onClick={() => buildFinalDuesPdf(exitPerson, company, statement).save(`Final-dues-${employee.employeeNo}.pdf`)}>Download statement (PDF)</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'conduct' && (
        <div className="flex flex-col gap-3">
          {!canManage && <p className="text-xs" style={{ color: 'var(--text-4)' }}>Conduct records are visible to HR only.</p>}
          {canManage && (
            <>
              <div className="rounded-xl p-3 flex flex-col gap-2" style={{ border: '1px solid var(--border-lt)' }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Type"><Select value={recForm.recordType} onChange={v => setRecForm(f => ({ ...f, recordType: v }))} options={RECORD_TYPES} /></Field>
                  <Field label="Incident date"><Input type="date" value={recForm.incidentDate} onChange={v => setRecForm(f => ({ ...f, incidentDate: v }))} /></Field>
                </div>
                <Field label="What happened"><Textarea value={recForm.description} onChange={v => setRecForm(f => ({ ...f, description: v }))} rows={2} /></Field>
                <Field label="Action taken"><Input value={recForm.actionTaken} onChange={v => setRecForm(f => ({ ...f, actionTaken: v }))} /></Field>
                <button className="btn-primary text-[11px] self-start" onClick={addRecord}>Add record</button>
              </div>
              {records === null && <p className="text-xs" style={{ color: 'var(--text-4)' }}>Loading…</p>}
              {records?.length === 0 && <p className="text-xs" style={{ color: 'var(--text-4)' }}>No conduct records</p>}
              {records?.map(r => (
                <div key={r.id} className="rounded-lg p-2 text-xs" style={{ border: '1px solid var(--border-lt)' }}>
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{RECORD_TYPES.find(t => t.value === r.recordType)?.label ?? r.recordType} · {fmtDate(r.incidentDate)}</span>
                    <button className="text-[10px]" style={{ color: 'var(--danger)' }} onClick={() => removeRecord(r.id)}>Remove</button>
                  </div>
                  <p className="mt-1">{r.description}</p>
                  {r.actionTaken && <p style={{ color: 'var(--text-3)' }}>Action: {r.actionTaken}</p>}
                  {r.issuedByName && <p style={{ color: 'var(--text-4)' }}>Recorded by {r.issuedByName}</p>}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="flex flex-col gap-2 text-xs">
          {history === null && <p style={{ color: 'var(--text-4)' }}>Loading…</p>}
          {history?.length === 0 && <p style={{ color: 'var(--text-4)' }}>No recorded salary or status changes</p>}
          {history?.map(h => (
            <div key={h.id} className="rounded-lg p-2" style={{ border: '1px solid var(--border-lt)' }}>
              <div className="flex justify-between"><span className="font-semibold">
                {h.action === 'change_employee_salary' ? 'Salary changed' : h.action === 'exit_employee' ? 'Exited' : 'Employee created'}
              </span><span style={{ color: 'var(--text-4)' }}>{fmtDate(h.at)}{h.by ? ` · ${h.by}` : ''}</span></div>
              {h.action === 'change_employee_salary' && <p className="font-mono">{fmtKes(num(h.oldValues?.basicSalary))} → {fmtKes(num(h.newValues?.basicSalary))}</p>}
            </div>
          ))}
        </div>
      )}
      {modal?.kind === 'login' && <CreateLoginModal employee={employee} onClose={() => setModal(null)} onCreated={() => { completeItem('onboardingChecklist', modal.itemId); setModal(null) }} />}
      {modal?.kind === 'mailbox' && <CreateMailboxModal employee={employee} onClose={() => setModal(null)} onCreated={() => { completeItem('onboardingChecklist', modal.itemId); setModal(null) }} />}
      {modal?.kind === 'suspend' && <SuspendMailboxModal employee={employee} onClose={() => setModal(null)} onDone={() => { completeItem('exitChecklist', modal.itemId); setModal(null) }} />}
      {modal?.kind === 'welcome' && <WelcomeEmailModal employee={employee} onClose={() => setModal(null)} onSent={() => { completeItem('onboardingChecklist', modal.itemId); setModal(null) }} />}
    </div>
  )
}
