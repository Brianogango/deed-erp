'use client'

import { useMemo } from 'react'
import type { CustomerContract, OpportunityActivity } from '@/lib/store'

interface SLADashboardProps {
  contracts: CustomerContract[]
  activities: OpportunityActivity[]
  companyId?: string
}

interface SLAMetrics {
  tier: string
  responseTarget: number // hours
  resolutionTarget: number // hours
  averageResponseTime: number // hours
  averageResolutionTime: number // hours
  responseCompliance: number // percentage
  resolutionCompliance: number // percentage
  totalTickets: number
  openTickets: number
}

const SERVICE_TIER_COLORS: Record<string, string> = {
  bronze: '#92400E',
  silver: '#6B7280',
  gold: '#B45309',
  platinum: '#7C3AED',
}

const TIER_LABELS: Record<string, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
}

export default function SLADashboard({
  contracts,
  activities,
  companyId,
}: SLADashboardProps) {
  const activeContracts = useMemo(() => {
    return contracts.filter(c =>
      c.status === 'active' &&
      (!companyId || c.companyId === companyId)
    )
  }, [contracts, companyId])

  const slaMetrics = useMemo(() => {
    const metrics: Record<string, SLAMetrics> = {}

    activeContracts.forEach(contract => {
      const tier = contract.slaTier ?? 'silver'

      if (!metrics[tier]) {
        metrics[tier] = {
          tier,
          responseTarget: contract.responseTimeHours ?? 4,
          resolutionTarget: contract.resolutionTimeHours ?? 24,
          averageResponseTime: 0,
          averageResolutionTime: 0,
          responseCompliance: 0,
          resolutionCompliance: 0,
          totalTickets: 0,
          openTickets: 0,
        }
      }

      const companyActivities = activities.filter(a => a.opportunityId)

      metrics[tier].totalTickets += companyActivities.length
      metrics[tier].openTickets += companyActivities.filter(a => !a.completedDate).length

      const avgResponse = 3 // hours (simulated)
      const avgResolution = 18 // hours (simulated)

      metrics[tier].averageResponseTime = avgResponse
      metrics[tier].averageResolutionTime = avgResolution

      const responseTarget = contract.responseTimeHours ?? 4
      const resolutionTarget = contract.resolutionTimeHours ?? 24

      metrics[tier].responseCompliance = (avgResponse <= responseTarget)
        ? 95
        : Math.max(0, 100 - ((avgResponse - responseTarget) / responseTarget * 100))

      metrics[tier].resolutionCompliance = (avgResolution <= resolutionTarget)
        ? 92
        : Math.max(0, 100 - ((avgResolution - resolutionTarget) / resolutionTarget * 100))
    })

    return Object.values(metrics)
  }, [activeContracts, activities])

  const overallCompliance = useMemo(() => {
    if (slaMetrics.length === 0) return 0
    const total = slaMetrics.reduce((sum, m) => sum + m.responseCompliance + m.resolutionCompliance, 0)
    return Math.round(total / (slaMetrics.length * 2))
  }, [slaMetrics])

  const getComplianceColor = (compliance: number) => {
    if (compliance >= 95) return '#10B981'
    if (compliance >= 85) return '#F59E0B'
    if (compliance >= 75) return '#F97316'
    return '#EF4444'
  }

  const getComplianceIcon = (compliance: number) => {
    if (compliance >= 95) return '✓'
    if (compliance >= 85) return '⚠'
    return '✗'
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Overall Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-2xl font-bold text-t1">{activeContracts.length}</p>
          <p className="text-xs text-t3 mt-1">Active SLA Contracts</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold" style={{ color: getComplianceColor(overallCompliance) }}>
              {overallCompliance}%
            </p>
            <span className="text-xl">{getComplianceIcon(overallCompliance)}</span>
          </div>
          <p className="text-xs text-t3 mt-1">Overall Compliance</p>
        </div>

        <div className="card p-4">
          <p className="text-2xl font-bold text-t1">
            {slaMetrics.reduce((sum, m) => sum + m.totalTickets, 0)}
          </p>
          <p className="text-xs text-t3 mt-1">Total Tickets</p>
        </div>

        <div className="card p-4">
          <p className="text-2xl font-bold" style={{ color: 'var(--warning)' }}>
            {slaMetrics.reduce((sum, m) => sum + m.openTickets, 0)}
          </p>
          <p className="text-xs text-t3 mt-1">Open Tickets</p>
        </div>
      </div>

      {/* Tier Breakdown */}
      <h3 className="text-sm font-semibold text-t1">SLA Performance by Tier</h3>

      {slaMetrics.length === 0 ? (
        <div className="card py-12 text-center text-xs text-t3">
          No active SLA contracts found
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {slaMetrics.map(metric => (
            <div key={metric.tier} className="card p-4">
              {/* Tier Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                    background: (SERVICE_TIER_COLORS[metric.tier] ?? 'var(--text-4)') + '18',
                    color: SERVICE_TIER_COLORS[metric.tier] ?? 'var(--text-4)',
                    border: `1px solid ${(SERVICE_TIER_COLORS[metric.tier] ?? 'var(--text-4)')}40`,
                  }}>
                    {TIER_LABELS[metric.tier] ?? metric.tier.toUpperCase()}
                  </span>
                  <span className="text-xs text-t3">
                    {metric.totalTickets} tickets · {metric.openTickets} open
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-t3">Compliance:</span>
                  <span className="text-lg font-bold" style={{ color: getComplianceColor((metric.responseCompliance + metric.resolutionCompliance) / 2) }}>
                    {Math.round((metric.responseCompliance + metric.resolutionCompliance) / 2)}%
                  </span>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* Response Time */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-t3">Response Time</span>
                    <span className="text-xs font-semibold" style={{ color: getComplianceColor(metric.responseCompliance) }}>
                      {getComplianceIcon(metric.responseCompliance)} {Math.round(metric.responseCompliance)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-lt)' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${metric.responseCompliance}%`, background: getComplianceColor(metric.responseCompliance) }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-t3 mt-1">
                    <span>Avg: <strong className="text-t1">{metric.averageResponseTime}h</strong></span>
                    <span>Target: <strong className="text-t1">{metric.responseTarget}h</strong></span>
                  </div>
                </div>

                {/* Resolution Time */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-t3">Resolution Time</span>
                    <span className="text-xs font-semibold" style={{ color: getComplianceColor(metric.resolutionCompliance) }}>
                      {getComplianceIcon(metric.resolutionCompliance)} {Math.round(metric.resolutionCompliance)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-lt)' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${metric.resolutionCompliance}%`, background: getComplianceColor(metric.resolutionCompliance) }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-t3 mt-1">
                    <span>Avg: <strong className="text-t1">{metric.averageResolutionTime}h</strong></span>
                    <span>Target: <strong className="text-t1">{metric.resolutionTarget}h</strong></span>
                  </div>
                </div>
              </div>

              {(metric.responseCompliance < 85 || metric.resolutionCompliance < 85) && (
                <div className="mt-3 p-3 rounded-xl flex items-start gap-2 text-xs" style={{ background: 'var(--danger-bg)', border: '1px solid #FCA5A5' }}>
                  <span>⚠️</span>
                  <div style={{ color: 'var(--danger)' }}>
                    <strong>SLA At Risk:</strong> Performance below target. Immediate action required.
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-t1 mb-3">Performance Indicators</p>
        <div className="grid grid-cols-4 gap-3 text-[10px]">
          {[
            { color: '#10B981', label: '≥ 95% — Excellent' },
            { color: '#F59E0B', label: '85–94% — Good' },
            { color: '#F97316', label: '75–84% — At Risk' },
            { color: '#EF4444', label: '< 75% — Critical' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ background: color }} />
              <span className="text-t3">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
