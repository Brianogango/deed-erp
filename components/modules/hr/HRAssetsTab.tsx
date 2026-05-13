'use client'
import { useState } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faLaptop, faPlus, faRotateLeft, faCheckCircle, faClock } from '@fortawesome/free-solid-svg-icons'

export default function HRAssetsTab() {
  const { employeeAssetAssignments, currentUser } = useApp()
  const isAdmin = currentUser?.role === 'admin'

  return (
    <div className="flex flex-col">
      <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between bg-[var(--bg-surface)]">
        <h3 className="text-sm font-bold text-[var(--text-1)]">Asset Assignments</h3>
        {isAdmin && (
          <button className="btn-primary py-1.5 px-4 text-[10px] flex items-center gap-2">
            <Fa icon={faPlus} />
            <span>Assign Asset</span>
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] border-b border-[var(--border-lt)]">
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assigned Date</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-lt)]">
            {employeeAssetAssignments.length > 0 ? (
              employeeAssetAssignments.map(a => (
                <tr key={a.id} className="hover:bg-[var(--bg-surface)] transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-xs font-bold text-[var(--text-1)]">{a.employeeName}</p>
                    <p className="text-[10px] text-[var(--text-4)]">ID: {a.employeeId.slice(0, 8)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Fa icon={faLaptop} className="text-[var(--text-4)]" />
                      <div>
                        <p className="text-xs font-bold text-[var(--text-1)]">{a.productName}</p>
                        {a.serialNumber && <p className="text-[10px] text-[var(--text-4)]">SN: {a.serialNumber}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {a.status === 'assigned' ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          <Fa icon={faClock} className="text-[8px]" />
                          ASSIGNED
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                          <Fa icon={faCheckCircle} className="text-[8px]" />
                          RETURNED
                        </span>
                      )}
                      {a.acknowledgedByEmployee && (
                        <span className="text-[8px] font-black text-green-600">ACKNOWLEDGED</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-3)]">
                    {fmtDate(a.assignedDate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {a.status === 'assigned' && isAdmin && (
                        <button className="p-1.5 text-[var(--text-4)] hover:text-primary-600 transition-colors" title="Return Asset">
                          <Fa icon={faRotateLeft} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-20 text-center">
                  <div className="text-4xl mb-4">💻</div>
                  <h4 className="text-sm font-bold text-[var(--text-1)]">No Assets Assigned</h4>
                  <p className="text-xs text-[var(--text-4)] max-w-xs mx-auto mt-1">
                    Track company property assigned to employees including laptops, phones, and tools.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
