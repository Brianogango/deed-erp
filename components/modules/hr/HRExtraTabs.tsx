'use client'

import { useMemo, useState } from 'react'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Field, Input, Modal, Select, Textarea, Badge } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import {
  faGraduationCap, faPlus, faFileLines, faUsers, faBuilding,
  faCalendarMinus, faMoneyBillWave, faCircleCheck,
} from '@fortawesome/free-solid-svg-icons'

// ── Training ──────────────────────────────────────────────────────────────────
export function HRTrainingTab() {
  const { employees, trainingPrograms, employeeTrainings, addTrainingProgram, enrollEmployeeTraining, updateTrainingStatus } = useHrStore()
  const [showProgram, setShowProgram] = useState(false)
  const [showEnroll, setShowEnroll] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', description: '', durationDays: '1', mandatoryForNewHires: false })
  const [enrollEmp, setEnrollEmp] = useState('')

  const empName = (id: string) => employees.find(e => e.id === id)?.fullName ?? 'Unknown'
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  const saveProgram = () => {
    if (!form.title.trim()) return
    addTrainingProgram({
      title: form.title.trim(),
      description: form.description.trim(),
      durationDays: Math.max(1, Number(form.durationDays) || 1),
      mandatoryForNewHires: form.mandatoryForNewHires,
    })
    setForm({ title: '', description: '', durationDays: '1', mandatoryForNewHires: false })
    setShowProgram(false)
  }

  const doEnroll = () => {
    if (!showEnroll || !enrollEmp) return
    enrollEmployeeTraining(enrollEmp, showEnroll)
    setEnrollEmp('')
    setShowEnroll(null)
  }

  return (
    <div className="flex flex-col">
      <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between gap-4">
        <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2"><Fa icon={faGraduationCap} /> Training Programs</h3>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowProgram(true)}><Fa icon={faPlus} /> New Program</button>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {trainingPrograms.length === 0 && <p className="text-xs text-[var(--text-4)] col-span-full text-center py-10">No training programs yet</p>}
        {trainingPrograms.map(p => {
          const enrollments = employeeTrainings.filter(t => t.trainingId === p.id)
          const completed = enrollments.filter(t => t.status === 'completed').length
          return (
            <div key={p.id} className="rounded-xl border border-[var(--border-lt)] p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-[var(--text-1)]">{p.title}</p>
                {p.mandatoryForNewHires && <Badge status="pending" label="Mandatory" />}
              </div>
              <p className="text-[11px] text-[var(--text-3)] line-clamp-2">{p.description || 'No description'}</p>
              <p className="text-[10px] text-[var(--text-4)]">{p.durationDays} day(s) · {enrollments.length} enrolled · {completed} completed</p>
              <div className="flex flex-col gap-1 mt-1">
                {enrollments.map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-[var(--text-2)] truncate">{empName(t.employeeId)}</span>
                    <Select
                      value={t.status}
                      onChange={v => updateTrainingStatus(t.id, v as any)}
                      options={[
                        { value: 'not_started', label: 'Not started' },
                        { value: 'in_progress', label: 'In progress' },
                        { value: 'completed', label: 'Completed' },
                      ]}
                    />
                  </div>
                ))}
              </div>
              <button className="btn-outline text-[11px] py-1 mt-1" onClick={() => setShowEnroll(p.id)}>+ Enroll employee</button>
            </div>
          )
        })}
      </div>

      {showProgram && (
        <Modal title="New Training Program" onClose={() => setShowProgram(false)} width={480}>
          <div className="flex flex-col gap-4">
            <Field label="Title" required><Input value={form.title} onChange={set('title')} placeholder="e.g. Data Protection Induction" /></Field>
            <Field label="Description"><Textarea value={form.description} onChange={set('description')} rows={3} /></Field>
            <Field label="Duration (days)"><Input type="number" value={form.durationDays} onChange={set('durationDays')} /></Field>
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)]">
              <input type="checkbox" checked={form.mandatoryForNewHires} onChange={e => setForm(f => ({ ...f, mandatoryForNewHires: e.target.checked }))} />
              Mandatory for new hires
            </label>
            <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => setShowProgram(false)}>Cancel</button><button className="btn-primary" onClick={saveProgram}>Save</button></div>
          </div>
        </Modal>
      )}

      {showEnroll && (
        <Modal title="Enroll Employee" onClose={() => setShowEnroll(null)} width={420}>
          <div className="flex flex-col gap-4">
            <Field label="Employee" required>
              <Select value={enrollEmp} onChange={setEnrollEmp} options={[{ value: '', label: '— Select —' }, ...employees.filter(e => e.status === 'active').map(e => ({ value: e.id, label: e.fullName }))]} />
            </Field>
            <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => setShowEnroll(null)}>Cancel</button><button className="btn-primary" onClick={doEnroll} disabled={!enrollEmp}>Enroll</button></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── HR Documents ────────────────────────────────────────────────────────────
const DOC_TYPES = [
  { value: 'contract', label: 'Contract' },
  { value: 'nda', label: 'NDA' },
  { value: 'id_copy', label: 'ID Copy' },
  { value: 'certification', label: 'Certification' },
  { value: 'work_permit', label: 'Work Permit' },
  { value: 'other', label: 'Other' },
]

export function HRDocumentsTab() {
  const { employees, hrDocuments, addHRDocument } = useHrStore()
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ employeeId: '', type: 'contract', title: '', expiryDate: '', notes: '' })
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const empName = (id: string) => employees.find(e => e.id === id)?.fullName ?? '—'

  const save = () => {
    if (!form.title.trim() || !form.employeeId) return
    addHRDocument({
      employeeId: form.employeeId,
      type: form.type as any,
      title: form.title.trim(),
      expiryDate: form.expiryDate || undefined,
      visibility: 'hr_only',
      status: 'active',
      notes: form.notes.trim() || undefined,
      uploadedDate: new Date().toISOString(),
    })
    setForm({ employeeId: '', type: 'contract', title: '', expiryDate: '', notes: '' })
    setShow(false)
  }

  const columns: ColumnDef<typeof hrDocuments[0]>[] = [
    { key: 'title', label: 'Title', priority: 1, render: d => <span className="font-semibold text-[var(--text-1)]">{d.title}</span>, exportValue: d => d.title },
    { key: 'employeeId', label: 'Employee', priority: 1, render: d => empName(d.employeeId), exportValue: d => empName(d.employeeId) },
    { key: 'type', label: 'Type', priority: 2, render: d => <span className="capitalize">{d.type.replace(/_/g, ' ')}</span>, exportValue: d => d.type },
    { key: 'expiryDate', label: 'Expiry', priority: 2, render: d => d.expiryDate ? fmtDate(d.expiryDate) : '—', exportValue: d => d.expiryDate ?? '' },
    { key: 'status', label: 'Status', priority: 1, render: d => <Badge status={d.status === 'active' ? 'active' : 'pending'} label={d.status} />, exportValue: d => d.status },
  ]

  return (
    <div className="flex flex-col">
      <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between gap-4">
        <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2"><Fa icon={faFileLines} /> HR Documents</h3>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShow(true)}><Fa icon={faPlus} /> Add Document</button>
      </div>
      <DataTable
        tableId="hr_documents"
        columns={columns}
        rows={hrDocuments}
        rowKey={d => d.id}
        emptyMessage="No HR documents recorded yet"
        exportTitle="HR Documents"
        exportFilename="hr-documents"
      />
      {show && (
        <Modal title="Add HR Document" onClose={() => setShow(false)} width={480}>
          <div className="flex flex-col gap-4">
            <Field label="Employee" required>
              <Select value={form.employeeId} onChange={set('employeeId')} options={[{ value: '', label: '— Select —' }, ...employees.map(e => ({ value: e.id, label: e.fullName }))]} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Type"><Select value={form.type} onChange={set('type')} options={DOC_TYPES} /></Field>
              <Field label="Expiry Date"><Input type="date" value={form.expiryDate} onChange={set('expiryDate')} /></Field>
            </div>
            <Field label="Title" required><Input value={form.title} onChange={set('title')} placeholder="e.g. Employment Contract 2026" /></Field>
            <Field label="Notes"><Textarea value={form.notes} onChange={set('notes')} rows={2} /></Field>
            <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => setShow(false)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── HR Reports ────────────────────────────────────────────────────────────────
export function HRReportsTab() {
  const { employees, leaveRequests, trainingPrograms, employeeTrainings } = useHrStore()
  const { payrollRuns } = useApp()

  const stats = useMemo(() => {
    const active = employees.filter(e => e.status === 'active')
    const byDept = new Map<string, number>()
    active.forEach(e => byDept.set(e.departmentId || 'Unassigned', (byDept.get(e.departmentId || 'Unassigned') ?? 0) + 1))
    const pendingLeave = leaveRequests.filter(r => r.status === 'pending_hr').length
    const latestRun = [...payrollRuns].sort((a, b) => `${b.year}-${b.month}`.localeCompare(`${a.year}-${a.month}`))[0]
    const trainingCompletion = employeeTrainings.length
      ? Math.round((employeeTrainings.filter(t => t.status === 'completed').length / employeeTrainings.length) * 100)
      : 0
    return {
      headcount: active.length,
      exited: employees.length - active.length,
      byDept: Array.from(byDept.entries()).sort((a, b) => b[1] - a[1]),
      pendingLeave,
      latestRun,
      trainingCompletion,
      programs: trainingPrograms.length,
    }
  }, [employees, leaveRequests, payrollRuns, employeeTrainings, trainingPrograms])

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="rounded-xl border border-[var(--border-lt)] p-4">
        <h3 className="text-sm font-bold text-[var(--text-1)] mb-3 flex items-center gap-2"><Fa icon={faBuilding} /> Headcount by Department</h3>
        <div className="flex flex-col gap-2">
          {stats.byDept.length === 0 && <p className="text-xs text-[var(--text-4)]">No active employees</p>}
          {stats.byDept.map(([dept, count]) => (
            <div key={dept} className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-2)] w-48 truncate">{dept}</span>
              <div className="flex-1 h-3 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                <div className="h-full bg-primary-500" style={{ width: `${stats.headcount ? (count / stats.headcount) * 100 : 0}%`, background: 'var(--primary)' }} />
              </div>
              <span className="text-xs font-bold text-[var(--text-1)] w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
