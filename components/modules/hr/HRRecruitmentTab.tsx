'use client'
import { useMemo, useState } from 'react'
import { useApp, fmtDate, fmtKes, uid, canManageHR, type Candidate, type CandidateInterview, type CandidateStage, type JobPosting } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Fa } from '@/components/icons'
import { faPlus, faBriefcase, faStar } from '@fortawesome/free-solid-svg-icons'
import { Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { useUrlUiState } from '@/hooks/useUrlRecordId'
import {
  PIPELINE_STAGES, REJECTION_REASONS, averageRating, daysInStage, findDuplicates, groupByStage, jobFunnel, nextEmployeeNumber, stageLabel,
} from '@/lib/hr/recruitment'
import { ONBOARDING_ITEMS } from '@/lib/hr/checklists'

type JobForm = {
  title: string; departmentId: string; location: string; type: JobPosting['type'] | ''
  status: JobPosting['status']; closingDate: string; description: string; openings: string
}
type CandidateForm = {
  jobId: string; firstName: string; lastName: string; email: string; phone: string
  stage: CandidateStage; resumeUrl: string; notes: string; source: string
}

const emptyJobForm = (): JobForm => ({ title: '', departmentId: '', location: '', type: '', status: 'open', closingDate: '', description: '', openings: '1' })
const emptyCandidateForm = (jobId = ''): CandidateForm => ({ jobId, firstName: '', lastName: '', email: '', phone: '', stage: 'applied', resumeUrl: '', notes: '', source: '' })
const SOURCES = ['', 'Referral', 'LinkedIn', 'Job board', 'Walk-in', 'Company website', 'Agency', 'Other']
const today = () => new Date().toISOString().slice(0, 10)
const nowIso = () => new Date().toISOString()

const stageColor: Record<CandidateStage, string> = {
  applied: 'var(--text-3)', screening: 'var(--primary-dark)', interview: 'var(--warning-text)',
  offered: '#5B21B6', hired: 'var(--success-text)', rejected: 'var(--danger)',
}

function Stars({ value }: { value: number | null }) {
  if (!value) return <span className="text-[10px]" style={{ color: 'var(--text-4)' }}>Not rated</span>
  return <span className="text-[10px] inline-flex items-center gap-0.5" style={{ color: '#B45309' }}><Fa icon={faStar} /> {value}</span>
}

export default function HRRecruitmentTab() {
  const { currentUser, showToast } = useApp()
  const { jobPostings, candidates, departments, employees, addJobPosting, updateJobPosting, addCandidate, updateCandidate, addEmployee } = useHrStore()
  const canManage = canManageHR(currentUser ?? null)

  const [viewValue, setViewValue] = useUrlUiState('recruitmentView', 'jobs')
  const view: 'jobs' | 'pipeline' | 'candidates' = viewValue === 'candidates' ? 'candidates' : viewValue === 'pipeline' ? 'pipeline' : 'jobs'
  const [jobFilter, setJobFilter] = useUrlUiState('recruitmentJob', '')
  const [candidateSearch, setCandidateSearch] = useUrlUiState('candidateQ', '')
  const [candidatePageValue, setCandidatePageValue] = useUrlUiState('candidatePage', '1')
  const candidatePage = Math.max(1, Number.parseInt(candidatePageValue, 10) || 1)
  const setCandidatePage = (page: number) => setCandidatePageValue(String(Math.max(1, page)))

  const [jobModal, setJobModal] = useState<{ id: string | null } | null>(null)
  const [jobForm, setJobForm] = useState<JobForm>(emptyJobForm)
  const [candidateModal, setCandidateModal] = useState(false)
  const [candidateForm, setCandidateForm] = useState<CandidateForm>(emptyCandidateForm)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [hireId, setHireId] = useState<string | null>(null)

  const departmentOptions = departments.map(d => ({ value: d.id, label: d.name }))
  const jobOptions = jobPostings.map(j => ({ value: j.id, label: `${j.title} (${j.status})` }))
  const jobTitle = (id: string) => jobPostings.find(j => j.id === id)?.title ?? 'Unknown job'
  const scoped = useMemo(() => jobFilter ? candidates.filter(c => c.jobId === jobFilter) : candidates, [candidates, jobFilter])
  const byStage = useMemo(() => groupByStage(scoped), [scoped])
  const active = candidates.find(c => c.id === activeId) ?? null
  const dupes = useMemo(() => findDuplicates(candidates, candidateForm), [candidates, candidateForm])

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const openJobModal = (job?: JobPosting) => {
    setJobForm(job ? {
      title: job.title, departmentId: job.departmentId, location: job.location, type: job.type, status: job.status,
      closingDate: job.closingDate ?? '', description: job.description, openings: String(job.openings ?? 1),
    } : emptyJobForm())
    setJobModal({ id: job?.id ?? null })
  }

  const submitJob = () => {
    const missing: string[] = []
    if (!jobForm.title.trim()) missing.push('Job Title')
    if (!jobForm.departmentId) missing.push('Department')
    if (!jobForm.location.trim()) missing.push('Location')
    if (!jobForm.type) missing.push('Employment Type')
    if (!jobForm.description.trim()) missing.push('Description')
    if (missing.length) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    if (!jobForm.type) return
    const openings = Math.max(1, Math.floor(Number(jobForm.openings) || 1))
    const body = {
      title: jobForm.title.trim(), departmentId: jobForm.departmentId, location: jobForm.location.trim(), type: jobForm.type,
      status: jobForm.status, closingDate: jobForm.closingDate || undefined, description: jobForm.description.trim(), openings,
    }
    if (jobModal?.id) updateJobPosting(jobModal.id, body); else addJobPosting(body)
    setJobModal(null)
  }

  // ── Candidates ────────────────────────────────────────────────────────────
  const submitCandidate = () => {
    const f = candidateForm
    if (!f.jobId) { showToast('Create or select a job posting before adding a candidate', 'error'); return }
    if (!f.firstName.trim() || !f.lastName.trim()) { showToast('Candidate first and last name are required', 'error'); return }
    if (!f.email.trim()) { showToast('Candidate email is required', 'error'); return }
    if (!f.phone.trim()) { showToast('Candidate phone number is required', 'error'); return }
    addCandidate({
      jobId: f.jobId, firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email.trim(), phone: f.phone.trim(),
      stage: f.stage, resumeUrl: f.resumeUrl.trim() || undefined, notes: f.notes.trim() || undefined, source: f.source || undefined,
    })
    setCandidateModal(false)
  }

  const moveStage = (c: Candidate, stage: CandidateStage) => {
    if (stage === c.stage) return
    if (stage === 'rejected') { setRejectId(c.id); return }
    if (stage === 'hired') { setHireId(c.id); return }
    updateCandidate(c.id, { stage, stageChangedDate: nowIso(), ...(c.stage === 'rejected' ? { rejectionReason: undefined } : {}) })
  }

  const nextStage = (s: CandidateStage): CandidateStage | null => {
    const order: CandidateStage[] = ['applied', 'screening', 'interview', 'offered', 'hired']
    const i = order.indexOf(s)
    return i >= 0 && i < order.length - 1 ? order[i + 1] : null
  }

  const candidateColumns: ColumnDef<Candidate>[] = [
    {
      key: 'candidate', label: 'Candidate', priority: 1, width: '1.4fr',
      render: c => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xs">{c.firstName[0]}{c.lastName[0]}</div>
          <div>
            <p className="text-xs font-bold text-[var(--text-1)]">{c.firstName} {c.lastName}</p>
            <p className="text-[10px] text-[var(--text-4)]">{c.email}</p>
          </div>
        </div>
      ),
      exportValue: c => `${c.firstName} ${c.lastName}`,
    },
    { key: 'stage', label: 'Stage', priority: 1, width: '110px', render: c => <span className="text-[10px] font-bold capitalize" style={{ color: stageColor[c.stage] }}>{stageLabel(c.stage)}</span>, exportValue: c => c.stage },
    { key: 'job', label: 'Job Applied', priority: 2, width: '160px', render: c => <span className="text-xs text-[var(--text-2)]">{jobTitle(c.jobId)}</span>, exportValue: c => jobTitle(c.jobId) },
    { key: 'rating', label: 'Rating', priority: 2, width: '80px', render: c => <Stars value={averageRating(c)} />, exportValue: c => averageRating(c) ?? '' },
    { key: 'source', label: 'Source', priority: 3, width: '110px', render: c => <span className="text-xs">{c.source || '—'}</span>, exportValue: c => c.source ?? '' },
    { key: 'appliedDate', label: 'Applied', priority: 2, width: '100px', render: c => <span className="text-xs text-[var(--text-3)]">{fmtDate(c.appliedDate)}</span>, exportValue: c => c.appliedDate },
  ]

  const tabBtn = (id: typeof view, label: string) => (
    <button key={id} onClick={() => setViewValue(id)} className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${view === id ? 'bg-primary-500 text-white' : 'text-[var(--text-3)] hover:bg-[var(--bg-muted)]'}`}>{label}</button>
  )

  return (
    <div className="hr-submodule hr-recruitment flex flex-col">
      <div className="hr-submodule-toolbar p-4 border-b border-[var(--border-lt)] flex items-center justify-between gap-3 flex-wrap bg-[var(--bg-surface)]">
        <div className="hr-segmented-control flex gap-2" aria-label="Recruitment views">
          {tabBtn('jobs', 'Job Postings')}{tabBtn('pipeline', 'Pipeline')}{tabBtn('candidates', 'Candidates')}
        </div>
        <div className="flex items-center gap-2">
          {view !== 'jobs' && (
            <select className="form-input text-[11px] py-1.5" value={jobFilter} onChange={e => setJobFilter(e.target.value)}>
              <option value="">All jobs</option>
              {jobPostings.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          )}
          {canManage && (
            <button onClick={() => view === 'jobs' ? openJobModal() : (setCandidateForm(emptyCandidateForm(jobFilter)), setCandidateModal(true))} className="btn-primary py-1.5 px-4 text-[10px] flex items-center gap-2">
              <Fa icon={faPlus} /><span>{view === 'jobs' ? 'New Posting' : 'Add Candidate'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="hr-submodule-content p-4">
        {view === 'jobs' && (
          <div className="hr-job-list grid grid-cols-1 gap-3">
            {jobPostings.length === 0 && <div className="py-12 text-center"><p className="text-sm text-[var(--text-4)]">No job postings found</p></div>}
            {jobPostings.map(j => {
              const f = jobFunnel(j, candidates)
              const overdue = j.status === 'open' && j.closingDate && j.closingDate < today()
              return (
                <div key={j.id} className="hr-job-card card p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="hr-job-card__main flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center"><Fa icon={faBriefcase} /></div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-1)]">{j.title}</h4>
                      <p className="text-[10px] text-[var(--text-4)] uppercase font-semibold tracking-wider">
                        {departments.find(d => d.id === j.departmentId)?.name ?? j.departmentId} · {j.type.replace('_', ' ')} · {j.location}
                      </p>
                      <p className="text-[11px] text-[var(--text-3)] mt-0.5">
                        {f.total} applicant{f.total === 1 ? '' : 's'} · {f.active} in progress · {f.hired} of {f.openings} filled
                        {overdue ? <span style={{ color: 'var(--warning-text)' }}> · closing date passed</span> : j.closingDate ? ` · closes ${fmtDate(j.closingDate)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${j.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{j.status.toUpperCase()}</span>
                    <button className="btn-outline text-[11px]" onClick={() => { setJobFilter(j.id); setViewValue('pipeline') }}>Pipeline</button>
                    {canManage && <button className="btn-outline text-[11px]" onClick={() => openJobModal(j)}>Edit</button>}
                    {canManage && j.status !== 'draft' && (
                      <button className="btn-outline text-[11px]" onClick={() => updateJobPosting(j.id, { status: j.status === 'open' ? 'closed' : 'open' })}>{j.status === 'open' ? 'Close' : 'Reopen'}</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {view === 'pipeline' && (
          <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, minmax(180px, 1fr))` }}>
            {PIPELINE_STAGES.map(stage => (
              <div key={stage.id} className="rounded-xl p-2 flex flex-col gap-2" style={{ background: 'var(--bg-muted)', minHeight: 200 }}>
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold" style={{ color: stageColor[stage.id] }}>{stage.label}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-4)' }}>{byStage[stage.id].length}</span>
                </div>
                {byStage[stage.id].map(c => {
                  const days = daysInStage(c)
                  const next = nextStage(c.stage)
                  return (
                    <div key={c.id} className="card p-2 text-xs cursor-pointer" onClick={() => setActiveId(c.id)}>
                      <p className="font-bold text-[var(--text-1)]">{c.firstName} {c.lastName}</p>
                      <p className="text-[10px] text-[var(--text-4)] truncate">{jobTitle(c.jobId)}</p>
                      <div className="flex items-center justify-between mt-1">
                        <Stars value={averageRating(c)} />
                        {c.stage !== 'hired' && c.stage !== 'rejected' && <span className="text-[10px]" style={{ color: days > 14 ? 'var(--warning-text)' : 'var(--text-4)' }}>{days}d</span>}
                      </div>
                      {canManage && next && (
                        <button className="btn-outline text-[10px] mt-1.5 w-full" onClick={e => { e.stopPropagation(); moveStage(c, next) }}>Move to {stageLabel(next)}</button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {view === 'candidates' && (
          <DataTable
            tableId="hr_candidates" columns={candidateColumns} rows={scoped} rowKey={c => c.id}
            searchValue={candidateSearch} onSearchChange={setCandidateSearch} page={candidatePage} onPageChange={setCandidatePage}
            emptyMessage="No candidates found" onRowClick={c => setActiveId(c.id)}
            exportTitle="Candidates" exportFilename="candidates"
          />
        )}
      </div>

      {jobModal && (
        <Modal title={jobModal.id ? 'Edit Job Posting' : 'New Job Posting'} subtitle="Roles you are hiring for" onClose={() => setJobModal(null)} width={620}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Job Title" required><Input autoFocus value={jobForm.title} onChange={title => setJobForm(p => ({ ...p, title }))} placeholder="e.g. Sales Executive" /></Field>
            <Field label="Department" required><Select value={jobForm.departmentId} onChange={departmentId => setJobForm(p => ({ ...p, departmentId }))} options={departmentOptions.length ? [{ value: '', label: 'Select department…' }, ...departmentOptions] : [{ value: '', label: 'No departments available' }]} /></Field>
            <Field label="Location" required><Input value={jobForm.location} onChange={location => setJobForm(p => ({ ...p, location }))} placeholder="e.g. Nairobi" /></Field>
            <Field label="Employment Type" required><Select value={jobForm.type} onChange={type => setJobForm(p => ({ ...p, type: type as JobPosting['type'] }))} options={[{ value: '', label: 'Select type…' }, { value: 'full_time', label: 'Full Time' }, { value: 'part_time', label: 'Part Time' }, { value: 'contract', label: 'Contract' }]} /></Field>
            <Field label="Status"><Select value={jobForm.status} onChange={status => setJobForm(p => ({ ...p, status: status as JobPosting['status'] }))} options={[{ value: 'open', label: 'Open' }, { value: 'draft', label: 'Draft' }, { value: 'closed', label: 'Closed' }]} /></Field>
            <Field label="Positions to fill"><Input type="number" value={jobForm.openings} onChange={openings => setJobForm(p => ({ ...p, openings }))} /></Field>
            <Field label="Closing Date"><Input type="date" value={jobForm.closingDate} onChange={closingDate => setJobForm(p => ({ ...p, closingDate }))} /></Field>
          </div>
          <Field label="Description" required><Textarea rows={5} value={jobForm.description} onChange={description => setJobForm(p => ({ ...p, description }))} placeholder="Summarize the role, requirements, and expectations." /></Field>
          <div className="hr-modal-actions flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setJobModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={submitJob}>Save Posting</button>
          </div>
        </Modal>
      )}

      {candidateModal && (
        <Modal title="Add Candidate" subtitle="Register a candidate against a job posting" onClose={() => setCandidateModal(false)} width={620}>
          <Field label="Job Posting" required><Select value={candidateForm.jobId} onChange={jobId => setCandidateForm(p => ({ ...p, jobId }))} options={jobOptions.length ? [{ value: '', label: 'Select job posting…' }, ...jobOptions] : [{ value: '', label: 'No job postings available' }]} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="First Name" required><Input autoFocus value={candidateForm.firstName} onChange={firstName => setCandidateForm(p => ({ ...p, firstName }))} /></Field>
            <Field label="Last Name" required><Input value={candidateForm.lastName} onChange={lastName => setCandidateForm(p => ({ ...p, lastName }))} /></Field>
            <Field label="Email" required><Input type="email" value={candidateForm.email} onChange={email => setCandidateForm(p => ({ ...p, email }))} /></Field>
            <Field label="Phone" required><Input value={candidateForm.phone} onChange={phone => setCandidateForm(p => ({ ...p, phone }))} /></Field>
            <Field label="Source"><Select value={candidateForm.source} onChange={source => setCandidateForm(p => ({ ...p, source }))} options={SOURCES.map(s => ({ value: s, label: s || 'Select source…' }))} /></Field>
            <Field label="Resume URL"><Input value={candidateForm.resumeUrl} onChange={resumeUrl => setCandidateForm(p => ({ ...p, resumeUrl }))} placeholder="Optional link; upload a file after saving" /></Field>
          </div>
          {dupes.length > 0 && (
            <p className="text-[11px] rounded-lg p-2" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
              Already on file: {dupes.map(d => `${d.firstName} ${d.lastName} (${jobTitle(d.jobId)}, ${stageLabel(d.stage)})`).join('; ')}. Check this is not the same person before adding.
            </p>
          )}
          <Field label="Notes"><Textarea value={candidateForm.notes} onChange={notes => setCandidateForm(p => ({ ...p, notes }))} placeholder="Optional screening notes." /></Field>
          <div className="hr-modal-actions flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setCandidateModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={submitCandidate}>Save Candidate</button>
          </div>
        </Modal>
      )}

      {active && (
        <CandidateDetail
          key={active.id} candidate={active} jobTitle={jobTitle(active.jobId)} canManage={canManage}
          onClose={() => setActiveId(null)} onMove={moveStage} onUpdate={updateCandidate}
          onReject={() => setRejectId(active.id)} onHire={() => setHireId(active.id)}
        />
      )}

      {rejectId && (() => {
        const c = candidates.find(x => x.id === rejectId)
        return c ? <RejectModal candidate={c} onClose={() => setRejectId(null)} onConfirm={reason => { updateCandidate(c.id, { stage: 'rejected', stageChangedDate: nowIso(), rejectionReason: reason }); setRejectId(null) }} /> : null
      })()}

      {hireId && (() => {
        const c = candidates.find(x => x.id === hireId)
        const job = c ? jobPostings.find(j => j.id === c.jobId) : undefined
        return c ? (
          <HireModal
            candidate={c} job={job} suggestedNo={nextEmployeeNumber(employees)} onClose={() => setHireId(null)}
            onHire={async form => {
              const saved = await addEmployee({
                fullName: `${c.firstName} ${c.lastName}`.trim(), employeeNo: form.employeeNo.trim(), email: c.email, phone: c.phone,
                nationalId: '', kraPin: '', departmentId: job?.departmentId ?? '', jobTitle: job?.title ?? '',
                startDate: form.startDate, status: 'active', basicSalary: Number(form.salary) || 0, housingAllowance: 0, transportAllowance: 0,
                bankAccount: '', probationEndDate: form.probationEndDate || undefined,
                onboardingChecklist: ONBOARDING_ITEMS.map(label => ({ id: uid(), label, done: false })),
              })
              updateCandidate(c.id, {
                stage: 'hired', stageChangedDate: nowIso(), hiredEmployeeId: saved.id,
                offer: c.offer ? { ...c.offer, status: 'accepted' } : undefined,
              })
              setHireId(null)
              setActiveId(null)
            }}
          />
        ) : null
      })()}
    </div>
  )
}

// ── Candidate detail ──────────────────────────────────────────────────────────
function CandidateDetail({ candidate: c, jobTitle, canManage, onClose, onMove, onUpdate, onReject, onHire }: {
  candidate: Candidate; jobTitle: string; canManage: boolean; onClose: () => void
  onMove: (c: Candidate, s: CandidateStage) => void
  onUpdate: (id: string, patch: Partial<Candidate>) => void
  onReject: () => void; onHire: () => void
}) {
  const { showToast } = useApp()
  const [tab, setTab] = useState<'profile' | 'interviews' | 'offer'>('profile')
  const [notes, setNotes] = useState(c.notes ?? '')
  const [iv, setIv] = useState({ scheduledAt: '', mode: 'in_person' as CandidateInterview['mode'], interviewer: '', location: '' })
  const [offer, setOffer] = useState({ salary: String(c.offer?.salary ?? ''), startDate: c.offer?.startDate ?? '', notes: c.offer?.notes ?? '' })
  const [uploading, setUploading] = useState(false)
  const interviews = c.interviews ?? []
  const avg = averageRating(c)

  const patchInterview = (id: string, patch: Partial<CandidateInterview>) =>
    onUpdate(c.id, { interviews: interviews.map(i => i.id === id ? { ...i, ...patch } : i) })

  const addInterview = () => {
    if (!iv.scheduledAt || !iv.interviewer.trim()) { showToast('Enter the date, time and interviewer', 'error'); return }
    onUpdate(c.id, {
      interviews: [...interviews, { id: uid(), scheduledAt: iv.scheduledAt, mode: iv.mode, interviewer: iv.interviewer.trim(), location: iv.location.trim() || undefined, status: 'scheduled' }],
      ...(c.stage === 'applied' || c.stage === 'screening' ? { stage: 'interview' as CandidateStage, stageChangedDate: nowIso() } : {}),
    })
    setIv({ scheduledAt: '', mode: 'in_person', interviewer: '', location: '' })
  }

  const saveOffer = () => {
    const salary = Number(offer.salary)
    if (!Number.isFinite(salary) || salary <= 0) { showToast('Enter the offered monthly basic salary', 'error'); return }
    if (!offer.startDate) { showToast('Enter the proposed start date', 'error'); return }
    onUpdate(c.id, {
      offer: { salary, startDate: offer.startDate, notes: offer.notes.trim() || undefined, offeredDate: c.offer?.offeredDate ?? today(), status: c.offer?.status ?? 'pending' },
      ...(c.stage !== 'offered' && c.stage !== 'hired' ? { stage: 'offered' as CandidateStage, stageChangedDate: nowIso() } : {}),
    })
  }

  const upload = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) { showToast('The file is larger than 4 MB', 'error'); return }
    setUploading(true)
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Could not read the file')); r.readAsDataURL(file)
      })
      const res = await fetch(`/api/hr-documents/${c.id}/file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl, fileName: file.name }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Upload failed')
      onUpdate(c.id, { resumeFile: { name: file.name, size: file.size, type: file.type } })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed', 'error')
    } finally { setUploading(false) }
  }

  const closed = c.stage === 'hired' || c.stage === 'rejected'
  return (
    <Modal title={`${c.firstName} ${c.lastName}`} subtitle={`${jobTitle} · applied ${fmtDate(c.appliedDate)}`} onClose={onClose} width={640}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: stageColor[c.stage] }}>{stageLabel(c.stage)}</span>
          <Stars value={avg} />
          {c.stage === 'rejected' && c.rejectionReason && <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>· {c.rejectionReason}</span>}
        </div>
        {canManage && !closed && (
          <div className="flex gap-2">
            <Select value={c.stage} onChange={v => onMove(c, v as CandidateStage)} options={PIPELINE_STAGES.filter(s => s.id !== 'hired' && s.id !== 'rejected').map(s => ({ value: s.id, label: s.label }))} />
            <button className="btn-outline text-[11px]" onClick={onReject}>Reject</button>
            <button className="btn-primary text-[11px]" onClick={onHire}>Hire</button>
          </div>
        )}
        {canManage && c.stage === 'rejected' && <button className="btn-outline text-[11px]" onClick={() => onMove(c, 'screening')}>Reopen</button>}
        {c.stage === 'hired' && <span className="text-[11px]" style={{ color: 'var(--success-text)' }}>Hired{c.hiredEmployeeId ? ' and added to Employees' : ''}</span>}
      </div>

      <div className="flex gap-1 mb-3">
        {([['profile', 'Profile'], ['interviews', `Interviews (${interviews.length})`], ['offer', 'Offer']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={tab === id ? 'btn-primary text-[11px]' : 'btn-outline text-[11px]'}>{label}</button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="flex flex-col gap-3 text-xs">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            <div><span className="text-[var(--text-4)]">Email</span><p className="font-semibold">{c.email}</p></div>
            <div><span className="text-[var(--text-4)]">Phone</span><p className="font-semibold">{c.phone}</p></div>
            <div><span className="text-[var(--text-4)]">Source</span><p className="font-semibold">{c.source || '—'}</p></div>
            <div><span className="text-[var(--text-4)]">In this stage</span><p className="font-semibold">{daysInStage(c)} days</p></div>
          </div>
          {canManage && (
            <Field label="Overall rating">
              <Select value={String(c.rating ?? '')} onChange={v => onUpdate(c.id, { rating: v ? Number(v) : undefined })} options={[{ value: '', label: 'Not rated' }, ...[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} / 5` }))]} />
            </Field>
          )}
          <div>
            <span className="text-[var(--text-4)]">CV / resume</span>
            <div className="flex items-center gap-3 mt-1">
              {c.resumeFile && <a className="text-primary-600 hover:underline" href={`/api/hr-documents/${c.id}/file`} target="_blank" rel="noreferrer">{c.resumeFile.name}</a>}
              {c.resumeUrl && <a className="text-primary-600 hover:underline" href={c.resumeUrl} target="_blank" rel="noreferrer">Resume link</a>}
              {!c.resumeFile && !c.resumeUrl && <span style={{ color: 'var(--text-4)' }}>None</span>}
              {canManage && <label className="btn-outline text-[11px] cursor-pointer">{uploading ? 'Uploading…' : c.resumeFile ? 'Replace' : 'Upload CV'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} /></label>}
            </div>
          </div>
          <Field label="Notes">
            <Textarea rows={3} value={notes} onChange={setNotes} />
          </Field>
          {canManage && notes !== (c.notes ?? '') && <button className="btn-primary text-[11px] self-start" onClick={() => onUpdate(c.id, { notes: notes.trim() || undefined })}>Save notes</button>}
        </div>
      )}

      {tab === 'interviews' && (
        <div className="flex flex-col gap-3 text-xs">
          {interviews.length === 0 && <p style={{ color: 'var(--text-4)' }}>No interviews scheduled</p>}
          {interviews.map(i => (
            <div key={i.id} className="rounded-lg p-2" style={{ border: '1px solid var(--border-lt)' }}>
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{new Date(i.scheduledAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })} · {i.mode.replace('_', ' ')} · {i.interviewer}</span>
                <span style={{ color: i.status === 'done' ? 'var(--success-text)' : i.status === 'cancelled' ? 'var(--text-4)' : 'var(--warning-text)' }}>{i.status}</span>
              </div>
              {i.location && <p style={{ color: 'var(--text-3)' }}>{i.location}</p>}
              {i.status === 'done' && <p className="mt-1"><Stars value={i.rating ?? null} /> {i.feedback && <span>· {i.feedback}</span>}</p>}
              {canManage && i.status === 'scheduled' && <InterviewResult onSave={(rating, feedback) => patchInterview(i.id, { status: 'done', rating, feedback })} onCancel={() => patchInterview(i.id, { status: 'cancelled' })} />}
            </div>
          ))}
          {canManage && !closed && (
            <div className="rounded-xl p-3 flex flex-col gap-2" style={{ border: '1px solid var(--border-lt)' }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Date and time"><Input type="datetime-local" value={iv.scheduledAt} onChange={v => setIv(p => ({ ...p, scheduledAt: v }))} /></Field>
                <Field label="Format"><Select value={iv.mode} onChange={v => setIv(p => ({ ...p, mode: v as CandidateInterview['mode'] }))} options={[{ value: 'in_person', label: 'In person' }, { value: 'video', label: 'Video call' }, { value: 'phone', label: 'Phone' }]} /></Field>
                <Field label="Interviewer"><Input value={iv.interviewer} onChange={v => setIv(p => ({ ...p, interviewer: v }))} /></Field>
                <Field label="Venue or link"><Input value={iv.location} onChange={v => setIv(p => ({ ...p, location: v }))} /></Field>
              </div>
              <button className="btn-primary text-[11px] self-start" onClick={addInterview}>Schedule interview</button>
            </div>
          )}
        </div>
      )}

      {tab === 'offer' && (
        <div className="flex flex-col gap-3 text-xs">
          {c.offer && (
            <p className="rounded-lg p-2" style={{ background: 'var(--bg-muted)' }}>
              Offered {fmtKes(c.offer.salary)} per month, starting {fmtDate(c.offer.startDate)} · {c.offer.status}
            </p>
          )}
          {canManage && !closed && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Monthly basic salary (KSh)"><Input type="number" value={offer.salary} onChange={v => setOffer(p => ({ ...p, salary: v }))} /></Field>
                <Field label="Start date"><Input type="date" value={offer.startDate} onChange={v => setOffer(p => ({ ...p, startDate: v }))} /></Field>
              </div>
              <Field label="Offer notes"><Textarea rows={2} value={offer.notes} onChange={v => setOffer(p => ({ ...p, notes: v }))} /></Field>
              <div className="flex gap-2">
                <button className="btn-primary text-[11px]" onClick={saveOffer}>{c.offer ? 'Update offer' : 'Record offer'}</button>
                {c.offer?.status === 'pending' && <button className="btn-outline text-[11px]" onClick={() => onUpdate(c.id, { offer: { ...c.offer!, status: 'declined' } })}>Candidate declined</button>}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

function InterviewResult({ onSave, onCancel }: { onSave: (rating: number, feedback: string) => void; onCancel: () => void }) {
  const [rating, setRating] = useState('3')
  const [feedback, setFeedback] = useState('')
  return (
    <div className="flex items-end gap-2 mt-2 flex-wrap">
      <Field label="Rating"><Select value={rating} onChange={setRating} options={[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} / 5` }))} /></Field>
      <div style={{ flex: 1, minWidth: 160 }}><Field label="Feedback"><Input value={feedback} onChange={setFeedback} /></Field></div>
      <button className="btn-primary text-[11px]" onClick={() => onSave(Number(rating), feedback.trim())}>Mark done</button>
      <button className="btn-outline text-[11px]" onClick={onCancel}>Cancel interview</button>
    </div>
  )
}

function RejectModal({ candidate, onClose, onConfirm }: { candidate: Candidate; onClose: () => void; onConfirm: (reason: string) => void }) {
  const { showToast } = useApp()
  const [reason, setReason] = useState('')
  return (
    <Modal title="Reject candidate" subtitle={`${candidate.firstName} ${candidate.lastName}`} onClose={onClose} width={420}>
      <Field label="Reason" required><Select value={reason} onChange={setReason} options={[{ value: '', label: 'Select reason…' }, ...REJECTION_REASONS.map(r => ({ value: r, label: r }))]} /></Field>
      <div className="hr-modal-actions flex justify-end gap-2 pt-3">
        <button className="btn-secondary px-4 py-2 text-xs" onClick={onClose}>Cancel</button>
        <button className="btn-primary px-4 py-2 text-xs" onClick={() => reason ? onConfirm(reason) : showToast('Choose a reason', 'error')}>Reject</button>
      </div>
    </Modal>
  )
}

function HireModal({ candidate, job, suggestedNo, onClose, onHire }: {
  candidate: Candidate; job?: JobPosting; suggestedNo: string; onClose: () => void
  onHire: (form: { employeeNo: string; startDate: string; salary: string; probationEndDate: string }) => Promise<void>
}) {
  const { showToast } = useApp()
  const [form, setForm] = useState({ employeeNo: suggestedNo, startDate: candidate.offer?.startDate || today(), salary: String(candidate.offer?.salary ?? ''), probationEndDate: '' })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (!form.employeeNo.trim() || !form.startDate) { showToast('Employee number and start date are required', 'error'); return }
    if (!(Number(form.salary) > 0)) { showToast('Enter the monthly basic salary', 'error'); return }
    setSaving(true)
    try { await onHire(form) } catch { /* addEmployee already shows the server error */ } finally { setSaving(false) }
  }
  return (
    <Modal title="Hire candidate" subtitle={`${candidate.firstName} ${candidate.lastName} · ${job?.title ?? 'Unknown job'}`} onClose={onClose} width={480}>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>This creates the employee record with an onboarding checklist. Add ID, KRA PIN, NSSF, SHIF and bank details from the employee profile afterwards.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Employee No." required><Input value={form.employeeNo} onChange={set('employeeNo')} /></Field>
        <Field label="Start date" required><Input type="date" value={form.startDate} onChange={set('startDate')} /></Field>
        <Field label="Monthly basic salary (KSh)" required><Input type="number" value={form.salary} onChange={set('salary')} /></Field>
        <Field label="Probation ends"><Input type="date" value={form.probationEndDate} onChange={set('probationEndDate')} /></Field>
      </div>
      <div className="hr-modal-actions flex justify-end gap-2 pt-3">
        <button className="btn-secondary px-4 py-2 text-xs" onClick={onClose}>Cancel</button>
        <button className="btn-primary px-4 py-2 text-xs" disabled={saving} onClick={submit}>{saving ? 'Creating…' : 'Create employee'}</button>
      </div>
    </Modal>
  )
}
