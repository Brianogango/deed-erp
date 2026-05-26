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
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Hidden Inputs */}
      <input 
        type="file" 
        ref={photoInputRef} 
        onChange={handlePhotoUpload} 
        accept="image/*" 
        className="hidden" 
      />

      {/* Module Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5 shadow-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-5">
            <button 
              onClick={() => { setActiveId(null); setView('list') }}
              className="p-3 rounded-2xl hover:bg-slate-100 text-slate-700 transition-all active:scale-95 border border-slate-200 shadow-sm"
            >
              <Fa icon={faArrowLeft} className="text-sm" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">{r.ref}</h1>
                <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border-2 ${
                  r.status === 'pending_verification' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                  r.status === 'received' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                  'bg-blue-50 text-blue-800 border-blue-200'
                }`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="text-[12px] text-slate-700 font-extrabold uppercase tracking-widest mt-1 flex items-center gap-2">
                <span className="text-slate-900">{r.customerName}</span>
                <span className="text-slate-300">|</span>
                <span className="text-indigo-600">{r.productName}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canVerify && (
              <>
                <button onClick={() => setShowDeclineModal(true)} className="px-6 py-3 rounded-2xl bg-white border-2 border-red-200 text-red-700 text-[11px] font-black uppercase tracking-widest hover:bg-red-50 transition-all shadow-sm">
                  Decline
                </button>
                <button onClick={handleVerify} className="px-6 py-3 rounded-2xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg flex items-center gap-2">
                  <Fa icon={faUserCheck} /> Verify Intake
                </button>
              </>
            )}
            {canAssign && (
              <button onClick={() => setShowAssignModal(true)} className="px-6 py-3 rounded-2xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg flex items-center gap-2">
                <Fa icon={faUserPlus} /> {r.assignedTechnicianId ? 'Reassign Tech' : 'Assign Tech'}
              </button>
            )}
            {canDiagnose && (
              <button onClick={() => setShowDiagnosisModal(true)} className="px-6 py-3 rounded-2xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg flex items-center gap-2">
                <Fa icon={faTools} /> Log Diagnosis
              </button>
            )}
            {canQuote && (
              <button onClick={() => setShowQuoteModal(true)} className="px-6 py-3 rounded-2xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg flex items-center gap-2">
                <Fa icon={faFileInvoiceDollar} /> {r.quote ? 'Edit Quote' : 'Generate Quote'}
              </button>
            )}
            {canStart && (
              <button onClick={() => updateRepair(r.id, { status: 'in_repair', repairStartDate: new Date().toISOString() })} className="px-6 py-3 rounded-2xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg flex items-center gap-2">
                <Fa icon={faPlay} /> Start Repair
              </button>
            )}
            {canComplete && (
              <button onClick={() => setShowQAModal(true)} className="px-6 py-3 rounded-2xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg flex items-center gap-2">
                <Fa icon={faCheckCircle} /> Mark Complete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 sm:p-10 custom-scrollbar">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-10">
          
          <div className="lg:col-span-2 space-y-10">
            {/* Device & Client Details */}
            <div className="bg-white rounded-[2rem] p-10 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-10 pb-5 border-b-2 border-slate-50">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-slate-900 text-white shadow-xl shadow-slate-200"><Fa icon={faMicrochip} className="text-sm" /></div>
                  <h3 className="text-[13px] font-black text-slate-900 uppercase tracking-widest">Device & Client Details</h3>
                </div>
                <div className="flex items-center gap-2.5 text-slate-600 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                  <Fa icon={faCalendarAlt} className="text-[11px]" />
                  <span className="text-[11px] font-black uppercase tracking-widest">Intake: {new Date(r.intakeDate).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-10 gap-x-8">
                <InfoRow label="Client" value={r.customerName} highlight />
                <InfoRow label="Phone" value={r.customerPhone} />
                <InfoRow label="Email" value={r.customerEmail || '—'} />
                <InfoRow label="Device" value={r.productName} />
                <InfoRow label="Serial" value={r.serialNumber || '—'} />
                <InfoRow label="Colour" value={r.deviceColour || '—'} />
                <InfoRow label="Condition" value={r.deviceCondition || '—'} />
                <InfoRow label="Priority" value={r.priority} highlight={r.priority === 'high'} />
                <InfoRow label="Channel" value={r.intakeChannel?.replace('_', ' ') || '—'} />
                <InfoRow label="Technician" value={r.assignedTechnicianName || 'Unassigned'} highlight={!!r.assignedTechnicianId} />
                <InfoRow label="Booked By" value={r.createdBy || 'Moses Ndung\'u Muthee'} />
                <InfoRow label="Verified By" value={r.verifiedBy || '—'} />
              </div>
            </div>

            {/* Reported Issue */}
            <div className="bg-white rounded-[2rem] p-10 shadow-sm border-2 border-slate-200 border-l-[8px] border-l-amber-500">
              <div className="flex items-center gap-4 mb-8">
                <div className="p-3 rounded-2xl bg-amber-500 text-white shadow-xl shadow-amber-100"><Fa icon={faCircleExclamation} className="text-sm" /></div>
                <h3 className="text-[13px] font-black text-slate-900 uppercase tracking-widest">Reported Issue</h3>
              </div>
              <div className="bg-amber-50/40 rounded-3xl p-8 border-2 border-amber-100/50">
                <p className="text-[15px] text-slate-900 leading-relaxed font-extrabold">
                  {r.issueDescription || "No issue description provided"}
                </p>
              </div>
            </div>

            {/* Issue Photos */}
            <div className="bg-white rounded-[2rem] p-10 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-10 pb-5 border-b-2 border-slate-50">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-100"><Fa icon={faCamera} className="text-sm" /></div>
                  <h3 className="text-[13px] font-black text-slate-900 uppercase tracking-widest">Issue Photos</h3>
                </div>
                <button 
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  type="button"
                  className="text-[11px] font-black text-slate-700 hover:text-indigo-700 flex items-center gap-2.5 px-5 py-2.5 rounded-2xl border-2 border-slate-100 hover:border-indigo-200 transition-all uppercase tracking-widest bg-white disabled:opacity-50 shadow-sm"
                >
                  <Fa icon={uploadingPhoto ? faSync : faUpload} className={`text-[11px] ${uploadingPhoto ? 'animate-spin' : ''}`} /> {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                </button>
              </div>
              
              {r.issuePhotos && r.issuePhotos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
                  {r.issuePhotos.map((photo, idx) => (
                    <div key={idx} className="group relative aspect-square rounded-[1.5rem] overflow-hidden border-2 border-slate-100 shadow-sm transition-all hover:shadow-xl">
                      <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-slate-900/70 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-4 backdrop-blur-[3px]">
                        <button onClick={() => removePhoto(idx)} className="w-12 h-12 rounded-2xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all shadow-xl active:scale-90">
                          <Fa icon={faTrash} className="text-sm" />
                        </button>
                        <a href={photo.url} target="_blank" className="w-12 h-12 rounded-2xl bg-white text-slate-900 flex items-center justify-center hover:bg-slate-50 transition-all shadow-xl active:scale-90">
                          <Fa icon={faExternalLinkAlt} className="text-sm" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 bg-slate-50/50 rounded-[2.5rem] border-4 border-dashed border-slate-200 text-slate-400 gap-6">
                  <div className="p-6 rounded-full bg-white shadow-md"><Fa icon={faImage} className="text-5xl opacity-20" /></div>
                  <p className="text-[13px] font-black uppercase tracking-widest opacity-80 text-slate-500">No photos uploaded yet</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-10">
            {/* Client Follow-up Link */}
            <div className="bg-slate-900 rounded-[2rem] p-10 shadow-2xl border-2 border-slate-800 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-12 opacity-[0.1] pointer-events-none group-hover:opacity-[0.15] transition-opacity">
                <Fa icon={faLink} className="text-9xl rotate-[-15deg] text-blue-400" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-10">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-blue-600 text-white shadow-xl shadow-blue-900/50"><Fa icon={faLink} className="text-sm" /></div>
                    <p className="text-[13px] font-black uppercase tracking-widest text-white">Follow-up Portal</p>
                  </div>
                  <button onClick={copyLink} className="p-3 rounded-2xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-all border border-slate-700 shadow-sm active:scale-90">
                    <Fa icon={faCopy} className="text-sm" />
                  </button>
                </div>
                <div className="bg-slate-800/50 rounded-[1.5rem] p-6 mb-10 border-2 border-slate-700/50 backdrop-blur-sm">
                  <p className="text-[12px] font-mono break-all text-blue-400 font-black leading-relaxed tracking-tight">{portalUrl}</p>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <button onClick={copyLink} className="py-4 rounded-2xl bg-slate-800 border-2 border-slate-700 text-white text-[12px] font-black uppercase tracking-widest hover:bg-slate-700 hover:border-slate-600 transition-all shadow-sm active:scale-95">Copy Link</button>
                  <a href={portalUrl} target="_blank" className="py-4 rounded-2xl bg-blue-600 text-white text-[12px] font-black uppercase tracking-widest hover:bg-blue-500 transition-all text-center shadow-xl shadow-blue-900/50 active:scale-95">Open Portal</a>
                </div>
              </div>
            </div>

            {/* Quotation Overview */}
            <div className="bg-white rounded-[2rem] p-10 shadow-sm border-2 border-slate-200 border-l-[8px] border-l-emerald-500">
              <div className="flex items-center justify-between mb-10 pb-5 border-b-2 border-slate-50">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-emerald-600 text-white shadow-xl shadow-emerald-100"><Fa icon={faQuoteRight} className="text-sm" /></div>
                  <h3 className="text-[13px] font-black text-slate-900 uppercase tracking-widest">Financials</h3>
                </div>
                {r.quote && (
                  <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 ${
                    r.quote.approvedDate ? 'bg-emerald-50 text-emerald-900 border-emerald-200' :
                    r.quote.rejectedDate ? 'bg-red-50 text-red-900 border-red-200' :
                    'bg-amber-50 text-amber-900 border-amber-200'
                  }`}>
                    {r.quote.approvedDate ? 'Approved' : r.quote.rejectedDate ? 'Rejected' : 'Awaiting Approval'}
                  </span>
                )}
              </div>
              
              {r.quote ? (
                <div className="space-y-8">
                  <div className="flex items-center justify-between p-7 bg-slate-900 rounded-[1.5rem] border-2 border-slate-800 shadow-2xl">
                    <div>
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Amount</p>
                      <p className="text-2xl font-black text-white tracking-tighter">KES {r.quote.total.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Valid Until</p>
                      <p className="text-[13px] font-black text-emerald-400 tracking-tight">{new Date(r.quote.validUntil).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="space-y-5">
                    <p className="text-[11px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-200"></span>
                      Line Items ({r.quote.lines.length})
                    </p>
                    <div className="max-h-60 overflow-y-auto pr-3 custom-scrollbar space-y-3">
                      {r.quote.lines.map((line, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[12px] p-4 bg-slate-50 rounded-2xl border-2 border-slate-100 hover:border-emerald-100 transition-colors">
                          <span className="text-slate-900 font-extrabold line-clamp-1 flex-1 mr-4">{line.description}</span>
                          <span className="text-emerald-700 font-black whitespace-nowrap">KES {line.subtotal.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 bg-slate-50/50 rounded-[2.5rem] border-4 border-dashed border-slate-200 text-slate-400 gap-6">
                  <div className="p-6 rounded-full bg-white shadow-md"><Fa icon={faFileInvoiceDollar} className="text-5xl opacity-20" /></div>
                  <p className="text-[13px] font-black uppercase tracking-widest opacity-80 text-slate-500">No quote generated yet</p>
                  <button onClick={() => setShowQuoteModal(true)} className="px-8 py-3 rounded-2xl bg-white border-2 border-slate-200 text-slate-900 text-[11px] font-black uppercase tracking-widest hover:border-emerald-300 hover:text-emerald-700 transition-all shadow-sm active:scale-95">Generate Now</button>
                </div>
              )}
            </div>

            {/* Customer Chat */}
            <MessageThread repairRef={r.ref} staffName={currentUser?.name || 'Staff'} />

            {/* Status History */}
            <div className="bg-white rounded-[2rem] p-10 shadow-sm border-2 border-slate-200 border-l-[8px] border-l-slate-900">
              <div className="flex items-center gap-4 mb-10 pb-5 border-b-2 border-slate-50">
                <div className="p-3 rounded-2xl bg-slate-900 text-white shadow-xl shadow-slate-200"><Fa icon={faHistory} className="text-sm" /></div>
                <h3 className="text-[13px] font-black text-slate-900 uppercase tracking-widest">Workflow Progress</h3>
              </div>
              <div className="px-2">
                <StatusStepper currentStatus={r.status} steps={STEPPER_STEPS} labels={STATUS_LABELS} />
              </div>
              <div className="mt-10 p-6 bg-blue-50/50 rounded-3xl border-2 border-blue-100 flex items-center gap-5">
                <div className="p-3 rounded-2xl bg-white text-blue-600 shadow-md border border-blue-50"><Fa icon={faStethoscope} className="text-sm" /></div>
                <div>
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Service Type</p>
                  <p className="text-[13px] font-black text-blue-900 uppercase tracking-tight">{r.repairPath === 'direct_repair' ? 'Direct Repair' : 'Diagnosis First'}</p>
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
    <div className="flex flex-col gap-2 group">
      <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest group-hover:text-slate-700 transition-colors">{label}</p>
      <p className={`text-[15px] font-black tracking-tight leading-tight ${highlight ? 'text-indigo-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}
