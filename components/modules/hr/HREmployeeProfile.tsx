'use client'

import { useState } from 'react'
import { fmtDate } from '@/lib/store'
import type { Employee, HRDocument } from '@/lib/store'
import { documentExpiry } from '@/lib/hr/document-status'
import { initials } from '@/lib/utils'
import type { EmployeeSetup, SetupItem } from '@/lib/hr/employee-setup'
import HREmployeeSummary from './HREmployeeSummary'
import EmployeeLifecyclePanel from './HREmployeeLifecycle'

type Asset = { id: string; productName: string; serialNumber?: string; assignedDate?: string; acknowledgedByEmployee?: boolean }
type Section = 'overview' | 'lifecycle' | 'documents' | 'equipment'

const DOC_LABEL: Record<string, string> = { contract: 'Contract', nda: 'NDA', id_copy: 'ID copy', certification: 'Certificate', work_permit: 'Work permit', other: 'Other' }

/**
 * One person's page: whether their record is complete (each gap with the
 * button that fills it), the figures HR looks for, onboarding and exit,
 * their papers and their equipment.
 */
export default function HREmployeeProfile({
  employee, department, manager, documents, assets, setup, canManage, canSeePay,
  onBack, onEdit, onAddDocument, onIssueEquipment,
}: {
  employee: Employee
  department: string
  manager: string
  documents: HRDocument[]
  assets: Asset[]
  setup: EmployeeSetup
  canManage: boolean
  canSeePay: boolean
  onBack: () => void
  onEdit: () => void
  onAddDocument: (type: string) => void
  onIssueEquipment: () => void
}) {
  const [section, setSection] = useState<Section>(employee.status === 'exited' ? 'lifecycle' : 'overview')
  const docs = documents.filter(d => d.employeeId === employee.id)
  const exited = employee.status === 'exited'

  const action = (item: SetupItem) => {
    if (!canManage || item.done) return null
    if (item.key === 'details' || item.key === 'pay') return <button type="button" className="btn-outline text-[11px]" onClick={onEdit}>Fill in</button>
    if (item.key === 'id_copy') return <button type="button" className="btn-primary text-[11px]" onClick={() => onAddDocument('id_copy')}>Upload</button>
    if (item.key === 'contract') return <button type="button" className="btn-primary text-[11px]" onClick={() => onAddDocument('contract')}>Upload</button>
    if (item.key === 'tasks') return <button type="button" className="btn-outline text-[11px]" onClick={() => setSection('lifecycle')}>Open</button>
    if (item.key === 'equipment') return <button type="button" className="btn-outline text-[11px]" onClick={onIssueEquipment}>Issue</button>
    return null
  }

  return (
    <div className="hrp">
      <div className="hrp-head">
        <button type="button" className="hrp-back" onClick={onBack}>‹ People</button>
        <div className="hrp-id">
          <span className="hrp-av" aria-hidden="true">{initials(employee.fullName)}</span>
          <div className="min-w-0">
            <h2>{employee.fullName}</h2>
            <p>{[employee.jobTitle, department, manager ? `reports to ${manager}` : '', employee.employeeNo].filter(Boolean).join(' · ')}</p>
          </div>
          <span className={`hrp-chip ${exited ? 'is-off' : setup.complete ? 'is-ok' : 'is-warn'}`}>
            {exited ? `Left ${employee.exitDate ? fmtDate(employee.exitDate) : ''}`.trim() : setup.complete ? 'Record complete' : `Record ${setup.done}/${setup.total}`}
          </span>
        </div>
        <nav className="hrp-tabs" aria-label="Employee sections">
          {([
            ['overview', 'Overview'],
            ['lifecycle', exited ? 'Exit' : 'Onboarding & exit'],
            ['documents', `Documents ${docs.length}`],
            ['equipment', `Equipment ${assets.length}`],
          ] as Array<[Section, string]>).map(([id, label]) => (
            <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>
          ))}
          {canManage && <button type="button" className="hrp-edit" onClick={onEdit}>Edit details</button>}
        </nav>
      </div>

      {section === 'overview' && (
        <div className="hrp-grid">
          <section className="hrp-card">
            <header><b>{setup.complete ? 'Record complete' : 'To complete the record'}</b><small>{setup.done} of {setup.total} done</small></header>
            <ul className="hrp-checks">
              {setup.items.map(item => (
                <li key={item.key} className={item.done ? 'is-done' : ''}>
                  <span className="hrp-dot" aria-hidden="true">{item.done ? '✓' : ''}</span>
                  <div className="min-w-0"><b>{item.label}{item.required ? '' : ' (if needed)'}</b><small>{item.hint}</small></div>
                  {action(item)}
                </li>
              ))}
            </ul>
          </section>
          <section className="hrp-card">
            <header><b>At a glance</b></header>
            <div className="hrp-summary"><HREmployeeSummary employee={employee} documents={documents} canSeePay={canSeePay} /></div>
            <dl className="hrp-facts">
              <dt>Phone</dt><dd>{employee.phone || '—'}</dd>
              <dt>Work email</dt><dd>{employee.workEmail || '—'}</dd>
              <dt>Personal email</dt><dd>{employee.email || '—'}</dd>
              <dt>ID number</dt><dd>{employee.nationalId || '—'}</dd>
              <dt>KRA PIN</dt><dd>{employee.kraPin || '—'}</dd>
              <dt>NSSF</dt><dd>{employee.nssfNumber || '—'}</dd>
              <dt>SHIF</dt><dd>{employee.shift || '—'}</dd>
              <dt>Started</dt><dd>{employee.startDate ? fmtDate(employee.startDate) : '—'}</dd>
              {employee.probationEndDate && (<><dt>Probation ends</dt><dd>{fmtDate(employee.probationEndDate)}</dd></>)}
              <dt>Bank</dt><dd>{[employee.bankName, employee.bankAccount].filter(Boolean).join(' · ') || '—'}</dd>
            </dl>
          </section>
        </div>
      )}

      {section === 'lifecycle' && (
        <section className="hrp-card hrp-pad">
          <EmployeeLifecyclePanel key={employee.id} employee={employee} canManage={canManage} />
        </section>
      )}

      {section === 'documents' && (
        <section className="hrp-card">
          <header><b>Documents</b>{canManage && <button type="button" className="btn-primary text-[11px]" onClick={() => onAddDocument('')}>+ Add document</button>}</header>
          {docs.length === 0 ? <p className="hrp-empty">No documents on file yet. Start with the signed contract and an ID copy.</p> : (
            <ul className="hrp-rows">
              {docs.map(d => {
                const x = documentExpiry(d.expiryDate)
                return (
                  <li key={d.id}>
                    <div className="min-w-0"><b>{d.title}</b><small>{DOC_LABEL[d.type] ?? d.type}{d.fileName ? ` · ${d.fileName}` : ''}</small></div>
                    <span className={`hrp-chip ${x.status === 'expired' ? 'is-bad' : x.status === 'expiring' ? 'is-warn' : 'is-ok'}`}>
                      {d.expiryDate ? (x.status === 'expired' ? 'Expired' : `Until ${fmtDate(d.expiryDate)}`) : 'No expiry'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {section === 'equipment' && (
        <section className="hrp-card">
          <header><b>Equipment</b>{canManage && !exited && <button type="button" className="btn-primary text-[11px]" onClick={onIssueEquipment}>+ Issue equipment</button>}</header>
          {assets.length === 0 ? <p className="hrp-empty">Nothing issued.</p> : (
            <ul className="hrp-rows">
              {assets.map(a => (
                <li key={a.id}>
                  <div className="min-w-0"><b>{a.productName}</b><small>{[a.serialNumber, a.assignedDate ? `since ${fmtDate(a.assignedDate)}` : ''].filter(Boolean).join(' · ')}</small></div>
                  {exited
                    ? <span className="hrp-chip is-bad">To collect</span>
                    : <span className={`hrp-chip ${a.acknowledgedByEmployee ? 'is-ok' : 'is-warn'}`}>{a.acknowledgedByEmployee ? 'Acknowledged' : 'Not acknowledged'}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
