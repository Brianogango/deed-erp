'use client'
import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useApp, RepairOrder, RepairStatus, fmtKes, fmtDate } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Confirm, StatusStepper, Textarea, StatCard, ModuleSkeleton, TabContent } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faScrewdriverWrench, faHourglassHalf, faWrench, faCircleExclamation, faCircleCheck, faBoxArchive } from '@fortawesome/free-solid-svg-icons'
import RepairClientJobs from './RepairClientJobs'
import RepairRefurbJobs from './RepairRefurbJobs'
import RepairIntake from '../repair/RepairIntake'
import { STATUS_LABELS, STATUS_COLORS } from './repair-config'
import { RepairProvider } from './repair/RepairContext'
import RepairDetailView from './repair/RepairDetailView'

type View = 'list' | 'intake' | 'detail'

const STEPPER_STEPS: RepairStatus[] = [
  'received', 'assigned', 'diagnosed', 'awaiting_approval',
  'awaiting_parts', 'in_repair', 'qc', 'ready', 'invoiced', 'delivered', 'closed',
]

// Customer-facing status messages shown to staff to understand what the customer sees
const CUSTOMER_STATUS_MAP: Record<RepairStatus, { label: string; message: string; color: string }> = {
  received:          { label: 'Device Received',     message: 'We have received your device and it is in our queue for inspection.',                         color: '#6B7280' },
  assigned:          { label: 'Being Reviewed',       message: 'A technician has been assigned and will begin diagnosing your device shortly.',               color: '#3B82F6' },
  diagnosed:         { label: 'Diagnosis Complete',   message: 'We have completed diagnosis. A repair quote will be sent to you for approval.',               color: '#06B6D4' },
  awaiting_approval: { label: 'Awaiting Your Approval', message: 'Your repair quote is ready. Please review and approve or decline to proceed.',             color: '#F59E0B' },
  approved:          { label: 'Repair Approved',      message: 'You approved the repair. Our team is preparing to begin work on your device.',               color: '#10B981' },
  awaiting_parts:    { label: 'Parts on Order',       message: 'We are waiting for required parts to arrive before we can start repairs.',                   color: '#F97316' },
  in_repair:         { label: 'Repair in Progress',   message: 'Your device is currently being repaired by our technician.',                                 color: '#8B5CF6' },
  qc:                { label: 'Quality Check',        message: 'The repair is complete and undergoing quality testing to ensure everything works perfectly.', color: '#EC4899' },
  ready:             { label: 'Ready for Collection', message: 'Your device is repaired and ready! You can collect it or schedule a delivery.',               color: '#10B981' },
  invoiced:          { label: 'Invoice Issued',       message: 'Your invoice has been issued. Please settle payment to collect your device.',                 color: '#F59E0B' },
  delivered:         { label: 'Device Delivered',     message: 'Your device has been successfully delivered or collected. Thank you!',                       color: '#0D9488' },
  closed:            { label: 'Job Closed',           message: 'This repair job has been closed. Thank you for choosing us!',                                color: '#6B7280' },
  declined:          { label: 'Quote Declined',       message: 'You declined the repair quote. Your device will be prepared for return.',                    color: '#DC2626' },
  unrepairable:      { label: 'Unrepairable',         message: 'Unfortunately we are unable to repair your device. We will contact you regarding next steps.',color: '#991B1B' },
  returned:          { label: 'Device Returned',      message: 'Your device has been returned to you as requested.',                                         color: '#78716C' },
  cancelled:         { label: 'Cancelled',            message: 'This repair job has been cancelled.',                                                        color: '#EF4444' },
}


