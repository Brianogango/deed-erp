'use client'
import { useState, useMemo, useEffect, Suspense, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useCrmStore, OpportunityStage, LeadSource, fmtKes, fmtDate } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Textarea, PanelHeader, ModuleSkeleton, SlidePanel, useMounted, TabBar, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import ClientDetail from '@/components/crm/ClientDetail'
import LeadsPanel from '@/components/crm/LeadsPanel'
import { PivotView } from '@/components/erp/PivotView'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  Fa, faChartBar, faMoneyBillWave, faArrowTrendUp, faBullseye, faCircleCheck,
  faFileSignature, faScrewdriverWrench, faTriangleExclamation, faChartLine, faPlus,
  faPhone, faEnvelope, faHandshake, faClipboardList, faNoteSticky,
} from '@/components/icons'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'

const ACTIVITY_ICONS: Record<string, IconProp> = {
  call: faPhone,
  email: faEnvelope,
  meeting: faHandshake,
  demo: faBullseye,
  proposal: faClipboardList,
  note: faNoteSticky,
  task: faCircleCheck,
}

type Tab = 'pipeline' | 'opportunities' | 'companies' | 'contacts' | 'activities' | 'contracts' | 'sla' | 'leads'
type View = 'kanban' | 'list' | 'detail'

const CRM_RECORD_QUERY = { crmTab: 'pipeline' }

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
  proposal: 'var(--warning)',
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
  return (
    <Suspense fallback={
      <ModuleSkeleton />
    }>
      <CRMContent />
    </Suspense>
  )
}

