'use client'
import { useState } from 'react'
import { useApp, OpportunityStage, LeadSource, fmtKes, fmtDate } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Textarea, StatCard, PanelHeader } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faChartBar, faMoneyBillWave, faArrowTrendUp, faBullseye, faCircleCheck } from '@fortawesome/free-solid-svg-icons'

type Tab = 'pipeline' | 'opportunities' | 'companies' | 'contacts' | 'activities' | 'contracts' | 'sla'
type View = 'kanban' | 'list' | 'detail'

const STAGE_ORDER: OpportunityStage[] = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost']

const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospecting: 'Prospecting',
  qualification: 'Qualification',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Won',
  closed_lost: 'Lost',
  on_hold: 'On Hold',
}

const STAGE_COLORS: Record<OpportunityStage, string> = {
  prospecting: 'var(--text-3)',
  qualification: '#2E90FA',
  proposal: '#F59E0B',
  negotiation: '#8B5CF6',
  closed_won: '#12B76A',
  closed_lost: '#F04438',
  on_hold: 'var(--text-3)',
}

const LEAD_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'website', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'email_campaign', label: 'Email Campaign' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'trade_show', label: 'Trade Show' },
  { value: 'partner', label: 'Partner' },
  { value: 'existing_customer', label: 'Existing Customer' },
  { value: 'walk_in', label: 'Walk-in' },
]

