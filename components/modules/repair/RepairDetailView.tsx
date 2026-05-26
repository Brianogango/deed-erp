// @ts-nocheck
'use client'

import { useState, useRef } from 'react'
import { useRepair } from './RepairContext'
import { Fa } from '@/components/icons'
import { 
  faArrowLeft, faUser, faMicrochip, faClipboardList, faHistory, 
  faTools, faCheckCircle, faCircleExclamation, faCamera, faImage,
  faPlay, faLink, faCopy, faExternalLinkAlt, faUserCheck, faUserPlus,
  faQuoteRight, faFileInvoiceDollar, faCalendarAlt, faClock, faTrash, faUpload, faSync,
  faStethoscope
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
    <div className="flex flex-col h-full bg-slate-100/40">
      {/* Hidden Inputs */}
      <input 
        type="file" 
        ref={photoInputRef} 
        onChange={handlePhotoUpload} 
        accept="image/*" 
        className="hidden" 
      />

      {/* Module Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4 sm:px-6 shadow-sm z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setActiveId(null); setView('list') }}
              className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-600 transition-all active:scale-90 border border-slate-100 shadow-sm"
            >
              <Fa icon={faArrowLeft} />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-black text-slate-900 tracking-tight">{r.ref}</h1>
                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                  r.status === 'pending_verification' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                  r.status === 'received' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                {r.customerName} <span className="mx-1 text-slate-300">•</span> {r.productName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canVerify && (
              <>
                <button onClick={() => setShowDeclineModal(true)} className="px-5 py-2.5 rounded-xl bg-white border border-red-200 text-red-600 text-[11px] font-black uppercase tracking-widest hover:bg-red-50 transition-all shadow-sm">
                  Decline
                </button>
                <button onClick={handleVerify} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-md flex items-center gap-2">
                  <Fa icon={faUserCheck} /> Verify Intake
                </button>
              </>
            )}
            {canAssign && (
              <button onClick={() => setShowAssignModal(true)} className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-md flex items-center gap-2">
                <Fa icon={faUserPlus} /> {r.assignedTechnicianId ? 'Reassign Tech' : 'Assign Tech'}
              </button>
            )}
            {canDiagnose && (
              <button onClick={() => setShowDiagnosisModal(true)} className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-md flex items-center gap-2">
                <Fa icon={faTools} /> Log Diagnosis
              </button>
            )}
            {canQuote && (
              <button onClick={() => setShowQuoteModal(true)} className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-md flex items-center gap-2">
                <Fa icon={faFileInvoiceDollar} /> {r.quote ? 'Edit Quote' : 'Generate Quote'}
              </button>
            )}
            {canStart && (
              <button onClick={() => updateRepair(r.id, { status: 'in_repair', repairStartDate: new Date().toISOString() })} className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-md flex items-center gap-2">
                <Fa icon={faPlay} /> Start Repair
              </button>
            )}
            {canComplete && (
              <button onClick={() => setShowQAModal(true)} className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-md flex items-center gap-2">
                <Fa icon={faCheckCircle} /> Mark Complete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2 space-y-8">
            {/* Device & Client Details */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-slate-900 text-white shadow-lg shadow-slate-200"><Fa icon={faMicrochip} className="text-xs" /></div>
                  <h3 className="text-[12px] font-black text-slate-900 uppercase tracking-widest">Device & Client Details</h3>
                </div>
                <div className="flex items-center gap-2 text-slate-500">
                  <Fa icon={faCalendarAlt} className="text-[10px]" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Intake: {new Date(r.intakeDate).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-8 gap-x-6">
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
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 border-l-[6px] border-l-amber-500">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-amber-500 text-white shadow-lg shadow-amber-100"><Fa icon={faCircleExclamation} className="text-xs" /></div>
                <h3 className="text-[12px] font-black text-slate-900 uppercase tracking-widest">Reported Issue</h3>
              </div>
              <div className="bg-amber-50/30 rounded-2xl p-6 border border-amber-100/50">
                <p className="text-[13px] text-slate-800 leading-relaxed font-bold">
                  {r.issueDescription || "No issue description provided"}
                </p>
              </div>
            </div>

            {/* Issue Photos */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-100"><Fa icon={faCamera} className="text-xs" /></div>
                  <h3 className="text-[12px] font-black text-slate-900 uppercase tracking-widest">Issue Photos</h3>
                </div>
                <button 
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  type="button"
                  className="text-[10px] font-black text-slate-600 hover:text-indigo-600 flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-slate-100 hover:border-indigo-200 transition-all uppercase tracking-widest bg-white disabled:opacity-50 shadow-sm"
                >
                  <Fa icon={uploadingPhoto ? faSync : faUpload} className={`text-[10px] ${uploadingPhoto ? 'animate-spin' : ''}`} /> {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                </button>
              </div>
              
              {r.issuePhotos && r.issuePhotos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  {r.issuePhotos.map((photo, idx) => (
                    <div key={idx} className="group relative aspect-square rounded-2xl overflow-hidden border-2 border-slate-100 shadow-sm">
                      <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-3 backdrop-blur-[2px]">
                        <button onClick={() => removePhoto(idx)} className="w-10 h-10 rounded-xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all shadow-lg">
                          <Fa icon={faTrash} className="text-xs" />
                        </button>
                        <a href={photo.url} target="_blank" className="w-10 h-10 rounded-xl bg-white text-slate-900 flex items-center justify-center hover:bg-slate-50 transition-all shadow-lg">
                          <Fa icon={faExternalLinkAlt} className="text-xs" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-slate-400 gap-4">
                  <div className="p-4 rounded-full bg-white shadow-sm"><Fa icon={faImage} className="text-3xl opacity-20" /></div>
                  <p className="text-[12px] font-black uppercase tracking-widest opacity-60">No photos uploaded yet</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-8">
            {/* Client Follow-up Link */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 border-l-[6px] border-l-blue-600 overflow-hidden relative">
              <div className="absolute top-0 right-0 p-12 opacity-[0.03] pointer-events-none">
                <Fa icon={faLink} className="text-8xl rotate-[-15deg] text-blue-900" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-100"><Fa icon={faLink} className="text-xs" /></div>
                    <p className="text-[12px] font-black uppercase tracking-widest text-slate-900">Follow-up Portal</p>
                  </div>
                  <button onClick={copyLink} className="p-2 rounded-xl bg-slate-50 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all border border-slate-100">
                    <Fa icon={faCopy} className="text-xs" />
                  </button>
                </div>
                <div className="bg-slate-900 rounded-2xl p-4 mb-8 border border-slate-800 shadow-inner">
                  <p className="text-[11px] font-mono break-all text-blue-400 font-bold leading-relaxed">{portalUrl}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={copyLink} className="py-3 rounded-2xl bg-white border-2 border-slate-100 text-slate-900 text-[11px] font-black uppercase tracking-widest hover:border-blue-200 hover:text-blue-600 transition-all shadow-sm">Copy Link</button>
                  <a href={portalUrl} target="_blank" className="py-3 rounded-2xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all text-center shadow-md shadow-blue-100">Open Portal</a>
                </div>
              </div>
            </div>

            {/* Quotation Overview */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 border-l-[6px] border-l-emerald-500">
              <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-100"><Fa icon={faQuoteRight} className="text-xs" /></div>
                  <h3 className="text-[12px] font-black text-slate-900 uppercase tracking-widest">Financials</h3>
                </div>
                {r.quote && (
                  <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                    r.quote.approvedDate ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    r.quote.rejectedDate ? 'bg-red-50 text-red-700 border-red-200' :
                    'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {r.quote.approvedDate ? 'Approved' : r.quote.rejectedDate ? 'Rejected' : 'Awaiting Approval'}
                  </span>
                )}
              </div>
              
              {r.quote ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-5 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Total Amount</p>
                      <p className="text-xl font-black text-white tracking-tight">KES {r.quote.total.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Valid Until</p>
                      <p className="text-xs font-black text-emerald-400">{new Date(r.quote.validUntil).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Line Items ({r.quote.lines.length})
                    </p>
                    <div className="max-h-48 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                      {r.quote.lines.map((line, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px] p-3 bg-slate-50 rounded-xl border border-slate-100">
                          <span className="text-slate-700 font-bold line-clamp-1 flex-1 mr-3">{line.description}</span>
                          <span className="text-slate-900 font-black">KES {line.subtotal.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-slate-400 gap-4">
                  <Fa icon={faFileInvoiceDollar} className="text-3xl opacity-20" />
                  <p className="text-[12px] font-black uppercase tracking-widest opacity-60">No quote generated yet</p>
                  <button onClick={() => setShowQuoteModal(true)} className="px-6 py-2 rounded-xl bg-white border-2 border-slate-200 text-slate-900 text-[10px] font-black uppercase tracking-widest hover:border-emerald-200 hover:text-emerald-600 transition-all shadow-sm">Generate Now</button>
                </div>
              )}
            </div>

            {/* Customer Chat */}
            <MessageThread repairRef={r.ref} staffName={currentUser?.name || 'Staff'} />

            {/* Status History */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 border-l-[6px] border-l-slate-900">
              <div className="flex items-center gap-3 mb-8 pb-4 border-b border-slate-100">
                <div className="p-2 rounded-xl bg-slate-900 text-white shadow-lg shadow-slate-200"><Fa icon={faHistory} className="text-xs" /></div>
                <h3 className="text-[12px] font-black text-slate-900 uppercase tracking-widest">Workflow Progress</h3>
              </div>
              <div className="px-2">
                <StatusStepper currentStatus={r.status} steps={STEPPER_STEPS} labels={STATUS_LABELS} />
              </div>
              <div className="mt-8 p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-3">
                <div className="p-2 rounded-xl bg-white text-blue-600 shadow-sm"><Fa icon={faStethoscope} className="text-xs" /></div>
                <div>
                  <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Service Type</p>
                  <p className="text-[11px] font-black text-blue-900 uppercase tracking-tight">{r.repairPath === 'direct_repair' ? 'Direct Repair' : 'Diagnosis First'}</p>
                </div>
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
    <div className="flex flex-col gap-1.5 group">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-slate-500 transition-colors">{label}</p>
      <p className={`text-[13px] font-black tracking-tight ${highlight ? 'text-blue-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}
