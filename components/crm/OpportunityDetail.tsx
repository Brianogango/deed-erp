'use client'
import { useCrmStore, OpportunityStage, fmtKes, fmtDate } from '@/lib/store'
import { Badge, PanelHeader, Select } from '@/components/ui'
import LeadScore from './LeadScore'
import { STAGE_ORDER, STAGE_COLORS, STAGE_LABELS } from './crm-config'

interface Props {
  activeOppId: string
  onClose: () => void
  stageLabels: Record<OpportunityStage, string>
  onMarkWon: () => void
  onMarkLost: () => void
  onLogActivity: () => void
}

export default function OpportunityDetail({
  activeOppId, onClose, stageLabels,
  onMarkWon, onMarkLost, onLogActivity
}: Props) {
  const { opportunities, companies, contactPersons, quotes, opportunityActivities, moveOpportunityStage } = useCrmStore()
  const activeOpp = opportunities.find(o => o.id === activeOppId)

  if (!activeOpp) return null

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="card px-4 py-3 flex items-center gap-3" style={{ borderLeft: `4px solid ${STAGE_COLORS[activeOpp.stage] ?? 'var(--text-4)'}` }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--text-4)' }}>{activeOpp.ref ?? activeOpp.id.slice(0, 8)}</span>
            <Badge status={activeOpp.stage} label={stageLabels[activeOpp.stage] ?? STAGE_LABELS[activeOpp.stage]} />
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: (STAGE_COLORS[activeOpp.stage] ?? 'var(--text-4)') + '18', color: STAGE_COLORS[activeOpp.stage] ?? 'var(--text-4)',
            }}>{activeOpp.probability}% confidence</span>
          </div>
          <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-1)' }}>{activeOpp.name}</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        {/* Left Column */}
        <div className="flex flex-col gap-3">
          {/* Opportunity Details */}
          <div className="card p-4">
            <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid var(--bg-muted)' }}>
              <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#4F46E5' }} />
              <p className="text-xs font-bold" style={{ color: '#4F46E5' }}>{activeOpp.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Company</div>
                <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{activeOpp.companyName ?? companies.find(c => c.id === activeOpp.clientId)?.name ?? ''}</div>
                <div style={{ color: 'var(--text-3)' }}>
                  {companies.find(c => c.id === activeOpp.clientId)?.segment}
                </div>
              </div>
              <LeadScore opportunity={activeOpp} company={companies.find(c => c.id === activeOpp.clientId)} contactPerson={contactPersons.find(cp => cp.id === activeOpp.contactPersonId)} />
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Contact Person</div>
                <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{activeOpp.contactPersonName ?? (() => { const cp = contactPersons.find(c => c.id === activeOpp.contactPersonId); return cp ? `${cp.firstName} ${cp.lastName}` : '' })()}</div>
                <div style={{ color: 'var(--text-3)' }}>
                  {contactPersons.find(cp => cp.id === activeOpp.contactPersonId)?.jobTitle}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Expected Value</div>
                <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 14 }}>
                  {fmtKes(activeOpp.expectedValue)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Expected Close</div>
                <div style={{ color: 'var(--text-1)' }}>{fmtDate(activeOpp.expectedCloseDate ?? '')}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Owner</div>
                <div style={{ color: 'var(--text-1)' }}>{activeOpp.ownerName ?? activeOpp.assignedTo?.name ?? ''}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Lead Source</div>
                <div style={{ color: 'var(--text-1)' }}>
                  {activeOpp.leadSource?.replace('_', ' ') ?? ''}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 4, fontSize: 11 }}>Description</div>
                <div style={{ color: 'var(--text-1)', fontSize: 12, lineHeight: 1.6 }}>
                  {activeOpp.description}
                </div>
              </div>
              {activeOpp.customerNeeds && (
                <div>
                  <div style={{ color: 'var(--text-3)', marginBottom: 4, fontSize: 11 }}>Customer Needs</div>
                  <div style={{ color: 'var(--text-1)', fontSize: 12, lineHeight: 1.6 }}>
                    {activeOpp.customerNeeds}
                  </div>
                </div>
              )}
              {activeOpp.competitorInfo && (
                <div>
                  <div style={{ color: 'var(--text-3)', marginBottom: 4, fontSize: 11 }}>Competitor Info</div>
                  <div style={{ color: 'var(--text-1)', fontSize: 12, lineHeight: 1.6 }}>
                    {activeOpp.competitorInfo}
                  </div>
                </div>
              )}
            </div>

            {(activeOpp.tags?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {activeOpp.tags?.map(tag => (
                  <span key={tag} className="badge badge-gray text-[10px]">{tag}</span>
                ))}
              </div>
            )}
          </div>

          {/* Quotes */}
          <div className="card overflow-hidden">
            <PanelHeader title="Quotes" count={quotes.filter(q => (activeOpp.quoteIds ?? []).includes(q.id)).length} />
            <div className="p-3 flex flex-col gap-2">
              {quotes.filter(q => (activeOpp.quoteIds ?? []).includes(q.id)).map(quote => (
                <div key={quote.id} className="rounded-lg p-3 flex items-start justify-between gap-3"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>{quote.quoteNumber}</span>
                      {quote.version && <span className="text-[9px] font-medium px-1 rounded" style={{ background: 'var(--bg-muted)', color: 'var(--text-3)' }}>v{quote.version}</span>}
                      <Badge status={quote.status} size="xs" />
                    </div>
                    <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                      {fmtDate(quote.issueDate ?? quote.quoteDate)} – {fmtDate(quote.validUntil ?? '')}
                      {quote.sentDate && <span> · Sent {fmtDate(quote.sentDate)}</span>}
                      {(quote.viewCount ?? 0) > 0 && <span> · Viewed {quote.viewCount}×</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{fmtKes(quote.totalAmount)}</div>
                    <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-4)' }}>{quote.items?.length ?? 0} line{(quote.items?.length ?? 0) !== 1 ? 's' : ''}</div>
                  </div>
                </div>
              ))}
              {(activeOpp.quoteIds?.length ?? 0) === 0 && (
                <div className="text-center py-5 text-xs" style={{ color: 'var(--text-4)' }}>
                  No quotes linked. Create one in the Sales module.
                </div>
              )}
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="card overflow-hidden">
            <PanelHeader title="Activity Timeline">
              <button 
                className="btn-primary text-[11px]" 
                onClick={onLogActivity}
              >
                + Log Activity
              </button>
            </PanelHeader>
            <div className="p-4 space-y-3">
              {opportunityActivities
                .filter(a => a.opportunityId === activeOpp.id)
                .sort((a, b) => (b.createdDate ?? b.createdAt).localeCompare(a.createdDate ?? a.createdAt))
                .map(activity => {
                  const icon = {
                    call: '📞', email: '📧', meeting: '🤝', demo: '🎯',
                    proposal: '📋', note: '📝', task: '✅',
                  }[activity.type]

                  return (
                    <div key={activity.id} className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                      <div className="flex items-start gap-3">
                        <span style={{ fontSize: 18 }}>{icon}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                              {activity.subject ?? activity.type}
                            </span>
                            {activity.status && <Badge status={activity.status} label={activity.status === 'completed' ? '✓' : '⏳'} size="xs" />}
                          </div>
                          <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                            {activity.type.toUpperCase()} · {activity.createdByName ?? ''} · {fmtDate(activity.createdDate ?? activity.createdAt)}
                          </div>
                          {activity.description && (
                            <div className="text-[11px] mt-2" style={{ color: 'var(--text-1)' }}>
                              {activity.description}
                            </div>
                          )}
                          {activity.outcome && (
                            <div className="text-[10px] mt-1 p-2 rounded-lg" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                              Outcome: {activity.outcome}
                            </div>
                          )}
                          {activity.status === 'scheduled' && (activity.scheduledDate ?? activity.scheduledAt) && (
                            <div className="text-[10px] mt-1" style={{ color: 'var(--warning)' }}>
                              ⏰ Scheduled: {fmtDate(activity.scheduledDate ?? activity.scheduledAt ?? '')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              
              {opportunityActivities.filter(a => a.opportunityId === activeOpp.id).length === 0 && (
                <div className="text-center text-[10px] py-6" style={{ color: 'var(--text-4)' }}>
                  No activities logged yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Actions */}
        <div className="flex flex-col gap-3">
          {/* Stage Management */}
          <div className="card p-4">
            <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid var(--bg-muted)' }}>
              <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#4F46E5' }} />
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#4F46E5' }}>Pipeline Stage</p>
            </div>
            <Select
              value={activeOpp.stage}
              onChange={(value) => moveOpportunityStage(activeOpp.id, value as OpportunityStage)}
              options={STAGE_ORDER.map(stage => ({
                value: stage,
                label: stageLabels[stage] ?? STAGE_LABELS[stage],
              }))}
            />
            <div className="mt-3 text-[10px]" style={{ color: 'var(--text-3)' }}>
              Probability auto-adjusts based on stage
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card p-4">
            <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid var(--bg-muted)' }}>
              <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--success)' }} />
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--success-text)' }}>Quick Actions</p>
            </div>
            <div className="space-y-2">
              <button className="btn-primary w-full text-[11px]" onClick={onMarkWon}>Mark as Won 🎉</button>
              <button className="btn-outline w-full text-[11px]" style={{ color: '#F04438' }} onClick={onMarkLost}>Mark as Lost</button>
              <button className="btn-outline w-full text-[11px]" onClick={onLogActivity}>+ Log Activity</button>
            </div>
          </div>

          {/* Company Info */}
          <div className="card p-4">
            <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid var(--bg-muted)' }}>
              <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--primary)' }} />
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--primary-dark)' }}>Company Details</p>
            </div>
            {companies.find(c => c.id === activeOpp.clientId) && (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-3)' }}>Segment</span>
                  <span style={{ color: 'var(--text-1)' }}>
                    {companies.find(c => c.id === activeOpp.clientId)?.segment}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-3)' }}>Payment Terms</span>
                  <span style={{ color: 'var(--text-1)' }}>
                    {companies.find(c => c.id === activeOpp.clientId)?.paymentTerms} days
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-3)' }}>Credit Limit</span>
                  <span style={{ color: 'var(--text-1)' }}>
                    {fmtKes(companies.find(c => c.id === activeOpp.clientId)?.creditLimit ?? 0)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Contact Info */}
          <div className="card p-4">
            <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid var(--bg-muted)' }}>
              <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--warning)' }} />
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--warning-text)' }}>Contact Details</p>
            </div>
            {contactPersons.find(cp => cp.id === activeOpp.contactPersonId) && (
              <div className="space-y-2 text-xs">
                {(() => {
                  const contact = contactPersons.find(cp => cp.id === activeOpp.contactPersonId)!
                  return (
                    <>
                      <div style={{ color: 'var(--text-1)' }}>{contact.email}</div>
                      <div style={{ color: 'var(--text-1)' }}>{contact.phone}</div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {contact.isPrimary && <span className="badge badge-blue text-[9px]">Primary</span>}
                        {contact.isDecisionMaker && <span className="badge badge-green text-[9px]">Decision Maker</span>}
                        {contact.isTechnicalContact && <span className="badge badge-purple text-[9px]">Technical</span>}
                        {contact.isBillingContact && <span className="badge badge-amber text-[9px]">Billing</span>}
                      </div>
                      <div style={{ color: 'var(--text-3)', marginTop: 8 }}>
                        Prefers: {contact.preferredChannel}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
          {/* Timeline Stats */}
          <div className="card p-4">
            <div className="text-xs space-y-2">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-3)' }}>Created</span>
                <span style={{ color: 'var(--text-1)' }}>{fmtDate(activeOpp.createdDate ?? activeOpp.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-3)' }}>Days Open</span>
                <span style={{ color: 'var(--text-1)' }}>
                  {Math.round((new Date().getTime() - new Date(activeOpp.createdDate ?? activeOpp.createdAt).getTime()) / (1000 * 60 * 60 * 24))} days
                </span>
              </div>
              {activeOpp.lastActivityDate && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-3)' }}>Last Activity</span>
                  <span style={{ color: 'var(--text-1)' }}>{fmtDate(activeOpp.lastActivityDate)}</span>
                </div>
              )}
              {activeOpp.actualCloseDate && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-3)' }}>Closed</span>
                  <span style={{ color: 'var(--text-1)' }}>{fmtDate(activeOpp.actualCloseDate)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Win/Loss Info */}
          {activeOpp.stage === 'closed_won' && (
            <div className="card p-4" style={{ background: 'var(--success-bg)', borderColor: '#A7F3D0' }}>
              <div style={{ color: 'var(--success)', fontWeight: 700, marginBottom: 8 }}>🎉 Deal Won!</div>
              <div className="text-xs" style={{ color: 'var(--text-1)' }}>
                <div className="font-semibold text-sm mb-2">{fmtKes(activeOpp.actualValue ?? 0)}</div>
                <div>Closed: {fmtDate(activeOpp.actualCloseDate!)}</div>
              </div>
            </div>
          )}

          {activeOpp.stage === 'closed_lost' && (
            <div className="card p-4" style={{ background: 'var(--danger-bg)', borderColor: '#FECACA' }}>
              <div style={{ color: 'var(--danger)', fontWeight: 700, marginBottom: 8 }}>Deal Lost</div>
              <div className="text-xs space-y-1" style={{ color: 'var(--text-1)' }}>
                {activeOpp.lostReason && <div>Reason: {activeOpp.lostReason}</div>}
                {activeOpp.lostToCompetitor && <div>Lost to: {activeOpp.lostToCompetitor}</div>}
                <div style={{ color: 'var(--text-3)' }}>Closed: {fmtDate(activeOpp.actualCloseDate!)}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}