// ── Staff Message Thread ──────────────────────────────────────────────────────
function MessageThread({ repairRef, staffName }: { repairRef: string; staffName: string }) {
  const [messages, setMessages] = useState<{ id: string; sender: string; senderName: string; text: string; timestamp: string }[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(repairRef)}/messages?by=staff`)
      if (res.ok) {
        const d = await res.json()
        setMessages(d.messages)
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      }
    } catch { /* silent */ }
  }, [repairRef])

  useEffect(() => { fetch_() }, [fetch_])
  useEffect(() => {
    const id = setInterval(fetch_, 3000)
    return () => clearInterval(id)
  }, [fetch_])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await fetch(`/api/portal/repair/${encodeURIComponent(repairRef)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'staff', senderName: staffName, text: text.trim() }),
      })
      setText('')
      await fetch_()
    } catch { /* silent */ } finally { setSending(false) }
  }

  const unread = messages.filter(m => m.sender === 'customer' && !(m as { read?: boolean }).read).length

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#3B82F6' }} />
          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#1D4ED8' }}>Customer Messages</p>
          {unread > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: '#EF4444' }}>{unread}</span>
          )}
        </div>
        <button onClick={fetch_} style={{ fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
      </div>

      {/* Thread */}
      <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 240, minHeight: 60 }}>
        {messages.length === 0 ? (
          <p className="text-xs text-center text-t4 py-4">No messages yet</p>
        ) : messages.map(m => {
          const isStaff = m.sender === 'staff'
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isStaff ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '80%', padding: '7px 11px', borderRadius: isStaff ? '12px 3px 12px 12px' : '3px 12px 12px 12px',
                background: isStaff ? '#E8F3FA' : '#F0FDF4',
                border: isStaff ? '1px solid #A8D4E8' : '1px solid #86EFAC',
              }}>
                <p className="text-xs" style={{ color: 'var(--text-1)' }}>{m.text}</p>
              </div>
              <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-4)' }}>
                {isStaff ? m.senderName : `👤 ${m.senderName}`} · {new Date(m.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {/* Reply */}
      <div className="flex gap-2">
        <input
          className="form-input flex-1 text-xs"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder="Reply to customer…"
        />
        <button className="btn-primary text-xs px-3" onClick={send} disabled={!text.trim() || sending}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

export default function Repair() {
  return (
    <Suspense fallback={
      <ModuleSkeleton />
    }>
      <RepairContent />
    </Suspense>
  )
}

function RepairContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs,
    warranties,
    createRepair, updateRepair, deleteRepair,
    assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote, approveRepairQuote,
    startRepair, markRepairComplete, addRepairQAItem, completeRepairQA, markPartsArrived,
    scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    getVisibleRepairs, updateRepairProgress, requestProcurement, markUnrepairable, returnToCustomer, showToast,
    systemSettings, companySettings,
  } = useApp()

  const queryId = searchParams.get('id')
  const queryTab = searchParams.get('tab') as 'client' | 'refurb' | null

  const [view, setLocalView] = useState<View>(queryId ? 'detail' : 'list')
  const [activeId, setLocalActiveId] = useState<string | null>(queryId ?? null)
  const [filter, setFilter] = useState<RepairStatus | 'all'>('all')
  const [mainTab, setLocalMainTab] = useState<'client' | 'refurb'>(queryTab ?? 'client')

  const setActiveId = (id: string | null) => {
    setLocalActiveId(id)
    if (id) setLocalView('detail')
    else if (view === 'detail') setLocalView('list')
    
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('id', id)
    else params.delete('id')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const setView = (v: View) => {
    setLocalView(v)
    if (v !== 'detail' && activeId !== null) {
      setLocalActiveId(null)
      const params = new URLSearchParams(searchParams.toString())
      params.delete('id')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
  }

  const setMainTab = (t: 'client' | 'refurb') => {
    setLocalMainTab(t)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', t)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlId = searchParams.get('id')
    if (urlId !== activeId) {
      setLocalActiveId(urlId)
      if (urlId) setLocalView('detail')
      else if (view === 'detail') setLocalView('list')
    }
    const urlTab = searchParams.get('tab') as 'client' | 'refurb' | null
    if (urlTab && urlTab !== mainTab) {
      setLocalMainTab(urlTab)
    }
  }, [searchParams, activeId, mainTab, view])

  // Quick-assign from list view (lead tech)
  const [quickAssignRepairId, setQuickAssignRepairId] = useState<string | null>(null)
  const [invoiceRepairId, setInvoiceRepairId] = useState<string | null>(null)
  const [invoiceApplyVat, setInvoiceApplyVat] = useState(true)

  // Modals for detail actions
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [showDiagnosisModal, setShowDiagnosisModal] = useState(false)
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [showQAModal, setShowQAModal] = useState(false)
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  const [showProgressModal, setShowProgressModal] = useState(false)
  const [showProcurementModal, setShowProcurementModal] = useState(false)
  const [showReturnModal, setShowReturnModal] = useState(false)


  // ── Diagnosis form ───────────────────────────────────────────────────────────
  const [diagForm, setDiagForm] = useState({
    findings: '', faultDescription: '', recommendedAction: '', estimatedHours: '2',
    clientCausedDamage: false, clientDamageReason: '',
  })

  // ── Quote form ───────────────────────────────────────────────────────────────
  type QuoteLine = { type: 'part' | 'labor' | 'logistics' | 'software' | 'license' | 'service'; description: string; qty: string; unitPrice: string }
  const DEFAULT_LINES: QuoteLine[] = [{ type: 'labor', description: 'Labour & Service Charge', qty: '1', unitPrice: '5000' }]
  const [quoteLines, setQuoteLines] = useState<QuoteLine[]>(DEFAULT_LINES)
  const [quoteApplyVat, setQuoteApplyVat] = useState(true)

  // ── Delivery form ────────────────────────────────────────────────────────────
  const [deliveryForm, setDeliveryForm] = useState({
    method: 'pickup' as 'pickup' | 'delivery' | 'courier',
    scheduledDate: new Date().toISOString().slice(0, 10),
    address: '',
    riderId: '',
    riderName: '',
  })

  // ── Procurement form ─────────────────────────────────────────────────────────
  const [procurementForm, setProcurementForm] = useState({
    items: [{ type: 'part' as 'part' | 'software' | 'license', productId: '', productName: '', description: '', qty: '1', estimatedCost: '0', supplier: '', partNumber: '' }],
    urgency: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    notes: '',
  })

  // ── Decline/Return forms ─────────────────────────────────────────────────────
  const [returnReason, setReturnReason] = useState('')
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [showMarkDeliveredConfirm, setShowMarkDeliveredConfirm] = useState(false)

  // ── Report uploads ───────────────────────────────────────────────────────────
  const diagReportInputRef = useRef<HTMLInputElement>(null)
  const qcReportInputRef   = useRef<HTMLInputElement>(null)
  const [uploadingDiagReport, setUploadingDiagReport] = useState(false)
  const [uploadingQcReport,   setUploadingQcReport]   = useState(false)

  const handleReportUpload = (
    file: File,
    field: 'diagnosisReportData' | 'qcReportData',
    nameFld: 'diagnosisReportName' | 'qcReportName',
    repairId: string,
    setLoading: (v: boolean) => void,
  ) => {
    if (!file.type.includes('pdf')) { showToast('Only PDF files are accepted', 'error'); return }
    if (file.size > 4 * 1024 * 1024) { showToast('File too large — max 4 MB', 'error'); return }
    setLoading(true)
    const reader = new FileReader()
    reader.onload = () => {
      updateRepair(repairId, { [field]: reader.result as string, [nameFld]: file.name })
      setLoading(false)
      showToast('Report uploaded')
    }
    reader.onerror = () => { setLoading(false); showToast('Upload failed', 'error') }
    reader.readAsDataURL(file)
  }

  const visibleRepairs = useMemo(() => getVisibleRepairs(), [repairs, currentUserId, systemSettings.repOnlyAssignedTechSeesJob])
  const filtered = useMemo(() => filter === 'all' ? visibleRepairs : visibleRepairs.filter(r => r.status === filter), [visibleRepairs, filter])
  const activeRepair = useMemo(() => repairs.find(r => r.id === activeId), [repairs, activeId])
  const customers = useMemo(() => contacts.filter(c => c.isCustomer), [contacts])
  const technicians = useMemo(() => users.filter(u => ['repair_tech', 'lead_tech'].includes(u.role)), [users])

  const currentUser = useMemo(() => users.find(u => u.id === currentUserId), [users, currentUserId])

  const isRepairTech  = currentUser?.role === 'repair_tech'
  const isLeadTech    = currentUser?.role === 'lead_tech'
  const isTechRole    = isRepairTech || isLeadTech
  const canBookRepair = !isTechRole
  const isAssigner    = currentUser?.role === 'lead_tech' || (currentUser?.role === 'admin' && systemSettings.repAdminAssignsJobs)

  const stats = useMemo(() => ({
    total:     visibleRepairs.length,
    pending:   visibleRepairs.filter(r => ['received', 'assigned'].includes(r.status)).length,
    inRepair:  visibleRepairs.filter(r => ['in_repair', 'qc'].includes(r.status)).length,
    waiting:   visibleRepairs.filter(r => r.status === 'awaiting_approval').length,
    ready:     visibleRepairs.filter(r => r.status === 'ready').length,
    completed: visibleRepairs.filter(r => ['delivered', 'closed'].includes(r.status)).length,
  }), [visibleRepairs])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleLogDiagnosis = () => {
    if (!activeRepair) return
    if (!diagForm.findings || !diagForm.faultDescription) {
      showToast('Findings and fault description are required', 'error'); return
    }
    if (diagForm.clientCausedDamage && !diagForm.clientDamageReason) {
      showToast('Please select the type of client-caused damage', 'error'); return
    }
    logDiagnosis(activeRepair.id, {
      findings: diagForm.findings, faultDescription: diagForm.faultDescription,
      recommendedAction: diagForm.recommendedAction,
      estimatedHours: Number(diagForm.estimatedHours) || 0,
    })
    if (diagForm.clientCausedDamage) {
      updateRepair(activeRepair.id, {
        clientCausedDamage: true,
        clientDamageReason: diagForm.clientDamageReason || undefined,
        underWarranty: false,
      })
    }
    setShowDiagnosisModal(false)
    setDiagForm({ findings: '', faultDescription: '', recommendedAction: '', estimatedHours: '2', clientCausedDamage: false, clientDamageReason: '' })
  }

  const handleGenerateQuote = () => {
    if (!activeRepair) return
    const lines = quoteLines.map(line => {
      const qty = Number(line.qty) || 1
      const unitPrice = Number(line.unitPrice) || 0
      return { type: line.type, description: line.description, qty, unitPrice, subtotal: qty * unitPrice }
    })
    generateRepairQuote(activeRepair.id, lines, quoteApplyVat)
    setShowQuoteModal(false)
    setQuoteLines(DEFAULT_LINES)
  }

  const handleCompleteQA = () => {
    if (!activeRepair) return
    const qaResults = activeRepair.qcItems.map(item => ({ itemId: item.id, passed: item.passed, notes: item.notes }))
    completeRepairQA(activeRepair.id, qaResults)
    setShowQAModal(false)
  }

  // ── Status filter tabs ────────────────────────────────────────────────────────
  const filterTabs: { id: RepairStatus | 'all'; label: string; count: number }[] = [
    { id: 'all',              label: 'All',              count: visibleRepairs.length },
    { id: 'received',         label: 'New',              count: visibleRepairs.filter(r => r.status === 'received').length },
    { id: 'assigned',         label: 'Assigned',         count: visibleRepairs.filter(r => r.status === 'assigned').length },
    { id: 'diagnosed',        label: 'Diagnosed',        count: visibleRepairs.filter(r => r.status === 'diagnosed').length },
    { id: 'awaiting_approval',label: 'Awaiting Approval',count: visibleRepairs.filter(r => r.status === 'awaiting_approval').length },
    { id: 'awaiting_parts',   label: 'Awaiting Parts',   count: visibleRepairs.filter(r => r.status === 'awaiting_parts').length },
    { id: 'in_repair',        label: 'In Repair',        count: visibleRepairs.filter(r => r.status === 'in_repair').length },
    { id: 'qc',               label: 'QC Testing',       count: visibleRepairs.filter(r => r.status === 'qc').length },
    { id: 'ready',            label: 'Ready',            count: visibleRepairs.filter(r => r.status === 'ready').length },
    { id: 'declined',         label: 'Declined',         count: visibleRepairs.filter(r => r.status === 'declined').length },
    { id: 'unrepairable',     label: 'Unrepairable',     count: visibleRepairs.filter(r => r.status === 'unrepairable').length },
    { id: 'returned',         label: 'Returned',         count: visibleRepairs.filter(r => r.status === 'returned').length },
    { id: 'closed',           label: 'Closed',           count: visibleRepairs.filter(r => r.status === 'closed').length },
  ]

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW: INTAKE
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'intake') {
    return <RepairIntake onCancel={() => setView('list')} onSuccess={(id) => { setActiveId(id); setView('detail') }} />
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // VIEW: LIST / DETAIL
  // ─────────────────────────────────────────────────────────────────────────────

  const repairCtxValue = {
    repairs, contacts, products, users, riders, refurbishmentJobs, currentUserId, outsourceJobs,
    warranties, systemSettings, companySettings,
    createRepair, updateRepair, deleteRepair, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis,
    generateRepairQuote, approveRepairQuote, startRepair, markRepairComplete, addRepairQAItem,
    completeRepairQA, markPartsArrived, scheduleDelivery, deliverRepair, closeRepairJob,
    createInvoiceFromRepair, getVisibleRepairs, updateRepairProgress, requestProcurement,
    markUnrepairable, returnToCustomer, showToast,
    view, setView, activeId, setActiveId, filter, setFilter, mainTab, setMainTab,
    quickAssignRepairId, setQuickAssignRepairId, invoiceRepairId, setInvoiceRepairId, invoiceApplyVat, setInvoiceApplyVat,
    showAssignModal, setShowAssignModal, showDiagnosisModal, setShowDiagnosisModal, showQuoteModal, setShowQuoteModal,
    showQAModal, setShowQAModal, showDeliveryModal, setShowDeliveryModal, showProgressModal, setShowProgressModal,
    showProcurementModal, setShowProcurementModal, showReturnModal, setShowReturnModal,
    diagForm, setDiagForm, quoteLines, setQuoteLines, quoteApplyVat, setQuoteApplyVat,
    deliveryForm, setDeliveryForm, procurementForm, setProcurementForm,
    returnReason, setReturnReason, showDeclineModal, setShowDeclineModal, declineReason, setDeclineReason,
    showMarkDeliveredConfirm, setShowMarkDeliveredConfirm,
    diagReportInputRef, qcReportInputRef, uploadingDiagReport, setUploadingDiagReport, uploadingQcReport, setUploadingQcReport,
    handleReportUpload,
    visibleRepairs, activeRepair: activeRepair ?? null, currentUser,
  }

  return (
    <RepairProvider value={repairCtxValue as any}>
    {view === 'detail' && activeRepair ? <RepairDetailView /> : (
    <div className="flex flex-col h-full" style={{ background: '#F4F6FA' }}>
      {/* Header */}
      <div className="flex-shrink-0" style={{ background: 'linear-gradient(135deg, #1B2762 0%, #0D1B4B 100%)' }}>
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' }}>
              <Fa icon={faScrewdriverWrench} style={{ fontSize: 14, color: '#fff' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Repair Management</h2>
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {visibleRepairs.length} {isRepairTech ? 'jobs assigned to you' : 'total jobs'}
                {isLeadTech && ' · supervisor view'}
              </p>
            </div>
          </div>
          {canBookRepair && (
            <button onClick={() => setView('intake')} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)',
              transition: 'all 0.15s', whiteSpace: 'nowrap',
            }}>+ New Intake</button>
          )}
        </div>
      </div>

      {/* Role banners */}
      {isRepairTech && (
        <div className="mx-5 mt-4 p-3 rounded-lg flex items-start gap-2"
          style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
          <span className="text-base">👤</span>
          <div>
            <p className="text-xs font-semibold text-t1 mb-0.5">Your Assigned Repairs</p>
            <p className="text-[10px] text-t3">
              You can only view repairs assigned to you. Client repairs are on the left; your refurbishment jobs are on the right.
            </p>
          </div>
        </div>
      )}
      {isLeadTech && (
        <div className="mx-5 mt-4 p-3 rounded-lg flex items-start gap-2"
          style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
          <span className="text-base">🔑</span>
          <div>
            <p className="text-xs font-semibold" style={{ color: '#92400E', marginBottom: 2 }}>Lead Technician — Supervisor View</p>
            <p className="text-[10px]" style={{ color: '#B45309' }}>
              You can view all repairs and assign or reassign jobs to technicians. New repair intake is handled by front-desk staff.
            </p>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-4 sm:px-5 pt-4 pb-1 flex-shrink-0">
        <StatCard label="Total Jobs"    value={stats.total}     color="#1B2762" icon={<Fa icon={faScrewdriverWrench} />} />
        <StatCard label="Pending"       value={stats.pending}   color="#F59E0B" icon={<Fa icon={faHourglassHalf} />} />
        <StatCard label="In Repair"     value={stats.inRepair}  color="#8B5CF6" icon={<Fa icon={faWrench} />} />
        <StatCard label="Awaiting Appr" value={stats.waiting}   color="#F97316" icon={<Fa icon={faCircleExclamation} />} />
        <StatCard label="Ready"         value={stats.ready}     color="#10B981" icon={<Fa icon={faCircleCheck} />} />
        <StatCard label="Completed"     value={stats.completed} color="#6B7280" icon={<Fa icon={faBoxArchive} />} />
      </div>

      {/* ── Main Tabs ── */}
      <div className="flex items-center gap-2 px-4 sm:px-5 py-2 flex-shrink-0">
        <button
          onClick={() => setMainTab('client')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            mainTab === 'client' ? 'bg-[#1B2762] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          Client Repairs
        </button>
        <button
          onClick={() => setMainTab('refurb')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            mainTab === 'refurb' ? 'bg-[#1B2762] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          Internal Refurbishments
        </button>
      </div>

      {/* ── Content area ── */}
      <TabContent active={true}>
      <div className="flex flex-col flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {mainTab === 'client' ? (
          <RepairClientJobs
            filtered={filtered}
            filter={filter}
            setFilter={setFilter}
            filterTabs={filterTabs}
            isLeadTech={isLeadTech}
            onSelectRepair={id => { setActiveId(id); setView('detail') }}
            onQuickAssign={id => setQuickAssignRepairId(id)}
          />
        ) : (
          <RepairRefurbJobs
            isLeadTech={isLeadTech}
            isRepairTech={isRepairTech}
            isAdmin={currentUser?.role === 'admin'}
          />
        )}
      </div>
      </TabContent>

      {/* Quick-assign modal (list view) */}
      {quickAssignRepairId && (() => {
        const target = repairs.find(r => r.id === quickAssignRepairId)
        const assignableTechs = technicians
          .filter(t => t.role === 'repair_tech' || t.role === 'lead_tech')
          .sort((a, b) => a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0)
        return (
          <Modal title={target?.assignedTechnicianName ? 'Reassign Technician' : 'Assign Technician'} subtitle={target?.ref} onClose={() => setQuickAssignRepairId(null)} width={420}>
            {target?.assignedTechnicianName && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2"
                style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>
                <span>⚠️</span>
                <span>Currently assigned to <strong>{target.assignedTechnicianName}</strong>. Selecting another will reassign this job.</span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {assignableTechs.map(tech => {
                const isMe = tech.id === currentUserId
                const isCurrent = tech.id === target?.assignedTechnicianId
                return (
                  <button key={tech.id}
                    onClick={() => { assignTechnicianToRepair(quickAssignRepairId, tech.id); setQuickAssignRepairId(null) }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs text-left transition-all"
                    style={{
                      border: `1px solid ${isCurrent ? '#A8D4E8' : '#E5E7EB'}`,
                      background: isCurrent ? '#E8F3FA' : '#F9FAFB',
                      cursor: 'pointer',
                    }}
                    onMouseOver={e => { if (!isCurrent) { (e.currentTarget as HTMLElement).style.background = isMe ? '#F0FDF4' : '#E8F3FA'; (e.currentTarget as HTMLElement).style.borderColor = isMe ? '#A7F3D0' : '#A8D4E8' } }}
                    onMouseOut={e => { if (!isCurrent) { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; (e.currentTarget as HTMLElement).style.borderColor = '#E5E7EB' } }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                      style={{ background: isMe ? 'linear-gradient(135deg, #059669, #34D399)' : 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                      {tech.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-t1">{tech.name}</p>
                      <p className="text-[10px] text-t3 capitalize">{tech.role.replace('_', ' ')}{isMe ? ' — you' : ''}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {isMe && <span className="badge text-[9px]" style={{ background: '#D1FAE5', color: '#065F46' }}>Me</span>}
                      {isCurrent && <span className="badge text-[9px]" style={{ background: '#DBEAFE', color: '#1E40AF' }}>Current</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </Modal>
        )
      })()}


    </div>
    )}
    </RepairProvider>
  )
}
