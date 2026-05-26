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
  faStethoscope, faExpand, faComments
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
    <div className="flex flex-col h-full bg-[#f8fafc] animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hidden Inputs */}
      <input 
        type="file" 
        ref={photoInputRef} 
        onChange={handlePhotoUpload} 
        accept="image/*" 
        className="hidden" 
      />

      {/* Module Header */}
      <header className="bg-white border-b border-slate-200 px-8 py-5 shadow-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button 
              onClick={() => { setActiveId(null); setView('list') }}
              className="p-3.5 rounded-2xl hover:bg-slate-100 text-slate-700 transition-all active:scale-95 border border-slate-200 shadow-sm"
            >
              <Fa icon={faArrowLeft} className="text-sm" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-black text-slate-900 tracking-tighter">{r.ref}</h1>
                <span className={`px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border-2 shadow-sm ${
                  r.status === 'pending_verification' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                  r.status === 'received' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                  'bg-blue-50 text-blue-800 border-blue-200'
                }`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="text-[12px] text-slate-700 font-extrabold uppercase tracking-widest mt-1.5 flex items-center gap-2">
                <span className="text-slate-900">{r.customerName}</span>
                <span className="text-slate-300">|</span>
                <span className="text-blue-600">{r.productName}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canVerify && (
              <>
                <button onClick={() => setShowDeclineModal(true)} className="px-6 py-3.5 rounded-2xl bg-white border-2 border-red-200 text-red-700 text-[11px] font-black uppercase tracking-widest hover:bg-red-50 transition-all shadow-sm">
                  Decline
                </button>
                <button onClick={handleVerify} className="px-7 py-3.5 rounded-2xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center gap-2.5">
                  <Fa icon={faUserCheck} /> Verify Intake
                </button>
              </>
            )}
            {canAssign && (
              <button onClick={() => setShowAssignModal(true)} className="px-7 py-3.5 rounded-2xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-slate-200 flex items-center gap-2.5">
                <Fa icon={faUserPlus} /> {r.assignedTechnicianId ? 'Reassign Tech' : 'Assign Tech'}
              </button>
            )}
            {canDiagnose && (
              <button onClick={() => setShowDiagnosisModal(true)} className="px-7 py-3.5 rounded-2xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center gap-2.5">
                <Fa icon={faTools} /> Log Diagnosis
              </button>
            )}
            {canQuote && (
              <button onClick={() => setShowQuoteModal(true)} className="px-7 py-3.5 rounded-2xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2.5">
                <Fa icon={faFileInvoiceDollar} /> {r.quote ? 'Edit Quote' : 'Generate Quote'}
              </button>
            )}
            {canStart && (
              <button onClick={() => updateRepair(r.id, { status: 'in_repair', repairStartDate: new Date().toISOString() })} className="px-7 py-3.5 rounded-2xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2.5">
                <Fa icon={faPlay} /> Start Repair
              </button>
            )}
            {canComplete && (
              <button onClick={() => setShowQAModal(true)} className="px-7 py-3.5 rounded-2xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center gap-2.5">
                <Fa icon={faCheckCircle} /> Mark Complete
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Left Column */}
          <div className="lg:col-span-8 space-y-10">
            {/* Device & Client Details Card */}
            <section className="card bg-white rounded-[2.5rem] p-10 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-[1.25rem] bg-slate-900 text-white flex items-center justify-center shadow-xl shadow-slate-200">
                    <Fa icon={faMicrochip} className="text-lg" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-black text-slate-900 uppercase tracking-widest">Device & Client Details</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Comprehensive profile</p>
                  </div>
                </div>
                <div className="bg-slate-50 px-5 py-2.5 rounded-2xl border border-slate-100 flex items-center gap-3">
                  <Fa icon={faCalendarAlt} className="text-slate-400 text-xs" />
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Intake: {new Date(r.intakeDate).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-12 gap-x-10">
                <InfoRow label="Client" value={r.customerName} highlight />
                <InfoRow label="Phone" value={r.customerPhone} />
                <InfoRow label="Email" value={r.customerEmail || '—'} />
                
                <InfoRow label="Device" value={r.productName} />
                <InfoRow label="Serial" value={r.serialNumber || '—'} isMono />
                <InfoRow label="Colour" value={r.deviceColour || '—'} />
                
                <InfoRow label="Condition" value={r.deviceCondition || '—'} />
                <InfoRow label="Priority" value={r.priority} highlight={['high', 'urgent'].includes(r.priority)} />
                <InfoRow label="Channel" value={r.intakeChannel?.replace('_', ' ') || 'walk_in'} />
                
                <InfoRow label="Technician" value={r.assignedTechnicianName || 'Unassigned'} highlight={!!r.assignedTechnicianId} />
                <InfoRow label="Booked By" value={r.createdBy || 'Moses Ndung\'u Muthee'} />
                <InfoRow label="Verified By" value={r.verifiedBy || '—'} />
              </div>
            </section>

            {/* Reported Issue Card */}
            <section className="card bg-white rounded-[2.5rem] p-10 shadow-sm border-2 border-slate-100 border-l-[12px] border-l-amber-500">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-[1.25rem] bg-amber-500 text-white flex items-center justify-center shadow-xl shadow-amber-100">
                  <Fa icon={faCircleExclamation} className="text-lg" />
                </div>
                <h3 className="text-[14px] font-black text-slate-900 uppercase tracking-widest">Reported Issue</h3>
              </div>
              <div className="bg-amber-50/50 rounded-[2rem] p-8 border border-amber-100/50">
                <p className="text-[16px] text-slate-900 leading-relaxed font-black uppercase tracking-tight">
                  {r.issueDescription || "No issue description provided"}
                </p>
              </div>
            </section>

            {/* Issue Photos Card */}
            <section className="card bg-white rounded-[2.5rem] p-10 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-[1.25rem] bg-indigo-600 text-white flex items-center justify-center shadow-xl shadow-indigo-100">
                    <Fa icon={faCamera} className="text-lg" />
                  </div>
                  <h3 className="text-[14px] font-black text-slate-900 uppercase tracking-widest">Issue Photos</h3>
                </div>
                <button 
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="px-6 py-3 rounded-2xl bg-slate-50 text-slate-700 text-[11px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all border border-slate-200 flex items-center gap-2.5 disabled:opacity-50"
                >
                  <Fa icon={uploadingPhoto ? faSync : faUpload} className={uploadingPhoto ? 'animate-spin' : ''} />
                  {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                </button>
              </div>
              
              {r.issuePhotos && r.issuePhotos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
                  {r.issuePhotos.map((photo, idx) => (
                    <div key={idx} className="group relative aspect-square rounded-[2rem] overflow-hidden border-2 border-slate-100 shadow-sm hover:shadow-2xl transition-all">
                      <img src={photo.url} alt={photo.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                      <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-4 backdrop-blur-sm">
                        <button onClick={() => removePhoto(idx)} className="w-12 h-12 rounded-2xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all shadow-xl active:scale-90">
                          <Fa icon={faTrash} />
                        </button>
                        <a href={photo.url} target="_blank" rel="noopener noreferrer" className="w-12 h-12 rounded-2xl bg-white text-slate-900 flex items-center justify-center hover:bg-slate-50 transition-all shadow-xl active:scale-90">
                          <Fa icon={faExpand} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 bg-slate-50/50 rounded-[3rem] border-4 border-dashed border-slate-200 text-slate-300 gap-6">
                  <Fa icon={faImage} className="text-6xl opacity-20" />
                  <div className="text-center">
                    <p className="text-[13px] font-black uppercase tracking-widest text-slate-500">No photos uploaded yet</p>
                    <p className="text-[10px] font-bold mt-1">Capture device condition for reference</p>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-4 space-y-10">
            
            {/* Follow-up Portal Card */}
            <section className="card bg-slate-900 rounded-[2.5rem] p-10 shadow-2xl shadow-slate-300 relative overflow-hidden group">
              <div className="absolute -right-10 -top-10 text-white/5 text-[15rem] transform rotate-12 transition-transform duration-1000 group-hover:rotate-0">
                <Fa icon={faLink} />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-10">
                  <h3 className="text-[12px] font-black text-white/50 uppercase tracking-[0.2em]">Follow-up Portal</h3>
                  <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-white/80 border border-white/10">
                    <Fa icon={faCopy} className="text-sm" />
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-8 backdrop-blur-md">
                  <p className="text-[11px] font-mono text-blue-400 break-all leading-relaxed tracking-tight">
                    {portalUrl}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={copyLink}
                    className="py-4 rounded-2xl bg-white text-slate-900 text-[11px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all active:scale-95 shadow-xl"
                  >
                    Copy Link
                  </button>
                  <a 
                    href={portalUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="py-4 rounded-2xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all active:scale-95 flex items-center justify-center shadow-xl shadow-blue-900/50"
                  >
                    Open Portal
                  </a>
                </div>
              </div>
            </section>

            {/* Financials Card */}
            <section className="card bg-white rounded-[2.5rem] p-10 shadow-sm border border-slate-100">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-12 h-12 rounded-[1.25rem] bg-emerald-500 text-white flex items-center justify-center shadow-xl shadow-emerald-100">
                  <Fa icon={faQuoteRight} className="text-lg" />
                </div>
                <h3 className="text-[14px] font-black text-slate-900 uppercase tracking-widest">Financials</h3>
              </div>

              {r.quote ? (
                <div className="space-y-8">
                  <div className="bg-slate-50 rounded-[2rem] p-8 border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Quote Amount</p>
                    <p className="text-3xl font-black text-slate-900 tracking-tighter mt-2">{fmtKes(r.quote.total)}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Subtotal</p>
                      <p className="text-[13px] font-black text-slate-800 mt-1">{fmtKes(r.quote.subtotal)}</p>
                    </div>
                    <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">VAT</p>
                      <p className="text-[13px] font-black text-slate-800 mt-1">{fmtKes(r.quote.tax)}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 bg-slate-50/50 rounded-[2.5rem] border-4 border-dashed border-slate-200 text-slate-300 gap-6">
                  <Fa icon={faFileInvoiceDollar} className="text-5xl opacity-10" />
                  <div className="text-center">
                    <p className="text-[12px] font-black uppercase tracking-widest text-slate-500">No quote generated yet</p>
                    <button 
                      onClick={() => setShowQuoteModal(true)}
                      className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-4 hover:underline"
                    >
                      Generate Now
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Customer Chat */}
            <MessageThread repairRef={r.ref} staffName={currentUser?.name || 'Staff'} />

            {/* Status History */}
            <section className="card bg-white rounded-[2.5rem] p-10 shadow-sm border border-slate-100">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-12 h-12 rounded-[1.25rem] bg-slate-100 text-slate-600 flex items-center justify-center">
                  <Fa icon={faHistory} className="text-lg" />
                </div>
                <h3 className="text-[14px] font-black text-slate-900 uppercase tracking-widest">Status History</h3>
              </div>
              <StatusStepper currentStatus={r.status} history={r.statusHistory || []} />
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

function InfoRow({ label, value, highlight = false, isMono = false }: any) {
  return (
    <div className="flex flex-col gap-2.5 group">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-slate-600 transition-colors">{label}</span>
      </div>
      <p className={`
        text-[13px] uppercase tracking-tight leading-none
        ${highlight ? 'font-black text-blue-600' : 'font-extrabold text-slate-900'}
        ${isMono ? 'font-mono tracking-tighter' : ''}
      `}>
        {value || '—'}
      </p>
    </div>
  )
}