function CRMContent() {
  const mounted = useMounted()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [urlOppId, setUrlOppId] = useUrlRecordId({ whenOpen: CRM_RECORD_QUERY })

  const {
    companies, contactPersons, opportunities, opportunityActivities, quotes, customerContracts, users, currentUserId,
    repairs,
    createCompany, updateCompany, deleteCompany,
    createContactPerson, updateContactPerson, deleteContactPerson,
    createOpportunity, updateOpportunity, moveOpportunityStage, markOpportunityWon, markOpportunityLost, deleteOpportunity,
    logActivity, completeActivity,
    createCustomerContract, renewCustomerContract, terminateCustomerContract,
    showToast, systemSettings,
  } = useCrmStore()

  // Dynamic stage labels from settings (positionally mapped to STAGE_ORDER).
  // Guard incomplete settings objects from older localStorage snapshots.
  const pipelineStages = Array.isArray(systemSettings?.crmPipelineStages)
    ? systemSettings.crmPipelineStages
    : []
  const stageLabels: Record<OpportunityStage, string> = Object.fromEntries(
    STAGE_ORDER.map((s, i) => [s, pipelineStages[i] ?? STAGE_LABELS[s]])
  ) as Record<OpportunityStage, string>

  const defaultTab: Tab = 'pipeline'
  const rawQueryTab = searchParams.get('crmTab') as Tab | null
  const queryTab: Tab | null = rawQueryTab === 'opportunities' ? 'pipeline' : rawQueryTab
  const initialTab = queryTab ?? defaultTab

  const [tab, setLocalTab] = useState<Tab>(initialTab)

  const setTab = (newTab: Tab) => {
    setLocalTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('crmTab', newTab)
    if (newTab !== 'pipeline') {
      params.delete('id')
      setLocalActiveOppId(null)
      setLocalView('kanban')
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const rawUrlTab = searchParams.get('crmTab') as Tab | null
    const urlTab: Tab | null = rawUrlTab === 'opportunities' ? 'pipeline' : rawUrlTab
    if (urlTab && urlTab !== tab) {
      setLocalTab(urlTab)
    }
  }, [searchParams, tab])

  const [view, setLocalView] = useState<View>('kanban')
  const [activeOppId, setLocalActiveOppId] = useState<string | null>(null)
  const setActiveOppId = useCallback((id: string | null) => {
    setLocalActiveOppId(id)
    setUrlOppId(id)
  }, [setUrlOppId])
  const setView = useCallback((nextView: View) => {
    setLocalView(nextView)
    if (nextView !== 'detail') setActiveOppId(null)
  }, [setActiveOppId])
  // Directors/admins land on the full pipeline across every rep; they can
  // still narrow to "My Pipeline" or a specific rep with the filter chips.
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null)
  const [showClientDetail, setShowClientDetail] = useState(false)

  // Search states
  const [oppSearch, setOppSearch] = useState('')
  const [contractSearch, setContractSearch] = useState('')
  const [activitySearch, setActivitySearch] = useState('')
  
  // Modals
  const [showNewOppModal, setShowNewOppModal] = useState(false)
  const [creatingOpp, setCreatingOpp] = useState(false)
  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false)
  const [showNewContactModal, setShowNewContactModal] = useState(false)
  const [showOppCompanyModal, setShowOppCompanyModal] = useState(false)
  const [showOppContactModal, setShowOppContactModal] = useState(false)
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

  useEffect(() => {
    if (!urlOppId) {
      if (activeOppId) {
        setLocalActiveOppId(null)
        if (view === 'detail') setLocalView('kanban')
      }
      return
    }

    const rawUrlTab = searchParams.get('crmTab') as Tab | null
    const urlTab: Tab | null = rawUrlTab === 'opportunities' ? 'pipeline' : rawUrlTab
    // User is (or just switched to) a non-pipeline tab — never yank back to
    // pipeline over a stale opportunity id. That remount fight shook Leads.
    if ((urlTab && urlTab !== 'pipeline') || (tab !== 'pipeline' && tab !== 'opportunities')) {
      setUrlOppId(null)
      return
    }

    if (opportunities.some(o => o.id === urlOppId)) {
      if (tab !== 'pipeline') setLocalTab('pipeline')
      if (activeOppId !== urlOppId || tab !== 'pipeline') setActiveOppId(urlOppId)
      if (view !== 'detail') setLocalView('detail')
    }
  }, [urlOppId, opportunities, activeOppId, view, tab, setActiveOppId, searchParams, setUrlOppId])

  // Pipeline metrics — scoped to owner filter
  const isAdmin = ['director', 'admin_officer', 'finance_officer'].includes(currentUser?.role ?? '')
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
  const salesReps = users.filter(u =>
    u.role === 'sales_rep'
   
    || opportunities.some(o => o.ownerId === u.id || o.assignedToId === u.id),
  )
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

  const activeSLAContracts = useMemo(() => {
    return customerContracts.filter(c => c.status === 'active' && c.slaTier)
  }, [customerContracts])

  const slaRepairs = useMemo(() => {
    return repairs
      .map(r => ({ ...r, slaDeadline: (r as any).slaDeadline as string | undefined }))
      .filter(r => r.slaDeadline || activeSLAContracts.some(c => c.companyName === r.customerName))
  }, [repairs, activeSLAContracts])

  const missedSLAs = useMemo(() => {
    const now = new Date()
    return slaRepairs.filter(r => r.slaDeadline && new Date(r.slaDeadline) < now && !['ready', 'delivered', 'closed'].includes(r.status))
  }, [slaRepairs])

  const complianceRate = useMemo(() => {
    if (slaRepairs.length === 0) return 100
    return Math.round(((slaRepairs.length - missedSLAs.length) / slaRepairs.length) * 100)
  }, [slaRepairs, missedSLAs])

  type CompanyRow = typeof companies[number]
  const companyColumns: ColumnDef<CompanyRow>[] = [
    {
      key: 'company', label: 'Company', priority: 1, width: '1.4fr',
      render: company => (
        <div>
          <p className="text-xs font-bold text-[var(--text-1)]">{company.name}</p>
          <p className="mt-0.5 text-[10px] text-[var(--text-4)]">{company.taxId} · {company.industry || 'No industry'}</p>
        </div>
      ),
      exportValue: company => company.name,
    },
    {
      key: 'segment', label: 'Segment', priority: 2, width: '100px',
      render: company => <Badge status={company.status} label={company.segment || company.status} size="xs" />,
      exportValue: company => company.segment || company.status,
    },
    {
      key: 'contacts', label: 'Contacts', priority: 2, width: '90px', align: 'right',
      render: company => contactPersons.filter(cp => (cp.companyId ?? cp.clientId) === company.id).length,
    },
    {
      key: 'opportunities', label: 'Active Deals', priority: 2, width: '100px', align: 'right',
      render: company => opportunities.filter(o => (o.companyId ?? o.clientId) === company.id && !['closed_won', 'closed_lost'].includes(o.stage)).length,
    },
    {
      key: 'credit', label: 'Credit Limit', priority: 1, width: '130px', align: 'right',
      render: company => <span className="font-mono text-xs font-bold">{fmtKes(company.creditLimit ?? 0)}</span>,
      exportValue: company => company.creditLimit ?? 0,
    },
  ]

  type ContactRow = typeof contactPersons[number]
  const contactColumns: ColumnDef<ContactRow>[] = [
    {
      key: 'name', label: 'Contact', priority: 1, width: '1.2fr',
      render: contact => (
        <div>
          <p className="text-xs font-bold text-[var(--text-1)]">{contact.firstName} {contact.lastName}</p>
          <p className="mt-0.5 text-[10px] text-[var(--text-4)]">{contact.jobTitle || 'No title'}</p>
        </div>
      ),
      exportValue: contact => `${contact.firstName} ${contact.lastName}`,
    },
    {
      key: 'company', label: 'Company', priority: 1, width: '1fr',
      render: contact => contact.companyName || companies.find(c => c.id === (contact.companyId ?? contact.clientId))?.name || '—',
      exportValue: contact => contact.companyName || '',
    },
    {
      key: 'email', label: 'Email', priority: 2, width: '1.2fr',
      render: contact => <span className="text-xs text-[var(--text-3)]">{contact.email}</span>,
      exportValue: contact => contact.email,
    },
    {
      key: 'phone', label: 'Phone', priority: 2, width: '130px',
      render: contact => <span className="text-xs text-[var(--text-3)]">{contact.phone || contact.mobile || '—'}</span>,
      exportValue: contact => contact.phone || contact.mobile || '',
    },
    {
      key: 'channel', label: 'Preferred', priority: 3, width: '100px',
      render: contact => <span className="text-xs capitalize">{contact.preferredChannel}</span>,
      exportValue: contact => contact.preferredChannel || '',
    },
  ]

  // Handlers
  const handleCreateOpportunity = async () => {
    if (!oppForm.name || !oppForm.companyId || !oppForm.contactPersonId) {
      showToast('Name, company, and contact person are required', 'error')
      return
    }
    if (creatingOpp) return
    setCreatingOpp(true)
    try {
    const opp = await Promise.resolve(createOpportunity({
      name: oppForm.name,
      clientId: oppForm.companyId,
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
    }))

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
    setView('detail')
    } finally {
      setCreatingOpp(false)
    }
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
      clientId: contactForm.companyId, companyId: contactForm.companyId,
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

  const handleCreateCompanyForOpp = () => {
    if (!companyForm.name || !companyForm.taxId || !companyForm.email || !companyForm.phone) {
      showToast('Name, tax ID, email, and phone are required', 'error'); return
    }
    const company = createCompany({
      name: companyForm.name, taxId: companyForm.taxId, industry: companyForm.industry,
      email: companyForm.email, phone: companyForm.phone, website: companyForm.website,
      physicalAddress: companyForm.physicalAddress, city: companyForm.city, country: companyForm.country,
      paymentTerms: Number(companyForm.paymentTerms) || 30, creditLimit: Number(companyForm.creditLimit) || 0,
      accountManagerId: currentUserId ?? undefined, accountManagerName: currentUser?.name ?? undefined,
      tags: companyForm.tags.split(',').map(t => t.trim()).filter(Boolean), segment: companyForm.segment, status: 'active',
    })
    setOppForm(p => ({ ...p, companyId: company.id, companyName: company.name }))
    setShowOppCompanyModal(false)
    setCompanyForm({ name: '', taxId: '', industry: '', email: '', phone: '', website: '', physicalAddress: '', city: '', country: 'Kenya', paymentTerms: '30', creditLimit: '1000000', segment: 'sme', tags: '' })
  }

  const handleCreateContactForOpp = () => {
    if (!contactForm.companyId || !contactForm.firstName || !contactForm.lastName || !contactForm.email) {
      showToast('Company, first name, last name, and email are required', 'error'); return
    }
    const contact = createContactPerson({
      clientId: contactForm.companyId, companyId: contactForm.companyId, companyName: contactForm.companyName,
      firstName: contactForm.firstName, lastName: contactForm.lastName,
      jobTitle: contactForm.jobTitle, department: contactForm.department,
      email: contactForm.email, phone: contactForm.phone, mobile: contactForm.mobile,
      isPrimary: contactForm.isPrimary, isDecisionMaker: contactForm.isDecisionMaker,
      isBillingContact: contactForm.isBillingContact, isTechnicalContact: contactForm.isTechnicalContact,
      preferredChannel: contactForm.preferredChannel, linkedIn: contactForm.linkedIn, notes: contactForm.notes,
    })
    setOppForm(p => ({ ...p, contactPersonId: contact.id, contactPersonName: `${contact.firstName} ${contact.lastName}` }))
    setShowOppContactModal(false)
    setContactForm({ companyId: '', companyName: '', firstName: '', lastName: '', jobTitle: '', department: '', email: '', phone: '', mobile: '', isPrimary: false, isDecisionMaker: false, isBillingContact: false, isTechnicalContact: false, preferredChannel: 'email', linkedIn: '', notes: '' })
  }

  const handleLogActivity = () => {
    const oppId = activityForm.opportunityId || activeOppId;
    if (!oppId || !activityForm.subject) {
      showToast('Opportunity and subject are required', 'error')
      return
    }

    logActivity({
      opportunityId: oppId,
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
    const oppId = winForm.opportunityId || activeOppId;
    if (!oppId) return
    markOpportunityWon(oppId, Number(winForm.actualValue) || 0)
    setShowWinModal(false)
    setWinForm({ opportunityId: '', actualValue: '' })
  }

  const handleMarkLost = () => {
    const oppId = lostForm.opportunityId || activeOppId;
    if (!oppId || !lostForm.reason) {
      showToast('Reason is required', 'error')
      return
    }
    markOpportunityLost(oppId, lostForm.reason, lostForm.competitor)
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

  if (!mounted) return <ModuleSkeleton />

  const primaryCrmAction = (() => {
    if (tab === 'pipeline' && view === 'detail') {
      return (
        <PrimaryActionButton variant="secondary" onClick={() => setView('kanban')} hideLabelOnMobile={false}>
          Back to pipeline
        </PrimaryActionButton>
      )
    }
    if (tab === 'pipeline' && view !== 'detail') {
      return (
        <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => setShowNewOppModal(true)} hideLabelOnMobile={false}>
          New opportunity
        </PrimaryActionButton>
      )
    }
    if (tab === 'companies') {
      return (
        <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => setShowNewCompanyModal(true)} hideLabelOnMobile={false}>
          New company
        </PrimaryActionButton>
      )
    }
    if (tab === 'contacts') {
      return (
        <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => setShowNewContactModal(true)} hideLabelOnMobile={false}>
          New contact
        </PrimaryActionButton>
      )
    }
    if (tab === 'contracts') {
      return (
        <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={() => setShowContractModal(true)} hideLabelOnMobile={false}>
          New contract
        </PrimaryActionButton>
      )
    }
    return undefined
  })()

  const moduleHeader = (
    <>
      <ModuleHeader
        title="CRM and pipeline"
        subtitle={`${companies.length} ${companies.length === 1 ? 'company' : 'companies'} · ${fmtKes(totalPipelineValue)} pipeline`}
        icon={<Fa icon={faChartBar} />}
        count={pipelineOpps.length}
        color="var(--primary)"
        primaryAction={primaryCrmAction}
        overflowActions={tab === 'pipeline' && view !== 'detail' ? (
          <div className="flex items-center gap-1.5">
            {(['kanban', 'list'] as const).map(v => (
              <button type="button" key={v} onClick={() => setView(v)}
                className={`text-[11px] px-3 py-1.5 rounded-lg border font-medium capitalize cursor-pointer transition-colors ${view === v ? 'bg-primary text-white border-primary' : 'border-border text-text-2 hover:bg-surface'}`}>
                {v}
              </button>
            ))}
          </div>
        ) : undefined}
      />
      <TabBar
        tabs={[
          { id: 'pipeline', label: 'Pipeline' },
          ...(systemSettings?.crmLeads ? [{ id: 'leads' as const, label: 'Leads' }] : []),
          { id: 'companies', label: 'Companies' },
          { id: 'contacts', label: 'Contacts' },
          { id: 'activities', label: 'Activities' },
          { id: 'contracts', label: 'Contracts' },
          { id: 'sla', label: 'SLA tracker' },
        ]}
        active={tab}
        onChange={id => {
          const next = id as Tab
          setTab(next)
          if (next === 'pipeline') setView('kanban')
        }}
        maxVisibleMobile={4}
        maxVisibleTablet={5}
        maxVisibleDesktop={6}
        ariaLabel="CRM sections"
      />
    </>
  )

  // Pipeline Tab - Kanban Board
  if (tab === 'pipeline') {
    return (
      <div className="mod-page">
        {moduleHeader}
        <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">
        {/* pipeline content start */}
        {/* Owner filter (admin/finance only) */}
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap px-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-4)' }}>Viewing:</span>
            {[{ id: 'me', label: 'My Pipeline' }, { id: 'all', label: 'All Reps' }, ...salesReps.map(r => ({ id: r.id, label: r.name }))].map(opt => (
              <button key={opt.id} onClick={() => setOwnerFilter(opt.id)}
                style={{
                  fontSize: 11, padding: '5px 13px', borderRadius: 20, cursor: 'pointer',
                  background: ownerFilter === opt.id ? 'var(--info-bg)' : 'var(--bg-surface)',
                  border: `1px solid ${ownerFilter === opt.id ? '#C7D2FE' : 'var(--border-lt)'}`,
                  color: ownerFilter === opt.id ? '#4F46E5' : 'var(--text-4)', fontWeight: ownerFilter === opt.id ? 700 : 400,
                  transition: 'all 0.15s',
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Per-rep breakdown (admin, all-reps view) */}
        {isAdmin && ownerFilter === 'all' && repBreakdown.length > 0 && (
          <div className="card p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 pb-2 mb-1" style={{ borderBottom: '1px solid var(--bg-muted)' }}>
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
                    background: 'var(--primary)',
                  }} />
                </div>
                <span className="font-mono text-[11px] font-semibold text-t1 w-28 text-right">{fmtKes(rep.value)}</span>
                <span className="text-[10px] text-t3 w-20 text-right">{rep.count} deal{rep.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        )}

        {/* Sales analysis pivot */}
        {isAdmin && opportunities.length > 0 && (
          <div className="card p-4">
            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[var(--border-lt)]">
              <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--navy)' }} />
              <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--navy)]">Sales analysis — stage × owner (KES)</p>
            </div>
            <PivotView
              data={opportunities
                .filter(o => effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner)
                .map(o => ({
                  stage: stageLabels[o.stage] ?? o.stage,
                  owner: o.ownerName ?? 'Unassigned',
                  expectedValue: o.expectedValue,
                }))}
              rowKey="stage"
              colKey="owner"
              valueKey="expectedValue"
              rowLabel="Stage"
              colLabel="Owner"
              formatValue={n => fmtKes(n)}
            />
          </div>
        )}

        {/* Kanban Board */}
        {view === 'kanban' && (
          <PipelineKanban
            effectiveOwner={effectiveOwner}
            stageLabels={stageLabels}
            onSelectOpp={(id) => { setActiveOppId(id); setView('detail') }}
          />
        )}

        {/* List View */}
        {view === 'list' && (
          <div className="card overflow-hidden">
            <PanelHeader title="All Opportunities" count={opportunities.filter(o => {
              const s = oppSearch.toLowerCase()
              const ownerMatch = effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner
              return ownerMatch && (!s || (o.ref ?? '').toLowerCase().includes(s) || o.name.toLowerCase().includes(s) ||
                (o.companyName ?? '').toLowerCase().includes(s) || (o.contactPersonName ?? '').toLowerCase().includes(s) || (o.ownerName ?? '').toLowerCase().includes(s))
            }).length}>
              <input aria-label="Search opportunities" className="form-input text-[11px] py-1.5" style={{ width: 220 }}
                placeholder="Search ref, name, company…" value={oppSearch} onChange={e => setOppSearch(e.target.value)} />
            </PanelHeader>
            <div className="w-full">
              <div className="flex flex-col">
              {opportunities.filter(o => {
                const s = oppSearch.toLowerCase()
                const ownerMatch = effectiveOwner === 'all' ? true : o.ownerId === effectiveOwner
                return ownerMatch && (!s || (o.ref ?? '').toLowerCase().includes(s) || o.name.toLowerCase().includes(s) ||
                  (o.companyName ?? '').toLowerCase().includes(s) || (o.contactPersonName ?? '').toLowerCase().includes(s) || (o.ownerName ?? '').toLowerCase().includes(s))
              }).map(opp => {
                const company = companies.find(c => c.id === (opp.companyId ?? opp.clientId))
                const oppQuotes = quotes.filter(q => (opp.quoteIds ?? []).includes(q.id))

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
                          Owner: {opp.ownerName ?? ''} · Close: {fmtDate(opp.expectedCloseDate ?? '')}
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
                            {oppQuotes.length} quote{oppQuotes.length > 1 ? 's' : ''} · Last: {oppQuotes[0].quoteNumber}
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
          </div>
        )}

        {/* Detail View */}
        {view === 'detail' && activeOpp && (
          <OpportunityDetail
            activeOppId={activeOppId}
            onClose={() => setView('kanban')}
            stageLabels={stageLabels}
            onMarkWon={() => setShowWinModal(true)}
            onMarkLost={() => setShowLostModal(true)}
            onLogActivity={() => setShowActivityModal(true)}
          />
        )}

        {/* Modals */}
        {showNewOppModal && (
          <Modal title="New Opportunity" onClose={() => setShowNewOppModal(false)} width={600}>
            <Field label="Opportunity Name"><Input value={oppForm.name} onChange={v => setOppForm(p => ({ ...p, name: v }))} placeholder="e.g. 50 Laptops for HQ" /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Field label="Company">
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <Select value={oppForm.companyId} onChange={v => { const c = companies.find(x => x.id === v); setOppForm(p => ({ ...p, companyId: v, companyName: c?.name || '' })) }} options={[{value:'', label:'Select...'}, ...companies.map(c => ({value:c.id, label:c.name}))]} />
                  </div>
                  <button type="button" className="btn-outline text-xs px-2 py-1 whitespace-nowrap" onClick={() => setShowOppCompanyModal(true)}>+ New</button>
                </div>
              </Field>
              <Field label="Contact Person">
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <Select value={oppForm.contactPersonId} onChange={v => { const c = contactPersons.find(x => x.id === v); setOppForm(p => ({ ...p, contactPersonId: v, contactPersonName: c ? `${c.firstName} ${c.lastName}` : '' })) }} options={[{value:'', label:'Select...'}, ...contactPersons.filter(c => (c.companyId ?? c.clientId) === oppForm.companyId).map(c => ({value:c.id, label:`${c.firstName} ${c.lastName}`}))]} />
                  </div>
                  <button type="button" className="btn-outline text-xs px-2 py-1 whitespace-nowrap" onClick={() => { setContactForm(p => ({ ...p, companyId: oppForm.companyId, companyName: oppForm.companyName })); setShowOppContactModal(true) }}>+ New</button>
                </div>
              </Field>
              <Field label="Expected Value (KES)"><Input type="number" value={oppForm.expectedValue} onChange={v => setOppForm(p => ({ ...p, expectedValue: v }))} /></Field>
              <Field label="Expected Close Date"><Input type="date" value={oppForm.expectedCloseDate} onChange={v => setOppForm(p => ({ ...p, expectedCloseDate: v }))} /></Field>
            </div>
            <Field label="Description">
              <Textarea value={oppForm.description} onChange={v => setOppForm(p => ({ ...p, description: v }))} rows={2} />
            </Field>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowNewOppModal(false)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => { void handleCreateOpportunity() }}
                disabled={creatingOpp || !oppForm.name || !oppForm.companyId || !oppForm.contactPersonId}
              >
                {creatingOpp ? 'Creating…' : 'Create Opportunity'}
              </button>
            </div>
          </Modal>
        )}
        {showOppCompanyModal && (
          <Modal title="Add Company" onClose={() => setShowOppCompanyModal(false)} width={600}>
            <Field label="Company Name" required><Input value={companyForm.name} onChange={v => setCompanyForm(p => ({...p, name: v}))} placeholder="ABC Corporation Ltd" /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Field label="Email" required><Input type="email" value={companyForm.email} onChange={v => setCompanyForm(p => ({...p, email: v}))} /></Field>
              <Field label="Phone" required><Input value={companyForm.phone} onChange={v => setCompanyForm(p => ({...p, phone: v}))} type="tel" /></Field>
              <Field label="Tax ID / PIN" required><Input value={companyForm.taxId} onChange={v => setCompanyForm(p => ({...p, taxId: v}))} placeholder="P051234567A" /></Field>
              <Field label="Industry"><Input value={companyForm.industry} onChange={v => setCompanyForm(p => ({...p, industry: v}))} /></Field>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowOppCompanyModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateCompanyForOpp}>Create & Select</button>
            </div>
          </Modal>
        )}
        {showOppContactModal && (
          <Modal title="Add Contact Person" onClose={() => setShowOppContactModal(false)} width={600}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Company" required>
                <Select value={contactForm.companyId} onChange={v => { const c = companies.find(x => x.id === v); setContactForm(p => ({ ...p, companyId: v, companyName: c?.name || '' })) }} options={[{value:'', label:'Select...'}, ...companies.map(c => ({value:c.id, label:c.name}))]} />
              </Field>
              <Field label="Job Title" required><Input value={contactForm.jobTitle} onChange={v => setContactForm(p => ({...p, jobTitle: v}))} placeholder="e.g. IT Manager" /></Field>
              <Field label="First Name" required><Input value={contactForm.firstName} onChange={v => setContactForm(p => ({...p, firstName: v}))} /></Field>
              <Field label="Last Name" required><Input value={contactForm.lastName} onChange={v => setContactForm(p => ({...p, lastName: v}))} /></Field>
              <Field label="Email" required><Input type="email" value={contactForm.email} onChange={v => setContactForm(p => ({...p, email: v}))} /></Field>
              <Field label="Phone"><Input value={contactForm.phone} onChange={v => setContactForm(p => ({...p, phone: v}))} type="tel" /></Field>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowOppContactModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleCreateContactForOpp}>Create & Select</button>
            </div>
          </Modal>
        )}
        {showActivityModal && activeOpp && (
          <Modal title="Log Activity" onClose={() => setShowActivityModal(false)} width={500}>
            <Field label="Type">
              <Select value={activityForm.type} onChange={v => setActivityForm(p => ({...p, type: v as any}))} options={[{value:'call',label:'Call'},{value:'email',label:'Email'},{value:'meeting',label:'Meeting'}]} />
            </Field>
            <Field label="Subject"><Input value={activityForm.subject} onChange={v => setActivityForm(p => ({...p, subject: v}))} /></Field>
            <Field label="Description"><Textarea value={activityForm.description} onChange={v => setActivityForm(p => ({...p, description: v}))} rows={3} /></Field>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowActivityModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleLogActivity} disabled={!activityForm.subject}>Save Activity</button>
            </div>
          </Modal>
        )}
        {showWinModal && activeOpp && (
          <Modal title="Mark as Won" onClose={() => setShowWinModal(false)}>
            <Field label="Actual Value (KES)">
              <Input type="number" value={winForm.actualValue || String(activeOpp.expectedValue)} onChange={v => setWinForm(p => ({...p, actualValue: v}))} />
            </Field>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowWinModal(false)}>Cancel</button>
              <button className="btn-primary" style={{ background: 'var(--success)' }} onClick={handleMarkWon}>Confirm Won</button>
            </div>
          </Modal>
        )}
        {showLostModal && activeOpp && (
          <Modal title="Mark as Lost" onClose={() => setShowLostModal(false)}>
            <Field label="Reason"><Input value={lostForm.reason} onChange={v => setLostForm(p => ({...p, reason: v}))} /></Field>
            <Field label="Competitor (optional)"><Input value={lostForm.competitor} onChange={v => setLostForm(p => ({...p, competitor: v}))} /></Field>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowLostModal(false)}>Cancel</button>
              <button className="btn-primary" style={{ background: 'var(--danger)' }} onClick={handleMarkLost}>Confirm Lost</button>
            </div>
          </Modal>
        )}
        </div>{/* pipeline content end */}
      </div>
    )
  }

  if (tab === 'leads' && systemSettings?.crmLeads) {
    return (
      <div className="mod-page">
        {moduleHeader}
        <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">
          <LeadsPanel
            showToast={showToast}
            salesReps={salesReps}
            currentUserId={currentUserId ?? undefined}
            onConverted={opportunityId => {
              // Server broadcasts deed_opportunities; SSE refreshes the store.
              setTab('pipeline')
              setActiveOppId(opportunityId)
              setView('detail')
            }}
          />
        </div>
      </div>
    )
  }

  // Contracts Tab
  if (tab === 'contracts') {
    return (
      <div className="mod-page">
        {moduleHeader}
        <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

        <div className="card overflow-hidden">
          <PanelHeader title="Customer Contracts" count={customerContracts.filter(c => {
            const s = contractSearch.toLowerCase()
            return !s || c.ref.toLowerCase().includes(s) || c.companyName.toLowerCase().includes(s) ||
              c.type.toLowerCase().includes(s) || c.contactPersonName.toLowerCase().includes(s)
          }).length}>
            <input aria-label="Search contracts" className="form-input text-[11px] py-1.5" style={{ width: 200 }}
              placeholder="Search ref, company…" value={contractSearch} onChange={e => setContractSearch(e.target.value)} />
          </PanelHeader>
          <div className="w-full">
            <div className="flex flex-col divide-y divide-gray-100">
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
        </div>

        {showContractModal && (
          <Modal title="New Contract" onClose={() => setShowContractModal(false)} width={600}>
             <Field label="Company">
               <Select value={contractForm.companyId} onChange={v => { const c = companies.find(x => x.id === v); setContractForm(p => ({ ...p, companyId: v, companyName: c?.name || '' })) }} options={[{value:'', label:'Select...'}, ...companies.map(c => ({value:c.id, label:c.name}))]} />
             </Field>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
               <Field label="Contact Person">
                 <Select value={contractForm.contactPersonId} onChange={v => { const c = contactPersons.find(x => x.id === v); setContractForm(p => ({ ...p, contactPersonId: v, contactPersonName: c ? `${c.firstName} ${c.lastName}` : '' })) }} options={[{value:'', label:'Select...'}, ...contactPersons.filter(c => (c.companyId ?? c.clientId) === contractForm.companyId).map(c => ({value:c.id, label:`${c.firstName} ${c.lastName}`}))]} />
               </Field>
               <Field label="Contract Value (KES)"><Input type="number" value={contractForm.contractValue} onChange={v => setContractForm(p => ({...p, contractValue: v}))} /></Field>
               <Field label="Start Date"><Input type="date" value={contractForm.startDate} onChange={v => setContractForm(p => ({...p, startDate: v}))} /></Field>
               <Field label="End Date"><Input type="date" value={contractForm.endDate} onChange={v => setContractForm(p => ({...p, endDate: v}))} /></Field>
             </div>
             <div className="flex gap-2 justify-end mt-4">
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
      <div className="mod-page">
        {moduleHeader}
        <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

        {/* Company List */}
        <div className="card overflow-hidden">
          <DataTable
            tableId="crm_companies"
            columns={companyColumns}
            rows={companies}
            rowKey={company => company.id}
            searchPlaceholder="Search companies..."
            emptyMessage="No companies found"
            onRowClick={company => {
              setActiveCompanyId(company.id)
              setShowClientDetail(true)
            }}
            exportTitle="CRM Companies"
            exportFilename="crm-companies"
          />
        </div>

        {showNewCompanyModal && (
          <Modal title="New Company" onClose={() => setShowNewCompanyModal(false)} width={600}>
             <Field label="Company Name"><Input value={companyForm.name} onChange={v => setCompanyForm(p => ({...p, name: v}))} /></Field>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
               <Field label="Email"><Input value={companyForm.email} onChange={v => setCompanyForm(p => ({...p, email: v}))} type="email" maxLength={100} /></Field>
               <Field label="Phone"><Input value={companyForm.phone} onChange={v => setCompanyForm(p => ({...p, phone: v}))} type="tel" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" /></Field>
               <Field label="Tax ID"><Input value={companyForm.taxId} onChange={v => setCompanyForm(p => ({...p, taxId: v}))} /></Field>
               <Field label="Industry"><Input value={companyForm.industry} onChange={v => setCompanyForm(p => ({...p, industry: v}))} /></Field>
             </div>
             <div className="flex gap-2 justify-end mt-4">
               <button className="btn-outline" onClick={() => setShowNewCompanyModal(false)}>Cancel</button>
               <button className="btn-primary" onClick={handleCreateCompany}>Create Company</button>
             </div>
          </Modal>
        )}
        
        {showClientDetail && activeCompanyId && (
          <SlidePanel title="Company Insights" onClose={() => setShowClientDetail(false)}>
            <div className="p-6">
              <ClientDetail clientId={activeCompanyId} onClose={() => setShowClientDetail(false)} />
            </div>
          </SlidePanel>
        )}
        </div>
      </div>
    )
  }

  // Contacts Tab
  if (tab === 'contacts') {
    return (
      <div className="mod-page">
        {moduleHeader}
        <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

        {/* Contact List */}
        <div className="card overflow-hidden">
          <DataTable
            tableId="crm_contacts"
            columns={contactColumns}
            rows={contactPersons}
            rowKey={contact => contact.id}
            searchPlaceholder="Search contacts..."
            emptyMessage="No contacts found"
            exportTitle="CRM Contacts"
            exportFilename="crm-contacts"
          />
        </div>

        {showNewContactModal && (
          <Modal title="New Contact" onClose={() => setShowNewContactModal(false)} width={600}>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
               <Field label="Company">
                 <Select value={contactForm.companyId} onChange={v => { const c = companies.find(x => x.id === v); setContactForm(p => ({ ...p, companyId: v, companyName: c?.name || '' })) }} options={[{value:'', label:'Select...'}, ...companies.map(c => ({value:c.id, label:c.name}))]} />
               </Field>
               <Field label="Job Title"><Input value={contactForm.jobTitle} onChange={v => setContactForm(p => ({...p, jobTitle: v}))} /></Field>
               <Field label="First Name"><Input value={contactForm.firstName} onChange={v => setContactForm(p => ({...p, firstName: v}))} /></Field>
               <Field label="Last Name"><Input value={contactForm.lastName} onChange={v => setContactForm(p => ({...p, lastName: v}))} /></Field>
               <Field label="Email"><Input value={contactForm.email} onChange={v => setContactForm(p => ({...p, email: v}))} type="email" maxLength={100} /></Field>
               <Field label="Phone"><Input value={contactForm.phone} onChange={v => setContactForm(p => ({...p, phone: v}))} type="tel" maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" /></Field>
             </div>
             <div className="flex gap-2 justify-end mt-4">
               <button className="btn-outline" onClick={() => setShowNewContactModal(false)}>Cancel</button>
               <button className="btn-primary" onClick={handleCreateContact}>Create Contact</button>
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
      <div className="mod-page">
        {moduleHeader}
        <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">
        <div className="card overflow-hidden">
          <PanelHeader title="All Activities" count={opportunityActivities.filter(a => {
            const s = activitySearch.toLowerCase()
            return !s || (a.subject ?? '').toLowerCase().includes(s) || a.type.toLowerCase().includes(s) ||
              (a.createdByName ?? '').toLowerCase().includes(s)
          }).length}>
            <input aria-label="Search CRM activities" className="form-input text-[11px] py-1.5" style={{ width: 200 }}
              placeholder="Search subject, type…" value={activitySearch} onChange={e => setActivitySearch(e.target.value)} />
          </PanelHeader>
          <div className="w-full">
            <div className="flex flex-col divide-y divide-gray-100">
            {opportunityActivities.filter(a => {
              const s = activitySearch.toLowerCase()
              return !s || (a.subject ?? '').toLowerCase().includes(s) || a.type.toLowerCase().includes(s) ||
                (a.createdByName ?? '').toLowerCase().includes(s)
            }).map(activity => {
              const opp = opportunities.find(o => o.id === activity.opportunityId)
              return (
                <div key={activity.id} className="p-4 transition-colors" onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#F8F9FC'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=''}}>
                  <div className="flex items-start gap-3">
                    <span style={{ fontSize: 18, color: 'var(--text-3)' }} aria-hidden="true">
                      <Fa icon={ACTIVITY_ICONS[activity.type] ?? faNoteSticky} />
                    </span>
                    <div className="flex-1">
                      <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-1)' }}>
                        {activity.subject}
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        {opp?.ref} · {opp?.name}
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                        {activity.createdByName ?? ''} · {fmtDate(activity.createdDate ?? activity.createdAt)}
                      </div>
                    </div>
                    {activity.status && <Badge status={activity.status} label={activity.status} size="xs" />}
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        </div>
        </div>
      </div>
    )
  }

  // SLA Tracker Tab
  if (tab === 'sla') {
    return (
      <div className="mod-page">
        {moduleHeader}
        <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Active Contracts Table */}
            <div className="card overflow-hidden">
              <PanelHeader title="Active SLA Contracts" count={activeSLAContracts.length} />
              <DataTable
                tableId="crm-sla-contracts"
                columns={[
                  { key: 'company', label: 'Company', priority: 1, width: '1fr', render: c => <span className="font-semibold text-t1 truncate">{c.companyName}</span>, exportValue: c => c.companyName },
                  { key: 'tier', label: 'Tier', priority: 1, width: '100px', render: c => <span className="text-xs uppercase font-bold" style={{ color: c.slaTier === 'platinum' ? 'var(--text-4)' : c.slaTier === 'gold' ? 'var(--warning)' : c.slaTier === 'silver' ? 'var(--text-4)' : 'var(--warning)' }}>{c.slaTier}</span>, exportValue: c => c.slaTier || '' },
                  { key: 'response', label: 'Response', priority: 2, width: '90px', render: c => <span className="text-xs text-t3">{c.responseTimeHours}h</span>, exportValue: c => c.responseTimeHours ?? '' },
                  { key: 'resolution', label: 'Resolution', priority: 2, width: '90px', render: c => <span className="text-xs text-t3">{c.resolutionTimeHours}h</span>, exportValue: c => c.resolutionTimeHours ?? '' },
                ]}
                rows={activeSLAContracts}
                rowKey={c => c.id}
                hideSearch
                emptyMessage="No active SLA contracts found"
                exportTitle="Active SLA Contracts"
                exportFilename="sla-contracts"
              />
            </div>

            {/* Recent SLA Breaches Table */}
            <div className="card overflow-hidden">
              <PanelHeader title="Recent SLA Breaches" count={missedSLAs.length} />
              <DataTable
                tableId="crm-sla-breaches"
                columns={[
                  { key: 'ref', label: 'Ref', priority: 1, width: '100px', render: r => <span className="font-mono text-[11px] font-semibold text-red-600">{r.ref}</span>, exportValue: r => r.ref },
                  { key: 'company', label: 'Company', priority: 1, width: '1.5fr', render: r => <span className="text-xs font-medium text-t1 truncate">{r.customerName}</span>, exportValue: r => r.customerName },
                  { key: 'status', label: 'Status', priority: 1, width: '1fr', render: r => <Badge status={r.status} size="xs" />, accessor: r => r.status, exportValue: r => r.status },
                  { key: 'deadline', label: 'Deadline', priority: 2, width: '100px', render: r => <span className="text-xs font-bold text-red-600">{r.slaDeadline ? fmtDate(r.slaDeadline) : 'Missed'}</span>, exportValue: r => r.slaDeadline || 'Missed' },
                ]}
                rows={missedSLAs}
                rowKey={r => r.id}
                hideSearch
                emptyMessage="No SLA breaches"
                exportTitle="SLA Breaches"
                exportFilename="sla-breaches"
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Default
  return null
}

function PipelineKanban({ effectiveOwner, stageLabels, onSelectOpp }: { effectiveOwner: string, stageLabels: Record<string, string>, onSelectOpp: (id: string) => void }) {
  const { opportunities } = useCrmStore()
  const stages: OpportunityStage[] = ['prospecting', 'qualification', 'proposal', 'negotiation']

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 h-full">
      {stages.map(stage => {
        const opps = opportunities.filter(o => o.stage === stage && (effectiveOwner === 'all' || o.ownerId === effectiveOwner))
        return (
          <div key={stage} className="flex-shrink-0 w-72 flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[stage] }} />
                <span className="text-sm font-bold text-t1">{stageLabels[stage]}</span>
                <span className="text-xs text-t3">{opps.length}</span>
              </div>
              <span className="text-xs font-semibold text-t2">{fmtKes(opps.reduce((s, o) => s + o.expectedValue, 0))}</span>
            </div>
            <div className="flex flex-col gap-2">
              {opps.map(opp => (
                <div key={opp.id} className="card p-3 cursor-pointer hover:shadow-md transition-shadow border-t-[3px]"
                  style={{ borderTopColor: STAGE_COLORS[stage] }}
                  onClick={() => onSelectOpp(opp.id)}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-xs text-t1">{opp.name}</span>
                    <span className="text-[10px] text-t3">{(opp.probability ?? 0)}%</span>
                  </div>
                  <div className="text-xs text-t2 mb-2">{opp.companyName}</div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-mono font-semibold" style={{ color: 'var(--navy)' }}>{fmtKes(opp.expectedValue)}</span>
                    <span className="text-t3">{fmtDate(opp.expectedCloseDate ?? '')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OpportunityDetail({ activeOppId, onClose, stageLabels, onMarkWon, onMarkLost, onLogActivity }: any) {
  const { opportunities, opportunityActivities, quotes, moveOpportunityStage } = useCrmStore()
  const opp = opportunities.find(o => o.id === activeOppId)
  if (!opp) return null

  const acts = opportunityActivities.filter(a => a.opportunityId === opp.id).sort((a,b) => (b.createdDate ?? b.createdAt).localeCompare(a.createdDate ?? a.createdAt))
  const oppQuotes = quotes.filter(q => (opp.quoteIds ?? []).includes(q.id))

  return (
    <div className="card p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 border-b pb-3" style={{ borderColor: 'var(--border-lt)' }}>
        <button className="btn-outline text-[11px] py-1 px-2.5" onClick={onClose}>← Back</button>
        <span className="text-sm font-bold text-t1">{opp.ref}</span>
        <Badge status={opp.stage} label={stageLabels[opp.stage]} />
        <div className="ml-auto flex gap-2">
          {!['closed_won', 'closed_lost'].includes(opp.stage) && (
            <>
              <button className="btn-primary" style={{ background: 'var(--success)' }} onClick={onMarkWon}>✓ Mark Won</button>
              <button className="btn-outline" style={{ color: 'var(--danger)', borderColor: '#FCA5A5' }} onClick={onMarkLost}>✗ Mark Lost</button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="col-span-1 lg:col-span-2 flex flex-col gap-4">
          <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
            <h3 className="text-lg font-bold mb-1">{opp.name}</h3>
            <p className="text-xs text-t2 mb-4">{opp.companyName} · {opp.contactPersonName}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] text-t3 uppercase">Expected Revenue</p>
                <p className="font-mono text-sm font-semibold">{fmtKes(opp.expectedValue)}</p>
              </div>
              <div>
                <p className="text-[10px] text-t3 uppercase">Probability</p>
                <p className="font-mono text-sm font-semibold">{opp.probability}%</p>
              </div>
              <div>
                <p className="text-[10px] text-t3 uppercase">Expected Close</p>
                <p className="text-sm font-semibold">{fmtDate(opp.expectedCloseDate ?? '')}</p>
              </div>
            </div>
            {opp.description && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                <p className="text-[10px] text-t3 uppercase mb-1">Description</p>
                <p className="text-xs text-t1">{opp.description}</p>
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border-lt)' }}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold">Activities</h4>
              <button className="btn-outline text-[10px] py-1 px-2" onClick={onLogActivity}>+ Log Activity</button>
            </div>
            <div className="flex flex-col gap-2">
              {acts.length === 0 ? <p className="text-xs text-t3">No activities logged</p> : acts.map(a => (
                <div key={a.id} className="p-2 rounded-lg bg-gray-50 border border-gray-100 flex gap-3 text-xs">
                  <span className="text-lg text-t3" aria-hidden="true"><Fa icon={ACTIVITY_ICONS[a.type] ?? faNoteSticky} /></span>
                  <div>
                    <p className="font-semibold">{a.subject ?? a.type}</p>
                    <p className="text-[10px] text-t3">{fmtDate(a.createdDate ?? a.createdAt)} by {a.createdByName ?? ''}</p>
                    {a.description && <p className="text-t2 mt-1">{a.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border-lt)' }}>
            <h4 className="text-sm font-bold mb-3">Stage</h4>
            <div className="flex flex-col gap-2">
              {STAGE_ORDER.map(s => (
                <button key={s}
                  onClick={() => moveOpportunityStage(opp.id, s)}
                  className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors ${opp.stage === s ? 'bg-blue-50 border-blue-200 text-blue-800 font-bold' : 'bg-transparent border-transparent text-t2 hover:bg-gray-50'}`}>
                  {stageLabels[s]}
                </button>
              ))}
            </div>
          </div>
          
          <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border-lt)' }}>
            <h4 className="text-sm font-bold mb-3">Quotes ({oppQuotes.length})</h4>
            <div className="flex flex-col gap-2 text-xs">
              {oppQuotes.map(q => (
                <div key={q.id} className="flex justify-between items-center p-2 bg-gray-50 rounded border border-gray-100">
                  <span className="font-mono text-blue-600">{q.quoteNumber}</span>
                  <span className="font-mono font-semibold">{fmtKes(q.totalAmount)}</span>
                </div>
              ))}
              {oppQuotes.length === 0 && <p className="text-t3">No quotes yet</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
