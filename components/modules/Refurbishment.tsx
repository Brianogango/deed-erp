'use client'

import { useState, useMemo } from 'react'
import { useApp, fmtDate as fmtD } from '@/lib/store'
import type { RefurbishmentJob, RefurbStatus, RefurbPart, SerialNumber } from '@/lib/store'
import { Modal, Field, Textarea } from '@/components/ui'
import { Fa } from '@/components/icons'
import {
  faRotate, faPlus, faUser, faWrench, faCheckCircle,
  faArrowRight, faBan, faChevronLeft, faBoxOpen, faPencil, faTrash,
} from '@fortawesome/free-solid-svg-icons'

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_META: Record<RefurbStatus, { label: string; bg: string; color: string; border: string }> = {
  queued:      { label: 'Queued',      bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' },
  assigned:    { label: 'Assigned',    bg: '#DBEAFE', color: '#1E40AF', border: '#93C5FD' },
  in_progress: { label: 'In Progress', bg: '#EDE9FE', color: '#5B21B6', border: '#C4B5FD' },
  ready:       { label: 'Ready',       bg: '#D1FAE5', color: '#065F46', border: '#6EE7B7' },
  transferred: { label: 'Transferred', bg: '#F3F4F6', color: '#374151', border: '#D1D5DB' },
  written_off: { label: 'Written Off', bg: '#FEE2E2', color: '#991B1B', border: '#FCA5A5' },
}

const PART_STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  needed:    { label: 'Needed',    bg: '#F3F4F6', color: '#6B7280' },
  requested: { label: 'Requested', bg: '#FEF3C7', color: '#92400E' },
  allocated: { label: 'Allocated', bg: '#DBEAFE', color: '#1E40AF' },
  ordered:   { label: 'Ordered',   bg: '#EDE9FE', color: '#5B21B6' },
  received:  { label: 'Received',  bg: '#D1FAE5', color: '#065F46' },
  used:      { label: 'Used',      bg: '#E5E7EB', color: '#374151' },
}

const STATUS_LEFT_BORDER: Record<RefurbStatus, string> = {
  queued: '#F59E0B', assigned: '#3B82F6', in_progress: '#8B5CF6',
  ready: '#10B981', transferred: '#9CA3AF', written_off: '#EF4444',
}

function StatusBadge({ status }: { status: RefurbStatus }) {
  const m = STATUS_META[status]
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      whiteSpace: 'nowrap', display: 'inline-block',
    }}>{m.label}</span>
  )
}

