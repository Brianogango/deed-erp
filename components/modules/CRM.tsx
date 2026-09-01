'use client'
import { useState, useMemo, useEffect, Suspense, useCallback, useRef, startTransition } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useCrmStore, OpportunityStage, LeadSource, fmtKes, fmtDate } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Textarea, PanelHeader, ModuleSkeleton, SlidePanel, useMounted, TabBar, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import ClientDetail from '@/components/crm/ClientDetail'
import LeadsPanel from '@/components/crm/LeadsPanel'
import EmailReviewPanel from '@/components/crm/EmailReviewPanel'
import DuplicateContactsPanel from '@/components/crm/DuplicateContactsPanel'
import { PivotView } from '@/components/erp/PivotView'
import { DataTable, type ColumnDef } from '@/components/data-table'
import {
  Fa, faChartBar, faMoneyBillWave, faArrowTrendUp, faBullseye, faCircleCheck,
  faFileSignature, faScrewdriverWrench, faTriangleExclamation, faChartLine, faPlus,
  faPhone, faEnvelope, faHandshake, faClipboardList, faNoteSticky,
} from '@/components/icons'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { useUrlRecordId, useUrlUiState } from '@/hooks/useUrlRecordId'
import { isLeadAssigneeRole } from '@/lib/crm/lead-assignees'
import { opportunityMatchesOwner } from '@/lib/opportunity-normalization'

const ACTIVITY_ICONS: Record<string, IconProp> = {
  call: faPhone,
  email: faEnvelope,
  meeting: faHandshake,
  demo: faBullseye,
  proposal: faClipboardList,
  note: faNoteSticky,
  task: faCircleCheck,
}

type Tab = 'pipeline' | 'opportunities' | 'companies' | 'contacts' | 'activities' | 'contracts' | 'sla' | 'leads' | 'email_review' | 'dup_contacts'
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
  qualification: 'var(--info)',
  proposal: 'var(--warning)',
  negotiation: 'var(--primary)',
  closed_won: 'var(--success)',
  closed_lost: 'var(--danger)',
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

