'use client'
import { useState } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faPlus, faBriefcase, faUserTie, faChevronRight } from '@fortawesome/free-solid-svg-icons'

export default function HRRecruitmentTab() {
  const { jobPostings, candidates, currentUser } = useApp()
  const isAdmin = currentUser?.role === 'admin'
  const [subTab, setSubTab] = useState<'jobs' | 'candidates'>('jobs')

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
          <button className="btn-primary py-1.5 px-4 text-[10px] flex items-center gap-2">
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
                        {j.departmentId} · {j.type.replace('_', ' ')} · {j.location}
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
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] border-b border-[var(--border-lt)]">
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Job Applied</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Applied Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-lt)]">
                {candidates.length > 0 ? (
                  candidates.map(c => {
                    const job = jobPostings.find(j => j.id === c.jobId)
                    return (
                      <tr key={c.id} className="hover:bg-[var(--bg-surface)] transition-colors cursor-pointer">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xs">
                              {c.firstName[0]}{c.lastName[0]}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-[var(--text-1)]">{c.firstName} {c.lastName}</p>
                              <p className="text-[10px] text-[var(--text-4)]">{c.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--text-2)]">
                          {job?.title || 'Unknown Job'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 capitalize">
                            {c.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--text-3)]">
                          {fmtDate(c.appliedDate)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button className="text-[var(--text-4)] hover:text-primary-600">
                            <Fa icon={faChevronRight} />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-sm text-[var(--text-4)]">
                      No candidates found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
