'use client'
import { useCrmStore, OpportunityStage, fmtKes } from '@/lib/store'
import { STAGE_ORDER, STAGE_COLORS, STAGE_LABELS } from './crm-config'

interface Props {
  effectiveOwner: string
  stageLabels: Record<OpportunityStage, string>
  onSelectOpp: (id: string) => void
}

export default function PipelineKanban({ effectiveOwner, stageLabels, onSelectOpp }: Props) {
  const { opportunities, quotes, opportunityActivities, systemSettings } = useCrmStore()

  return (
    <div className="flex gap-3 overflow-x-auto pb-3" style={{ minHeight: 'calc(100vh - 280px)' }}>
      {STAGE_ORDER.filter(stage => stage !== 'on_hold').map(stage => {
        const stageOpps = opportunities.filter(o =>
          o.stage === stage &&
          (effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner)
        )
        const stageWeighted = stageOpps.reduce((sum, o) => sum + (o.expectedValue * o.probability / 100), 0)

        return (
          <div key={stage} className="flex-shrink-0" style={{ width: 300 }}>
            <div className="rounded-xl mb-2 overflow-hidden"
              style={{ border: `1px solid ${STAGE_COLORS[stage]}35`, background: STAGE_COLORS[stage] + '10' }}>
              <div className="px-3 py-2.5 flex items-center justify-between"
                style={{ borderLeft: `4px solid ${STAGE_COLORS[stage]}` }}>
                <div>
                  <div className="text-[11px] font-bold" style={{ color: STAGE_COLORS[stage] }}>
                    {stageLabels[stage]?.toUpperCase() ?? STAGE_LABELS[stage].toUpperCase()}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: '#6B7280' }}>
                    {stageOpps.length} deal{stageOpps.length !== 1 ? 's' : ''} · {fmtKes(stageWeighted)} weighted
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: STAGE_COLORS[stage], color: '#fff',
                }}>{stageOpps.length}</span>
              </div>
            </div>

            <div className="space-y-2" style={{ maxHeight: 'calc(100vh - 360px)', overflowY: 'auto', paddingRight: 4 }}>
              {stageOpps.map(opp => {
                const oppQuotes = quotes.filter(q => (opp.quoteIds ?? []).includes(q.id))
                const daysOpen = Math.round((new Date().getTime() - new Date(opp.createdDate ?? opp.createdAt).getTime()) / (1000 * 60 * 60 * 24))
                const hasScheduledActivity = opportunityActivities.some(a => a.opportunityId === opp.id && a.status === 'scheduled')
                const noActivityWarning = systemSettings.crmEnforceNextActivity && !hasScheduledActivity
                
                return (
                  <div
                    key={opp.id}
                    className="card p-3 cursor-pointer"
                    style={{ borderLeft: `3px solid ${STAGE_COLORS[stage]}`, transition: 'box-shadow 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                    onClick={() => onSelectOpp(opp.id)}
                  >
                    <div className="text-xs font-semibold leading-snug mb-0.5" style={{ color: '#111827' }}>{opp.name}</div>
                    <div className="text-[10px] mb-2.5 font-medium" style={{ color: '#6B7280' }}>{opp.companyName}</div>

                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs font-bold" style={{ color: '#111827' }}>{fmtKes(opp.expectedValue)}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: STAGE_COLORS[stage] + '18', color: STAGE_COLORS[stage] }}>{opp.probability}%</span>
                    </div>

                    <div className="rounded-full h-1 overflow-hidden mb-2.5" style={{ background: '#F3F4F6' }}>
                      <div className="h-full rounded-full" style={{ width: `${opp.probability}%`, background: STAGE_COLORS[stage] }} />
                    </div>

                    <div className="flex items-center justify-between text-[10px]" style={{ color: '#9CA3AF' }}>
                      <div className="flex items-center gap-1">
                        <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-white text-[7px] font-bold" style={{ background: '#4F46E5', flexShrink: 0 }}>
                          {(opp.ownerName ?? '?').slice(0, 1).toUpperCase()}
                        </div>
                        <span className="truncate">{(opp.ownerName ?? '').split(' ')[0]}</span>
                      </div>
                      <span>{daysOpen}d open</span>
                    </div>

                    {oppQuotes.length > 0 && (
                      <div className="mt-2 pt-1.5 text-[9px] flex items-center gap-1" style={{ color: '#6B7280', borderTop: '1px solid #F3F4F6' }}>
                        <span style={{ color: '#4F46E5', fontWeight: 700 }}>📋</span>{oppQuotes.length} quote{oppQuotes.length > 1 ? 's' : ''} · {oppQuotes[0].quoteNumber}
                      </div>
                    )}
                    {(opp.tags?.length ?? 0) > 0 && <div className="flex items-center gap-1 mt-1.5 flex-wrap">{opp.tags?.slice(0, 2).map(tag => <span key={tag} style={{ fontSize: 8, fontWeight: 600, padding: '1px 5px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280' }}>{tag}</span>)}</div>}
                    {noActivityWarning && <div className="mt-2 text-[9px] font-semibold px-2 py-1 rounded-lg flex items-center gap-1" style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>⚠ No next activity</div>}
                  </div>
                )
              })}
              {stageOpps.length === 0 && <div className="text-center text-[10px] py-8" style={{ color: 'var(--text-4)' }}>No opportunities</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}