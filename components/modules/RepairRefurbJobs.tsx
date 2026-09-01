'use client'
import { useMemo } from 'react'
import { useRepair } from './repair/RepairContext'
import { RefurbStatus, fmtDate, fmtKes } from '@/lib/store'
import { Fa } from '@/components/icons'
import { StatePanel } from '@/components/ui'
import { useUrlUiState } from '@/hooks/useUrlRecordId'
import {
  faMicrochip,
  faCalendarAlt,
  faUser,
  faArrowRight,
  faInfoCircle,
  faSearch,
} from '@fortawesome/free-solid-svg-icons'

const REFURB_STATUS_META: Record<RefurbStatus, { label: string; tone: string }> = {
  queued:      { label: 'Queued',      tone: 'queued' },
  assigned:    { label: 'Assigned',    tone: 'assigned' },
  in_progress: { label: 'In progress', tone: 'progress' },
  ready:       { label: 'Ready',       tone: 'ready' },
  transferred: { label: 'Transferred', tone: 'neutral' },
  written_off: { label: 'Written off', tone: 'danger' },
}

const ACTIVE_COLUMNS: RefurbStatus[] = ['queued', 'assigned', 'in_progress', 'ready']

export default function RepairRefurbJobs({ onSelect }: { onSelect: (id: string) => void }) {
  const { refurbishmentJobs, currentUserId, currentUser } = useRepair()
  const [search, setSearch] = useUrlUiState('q', '')

  const isLeadTech = currentUser?.role === 'technical_lead' || currentUser?.role === 'director'
  const isAdmin = currentUser?.role === 'director' || currentUser?.role === 'admin_officer'
  const isRepairTech = currentUser?.role === 'technician'

  const jobs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return refurbishmentJobs
      .filter(j => (isLeadTech || isAdmin) ? true : j.assignedTechnicianId === currentUserId)
      .filter(j => !['transferred', 'written_off'].includes(j.status))
      .filter(j => {
        if (!query) return true
        return [j.ref, j.productName, j.serialNumber, j.assignedTechnicianName]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(query))
      })
  }, [refurbishmentJobs, isLeadTech, isAdmin, currentUserId, search])

  const byStatus = useMemo(() => ACTIVE_COLUMNS.reduce<Record<string, typeof jobs>>((acc, status) => {
    acc[status] = jobs.filter(job => job.status === status)
    return acc
  }, {}), [jobs])

  return (
    <div className="repair-refurb flex flex-col h-full">
      <header className="repair-refurb__header">
        <div className="repair-refurb__heading">
          <span className="repair-refurb__icon" aria-hidden="true"><Fa icon={faMicrochip} /></span>
          <div>
            <p>Refurbishment jobs</p>
            <span>{jobs.length} active job{jobs.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        {isRepairTech && <span className="repair-refurb__assignment">Assigned to you</span>}
      </header>

      <div className="repair-refurb__metrics" aria-label="Refurbishment workload">
        {ACTIVE_COLUMNS.map(status => (
          <div key={status}>
            <span>{REFURB_STATUS_META[status].label}</span>
            <strong>{byStatus[status]?.length ?? 0}</strong>
          </div>
        ))}
      </div>

      <div className="repair-refurb__toolbar">
        <label className="repair-refurb__search">
          <Fa icon={faSearch} aria-hidden="true" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search refurbishment jobs..."
            aria-label="Search refurbishment jobs"
          />
        </label>
        <span>{jobs.length} shown</span>
      </div>

      <div className="repair-refurb__content custom-scrollbar">
        {jobs.length === 0 ? (
          <StatePanel
            tone="empty"
            title="No refurbishment jobs"
            description={isRepairTech ? 'None assigned to you yet.' : 'No active refurbishment jobs match this view.'}
          />
        ) : (
          <div className="repair-refurb__board">
            {ACTIVE_COLUMNS.map(status => (
              <section className={`repair-refurb__column repair-refurb__column--${REFURB_STATUS_META[status].tone}`} key={status}>
                <div className="repair-refurb__column-head">
                  <div><span aria-hidden="true" /><strong>{REFURB_STATUS_META[status].label}</strong></div>
                  <b>{byStatus[status]?.length ?? 0}</b>
                </div>
                <div className="repair-refurb__cards">
                  {(byStatus[status] ?? []).map(j => {
                    const job = j as any
                    const source = job.sourceRef || job.source || job.originRef || 'Workshop intake'
                    const condition = job.condition || job.deviceCondition || 'Not assessed'
                    const target = job.target || job.refurbTarget || 'Inventory'
                    const value = Number(job.estimatedResaleValue || job.estimatedValue || 0)
                    return (
                      <button key={j.id} type="button" onClick={() => onSelect(j.id)} className="repair-refurb-card">
                        <div className="repair-refurb-card__top">
                          <span>{j.ref}</span>
                          <Fa icon={faArrowRight} aria-hidden="true" />
                        </div>
                        <h3 title={j.productName}>{j.productName}</h3>
                        <p className="repair-refurb-card__serial">{j.serialNumber || 'No serial recorded'}</p>
                        <dl>
                          <div><dt>Source</dt><dd>{source}</dd></div>
                          <div><dt>Condition</dt><dd>{condition}</dd></div>
                          <div><dt>Target</dt><dd>{target}</dd></div>
                          {value > 0 && <div><dt>Value</dt><dd>{fmtKes(value)}</dd></div>}
                        </dl>
                        <div className="repair-refurb-card__footer">
                          <span><Fa icon={faUser} aria-hidden="true" />{j.assignedTechnicianName || 'Unassigned'}</span>
                          <span><Fa icon={faCalendarAlt} aria-hidden="true" />{fmtDate(j.intakeDate)}</span>
                        </div>
                        {status === 'ready' && <span className="repair-refurb-card__action">Open to transfer</span>}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <footer className="repair-refurb__footer">
        <Fa icon={faInfoCircle} aria-hidden="true" />
        Open a job to manage tasks, valuation and inventory transfer.
      </footer>
    </div>
  )
}
