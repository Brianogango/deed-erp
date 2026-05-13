'use client'
import { useState, useMemo } from 'react'
import { useApp, fmtKes } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faChartLine, faBullseye, faTrophy, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'

export default function HRPerformanceTab() {
  const { hrPerfTargets, employees, isAdmin } = useApp()

  const stats = useMemo(() => {
    const total = hrPerfTargets.length
    const achieved = hrPerfTargets.filter(t => t.status === 'achieved').length
    const atRisk = hrPerfTargets.filter(t => t.status === 'at_risk').length
    return { total, achieved, atRisk }
  }, [hrPerfTargets])

  return (
    <div className="flex flex-col">
      <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary-50 text-primary-600 flex items-center justify-center text-xl">
            <Fa icon={faBullseye} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider">Active Targets</p>
            <h3 className="text-xl font-black text-[var(--text-1)]">{stats.total}</h3>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center text-xl">
            <Fa icon={faTrophy} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider">Achieved</p>
            <h3 className="text-xl font-black text-[var(--text-1)]">{stats.achieved}</h3>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center text-xl">
            <Fa icon={faTriangleExclamation} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-[var(--text-4)] uppercase tracking-wider">At Risk</p>
            <h3 className="text-xl font-black text-[var(--text-1)]">{stats.atRisk}</h3>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Performance Overview</h3>
          {isAdmin && (
            <button className="btn-primary py-1.5 px-4 text-[10px]">Set New Target</button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4">
          {hrPerfTargets.length > 0 ? (
            hrPerfTargets.map(t => {
              const pct = Math.min(100, Math.round((t.currentValue / t.targetValue) * 100))
              const color = t.status === 'achieved' ? 'bg-green-500' : t.status === 'at_risk' ? 'bg-red-500' : 'bg-primary-500'
              
              return (
                <div key={t.id} className="card p-5 hover:border-primary-500/30 transition-all">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--bg-muted)] flex items-center justify-center font-bold text-xs text-[var(--text-2)]">
                        {t.employeeName.slice(0, 1)}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-[var(--text-1)]">{t.employeeName}</h4>
                        <p className="text-[10px] text-[var(--text-4)]">{t.metric} · {t.periodLabel}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        t.status === 'achieved' ? 'bg-green-100 text-green-700' : 
                        t.status === 'at_risk' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {t.status.replace('_', ' ')}
                      </span>
                      <p className="text-[10px] text-[var(--text-4)] mt-1">Due {t.dueDate}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold">
                      <span className="text-[var(--text-2)]">
                        {t.unit === 'KSh' ? fmtKes(t.currentValue) : `${t.currentValue} ${t.unit}`}
                      </span>
                      <span className="text-[var(--text-4)]">
                        Target: {t.unit === 'KSh' ? fmtKes(t.targetValue) : `${t.targetValue} ${t.unit}`}
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${color} transition-all duration-500`} 
                        style={{ width: `${pct}%` }} 
                      />
                    </div>
                    <p className="text-[10px] text-[var(--text-3)] italic">"{t.description}"</p>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="py-20 text-center card border-dashed">
              <div className="text-4xl mb-4">📈</div>
              <h4 className="text-sm font-bold text-[var(--text-1)]">No Performance Targets</h4>
              <p className="text-xs text-[var(--text-4)] max-w-xs mx-auto mt-1">
                Establish performance goals and track employee progress directly from this dashboard.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
