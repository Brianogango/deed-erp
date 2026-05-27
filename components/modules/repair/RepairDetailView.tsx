// @ts-nocheck
'use client'

import { useState, useRef } from 'react'
import { useRepair } from './RepairContext'
import { Fa } from '@/components/icons'
import {
  faArrowLeft, faMicrochip, faCircleExclamation, faCamera, faImage,
  faPlay, faLink, faExternalLinkAlt, faUserCheck, faUserPlus,
  faFileInvoiceDollar, faCalendarAlt, faTrash, faUpload, faSync,
  faExpand, faTools, faCheckCircle, faHistory,
  faClipboardList, faQuoteRight,
} from '@fortawesome/free-solid-svg-icons'
import { STATUS_LABELS, STATUS_COLORS } from '../repair-config'
import StatusStepper from './StatusStepper'
import MessageThread from './MessageThread'
import { fmtKes } from '@/lib/store'

const STATUS_BADGE_CLS: Record<string, string> = {
  pending_verification: 'bg-amber-50 text-amber-800 border-amber-200',
  received:            'bg-slate-100 text-slate-700 border-slate-200',
  assigned:            'bg-blue-50 text-blue-700 border-blue-200',
  diagnosed:           'bg-cyan-50 text-cyan-700 border-cyan-200',
  awaiting_approval:   'bg-orange-50 text-orange-700 border-orange-200',
  approved:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  awaiting_parts:      'bg-orange-100 text-orange-800 border-orange-200',
  in_repair:           'bg-violet-50 text-violet-700 border-violet-200',
  qc:                  'bg-pink-50 text-pink-700 border-pink-200',
  ready:               'bg-emerald-50 text-emerald-700 border-emerald-200',
  invoiced:            'bg-amber-50 text-amber-700 border-amber-200',
  delivered:           'bg-teal-50 text-teal-700 border-teal-200',
  closed:              'bg-slate-100 text-slate-600 border-slate-200',
  declined:            'bg-red-50 text-red-700 border-red-200',
  unrepairable:        'bg-red-100 text-red-800 border-red-300',
  returned:            'bg-stone-50 text-stone-600 border-stone-200',
  cancelled:           'bg-red-50 text-red-600 border-red-200',
}

function StatusChip({ status }: { status: string }) {
  const cls   = STATUS_BADGE_CLS[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'
  const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? '#94A3B8'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${cls} whitespace-nowrap`}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white rounded-xl sm:rounded-2xl border border-slate-100 shadow-sm overflow-hidden ${className}`}>
      {children}
    </section>
  )
}

function SectionHeader({ icon, iconBg, title, subtitle, action }: any) {
  return (
    <div className="flex items-start sm:items-center justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-slate-50 gap-2">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center shadow-sm shrink-0 ${iconBg}`}>
          <Fa icon={icon} className="text-white text-xs sm:text-sm" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[11px] sm:text-[12px] font-black text-slate-900 uppercase tracking-wider leading-none">{title}</h3>
          {subtitle && <p className="text-[9px] sm:text-[10px] text-slate-400 font-bold mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 mt-0.5 sm:mt-0">{action}</div>}
    </div>
  )
}

function InfoField({ label, value, highlight = false, mono = false }: any) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
      <p className={`text-[11px] sm:text-[12px] leading-tight truncate ${highlight ? 'font-black text-blue-600' : 'font-bold text-slate-800'} ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-slate-300">—</span>}
      </p>
    </div>
  )
}

/* Icon-only action button for mobile, text on sm+ */
function ActionBtn({ onClick, href, icon, label, color, shadow }: any) {
  const cls = `flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2 rounded-xl text-white text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${color} ${shadow} shadow-lg whitespace-nowrap`
  const content = (
    <>
      <Fa icon={icon} className="text-xs shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </>
  )
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{content}</a>
  return <button onClick={onClick} className={cls}>{content}</button>
}

