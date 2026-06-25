'use client'
import { useState } from 'react'
import { useApp, fmtDate, type CandidateStage, type JobPosting } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faPlus, faBriefcase, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import { Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'

type JobForm = {
  title: string
  departmentId: string
  location: string
  type: JobPosting['type']
  status: JobPosting['status']
  closingDate: string
  description: string
}

type CandidateForm = {
  jobId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  stage: CandidateStage
  resumeUrl: string
  notes: string
}

const emptyJobForm = (departmentId = ''): JobForm => ({
  title: '',
  departmentId,
  location: '',
  type: 'full_time',
  status: 'open',
  closingDate: '',
  description: '',
})

const emptyCandidateForm = (jobId = ''): CandidateForm => ({
  jobId,
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  stage: 'applied',
  resumeUrl: '',
  notes: '',
})

export default function HRRecruitmentTab() {
  const { jobPostings, candidates, departments, currentUser, addJobPosting, addCandidate, showToast } = useApp()
  const isAdmin = currentUser?.role === 'director'
  const [subTab, setSubTab] = useState<'jobs' | 'candidates'>('jobs')
  const [showJobModal, setShowJobModal] = useState(false)
  const [showCandidateModal, setShowCandidateModal] = useState(false)
  const [jobForm, setJobForm] = useState<JobForm>(() => emptyJobForm(departments[0]?.id ?? ''))
  const [candidateForm, setCandidateForm] = useState<CandidateForm>(() => emptyCandidateForm(jobPostings.find(j => j.status === 'open')?.id ?? jobPostings[0]?.id ?? ''))

  const departmentOptions = departments.map(d => ({ value: d.id, label: d.name }))
  const jobOptions = jobPostings.map(j => ({ value: j.id, label: `${j.title} (${j.status})` }))

  const openCreate = () => {
    if (subTab === 'jobs') {
      setJobForm(emptyJobForm(departments[0]?.id ?? ''))
      setShowJobModal(true)
      return
    }
    setCandidateForm(emptyCandidateForm(jobPostings.find(j => j.status === 'open')?.id ?? jobPostings[0]?.id ?? ''))
    setShowCandidateModal(true)
  }

  const submitJob = () => {
    const title = jobForm.title.trim()
    const location = jobForm.location.trim()
    const description = jobForm.description.trim()
    if (!title) { showToast('Job title is required', 'error'); return }
    if (!jobForm.departmentId) { showToast('Select a department for this posting', 'error'); return }
    if (!location) { showToast('Job location is required', 'error'); return }
    if (!description) { showToast('Job description is required', 'error'); return }

    addJobPosting({
      title,
      departmentId: jobForm.departmentId,
      location,
      type: jobForm.type,
      status: jobForm.status,
      closingDate: jobForm.closingDate || undefined,
      description,
    })
    setShowJobModal(false)
  }

  const submitCandidate = () => {
    const firstName = candidateForm.firstName.trim()
    const lastName = candidateForm.lastName.trim()
    const email = candidateForm.email.trim()
    const phone = candidateForm.phone.trim()
    if (!candidateForm.jobId) { showToast('Create or select a job posting before adding a candidate', 'error'); return }
    if (!firstName || !lastName) { showToast('Candidate first and last name are required', 'error'); return }
    if (!email) { showToast('Candidate email is required', 'error'); return }
    if (!phone) { showToast('Candidate phone number is required', 'error'); return }

    addCandidate({
      jobId: candidateForm.jobId,
      firstName,
      lastName,
      email,
      phone,
      stage: candidateForm.stage,
      resumeUrl: candidateForm.resumeUrl.trim() || undefined,
      notes: candidateForm.notes.trim() || undefined,
    })
    setShowCandidateModal(false)
  }

  type Candidate = typeof candidates[number]

  const candidateColumns: ColumnDef<Candidate>[] = [
    {
      key: 'candidate', label: 'Candidate', priority: 1, width: '1.4fr',
      render: c => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xs">
            {c.firstName[0]}{c.lastName[0]}
          </div>
          <div>
            <p className="text-xs font-bold text-[var(--text-1)]">{c.firstName} {c.lastName}</p>
            <p className="text-[10px] text-[var(--text-4)]">{c.email}</p>
          </div>
        </div>
      ),
      exportValue: c => `${c.firstName} ${c.lastName}`,
    },
    {
      key: 'stage', label: 'Stage', priority: 1, width: '120px',
      render: c => <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 capitalize">{c.stage}</span>,
      exportValue: c => c.stage,
    },
    {
      key: 'job', label: 'Job Applied', priority: 2, width: '160px',
      render: c => <span className="text-xs text-[var(--text-2)]">{jobPostings.find(j => j.id === c.jobId)?.title || 'Unknown Job'}</span>,
      exportValue: c => jobPostings.find(j => j.id === c.jobId)?.title || 'Unknown Job',
    },
    {
      key: 'appliedDate', label: 'Applied Date', priority: 2, width: '110px',
      render: c => <span className="text-xs text-[var(--text-3)]">{fmtDate(c.appliedDate)}</span>,
      exportValue: c => c.appliedDate,
    },
  ]

  return (
    <div className="flex flex-col">
      <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between bg-[var(--bg-surface)]">
        <div className="flex gap-4">
          <button 
            onClick={() => setSubTab('jobs')}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${subTab === 'jobs' ? 'bg-primary-500 text-white' : 'text-[var(--text-3)] hover:bg-[var(--bg-muted)]'}`}
          >
            Job Postings
          </button>
          <button 
            onClick={() => setSubTab('candidates')}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${subTab === 'candidates' ? 'bg-primary-500 text-white' : 'text-[var(--text-3)] hover:bg-[var(--bg-muted)]'}`}
          >
            Candidates
          </button>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary py-1.5 px-4 text-[10px] flex items-center gap-2">
            <Fa icon={faPlus} />
            <span>{subTab === 'jobs' ? 'New Posting' : 'Add Candidate'}</span>
          </button>
        )}
      </div>

      <div className="p-4">
        {subTab === 'jobs' ? (
          <div className="grid grid-cols-1 gap-4">
            {jobPostings.length > 0 ? (
              jobPostings.map(j => (
                <div key={j.id} className="card p-4 flex items-center justify-between hover:border-primary-500/30 transition-all cursor-pointer group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center">
                      <Fa icon={faBriefcase} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-1)]">{j.title}</h4>
                      <p className="text-[10px] text-[var(--text-4)] uppercase font-semibold tracking-wider">
                        {departments.find(d => d.id === j.departmentId)?.name ?? j.departmentId} · {j.type.replace('_', ' ')} · {j.location}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${j.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {j.status.toUpperCase()}
                      </span>
                      <p className="text-[10px] text-[var(--text-4)] mt-1">Posted {fmtDate(j.postedDate)}</p>
                    </div>
                    <Fa icon={faChevronRight} className="text-[var(--text-4)] group-hover:text-primary-500 transition-colors" />
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center">
                <p className="text-sm text-[var(--text-4)]">No job postings found</p>
              </div>
            )}
          </div>
        ) : (
          <DataTable
            tableId="hr_candidates"
            columns={candidateColumns}
            rows={candidates}
            rowKey={c => c.id}
            emptyMessage="No candidates found"
            rowActions={() => <Fa icon={faChevronRight} className="text-[var(--text-4)]" />}
            exportTitle="Candidates"
            exportFilename="candidates"
          />
        )}
      </div>

      {showJobModal && (
        <Modal title="New Job Posting" subtitle="Create a recruitment posting and sync it to the server" onClose={() => setShowJobModal(false)} width={620}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Job Title" required><Input autoFocus value={jobForm.title} onChange={title => setJobForm(p => ({ ...p, title }))} placeholder="e.g. Sales Executive" /></Field>
            <Field label="Department" required><Select value={jobForm.departmentId} onChange={departmentId => setJobForm(p => ({ ...p, departmentId }))} options={departmentOptions.length ? departmentOptions : [{ value: '', label: 'No departments available' }]} /></Field>
            <Field label="Location" required><Input value={jobForm.location} onChange={location => setJobForm(p => ({ ...p, location }))} placeholder="e.g. Nairobi" /></Field>
            <Field label="Employment Type"><Select value={jobForm.type} onChange={type => setJobForm(p => ({ ...p, type: type as JobPosting['type'] }))} options={[{ value: 'full_time', label: 'Full Time' }, { value: 'part_time', label: 'Part Time' }, { value: 'contract', label: 'Contract' }]} /></Field>
            <Field label="Status"><Select value={jobForm.status} onChange={status => setJobForm(p => ({ ...p, status: status as JobPosting['status'] }))} options={[{ value: 'open', label: 'Open' }, { value: 'draft', label: 'Draft' }, { value: 'closed', label: 'Closed' }]} /></Field>
            <Field label="Closing Date"><Input type="date" value={jobForm.closingDate} onChange={closingDate => setJobForm(p => ({ ...p, closingDate }))} /></Field>
          </div>
          <Field label="Description" required><Textarea rows={5} value={jobForm.description} onChange={description => setJobForm(p => ({ ...p, description }))} placeholder="Summarize the role, requirements, and expectations." /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setShowJobModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={submitJob}>Save Posting</button>
          </div>
        </Modal>
      )}

      {showCandidateModal && (
        <Modal title="Add Candidate" subtitle="Register a candidate against a job posting and sync it to the server" onClose={() => setShowCandidateModal(false)} width={620}>
          <Field label="Job Posting" required><Select value={candidateForm.jobId} onChange={jobId => setCandidateForm(p => ({ ...p, jobId }))} options={jobOptions.length ? jobOptions : [{ value: '', label: 'No job postings available' }]} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="First Name" required><Input autoFocus value={candidateForm.firstName} onChange={firstName => setCandidateForm(p => ({ ...p, firstName }))} /></Field>
            <Field label="Last Name" required><Input value={candidateForm.lastName} onChange={lastName => setCandidateForm(p => ({ ...p, lastName }))} /></Field>
            <Field label="Email" required><Input type="email" value={candidateForm.email} onChange={email => setCandidateForm(p => ({ ...p, email }))} /></Field>
            <Field label="Phone" required><Input value={candidateForm.phone} onChange={phone => setCandidateForm(p => ({ ...p, phone }))} /></Field>
            <Field label="Stage"><Select value={candidateForm.stage} onChange={stage => setCandidateForm(p => ({ ...p, stage: stage as CandidateStage }))} options={[{ value: 'applied', label: 'Applied' }, { value: 'screening', label: 'Screening' }, { value: 'interview', label: 'Interview' }, { value: 'offered', label: 'Offered' }, { value: 'hired', label: 'Hired' }, { value: 'rejected', label: 'Rejected' }]} /></Field>
            <Field label="Resume URL"><Input value={candidateForm.resumeUrl} onChange={resumeUrl => setCandidateForm(p => ({ ...p, resumeUrl }))} placeholder="Optional link" /></Field>
          </div>
          <Field label="Notes"><Textarea value={candidateForm.notes} onChange={notes => setCandidateForm(p => ({ ...p, notes }))} placeholder="Optional screening notes." /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary px-4 py-2 text-xs" onClick={() => setShowCandidateModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-xs" onClick={submitCandidate}>Save Candidate</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
