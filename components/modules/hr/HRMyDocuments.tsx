'use client'
import { useMemo } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { documentExpiry } from '@/lib/hr/document-status'

/** "My portal" card: documents HR has chosen to share with this employee (contract, certificates, permits). */
export default function HRMyDocuments() {
  const { currentUser } = useApp()
  const { employees, hrDocuments } = useHrStore()
  const me = employees.find(e => e.userId === currentUser?.id) ?? null
  const mine = useMemo(
    () => (me ? hrDocuments.filter(d => d.employeeId === me.id && d.visibility === 'employee_visible') : []),
    [hrDocuments, me],
  )
  if (!me || mine.length === 0) return null
  return (
    <div className="hr-my-documents card p-4">
      <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-1)' }}>My documents</h3>
      {mine.map(d => {
        const e = documentExpiry(d.expiryDate)
        return (
          <div key={d.id} className="flex items-center justify-between gap-3 py-2 text-xs" style={{ borderTop: '1px solid var(--border-lt)' }}>
            <div>
              <span className="font-semibold">{d.title}</span>
              <div style={{ color: 'var(--text-4)' }}>
                {d.type.replace(/_/g, ' ')}
                {d.expiryDate ? ` · ${e.status === 'expired' ? 'expired' : 'expires'} ${fmtDate(d.expiryDate)}` : ''}
              </div>
            </div>
            {d.fileName
              ? <a className="text-primary-600 hover:underline" href={`/api/hr-documents/${d.id}/file`} target="_blank" rel="noreferrer">View</a>
              : <span style={{ color: 'var(--text-4)' }}>No file</span>}
          </div>
        )
      })}
    </div>
  )
}