export default function RepairDetailView() {
  const {
    activeRepair: r, currentUserId, currentUser, systemSettings, setView, setActiveId,
    setShowAssignModal, setShowDiagnosisModal, setShowQuoteModal, setShowQAModal,
    setShowDeclineModal, updateRepair, showToast,
  } = useRepair()

  const photoInputRef = useRef(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  if (!r) return null

  const isMyRepair = r.assignedTechnicianId === currentUserId
  const canVerify  = r.status === 'pending_verification' && ['technical_lead','director','admin_officer','admin'].includes(currentUser?.role ?? '')
  const canAssign  = (currentUser?.role === 'technical_lead' || (currentUser?.role === 'director' && systemSettings?.repAdminAssignsJobs))
    && ['received','assigned','diagnosed','awaiting_approval','approved','awaiting_parts','in_repair','qc','ready'].includes(r.status)
  const canDiagnose = r.status === 'assigned' && isMyRepair && r.repairPath !== 'direct_repair'
  const canQuote    = (r.repairPath === 'direct_repair'
    ? ['assigned','awaiting_approval','approved','awaiting_parts','in_repair'].includes(r.status)
    : ['diagnosed','awaiting_approval','approved','awaiting_parts','in_repair'].includes(r.status))
    && (isMyRepair || ['director','admin_officer','technical_lead','sales_rep','finance_officer','admin'].includes(currentUser?.role ?? ''))
    && !r.diagnosisStopped
  const canStart    = ((r.status === 'approved' || r.status === 'awaiting_parts') || (r.status === 'assigned' && r.repairPath === 'direct_repair')) && isMyRepair
  const canComplete = r.status === 'in_repair' && isMyRepair

  const handleVerify = () => {
    updateRepair(r.id, { status: 'received', verificationDate: new Date().toISOString(), verifiedBy: currentUser?.name || 'Staff' })
    showToast(`Repair ${r.ref} verified`, 'success')
  }

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    const reader = new FileReader()
    reader.onload = (ev) => {
      updateRepair(r.id, { issuePhotos: [...(r.issuePhotos || []), { url: ev.target?.result, name: file.name, date: new Date().toISOString() }] })
      setUploadingPhoto(false)
      showToast('Photo uploaded', 'success')
    }
    reader.readAsDataURL(file)
  }

  const removePhoto = (idx) => {
    const photos = [...(r.issuePhotos || [])]
    photos.splice(idx, 1)
    updateRepair(r.id, { issuePhotos: photos })
  }

  const portalUrl = `https://erp.deed.co.ke/portal/repair/${r.ref}`
  const copyLink  = () => {
    navigator.clipboard.writeText(portalUrl)
    setCopiedLink(true)
    showToast('Portal link copied!', 'success')
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const accentColor = STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] ?? '#3B82F6'

  return (
    <div className="flex flex-col h-full bg-slate-50 animate-in fade-in slide-in-from-bottom-2 duration-400">
      <input type="file" ref={photoInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />

      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-3 sm:px-6 py-3 sm:py-4 shadow-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">

          {/* Left: back + title */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              onClick={() => { setActiveId(null); setView('list') }}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 flex items-center justify-center transition-all active:scale-95 shadow-sm shrink-0"
            >
              <Fa icon={faArrowLeft} className="text-sm" />
            </button>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
              <span className="text-base sm:text-xl font-black text-slate-900 tracking-tight font-mono shrink-0">{r.ref}</span>
              <StatusChip status={r.status} />
              <span className="hidden md:flex items-center gap-1.5 text-[11px] font-bold text-slate-500 min-w-0">
                <span className="text-slate-300">·</span>
                <span className="text-slate-800 font-black truncate max-w-[140px]">{r.customerName}</span>
                <span className="text-slate-300">·</span>
                <span className="text-blue-600 truncate max-w-[140px]">{r.productName}</span>
              </span>
            </div>
          </div>

          {/* Right: action buttons — horizontally scrollable on mobile */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide sm:flex-wrap sm:justify-end pb-0.5 sm:pb-0 shrink-0">
            {canVerify && (<>
              <button
                onClick={() => setShowDeclineModal(true)}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border-2 border-red-200 text-red-600 text-[10px] font-black uppercase tracking-wider hover:bg-red-50 transition-all whitespace-nowrap shrink-0"
              >
                <span className="hidden sm:inline">Decline</span>
                <span className="sm:hidden">✕</span>
              </button>
              <ActionBtn onClick={handleVerify} icon={faUserCheck} label="Verify Intake" color="bg-emerald-600 hover:bg-emerald-700" shadow="shadow-emerald-100" />
            </>)}
            {canAssign    && <ActionBtn onClick={() => setShowAssignModal(true)}    icon={faUserPlus}          label={r.assignedTechnicianId ? 'Reassign' : 'Assign Tech'} color="bg-slate-900 hover:bg-black"         shadow="shadow-slate-200" />}
            {canDiagnose  && <ActionBtn onClick={() => setShowDiagnosisModal(true)} icon={faTools}             label="Log Diagnosis"   color="bg-blue-600 hover:bg-blue-700"     shadow="shadow-blue-100" />}
            {canQuote     && <ActionBtn onClick={() => setShowQuoteModal(true)}     icon={faFileInvoiceDollar} label={r.quote ? 'Edit Quote' : 'Generate Quote'} color="bg-indigo-600 hover:bg-indigo-700" shadow="shadow-indigo-100" />}
            {canStart     && <ActionBtn onClick={() => updateRepair(r.id, { status: 'in_repair', repairStartDate: new Date().toISOString() })} icon={faPlay} label="Start Repair" color="bg-violet-600 hover:bg-violet-700" shadow="shadow-violet-100" />}
            {canComplete  && <ActionBtn onClick={() => setShowQAModal(true)}        icon={faCheckCircle}       label="Mark Complete"   color="bg-emerald-600 hover:bg-emerald-700" shadow="shadow-emerald-100" />}
          </div>

        </div>
      </header>

      {/* ── Body ── */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 custom-scrollbar">
        <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 lg:gap-6">

          {/* ── Left Column ── */}
          <div className="lg:col-span-8 space-y-4 sm:space-y-5 lg:space-y-6">

            {/* Device & Client */}
            <SectionCard>
              <SectionHeader
                icon={faMicrochip}
                iconBg="bg-slate-800"
                title="Device & Client"
                subtitle="Intake profile"
                action={
                  <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">
                    <Fa icon={faCalendarAlt} className="text-slate-400 text-[9px]" />
                    <span className="text-[10px] font-bold text-slate-600 whitespace-nowrap">
                      {new Date(r.intakeDate).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                }
              />
              <div className="px-4 sm:px-6 py-4 sm:py-5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-8 gap-y-4 sm:gap-y-5">
                <InfoField label="Client"     value={r.customerName}                              highlight />
                <InfoField label="Phone"      value={r.customerPhone} />
                <InfoField label="Email"      value={r.customerEmail} />
                <InfoField label="Device"     value={r.productName} />
                <InfoField label="Serial No." value={r.serialNumber}  mono />
                <InfoField label="Colour"     value={r.deviceColour} />
                <InfoField label="Condition"  value={r.deviceCondition} />
                <InfoField label="Priority"   value={r.priority}       highlight={['high','urgent'].includes(r.priority)} />
                <InfoField label="Channel"    value={r.intakeChannel?.replace(/_/g,' ')} />
                <InfoField label="Technician" value={r.assignedTechnicianName ?? 'Unassigned'} highlight={!!r.assignedTechnicianId} />
                <InfoField label="Booked By"  value={r.createdBy} />
                <InfoField label="Verified By" value={r.verifiedBy} />
              </div>
            </SectionCard>

            {/* Reported Issue */}
            <SectionCard>
              <div className="border-l-4" style={{ borderLeftColor: '#F59E0B' }}>
                <SectionHeader icon={faCircleExclamation} iconBg="bg-amber-500" title="Reported Issue" />
                <div className="px-4 sm:px-6 py-4 sm:py-5">
                  <div className="bg-amber-50/60 rounded-xl p-4 sm:p-5 border border-amber-100">
                    <Fa icon={faClipboardList} className="text-amber-300 text-base mb-2.5" />
                    <p className="text-[13px] sm:text-[14px] text-slate-800 leading-relaxed font-semibold">
                      {r.issueDescription || 'No issue description provided'}
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Issue Photos */}
            <SectionCard>
              <SectionHeader
                icon={faCamera}
                iconBg="bg-indigo-600"
                title="Issue Photos"
                subtitle={`${(r.issuePhotos || []).length} photo${(r.issuePhotos || []).length !== 1 ? 's' : ''}`}
                action={
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-slate-50 text-slate-700 text-[10px] font-black uppercase tracking-wider hover:bg-slate-100 transition-all border border-slate-200 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Fa icon={uploadingPhoto ? faSync : faUpload} className={`text-[10px] ${uploadingPhoto ? 'animate-spin' : ''}`} />
                    <span className="hidden sm:inline">{uploadingPhoto ? 'Uploading…' : 'Upload'}</span>
                  </button>
                }
              />
              <div className="px-4 sm:px-6 py-4 sm:py-5">
                {r.issuePhotos?.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                    {r.issuePhotos.map((photo, idx) => (
                      <div key={idx} className="group relative aspect-square rounded-xl sm:rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300">
                        <img src={photo.url} alt={photo.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-2.5 sm:gap-3">
                          <button onClick={() => removePhoto(idx)} className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all shadow-lg active:scale-90">
                            <Fa icon={faTrash} className="text-xs sm:text-sm" />
                          </button>
                          <a href={photo.url} target="_blank" rel="noopener noreferrer" className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white text-slate-900 flex items-center justify-center hover:bg-slate-50 transition-all shadow-lg active:scale-90">
                            <Fa icon={faExpand} className="text-xs sm:text-sm" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 sm:py-14 bg-slate-50 rounded-xl sm:rounded-2xl border-2 border-dashed border-slate-200 gap-3">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                      <Fa icon={faImage} className="text-slate-300 text-lg sm:text-xl" />
                    </div>
                    <div className="text-center px-4">
                      <p className="text-[11px] sm:text-[12px] font-bold text-slate-500">No photos yet</p>
                      <p className="text-[9px] sm:text-[10px] text-slate-400 mt-0.5">Capture device condition for documentation</p>
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          {/* ── Right Column ── */}
          <div className="lg:col-span-4 space-y-4 sm:space-y-5 lg:space-y-6">

            {/* Follow-up Portal */}
            <div className="relative rounded-xl sm:rounded-2xl overflow-hidden shadow-lg sm:shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
              <div className="absolute inset-0 opacity-20 animate-pulse"
                style={{ background: `radial-gradient(circle at 70% 30%, ${accentColor}60 0%, transparent 70%)` }} />
              <Fa icon={faLink} className="absolute -right-4 -top-4 text-white/5 text-[6rem] sm:text-[8rem] rotate-12 pointer-events-none" />

              <div className="relative z-10 p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <div>
                    <h3 className="text-[10px] sm:text-[11px] font-black text-white/60 uppercase tracking-[0.2em]">Follow-up Portal</h3>
                    <p className="text-[9px] sm:text-[10px] text-white/40 font-bold mt-0.5">Customer tracking link</p>
                  </div>
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                    <Fa icon={faExternalLinkAlt} className="text-white/70 text-xs" />
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 mb-3 sm:mb-4">
                  <p className="text-[10px] font-mono text-blue-300 break-all leading-relaxed">{portalUrl}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <button onClick={copyLink}
                    className={`py-2.5 sm:py-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${
                      copiedLink ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/50' : 'bg-white text-slate-900 hover:bg-slate-100 shadow-md'
                    }`}>
                    {copiedLink ? 'Copied!' : 'Copy Link'}
                  </button>
                  <a href={portalUrl} target="_blank" rel="noopener noreferrer"
                    className="py-2.5 sm:py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-blue-900/50">
                    <Fa icon={faExternalLinkAlt} className="text-xs" />
                    Open
                  </a>
                </div>
              </div>
            </div>

            {/* Financials */}
            <SectionCard>
              <SectionHeader icon={faQuoteRight} iconBg="bg-emerald-600" title="Financials" subtitle="Quote & charges" />
              <div className="px-4 sm:px-6 py-4 sm:py-5">
                {r.quote ? (
                  <div className="space-y-3">
                    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 sm:p-5 border border-emerald-100">
                      <p className="text-[9px] sm:text-[10px] font-black text-emerald-600 uppercase tracking-widest">Total Quote</p>
                      <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-1">{fmtKes(r.quote.total)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <div className="p-3 sm:p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Subtotal</p>
                        <p className="text-[12px] sm:text-[13px] font-black text-slate-800 mt-1">{fmtKes(r.quote.subtotal)}</p>
                      </div>
                      <div className="p-3 sm:p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">VAT</p>
                        <p className="text-[12px] sm:text-[13px] font-black text-slate-800 mt-1">{fmtKes(r.quote.tax)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 sm:py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 gap-3">
                    <Fa icon={faFileInvoiceDollar} className="text-slate-300 text-2xl sm:text-3xl" />
                    <div className="text-center">
                      <p className="text-[11px] font-bold text-slate-500">No quote yet</p>
                      <button onClick={() => setShowQuoteModal(true)} className="text-[10px] font-black text-blue-600 hover:text-blue-700 uppercase tracking-wider mt-2 hover:underline transition-colors">
                        Generate Quote →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Customer Chat */}
            <MessageThread repairRef={r.ref} staffName={currentUser?.name || 'Staff'} />

            {/* Status History */}
            <SectionCard>
              <SectionHeader icon={faHistory} iconBg="bg-slate-600" title="Repair Progress" subtitle="Status history" />
              <div className="px-4 sm:px-6 py-4 sm:py-5">
                <StatusStepper currentStatus={r.status} history={r.statusHistory || []} />
              </div>
            </SectionCard>

          </div>
        </div>
      </main>
    </div>
  )
}