export default function Refurbishment() {
  const {
    refurbishmentJobs, serials, products,
    users, currentUserId,
    createRefurbishmentJob,
    assignRefurbishmentJob, updateRefurbishmentJob,
    addRefurbishmentPart, updateRefurbishmentPart, removeRefurbishmentPart,
    requestPartFromInventory, allocateRefurbPart, notifyTechPartAvailable,
    markRefurbishmentReady, transferToSell, writeOffRefurbishmentJob,
    updateSerial,
    showToast,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId)
  const isLeadTech  = currentUser?.role === 'lead_tech' || currentUser?.role === 'admin'
  const canAssignJobs = currentUser?.role === 'lead_tech'
  const techs       = users.filter(u => u.role === 'lead_tech' || u.role === 'repair_tech')

  const [activeId, setActiveId]           = useState<string | null>(null)
  const [filterStatus, setFilterStatus]   = useState<RefurbStatus | 'all'>('all')

  const [showAssignModal, setShowAssignModal]       = useState(false)
  const [showNotesModal, setShowNotesModal]         = useState(false)
  const [showPartModal, setShowPartModal]           = useState(false)
  const [showWriteOffModal, setShowWriteOffModal]   = useState(false)
  const [showCreateJobModal, setShowCreateJobModal] = useState(false)
  const [createJobSerial, setCreateJobSerial]       = useState<SerialNumber | null>(null)
  const [createJobIssue, setCreateJobIssue]         = useState('')
  const [editPartId, setEditPartId]                 = useState<string | null>(null)

  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set())
  const [showBulkSendModal, setShowBulkSendModal] = useState(false)
  const [bulkIssueDesc, setBulkIssueDesc]         = useState('')

  const [notesText, setNotesText]           = useState('')
  const [writeOffReason, setWriteOffReason] = useState('')
  const [partForm, setPartForm] = useState<Omit<RefurbPart, 'id'>>({
    partName: '', productId: undefined, qty: 1, estimatedCost: 0, status: 'needed', notes: '',
  })

  const job = activeId ? refurbishmentJobs.find(j => j.id === activeId) ?? null : null

  const activeJobSerialIds = new Set(
    refurbishmentJobs
      .filter(j => j.status !== 'transferred' && j.status !== 'written_off')
      .map(j => j.serialId)
  )
  const orphanedSerials = useMemo(() =>
    serials.filter(s =>
      (s.status === 'refurbishment' || s.location === 'repair_unit') &&
      !activeJobSerialIds.has(s.id)
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serials, refurbishmentJobs]
  )
  const withIssuesSerials = useMemo(() => serials.filter(s => s.location === 'shop'), [serials])

  const filtered = useMemo(() => {
    const list = filterStatus === 'all'
      ? refurbishmentJobs
      : refurbishmentJobs.filter(j => j.status === filterStatus)
    return [...list].sort((a, b) => b.intakeDate.localeCompare(a.intakeDate))
  }, [refurbishmentJobs, filterStatus])

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const fmtKes  = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0 })}`

  const canAssign    = (j: RefurbishmentJob) => canAssignJobs && j.status === 'queued'
  const canStart     = (j: RefurbishmentJob) => j.status === 'assigned' && (j.assignedTechnicianId === currentUserId || isLeadTech)
  const canLogNotes  = (j: RefurbishmentJob) => ['assigned', 'in_progress'].includes(j.status) && (j.assignedTechnicianId === currentUserId || isLeadTech)
  const canAddParts  = (j: RefurbishmentJob) => ['assigned', 'in_progress'].includes(j.status) && (j.assignedTechnicianId === currentUserId || isLeadTech)
  const canMarkReady = (j: RefurbishmentJob) => j.status === 'in_progress' && (j.assignedTechnicianId === currentUserId || isLeadTech)
  const canTransfer  = (j: RefurbishmentJob) => j.status === 'ready' && isLeadTech
  const canWriteOff  = (j: RefurbishmentJob) => ['assigned', 'in_progress'].includes(j.status) && (j.assignedTechnicianId === currentUserId || isLeadTech)

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<RefurbStatus | 'all', number>> = { all: refurbishmentJobs.length }
    refurbishmentJobs.forEach(j => { counts[j.status] = (counts[j.status] ?? 0) + 1 })
    return counts
  }, [refurbishmentJobs])

  const stats = {
    total:      refurbishmentJobs.length,
    queued:     refurbishmentJobs.filter(j => j.status === 'queued').length,
    inProgress: refurbishmentJobs.filter(j => j.status === 'in_progress').length,
    ready:      refurbishmentJobs.filter(j => j.status === 'ready').length,
    done:       refurbishmentJobs.filter(j => ['transferred', 'written_off'].includes(j.status)).length,
  }

  // ═══════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════════════════════════
  if (job) {
    const partTotal = job.partsNeeded.reduce((s, p) => s + p.estimatedCost * p.qty, 0)
    const readyParts = job.partsNeeded.filter(p => p.status === 'received' && p.notifiedTechDate)
    const sm = STATUS_META[job.status]

    return (
      <div className="flex flex-col h-full" style={{ background: '#F4F6FA' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E7EB' }}>
          <button onClick={() => setActiveId(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 20, lineHeight: 1, padding: '4px 8px 4px 0' }}>←</button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold" style={{ color: '#1B2762' }}>{job.ref}</span>
              <StatusBadge status={job.status} />
              {job.underWarranty && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#D1FAE5', color: '#065F46', border: '1px solid #6EE7B7' }}>
                  WARRANTY
                </span>
              )}
            </div>
            <p className="text-[11px] text-t3 mt-0.5">{job.productName} · S/N {job.serialNumber}</p>
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {canAssign(job) && (
              <button className="btn-primary text-xs" onClick={() => setShowAssignModal(true)}>
                <Fa icon={faUser} className="mr-1.5" />Assign
              </button>
            )}
            {canStart(job) && (
              <button className="btn-primary text-xs" onClick={() => updateRefurbishmentJob(job.id, { status: 'in_progress' })}>
                <Fa icon={faWrench} className="mr-1.5" />Start Refurb
              </button>
            )}
            {canLogNotes(job) && (
              <button className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', cursor: 'pointer' }}
                onClick={() => { setNotesText(job.techNotes ?? ''); setShowNotesModal(true) }}>
                <Fa icon={faPencil} className="mr-1.5" />Notes
              </button>
            )}
            {canMarkReady(job) && (
              <button className="btn-primary text-xs" style={{ background: '#10B981', borderColor: '#10B981' }}
                onClick={() => markRefurbishmentReady(job.id)}>
                <Fa icon={faCheckCircle} className="mr-1.5" />Mark Ready
              </button>
            )}
            {canTransfer(job) && (
              <button className="btn-primary text-xs" style={{ background: '#8B5CF6', borderColor: '#8B5CF6' }}
                onClick={() => transferToSell(job.id)}>
                <Fa icon={faArrowRight} className="mr-1.5" />Transfer to Inventory
              </button>
            )}
            {canWriteOff(job) && (
              <button className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5', cursor: 'pointer' }}
                onClick={() => { setWriteOffReason(''); setShowWriteOffModal(true) }}>
                <Fa icon={faBan} className="mr-1.5" />Write Off
              </button>
            )}
            {job.status === 'written_off' && isLeadTech && (
              <button className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', cursor: 'pointer' }}
                onClick={() => {
                  if (confirm('Restore this device to the refurbishment queue?')) {
                    updateRefurbishmentJob(job.id, { status: 'queued', completedDate: undefined })
                    updateSerial(job.serialId, { status: 'refurbishment', location: 'repair_unit' })
                    showToast('Device restored to queue')
                  }
                }}>
                <Fa icon={faRotate} className="mr-1.5" />Restore to Queue
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Parts-ready notification */}
          {readyParts.length > 0 && (
            <div className="rounded-xl px-4 py-3 flex items-start gap-3"
              style={{ background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
              <span className="text-lg flex-shrink-0">✅</span>
              <div>
                <p className="text-xs font-bold" style={{ color: '#065F46' }}>
                  {readyParts.length} part{readyParts.length > 1 ? 's' : ''} ready — you can continue the job
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: '#047857' }}>
                  {readyParts.map(p => p.partName).join(', ')} — mark each as Used when installed
                </p>
              </div>
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Device */}
            <div className="card p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Device</p>
              <p className="text-sm font-semibold text-t1">{job.productName}</p>
              <p className="font-mono text-xs text-t3">S/N: {job.serialNumber}</p>
              {job.specs && <p className="text-xs text-t3">{job.specs}</p>}
              <div className="pt-1 space-y-0.5">
                <p className="text-[11px] text-t3">Intake: <span className="text-t2 font-medium">{fmtDate(job.intakeDate)}</span></p>
                {job.receiptRef && <p className="text-[11px] text-t3">Receipt: <span className="text-t2 font-medium">{job.receiptRef}</span></p>}
              </div>
            </div>

            {/* Assignment */}
            <div className="card p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Assignment</p>
              {job.assignedTechnicianName ? (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                    {job.assignedTechnicianName.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-t1">{job.assignedTechnicianName}</p>
                    {job.assignedDate && <p className="text-[10px] text-t3">Since {fmtDate(job.assignedDate)}</p>}
                  </div>
                </div>
              ) : (
                <p className="text-xs italic text-amber-500 font-medium">⚠ Not yet assigned</p>
              )}
              {job.completedDate && <p className="text-[11px] text-t3">Completed: <span className="text-t2 font-medium">{fmtDate(job.completedDate)}</span></p>}
              {job.transferDate  && <p className="text-[11px] text-t3">Transferred: <span className="text-t2 font-medium">{fmtDate(job.transferDate)}</span></p>}
            </div>

            {/* Status */}
            <div className="card p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Status</p>
              <StatusBadge status={job.status} />
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-t3">Parts logged</span>
                  <span className="font-semibold text-t1">{job.partsNeeded.length}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-t3">Parts cost</span>
                  <span className="font-semibold text-t1">{partTotal > 0 ? fmtKes(partTotal) : '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Issue & Notes */}
          <div className="card p-4 space-y-3">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Issue Description</p>
            <p className="text-sm text-t1">{job.intakeIssueDescription}</p>
            {job.techNotes && (
              <>
                <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 12 }}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-t3 mb-2">Technician Notes</p>
                  <p className="text-sm text-t1 whitespace-pre-line">{job.techNotes}</p>
                </div>
              </>
            )}
          </div>

          {/* Parts */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid #F3F4F6' }}>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Parts Needed</p>
              {canAddParts(job) && (
                <button className="btn-primary text-xs py-1"
                  onClick={() => {
                    setEditPartId(null)
                    setPartForm({ partName: '', qty: 1, estimatedCost: 0, status: 'needed', notes: '' })
                    setShowPartModal(true)
                  }}>
                  <Fa icon={faPlus} className="mr-1" />Add Part
                </button>
              )}
            </div>
            {job.partsNeeded.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-t3 italic">No parts logged for this job</p>
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <div className="min-w-[700px] flex flex-col">
                <div className="table-head" style={{ gridTemplateColumns: '1fr 60px 100px 90px 90px 160px' }}>
                  <span>Part</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Cost</span>
                  <span className="text-center">In Stock</span>
                  <span className="text-center">Status</span>
                  <span className="text-center">Actions</span>
                </div>
                {job.partsNeeded.map(p => {
                  const linkedProd = p.productId ? products.find(x => x.id === p.productId) : null
                  const inStock = linkedProd ? linkedProd.stockQty : null
                  const stockOk = inStock !== null && inStock >= p.qty
                  const pm = PART_STATUS_META[p.status] ?? PART_STATUS_META.needed
                  return (
                    <div key={p.id} className="table-row hover:bg-gray-50 transition-colors"
                      style={{ gridTemplateColumns: '1fr 60px 100px 90px 90px 160px' }}>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-t1">{p.partName}</p>
                        {linkedProd && <p className="text-[10px] text-blue-500">{linkedProd.name}</p>}
                        {p.notes && <p className="text-[10px] text-t3">{p.notes}</p>}
                        {p.allocatedByName && <p className="text-[10px] text-green-600">Allocated by {p.allocatedByName}</p>}
                        {p.notifiedTechDate && <p className="text-[10px] text-emerald-600">✓ Ready — notified {fmtD(p.notifiedTechDate)}</p>}
                      </div>
                      <span className="text-right text-xs text-t2">{p.qty}</span>
                      <span className="text-right text-xs font-medium text-t1">
                        {fmtKes(p.estimatedCost * p.qty)}
                      </span>
                      <div className="flex justify-center">
                        {inStock !== null ? (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: stockOk ? '#DCFCE7' : '#FEE2E2', color: stockOk ? '#166534' : '#991B1B' }}>
                            {inStock} avail
                          </span>
                        ) : <span className="text-t3 text-[10px]">—</span>}
                      </div>
                      <div className="flex justify-center">
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: pm.bg, color: pm.color }}>
                          {pm.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-center gap-1 flex-wrap">
                        {canAddParts(job) && p.productId && p.status === 'needed' && (
                          <button style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: '#DBEAFE', color: '#1E40AF', border: '1px solid #93C5FD', cursor: 'pointer' }}
                            onClick={() => requestPartFromInventory(job.id, p.id)}>Request</button>
                        )}
                        {isLeadTech && p.status === 'requested' && p.productId && (
                          <button style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: '#D1FAE5', color: '#065F46', border: '1px solid #6EE7B7', cursor: 'pointer' }}
                            onClick={() => allocateRefurbPart(job.id, p.id)}>Allocate</button>
                        )}
                        {isLeadTech && ['allocated', 'received'].includes(p.status) && !p.notifiedTechDate && (
                          <button style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0', cursor: 'pointer' }}
                            onClick={() => notifyTechPartAvailable(job.id, p.id)}>Notify Tech</button>
                        )}
                        {canAddParts(job) && ['allocated', 'received'].includes(p.status) && (
                          <button style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', cursor: 'pointer' }}
                            onClick={() => updateRefurbishmentPart(job.id, p.id, { status: 'used' })}>Mark Used</button>
                        )}
                        {canAddParts(job) && p.status !== 'used' && (
                          <>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3B82F6', fontSize: 11 }}
                              onClick={() => {
                                setEditPartId(p.id)
                                setPartForm({ partName: p.partName, productId: p.productId, qty: p.qty, estimatedCost: p.estimatedCost, status: p.status, notes: p.notes ?? '' })
                                setShowPartModal(true)
                              }}><Fa icon={faPencil} /></button>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 11 }}
                              onClick={() => removeRefurbishmentPart(job.id, p.id)}><Fa icon={faTrash} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
                </div>
                {partTotal > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5"
                    style={{ background: '#F9FAFB', borderTop: '1px solid #F3F4F6' }}>
                    <span className="text-xs font-semibold text-t2">Total Parts Cost</span>
                    <span className="text-sm font-bold" style={{ color: '#1B2762' }}>{fmtKes(partTotal)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Assign Modal ── */}
        {showAssignModal && (
          <Modal title="Assign Technician" onClose={() => setShowAssignModal(false)} width={400}>
            {job.assignedTechnicianName && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-3"
                style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>
                <span>⚠️</span>
                <span>Currently assigned to <strong>{job.assignedTechnicianName}</strong>. Selecting another will reassign.</span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {[...techs]
                .sort((a, b) => a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0)
                .map(tech => {
                  const isMe = tech.id === currentUserId
                  const isCurrent = tech.id === job.assignedTechnicianId
                  return (
                    <button key={tech.id}
                      onClick={() => { assignRefurbishmentJob(job.id, tech.id, tech.name); setShowAssignModal(false) }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs text-left transition-all"
                      style={{
                        border: `1px solid ${isCurrent ? '#A8D4E8' : '#E5E7EB'}`,
                        background: isCurrent ? '#E8F3FA' : '#F9FAFB',
                        cursor: 'pointer',
                      }}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                        style={{ background: isMe ? 'linear-gradient(135deg, #059669, #34D399)' : 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                        {tech.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-t1">{tech.name}</p>
                        <p className="text-[10px] text-t3 capitalize">{tech.role.replace('_', ' ')}{isMe ? ' — you' : ''}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {isMe      && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: '#D1FAE5', color: '#065F46' }}>Me</span>}
                        {isCurrent && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: '#DBEAFE', color: '#1E40AF' }}>Current</span>}
                      </div>
                    </button>
                  )
                })}
            </div>
          </Modal>
        )}

        {/* ── Notes Modal ── */}
        {showNotesModal && (
          <Modal title="Technician Notes" onClose={() => setShowNotesModal(false)} width={480}>
            <Field label="Notes / Findings">
              <Textarea value={notesText} onChange={setNotesText} rows={6}
                placeholder="Describe findings, work done, or diagnosis…" />
            </Field>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowNotesModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => {
                updateRefurbishmentJob(job.id, { techNotes: notesText })
                setShowNotesModal(false)
                showToast('Notes saved')
              }}>Save Notes</button>
            </div>
          </Modal>
        )}

        {/* ── Part Modal ── */}
        {showPartModal && (() => {
          const linkedProd = partForm.productId ? products.find(x => x.id === partForm.productId) : null
          return (
            <Modal title={editPartId ? 'Edit Part' : 'Add Part'} onClose={() => setShowPartModal(false)} width={440}>
              <Field label="Link to Inventory Product (optional)">
                <div className="flex gap-2 items-center">
                  <select className="form-select flex-1"
                    value={partForm.productId ?? ''}
                    onChange={e => {
                      const prod = products.find(x => x.id === e.target.value)
                      setPartForm(p => ({
                        ...p,
                        productId: e.target.value || undefined,
                        partName: prod ? prod.name : p.partName,
                        estimatedCost: prod ? prod.costPrice : p.estimatedCost,
                      }))
                    }}>
                    <option value="">— No link (freeform) —</option>
                    {products.filter(x => x.isActive).map(x => (
                      <option key={x.id} value={x.id}>{x.name} (stock: {x.stockQty})</option>
                    ))}
                  </select>
                  {linkedProd && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap', background: linkedProd.stockQty >= partForm.qty ? '#DCFCE7' : '#FEE2E2', color: linkedProd.stockQty >= partForm.qty ? '#166534' : '#991B1B' }}>
                      {linkedProd.stockQty >= partForm.qty ? `✓ ${linkedProd.stockQty} in stock` : `⚠ Only ${linkedProd.stockQty}`}
                    </span>
                  )}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Part Name *">
                  <input className="form-input" value={partForm.partName}
                    onChange={e => setPartForm(p => ({ ...p, partName: e.target.value }))} />
                </Field>
                <Field label="Qty">
                  <input className="form-input" type="number" min={1} value={partForm.qty}
                    onChange={e => setPartForm(p => ({ ...p, qty: Number(e.target.value) }))} />
                </Field>
              </div>
              <Field label="Notes (optional)">
                <input className="form-input" value={partForm.notes ?? ''}
                  onChange={e => setPartForm(p => ({ ...p, notes: e.target.value }))} />
              </Field>
              <div className="flex gap-2 justify-end mt-4">
                <button className="btn-outline" onClick={() => setShowPartModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={() => {
                  if (!partForm.partName.trim()) { showToast('Enter part name', 'error'); return }
                  if (editPartId) {
                    updateRefurbishmentPart(job.id, editPartId, partForm)
                  } else {
                    addRefurbishmentPart(job.id, partForm)
                  }
                  setShowPartModal(false)
                }}>Save Part</button>
              </div>
            </Modal>
          )
        })()}

        {/* ── Write-Off Modal ── */}
        {showWriteOffModal && (
          <Modal title="Write Off Device" onClose={() => setShowWriteOffModal(false)} width={400}>
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg mb-1"
                style={{ background: '#FEE2E2', border: '1px solid #FCA5A5' }}>
                <span>⚠️</span>
                <p className="text-xs" style={{ color: '#991B1B', lineHeight: 1.5 }}>
                  This device will be marked as unrepairable and written off from inventory. You can restore it later if needed.
                </p>
              </div>
              <Field label="Reason for write-off *">
                <Textarea value={writeOffReason} onChange={setWriteOffReason} rows={3}
                  placeholder="Describe why the device cannot be repaired…" />
              </Field>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-outline" onClick={() => setShowWriteOffModal(false)}>Cancel</button>
              <button className="btn-primary" style={{ background: '#EF4444', borderColor: '#EF4444' }}
                onClick={() => {
                  if (!writeOffReason.trim()) { showToast('Enter a reason', 'error'); return }
                  writeOffRefurbishmentJob(job.id, writeOffReason)
                  setShowWriteOffModal(false)
                  setActiveId(null)
                }}>Write Off</button>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full" style={{ background: '#F4F6FA' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
        style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E7EB' }}>
        <div>
          <h2 className="text-sm font-bold text-t1">Refurbishment</h2>
          <p className="text-[11px] text-t3">
            {refurbishmentJobs.length} total · {stats.inProgress} in progress · {stats.ready} ready
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 px-4 sm:px-5 pt-4 pb-1 flex-shrink-0">
        {[
          { label: 'Total Jobs',   value: stats.total,      color: '#1B2762' },
          { label: 'Queued',       value: stats.queued,     color: '#F59E0B' },
          { label: 'In Progress',  value: stats.inProgress, color: '#8B5CF6' },
          { label: 'Ready',        value: stats.ready,      color: '#10B981' },
          { label: 'Closed',       value: stats.done,       color: '#6B7280' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3 flex flex-col gap-0.5">
            <p className="text-[10px] font-medium text-t3">{s.label}</p>
            <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 pt-3 pb-5 flex flex-col gap-4">

        {/* Parts inbox */}
        {(() => {
          const pendingParts = refurbishmentJobs.flatMap(j =>
            j.partsNeeded.filter(p => p.status === 'requested').map(p => ({ job: j, part: p }))
          )
          if (pendingParts.length === 0) return null
          return (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #BFDBFE' }}>
              <div className="flex items-center gap-2 px-4 py-2.5"
                style={{ background: '#EFF6FF', borderBottom: '1px solid #BFDBFE' }}>
                <span className="text-base">🔔</span>
                <p className="text-xs font-bold" style={{ color: '#1E40AF' }}>
                  {pendingParts.length} part request{pendingParts.length > 1 ? 's' : ''} pending
                </p>
              </div>
              <div className="bg-white flex flex-col divide-y divide-[#EFF6FF]">
                {pendingParts.map(({ job: j, part: p }) => {
                  const prod = p.productId ? products.find(x => x.id === p.productId) : null
                  return (
                    <div key={`${j.id}-${p.id}`} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-t1">{p.partName} × {p.qty}</p>
                        <p className="text-t3">
                          Job: <span className="font-medium cursor-pointer" style={{ color: '#1B2762' }} onClick={() => setActiveId(j.id)}>{j.ref}</span>
                          {' · '}{j.productName}
                          {prod && <> · <span className={prod.stockQty >= p.qty ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{prod.stockQty >= p.qty ? `✓ ${prod.stockQty} in stock` : `⚠ Only ${prod.stockQty}`}</span></>}
                        </p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {isLeadTech && prod && prod.stockQty >= p.qty && (
                          <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#D1FAE5', color: '#065F46', border: '1px solid #6EE7B7', cursor: 'pointer' }}
                            onClick={() => allocateRefurbPart(j.id, p.id)}>Allocate from Stock</button>
                        )}
                        {isLeadTech && (
                          <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#EDE9FE', color: '#5B21B6', border: '1px solid #C4B5FD', cursor: 'pointer' }}
                            onClick={() => { updateRefurbishmentPart(j.id, p.id, { status: 'ordered' }); showToast(`Part marked ordered — create a PO: ${p.partName}`, 'info') }}>
                            Mark Ordered
                          </button>
                        )}
                        <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', cursor: 'pointer' }}
                          onClick={() => setActiveId(j.id)}>View</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* With Issues */}
        {withIssuesSerials.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #FED7AA' }}>
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 flex-wrap"
              style={{ background: '#FFF7ED', borderBottom: '1px solid #FED7AA' }}>
              <div className="flex items-center gap-2">
                <span>⚠️</span>
                <p className="text-xs font-bold" style={{ color: '#92400E' }}>
                  {withIssuesSerials.length} device{withIssuesSerials.length > 1 ? 's' : ''} with issues — awaiting refurbishment decision
                </p>
              </div>
              {isLeadTech && (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium cursor-pointer select-none" style={{ color: '#92400E' }}>
                    <input type="checkbox"
                      checked={withIssuesSerials.length > 0 && withIssuesSerials.every(s => selectedIssueIds.has(s.id))}
                      onChange={e => setSelectedIssueIds(e.target.checked ? new Set(withIssuesSerials.map(s => s.id)) : new Set())}
                      style={{ accentColor: '#EA580C' }} />
                    Select All
                  </label>
                  {selectedIssueIds.size > 0 && (
                    <button className="btn-primary text-[11px] py-1 px-3"
                      style={{ background: '#EA580C', borderColor: '#EA580C' }}
                      onClick={() => setShowBulkSendModal(true)}>
                      🔧 Send {selectedIssueIds.size} to Refurbishment
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="bg-white grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {withIssuesSerials.map(s => {
                const isSel = selectedIssueIds.has(s.id)
                return (
                  <div key={s.id} className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-all"
                    style={{ background: isSel ? '#FEF3C7' : '#F9FAFB', border: `1px solid ${isSel ? '#F59E0B' : '#E5E7EB'}` }}>
                    {isLeadTech && (
                      <input type="checkbox" checked={isSel} style={{ accentColor: '#EA580C', flexShrink: 0 }}
                        onChange={e => {
                          const next = new Set(selectedIssueIds)
                          e.target.checked ? next.add(s.id) : next.delete(s.id)
                          setSelectedIssueIds(next)
                        }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-t1 truncate">{s.productName}</p>
                      <p className="font-mono text-[10px] text-t3">{s.serial}</p>
                    </div>
                    {isLeadTech && selectedIssueIds.size === 0 && (
                      <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#EA580C', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        onClick={() => { setCreateJobSerial(s); setCreateJobIssue(''); setShowCreateJobModal(true) }}>
                        Send
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {!isLeadTech && (
              <div className="px-4 py-2 text-[10px]" style={{ background: '#FFF7ED', color: '#92400E', borderTop: '1px solid #FED7AA' }}>
                Ask the lead technician to send these devices for refurbishment.
              </div>
            )}
          </div>
        )}

        {/* Orphaned serials */}
        {orphanedSerials.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #FDE68A' }}>
            <div className="flex items-center gap-2 px-4 py-2.5"
              style={{ background: '#FFFBEB', borderBottom: '1px solid #FDE68A' }}>
              <span>⚠️</span>
              <p className="text-xs font-bold" style={{ color: '#92400E' }}>
                {orphanedSerials.length} device{orphanedSerials.length > 1 ? 's' : ''} in repair unit — no job created yet
              </p>
            </div>
            <div className="bg-white grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {orphanedSerials.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                  style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-t1 truncate">{s.productName}</p>
                    <p className="font-mono text-[10px] text-t3">{s.serial}</p>
                  </div>
                  {isLeadTech && (
                    <button style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#D97706', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      onClick={() => { setCreateJobSerial(s); setCreateJobIssue(''); setShowCreateJobModal(true) }}>
                      + Create Job
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!isLeadTech && (
              <div className="px-4 py-2 text-[10px]" style={{ background: '#FFFBEB', color: '#B45309', borderTop: '1px solid #FDE68A' }}>
                Ask the lead technician to create a job for these devices.
              </div>
            )}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex items-center gap-1 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
          {(['all', 'queued', 'assigned', 'in_progress', 'ready', 'transferred', 'written_off'] as const).map(s => {
            const active = filterStatus === s
            const meta = s !== 'all' ? STATUS_META[s] : null
            return (
              <button key={s} onClick={() => setFilterStatus(s)}
                style={{
                  padding: '5px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 10, whiteSpace: 'nowrap',
                  fontWeight: active ? 600 : 400, transition: 'all 0.15s',
                  background: active ? (meta ? meta.bg : '#E8F3FA') : 'transparent',
                  border: `1px solid ${active ? (meta ? meta.border : '#A8D4E8') : 'transparent'}`,
                  color: active ? (meta ? meta.color : '#1B2762') : '#6B7280',
                }}>
                {s === 'all' ? 'All' : STATUS_META[s].label}
                {(statusCounts[s] ?? 0) > 0 && (
                  <span style={{
                    marginLeft: 4, fontSize: 9, fontWeight: 700,
                    background: active ? 'rgba(0,0,0,0.08)' : '#F3F4F6',
                    color: active ? 'inherit' : '#9CA3AF',
                    borderRadius: 20, padding: '1px 4px',
                  }}>{statusCounts[s]}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Jobs table */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Fa icon={faBoxOpen} style={{ fontSize: 36, color: '#D1D5DB', marginBottom: 12 }} />
            <p className="text-sm font-medium text-t2">No refurbishment jobs</p>
            <p className="text-xs text-t3 mt-1">
              {filterStatus !== 'all' ? `No jobs with status "${STATUS_META[filterStatus as RefurbStatus].label}"` : 'Jobs are created when items are received with issues'}
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto w-full">
              <div className="min-w-[800px] flex flex-col">
                <div className="table-head" style={{ gridTemplateColumns: '90px 1fr 120px 110px 130px 90px 80px' }}>
              <span>Ref</span>
              <span>Device</span>
              <span>Status</span>
              <span>Technician</span>
              <span>Parts Cost</span>
              <span>Intake</span>
              <span></span>
            </div>
            {filtered.map(j => {
              const partTotal = j.partsNeeded.reduce((s, p) => s + p.estimatedCost * p.qty, 0)
              return (
                <div key={j.id} className="table-row hover:bg-gray-50 transition-colors"
                  style={{ gridTemplateColumns: '90px 1fr 120px 110px 130px 90px 80px', borderLeft: `3px solid ${STATUS_LEFT_BORDER[j.status]}`, cursor: 'pointer' }}
                  onClick={() => setActiveId(j.id)}>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#5B21B6' }}>{j.ref}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-t1 truncate">{j.productName}</p>
                    <p className="font-mono text-[10px] text-t3">S/N {j.serialNumber}</p>
                  </div>
                  <StatusBadge status={j.status} />
                  <div className="min-w-0">
                    {j.assignedTechnicianName ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                          {j.assignedTechnicianName.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="text-xs text-t1 truncate">{j.assignedTechnicianName}</span>
                      </div>
                    ) : (
                      <span className="text-xs italic font-medium" style={{ color: '#F59E0B' }}>⚠ Unassigned</span>
                    )}
                  </div>
                  <span className="text-xs font-medium text-t2">{partTotal > 0 ? fmtKes(partTotal) : '—'}</span>
                  <span className="text-xs text-t3">{fmtDate(j.intakeDate)}</span>
                  <button
                    onClick={e => { e.stopPropagation(); setActiveId(j.id) }}
                    style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5, background: '#E8F3FA', color: '#1B2762', border: '1px solid #A8D4E8', cursor: 'pointer' }}>
                    Open
                  </button>
                </div>
              )
            })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bulk Send Modal ── */}
      {showBulkSendModal && (
        <Modal title={`Send ${selectedIssueIds.size} Device${selectedIssueIds.size > 1 ? 's' : ''} to Refurbishment`}
          onClose={() => setShowBulkSendModal(false)} width={480}>
          <div className="rounded-lg p-3 mb-3 flex flex-col gap-1.5" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', maxHeight: 180, overflowY: 'auto' }}>
            {withIssuesSerials.filter(s => selectedIssueIds.has(s.id)).map(s => (
              <div key={s.id} className="flex items-center gap-2 text-xs">
                <span>📦</span>
                <span className="font-semibold text-t1">{s.productName}</span>
                <span className="font-mono text-t3">{s.serial}</span>
              </div>
            ))}
          </div>
          <Field label="Issue Description (applied to all selected) *">
            <Textarea value={bulkIssueDesc} onChange={setBulkIssueDesc} rows={3}
              placeholder="Describe the shared problem…" />
          </Field>
          <div className="flex gap-2 justify-end mt-4">
            <button className="btn-outline" onClick={() => setShowBulkSendModal(false)}>Cancel</button>
            <button className="btn-primary" style={{ background: '#EA580C', borderColor: '#EA580C' }}
              onClick={() => {
                if (!bulkIssueDesc.trim()) { showToast('Enter issue description', 'error'); return }
                const selected = withIssuesSerials.filter(s => selectedIssueIds.has(s.id))
                selected.forEach(s => createRefurbishmentJob(s.id, bulkIssueDesc.trim()))
                setSelectedIssueIds(new Set()); setBulkIssueDesc(''); setShowBulkSendModal(false)
                showToast(`${selected.length} device${selected.length > 1 ? 's' : ''} sent to refurbishment`)
              }}>
              Send to Refurbishment
            </button>
          </div>
        </Modal>
      )}

      {/* ── Create Job Modal ── */}
      {showCreateJobModal && createJobSerial && (
        <Modal title="Create Refurbishment Job" onClose={() => setShowCreateJobModal(false)} width={440}>
          <div className="rounded-lg p-3 mb-3" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
            <p className="text-xs font-semibold text-t1">{createJobSerial.productName}</p>
            <p className="font-mono text-[11px] text-t3">S/N: {createJobSerial.serial}</p>
          </div>
          <Field label="Issue Description *">
            <Textarea value={createJobIssue} onChange={setCreateJobIssue} rows={3}
              placeholder="Describe the problem — e.g. cracked screen, battery failure…" />
          </Field>
          <div className="flex gap-2 justify-end mt-4">
            <button className="btn-outline" onClick={() => setShowCreateJobModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => {
              if (!createJobIssue.trim()) { showToast('Enter issue description', 'error'); return }
              createRefurbishmentJob(createJobSerial.id, createJobIssue.trim())
              setShowCreateJobModal(false)
              showToast('Refurbishment job created')
            }}>Create Job</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
