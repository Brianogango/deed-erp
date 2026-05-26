// @ts-nocheck
'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRepair } from './RepairContext'
import { Badge, Modal, Field, Input, Select, Confirm, StatusStepper, Textarea } from '@/components/ui'
import { fmtKes, fmtDate, type RepairStatus } from '@/lib/store'
import { Fa } from '@/components/icons'
import { 
  faScrewdriverWrench, 
  faCircleExclamation, 
  faCircleCheck,
  faArrowLeft,
  faUserPlus,
  faStethoscope,
  faFileInvoiceDollar,
  faPlay,
  faCheckCircle,
  faClipboardCheck,
  faHistory,
  faEnvelope,
  faInfoCircle,
  faTools,
  faMicrochip,
  faLink,
  faCopy,
  faExternalLinkAlt,
  faCamera,
  faImage,
  faTimesCircle
} from '@fortawesome/free-solid-svg-icons'
import { STATUS_LABELS, STATUS_COLORS } from '../repair-config'

function MessageThread({ repairRef, staffName }: { repairRef: string; staffName: string }) {
  const [messages, setMessages] = useState<any[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/repair/${encodeURIComponent(repairRef)}/messages?by=staff`)
      if (res.ok) { 
        const d = await res.json(); 
        setMessages(d.messages); 
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50) 
      }
    } catch { /* silent */ }
  }, [repairRef])

  useEffect(() => { fetch_() }, [fetch_])
  useEffect(() => { const id = setInterval(fetch_, 5000); return () => clearInterval(id) }, [fetch_])

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
    <div className="card flex flex-col h-full overflow-hidden border-blue-100/50 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-blue-50/30 border-b border-blue-100/50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-100 text-blue-600">
            <Fa icon={faEnvelope} className="text-xs" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-blue-900 uppercase tracking-tight">Customer Chat</p>
            {unread > 0 && <span className="text-[9px] font-bold text-red-500">{unread} new messages</span>}
          </div>
        </div>
        <button onClick={fetch_} className="text-[10px] font-medium text-blue-600 hover:text-blue-800 transition-colors">↻ Refresh</button>
      </div>
      
      <div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto custom-scrollbar bg-slate-50/30" style={{ minHeight: 250 }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <Fa icon={faEnvelope} className="text-xl opacity-20" />
            <p className="text-xs font-medium">No messages yet</p>
            <p className="text-[10px] opacity-60">Reply to customer below</p>
          </div>
        ) : messages.map(m => {
          const isStaff = m.sender === 'staff'
          return (
            <div key={m.id} className={`flex flex-col ${isStaff ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs shadow-sm ${
                isStaff 
                  ? 'bg-blue-600 text-white rounded-tr-none' 
                  : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
              }`}>
                <p className="leading-relaxed">{m.text}</p>
              </div>
              <p className="text-[9px] mt-1 font-medium text-slate-400 px-1">
                {isStaff ? 'You' : m.senderName} • {new Date(m.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
      
      <div className="p-3 bg-white border-t border-slate-100">
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
          <input 
            className="flex-1 bg-transparent border-none outline-none px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400" 
            value={text} 
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }} 
            placeholder="Reply to customer..." 
          />
          <button 
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              !text.trim() || sending 
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                : 'bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:scale-95'
            }`}
            onClick={send} 
            disabled={!text.trim() || sending}
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

const STEPPER_STEPS: RepairStatus[] = [
  'pending_verification', 'received', 'assigned', 'diagnosed', 'awaiting_approval',
  'awaiting_parts', 'in_repair', 'qc', 'ready', 'invoiced', 'delivered', 'closed',
]

export default function RepairDetailView() {
  const {
    activeRepair: r, currentUserId, currentUser, systemSettings, setView, setActiveId,
    setShowAssignModal, setShowDiagnosisModal, setShowQuoteModal, setShowQAModal,
    setShowDeliveryModal, setShowProgressModal, setShowProcurementModal, setShowReturnModal,
    setShowDeclineModal, setShowMarkDeliveredConfirm, updateRepair,
    uploadingDiagReport, uploadingQcReport, handleReportUpload,
    diagReportInputRef, qcReportInputRef, showToast
  } = useRepair()

  if (!r) return null

  // Role & Permission Helpers
  const isRepairTech = currentUser?.role === 'technician'
  const isLeadTech   = currentUser?.role === 'technical_lead'
  const isAssigner   = currentUser?.role === 'technical_lead' || (currentUser?.role === 'director' && systemSettings.repAdminAssignsJobs)
  
  const isMyRepair   = r.assignedTechnicianId === currentUserId
  const canVerify    = r.status === 'pending_verification' && ['technical_lead', 'director', 'admin_officer'].includes(currentUser?.role ?? '')
  const canAssign    = isAssigner && ['received', 'assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc', 'ready'].includes(r.status)
  const canDiagnose  = r.status === 'assigned' && isMyRepair && r.repairPath !== 'direct_repair'
  const canQuote     = (r.repairPath === 'direct_repair' ? ['assigned', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair'].includes(r.status) : ['diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair'].includes(r.status)) && (isMyRepair || ['director', 'admin_officer', 'technical_lead', 'sales_rep', 'finance_officer'].includes(currentUser?.role ?? '')) && !r.diagnosisStopped
  const canStart     = ((r.status === 'approved' || r.status === 'awaiting_parts') || (r.status === 'assigned' && r.repairPath === 'direct_repair')) && isMyRepair
  const canComplete  = r.status === 'in_repair' && isMyRepair
  const canQA        = r.status === 'qc' && (['director', 'technical_lead'].includes(currentUser?.role ?? '')) && r.assignedTechnicianId !== currentUserId
  const canInvoice   = r.status === 'ready' && ['director', 'finance_officer'].includes(currentUser?.role ?? '') && !r.invoiceId

  const handleVerify = () => {
    updateRepair(r.id, { status: 'received' })
    showToast(`Repair ${r.ref} verified successfully`, 'success')
  }

  const portalUrl = `https://erp.deed.co.ke/portal/repair/${r.ref}`

  const copyLink = () => {
    navigator.clipboard.writeText(portalUrl)
    showToast('Portal link copied to clipboard', 'success')
  }

  return (
    <div className="flex flex-col bg-slate-50/50 animate-in fade-in duration-300">
      <div className="bg-white border-b border-slate-200 px-4 py-3 sm:px-6 z-10 shadow-sm flex-shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setView('list'); setActiveId(null) }}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90"
            >
              <Fa icon={faArrowLeft} />
            </button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-slate-900 tracking-tight">{r.ref}</h1>
                <Badge status={r.status} label={STATUS_LABELS[r.status]} />
                {r.underWarranty && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">WARRANTY</span>}
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {r.customerName} • {r.productName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
            {canVerify && (
              <div className="flex items-center gap-2">
                <button className="btn-primary whitespace-nowrap bg-emerald-600 hover:bg-emerald-700" onClick={handleVerify}>
                  <Fa icon={faCircleCheck} className="mr-2" /> Verify Intake
                </button>
                <button className="btn-secondary whitespace-nowrap text-red-600 border-red-100 hover:bg-red-50" onClick={() => setShowDeclineModal(true)}>
                  <Fa icon={faTimesCircle} className="mr-2" /> Decline
                </button>
              </div>
            )}
            {canAssign && <button className="btn-secondary whitespace-nowrap" onClick={() => setShowAssignModal(true)}><Fa icon={faUserPlus} className="mr-2" /> {r.assignedTechnicianName ? 'Reassign' : 'Assign Tech'}</button>}
            {canDiagnose && <button className="btn-primary whitespace-nowrap bg-indigo-600 hover:bg-indigo-700" onClick={() => setShowDiagnosisModal(true)}><Fa icon={faStethoscope} className="mr-2" /> Log Diagnosis</button>}
            {canQuote && <button className="btn-secondary whitespace-nowrap" onClick={() => setShowQuoteModal(true)}><Fa icon={faFileInvoiceDollar} className="mr-2" /> {r.quote ? 'Update Quote' : 'Generate Quote'}</button>}
            {canStart && <button className="btn-primary whitespace-nowrap bg-blue-600 hover:bg-blue-700" onClick={() => setShowProgressModal(true)}><Fa icon={faPlay} className="mr-2" /> Start Repair</button>}
            {canComplete && <button className="btn-primary whitespace-nowrap bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowProgressModal(true)}><Fa icon={faCheckCircle} className="mr-2" /> Mark Fixed</button>}
            {canQA && <button className="btn-primary whitespace-nowrap bg-fuchsia-600 hover:bg-fuchsia-700" onClick={() => setShowQAModal(true)}><Fa icon={faClipboardCheck} className="mr-2" /> Complete QA</button>}
            {canInvoice && <button className="btn-primary whitespace-nowrap bg-amber-600 hover:bg-amber-700" onClick={() => setShowProgressModal(true)}><Fa icon={faFileInvoiceDollar} className="mr-2" /> Create Invoice</button>}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="card overflow-hidden shadow-sm">
              <div className="bg-slate-50 border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-100 text-blue-600"><Fa icon={faMicrochip} className="text-xs" /></div>
                  <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Device & Client Details</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Intake: {fmtDate(r.intakeDate)}</span>
                </div>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                <InfoRow label="Client" value={r.customerName} />
                <InfoRow label="Phone" value={r.customerPhone} />
                <InfoRow label="Device" value={r.productName} />
                <InfoRow label="Serial" value={r.serialNumber || '—'} />
                <InfoRow label="Colour" value={r.deviceColor || '—'} />
                <InfoRow label="Condition" value={r.deviceCondition || 'Good'} />
                <InfoRow label="Priority" value={r.priority} highlight={r.priority === 'urgent' || r.priority === 'high'} />
                <InfoRow label="Channel" value={r.intakeChannel || 'Walk In'} />
                <InfoRow label="Technician" value={r.assignedTechnicianName || 'Unassigned'} highlight={!!r.assignedTechnicianName} />
                <InfoRow label="Booked By" value={r.bookedByName || r.createdBy || 'Moses Ndung\'u Muthee'} />
              </div>
            </div>

            <div className="card p-5 border-l-4 border-l-amber-500 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600"><Fa icon={faCircleExclamation} className="text-xs" /></div>
                <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Reported Issue</h3>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  {r.issueDescription || "No issue description provided"}
                </p>
              </div>
            </div>

            <div className="card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600"><Fa icon={faCamera} className="text-xs" /></div>
                  <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Issue Photos</h3>
                </div>
                <button className="text-[10px] font-bold text-slate-500 hover:text-indigo-600 flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 hover:border-indigo-200 transition-all">
                  <Fa icon={faPlay} className="text-[8px] rotate-[-90deg]" /> Upload Photo
                </button>
              </div>
              <div className="flex flex-col items-center justify-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-slate-400 gap-2">
                <Fa icon={faImage} className="text-2xl opacity-20" />
                <p className="text-[11px] font-medium">No photos uploaded yet</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="card p-5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-200">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Fa icon={faLink} className="text-xs opacity-70" />
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Client Follow-up Link</p>
                </div>
                <button onClick={copyLink} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-all">
                  <Fa icon={faCopy} className="text-xs" />
                </button>
              </div>
              <div className="bg-white/10 rounded-xl p-3 mb-6 border border-white/10">
                <p className="text-[10px] font-mono break-all opacity-90">{portalUrl}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={copyLink} className="py-2 rounded-xl bg-white text-blue-600 text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 transition-all">Copy Link</button>
                <a href={portalUrl} target="_blank" className="py-2 rounded-xl bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-400 transition-all text-center">Open Portal</a>
              </div>
            </div>

            <MessageThread repairRef={r.ref} staffName={currentUser?.name || 'Staff'} />

            <div className="card p-5 border-l-4 border-l-slate-400 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600"><Fa icon={faHistory} className="text-xs" /></div>
                <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Status History</h3>
              </div>
              <div className="space-y-4">
                <StatusStepper currentStatus={r.status} steps={STEPPER_STEPS} labels={STATUS_LABELS} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <p className={`text-xs font-bold ${highlight ? 'text-blue-600' : 'text-slate-700'}`}>{value}</p>
    </div>
  )
}
