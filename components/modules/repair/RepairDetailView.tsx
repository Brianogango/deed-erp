// @ts-nocheck
'use client'

import { useState, useRef } from 'react'
import { useRepair } from './RepairContext'
import { Fa } from '@/components/icons'
import { 
  faArrowLeft, faUser, faMicrochip, faClipboardList, faHistory, 
  faTools, faCheckCircle, faCircleExclamation, faCamera, faImage,
  faPlay, faLink, faCopy, faExternalLinkAlt, faUserCheck, faUserPlus,
  faQuoteRight, faFileInvoiceDollar, faCalendarAlt, faClock, faTrash, faUpload
} from '@fortawesome/free-solid-svg-icons'
import { STATUS_LABELS, STEPPER_STEPS } from '../repair-config'
import StatusStepper from './StatusStepper'
import MessageThread from './MessageThread'

export default function RepairDetailView() {
  const {
    activeRepair: r, currentUserId, currentUser, systemSettings, setView, setActiveId,
    setShowAssignModal, setShowDiagnosisModal, setShowQuoteModal, setShowQAModal,
    setShowDeliveryModal, setShowProgressModal, setShowProcurementModal, setShowReturnModal,
    setShowDeclineModal, setShowMarkDeliveredConfirm, updateRepair,
    uploadingDiagReport, uploadingQcReport, handleReportUpload,
    diagReportInputRef, qcReportInputRef, showToast
  } = useRepair()

  const photoInputRef = useRef(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  if (!r) return null

  // Role & Permission Helpers
  const isRepairTech = currentUser?.role === 'technician'
  const isLeadTech   = currentUser?.role === 'technical_lead'
  const isAssigner   = currentUser?.role === 'technical_lead' || (currentUser?.role === 'director' && systemSettings.repAdminAssignsJobs)
  
  const isMyRepair   = r.assignedTechnicianId === currentUserId
  const canVerify    = r.status === 'pending_verification' && ['technical_lead', 'director', 'admin_officer', 'admin'].includes(currentUser?.role ?? '')
  const canAssign    = isAssigner && ['received', 'assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc', 'ready'].includes(r.status)
  const canDiagnose  = r.status === 'assigned' && isMyRepair && r.repairPath !== 'direct_repair'
  const canQuote     = (r.repairPath === 'direct_repair' ? ['assigned', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair'].includes(r.status) : ['diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair'].includes(r.status)) && (isMyRepair || ['director', 'admin_officer', 'technical_lead', 'sales_rep', 'finance_officer', 'admin'].includes(currentUser?.role ?? '')) && !r.diagnosisStopped
  const canStart     = ((r.status === 'approved' || r.status === 'awaiting_parts') || (r.status === 'assigned' && r.repairPath === 'direct_repair')) && isMyRepair
  const canComplete  = r.status === 'in_repair' && isMyRepair
  const canQA        = r.status === 'qc' && (['director', 'technical_lead', 'admin'].includes(currentUser?.role ?? '')) && r.assignedTechnicianId !== currentUserId
  const canInvoice   = r.status === 'ready' && ['director', 'finance_officer', 'admin'].includes(currentUser?.role ?? '') && !r.invoiceId

  const handleVerify = () => {
    updateRepair(r.id, { 
      status: 'received',
      verificationDate: new Date().toISOString(),
      verifiedBy: currentUser?.name || 'Staff'
    })
    showToast(`Repair ${r.ref} verified successfully`, 'success')
  }

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    setUploadingPhoto(true)
    const reader = new FileReader()
    reader.onload = (event) => {
      const data = event.target?.result
      const currentPhotos = r.issuePhotos || []
      updateRepair(r.id, { issuePhotos: [...currentPhotos, { url: data, name: file.name, date: new Date().toISOString() }] })
      setUploadingPhoto(false)
      showToast('Photo uploaded successfully', 'success')
    }
    reader.readAsDataURL(file)
  }

  const removePhoto = (idx) => {
    const currentPhotos = [...(r.issuePhotos || [])]
    currentPhotos.splice(idx, 1)
    updateRepair(r.id, { issuePhotos: currentPhotos })
    showToast('Photo removed', 'info')
  }

  const portalUrl = `https://erp.deed.co.ke/portal/repair/${r.ref}`
  const copyLink = () => {
    navigator.clipboard.writeText(portalUrl)
    showToast('Portal link copied!', 'success')
  }

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      {/* Hidden Inputs */}
      <input 
        type="file" 
        ref={photoInputRef} 
        onChange={handlePhotoUpload} 
        accept="image/*" 
        className="hidden" 
      />

      {/* Module Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sm:px-6 shadow-sm z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setActiveId(null); setView('list') }}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90"
            >
              <Fa icon={faArrowLeft} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black text-slate-900 tracking-tight">{r.ref}</h1>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                  r.status === 'pending_verification' ? 'bg-amber-100 text-amber-700' :
                  r.status === 'received' ? 'bg-emerald-100 text-emerald-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                {r.customerName} • {r.productName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canVerify && (
              <>
                <button onClick={() => setShowDeclineModal(true)} className="btn-secondary text-red-600 border-red-100 hover:bg-red-50 py-2 rounded-xl text-[11px] font-bold">
                  Decline
                </button>
                <button onClick={handleVerify} className="btn-primary bg-emerald-600 hover:bg-emerald-700 py-2 rounded-xl text-[11px] font-bold flex items-center gap-2">
                  <Fa icon={faUserCheck} /> Verify Intake
                </button>
              </>
            )}
            {canAssign && (
              <button onClick={() => setShowAssignModal(true)} className="btn-primary py-2 rounded-xl text-[11px] font-bold flex items-center gap-2">
                <Fa icon={faUserPlus} /> {r.assignedTechnicianId ? 'Reassign Tech' : 'Assign Tech'}
              </button>
            )}
            {canDiagnose && (
              <button onClick={() => setShowDiagnosisModal(true)} className="btn-primary py-2 rounded-xl text-[11px] font-bold flex items-center gap-2">
                <Fa icon={faTools} /> Log Diagnosis
              </button>
            )}
            {canQuote && (
              <button onClick={() => setShowQuoteModal(true)} className="btn-primary py-2 rounded-xl text-[11px] font-bold flex items-center gap-2">
                <Fa icon={faFileInvoiceDollar} /> {r.quote ? 'Edit Quote' : 'Generate Quote'}
              </button>
            )}
            {canStart && (
              <button onClick={() => updateRepair(r.id, { status: 'in_repair', repairStartDate: new Date().toISOString() })} className="btn-primary bg-indigo-600 hover:bg-indigo-700 py-2 rounded-xl text-[11px] font-bold flex items-center gap-2">
                <Fa icon={faPlay} /> Start Repair
              </button>
            )}
            {canComplete && (
              <button onClick={() => setShowQAModal(true)} className="btn-primary bg-emerald-600 hover:bg-emerald-700 py-2 rounded-xl text-[11px] font-bold flex items-center gap-2">
                <Fa icon={faCheckCircle} /> Mark Complete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="lg:col-span-2 space-y-6">
            {/* Device & Client Details */}
            <div className="card p-6 shadow-sm border-t-4 border-t-slate-800">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600"><Fa icon={faMicrochip} className="text-xs" /></div>
                  <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Device & Client Details</h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Intake: {new Date(r.intakeDate).toLocaleDateString()}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-6 gap-x-4">
                <InfoRow label="Client" value={r.customerName} highlight />
                <InfoRow label="Phone" value={r.customerPhone} />
                <InfoRow label="Email" value={r.customerEmail || '—'} />
                <InfoRow label="Device" value={r.productName} />
                <InfoRow label="Serial" value={r.serialNumber || '—'} />
                <InfoRow label="Colour" value={r.deviceColour || '—'} />
                <InfoRow label="Condition" value={r.deviceCondition || '—'} />
                <InfoRow label="Priority" value={r.priority} />
                <InfoRow label="Channel" value={r.intakeChannel?.replace('_', ' ') || '—'} />
                <InfoRow label="Technician" value={r.assignedTechnicianName || 'Unassigned'} highlight={!!r.assignedTechnicianId} />
                <InfoRow label="Booked By" value={r.createdBy || 'Moses Ndung\'u Muthee'} />
                <InfoRow label="Verified By" value={r.verifiedBy || '—'} />
              </div>
            </div>

            {/* Reported Issue */}
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

            {/* Issue Photos */}
            <div className="card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600"><Fa icon={faCamera} className="text-xs" /></div>
                  <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Issue Photos</h3>
                </div>
                <button 
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="text-[10px] font-black text-slate-500 hover:text-indigo-600 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-indigo-200 transition-all uppercase tracking-widest bg-white disabled:opacity-50"
                >
                  <Fa icon={uploadingPhoto ? faSync : faUpload} className={`text-[8px] ${uploadingPhoto ? 'animate-spin' : ''}`} /> {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                </button>
              </div>
              
              {r.issuePhotos && r.issuePhotos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {r.issuePhotos.map((photo, idx) => (
                    <div key={idx} className="group relative aspect-square rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                      <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-2">
                        <button onClick={() => removePhoto(idx)} className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all">
                          <Fa icon={faTrash} className="text-[10px]" />
                        </button>
                        <a href={photo.url} target="_blank" className="w-8 h-8 rounded-full bg-white text-slate-900 flex items-center justify-center hover:bg-slate-100 transition-all">
                          <Fa icon={faExternalLinkAlt} className="text-[10px]" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-slate-400 gap-2">
                  <Fa icon={faImage} className="text-2xl opacity-20" />
                  <p className="text-[11px] font-medium">No photos uploaded yet</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {/* Client Follow-up Link */}
            <div className="card p-5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-200 overflow-hidden relative">
              <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                <Fa icon={faLink} className="text-6xl rotate-[-15deg]" />
              </div>
              <div className="relative z-10">
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
                  <button onClick={copyLink} className="py-2.5 rounded-xl bg-white text-blue-600 text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 transition-all shadow-sm">Copy Link</button>
                  <a href={portalUrl} target="_blank" className="py-2.5 rounded-xl bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-400 transition-all text-center shadow-sm">Open Portal</a>
                </div>
              </div>
            </div>

            {/* Quotation Overview */}
            <div className="card p-5 border-l-4 border-l-emerald-500 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600"><Fa icon={faQuoteRight} className="text-xs" /></div>
                  <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Quotation Overview</h3>
                </div>
                {r.quote && (
                  <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
                    r.quote.approvedDate ? 'bg-emerald-100 text-emerald-700' :
                    r.quote.rejectedDate ? 'bg-red-100 text-red-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {r.quote.approvedDate ? 'Approved' : r.quote.rejectedDate ? 'Rejected' : 'Awaiting Approval'}
                  </span>
                )}
              </div>
              
              {r.quote ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Amount</p>
                      <p className="text-lg font-black text-slate-900 tracking-tight">KES {r.quote.total.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Valid Until</p>
                      <p className="text-xs font-bold text-slate-700">{new Date(r.quote.validUntil).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Line Items ({r.quote.lines.length})</p>
                    <div className="max-h-32 overflow-y-auto pr-1 custom-scrollbar space-y-1.5">
                      {r.quote.lines.map((line, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[10px] py-1 border-b border-slate-50 last:border-0">
                          <span className="text-slate-600 font-medium line-clamp-1 flex-1 mr-2">{line.description}</span>
                          <span className="text-slate-900 font-bold">KES {line.subtotal.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-slate-400 gap-2">
                  <Fa icon={faFileInvoiceDollar} className="text-2xl opacity-20" />
                  <p className="text-[11px] font-medium">No quote generated yet</p>
                  <button onClick={() => setShowQuoteModal(true)} className="mt-2 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline">Generate Now</button>
                </div>
              )}
            </div>

            {/* Customer Chat */}
            <MessageThread repairRef={r.ref} staffName={currentUser?.name || 'Staff'} />

            {/* Status History */}
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
