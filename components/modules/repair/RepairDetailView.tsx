// @ts-nocheck  — extracted from Repair.tsx which is also @ts-nocheck; types will be tightened incrementally
'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRepair } from './RepairContext'
import { Badge, Modal, Field, Input, Select, Confirm, StatusStepper, Textarea } from '@/components/ui'
import { fmtKes, fmtDate, type RepairStatus } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faScrewdriverWrench, faCircleExclamation, faCircleCheck } from '@fortawesome/free-solid-svg-icons'
import { STATUS_LABELS, STATUS_COLORS } from '../repair-config'

function MessageThread({ repairRef, staffName }: { repairRef: string; staffName: string }) {
  const [messages, setMessages] = useState<any[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(repairRef)}/messages?by=staff`)
      if (res.ok) { const d = await res.json(); setMessages(d.messages); setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50) }
    } catch { /* silent */ }
  }, [repairRef])

  useEffect(() => { fetch_() }, [fetch_])
  useEffect(() => { const id = setInterval(fetch_, 3000); return () => clearInterval(id) }, [fetch_])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await fetch(`/api/portal/repair/${encodeURIComponent(repairRef)}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'staff', senderName: staffName, text: text.trim() }),
      })
      setText(''); await fetch_()
    } catch { /* silent */ } finally { setSending(false) }
  }

  const unread = messages.filter(m => m.sender === 'customer' && !m.read).length

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#3B82F6' }} />
          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#1D4ED8' }}>Customer Messages</p>
          {unread > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: '#EF4444' }}>{unread}</span>}
        </div>
        <button onClick={fetch_} style={{ fontSize: 10, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 240, minHeight: 60 }}>
        {messages.length === 0 ? <p className="text-xs text-center text-t4 py-4">No messages yet</p>
          : messages.map(m => {
            const isStaff = m.sender === 'staff'
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isStaff ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '80%', padding: '7px 11px', borderRadius: isStaff ? '12px 3px 12px 12px' : '3px 12px 12px 12px', background: isStaff ? '#E8F3FA' : '#F0FDF4', border: isStaff ? '1px solid #A8D4E8' : '1px solid #86EFAC' }}>
                  <p className="text-xs" style={{ color: 'var(--text-1)' }}>{m.text}</p>
                </div>
                <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-4)' }}>
                  {isStaff ? m.senderName : `👤 ${m.senderName}`} · {new Date(m.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )
          })
        }
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <input className="form-input flex-1 text-xs" value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }} placeholder="Reply to customer…" />
        <button className="btn-primary text-xs px-3" onClick={send} disabled={!text.trim() || sending}>{sending ? '…' : 'Send'}</button>
      </div>
    </div>
  )
}

const STEPPER_STEPS: RepairStatus[] = [
  'received', 'assigned', 'diagnosed', 'awaiting_approval',
  'awaiting_parts', 'in_repair', 'qc', 'ready', 'invoiced', 'delivered', 'closed',
]

const CUSTOMER_STATUS_MAP: Record<RepairStatus, { label: string; message: string; color: string }> = {
  received:          { label: 'Device Received',       message: 'We have received your device and it is in our queue for inspection.',                         color: '#6B7280' },
  assigned:          { label: 'Being Reviewed',         message: 'A technician has been assigned and will begin diagnosing your device shortly.',               color: '#3B82F6' },
  diagnosed:         { label: 'Diagnosis Complete',     message: 'We have completed diagnosis. A repair quote will be sent to you for approval.',               color: '#06B6D4' },
  awaiting_approval: { label: 'Awaiting Your Approval', message: 'Your repair quote is ready. Please review and approve or decline to proceed.',               color: '#F59E0B' },
  approved:          { label: 'Repair Approved',        message: 'You approved the repair. Our team is preparing to begin work on your device.',               color: '#10B981' },
  awaiting_parts:    { label: 'Parts on Order',         message: 'We are waiting for required parts to arrive before we can start repairs.',                   color: '#F97316' },
  in_repair:         { label: 'Repair in Progress',     message: 'Your device is currently being repaired by our technician.',                                 color: '#8B5CF6' },
  qc:                { label: 'Quality Check',          message: 'The repair is complete and undergoing quality testing.',                                     color: '#EC4899' },
  ready:             { label: 'Ready for Collection',   message: 'Your device is repaired and ready! You can collect it or schedule a delivery.',               color: '#10B981' },
  invoiced:          { label: 'Invoice Issued',         message: 'Your invoice has been issued. Please settle payment to collect your device.',                 color: '#F59E0B' },
  delivered:         { label: 'Device Delivered',       message: 'Your device has been successfully delivered or collected. Thank you!',                       color: '#0D9488' },
  closed:            { label: 'Job Closed',             message: 'This repair job has been closed. Thank you for choosing us!',                                color: '#6B7280' },
  declined:          { label: 'Quote Declined',         message: 'You declined the repair quote. Your device will be prepared for return.',                    color: '#DC2626' },
  unrepairable:      { label: 'Unrepairable',           message: 'Unfortunately we are unable to repair your device.',                                        color: '#991B1B' },
  returned:          { label: 'Device Returned',        message: 'Your device has been returned to you as requested.',                                         color: '#78716C' },
  cancelled:         { label: 'Cancelled',              message: 'This repair job has been cancelled.',                                                        color: '#EF4444' },
}

type QuoteLine = { type: 'part' | 'labor' | 'logistics' | 'software' | 'license' | 'service'; description: string; qty: string; unitPrice: string }
const DEFAULT_LINES: QuoteLine[] = [{ type: 'labor', description: 'Labour & Service Charge', qty: '1', unitPrice: '5000' }]