function formatOptionalDate(value?: string | null) {
  const normalized = value?.trim()
  if (!normalized) return 'Not set'
  return Number.isNaN(new Date(normalized).getTime()) ? 'Not set' : fmtDate(normalized)
}

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
    createOpportunity, updateOpportunity, ingestOpportunity, moveOpportunityStage, markOpportunityWon, markOpportunityLost, deleteOpportunity,
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
  /** Blocks stale URL→local sync while a tab click's router.replace is in flight. */
  const pendingTabRef = useRef<Tab | null>(null)

  const setTab = (newTab: Tab) => {
    pendingTabRef.current = newTab
    setLocalTab(newTab)

    if (newTab !== 'pipeline') {
      setLocalActiveOppId(null)
      setLocalView('kanban')
      // One URL write: set crmTab + clear opportunity id. Never call setUrlOppId(null)
      // separately — that rebuilds from stale searchParams and can clobber crmTab
      // back to pipeline (Pipeline → Leads appearing broken).
      setUrlOppId(null, { queryPatch: { crmTab: newTab } })
      return
    }

    const params = new URLSearchParams(searchParams.toString())
    params.set('crmTab', newTab)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    })
  }

  useEffect(() => {
    const rawUrlTab = searchParams.get('crmTab') as Tab | null
    const urlTab: Tab | null = rawUrlTab === 'opportunities' ? 'pipeline' : rawUrlTab
    const effectiveUrlTab = urlTab ?? defaultTab

    if (pendingTabRef.current) {
      if (effectiveUrlTab === pendingTabRef.current) {
        pendingTabRef.current = null
      }
      // Ignore stale URL while our navigation is in flight (competing replaces).
      return
    }

    if (effectiveUrlTab !== tab) {
      setLocalTab(effectiveUrlTab)
    }
  }, [searchParams, tab, defaultTab])

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
  // List controls are URL-backed with replace history so opening an opportunity
  // and pressing Back restores the exact pipeline/search scope.
  const [ownerFilter, setOwnerFilter] = useUrlUiState('owner', 'all')
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null)
  const [showClientDetail, setShowClientDetail] = useState(false)

  // Search state is kept independently per CRM workspace so switching tabs does
  // not carry an unrelated query into the next list.
  const [oppSearch, setOppSearch] = useUrlUiState('pipelineQ', '')
  const [contractSearch, setContractSearch] = useUrlUiState('contractQ', '')
  const [activitySearch, setActivitySearch] = useUrlUiState('activityQ', '')
  
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
      // Clear local detail only. URL id is already stripped in setTab's single
      // replace; calling setUrlOppId(null) here races and can restore crmTab=pipeline.
      if (activeOppId) setLocalActiveOppId(null)
      if (view === 'detail') setLocalView('kanban')
      if (searchParams.get('id')) {
        setUrlOppId(null, {
          queryPatch: { crmTab: tab !== 'pipeline' && tab !== 'opportunities' ? tab : (urlTab || 'pipeline') },
        })
      } else {
        setUrlOppId(null, { localOnly: true })
      }
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
    opportunityMatchesOwner(o, effectiveOwner)
  )
  const totalPipelineValue = pipelineOpps.reduce((sum, o) => sum + o.expectedValue, 0)
  const weightedPipelineValue = pipelineOpps.reduce((sum, o) => sum + (o.expectedValue * o.probability / 100), 0)
  const todayIso = new Date().toISOString().slice(0, 10)
  const followUpsDue = opportunityActivities.filter(activity =>
    activity.status === 'scheduled'
    && Boolean(activity.scheduledDate)
    && String(activity.scheduledDate).slice(0, 10) <= todayIso
    && pipelineOpps.some(opp => opp.id === activity.opportunityId)
  ).length

  const wonOpps = opportunities.filter(o =>
    o.stage === 'closed_won' && opportunityMatchesOwner(o, effectiveOwner)
  )
  const lostOpps = opportunities.filter(o =>
    o.stage === 'closed_lost' && opportunityMatchesOwner(o, effectiveOwner)
  )
  const totalClosed = wonOpps.length + lostOpps.length
  const winRate = totalClosed > 0 ? Math.round((wonOpps.length / totalClosed) * 100) : 0

  // Lead / pipeline assignees: directors + sales reps (not sales-only — that
  // forced every inbound lead onto the sole sales_rep).
  const salesReps = users.filter(u =>
    isLeadAssigneeRole(u.role)
    || opportunities.some(o => o.ownerId === u.id || o.assignedToId === u.id),
  )
  const repBreakdown = salesReps.map(rep => {
    const repOpps = opportunities.filter(o => !['closed_won', 'closed_lost'].includes(o.stage) && opportunityMatchesOwner(o, rep.id))
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
        title="CRM & Pipeline"
        subtitle={`${companies.length} ${companies.length === 1 ? 'company' : 'companies'} · ${fmtKes(totalPipelineValue)} pipeline`}
        icon={<Fa icon={faChartBar} />}
        count={pipelineOpps.length}
        color="var(--primary)"
        primaryAction={primaryCrmAction}
        overflowActions={tab === 'pipeline' && view !== 'detail' ? (
          <div className="crm-view-toggle">
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
          ...(systemSettings?.crmLeads ? [
            { id: 'leads' as const, label: 'Leads' },
            { id: 'email_review' as const, label: 'Email review' },
            { id: 'dup_contacts' as const, label: 'Duplicates' },
          ] : []),
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
        maxVisibleTablet={6}
        maxVisibleDesktop={9}
        ariaLabel="CRM sections"
      />
    </>
  )

  // Pipeline Tab - Kanban Board
  if (tab === 'pipeline') {
    return (
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className={`mod-body crm-body crm-pipeline-body crm-pipeline-body--${view} p-3 sm:p-4 flex flex-col gap-4`}>
        {/* pipeline content start */}
        <section className="crm-metric-strip" aria-label="Pipeline at a glance">
          <div className="crm-metric">
            <span>Open pipeline</span>
            <strong>{fmtKes(stats.pipelineValue)}</strong>
            <small>{stats.totalPipeline} active opportunit{stats.totalPipeline === 1 ? 'y' : 'ies'}</small>
          </div>
          <div className="crm-metric">
            <span>Weighted value</span>
            <strong>{fmtKes(stats.weightedValue)}</strong>
            <small>Probability adjusted</small>
          </div>
          <div className="crm-metric crm-metric--attention">
            <span>Follow-ups due</span>
            <strong>{followUpsDue}</strong>
            <small>{followUpsDue === 0 ? 'Nothing overdue' : 'Needs attention'}</small>
          </div>
          <div className="crm-metric crm-metric--success">
            <span>Win rate</span>
            <strong>{stats.winRate}%</strong>
            <small>{totalClosed} closed opportunit{totalClosed === 1 ? 'y' : 'ies'}</small>
          </div>
        </section>
        {/* Owner filter (admin/finance only) */}
        {isAdmin && (
          <div className="crm-pipeline-toolbar">
            <label className="crm-owner-select">
              <span>Owner</span>
              <select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}>
                <option value="me">My pipeline</option>
                <option value="all">All reps</option>
                {salesReps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {/* Analysis stays available without competing with daily pipeline work. */}
        {isAdmin && opportunities.length > 0 && (
          <details className="crm-analysis">
            <summary>Pipeline analysis</summary>
            <div className="crm-analysis__grid">
              {ownerFilter === 'all' && repBreakdown.length > 0 && (
                <div className="crm-analysis__panel">
                  <h3>Pipeline value by rep</h3>
                  <div className="crm-analysis__rows">
                    {repBreakdown.map(rep => (
                      <button key={rep.id} type="button" className="crm-analysis__row" onClick={() => setOwnerFilter(rep.id)}>
                        <span>{rep.name}</span>
                        <i><b style={{ width: `${totalPipelineValue > 0 ? Math.round(rep.value / totalPipelineValue * 100) : 0}%` }} /></i>
                        <strong>{fmtKes(rep.value)}</strong>
                        <small>{rep.count} deal{rep.count !== 1 ? 's' : ''}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="crm-analysis__panel">
                <h3>Stage × owner</h3>
                <PivotView
                  data={opportunities
                    .filter(o => opportunityMatchesOwner(o, effectiveOwner))
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
            </div>
          </details>
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
          <div className="card overflow-hidden crm-opportunity-list">
            <PanelHeader title="All Opportunities" count={opportunities.filter(o => {
              const term = oppSearch.toLowerCase()
              const ownerMatch = opportunityMatchesOwner(o, effectiveOwner)
              return ownerMatch && (!term || (o.ref ?? '').toLowerCase().includes(term) || o.name.toLowerCase().includes(term) ||
                (o.companyName ?? '').toLowerCase().includes(term) || (o.contactPersonName ?? '').toLowerCase().includes(term) || (o.ownerName ?? '').toLowerCase().includes(term))
            }).length}>
              <input
                aria-label="Search opportunities"
                className="form-input text-[11px] py-1.5 crm-opportunity-list__search"
                placeholder="Search ref, name, company…"
                value={oppSearch}
                onChange={e => setOppSearch(e.target.value)}
              />
            </PanelHeader>

            <div className="crm-opportunity-list__scroll">
              <div className="crm-opportunity-list__table">
                <div className="crm-opportunity-list__columns" aria-hidden="true">
                  <span>Opportunity</span>
                  <span>Company / contact</span>
                  <span>Owner</span>
                  <span>Expected close</span>
                  <span>Stage</span>
                  <span>Probability</span>
                  <span>Expected value</span>
                </div>

                {opportunities.filter(o => {
                  const term = oppSearch.toLowerCase()
                  const ownerMatch = opportunityMatchesOwner(o, effectiveOwner)
                  return ownerMatch && (!term || (o.ref ?? '').toLowerCase().includes(term) || o.name.toLowerCase().includes(term) ||
                    (o.companyName ?? '').toLowerCase().includes(term) || (o.contactPersonName ?? '').toLowerCase().includes(term) || (o.ownerName ?? '').toLowerCase().includes(term))
                }).map(opp => {
                  const oppQuotes = quotes.filter(q => (opp.quoteIds ?? []).includes(q.id))
                  const companyContact = [opp.companyName, opp.contactPersonName].filter(Boolean).join(' · ') || 'Company not set'

                  return (
                    <button
                      type="button"
                      key={opp.id}
                      className="crm-opportunity-list__row-grid"
                      onClick={() => { setActiveOppId(opp.id); setView('detail') }}
                    >
                      <div className="crm-opportunity-list__opportunity">
                        <strong>{opp.ref || 'No reference'}</strong>
                        <span title={opp.name}>{opp.name}</span>
                      </div>

                      <div className="crm-opportunity-list__cell" title={companyContact}>
                        {companyContact}
                      </div>

                      <div className="crm-opportunity-list__cell" title={opp.ownerName || 'Unassigned'}>
                        {opp.ownerName || 'Unassigned'}
                      </div>

                      <div className="crm-opportunity-list__cell">
                        {formatOptionalDate(opp.expectedCloseDate)}
                      </div>

                      <div className="crm-opportunity-list__cell crm-opportunity-list__cell--stage">
                        <Badge status={opp.stage} label={stageLabels[opp.stage] ?? STAGE_LABELS[opp.stage]} />
                      </div>

                      <div className="crm-opportunity-list__cell crm-opportunity-list__cell--probability">
                        <span className="badge badge-gray text-[9px]">{opp.probability}%</span>
                      </div>

                      <div className="crm-opportunity-list__amount">
                        {fmtKes(opp.expectedValue)}
                      </div>

                      <div className="crm-opportunity-list__mobile-meta">
                        <Badge status={opp.stage} label={stageLabels[opp.stage] ?? STAGE_LABELS[opp.stage]} size="xs" />
                        <span>{opp.probability}% probability</span>
                        <span>{companyContact}</span>
                        <span>Owner: {opp.ownerName || 'Unassigned'}</span>
                        <span>Close: {formatOptionalDate(opp.expectedCloseDate)}</span>
                        {oppQuotes.length > 0 && <span>{oppQuotes.length} quote{oppQuotes.length === 1 ? '' : 's'}</span>}
                      </div>
                    </button>
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
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className="mod-body crm-body p-3 sm:p-4 flex flex-col gap-4">
          <LeadsPanel
            showToast={showToast}
            salesReps={salesReps}
            currentUserId={currentUserId ?? undefined}
            onConverted={(opportunityId, meta) => {
              // Inject the convert response immediately — waiting on SSE left a blank
              // detail view and made the deal look "missing" for the assignee.
              if (meta?.opportunity) ingestOpportunity(meta.opportunity)
              setTab('pipeline')
              setActiveOppId(opportunityId)
              setView('detail')
              // Soft-stash client so the opportunity "Create quotation" CTA can deep-link
              // into Sales even before the opportunity blob hydrates clientId.
              if (meta?.clientId && typeof window !== 'undefined') {
                try {
                  sessionStorage.setItem(
                    `crm:convert:${opportunityId}`,
                    JSON.stringify({ clientId: meta.clientId, clientName: meta.clientName || '' }),
                  )
                } catch { /* ignore */ }
              }
            }}
          />
        </div>
      </div>
    )
  }

  if (tab === 'email_review' && systemSettings?.crmLeads) {
    return (
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className="mod-body crm-body p-3 sm:p-4 flex flex-col gap-4">
          <EmailReviewPanel showToast={showToast} salesReps={salesReps} />
        </div>
      </div>
    )
  }

  if (tab === 'dup_contacts' && systemSettings?.crmLeads) {
    return (
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className="mod-body crm-body p-3 sm:p-4 flex flex-col gap-4">
          <DuplicateContactsPanel showToast={showToast} />
        </div>
      </div>
    )
  }

  // Contracts Tab
  if (tab === 'contracts') {
    return (
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className="mod-body crm-body p-3 sm:p-4 flex flex-col gap-4">

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
              <div key={contract.id} className="p-4 transition-colors" onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--bg-muted)'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=''}}>
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
                      <button className="btn-outline text-[9px] py-1 px-2" style={{ color: 'var(--danger)' }} onClick={() => terminateCustomerContract(contract.id, 'Manual termination')}>Terminate</button>
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
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className="mod-body crm-body p-3 sm:p-4 flex flex-col gap-4">

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
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className="mod-body crm-body p-3 sm:p-4 flex flex-col gap-4">

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
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className="mod-body crm-body p-3 sm:p-4 flex flex-col gap-4">
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
                <div key={activity.id} className="p-4 transition-colors" onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--bg-muted)'}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=''}}>
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
      <div className="mod-page crm-workspace">
        {moduleHeader}
        <div className="mod-body crm-body p-3 sm:p-4 flex flex-col gap-4">
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
  const { opportunities, opportunityActivities, systemSettings } = useCrmStore()
  const stages: OpportunityStage[] = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost']
  const [mobileStage, setMobileStage] = useState<OpportunityStage>('prospecting')

  return (
    <section className="crm-pipeline-board" aria-label="Opportunity pipeline">
      <div className="crm-stage-tabs" role="tablist" aria-label="Pipeline stages">
        {stages.map(stage => {
          const count = opportunities.filter(o => o.stage === stage && opportunityMatchesOwner(o, effectiveOwner)).length
          return (
            <button
              key={stage}
              type="button"
              role="tab"
              aria-selected={mobileStage === stage}
              className={mobileStage === stage ? 'is-active' : ''}
              onClick={() => setMobileStage(stage)}
            >
              {stageLabels[stage]} <span>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="crm-kanban-scroll">
        {stages.map(stage => {
          const opps = opportunities.filter(o => o.stage === stage && opportunityMatchesOwner(o, effectiveOwner))
          const stageValue = opps.reduce((sum, opp) => sum + opp.expectedValue, 0)
          return (
            <section
              key={stage}
              data-stage={stage}
              className={`crm-kanban-column ${mobileStage === stage ? 'is-mobile-active' : ''}`}
              aria-label={stageLabels[stage]}
            >
              <header className="crm-kanban-column__header">
                <div>
                  <h3>{stageLabels[stage]}</h3>
                  <p>{opps.length} deal{opps.length === 1 ? '' : 's'} · {fmtKes(stageValue)}</p>
                </div>
                <span>{opps.length}</span>
              </header>

              <div className="crm-kanban-column__cards">
                {opps.map(opp => {
                  const hasScheduledActivity = opportunityActivities.some(activity =>
                    activity.opportunityId === opp.id && activity.status === 'scheduled'
                  )
                  const needsActivity = Boolean(systemSettings.crmEnforceNextActivity) && !hasScheduledActivity
                  return (
                    <button
                      key={opp.id}
                      type="button"
                      className="crm-opportunity-card"
                      onClick={() => onSelectOpp(opp.id)}
                    >
                      <div className="crm-opportunity-card__meta">
                        <span>{opp.ref ?? 'Opportunity'}</span>
                        <em>{opp.probability ?? 0}%</em>
                      </div>
                      <h4>{opp.name}</h4>
                      <p>{opp.companyName || 'Customer not set'}</p>
                      <strong>{fmtKes(opp.expectedValue)}</strong>
                      <footer>
                        <span className="crm-owner-avatar" aria-hidden="true">{(opp.ownerName ?? '?').slice(0, 1).toUpperCase()}</span>
                        <span>{(opp.ownerName ?? 'Unassigned').split(' ')[0]}</span>
                        <time>{fmtDate(opp.expectedCloseDate ?? '')}</time>
                      </footer>
                      {needsActivity && <small className="crm-next-action-alert">Next activity overdue</small>}
                    </button>
                  )
                })}
                {opps.length === 0 && <p className="crm-kanban-empty">No opportunities</p>}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}

function OpportunityDetail({ activeOppId, onClose, stageLabels, onMarkWon, onMarkLost, onLogActivity }: any) {
  const router = useRouter()
  const { opportunities, opportunityActivities, quotes, saleOrders, moveOpportunityStage, contacts } = useCrmStore()
  const opp = opportunities.find(o => o.id === activeOppId)
  if (!opp) return null

  const acts = opportunityActivities
    .filter(a => a.opportunityId === opp.id)
    .sort((a, b) => (b.createdDate ?? b.createdAt).localeCompare(a.createdDate ?? a.createdAt))
  const nextActivity = opportunityActivities
    .filter(a => a.opportunityId === opp.id && a.status === 'scheduled')
    .sort((a, b) => String(a.scheduledDate ?? '').localeCompare(String(b.scheduledDate ?? '')))[0]
  const oppQuotes = quotes.filter(q => (opp.quoteIds ?? []).includes(q.id))

  const clientId = opp.clientId || opp.companyId || (() => {
    try {
      const raw = sessionStorage.getItem(`crm:convert:${opp.id}`)
      if (!raw) return ''
      return String(JSON.parse(raw)?.clientId || '')
    } catch { return '' }
  })()
  const clientName = opp.companyName
    || contacts?.find((contact: { id: string }) => contact.id === clientId)?.name
    || (() => {
      try {
        const raw = sessionStorage.getItem(`crm:convert:${opp.id}`)
        if (!raw) return opp.name
        return String(JSON.parse(raw)?.clientName || opp.name)
      } catch { return opp.name }
    })()

  const relatedSaleOrders = (saleOrders ?? [])
    .filter(so => so.customerId && (so.customerId === clientId || so.customerId === opp.clientId || so.customerId === opp.companyId))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  const openSalesQuote = () => {
    if (!clientId) {
      router.push('/sales?new=1')
      return
    }
    const params = new URLSearchParams()
    params.set('new', '1')
    params.set('customerId', clientId)
    if (clientName) params.set('customerName', clientName)
    params.set('opportunityId', opp.id)
    router.push(`/sales?${params.toString()}`)
  }

  const openSaleOrder = (id: string) => {
    router.push(`/sales?id=${id}`)
  }

  return (
    <section className="crm-opportunity-detail">
      <header className="crm-opportunity-detail__header">
        <button type="button" className="crm-back-button" onClick={onClose} aria-label="Back to pipeline">←</button>
        <div className="crm-opportunity-detail__identity">
          <div className="crm-opportunity-detail__eyebrow">
            <span>{opp.ref}</span>
            <Badge status={opp.stage} label={stageLabels[opp.stage]} />
          </div>
          <h2>{opp.name}</h2>
          <p>{opp.companyName || 'Customer not set'}{opp.contactPersonName ? ` · ${opp.contactPersonName}` : ''}</p>
        </div>
        <div className="crm-opportunity-detail__actions">
          {!['closed_won', 'closed_lost'].includes(opp.stage) && (
            <>
              <button type="button" className="btn-primary" onClick={openSalesQuote}>Create quotation</button>
              <button type="button" className="btn-outline crm-win-action" onClick={onMarkWon}>Mark won</button>
              <button type="button" className="btn-outline crm-lost-action" onClick={onMarkLost}>Mark lost</button>
            </>
          )}
        </div>
      </header>

      <section className="crm-opportunity-summary" aria-label="Opportunity summary">
        <div><span>Expected revenue</span><strong>{fmtKes(opp.expectedValue)}</strong></div>
        <div><span>Probability</span><strong>{opp.probability}%</strong></div>
        <div><span>Expected close</span><strong>{fmtDate(opp.expectedCloseDate ?? '')}</strong></div>
        <div><span>Owner</span><strong>{opp.ownerName ?? 'Unassigned'}</strong></div>
        <button type="button" className={`crm-next-action ${nextActivity ? '' : 'is-empty'}`} onClick={onLogActivity}>
          <span>{nextActivity ? 'Next action' : 'Action needed'}</span>
          <strong>{nextActivity?.subject || 'Schedule a follow-up'}</strong>
          <small>{nextActivity?.scheduledDate ? fmtDate(nextActivity.scheduledDate) : 'No next activity scheduled'}</small>
        </button>
      </section>

      <div className="crm-opportunity-detail__grid">
        <div className="crm-opportunity-detail__main">
          <article className="crm-detail-card crm-customer-summary">
            <header><h3>Customer & requirements</h3></header>
            <div className="crm-customer-summary__grid">
              <div><span>Customer</span><strong>{clientName}</strong></div>
              <div><span>Primary contact</span><strong>{opp.contactPersonName || 'Not set'}</strong></div>
              <div><span>Lead source</span><strong>{String(opp.leadSource || 'Not set').replace(/_/g, ' ')}</strong></div>
            </div>
            <div className="crm-requirement-copy">
              <span>Need summary</span>
              <p>{opp.description || 'No requirements documented yet.'}</p>
            </div>
          </article>

          <article className="crm-detail-card crm-activity-timeline">
            <header>
              <h3>Activity timeline</h3>
              <button type="button" className="btn-outline" onClick={onLogActivity}>Log activity</button>
            </header>
            <div className="crm-activity-timeline__list">
              {acts.length === 0 ? <p className="crm-empty-state">No activities logged</p> : acts.map(a => (
                <div key={a.id} className="crm-activity-item">
                  <span className="crm-activity-item__icon" aria-hidden="true"><Fa icon={ACTIVITY_ICONS[a.type] ?? faNoteSticky} /></span>
                  <div>
                    <strong>{a.subject ?? a.type}</strong>
                    <small>{fmtDate(a.createdDate ?? a.createdAt)} · {a.createdByName ?? ''}</small>
                    {a.description && <p>{a.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>

        <aside className="crm-opportunity-detail__side">
          <article className="crm-detail-card crm-stage-panel">
            <header><h3>Stage</h3></header>
            <div className="crm-stage-panel__steps">
              {STAGE_ORDER.map((stage, index) => (
                <button
                  key={stage}
                  type="button"
                  className={opp.stage === stage ? 'is-active' : ''}
                  onClick={() => moveOpportunityStage(opp.id, stage)}
                >
                  <span>{index + 1}</span>
                  <strong>{stageLabels[stage]}</strong>
                </button>
              ))}
            </div>
          </article>

          <article className="crm-detail-card crm-quotation-panel">
            <header>
              <h3>Quotations ({relatedSaleOrders.length || oppQuotes.length})</h3>
              {!['closed_won', 'closed_lost'].includes(opp.stage) && (
                <button type="button" onClick={openSalesQuote}>New quotation</button>
              )}
            </header>
            <div className="crm-quotation-panel__list">
              {relatedSaleOrders.slice(0, 10).map(so => (
                <button key={so.id} type="button" onClick={() => openSaleOrder(so.id)}>
                  <span><strong>{so.ref}</strong><small>{fmtDate(so.date ?? '')}</small></span>
                  <b>{fmtKes(so.total)}</b>
                </button>
              ))}
              {relatedSaleOrders.length === 0 && oppQuotes.map(q => (
                <div key={q.id}>
                  <span><strong>{q.quoteNumber}</strong><small>CRM quotation</small></span>
                  <b>{fmtKes(q.totalAmount)}</b>
                </div>
              ))}
              {relatedSaleOrders.length === 0 && oppQuotes.length === 0 && (
                <p className="crm-empty-state">No quotations yet.</p>
              )}
            </div>
          </article>
        </aside>
      </div>
    </section>
  )
}