export default function CRM() {
  const {
    companies, contactPersons, opportunities, opportunityActivities, quotes, customerContracts, users, currentUserId,
    createCompany, updateCompany, deleteCompany,
    createContactPerson, updateContactPerson, deleteContactPerson,
    createOpportunity, updateOpportunity, moveOpportunityStage, markOpportunityWon, markOpportunityLost, deleteOpportunity,
    logActivity, completeActivity,
    createCustomerContract, renewCustomerContract, terminateCustomerContract,
    showToast, systemSettings,
  } = useApp()

  // Dynamic stage labels from settings (positionally mapped to STAGE_ORDER)
  const stageLabels: Record<OpportunityStage, string> = Object.fromEntries(
    STAGE_ORDER.map((s, i) => [s, systemSettings.crmPipelineStages[i] ?? STAGE_LABELS[s]])
  ) as Record<OpportunityStage, string>

  const [tab, setTab] = useState<Tab>('pipeline')
  const [view, setView] = useState<View>('kanban')
  const [activeOppId, setActiveOppId] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<string>('me')
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null)

  // Search states
  const [oppSearch, setOppSearch] = useState('')
  const [companySearch, setCompanySearch] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [contractSearch, setContractSearch] = useState('')
  const [activitySearch, setActivitySearch] = useState('')
  
  // Modals
  const [showNewOppModal, setShowNewOppModal] = useState(false)
  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false)
  const [showNewContactModal, setShowNewContactModal] = useState(false)
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [showWinModal, setShowWinModal] = useState(false)
  const [showLostModal, setShowLostModal] = useState(false)

  // Forms
  const [oppForm, setOppForm] = useState({
    name: '',
    companyId: '',
    companyName: '',
    contactPersonId: '',
    contactPersonName: '',
    expectedValue: '',
    expectedCloseDate: '',
    leadSource: 'website' as LeadSource,
    description: '',
    customerNeeds: '',
    tags: '',
  })

  const [companyForm, setCompanyForm] = useState({
    name: '',
    taxId: '',
    industry: '',
    email: '',
    phone: '',
    website: '',
    physicalAddress: '',
    city: '',
    country: 'Kenya',
    paymentTerms: '30',
    creditLimit: '1000000',
    segment: 'sme' as const,
    tags: '',
  })

  const [contactForm, setContactForm] = useState({
    companyId: '',
    companyName: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    department: '',
    email: '',
    phone: '',
    mobile: '',
    isPrimary: false,
    isDecisionMaker: false,
    isBillingContact: false,
    isTechnicalContact: false,
    preferredChannel: 'email' as const,
    linkedIn: '',
    notes: '',
  })

  const [activityForm, setActivityForm] = useState<{
    opportunityId: string
    type: 'call' | 'email' | 'meeting' | 'demo' | 'proposal' | 'note' | 'task'
    subject: string
    description: string
    outcome: string
    scheduledDate: string
    status: 'completed' | 'scheduled'
  }>({
    opportunityId: '',
    type: 'call',
    subject: '',
    description: '',
    outcome: '',
    scheduledDate: '',
    status: 'completed',
  })

  const [winForm, setWinForm] = useState({
    opportunityId: '',
    actualValue: '',
  })

  const [lostForm, setLostForm] = useState({
    opportunityId: '',
    reason: '',
    competitor: '',
  })

  const [contractForm, setContractForm] = useState({
    companyId: '',
    companyName: '',
    contactPersonId: '',
    contactPersonName: '',
    type: 'sales' as const,
    contractValue: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    renewalDate: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    noticePeriod: '30',
    paymentSchedule: 'monthly' as const,
    autoRenewal: false,
    slaTier: 'silver' as const,
    notes: '',
  })

  const [showContractModal, setShowContractModal] = useState(false)

  const currentUser = users.find(u => u.id === currentUserId)
  const activeOpp = opportunities.find(o => o.id === activeOppId)
  const activeCompany = companies.find(c => c.id === activeCompanyId)

  // Pipeline metrics — scoped to owner filter
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'finance'
  // sales_rep always sees only their own; admin can switch between 'me' / 'all' / a specific userId
  const effectiveOwner = !isAdmin ? currentUserId! : (ownerFilter === 'me' ? currentUserId! : ownerFilter)

  const pipelineOpps = opportunities.filter(o =>
    !['closed_won', 'closed_lost'].includes(o.stage) &&
    (effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner)
  )
  const totalPipelineValue = pipelineOpps.reduce((sum, o) => sum + o.expectedValue, 0)
  const weightedPipelineValue = pipelineOpps.reduce((sum, o) => sum + (o.expectedValue * o.probability / 100), 0)

  const wonOpps = opportunities.filter(o =>
    o.stage === 'closed_won' && (effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner)
  )
  const lostOpps = opportunities.filter(o =>
    o.stage === 'closed_lost' && (effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner)
  )
  const totalClosed = wonOpps.length + lostOpps.length
  const winRate = totalClosed > 0 ? Math.round((wonOpps.length / totalClosed) * 100) : 0

  // Per-rep breakdown (admin only)
  const salesReps = users.filter(u => u.role === 'sales_rep' || opportunities.some(o => o.ownerId === u.id))
  const repBreakdown = salesReps.map(rep => {
    const repOpps = opportunities.filter(o => !['closed_won', 'closed_lost'].includes(o.stage) && o.ownerId === rep.id)
    return {
      id: rep.id,
      name: rep.name,
      count: repOpps.length,
      value: repOpps.reduce((s, o) => s + o.expectedValue, 0),
      weighted: repOpps.reduce((s, o) => s + o.expectedValue * o.probability / 100, 0),
    }
  }).filter(r => r.count > 0).sort((a, b) => b.value - a.value)

  const stats = {
    totalPipeline: pipelineOpps.length,
    pipelineValue: totalPipelineValue,
    weightedValue: weightedPipelineValue,
    wonThisMonth: wonOpps.filter(o => o.actualCloseDate?.startsWith('2026-04')).length,
    winRate,
  }

  // Handlers
  const handleCreateOpportunity = () => {
    if (!oppForm.name || !oppForm.companyId || !oppForm.contactPersonId) {
      showToast('Name, company, and contact person are required', 'error')
      return
    }

    const opp = createOpportunity({
      name: oppForm.name,
      companyId: oppForm.companyId,
      companyName: oppForm.companyName,
      contactPersonId: oppForm.contactPersonId,
      contactPersonName: oppForm.contactPersonName,
      ownerId: currentUserId!,
      ownerName: currentUser!.name,
      stage: 'prospecting',
      probability: 10,
      expectedValue: Number(oppForm.expectedValue) || 0,
      expectedCloseDate: oppForm.expectedCloseDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      leadSource: oppForm.leadSource,
      description: oppForm.description,
      customerNeeds: oppForm.customerNeeds,
      tags: oppForm.tags.split(',').map(t => t.trim()).filter(Boolean),
    })

    setShowNewOppModal(false)
    setOppForm({
      name: '',
      companyId: '',
      companyName: '',
      contactPersonId: '',
      contactPersonName: '',
      expectedValue: '',
      expectedCloseDate: '',
      leadSource: 'website',
      description: '',
      customerNeeds: '',
      tags: '',
    })
    setActiveOppId(opp.id)
  }

  const handleCreateCompany = () => {
    if (!companyForm.name || !companyForm.taxId || !companyForm.email || !companyForm.phone) {
      showToast('Name, tax ID, email, and phone are required', 'error')
      return
    }

    const company = createCompany({
      name: companyForm.name,
      taxId: companyForm.taxId,
      industry: companyForm.industry,
      email: companyForm.email,
      phone: companyForm.phone,
      website: companyForm.website,
      physicalAddress: companyForm.physicalAddress,
      city: companyForm.city,
      country: companyForm.country,
      paymentTerms: Number(companyForm.paymentTerms) || 30,
      creditLimit: Number(companyForm.creditLimit) || 0,
      accountManagerId: currentUserId ?? undefined,
      accountManagerName: currentUser?.name ?? undefined,
      tags: companyForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      segment: companyForm.segment,
      status: 'active',
      kycStatus: 'pending',
    })

    setShowNewCompanyModal(false)
    setCompanyForm({
      name: '',
      taxId: '',
      industry: '',
      email: '',
      phone: '',
      website: '',
      physicalAddress: '',
      city: '',
      country: 'Kenya',
      paymentTerms: '30',
      creditLimit: '1000000',
      segment: 'sme',
      tags: '',
    })
    setActiveCompanyId(company.id)
  }

  const handleCreateContact = () => {
    if (!contactForm.companyId || !contactForm.firstName || !contactForm.lastName || !contactForm.email) {
      showToast('Company, name, and email are required', 'error')
      return
    }

    const contact = createContactPerson({
      companyId: contactForm.companyId,
      companyName: contactForm.companyName,
      firstName: contactForm.firstName,
      lastName: contactForm.lastName,
      jobTitle: contactForm.jobTitle,
      department: contactForm.department,
      email: contactForm.email,
      phone: contactForm.phone,
      mobile: contactForm.mobile,
      isPrimary: contactForm.isPrimary,
      isDecisionMaker: contactForm.isDecisionMaker,
      isBillingContact: contactForm.isBillingContact,
      isTechnicalContact: contactForm.isTechnicalContact,
      preferredChannel: contactForm.preferredChannel,
      linkedIn: contactForm.linkedIn,
      notes: contactForm.notes,
    })

    setShowNewContactModal(false)
    setContactForm({
      companyId: '',
      companyName: '',
      firstName: '',
      lastName: '',
      jobTitle: '',
      department: '',
      email: '',
      phone: '',
      mobile: '',
      isPrimary: false,
      isDecisionMaker: false,
      isBillingContact: false,
      isTechnicalContact: false,
      preferredChannel: 'email',
      linkedIn: '',
      notes: '',
    })
  }

  const handleLogActivity = () => {
    if (!activityForm.opportunityId || !activityForm.subject) {
      showToast('Opportunity and subject are required', 'error')
      return
    }

    logActivity({
      opportunityId: activityForm.opportunityId,
      type: activityForm.type,
      subject: activityForm.subject,
      description: activityForm.description,
      outcome: activityForm.outcome,
      scheduledDate: activityForm.scheduledDate,
      status: activityForm.status,
    })

    setShowActivityModal(false)
    setActivityForm({
      opportunityId: '',
      type: 'call',
      subject: '',
      description: '',
      outcome: '',
      scheduledDate: '',
      status: 'completed',
    })
  }

  const handleMarkWon = () => {
    if (!winForm.opportunityId) return
    markOpportunityWon(winForm.opportunityId, Number(winForm.actualValue) || 0)
    setShowWinModal(false)
    setWinForm({ opportunityId: '', actualValue: '' })
  }

  const handleMarkLost = () => {
    if (!lostForm.opportunityId || !lostForm.reason) {
      showToast('Reason is required', 'error')
      return
    }
    markOpportunityLost(lostForm.opportunityId, lostForm.reason, lostForm.competitor)
    setShowLostModal(false)
    setLostForm({ opportunityId: '', reason: '', competitor: '' })
  }

  const handleCreateContract = () => {
    if (!contractForm.companyId || !contractForm.contactPersonId || !contractForm.contractValue) {
      showToast('Company, contact and contract value are required', 'error')
      return
    }

    const slaMap = {
      bronze: { response: 48, resolution: 120 },
      silver: { response: 24, resolution: 72 },
      gold: { response: 4, resolution: 24 },
      platinum: { response: 1, resolution: 8 },
    }

    const sla = slaMap[contractForm.slaTier]

    createCustomerContract({
      companyId: contractForm.companyId,
      companyName: contractForm.companyName,
      contactPersonId: contractForm.contactPersonId,
      contactPersonName: contractForm.contactPersonName,
      type: contractForm.type,
      contractValue: Number(contractForm.contractValue),
      startDate: contractForm.startDate,
      endDate: contractForm.endDate,
      renewalDate: contractForm.renewalDate,
      noticePeriod: Number(contractForm.noticePeriod),
      paymentSchedule: contractForm.paymentSchedule,
      autoRenewal: contractForm.autoRenewal,
      slaTier: contractForm.slaTier,
      responseTimeHours: sla.response,
      resolutionTimeHours: sla.resolution,
      status: 'active',
      saleOrderIds: [],
      invoiceIds: [],
      notes: contractForm.notes,
    })

    setShowContractModal(false)
    setContractForm({
      companyId: '',
      companyName: '',
      contactPersonId: '',
      contactPersonName: '',
      type: 'sales',
      contractValue: '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      renewalDate: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      noticePeriod: '30',
      paymentSchedule: 'monthly',
      autoRenewal: false,
      slaTier: 'silver',
      notes: '',
    })
  }

  const moduleHeader = (
    <div className="flex-shrink-0" style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #3730A3 100%)' }}>
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' }}>
            <Fa icon={faChartBar} style={{ fontSize: 14, color: '#fff' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">CRM &amp; Pipeline</h2>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {pipelineOpps.length} active · {companies.length} {companies.length === 1 ? 'company' : 'companies'} · {fmtKes(totalPipelineValue)} pipeline
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {tab === 'pipeline' && view !== 'detail' && (
            <>
              {(['kanban', 'list'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: '5px 11px', borderRadius: 7, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  background: view === v ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)',
                  color: '#fff', border: '1px solid rgba(255,255,255,0.18)', transition: 'all 0.15s', textTransform: 'capitalize',
                }}>{v}</button>
              ))}
              <button onClick={() => setShowNewOppModal(true)} style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)',
              }}>+ Opportunity</button>
            </>
          )}
          {tab === 'pipeline' && view === 'detail' && (
            <button onClick={() => setView('kanban')} style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
            }}>← Back to Pipeline</button>
          )}
          {tab === 'companies' && (
            <button onClick={() => setShowNewCompanyModal(true)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)',
            }}>+ Company</button>
          )}
          {tab === 'contacts' && (
            <button onClick={() => setShowNewContactModal(true)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)',
            }}>+ Contact</button>
          )}
          {tab === 'contracts' && (
            <button onClick={() => setShowContractModal(true)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)',
            }}>+ Contract</button>
          )}
        </div>
      </div>
      <div className="flex items-center px-3" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        {([
          { id: 'pipeline'   as Tab, label: 'Pipeline' },
          { id: 'companies'  as Tab, label: 'Companies' },
          { id: 'contacts'   as Tab, label: 'Contacts' },
          { id: 'activities' as Tab, label: 'Activities' },
          { id: 'contracts'  as Tab, label: 'Contracts' },
        ]).map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); if (t.id === 'pipeline') setView('kanban') }}
            style={{
              padding: '8px 14px', fontSize: 11, fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${tab === t.id ? '#fff' : 'transparent'}`,
              color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.55)',
              transition: 'all 0.15s', whiteSpace: 'nowrap',
            }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )

  // Pipeline Tab - Kanban Board
  if (tab === 'pipeline') {
    return (
      <div className="flex flex-col" style={{ background: '#F4F6FA', minHeight: '100%' }}>
        {moduleHeader}
        <div className="flex flex-col gap-4 p-5" style={{ flex: 1 }}>
        {/* pipeline content start */}
        {/* Owner filter (admin/finance only) */}
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap px-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#6B7280' }}>Viewing:</span>
            {[{ id: 'me', label: 'My Pipeline' }, { id: 'all', label: 'All Reps' }, ...salesReps.map(r => ({ id: r.id, label: r.name }))].map(opt => (
              <button key={opt.id} onClick={() => setOwnerFilter(opt.id)}
                style={{
                  fontSize: 11, padding: '5px 13px', borderRadius: 20, cursor: 'pointer',
                  background: ownerFilter === opt.id ? '#EEF2FF' : '#F9FAFB',
                  border: `1px solid ${ownerFilter === opt.id ? '#C7D2FE' : '#E5E7EB'}`,
                  color: ownerFilter === opt.id ? '#4F46E5' : '#6B7280', fontWeight: ownerFilter === opt.id ? 700 : 400,
                  transition: 'all 0.15s',
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="kpi-grid">
          <StatCard label="Active Pipeline"   value={stats.totalPipeline}        sub={isAdmin && ownerFilter === 'all' ? 'all reps' : 'my deals'}  color="#8B5CF6" icon={<Fa icon={faChartBar} />} />
          <StatCard label="Pipeline Value"    value={fmtKes(stats.pipelineValue)} sub="total expected"         color="#3B82F6" icon={<Fa icon={faMoneyBillWave} />} />
          <StatCard label="Weighted Forecast" value={fmtKes(stats.weightedValue)} sub="probability-adjusted"   color="#F59E0B" icon={<Fa icon={faArrowTrendUp} />} />
          <StatCard label="Won This Month"    value={stats.wonThisMonth}          sub="closed deals"           color="#10B981" icon={<Fa icon={faBullseye} />} />
          <StatCard label="Win Rate"          value={`${stats.winRate}%`}         sub="overall conversion"     color="#1B2762" icon={<Fa icon={faCircleCheck} />} />
        </div>

        {/* Per-rep breakdown (admin, all-reps view) */}
        {isAdmin && ownerFilter === 'all' && repBreakdown.length > 0 && (
          <div className="card p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 pb-2 mb-1" style={{ borderBottom: '1px solid #F3F4F6' }}>
              <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#4F46E5' }} />
              <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#4F46E5' }}>Pipeline Value by Rep</p>
            </div>
            {repBreakdown.map(rep => (
              <div key={rep.id} className="flex items-center gap-3">
                <button className="text-[11px] font-medium text-t1 w-32 text-left truncate hover:underline"
                  onClick={() => setOwnerFilter(rep.id)}>
                  {rep.name}
                </button>
                <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                  <div className="h-full rounded-full" style={{
                    width: `${totalPipelineValue > 0 ? Math.round(rep.value / totalPipelineValue * 100) : 0}%`,
                    background: '#3B82F6',
                  }} />
                </div>
                <span className="font-mono text-[11px] font-semibold text-t1 w-28 text-right">{fmtKes(rep.value)}</span>
                <span className="text-[10px] text-t3 w-20 text-right">{rep.count} deal{rep.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        )}

        {/* Kanban Board */}
        {view === 'kanban' && (
          <div className="flex gap-3 overflow-x-auto pb-3" style={{ minHeight: 'calc(100vh - 280px)' }}>
            {STAGE_ORDER.filter(stage => stage !== 'on_hold').map(stage => {
              const stageOpps = opportunities.filter(o =>
                o.stage === stage &&
                (effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner)
              )
              const stageValue = stageOpps.reduce((sum, o) => sum + o.expectedValue, 0)
              const stageWeighted = stageOpps.reduce((sum, o) => sum + (o.expectedValue * o.probability / 100), 0)

              return (
                <div key={stage} className="flex-shrink-0" style={{ width: 300 }}>
                  <div className="rounded-xl mb-2 overflow-hidden"
                    style={{ border: `1px solid ${STAGE_COLORS[stage]}35`, background: STAGE_COLORS[stage] + '10' }}>
                    <div className="px-3 py-2.5 flex items-center justify-between"
                      style={{ borderLeft: `4px solid ${STAGE_COLORS[stage]}` }}>
                      <div>
                        <div className="text-[11px] font-bold" style={{ color: STAGE_COLORS[stage] }}>
                          {stageLabels[stage].toUpperCase()}
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
                      const company = companies.find(c => c.id === opp.companyId)
                      const contact = contactPersons.find(cp => cp.id === opp.contactPersonId)
                      const oppQuotes = quotes.filter(q => opp.quoteIds.includes(q.id))
                      const daysOpen = Math.round((new Date().getTime() - new Date(opp.createdDate).getTime()) / (1000 * 60 * 60 * 24))
                      const hasScheduledActivity = opportunityActivities.some(a => a.opportunityId === opp.id && a.status === 'scheduled')
                      const noActivityWarning = systemSettings.crmEnforceNextActivity && !hasScheduledActivity
                      
                      return (
                        <div
                          key={opp.id}
                          className="card p-3 cursor-pointer"
                          style={{ borderLeft: `3px solid ${STAGE_COLORS[stage]}`, transition: 'box-shadow 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                          onClick={() => { setActiveOppId(opp.id); setView('detail') }}
                        >
                          <div className="text-xs font-semibold leading-snug mb-0.5" style={{ color: '#111827' }}>
                            {opp.name}
                          </div>
                          <div className="text-[10px] mb-2.5 font-medium" style={{ color: '#6B7280' }}>
                            {opp.companyName}
                          </div>

                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono text-xs font-bold" style={{ color: '#111827' }}>
                              {fmtKes(opp.expectedValue)}
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                              style={{ background: STAGE_COLORS[stage] + '18', color: STAGE_COLORS[stage] }}>
                              {opp.probability}%
                            </span>
                          </div>

                          <div className="rounded-full h-1 overflow-hidden mb-2.5" style={{ background: '#F3F4F6' }}>
                            <div className="h-full rounded-full"
                              style={{ width: `${opp.probability}%`, background: STAGE_COLORS[stage] }} />
                          </div>

                          <div className="flex items-center justify-between text-[10px]" style={{ color: '#9CA3AF' }}>
                            <div className="flex items-center gap-1">
                              <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-white text-[7px] font-bold"
                                style={{ background: '#4F46E5', flexShrink: 0 }}>
                                {opp.ownerName.slice(0, 1).toUpperCase()}
                              </div>
                              <span className="truncate">{opp.ownerName.split(' ')[0]}</span>
                            </div>
                            <span>{daysOpen}d open</span>
                          </div>

                          {oppQuotes.length > 0 && (
                            <div className="mt-2 pt-1.5 text-[9px] flex items-center gap-1" style={{ color: '#6B7280', borderTop: '1px solid #F3F4F6' }}>
                              <span style={{ color: '#4F46E5', fontWeight: 700 }}>📋</span>
                              {oppQuotes.length} quote{oppQuotes.length > 1 ? 's' : ''} · {oppQuotes[0].ref}
                            </div>
                          )}

                          {opp.tags.length > 0 && (
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              {opp.tags.slice(0, 2).map(tag => (
                                <span key={tag} style={{
                                  fontSize: 8, fontWeight: 600, padding: '1px 5px', borderRadius: 20,
                                  background: '#F3F4F6', color: '#6B7280',
                                }}>{tag}</span>
                              ))}
                            </div>
                          )}

                          {noActivityWarning && (
                            <div className="mt-2 text-[9px] font-semibold px-2 py-1 rounded-lg flex items-center gap-1"
                              style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
                              ⚠ No next activity
                            </div>
                          )}
                        </div>
                      )
                    })}
                    
                    {stageOpps.length === 0 && (
                      <div className="text-center text-[10px] py-8" style={{ color: 'var(--text-4)' }}>
                        No opportunities
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* List View */}
        {view === 'list' && (
          <div className="card overflow-hidden">
            <PanelHeader title="All Opportunities" count={opportunities.filter(o => {
              const s = oppSearch.toLowerCase()
              const ownerMatch = effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner
              return ownerMatch && (!s || o.ref.toLowerCase().includes(s) || o.name.toLowerCase().includes(s) ||
                o.companyName.toLowerCase().includes(s) || o.contactPersonName.toLowerCase().includes(s) || o.ownerName.toLowerCase().includes(s))
            }).length}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 220 }}
                placeholder="Search ref, name, company…" value={oppSearch} onChange={e => setOppSearch(e.target.value)} />
            </PanelHeader>
            <div>
              {opportunities.filter(o => {
                const s = oppSearch.toLowerCase()
                const ownerMatch = effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner
                return ownerMatch && (!s || o.ref.toLowerCase().includes(s) || o.name.toLowerCase().includes(s) ||
                  o.companyName.toLowerCase().includes(s) || o.contactPersonName.toLowerCase().includes(s) || o.ownerName.toLowerCase().includes(s))
              }).map(opp => {
                const company = companies.find(c => c.id === opp.companyId)
                const oppQuotes = quotes.filter(q => opp.quoteIds.includes(q.id))

                return (
                  <div
                    key={opp.id}
                    className="p-4 cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border-lt)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    onClick={() => { setActiveOppId(opp.id); setView('detail') }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                            {opp.ref}
                          </span>
                          <Badge status={opp.stage} label={stageLabels[opp.stage] ?? STAGE_LABELS[opp.stage]} />
                          <span className="badge badge-gray text-[9px]">{opp.probability}%</span>
                        </div>
                        <div className="text-sm mb-1" style={{ color: 'var(--text-1)' }}>
                          {opp.name}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                          {opp.companyName} · {opp.contactPersonName}
                        </div>
                        <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                          Owner: {opp.ownerName} · Close: {fmtDate(opp.expectedCloseDate)}
                          {oppQuotes.length > 0 && ` · ${oppQuotes.length} quote(s)`}
                          {typeof opp.leadScore === 'number' && ` · Lead Score: ${opp.leadScore}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                          {fmtKes(opp.expectedValue)}
                        </div>
                        {oppQuotes.length > 0 && (
                          <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                            {oppQuotes.length} quote{oppQuotes.length > 1 ? 's' : ''} · Last: {oppQuotes[0].ref}
                          </div>
                        )}
                        {typeof opp.leadScore === 'number' && (
                          <div className="mt-2 text-[10px]">
                            <span style={{ color: 'var(--text-3)' }}>Lead Score: </span>
                            <span style={{ 
                              color: opp.leadScore >= 80 ? '#12B76A' : opp.leadScore >= 60 ? '#F79009' : 'var(--text-3)',
                              fontWeight: 700,
                            }}>
                              {opp.leadScore}/100
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Detail View */}
        {view === 'detail' && activeOpp && (
          <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="card px-4 py-3 flex items-center gap-3" style={{ borderLeft: `4px solid ${STAGE_COLORS[activeOpp.stage]}` }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#6B7280' }}>{activeOpp.ref}</span>
                  <Badge status={activeOpp.stage} label={stageLabels[activeOpp.stage] ?? STAGE_LABELS[activeOpp.stage]} />
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: STAGE_COLORS[activeOpp.stage] + '18', color: STAGE_COLORS[activeOpp.stage],
                  }}>{activeOpp.probability}% confidence</span>
                </div>
                <p className="text-sm font-bold mt-0.5" style={{ color: '#111827' }}>{activeOpp.name}</p>
              </div>
            </div>

            {/* Main Content */}
            <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
              {/* Left Column */}
              <div className="flex flex-col gap-3">
                {/* Opportunity Details */}
                <div className="card p-4">
                  <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#4F46E5' }} />
                    <p className="text-xs font-bold" style={{ color: '#4F46E5' }}>{activeOpp.name}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Company</div>
                      <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{activeOpp.companyName}</div>
                      <div style={{ color: 'var(--text-3)' }}>
                        {companies.find(c => c.id === activeOpp.companyId)?.segment}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Contact Person</div>
                      <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{activeOpp.contactPersonName}</div>
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
                      <div style={{ color: 'var(--text-1)' }}>{fmtDate(activeOpp.expectedCloseDate)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Owner</div>
                      <div style={{ color: 'var(--text-1)' }}>{activeOpp.ownerName}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>Lead Source</div>
                      <div style={{ color: 'var(--text-1)' }}>
                        {activeOpp.leadSource.replace('_', ' ')}
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

                  {activeOpp.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeOpp.tags.map(tag => (
                        <span key={tag} className="badge badge-gray text-[10px]">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quotes */}
                <div className="card overflow-hidden">
                  <PanelHeader title="Quotes" count={quotes.filter(q => activeOpp.quoteIds.includes(q.id)).length} />
                  <div className="p-3 flex flex-col gap-2">
                    {quotes.filter(q => activeOpp.quoteIds.includes(q.id)).map(quote => (
                      <div key={quote.id} className="rounded-lg p-3 flex items-start justify-between gap-3"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>{quote.ref}</span>
                            <span className="text-[9px] font-medium px-1 rounded" style={{ background: 'var(--bg-muted)', color: 'var(--text-3)' }}>v{quote.version}</span>
                            <Badge status={quote.status} size="xs" />
                          </div>
                          <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                            {fmtDate(quote.issueDate)} – {fmtDate(quote.validUntil)}
                            {quote.sentDate && <span> · Sent {fmtDate(quote.sentDate)}</span>}
                            {quote.viewCount > 0 && <span> · Viewed {quote.viewCount}×</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{fmtKes(quote.total)}</div>
                          <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-4)' }}>{quote.lines.length} line{quote.lines.length !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                    ))}
                    {activeOpp.quoteIds.length === 0 && (
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
                      onClick={() => {
                        setActivityForm(prev => ({ ...prev, opportunityId: activeOpp.id }))
                        setShowActivityModal(true)
                      }}
                    >
                      + Log Activity
                    </button>
                  </PanelHeader>
                  <div className="p-4 space-y-3">
                    {opportunityActivities
                      .filter(a => a.opportunityId === activeOpp.id)
                      .sort((a, b) => b.createdDate.localeCompare(a.createdDate))
                      .map(activity => {
                        const icon = {
                          call: '📞',
                          email: '📧',
                          meeting: '🤝',
                          demo: '🎯',
                          proposal: '📋',
                          note: '📝',
                          task: '✅',
                        }[activity.type]

                        return (
                          <div key={activity.id} className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
                            <div className="flex items-start gap-3">
                              <span style={{ fontSize: 18 }}>{icon}</span>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                                    {activity.subject}
                                  </span>
                                  <Badge 
                                    status={activity.status} 
                                    label={activity.status === 'completed' ? '✓' : '⏳'} 
                                    size="xs" 
                                  />
                                </div>
                                <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                  {activity.type.toUpperCase()} · {activity.createdByName} · {fmtDate(activity.createdDate)}
                                </div>
                                {activity.description && (
                                  <div className="text-[11px] mt-2" style={{ color: 'var(--text-1)' }}>
                                    {activity.description}
                                  </div>
                                )}
                                {activity.outcome && (
                                  <div className="text-[10px] mt-1 p-2 rounded-lg" style={{ background: '#DCFCE7', color: '#059669' }}>
                                    Outcome: {activity.outcome}
                                  </div>
                                )}
                                {activity.status === 'scheduled' && activity.scheduledDate && (
                                  <div className="text-[10px] mt-1" style={{ color: '#F59E0B' }}>
                                    ⏰ Scheduled: {fmtDate(activity.scheduledDate)}
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
                  <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
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
                  <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#10B981' }} />
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#065F46' }}>Quick Actions</p>
                  </div>
                  <div className="space-y-2">
                    <button 
                      className="btn-primary w-full text-[11px]"
                      onClick={() => {
                        setWinForm({ opportunityId: activeOpp.id, actualValue: String(activeOpp.expectedValue) })
                        setShowWinModal(true)
                      }}
                    >
                      Mark as Won 🎉
                    </button>
                    <button 
                      className="btn-outline w-full text-[11px]"
                      style={{ color: '#F04438' }}
                      onClick={() => {
                        setLostForm({ opportunityId: activeOpp.id, reason: '', competitor: '' })
                        setShowLostModal(true)
                      }}
                    >
                      Mark as Lost
                    </button>
                    <button 
                      className="btn-outline w-full text-[11px]"
                      onClick={() => {
                        setActivityForm(prev => ({ ...prev, opportunityId: activeOpp.id }))
                        setShowActivityModal(true)
                      }}
                    >
                      + Log Activity
                    </button>
                  </div>
                </div>

                {/* Company Info */}
                <div className="card p-4">
                  <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#3B82F6' }} />
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#1D4ED8' }}>Company Details</p>
                  </div>
                  {companies.find(c => c.id === activeOpp.companyId) && (
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-3)' }}>Segment</span>
                        <span style={{ color: 'var(--text-1)' }}>
                          {companies.find(c => c.id === activeOpp.companyId)?.segment}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-3)' }}>Payment Terms</span>
                        <span style={{ color: 'var(--text-1)' }}>
                          {companies.find(c => c.id === activeOpp.companyId)?.paymentTerms} days
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-3)' }}>Credit Limit</span>
                        <span style={{ color: 'var(--text-1)' }}>
                          {fmtKes(companies.find(c => c.id === activeOpp.companyId)?.creditLimit ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-3)' }}>KYC Status</span>
                        <Badge 
                          status={companies.find(c => c.id === activeOpp.companyId)?.kycStatus ?? 'pending'} 
                          label={companies.find(c => c.id === activeOpp.companyId)?.kycStatus} 
                          size="xs" 
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Contact Info */}
                <div className="card p-4">
                  <div className="flex items-center gap-2 pb-2 mb-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#F59E0B' }} />
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#92400E' }}>Contact Details</p>
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
                      <span style={{ color: 'var(--text-1)' }}>{fmtDate(activeOpp.createdDate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-3)' }}>Days Open</span>
                      <span style={{ color: 'var(--text-1)' }}>
                        {Math.round((new Date().getTime() - new Date(activeOpp.createdDate).getTime()) / (1000 * 60 * 60 * 24))} days
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
                  <div className="card p-4" style={{ background: '#DCFCE7', borderColor: '#A7F3D0' }}>
                    <div style={{ color: '#10B981', fontWeight: 700, marginBottom: 8 }}>
                      🎉 Deal Won!
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-1)' }}>
                      <div className="font-semibold text-sm mb-2">{fmtKes(activeOpp.actualValue)}</div>
                      <div>Closed: {fmtDate(activeOpp.actualCloseDate!)}</div>
                    </div>
                  </div>
                )}

                {activeOpp.stage === 'closed_lost' && (
                  <div className="card p-4" style={{ background: '#FEE2E2', borderColor: '#FECACA' }}>
                    <div style={{ color: '#DC2626', fontWeight: 700, marginBottom: 8 }}>
                      Deal Lost
                    </div>
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
        )}

        {/* Modals */}
        {showNewOppModal && (
          <Modal title="Create Opportunity" onClose={() => setShowNewOppModal(false)} width={720}>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Opportunity Name" required>
                  <Input 
                    value={oppForm.name}
                    onChange={value => setOppForm(prev => ({ ...prev, name: value }))}
                    placeholder="e.g., Q2 Laptop Refresh Project"
                  />
                </Field>
              </div>
              <Field label="Company" required>
                <Select
                  value={oppForm.companyId}
                  onChange={value => {
                    const comp = companies.find(c => c.id === value)
                    setOppForm(prev => ({ ...prev, companyId: value, companyName: comp?.name ?? '' }))
                  }}
                  options={companies.map(c => ({ value: c.id, label: c.name }))}
                />
              </Field>
              <Field label="Contact Person" required>
                <Select
                  value={oppForm.contactPersonId}
                  onChange={value => {
                    const cp = contactPersons.find(c => c.id === value)
                    setOppForm(prev => ({ ...prev, contactPersonId: value, contactPersonName: cp?.fullName ?? '' }))
                  }}
                  options={contactPersons
                    .filter(cp => !oppForm.companyId || cp.companyId === oppForm.companyId)
                    .map(cp => ({ value: cp.id, label: `${cp.fullName} (${cp.jobTitle})` }))}
                />
              </Field>
              <Field label="Expected Value (KES)">
                <Input 
                  type="number"
                  value={oppForm.expectedValue}
                  onChange={value => setOppForm(prev => ({ ...prev, expectedValue: value }))}
                  placeholder="0"
                />
              </Field>
              <Field label="Expected Close Date">
                <Input 
                  type="date"
                  value={oppForm.expectedCloseDate}
                  onChange={value => setOppForm(prev => ({ ...prev, expectedCloseDate: value }))}
                />
              </Field>
              <Field label="Lead Source">
                <Select
                  value={oppForm.leadSource}
                  onChange={value => setOppForm(prev => ({ ...prev, leadSource: value as LeadSource }))}
                  options={LEAD_SOURCE_OPTIONS}
                />
              </Field>
              <div className="col-span-2">
                <Field label="Description" required>
                  <Textarea
                    value={oppForm.description}
                    onChange={value => setOppForm(prev => ({ ...prev, description: value }))}
                    placeholder="Brief description of the opportunity..."
                  />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Customer Needs">
                  <Textarea
                    value={oppForm.customerNeeds}
                    onChange={value => setOppForm(prev => ({ ...prev, customerNeeds: value }))}
                    placeholder="What is the customer looking for?"
                  />
                </Field>
              </div>
              <Field label="Tags" hint="Comma-separated">
                <Input 
                  value={oppForm.tags}
                  onChange={value => setOppForm(prev => ({ ...prev, tags: value }))}
                  placeholder="e.g., enterprise, laptops, urgent"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setShowNewOppModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateOpportunity}>Create Opportunity</button>
            </div>
          </Modal>
        )}

        {showActivityModal && (
          <Modal title="Log Activity" onClose={() => setShowActivityModal(false)} width={620}>
            <Field label="Activity Type">
              <Select
                value={activityForm.type}
                onChange={value => setActivityForm(prev => ({ ...prev, type: value as any }))}
                options={[
                  { value: 'call', label: 'Phone Call' },
                  { value: 'email', label: 'Email' },
                  { value: 'meeting', label: 'Meeting' },
                  { value: 'demo', label: 'Product Demo' },
                  { value: 'proposal', label: 'Proposal/Quote' },
                  { value: 'note', label: 'Note' },
                  { value: 'task', label: 'Task' },
                ]}
              />
            </Field>
            <Field label="Subject" required>
              <Input
                value={activityForm.subject}
                onChange={value => setActivityForm(prev => ({ ...prev, subject: value }))}
                placeholder="Brief summary of activity..."
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={activityForm.description}
                onChange={value => setActivityForm(prev => ({ ...prev, description: value }))}
                placeholder="Detailed notes..."
              />
            </Field>
            <Field label="Outcome">
              <Textarea
                value={activityForm.outcome}
                onChange={value => setActivityForm(prev => ({ ...prev, outcome: value }))}
                placeholder="What was the result?"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Select
                  value={activityForm.status}
                  onChange={value => setActivityForm(prev => ({ ...prev, status: value as any }))}
                  options={[
                    { value: 'completed', label: 'Completed' },
                    { value: 'scheduled', label: 'Scheduled' },
                  ]}
                />
              </Field>
              {activityForm.status === 'scheduled' && (
                <Field label="Scheduled Date">
                  <Input
                    type="date"
                    value={activityForm.scheduledDate}
                    onChange={value => setActivityForm(prev => ({ ...prev, scheduledDate: value }))}
                  />
                </Field>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setShowActivityModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleLogActivity}>Log Activity</button>
            </div>
          </Modal>
        )}

        {showWinModal && (
          <Modal title="Mark Opportunity as Won" onClose={() => setShowWinModal(false)} width={480}>
            <Field label="Actual Deal Value (KES)" required>
              <Input
                type="number"
                value={winForm.actualValue}
                onChange={value => setWinForm(prev => ({ ...prev, actualValue: value }))}
                placeholder="Final deal amount"
              />
            </Field>
            <div className="text-xs p-3 rounded-lg" style={{ background: '#DCFCE7', color: '#059669' }}>
              This will move the opportunity to "Closed Won" and record the win date.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setShowWinModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleMarkWon}>Mark as Won 🎉</button>
            </div>
          </Modal>
        )}

        {showLostModal && (
          <Modal title="Mark Opportunity as Lost" onClose={() => setShowLostModal(false)} width={480}>
            <Field label="Loss Reason" required>
              <Textarea
                value={lostForm.reason}
                onChange={value => setLostForm(prev => ({ ...prev, reason: value }))}
                placeholder="Why was this opportunity lost?"
              />
            </Field>
            <Field label="Lost to Competitor (optional)">
              <Input
                value={lostForm.competitor}
                onChange={value => setLostForm(prev => ({ ...prev, competitor: value }))}
                placeholder="Competitor name if known"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setShowLostModal(false)}>Cancel</button>
              <button className="btn-outline" style={{ color: '#F04438' }} onClick={handleMarkLost}>
                Mark as Lost
              </button>
            </div>
          </Modal>
        )}
        </div>{/* pipeline content end */}
      </div>
    )
  }

  // Contracts Tab
  if (tab === 'contracts') {
    return (
      <div className="flex flex-col" style={{ background: '#F4F6FA', minHeight: '100%' }}>
        {moduleHeader}
        <div className="flex flex-col gap-4 p-5">

        <div className="card overflow-hidden">
          <PanelHeader title="Customer Contracts" count={customerContracts.filter(c => {
            const s = contractSearch.toLowerCase()
            return !s || c.ref.toLowerCase().includes(s) || c.companyName.toLowerCase().includes(s) ||
              c.type.toLowerCase().includes(s) || c.contactPersonName.toLowerCase().includes(s)
          }).length}>
            <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
              placeholder="Search ref, company…" value={contractSearch} onChange={e => setContractSearch(e.target.value)} />
          </PanelHeader>
          <div className="divide-y divide-gray-100">
            {customerContracts.filter(c => {
              const s = contractSearch.toLowerCase()
              return !s || c.ref.toLowerCase().includes(s) || c.companyName.toLowerCase().includes(s) ||
                c.type.toLowerCase().includes(s) || c.contactPersonName.toLowerCase().includes(s)
            }).map(contract => (
              <div key={contract.id} className="p-4 transition-colors" onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#F8F9FC'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=''}}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{contract.ref}</span>
                      <Badge status={contract.status} label={contract.status} size="xs" />
                      {contract.slaTier && <span className="badge badge-blue text-[9px]">SLA {contract.slaTier.toUpperCase()}</span>}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-1)' }}>{contract.companyName} · {contract.contactPersonName}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                      {contract.type} · Start: {fmtDate(contract.startDate)} · End: {fmtDate(contract.endDate)} · Renewal: {fmtDate(contract.renewalDate)}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                      SLA Response: {contract.responseTimeHours ?? '-'}h · Resolution: {contract.resolutionTimeHours ?? '-'}h
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{fmtKes(contract.contractValue)}</div>
                    <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{contract.paymentSchedule}</div>
                    <div className="mt-2 flex gap-1 justify-end">
                      <button className="btn-outline text-[9px] py-1 px-2" onClick={() => renewCustomerContract(contract.id)}>Renew</button>
                      <button className="btn-outline text-[9px] py-1 px-2" style={{ color: '#F04438' }} onClick={() => terminateCustomerContract(contract.id, 'Manual termination')}>Terminate</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {showContractModal && (
          <Modal title="Create Customer Contract" onClose={() => setShowContractModal(false)} width={720}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company" required>
                <Select value={contractForm.companyId} onChange={value => {
                  const company = companies.find(c => c.id === value)
                  setContractForm(prev => ({ ...prev, companyId: value, companyName: company?.name ?? '' }))
                }} options={companies.map(c => ({ value: c.id, label: c.name }))} />
              </Field>
              <Field label="Contact Person" required>
                <Select value={contractForm.contactPersonId} onChange={value => {
                  const cp = contactPersons.find(c => c.id === value)
                  setContractForm(prev => ({ ...prev, contactPersonId: value, contactPersonName: cp?.fullName ?? '' }))
                }} options={contactPersons.filter(cp => !contractForm.companyId || cp.companyId === contractForm.companyId).map(cp => ({ value: cp.id, label: cp.fullName }))} />
              </Field>
              <Field label="Contract Type">
                <Select value={contractForm.type} onChange={value => setContractForm(prev => ({ ...prev, type: value as any }))} options={[
                  { value: 'sales', label: 'Sales' },
                  { value: 'maintenance', label: 'Maintenance' },
                  { value: 'support', label: 'Support' },
                  { value: 'rental', label: 'Rental' },
                  { value: 'subscription', label: 'Subscription' },
                ]} />
              </Field>
              <Field label="Contract Value (KES)" required>
                <Input type="number" value={contractForm.contractValue} onChange={value => setContractForm(prev => ({ ...prev, contractValue: value }))} />
              </Field>
              <Field label="Start Date"><Input type="date" value={contractForm.startDate} onChange={value => setContractForm(prev => ({ ...prev, startDate: value }))} /></Field>
              <Field label="End Date"><Input type="date" value={contractForm.endDate} onChange={value => setContractForm(prev => ({ ...prev, endDate: value }))} /></Field>
              <Field label="Renewal Date"><Input type="date" value={contractForm.renewalDate} onChange={value => setContractForm(prev => ({ ...prev, renewalDate: value }))} /></Field>
              <Field label="Notice Period (days)"><Input type="number" value={contractForm.noticePeriod} onChange={value => setContractForm(prev => ({ ...prev, noticePeriod: value }))} /></Field>
              <Field label="Payment Schedule">
                <Select value={contractForm.paymentSchedule} onChange={value => setContractForm(prev => ({ ...prev, paymentSchedule: value as any }))} options={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                  { value: 'annual', label: 'Annual' },
                  { value: 'one-time', label: 'One-time' },
                ]} />
              </Field>
              <Field label="SLA Tier">
                <Select value={contractForm.slaTier} onChange={value => setContractForm(prev => ({ ...prev, slaTier: value as any }))} options={[
                  { value: 'bronze', label: 'Bronze (48h/120h)' },
                  { value: 'silver', label: 'Silver (24h/72h)' },
                  { value: 'gold', label: 'Gold (4h/24h)' },
                  { value: 'platinum', label: 'Platinum (1h/8h)' },
                ]} />
              </Field>
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-1)' }}>
                  <input type="checkbox" checked={contractForm.autoRenewal} onChange={e => setContractForm(prev => ({ ...prev, autoRenewal: e.target.checked }))} />
                  Enable auto-renewal
                </label>
              </div>
              <div className="col-span-2">
                <Field label="Notes">
                  <Textarea value={contractForm.notes} onChange={value => setContractForm(prev => ({ ...prev, notes: value }))} placeholder="Contract notes" />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setShowContractModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateContract}>Create Contract</button>
            </div>
          </Modal>
        )}
        </div>
      </div>
    )
  }

  // Companies Tab
  if (tab === 'companies') {
    return (
      <div className="flex flex-col" style={{ background: '#F4F6FA', minHeight: '100%' }}>
        {moduleHeader}
        <div className="flex flex-col gap-4 p-5">

        {/* Company List */}
        <div className="card overflow-hidden">
          <PanelHeader title="Companies" count={companies.filter(c => {
            const s = companySearch.toLowerCase()
            return !s || c.name.toLowerCase().includes(s) || (c.taxId ?? '').toLowerCase().includes(s) || (c.industry ?? '').toLowerCase().includes(s)
          }).length}>
            <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
              placeholder="Search name, industry…" value={companySearch} onChange={e => setCompanySearch(e.target.value)} />
          </PanelHeader>
          <div className="divide-y divide-gray-100">
            {companies.filter(c => {
              const s = companySearch.toLowerCase()
              return !s || c.name.toLowerCase().includes(s) || (c.taxId ?? '').toLowerCase().includes(s) || (c.industry ?? '').toLowerCase().includes(s)
            }).map(company => {
              const companyContacts = contactPersons.filter(cp => cp.companyId === company.id)
              const companyOpps = opportunities.filter(o => o.companyId === company.id)
              const activeOpps = companyOpps.filter(o => !['closed_won', 'closed_lost'].includes(o.stage))

              return (
                <div
                  key={company.id}
                  className="p-4 transition-colors" style={{cursor:'pointer'}} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#F8F9FC'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=''}}
                  onClick={() => setActiveCompanyId(company.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                          {company.name}
                        </span>
                        <Badge status={company.status} label={company.status} size="xs" />
                        <Badge status={company.kycStatus} label={company.kycStatus} size="xs" />
                        {company.segment && (
                          <span className="badge badge-purple text-[9px]">{company.segment}</span>
                        )}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                        {company.taxId} · {company.industry || 'No industry'}
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                        {companyContacts.length} contact{companyContacts.length !== 1 ? 's' : ''} · 
                        {activeOpps.length} active opp{activeOpps.length !== 1 ? 's' : ''} · 
                        Payment: {company.paymentTerms}d
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs" style={{ color: 'var(--text-3)' }}>Credit Limit</div>
                      <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                        {fmtKes(company.creditLimit)}
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: company.creditUsed > company.creditLimit * 0.9 ? '#F04438' : 'var(--text-3)' }}>
                        Used: {fmtKes(company.creditUsed)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* New Company Modal */}
        {showNewCompanyModal && (
          <Modal title="Add Company" onClose={() => setShowNewCompanyModal(false)} width={720}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company Name" required>
                <Input
                  value={companyForm.name}
                  onChange={value => setCompanyForm(prev => ({ ...prev, name: value }))}
                  placeholder="ABC Corporation Ltd"
                />
              </Field>
              <Field label="Tax ID / PIN" required>
                <Input
                  value={companyForm.taxId}
                  onChange={value => setCompanyForm(prev => ({ ...prev, taxId: value }))}
                  placeholder="P051234567A"
                />
              </Field>
              <Field label="Industry">
                <Input
                  value={companyForm.industry}
                  onChange={value => setCompanyForm(prev => ({ ...prev, industry: value }))}
                  placeholder="e.g., Technology, Manufacturing"
                />
              </Field>
              <Field label="Segment">
                <Select
                  value={companyForm.segment}
                  onChange={value => setCompanyForm(prev => ({ ...prev, segment: value as any }))}
                  options={[
                    { value: 'enterprise', label: 'Enterprise' },
                    { value: 'sme', label: 'SME' },
                    { value: 'startup', label: 'Startup' },
                    { value: 'government', label: 'Government' },
                  ]}
                />
              </Field>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={companyForm.email}
                  onChange={value => setCompanyForm(prev => ({ ...prev, email: value }))}
                  placeholder="contact@company.com"
                />
              </Field>
              <Field label="Phone" required>
                <Input
                  value={companyForm.phone}
                  onChange={value => setCompanyForm(prev => ({ ...prev, phone: value }))}
                  placeholder="+254 20 1234567"
                />
              </Field>
              <Field label="Website">
                <Input
                  value={companyForm.website}
                  onChange={value => setCompanyForm(prev => ({ ...prev, website: value }))}
                  placeholder="https://company.com"
                />
              </Field>
              <Field label="City">
                <Input
                  value={companyForm.city}
                  onChange={value => setCompanyForm(prev => ({ ...prev, city: value }))}
                  placeholder="Nairobi"
                />
              </Field>
              <div className="col-span-2">
                <Field label="Physical Address">
                  <Textarea
                    value={companyForm.physicalAddress}
                    onChange={value => setCompanyForm(prev => ({ ...prev, physicalAddress: value }))}
                    placeholder="Street address, building, floor..."
                  />
                </Field>
              </div>
              <Field label="Payment Terms (days)">
                <Input
                  type="number"
                  value={companyForm.paymentTerms}
                  onChange={value => setCompanyForm(prev => ({ ...prev, paymentTerms: value }))}
                />
              </Field>
              <Field label="Credit Limit (KES)">
                <Input
                  type="number"
                  value={companyForm.creditLimit}
                  onChange={value => setCompanyForm(prev => ({ ...prev, creditLimit: value }))}
                />
              </Field>
              <Field label="Tags" hint="Comma-separated">
                <Input
                  value={companyForm.tags}
                  onChange={value => setCompanyForm(prev => ({ ...prev, tags: value }))}
                  placeholder="tier1, banking, vip"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setShowNewCompanyModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateCompany}>Create Company</button>
            </div>
          </Modal>
        )}
        </div>
      </div>
    )
  }

  // Contacts Tab
  if (tab === 'contacts') {
    return (
      <div className="flex flex-col" style={{ background: '#F4F6FA', minHeight: '100%' }}>
        {moduleHeader}
        <div className="flex flex-col gap-4 p-5">

        {/* Contact List */}
        <div className="card overflow-hidden">
          <PanelHeader title="Contact Persons" count={contactPersons.filter(cp => {
            const s = contactSearch.toLowerCase()
            return !s || cp.fullName.toLowerCase().includes(s) || cp.email.toLowerCase().includes(s) ||
              cp.companyName.toLowerCase().includes(s) || (cp.jobTitle ?? '').toLowerCase().includes(s)
          }).length}>
            <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
              placeholder="Search name, email, company…" value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
          </PanelHeader>
          <div className="divide-y divide-gray-100">
            {contactPersons.filter(cp => {
              const s = contactSearch.toLowerCase()
              return !s || cp.fullName.toLowerCase().includes(s) || cp.email.toLowerCase().includes(s) ||
                cp.companyName.toLowerCase().includes(s) || (cp.jobTitle ?? '').toLowerCase().includes(s)
            }).map(contact => {
              const company = companies.find(c => c.id === contact.companyId)

              return (
                <div key={contact.id} className="p-4 transition-colors" onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#F8F9FC'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=''}}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>
                        {contact.fullName}
                      </div>
                      <div className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                        {contact.jobTitle} · {contact.companyName}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                        {contact.email} · {contact.phone}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {contact.isPrimary && <span className="badge badge-blue text-[9px]">Primary</span>}
                        {contact.isDecisionMaker && <span className="badge badge-green text-[9px]">Decision Maker</span>}
                        {contact.isTechnicalContact && <span className="badge badge-purple text-[9px]">Technical</span>}
                        {contact.isBillingContact && <span className="badge badge-amber text-[9px]">Billing</span>}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div style={{ color: 'var(--text-3)' }}>Prefers</div>
                      <div style={{ color: 'var(--text-1)' }}>{contact.preferredChannel}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* New Contact Modal */}
        {showNewContactModal && (
          <Modal title="Add Contact Person" onClose={() => setShowNewContactModal(false)} width={720}>
            <Field label="Company" required>
              <Select
                value={contactForm.companyId}
                onChange={value => {
                  const comp = companies.find(c => c.id === value)
                  setContactForm(prev => ({ ...prev, companyId: value, companyName: comp?.name ?? '' }))
                }}
                options={companies.map(c => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First Name" required>
                <Input
                  value={contactForm.firstName}
                  onChange={value => setContactForm(prev => ({ ...prev, firstName: value }))}
                />
              </Field>
              <Field label="Last Name" required>
                <Input
                  value={contactForm.lastName}
                  onChange={value => setContactForm(prev => ({ ...prev, lastName: value }))}
                />
              </Field>
              <Field label="Job Title" required>
                <Input
                  value={contactForm.jobTitle}
                  onChange={value => setContactForm(prev => ({ ...prev, jobTitle: value }))}
                  placeholder="e.g., IT Manager"
                />
              </Field>
              <Field label="Department">
                <Input
                  value={contactForm.department}
                  onChange={value => setContactForm(prev => ({ ...prev, department: value }))}
                  placeholder="e.g., Technology"
                />
              </Field>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={contactForm.email}
                  onChange={value => setContactForm(prev => ({ ...prev, email: value }))}
                />
              </Field>
              <Field label="Phone" required>
                <Input
                  value={contactForm.phone}
                  onChange={value => setContactForm(prev => ({ ...prev, phone: value }))}
                />
              </Field>
              <Field label="Mobile">
                <Input
                  value={contactForm.mobile}
                  onChange={value => setContactForm(prev => ({ ...prev, mobile: value }))}
                />
              </Field>
              <Field label="Preferred Channel">
                <Select
                  value={contactForm.preferredChannel}
                  onChange={value => setContactForm(prev => ({ ...prev, preferredChannel: value as any }))}
                  options={[
                    { value: 'email', label: 'Email' },
                    { value: 'phone', label: 'Phone' },
                    { value: 'whatsapp', label: 'WhatsApp' },
                  ]}
                />
              </Field>
            </div>
            
            <div className="grid grid-cols-2 gap-3 mt-2">
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-1)' }}>
                <input
                  type="checkbox"
                  checked={contactForm.isPrimary}
                  onChange={e => setContactForm(prev => ({ ...prev, isPrimary: e.target.checked }))}
                />
                Primary Contact
              </label>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-1)' }}>
                <input
                  type="checkbox"
                  checked={contactForm.isDecisionMaker}
                  onChange={e => setContactForm(prev => ({ ...prev, isDecisionMaker: e.target.checked }))}
                />
                Decision Maker
              </label>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-1)' }}>
                <input
                  type="checkbox"
                  checked={contactForm.isBillingContact}
                  onChange={e => setContactForm(prev => ({ ...prev, isBillingContact: e.target.checked }))}
                />
                Billing Contact
              </label>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-1)' }}>
                <input
                  type="checkbox"
                  checked={contactForm.isTechnicalContact}
                  onChange={e => setContactForm(prev => ({ ...prev, isTechnicalContact: e.target.checked }))}
                />
                Technical Contact
              </label>
            </div>

            <Field label="LinkedIn URL">
              <Input
                value={contactForm.linkedIn}
                onChange={value => setContactForm(prev => ({ ...prev, linkedIn: value }))}
                placeholder="https://linkedin.com/in/..."
              />
            </Field>

            <Field label="Notes">
              <Textarea
                value={contactForm.notes}
                onChange={value => setContactForm(prev => ({ ...prev, notes: value }))}
                placeholder="Additional information..."
              />
            </Field>

            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setShowNewContactModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateContact}>Add Contact</button>
            </div>
          </Modal>
        )}
        </div>
      </div>
    )
  }

  // Activities Tab
  if (tab === 'activities') {
    return (
      <div className="flex flex-col" style={{ background: '#F4F6FA', minHeight: '100%' }}>
        {moduleHeader}
        <div className="flex flex-col gap-4 p-5">
        <div className="card overflow-hidden">
          <PanelHeader title="All Activities" count={opportunityActivities.filter(a => {
            const s = activitySearch.toLowerCase()
            return !s || a.subject.toLowerCase().includes(s) || a.type.toLowerCase().includes(s) ||
              a.createdByName.toLowerCase().includes(s)
          }).length}>
            <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
              placeholder="Search subject, type…" value={activitySearch} onChange={e => setActivitySearch(e.target.value)} />
          </PanelHeader>
          <div className="divide-y divide-gray-100">
            {opportunityActivities.filter(a => {
              const s = activitySearch.toLowerCase()
              return !s || a.subject.toLowerCase().includes(s) || a.type.toLowerCase().includes(s) ||
                a.createdByName.toLowerCase().includes(s)
            }).map(activity => {
              const opp = opportunities.find(o => o.id === activity.opportunityId)
              return (
                <div key={activity.id} className="p-4 transition-colors" onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#F8F9FC'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=''}}>
                  <div className="flex items-start gap-3">
                    <span style={{ fontSize: 18 }}>
                      {{
                        call: '📞',
                        email: '📧',
                        meeting: '🤝',
                        demo: '🎯',
                        proposal: '📋',
                        note: '📝',
                        task: '✅',
                      }[activity.type]}
                    </span>
                    <div className="flex-1">
                      <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
                        {activity.subject}
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        {opp?.ref} · {opp?.name}
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                        {activity.createdByName} · {fmtDate(activity.createdDate)}
                      </div>
                    </div>
                    <Badge status={activity.status} label={activity.status} size="xs" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        </div>
      </div>
    )
  }

  // Default
  return null
}