export default function RepairDetailView() {
  const {
    repairs, contacts, products, users, riders, currentUserId, outsourceJobs, warranties,
    updateRepair, assignTechnicianToRepair, logDiagnosis, stopAtDiagnosis, generateRepairQuote,
    approveRepairQuote, startRepair, markRepairComplete, addRepairQAItem, completeRepairQA,
    markPartsArrived, scheduleDelivery, deliverRepair, closeRepairJob, createInvoiceFromRepair,
    updateRepairProgress, requestProcurement, markUnrepairable, returnToCustomer, showToast,
    systemSettings, companySettings,
    view, setView, activeId, setActiveId, activeRepair,
    showAssignModal, setShowAssignModal, showDiagnosisModal, setShowDiagnosisModal,
    showQuoteModal, setShowQuoteModal, showQAModal, setShowQAModal,
    showDeliveryModal, setShowDeliveryModal, showProgressModal, setShowProgressModal,
    showProcurementModal, setShowProcurementModal, showReturnModal, setShowReturnModal,
    diagForm, setDiagForm, quoteLines, setQuoteLines, quoteApplyVat, setQuoteApplyVat,
    deliveryForm, setDeliveryForm, procurementForm, setProcurementForm,
    returnReason, setReturnReason, showDeclineModal, setShowDeclineModal, declineReason, setDeclineReason,
    showMarkDeliveredConfirm, setShowMarkDeliveredConfirm,
    diagReportInputRef, qcReportInputRef, uploadingDiagReport, setUploadingDiagReport,
    uploadingQcReport, setUploadingQcReport, handleReportUpload,
    currentUser, invoiceRepairId, setInvoiceRepairId, invoiceApplyVat, setInvoiceApplyVat,
  } = useRepair()

  if (!activeRepair) return null

  // Role helpers (computed here so the detail view has them in scope)
  const isRepairTech = currentUser?.role === 'technician'
  const isLeadTech   = currentUser?.role === 'technical_lead'
  const isAssigner   = currentUser?.role === 'technical_lead' ||
    (currentUser?.role === 'director' && systemSettings.repAdminAssignsJobs)
  const technicians  = users.filter(u => ['technician', 'technical_lead'].includes(u.role))

  const handleLogDiagnosis = () => {
    if (!activeRepair) return
    if (!diagForm.findings || !diagForm.faultDescription) { showToast('Findings and fault description are required', 'error'); return }
    if (diagForm.clientCausedDamage && !diagForm.clientDamageReason) { showToast('Please select the type of client-caused damage', 'error'); return }
    logDiagnosis(activeRepair.id, { findings: diagForm.findings, faultDescription: diagForm.faultDescription, recommendedAction: diagForm.recommendedAction, estimatedHours: Number(diagForm.estimatedHours) || 0 })
    if (diagForm.clientCausedDamage) updateRepair(activeRepair.id, { clientCausedDamage: true, clientDamageReason: diagForm.clientDamageReason || undefined, underWarranty: false })
    setShowDiagnosisModal(false)
    setDiagForm({ findings: '', faultDescription: '', recommendedAction: '', estimatedHours: '2', clientCausedDamage: false, clientDamageReason: '' })
  }

  const handleGenerateQuote = () => {
    if (!activeRepair) return
    const lines = quoteLines.map((line: QuoteLine) => {
      const qty = Number(line.qty) || 1; const unitPrice = Number(line.unitPrice) || 0
      return { type: line.type, description: line.description, qty, unitPrice, subtotal: qty * unitPrice }
    })
    generateRepairQuote(activeRepair.id, lines, quoteApplyVat)
    setShowQuoteModal(false); setQuoteLines(DEFAULT_LINES)
  }

  const handleCompleteQA = () => {
    if (!activeRepair) return
    const qaResults = activeRepair.qcItems.map((item: any) => ({ itemId: item.id, passed: item.passed, notes: item.notes }))
    completeRepairQA(activeRepair.id, qaResults); setShowQAModal(false)
  }

  if (view === 'detail' && activeRepair) {
    const r = activeRepair
    const stepperSteps = STEPPER_STEPS.filter((s: RepairStatus) => s !== 'approved').map((s: RepairStatus) => STATUS_LABELS[s])
    const currentStep = STATUS_LABELS[r.status] ?? r.status

    // Only lead_tech can assign at any open stage
    const isMyRepair      = r.assignedTechnicianId === currentUserId
    const OPEN_STATUSES: RepairStatus[] = ['received', 'assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc', 'ready']
    const canAssign       = isAssigner && OPEN_STATUSES.includes(r.status)
    const isReassign      = canAssign && !!r.assignedTechnicianName
    // Only the assigned technician can log diagnosis — only for diagnosis_first path
    const canDiagnose     = r.status === 'assigned' && isMyRepair && r.repairPath !== 'direct_repair'
    // Assigned tech or lead/admin can generate or update a quote
    // direct_repair: allow from 'assigned' onwards; diagnosis_first: require 'diagnosed' first
    const canQuote        = (
      r.repairPath === 'direct_repair'
        ? ['assigned', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair'].includes(r.status)
        : ['diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair'].includes(r.status)
    ) && (isMyRepair || ['director', 'admin_officer', 'technical_lead', 'sales_rep', 'finance_officer'].includes(currentUser?.role ?? '')) && !r.diagnosisStopped
    // Quote approval/decline is the client's action via the repair tracker link — never shown to staff
    const canApproveQuote = false
    // Parts/software/licenses can be requested: approved/awaiting_parts/in_repair for any path, diagnosed for diagnosis_first, assigned for direct_repair
    const canRequestParts = (isMyRepair || isLeadTech) && (
      ['approved', 'awaiting_parts', 'in_repair'].includes(r.status) ||
      (r.status === 'diagnosed' && r.repairPath !== 'direct_repair') ||
      (r.status === 'assigned' && r.repairPath === 'direct_repair')
    )
    // Lead_tech or admin can mark unrepairable
    const canMarkUnrepairable = (r.status === 'assigned' || r.status === 'diagnosed' || r.status === 'in_repair') && (isLeadTech || currentUser?.role === 'director')
    // Assigned technician can start the repair
    const canStart        = ((r.status === 'approved' || r.status === 'awaiting_parts') ||
                             (r.status === 'assigned' && r.repairPath === 'direct_repair')) &&
                            isMyRepair
    // Assigned tech marks repair complete → moves to qc
    const canMarkComplete = r.status === 'in_repair' && isMyRepair
    // QC: lead_tech or admin, but NOT the technician who worked on it; only once tech has marked complete (qc status)
    const canQA           = r.status === 'qc' &&
                            (['director', 'technical_lead'].includes(currentUser?.role ?? '')) &&
                            r.assignedTechnicianId !== currentUserId
    // Diagnosis-stop: only the assigned technician, only for diagnosis_first path
    const canStopAtDiagnosis = r.status === 'diagnosed' && r.repairPath === 'diagnosis_first' && !r.diagnosisStopped && isMyRepair
    // Invoice: only if no invoice exists yet and repair is ready (invoice is usually auto-created at approval)
    const canInvoice      = r.status === 'ready' && ['director', 'finance_officer'].includes(currentUser?.role ?? '') && !r.invoiceId
    // Schedule delivery: ready or invoiced, no actual delivery yet
    const canScheduleDelivery = (r.status === 'ready' || r.status === 'invoiced') && ['director', 'admin_officer', 'sales_rep', 'inventory_officer'].includes(currentUser?.role ?? '') && !r.deliveryActualDate
    // Mark delivered: after scheduling delivery
    const canMarkDelivered = (r.status === 'ready' || r.status === 'invoiced') && ['director', 'admin_officer', 'sales_rep', 'inventory_officer', 'kilimall_officer'].includes(currentUser?.role ?? '') && !!r.deliveryScheduledDate && !r.deliveryActualDate
    const canDeliver      = canScheduleDelivery
    const canReturn       = (r.status === 'declined' || r.status === 'unrepairable') && !isRepairTech
    const canClose        = (r.status === 'delivered' || r.status === 'returned') && !isRepairTech

    const quoteTotal = r.quote ? r.quote.total : 0

    return (
      <div className="flex flex-col h-full" style={{ background: '#F4F6FA' }}>
        {/* Header */}
        <div className="flex-shrink-0" style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E7EB', borderTop: '3px solid #1B2762' }}>
          {/* Row 1: back + title */}
          <div className="flex items-center gap-3 px-4 sm:px-5 pt-3 pb-2">
            <button onClick={() => setView('list')} style={{
              background: '#F4F6FA', border: '1px solid #E5E7EB', borderRadius: 8,
              cursor: 'pointer', color: '#1B2762', fontSize: 15, lineHeight: 1,
              padding: '5px 9px', flexShrink: 0, fontWeight: 600,
            }}>←</button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-bold" style={{ color: '#1B2762' }}>{r.ref}</span>
                <Badge status={r.status} label={STATUS_LABELS[r.status]} />
                {r.underWarranty && (
                  <span className="badge badge-green text-[9px]">🛡️ Warranty</span>
                )}
                {r.priority && r.priority !== 'normal' && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                    background: r.priority === 'urgent' ? '#FEE2E2' : '#FEF3C7',
                    color: r.priority === 'urgent' ? '#DC2626' : '#92400E',
                    border: `1px solid ${r.priority === 'urgent' ? '#FCA5A5' : '#FDE68A'}`,
                    textTransform: 'uppercase',
                  }}>{r.priority}</span>
                )}
              </div>
              <p className="text-[11px] text-t3 truncate mt-0.5">{r.productName} · {r.customerName} · Booked by {r.bookedByName || r.createdBy}</p>
            </div>
          </div>
          {/* Row 2: action buttons — horizontally scrollable on mobile */}
          <div className="overflow-x-auto scrollbar-hide border-t" style={{ borderColor: '#E5E7EB', background: '#F8F9FC' }}>
          <div className="flex items-center gap-1.5 px-4 sm:px-5 py-2 min-w-max">
            {/* Progress Update - assigned tech or lead/admin */}
            {(isMyRepair || isAssigner) && r.status !== 'closed' && r.status !== 'cancelled' && (
              <button
                className="btn-primary"
                onClick={() => setShowProgressModal(true)}
                style={{ fontWeight: 600 }}
              >
                📱 Update Progress
              </button>
            )}
            {canAssign && (
              <button className="btn-secondary" onClick={() => setShowAssignModal(true)}>
                {isReassign ? `Reassign (${r.assignedTechnicianName})` : 'Assign Technician'}
              </button>
            )}
            {canDiagnose && (
              <button className="btn-secondary" onClick={() => setShowDiagnosisModal(true)}>Log Diagnosis</button>
            )}
            {canStopAtDiagnosis && (
              <button className="btn-outline" style={{ borderColor: '#F59E0B', color: '#92400E', background: '#FEF3C7' }}
                onClick={() => { if (confirm('Stop at diagnosis and charge KES 1,500 diagnosis fee?')) stopAtDiagnosis(r.id) }}>
                🔍 Stop — Charge Diagnosis Fee
              </button>
            )}
            {canQuote && (
              <button className="btn-secondary" onClick={() => {
                if (r.quote) {
                  setQuoteLines(r.quote.lines.map(l => ({
                    type: l.type as QuoteLine['type'],
                    description: l.description,
                    qty: String(l.qty),
                    unitPrice: String(l.unitPrice),
                  })))
              setQuoteApplyVat(r.quote.tax > 0)
                } else {
                  setQuoteLines(DEFAULT_LINES)
              setQuoteApplyVat(true)
                }
                setShowQuoteModal(true)
              }}>
                {r.quote ? '✏️ Update Quote' : 'Generate Quote'}
              </button>
            )}
            {canApproveQuote && (
              <>
                <button className="btn-primary" style={{ background: '#059669' }}
                  onClick={() => approveRepairQuote(r.id, true)}>
                  ✓ Approve Quote
                </button>
                <button className="btn-outline" style={{ borderColor: '#DC2626', color: '#DC2626' }}
                  onClick={() => setShowDeclineModal(true)}>
                  ✗ Decline Quote
                </button>
              </>
            )}
            {canRequestParts && (
              <button className="btn-secondary" style={{ borderColor: '#F97316', color: '#F97316' }} onClick={() => setShowProcurementModal(true)}>
                📦 Request Parts / Software / License
              </button>
            )}
            {isLeadTech && r.status === 'awaiting_parts' && (
              <button className="btn-primary" style={{ background: '#059669' }}
                onClick={() => markPartsArrived(r.id)}>
                📦 Mark Parts Arrived
              </button>
            )}
            {canMarkUnrepairable && (
              <button className="btn-outline" style={{ borderColor: '#991B1B', color: '#991B1B' }} onClick={() => setShowReturnModal(true)}>
                Mark Unrepairable
              </button>
            )}
            {canReturn && (
              <button className="btn-primary" style={{ background: '#78716C' }} onClick={() => returnToCustomer(r.id, 'Manual return')}>
                Return to Customer
              </button>
            )}
            {canStart && (
              <button className="btn-primary" onClick={() => startRepair(r.id)}>▶ Start Repair</button>
            )}
            {canMarkComplete && (
              <button className="btn-primary" style={{ background: '#8B5CF6' }}
                onClick={() => { if (confirm('Mark this repair as complete and send to QC?')) markRepairComplete(r.id) }}>
                ✓ Mark Repair Complete
              </button>
            )}
            {canQA && (
              <button className="btn-secondary" onClick={() => {
                if (r.qcItems.length === 0) {
                  ;['Device powers on successfully', 'Reported issue(s) resolved', 'No new issues introduced', 'All accessories returned', 'Device cleaned and presentable']
                    .forEach(d => addRepairQAItem(r.id, d))
                }
                setShowQAModal(true)
              }}>Complete QA</button>
            )}
            {canInvoice && (
              <button className="btn-primary" onClick={() => {
                setInvoiceRepairId(r.id)
                setInvoiceApplyVat(r.quote ? r.quote.tax > 0 : true)
              }}>Create Invoice</button>
            )}
            {canDeliver && (
              <button className="btn-primary" onClick={() => setShowDeliveryModal(true)}>Schedule Delivery</button>
            )}
            {canMarkDelivered && (
              <button className="btn-primary" style={{ background: '#0D9488' }}
                onClick={() => setShowMarkDeliveredConfirm(true)}>
                ✓ Mark Delivered
              </button>
            )}
            {canClose && (
              <button className="btn-primary" onClick={() => closeRepairJob(r.id)}>Close Job</button>
            )}
          </div>
          </div>
        </div>

        {/* Workflow stepper */}
        <div className="px-4 sm:px-5 py-2.5 flex-shrink-0"
          style={{ background: '#FAFAFA', borderBottom: '1px solid #EBEBEB' }}>
          <StatusStepper steps={stepperSteps} current={currentStep} />
        </div>

        {/* Customer-facing status banner */}
        {(() => {
          const cs = CUSTOMER_STATUS_MAP[r.status]
          if (!cs) return null
          return (
            <div className="mx-5 mt-4 flex-shrink-0 flex items-start gap-3 px-4 py-3 rounded-xl"
              style={{ background: cs.color + '10', border: `1px solid ${cs.color}30` }}>
              <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>📲</span>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: cs.color }}>
                  Customer View — {cs.label}
                </p>
                <p className="text-xs text-t2 leading-relaxed">{cs.message}</p>
              </div>
            </div>
          )
        })()}

        {/* Warranty / client-damage banner */}
        {(r.underWarranty || r.clientCausedDamage) && (() => {
          const war = warranties.find(w => w.id === r.warrantyId)
          if (r.clientCausedDamage) {
            return (
              <div className="mx-5 mt-3 flex-shrink-0 flex items-start gap-3 px-4 py-3 rounded-xl"
                style={{ background: '#FEF3C7', border: '1px solid #FCD34D' }}>
                <span style={{ fontSize: 20, lineHeight: 1, marginTop: 1 }}>⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: '#92400E' }}>
                    Warranty Void — Client-Caused Damage
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: '#B45309' }}>
                    {r.clientDamageReason || 'Client-caused damage recorded at intake.'}
                    {war && ` · Warranty ${war.ref} exists but does not apply.`}
                    {' '}<span className="font-semibold">Client is responsible for all charges.</span>
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0" style={{ background: '#F59E0B', color: '#fff' }}>CLIENT PAYS</span>
              </div>
            )
          }
          return (
            <div className="mx-5 mt-3 flex-shrink-0 flex items-start gap-3 px-4 py-3 rounded-xl"
              style={{ background: '#ECFDF5', border: '1px solid #6EE7B7' }}>
              <span style={{ fontSize: 20, lineHeight: 1, marginTop: 1 }}>🛡️</span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: '#065F46' }}>
                  Under Warranty — No Charge to Customer
                </p>
                <p className="text-xs leading-relaxed" style={{ color: '#047857' }}>
                  {war ? `${war.ref} · ${war.productName} · expires ${fmtDate(war.endDate)}` : 'Active warranty applied at intake'}
                  {' '}<span className="font-semibold">Invoice total will be KES 0.</span>
                </p>
              </div>
              <span className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0" style={{ background: '#10B981', color: '#fff' }}>FREE REPAIR</span>
            </div>
          )
        })()}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col lg:flex-row gap-4">
          {/* Left col */}
          <div className="flex flex-col gap-4 flex-1 min-w-0">

            {/* Device & Customer card */}
            <div className="card p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#1B2762' }} />
                <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#1B2762' }}>Device &amp; Customer</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {[
                  ['Customer',    r.customerName],
                  ['Phone',       r.customerPhone || '—'],
                  ['Device',      r.productName],
                  ['Serial',      r.serialNumber || '—'],
                  ['Colour',      r.deviceColor || '—'],
                  ['Condition',   r.deviceCondition ?? '—'],
                  ['Priority',    r.priority ?? 'normal'],
                  ['Channel',     r.intakeChannel?.replace('_', ' ') ?? '—'],
                  ['Intake Date', fmtDate(r.intakeDate)],
                  ...(r.estimatedCompletionDate ? [['Est. Completion', fmtDate(r.estimatedCompletionDate)]] : []),
                  ['Booked By',   r.bookedByName || r.createdBy],
                  ['Technician',  r.assignedTechnicianName ?? 'Unassigned'],
                ].map(([l, v]) => (
                  <div key={l} className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wider text-t3">{l}</span>
                    <span className="text-xs font-medium text-t1 capitalize">{v}</span>
                  </div>
                ))}
              </div>
              {r.accessories.length > 0 && (
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-t3 mb-1">Accessories</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {r.accessories.map((a, i) => (
                      <span key={i} className="badge badge-gray">{a.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Issue description */}
            <div className="card p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#F59E0B' }} />
                <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#92400E' }}>Reported Issue</p>
              </div>
              <p className="text-xs text-t1 leading-relaxed">{r.issueDescription || '—'}</p>
            </div>

            {/* Issue Photos */}
            <div className="card p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#8B5CF6' }} />
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#5B21B6' }}>Issue Photos</p>
                </div>
                {(isMyRepair || isLeadTech || currentUser?.role === 'director') && (
                  <label className="btn-secondary cursor-pointer" style={{ fontSize: 10, padding: '3px 10px' }}>
                    ↑ Upload Photo
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                      const files = Array.from(e.target.files || [])
                      if (files.length === 0) return
                      const newPhotos: string[] = []
                      let processed = 0
                      files.forEach(file => {
                        if (file.size > 5 * 1024 * 1024) { showToast(`Image ${file.name} too large (max 5MB)`, 'error'); processed++; return }
                        const reader = new FileReader()
                        reader.onload = ev => {
                          if (ev.target?.result) newPhotos.push(ev.target.result as string)
                          processed++
                          if (processed === files.length) {
                            updateRepair(r.id, { preRepairPhotos: [...(r.preRepairPhotos || []), ...newPhotos] })
                            showToast('Photos uploaded')
                          }
                        }
                        reader.readAsDataURL(file)
                      })
                      e.target.value = ''
                    }} />
                  </label>
                )}
              </div>
              {(r.preRepairPhotos && r.preRepairPhotos.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {r.preRepairPhotos.map((photo, idx) => (
                    <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 group">
                      <a href={photo} target="_blank" rel="noopener noreferrer" className="block w-full h-full hover:opacity-80 transition-opacity" title="Click to view full size">
                        <img src={photo} alt={`Issue photo ${idx + 1}`} className="w-full h-full object-cover" />
                      </a>
                      {(isMyRepair || isLeadTech || currentUser?.role === 'director') && (
                        <button type="button"
                          onClick={() => {
                            if (confirm('Delete this photo?')) {
                              updateRepair(r.id, { preRepairPhotos: r.preRepairPhotos!.filter((_, i) => i !== idx) })
                            }
                          }}
                          className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >×</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-t3 text-center py-2">No photos uploaded yet</p>
              )}
            </div>

            {/* Diagnosis stopped banner */}
            {r.diagnosisStopped && (
              <div className="p-3 rounded-xl flex items-start gap-3"
                style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
                <span className="text-base">🔍</span>
                <div>
                  <p className="text-xs font-semibold" style={{ color: '#92400E' }}>Repair Closed at Diagnosis</p>
                  <p className="text-[11px]" style={{ color: '#B45309' }}>
                    This device was diagnosed but the repair did not proceed. Diagnosis fee of <strong>KES {r.diagnosisFee?.toLocaleString() ?? '1,500'}</strong> applies.
                  </p>
                </div>
              </div>
            )}

            {/* Repair path badge */}
            {r.repairPath && !r.diagnosisStopped && (
              <div className="flex items-center gap-2">
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                  background: r.repairPath === 'direct_repair' ? '#EDE9FE' : '#E8F3FA',
                  color: r.repairPath === 'direct_repair' ? '#5B21B6' : '#1B2762',
                  border: `1px solid ${r.repairPath === 'direct_repair' ? '#C4B5FD' : '#A8D4E8'}`,
                }}>
                  {r.repairPath === 'direct_repair' ? '🔧 Direct Repair' : '🔍 Diagnosis First'}
                </span>
                {r.priority && r.priority !== 'normal' && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                    background: r.priority === 'urgent' ? '#FEE2E2' : r.priority === 'high' ? '#FEF3C7' : '#F3F4F6',
                    color: r.priority === 'urgent' ? '#DC2626' : r.priority === 'high' ? '#92400E' : '#6B7280',
                    border: `1px solid ${r.priority === 'urgent' ? '#FCA5A5' : r.priority === 'high' ? '#FDE68A' : '#E5E7EB'}`,
                    textTransform: 'capitalize',
                  }}>
                    {r.priority === 'urgent' ? '🔴' : r.priority === 'high' ? '🟡' : ''} {r.priority}
                  </span>
                )}
              </div>
            )}

            {/* Direct repair: skip diagnosis, go straight to quote */}
            {r.repairPath === 'direct_repair' && !r.quote && r.status === 'assigned' && (
              <div className="p-3 rounded-xl flex items-start gap-3"
                style={{ background: '#EDE9FE', border: '1px solid #C4B5FD' }}>
                <span className="text-base">🔧</span>
                <div>
                  <p className="text-xs font-semibold" style={{ color: '#5B21B6' }}>Direct Repair — No Diagnosis Required</p>
                  <p className="text-[11px]" style={{ color: '#7C3AED' }}>
                    Generate a quote directly. No diagnosis report is needed for this repair path.
                  </p>
                </div>
              </div>
            )}

            {/* Diagnosis — only for diagnosis_first path */}
            {r.repairPath !== 'direct_repair' && r.diagnosis && (
              <div className="card p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#06B6D4' }} />
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#0E7490' }}>Diagnosis Report</p>
                  </div>
                  {(isMyRepair || isLeadTech || currentUser?.role === 'director') && (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 10, padding: '3px 10px' }}
                      onClick={() => diagReportInputRef.current?.click()}
                      disabled={uploadingDiagReport}
                    >
                      {uploadingDiagReport ? 'Uploading…' : r.diagnosisReportData ? '↑ Replace PDF' : '↑ Upload PDF'}
                    </button>
                  )}
                  <input ref={diagReportInputRef} type="file" accept=".pdf" style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handleReportUpload(f, 'diagnosisReportData', 'diagnosisReportName', r.id, setUploadingDiagReport)
                      e.target.value = ''
                    }} />
                </div>
                {[
                  ['Findings', r.diagnosis.findings],
                  ['Fault', r.diagnosis.faultDescription],
                  ['Recommended Action', r.diagnosis.recommendedAction],
                  ['Est. Hours', String(r.diagnosis.estimatedHours)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="text-[9px] uppercase tracking-wider text-t3">{l}</p>
                    <p className="text-xs text-t1 mt-0.5">{v}</p>
                  </div>
                ))}
                {r.diagnosisReportData && (
                  <a
                    href={r.diagnosisReportData}
                    download={r.diagnosisReportName ?? 'diagnosis-report.pdf'}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium"
                    style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8', textDecoration: 'none' }}
                  >
                    <span>📄</span>
                    <span className="flex-1 truncate">{r.diagnosisReportName ?? 'diagnosis-report.pdf'}</span>
                    <span style={{ flexShrink: 0 }}>⬇ Download</span>
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Right col */}
          <div className="flex flex-col gap-4 w-full lg:w-[300px] flex-shrink-0">

            {/* Diagnosis fee card (when stopped at diagnosis) */}
            {r.diagnosisStopped && (
              <div className="card p-4 flex flex-col gap-2"
                style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}>
                <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#92400E' }}>Diagnosis Fee</p>
                <div className="flex justify-between text-xs font-bold">
                  <span style={{ color: '#92400E' }}>Total Charge</span>
                  <span style={{ color: '#1B2762', fontSize: 16 }}>{fmtKes(r.diagnosisFee ?? 1500)}</span>
                </div>
                <p className="text-[10px]" style={{ color: '#B45309' }}>Flat fee for diagnosis only — no repair work performed.</p>
              </div>
            )}

            {/* Quote */}
            {r.quote ? (
              <div className="card p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#10B981' }} />
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#065F46' }}>Quote</p>
                  </div>
                  <Badge status={r.quote.approvedDate ? 'approved' : r.quote.rejectedDate ? 'cancelled' : 'pending'} />
                </div>
                {r.quote.lines.map(line => (
                  <div key={line.id} className="flex justify-between text-xs">
                    <span className="text-t2">{line.description} ×{line.qty}</span>
                    <span className="text-t1 font-medium">{fmtKes(line.subtotal)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 flex flex-col gap-1" style={{ borderColor: '#F3F4F6' }}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-t3">Subtotal</span>
                    <span className="text-t2">{fmtKes(r.quote.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-t3">VAT (16%)</span>
                    <span className="text-t2">{fmtKes(r.quote.tax)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold mt-1">
                    <span className="text-t1">Total</span>
                    <span style={{ color: '#1B2762' }}>{fmtKes(r.quote.total)}</span>
                  </div>
                </div>
                {r.salesQuoteRef && (
                  <div className="rounded-lg px-3 py-2 flex items-center justify-between" style={{ background: '#EDE9FE', border: '1px solid #DDD6FE' }}>
                    <span style={{ fontSize: 11, color: '#5B21B6', fontWeight: 600 }}>📄 Sales Quote</span>
                    <span style={{ fontSize: 11, color: '#7C3AED', fontFamily: 'monospace', fontWeight: 700 }}>{r.salesQuoteRef}</span>
                  </div>
                )}
                {r.saleOrderRef && (
                  <div className="rounded-lg px-3 py-2 flex items-center justify-between" style={{ background: '#DCFCE7', border: '1px solid #A7F3D0' }}>
                    <span style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>🧾 Sale Order</span>
                    <span style={{ fontSize: 11, color: '#059669', fontFamily: 'monospace', fontWeight: 700 }}>{r.saleOrderRef}</span>
                  </div>
                )}
                {r.status === 'awaiting_approval' && (
                  <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
                    <span style={{ fontSize: 14 }}>⏳</span>
                    <p style={{ fontSize: 11, color: '#92400E' }}>Awaiting customer approval via tracking link</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="card p-4 flex flex-col gap-2 items-center justify-center text-center"
                style={{ minHeight: 100 }}>
                <span className="text-2xl">📋</span>
                <p className="text-xs text-t3">No quote generated yet</p>
              </div>
            )}

            {/* QA Items + QC Report */}
            {r.qcItems.length > 0 && (
              <div className="card p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#EC4899' }} />
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#9D174D' }}>QA Checklist</p>
                  </div>
                  {(isLeadTech || currentUser?.role === 'director') && (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 10, padding: '3px 10px' }}
                      onClick={() => qcReportInputRef.current?.click()}
                      disabled={uploadingQcReport}
                    >
                      {uploadingQcReport ? 'Uploading…' : r.qcReportData ? '↑ Replace QC Report' : '↑ Upload QC Report'}
                    </button>
                  )}
                  <input ref={qcReportInputRef} type="file" accept=".pdf" style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handleReportUpload(f, 'qcReportData', 'qcReportName', r.id, setUploadingQcReport)
                      e.target.value = ''
                    }} />
                </div>
                {r.qcItems.map(item => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    <span style={{ color: item.passed ? '#10B981' : '#9CA3AF', fontSize: 14 }}>
                      {item.passed ? '✓' : '○'}
                    </span>
                    <span className={item.passed ? 'text-t1' : 'text-t3'}>{item.description}</span>
                  </div>
                ))}
                {r.qcReportData && (
                  <a
                    href={r.qcReportData}
                    download={r.qcReportName ?? 'qc-report.pdf'}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium mt-1"
                    style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534', textDecoration: 'none' }}
                  >
                    <span>📋</span>
                    <span className="flex-1 truncate">{r.qcReportName ?? 'qc-report.pdf'}</span>
                    <span style={{ flexShrink: 0 }}>⬇ Download</span>
                  </a>
                )}
              </div>
            )}

            {/* Parts / Procurement Requests */}
            {(r.procurementRequests ?? []).length > 0 && (
              <div className="card p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 pb-2" style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <div className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ background: '#F97316' }} />
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#C2410C' }}>Parts / Procurement</p>
                </div>
                {(r.procurementRequests ?? []).map((req, ri) => (
                  <div key={req.id} className="flex flex-col gap-1.5 pb-2" style={{ borderBottom: ri < (r.procurementRequests!.length - 1) ? '1px solid #F3F4F6' : 'none' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-t1">Request #{ri + 1} — {req.requestedByName}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                        background: req.urgency === 'urgent' ? '#FEF2F2' : req.urgency === 'high' ? '#FFF7ED' : '#F0FDF4',
                        color: req.urgency === 'urgent' ? '#DC2626' : req.urgency === 'high' ? '#EA580C' : '#166534',
                        border: `1px solid ${req.urgency === 'urgent' ? '#FECACA' : req.urgency === 'high' ? '#FED7AA' : '#BBF7D0'}`,
                      }}>{req.urgency.toUpperCase()}</span>
                    </div>
                    <p className="text-[10px] text-t3">{req.requestedDate}</p>
                    {req.items.map((item, ii) => (
                      <div key={ii} className="flex items-start justify-between gap-2 text-[11px] pl-2">
                        <span className="text-t1 font-medium">{item.productName}</span>
                        <span className="text-t3 text-right">×{item.qty} {item.estimatedCost !== '0' ? `· KES ${Number(item.estimatedCost).toLocaleString()}` : ''}{item.supplier ? ` · ${item.supplier}` : ''}</span>
                      </div>
                    ))}
                    {req.notes && <p className="text-[10px] text-t3 italic">"{req.notes}"</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Outsource status card */}
            {(() => {
              const outJobs = outsourceJobs.filter(j => j.repairOrderId === r.id)
              if (outJobs.length === 0) return null
              const activeOut = outJobs.find(j => j.status === 'sent')
              const latest = activeOut ?? outJobs[outJobs.length - 1]
              const isActive = latest.status === 'sent'
              return (
                <div className="card p-4 flex flex-col gap-2"
                  style={{ borderColor: isActive ? '#FDE68A' : '#E5E7EB', background: isActive ? '#FFFBEB' : 'var(--bg-card)' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: isActive ? '#92400E' : '#6B7280' }}>
                      {isActive ? '🔧 Out for Outsource Repair' : '🔧 Outsource History'}
                    </p>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: isActive ? '#FEF9C3' : '#DCFCE7',
                      color: isActive ? '#854D0E' : '#166534',
                      border: `1px solid ${isActive ? '#FDE68A' : '#A7F3D0'}`,
                    }}>
                      {isActive ? 'Awaiting Return' : 'Returned'}
                    </span>
                  </div>
                  {[
                    ['Vendor',    latest.vendorName],
                    ['Service',   latest.serviceType.replace(/_/g, ' ')],
                    ['Sent',      latest.sentDate],
                    ['Ref',       latest.ref],
                    ...(latest.quotedCost != null ? [['Quoted', `KSh ${latest.quotedCost.toLocaleString()}`]] : []),
                    ...(latest.finalCost  != null ? [['Final Cost', `KSh ${latest.finalCost.toLocaleString()}`]] : []),
                    ...(latest.returnedDate ? [['Returned', latest.returnedDate]] : []),
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between text-[11px]">
                      <span className="text-t3">{l}</span>
                      <span className="font-medium text-t1 capitalize">{v}</span>
                    </div>
                  ))}
                  {latest.issueDescription && (
                    <p className="text-[10px] text-t3 italic mt-0.5">"{latest.issueDescription}"</p>
                  )}
                  {latest.returnNotes && (
                    <p className="text-[11px] mt-0.5" style={{ color: latest.isResolved ? '#059669' : '#DC2626' }}>
                      {latest.isResolved ? '✓ Resolved' : '✗ Not Resolved'}{latest.returnNotes ? ` — ${latest.returnNotes}` : ''}
                    </p>
                  )}
                </div>
              )
            })()}

            {/* Client tracking link */}
            {(() => {
              const portalUrl = typeof window !== 'undefined'
                ? `${window.location.origin}/portal/repair/${encodeURIComponent(r.ref)}`
                : `/portal/repair/${encodeURIComponent(r.ref)}`
              return (
                <div className="card p-3.5 flex flex-col gap-2"
                  style={{ borderLeft: '3px solid #00B0D7', background: '#F0F9FF' }}>
                  <p className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: '#0369A1' }}>
                    🔗 Client Follow-Up Link
                  </p>
                  <p className="text-[10px] break-all font-mono" style={{ color: '#0284C7' }}>{portalUrl}</p>
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary text-[10px] py-1"
                      onClick={() => { navigator.clipboard.writeText(portalUrl); showToast('Link copied!') }}>
                      Copy Link
                    </button>
                    <a
                      href={portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-outline text-[10px] py-1"
                      style={{ textDecoration: 'none', borderColor: '#0284C7', color: '#0284C7' }}>
                      Open Portal
                    </a>
                  </div>
                </div>
              )
            })()}

            {/* Customer messages */}
            <MessageThread repairRef={r.ref} staffName={currentUser?.name ?? 'Staff'} />

            {/* Invoice link */}
            {r.invoiceId && (
              <div className="card p-3.5 flex items-center gap-3"
                style={{ borderLeft: '3px solid #10B981', background: '#F0FDF4' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: '#D1FAE5', border: '1px solid #A7F3D0' }}>
                  <span style={{ fontSize: 15 }}>🧾</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: '#065F46' }}>Invoice Raised</p>
                  <p className="font-mono text-xs font-bold" style={{ color: '#059669' }}>{r.invoiceId}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                  style={{ background: '#10B981', color: '#fff' }}>Invoiced</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Assign Technician Modal ── */}
        {showAssignModal && (
          <Modal title={isReassign ? 'Reassign Technician' : 'Assign Technician'} onClose={() => setShowAssignModal(false)} width={400}>
            {isReassign && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2"
                style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>
                <span>⚠️</span>
                <span>Currently assigned to <strong>{r.assignedTechnicianName}</strong>. Selecting another will reassign.</span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {[...technicians]
                .sort((a, b) => a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0)
                .map(tech => {
                  const isMe = tech.id === currentUserId
                  const isCurrent = tech.id === r.assignedTechnicianId
                  return (
                    <button key={tech.id}
                      onClick={() => { assignTechnicianToRepair(r.id, tech.id); setShowAssignModal(false) }}
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
        )}

        {/* ── Diagnosis Modal ── */}
        {showDiagnosisModal && (
          <Modal title="Log Diagnosis" onClose={() => setShowDiagnosisModal(false)} width={520}>
            <Field label="Findings" required>
              <Textarea value={diagForm.findings} onChange={v => setDiagForm(p => ({ ...p, findings: v }))}
                placeholder="What was found during inspection..." rows={3} />
            </Field>
            <Field label="Fault Description" required>
              <Textarea value={diagForm.faultDescription} onChange={v => setDiagForm(p => ({ ...p, faultDescription: v }))}
                placeholder="Technical description of the fault..." rows={2} />
            </Field>
            <Field label="Recommended Action">
              <Textarea value={diagForm.recommendedAction} onChange={v => setDiagForm(p => ({ ...p, recommendedAction: v }))}
                placeholder="What needs to be done to fix the issue..." rows={2} />
            </Field>
            <Field label="Estimated Labour Hours">
              <Input value={diagForm.estimatedHours} onChange={v => setDiagForm(p => ({ ...p, estimatedHours: v }))} type="number" />
            </Field>

            {/* Client-caused damage — detected during diagnosis */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E5E7EB' }}>
              <div className="px-3 py-2" style={{ background: '#F9FAFB', borderBottom: diagForm.clientCausedDamage ? '1px solid #FCD34D' : undefined }}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 flex-shrink-0"
                    checked={diagForm.clientCausedDamage}
                    onChange={e => setDiagForm(p => ({ ...p, clientCausedDamage: e.target.checked, clientDamageReason: '' }))}
                  />
                  <div>
                    <p className="text-[11px] font-semibold text-t1">Client-caused damage detected</p>
                    <p className="text-[10px] text-t3">
                      {activeRepair?.underWarranty
                        ? 'Device is under warranty — checking this will void it and charge the client.'
                        : 'Damage caused by customer misuse (e.g. water spillage, drop). Client will be charged.'}
                    </p>
                  </div>
                  {activeRepair?.underWarranty && !diagForm.clientCausedDamage && (
                    <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#ECFDF5', color: '#065F46', border: '1px solid #6EE7B7' }}>WARRANTY ACTIVE</span>
                  )}
                </label>
              </div>
              {diagForm.clientCausedDamage && (
                <div className="px-3 py-2.5 flex flex-col gap-2" style={{ background: '#FFFBEB' }}>
                  <p className="text-[10px] font-medium" style={{ color: '#92400E' }}>Type of damage found</p>
                  <select
                    className="form-input w-full text-[11px] py-1"
                    value={diagForm.clientDamageReason}
                    onChange={e => setDiagForm(p => ({ ...p, clientDamageReason: e.target.value }))}
                  >
                    <option value="">— Select damage type —</option>
                    <option value="Water/liquid spillage">Water / liquid spillage</option>
                    <option value="Physical drop/impact damage">Physical drop / impact damage</option>
                    <option value="Unauthorized repair attempt">Unauthorized repair attempt</option>
                    <option value="Fire/heat/power surge damage">Fire / heat / power surge</option>
                    <option value="Intentional damage">Intentional damage</option>
                    <option value="Pest/rodent damage">Pest / rodent damage</option>
                    <option value="Other client-caused damage">Other client-caused damage</option>
                  </select>
                  {activeRepair?.underWarranty && (
                    <p className="text-[10px] font-semibold" style={{ color: '#DC2626' }}>
                      ⚠ Warranty will be voided — client becomes responsible for all repair costs.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowDiagnosisModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleLogDiagnosis}>Save Diagnosis</button>
            </div>
          </Modal>
        )}

        {/* ── Quote Modal ── */}
        {showQuoteModal && (
          <Modal title={r.quote ? 'Update Quote' : 'Generate Quote'} subtitle={r.ref} onClose={() => setShowQuoteModal(false)} width={640}>
            <div className="overflow-x-auto w-full">
            <div className="min-w-[500px] flex flex-col gap-2 pb-2">
              {/* header row */}
              <div className="grid gap-2 px-1" style={{ gridTemplateColumns: '120px 1fr 70px 110px 28px' }}>
                <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>TYPE</span>
                <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>DESCRIPTION</span>
                <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>QTY</span>
                <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>UNIT PRICE</span>
                <span />
              </div>
              {quoteLines.map((line, i) => (
                <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: '120px 1fr 70px 110px 28px' }}>
                  <select className="form-input" style={{ fontSize: 12 }} value={line.type}
                    onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, type: e.target.value as QuoteLine['type'] } : l))}>
                    <option value="part">Part</option>
                    <option value="labor">Labour</option>
                    <option value="software">Software</option>
                    <option value="license">License</option>
                    <option value="logistics">Logistics</option>
                    <option value="service">Service</option>
                  </select>
                  <input className="form-input" placeholder="Description" value={line.description}
                    onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, description: e.target.value } : l))} />
                  <input className="form-input" type="number" placeholder="1" value={line.qty}
                    onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))} />
                  <input className="form-input" type="number" placeholder="0" value={line.unitPrice}
                    onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, unitPrice: e.target.value } : l))} />
                  <button onClick={() => setQuoteLines(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: '#FEE2E2', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#EF4444', fontSize: 14, height: 32 }}>×</button>
                </div>
              ))}
              <div className="flex items-center justify-between mt-1">
                <button className="btn-secondary" style={{ fontSize: 11 }}
                  onClick={() => setQuoteLines(prev => [...prev, { type: 'part', description: '', qty: '1', unitPrice: '0' }])}>
                  + Add Line
                </button>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
                  <input type="checkbox" checked={quoteApplyVat} onChange={e => setQuoteApplyVat(e.target.checked)} />
                  Apply VAT ({companySettings.vatRate}%)
                </label>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                  Total: KES {quoteLines.reduce((s, l) => s + (Number(l.qty) || 1) * (Number(l.unitPrice) || 0), 0).toLocaleString()}
                </span>
              </div>
              </div>
            </div>
            </div>
            <div className="flex gap-2 justify-end mt-3">
              <button className="btn-outline" onClick={() => setShowQuoteModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleGenerateQuote}>
                {r.quote ? '✏️ Update & Resend to Customer' : 'Generate Quote'}
              </button>
            </div>
          </Modal>
        )}

        {/* ── QA Modal ── */}
        {showQAModal && (
          <Modal title="Complete QA Checklist" onClose={() => setShowQAModal(false)} width={460}>
            {r.qcItems.length === 0 ? (
              <p className="text-xs text-t3 text-center py-4">Adding default QA checklist… please wait a moment and reopen.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {r.qcItems.map(item => (
                  <label key={item.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
                    style={{ border: '1px solid #E5E7EB', background: item.passed ? '#F0FDF4' : '#F9FAFB' }}>
                    <input type="checkbox" checked={item.passed} style={{ accentColor: '#10B981' }}
                      onChange={e => {
                        const updated = r.qcItems.map(qi => qi.id === item.id ? { ...qi, passed: e.target.checked } : qi)
                        updateRepair(r.id, { qcItems: updated })
                      }} />
                    <span className="text-xs text-t1">{item.description}</span>
                  </label>
                ))}
                <p className="text-[10px] text-t3 mt-1">
                  {r.qcItems.every(i => i.passed)
                    ? '✓ All items passed — device will move to Ready'
                    : '⚠ Some items failed — repair will require rework'}
                </p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setShowQAModal(false)}>Cancel</button>
              {r.qcItems.length > 0 && (
                <button className="btn-primary" onClick={handleCompleteQA}>
                  {r.qcItems.every(i => i.passed) ? '✓ Pass QA' : '✗ Submit (Rework Required)'}
                </button>
              )}
            </div>
          </Modal>
        )}

        {/* ── Delivery Modal ── */}
        {showDeliveryModal && (
          <Modal title="Schedule Delivery" onClose={() => setShowDeliveryModal(false)} width={420}>
            <Field label="Delivery Method">
              <Select value={deliveryForm.method} onChange={v => setDeliveryForm(p => ({ ...p, method: v as 'pickup' | 'delivery' | 'courier' }))}
                options={[
                  { value: 'pickup', label: 'Customer Pickup' },
                  { value: 'delivery', label: 'Home Delivery' },
                  { value: 'courier', label: 'Courier Service' },
                ]} />
            </Field>
            <Field label="Scheduled Date">
              <input className="form-input" type="date" value={deliveryForm.scheduledDate}
                onChange={e => setDeliveryForm(p => ({ ...p, scheduledDate: e.target.value }))} />
            </Field>
            {deliveryForm.method !== 'pickup' && (
              <Field label="Delivery Address">
                <Textarea value={deliveryForm.address} onChange={v => setDeliveryForm(p => ({ ...p, address: v }))} rows={2} />
              </Field>
            )}
            {deliveryForm.method === 'delivery' && (
              <Field label="Delivery Person">
                <Select
                  value={deliveryForm.riderId}
                  onChange={v => {
                    const rider = riders.find(r => r.id === v)
                    setDeliveryForm(p => ({ ...p, riderId: v, riderName: rider?.name ?? '' }))
                  }}
                  options={[
                    { value: '', label: '— Select rider —' },
                    ...riders.filter(r => r.active).map(r => ({
                      value: r.id,
                      label: `${r.name} (${r.vehicle})`,
                    })),
                  ]}
                />
              </Field>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setShowDeliveryModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => {
                scheduleDelivery(r.id, deliveryForm.method, deliveryForm.scheduledDate, deliveryForm.address, deliveryForm.riderId || undefined, deliveryForm.riderName || undefined)
                setShowDeliveryModal(false)
              }}>Schedule</button>
            </div>
          </Modal>
        )}

        {/* ── Decline Quote Modal ── */}
        {showDeclineModal && (
          <Modal title="Decline Repair Quote" onClose={() => setShowDeclineModal(false)} width={440}>
            <div className="p-3 rounded-lg mb-3 text-xs" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
              Declining will cancel this repair. The customer will be notified and the device prepared for return.
            </div>
            <Field label="Reason for declining">
              <Textarea value={declineReason} onChange={v => setDeclineReason(v)} rows={3}
                placeholder="e.g. Cost too high, customer changed mind..." />
            </Field>
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setShowDeclineModal(false)}>Cancel</button>
              <button className="btn-primary" style={{ background: '#DC2626' }}
                onClick={() => {
                  approveRepairQuote(r.id, false, declineReason || 'Quote declined')
                  setDeclineReason('')
                  setShowDeclineModal(false)
                }}>
                Confirm Decline
              </button>
            </div>
          </Modal>
        )}

        {/* ── Mark Delivered Confirm ── */}
        {showMarkDeliveredConfirm && (
          <Modal title="Confirm Delivery" onClose={() => setShowMarkDeliveredConfirm(false)} width={400}>
            <p className="text-xs text-t2 mb-4">
              Confirm that <strong>{r.productName}</strong> has been successfully delivered/collected by <strong>{r.customerName}</strong>.
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => setShowMarkDeliveredConfirm(false)}>Cancel</button>
              <button className="btn-primary" style={{ background: '#0D9488' }}
                onClick={() => {
                  deliverRepair(r.id, r.customerName, r.customerPhone)
                  setShowMarkDeliveredConfirm(false)
                }}>
                ✓ Confirm Delivery
              </button>
            </div>
          </Modal>
        )}

        {/* ── Progress Update Modal ── */}
        {showProgressModal && (() => {
          const PROG_FLOW: Partial<Record<RepairStatus, RepairStatus[]>> = {
            received:          ['assigned', 'cancelled'],
            assigned:          ['diagnosed', 'unrepairable', 'cancelled'],
            diagnosed:         ['awaiting_approval', 'unrepairable', 'cancelled'],
            awaiting_approval: ['approved', 'declined', 'cancelled'],
            approved:          ['awaiting_parts', 'in_repair', 'cancelled'],
            awaiting_parts:    ['in_repair', 'cancelled'],
            in_repair:         ['unrepairable', 'cancelled'],
            qc:                ['in_repair', 'cancelled'],
            ready:             ['invoiced', 'delivered'],
            invoiced:          ['delivered'],
            delivered:         ['closed'],
            declined:          ['returned'],
            unrepairable:      ['returned'],
            returned:          ['closed'],
          }
          const PROG_MSGS: Partial<Record<RepairStatus, string>> = {
            assigned:          'A technician has been assigned to your repair.',
            diagnosed:         'Diagnosis complete. A quote will be sent to you shortly.',
            awaiting_approval: 'Your repair quote is ready. Please review and approve.',
            approved:          'Quote approved! We are preparing to begin work.',
            awaiting_parts:    'We are waiting for parts to arrive. We will keep you updated.',
            in_repair:         'Your device is currently being repaired.',
            qc:                'Repair complete! Running quality control tests.',
            ready:             '🎉 Your device is ready for pickup at our service center.',
            invoiced:          'Your repair is complete and invoiced.',
            delivered:         'Your device has been delivered. Thank you!',
            closed:            'Repair job completed. Thank you for choosing us!',
            declined:          'Your repair quote was declined.',
            returned:          'Your device has been returned.',
            cancelled:         'Your repair has been cancelled.',
            unrepairable:      'Unfortunately your device cannot be repaired. Please arrange pickup.',
          }
          const hasProcurement = (r.procurementRequests?.length ?? 0) > 0
          const nextStatuses = (PROG_FLOW[r.status] ?? []).filter(s =>
            s !== 'awaiting_parts' || hasProcurement
          )
          return (
            <Modal title="Update Repair Progress" subtitle={r.ref} onClose={() => setShowProgressModal(false)} width={600}>
              {/* Current status */}
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-t3">Current Status</span>
                <Badge status={r.status} label={STATUS_LABELS[r.status]} />
                <span className="text-xs text-t3 ml-auto">{r.productName} · {r.customerName}</span>
              </div>

              {nextStatuses.length === 0 ? (
                <p className="text-xs text-center text-t3 py-4">This repair is in its final status.</p>
              ) : (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-t3 mb-2">Move to</p>
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                      {nextStatuses.map(s => (
                        <button key={s} onClick={() => {
                          updateRepairProgress(r.id, s, PROG_MSGS[s] ?? `Status updated to ${STATUS_LABELS[s]}`, true)
                          setShowProgressModal(false)
                        }}
                          style={{
                            padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: '1.5px solid',
                            borderColor: s === 'cancelled' || s === 'unrepairable' ? '#FCA5A5' : s === 'ready' || s === 'approved' ? '#6EE7B7' : '#A8D4E8',
                            background: s === 'cancelled' || s === 'unrepairable' ? '#FEF2F2' : s === 'ready' || s === 'approved' ? '#F0FDF4' : '#F0F9FF',
                          }}>
                          <p className="text-xs font-semibold" style={{ color: s === 'cancelled' || s === 'unrepairable' ? '#991B1B' : s === 'ready' || s === 'approved' ? '#065F46' : '#1B2762' }}>
                            {STATUS_LABELS[s]}
                          </p>
                          <p className="text-[10px] mt-0.5 text-t3 leading-tight line-clamp-2">{PROG_MSGS[s]}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-t3">Clicking a status will update immediately and notify the customer via SMS/WhatsApp if a phone number is on file.</p>
                </>
              )}
              <div className="flex justify-end">
                <button className="btn-outline" onClick={() => setShowProgressModal(false)}>Close</button>
              </div>
            </Modal>
          )
        })()}

        {/* ── Procurement Request Modal ── */}
        {showProcurementModal && (() => {
          const pf = procurementForm
          return (
            <Modal title="Request Parts / Software / License" subtitle={r.ref} onClose={() => setShowProcurementModal(false)} width={620}>
              <div className="flex flex-col gap-3">
                {pf.items.map((item, i) => (
                  <div key={i} className="flex flex-col gap-2 p-3 rounded-xl" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-t3">Item {i + 1}</span>
                      {pf.items.length > 1 && (
                        <button onClick={() => setProcurementForm(p => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                          style={{ background: '#FEE2E2', border: 'none', borderRadius: 6, color: '#EF4444', cursor: 'pointer', fontSize: 11, padding: '2px 8px' }}>Remove</button>
                      )}
                    </div>
                    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[110px_1fr_60px_100px]">
                      <Field label="Type">
                        <select className="form-input" style={{ fontSize: 12 }} value={item.type}
                          onChange={e => setProcurementForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, type: e.target.value as 'part' | 'software' | 'license' } : x) }))}>
                          <option value="part">🔩 Part</option>
                          <option value="software">💿 Software</option>
                          <option value="license">🔑 License</option>
                        </select>
                      </Field>
                      <Field label="Item from Inventory">
                        {(() => {
                          const selected = products.find(p => p.id === item.productId)
                          return (
                            <div className="flex flex-col gap-1">
                              <select
                                className="form-input"
                                style={{ fontSize: 12 }}
                                value={item.productId}
                                onChange={e => {
                                  const prod = products.find(p => p.id === e.target.value)
                                  setProcurementForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? {
                                    ...x,
                                    productId: e.target.value,
                                    productName: prod ? prod.name : x.productName,
                                    estimatedCost: prod ? String(prod.costPrice) : x.estimatedCost,
                                  } : x) }))
                                }}>
                                <option value="">— Select from inventory or type below —</option>
                                {products.filter(p => p.isActive).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} · {p.stockQty <= 0 ? '⚠ Out of stock' : `${p.stockQty} in stock`}
                                  </option>
                                ))}
                              </select>
                              {selected && (
                                <div className="flex items-center gap-1.5 text-[10px]">
                                  <span style={{ color: selected.stockQty <= 0 ? '#DC2626' : '#059669', fontWeight: 600 }}>
                                    {selected.stockQty <= 0 ? '⚠ Out of stock — needs ordering' : `✓ ${selected.stockQty} available`}
                                  </span>
                                  <span style={{ color: '#9CA3AF' }}>· SKU: {selected.sku || '—'}</span>
                                </div>
                              )}
                              {!item.productId && (
                                <input className="form-input" style={{ fontSize: 11 }} value={item.productName}
                                  placeholder="Or type item name manually…"
                                  onChange={e => setProcurementForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, productName: e.target.value } : x) }))} />
                              )}
                            </div>
                          )
                        })()}
                      </Field>
                      <Field label="Qty">
                        <input className="form-input" type="number" min="1" value={item.qty}
                          onChange={e => setProcurementForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) }))} />
                      </Field>
                      <Field label="Est. Cost (KES)">
                        <input className="form-input" type="number" value={item.estimatedCost}
                          onChange={e => setProcurementForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, estimatedCost: e.target.value } : x) }))} />
                      </Field>
                    </div>
                    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                      <Field label="Supplier / Source">
                        <input className="form-input" value={item.supplier} placeholder="e.g. Synnex, Amazon"
                          onChange={e => setProcurementForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, supplier: e.target.value } : x) }))} />
                      </Field>
                      <Field label="Description / Notes">
                        <input className="form-input" value={item.description} placeholder="Specification or reason for request"
                          onChange={e => setProcurementForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }))} />
                      </Field>
                    </div>
                  </div>
                ))}
                <button className="btn-secondary text-xs" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setProcurementForm(p => ({ ...p, items: [...p.items, { type: 'part' as 'part' | 'software' | 'license', productId: '', productName: '', description: '', qty: '1', estimatedCost: '0', supplier: '', partNumber: '' }] }))}>
                  + Add Another Item
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Urgency">
                  <Select value={pf.urgency} onChange={v => setProcurementForm(p => ({ ...p, urgency: v as typeof p.urgency }))}
                    options={[
                      { value: 'low',    label: 'Low — no rush' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'high',   label: 'High — needed soon' },
                      { value: 'urgent', label: '🔴 Urgent — needed today' },
                    ]} />
                </Field>
                <Field label="Notes">
                  <input className="form-input" value={pf.notes} placeholder="Any additional notes..."
                    onChange={e => setProcurementForm(p => ({ ...p, notes: e.target.value }))} />
                </Field>
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-outline" onClick={() => setShowProcurementModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={() => {
                  requestProcurement(r.id, pf.items, pf.urgency, pf.notes)
                  setProcurementForm({ items: [{ type: 'part', productId: '', productName: '', description: '', qty: '1', estimatedCost: '0', supplier: '', partNumber: '' }], urgency: 'normal', notes: '' })
                  setShowProcurementModal(false)
                }}>Submit Request</button>
              </div>
            </Modal>
          )
        })()}

        {/* ── Mark Unrepairable Modal ── */}
        {showReturnModal && (
          <Modal title="Mark as Unrepairable" onClose={() => setShowReturnModal(false)} width={500}>
            <div className="mb-4 p-3 rounded text-xs" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
              ⚠️ This will mark the device as unrepairable and notify the customer for return pickup.
            </div>
            <Field label="Reason (will be sent to customer)" required>
              <Textarea
                value={returnReason}
                onChange={v => setReturnReason(v)}
                rows={4}
                placeholder="e.g., Motherboard damage beyond repair, Water damage too severe..."
              />
            </Field>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowReturnModal(false)} className="btn-outline">Cancel</button>
              <button
                onClick={() => {
                  if (!returnReason) { showToast('Please provide a reason', 'error'); return }
                  markUnrepairable(r.id, returnReason)
                  setReturnReason('')
                  setShowReturnModal(false)
                }}
                style={{ padding: '8px 18px', borderRadius: 8, background: '#991B1B', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Mark as Unrepairable
              </button>
            </div>
          </Modal>
        )}

        {/* ── Create Invoice Modal ── */}
        {invoiceRepairId && (() => {
          const target = repairs.find(x => x.id === invoiceRepairId)
          if (!target) return null
          return (
            <Modal title="Create Invoice" onClose={() => setInvoiceRepairId(null)} width={400}>
              <p className="text-xs text-t2 mb-4">
                Generate a final invoice for <strong>{target.productName}</strong>.
              </p>
              <label className="flex items-center gap-2 cursor-pointer text-xs select-none mb-4">
                <input type="checkbox" checked={invoiceApplyVat} onChange={e => setInvoiceApplyVat(e.target.checked)} />
                Apply VAT ({companySettings.vatRate}%)
              </label>
              <div className="flex gap-2 justify-end">
                <button className="btn-outline" onClick={() => setInvoiceRepairId(null)}>Cancel</button>
                <button className="btn-primary" onClick={() => {
                  createInvoiceFromRepair(target.id, invoiceApplyVat)
                  setInvoiceRepairId(null)
                }}>Generate Invoice</button>
              </div>
            </Modal>
          )
        })()}

      </div>
    )
  }
}