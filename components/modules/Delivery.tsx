'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  useApp, fmtKes, fmtDate,
  DeliveryJob, DeliveryJobType, DeliveryJobStatus, Rider, RiderWeeklyPay,
} from '@/lib/store'
import { Modal, Field, Input, Select, ModuleSkeleton } from '@/components/ui'

// ── Print Components ───────────────────────────────────────────────────────────
function PrintJobSheet({ job, companySettings, onDone }: { job: DeliveryJob, companySettings: any, onDone: () => void }) {
  useEffect(() => {
    const handleAfterPrint = () => { onDone(); window.removeEventListener('afterprint', handleAfterPrint) }
    window.addEventListener('afterprint', handleAfterPrint)
    const timer = setTimeout(() => window.print(), 300)
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', handleAfterPrint) }
  }, [onDone])

  return (
    <div className="print-document-container bg-white text-black p-8 min-h-screen" style={{ fontFamily: 'Arial, sans-serif' }}>
      <div className="flex justify-between items-start border-b pb-6 mb-6" style={{ borderColor: '#E5E7EB' }}>
        <div>
          {companySettings.logoUrl ? (
             <img src={companySettings.logoUrl} style={{ maxHeight: 60, objectFit: 'contain', marginBottom: 8 }} alt="Logo" />
          ) : (
             <h2 className="text-xl font-bold mb-1">{companySettings.name}</h2>
          )}
          <p className="text-sm text-gray-600">{companySettings.address}, {companySettings.city}</p>
          <p className="text-sm text-gray-600">Tel: {companySettings.phone}</p>
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold tracking-widest text-gray-800 uppercase mb-2">DELIVERY JOB SHEET</h1>
          <p className="text-lg font-mono font-bold text-gray-900">{job.ref}</p>
          <p className="text-sm text-gray-600 mt-1">Date: {fmtDate(job.scheduledDate)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Customer Details</p>
          <p className="font-bold text-base">{job.customerName}</p>
          <p className="text-sm text-gray-700 mt-1">{job.customerPhone || 'No phone provided'}</p>
        </div>
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Job Information</p>
          <p className="text-sm"><span className="font-semibold">Type:</span> {JOB_TYPE_LABELS[job.type]}</p>
          <p className="text-sm mt-1"><span className="font-semibold">Rider:</span> {job.riderName || 'Unassigned'}</p>
          {job.saleOrderRef && <p className="text-sm mt-1"><span className="font-semibold">Sale Order:</span> {job.saleOrderRef}</p>}
          {job.repairOrderRef && <p className="text-sm mt-1"><span className="font-semibold">Repair Order:</span> {job.repairOrderRef}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8">
        <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Pickup Location</p>
          <p className="text-sm font-semibold">{job.pickupAddress}</p>
        </div>
        <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Delivery Location</p>
          <p className="text-sm font-semibold">{job.deliveryAddress}</p>
        </div>
      </div>

      {job.notes && (
        <div className="mb-8 p-4 border border-gray-200 rounded-lg">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Instructions / Notes</p>
          <p className="text-sm text-gray-800">{job.notes}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-12 mt-16 pt-8 border-t border-gray-200">
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-8">Pickup Signature</p>
          <div className="border-b border-gray-400 mb-2"></div>
          <p className="text-xs text-gray-500">Name & Date</p>
        </div>
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-8">Delivery Signature (Recipient)</p>
          <div className="border-b border-gray-400 mb-2"></div>
          <p className="text-xs text-gray-500">Name, ID/Phone & Date</p>
        </div>
      </div>

      <div className="no-print-area text-center mt-8">
        <button className="btn-outline" onClick={onDone}>Close Preview</button>
      </div>

      <style>{`
        @media print { 
          body * { visibility: hidden; } 
          .print-document-container, .print-document-container * { visibility: visible; } 
          .print-document-container { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; } 
          .no-print-area, .no-print-area * { display: none !important; } 
        }
      `}</style>
    </div>
  )
}

function PrintPaySlip({ pay, companySettings, onDone }: { pay: RiderWeeklyPay, companySettings: any, onDone: () => void }) {
  useEffect(() => {
    const handleAfterPrint = () => { onDone(); window.removeEventListener('afterprint', handleAfterPrint) }
    window.addEventListener('afterprint', handleAfterPrint)
    const timer = setTimeout(() => window.print(), 300)
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', handleAfterPrint) }
  }, [onDone])

  return (
    <div className="print-document-container bg-white text-black p-8 min-h-screen" style={{ fontFamily: 'Arial, sans-serif' }}>
      <div className="flex justify-between items-start border-b pb-6 mb-6" style={{ borderColor: '#E5E7EB' }}>
        <div>
          {companySettings.logoUrl ? (
             <img src={companySettings.logoUrl} style={{ maxHeight: 60, objectFit: 'contain', marginBottom: 8 }} alt="Logo" />
          ) : (
             <h2 className="text-xl font-bold mb-1">{companySettings.name}</h2>
          )}
          <p className="text-sm text-gray-600">{companySettings.address}, {companySettings.city}</p>
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-bold tracking-widest text-gray-800 uppercase mb-2">RIDER PAY STATEMENT</h1>
          <p className="text-lg font-mono font-bold text-gray-900">{pay.ref}</p>
          <p className="text-sm text-gray-600 mt-1">Generated: {fmtDate(pay.createdAt.slice(0, 10))}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Rider Details</p>
          <p className="font-bold text-base">{pay.riderName}</p>
          <p className="text-sm text-gray-700 mt-1">Rider ID: {pay.riderId}</p>
        </div>
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Period</p>
          <p className="text-sm font-medium">{fmtDate(pay.weekStart)} – {fmtDate(pay.weekEnd)}</p>
          <p className="text-sm mt-1">Status: <span className="font-bold uppercase">{pay.status}</span></p>
        </div>
      </div>

      <table className="w-full mb-8 border-collapse">
        <thead>
          <tr className="bg-gray-50 border-y border-gray-200 text-left">
            <th className="py-3 px-4 text-xs font-bold text-gray-600 uppercase">Description</th>
            <th className="py-3 px-4 text-xs font-bold text-gray-600 uppercase text-center">Deliveries</th>
            <th className="py-3 px-4 text-xs font-bold text-gray-600 uppercase text-right">Rate</th>
            <th className="py-3 px-4 text-xs font-bold text-gray-600 uppercase text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-200">
            <td className="py-4 px-4 text-sm">Delivery Fees for Period</td>
            <td className="py-4 px-4 text-sm text-center font-mono">{pay.deliveryCount}</td>
            <td className="py-4 px-4 text-sm text-right font-mono">{fmtKes(pay.ratePerDelivery)}</td>
            <td className="py-4 px-4 text-sm text-right font-mono font-bold">{fmtKes(pay.totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="flex justify-end mb-12">
        <div className="w-64">
          <div className="flex justify-between items-center py-2 border-b border-gray-200">
            <span className="text-sm font-bold">TOTAL DUE</span>
            <span className="text-lg font-bold font-mono text-gray-900">{fmtKes(pay.totalAmount)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-12 mt-16 pt-8 border-t border-gray-200">
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-8">Prepared By</p>
          <div className="border-b border-gray-400 mb-2"></div>
          <p className="text-xs text-gray-500">Sign & Date</p>
        </div>
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-8">Received By (Rider)</p>
          <div className="border-b border-gray-400 mb-2"></div>
          <p className="text-xs text-gray-500">Sign & Date</p>
        </div>
      </div>

      <div className="no-print-area text-center mt-8">
        <button className="btn-outline" onClick={onDone}>Close Preview</button>
      </div>

      <style>{`
        @media print { 
          body * { visibility: hidden; } 
          .print-document-container, .print-document-container * { visibility: visible; } 
          .print-document-container { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; } 
          .no-print-area, .no-print-area * { display: none !important; } 
        }
      `}</style>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────
type MainTab = 'jobs' | 'riders' | 'weekly_pay'

const JOB_TYPE_LABELS: Record<DeliveryJobType, string> = {
  repair_pickup:   'Repair Pickup',
  repair_dropoff:  'Repair Drop-off',
  sales_delivery:  'Sales Delivery',
}

const labelMap: Record<DeliveryJobStatus, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function StatusBadge({ status }: { status: DeliveryJobStatus }) {
  const colors: Record<DeliveryJobStatus, { bg: string; color: string; border: string }> = {
    pending:    { bg: '#FEF9C3', color: '#854D0E', border: '#FDE68A' },
    assigned:   { bg: '#DBEAFE', color: '#1E40AF', border: '#93C5FD' },
    in_transit: { bg: '#E8F3FA', color: '#1B2762', border: '#A8D4E8' },
    delivered:  { bg: '#DCFCE7', color: '#166534', border: '#6EE7B7' },
    failed:     { bg: '#FEE2E2', color: '#991B1B', border: '#FCA5A5' },
    cancelled:  { bg: '#F3F4F6', color: '#374151', border: '#E5E7EB' },
  }
  const c = colors[status]
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.color, border: `1px solid ${c.border}`, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{labelMap[status]}</span>
}

function TypeBadge({ type }: { type: DeliveryJobType }) {
  const colors: Record<DeliveryJobType, { bg: string; color: string; border: string }> = {
    repair_pickup:  { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
    repair_dropoff: { bg: '#E8F3FA', color: '#1B2762', border: '#A8D4E8' },
    sales_delivery: { bg: '#F0FDF4', color: '#166534', border: '#BBF7D0' },
  }
  const c = colors[type]
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>{JOB_TYPE_LABELS[type]}</span>
}

// ── Job Form Modal ─────────────────────────────────────────────────────────────
function JobModal({
  onClose, repairs, saleOrders, riders,
  createDeliveryJob, assignRiderToJob,
}: {
  onClose: () => void
  repairs: { id: string; ref: string; customerName: string; customerPhone: string }[]
  saleOrders: { id: string; ref: string; customerName: string }[]
  riders: Rider[]
  createDeliveryJob: ReturnType<typeof useApp>['createDeliveryJob']
  assignRiderToJob: ReturnType<typeof useApp>['assignRiderToJob']
}) {
  const [form, setForm] = useState({
    type: 'sales_delivery' as DeliveryJobType,
    saleOrderId: '', repairOrderId: '',
    riderId: '',
    customerName: '', customerPhone: '',
    pickupAddress: '', deliveryAddress: '',
    scheduledDate: new Date().toISOString().slice(0, 10),
    riderFee: '150',
    notes: '',
  })

  function set(k: string, v: string) { setForm(p => ({ ...p, [k]: v })) }

  function handleRiderChange(id: string) {
    const rider = riders.find(r => r.id === id)
    setForm(p => ({ ...p, riderId: id, riderFee: rider ? String(rider.ratePerDelivery) : p.riderFee }))
  }

  function handleSourceChange(type: DeliveryJobType, id: string) {
    if (type === 'sales_delivery') {
      const so = saleOrders.find(s => s.id === id)
      if (so) setForm(p => ({ ...p, saleOrderId: id, customerName: so.customerName }))
    } else if (type === 'repair_dropoff') {
      const r = repairs.find(r => r.id === id)
      if (r) setForm(p => ({
        ...p, repairOrderId: id,
        customerName: r.customerName, customerPhone: r.customerPhone,
        pickupAddress: 'Deed Technologies, CBD',
        deliveryAddress: r.customerName + ', Customer Address',
      }))
    }
  }

  function submit() {
    if (!form.customerName || !form.pickupAddress || !form.deliveryAddress || !form.scheduledDate) return
    const job = createDeliveryJob({
      type: form.type,
      saleOrderId:   form.saleOrderId   || undefined,
      saleOrderRef:  saleOrders.find(s => s.id === form.saleOrderId)?.ref,
      repairOrderId: form.repairOrderId || undefined,
      repairOrderRef: repairs.find(r => r.id === form.repairOrderId)?.ref,
      customerName:    form.customerName,
      customerPhone:   form.customerPhone,
      pickupAddress:   form.pickupAddress,
      deliveryAddress: form.deliveryAddress,
      scheduledDate:   form.scheduledDate,
      riderFee:        parseFloat(form.riderFee) || 0,
      notes:           form.notes,
    })
    if (form.riderId) assignRiderToJob(job.id, form.riderId)
    onClose()
  }

  return (
    <Modal title="New Delivery Job" onClose={onClose} width={640}>
      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-t2 block mb-1.5">Job Type *</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(JOB_TYPE_LABELS) as DeliveryJobType[]).map(t => (
              <button key={t} onClick={() => set('type', t)}
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  background: form.type === t ? '#E8F3FA' : '#F9FAFB',
                  color: form.type === t ? '#1B2762' : '#6B7280',
                  border: `1px solid ${form.type === t ? '#A8D4E8' : '#E5E7EB'}`,
                }}>
                {JOB_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {form.type === 'repair_dropoff' ? (
          <Field label="Link to Repair Order">
            <Select value={form.repairOrderId} onChange={v => handleSourceChange(form.type, v)} options={[{ value: '', label: '— Select repair order —' }, ...repairs.map(r => ({ value: r.id, label: `${r.ref} · ${r.customerName}` }))]} />
          </Field>
        ) : form.type === 'sales_delivery' ? (
          <Field label="Link to Sale Order">
            <Select value={form.saleOrderId} onChange={v => handleSourceChange(form.type, v)} options={[{ value: '', label: '— Select sale order —' }, ...saleOrders.map(s => ({ value: s.id, label: `${s.ref} · ${s.customerName}` }))]} />
          </Field>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer Name *"><Input value={form.customerName} onChange={v => set('customerName', v)} placeholder="Customer / recipient" /></Field>
          <Field label="Phone"><Input type="tel" value={form.customerPhone} onChange={v => set('customerPhone', v)} placeholder="+254..." maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" /></Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={form.type === 'repair_pickup' ? 'Collect From (Customer) *' : form.type === 'repair_dropoff' ? 'Collect From (Shop) *' : 'Pickup Address *'}>
            <Input value={form.pickupAddress} onChange={v => set('pickupAddress', v)} placeholder="Where to collect from" />
          </Field>
          <Field label={form.type === 'repair_pickup' ? 'Deliver To (Shop) *' : form.type === 'repair_dropoff' ? 'Deliver To (Customer) *' : 'Delivery Address *'}>
            <Input value={form.deliveryAddress} onChange={v => set('deliveryAddress', v)} placeholder="Where to deliver to" />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Scheduled Date *"><Input type="date" value={form.scheduledDate} onChange={v => set('scheduledDate', v)} /></Field>
          <Field label="Assign Rider">
            <Select value={form.riderId} onChange={handleRiderChange} options={[{ value: '', label: '— Assign later —' }, ...riders.filter(r => r.active).map(r => ({ value: r.id, label: `${r.name} · ${r.vehicle}` }))]} />
          </Field>
          <Field label="Rider Fee (KES)"><Input type="number" value={form.riderFee} onChange={v => set('riderFee', v)} placeholder="150" /></Field>
        </div>

        <Field label="Notes / Instructions">
          <textarea className="form-input text-xs w-full" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Special instructions, fragile items, gate code, etc." />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-outline text-[11px]" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-[11px]" onClick={submit}>Create Job</button>
      </div>
    </Modal>
  )
}

// ── Assign Rider Modal ─────────────────────────────────────────────────────────
function AssignModal({ job, riders, onAssign, onClose }: { job: DeliveryJob; riders: Rider[]; onAssign: (riderId: string) => void; onClose: () => void }) {
  const [riderId, setRiderId] = useState(job.riderId ?? '')
  return (
    <Modal title={`Assign Rider — ${job.ref}`} onClose={onClose} width={400}>
      <Field label="Select Rider">
        <Select value={riderId} onChange={setRiderId} options={[{ value: '', label: '— Select —' }, ...riders.filter(r => r.active).map(r => ({ value: r.id, label: `${r.name} · ${r.vehicle} · KES ${r.ratePerDelivery}/job` }))]} />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-outline text-[11px]" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-[11px]" onClick={() => { if (riderId) { onAssign(riderId); onClose() } }}>Assign</button>
      </div>
    </Modal>
  )
}

// ── Failure Reason Modal ───────────────────────────────────────────────────────
function FailModal({ onConfirm, onClose }: { onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <Modal title="Mark as Failed" onClose={onClose} width={400}>
      <Field label="Failure Reason">
        <textarea className="form-input w-full text-xs" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Customer not home, wrong address..." />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-outline text-[11px]" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-[11px]" style={{ background: '#EF4444', borderColor: '#EF4444' }} onClick={() => { onConfirm(reason); onClose() }}>Confirm Failed</button>
      </div>
    </Modal>
  )
}

// ── Jobs Tab ───────────────────────────────────────────────────────────────────
function JobsTab() {
  const {
    deliveryJobs, riders, repairs, saleOrders,
    createDeliveryJob, assignRiderToJob, advanceJobStatus, deleteDeliveryJob,
    showToast, companySettings,
  } = useApp()

  const [printJob, setPrintJob] = useState<DeliveryJob | null>(null)

  if (printJob) {
    return <PrintJobSheet job={printJob} companySettings={companySettings} onDone={() => setPrintJob(null)} />
  }

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [assignTarget, setAssignTarget] = useState<DeliveryJob | null>(null)
  const [failTarget, setFailTarget] = useState<DeliveryJob | null>(null)
  const [filterStatus, setFilterStatus] = useState<DeliveryJobStatus | 'all'>('all')
  const [filterType, setFilterType] = useState<DeliveryJobType | 'all'>('all')

  const filtered = useMemo(() =>
    deliveryJobs.filter(j =>
      (filterStatus === 'all' || j.status === filterStatus) &&
      (filterType   === 'all' || j.type   === filterType)
    ), [deliveryJobs, filterStatus, filterType])

  const stats = useMemo(() => ({
    pending:    deliveryJobs.filter(j => j.status === 'pending').length,
    assigned:   deliveryJobs.filter(j => j.status === 'assigned').length,
    in_transit: deliveryJobs.filter(j => j.status === 'in_transit').length,
    delivered:  deliveryJobs.filter(j => j.status === 'delivered').length,
    failed:     deliveryJobs.filter(j => j.status === 'failed').length,
  }), [deliveryJobs])

  // Next status button labels
  function nextAction(job: DeliveryJob): { label: string; status: DeliveryJobStatus } | null {
    if (job.status === 'assigned')   return { label: 'Mark In Transit', status: 'in_transit' }
    if (job.status === 'in_transit') return { label: 'Mark Delivered',  status: 'delivered'  }
    return null
  }

  return (
    <div className="flex flex-col gap-4">
      {/* KPI row */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {[
          { label: 'Pending',    val: stats.pending,    color: '#F59E0B' },
          { label: 'Assigned',   val: stats.assigned,   color: '#8B5CF6' },
          { label: 'In Transit', val: stats.in_transit, color: '#2E90FA' },
          { label: 'Delivered',  val: stats.delivered,  color: '#10B981' },
          { label: 'Failed',     val: stats.failed,     color: '#EF4444' },
        ].map(s => (
          <div key={s.label} className="stat-card text-center">
            <p className="text-[9px] uppercase tracking-wide mb-1 text-t4">{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-primary text-xs" onClick={() => setShowCreateModal(true)}>
          + New Delivery Job
        </button>
        <div className="flex items-center gap-1 flex-wrap">
          {(['all', 'pending', 'assigned', 'in_transit', 'delivered', 'failed'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-all border border-[var(--border)] ${
                filterStatus === s ? 'bg-brand-navy text-white' : 'bg-[var(--bg-surface)] text-t3'
              }`}>
              {s === 'all' ? 'All' : labelMap[s as DeliveryJobStatus] ?? s}
            </button>
          ))}
        </div>
        <select className="form-select text-xs sm:ml-auto w-full sm:w-[150px]"
          value={filterType}
          onChange={e => setFilterType(e.target.value as DeliveryJobType | 'all')}>
          <option value="all">All Types</option>
          {(Object.keys(JOB_TYPE_LABELS) as DeliveryJobType[]).map(t => (
            <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <div className="table-head min-w-[700px]" style={{ gridTemplateColumns: '90px 90px 110px 1fr 140px 100px 80px 70px' }}>
          <span>Ref</span><span>Date</span><span>Type</span><span>Customer / Route</span>
          <span>Rider</span><span className="text-right">Rider Fee</span>
          <span>Status</span><span>Actions</span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-10 text-center text-xs text-t4 min-w-[700px]">
            No delivery jobs found
          </div>
        ) : filtered.map(job => {
          const action = nextAction(job)
          return (
            <div key={job.id} className="table-row items-start min-w-[700px]"
              style={{ gridTemplateColumns: '90px 90px 110px 1fr 140px 100px 80px 70px' }}>
              <div>
                <p className="font-mono text-[10px] font-bold" style={{ color: '#1B2762' }}>{job.ref}</p>
                {job.saleOrderRef && <p className="text-[9px]" style={{ color: 'var(--text-4)' }}>{job.saleOrderRef}</p>}
                {job.repairOrderRef && <p className="text-[9px]" style={{ color: 'var(--text-4)' }}>{job.repairOrderRef}</p>}
              </div>
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{fmtDate(job.scheduledDate)}</span>
              <TypeBadge type={job.type} />
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{job.customerName}</p>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
                  {job.pickupAddress} → {job.deliveryAddress}
                </p>
                {job.notes && <p className="text-[9px] truncate" style={{ color: 'var(--text-4)' }}>{job.notes}</p>}
                {job.failureReason && (
                  <p className="text-[9px]" style={{ color: '#EF4444' }}>Fail: {job.failureReason}</p>
                )}
              </div>
              <div>
                {job.riderName ? (
                  <p className="text-[10px] font-medium" style={{ color: 'var(--text-1)' }}>{job.riderName}</p>
                ) : (
                  job.status === 'pending' ? (
                    <button className="text-[9px] px-2 py-0.5 rounded"
                      style={{ background: '#EDE9FE', color: '#5B21B6', border: 'none', cursor: 'pointer' }}
                      onClick={() => setAssignTarget(job)}>
                      Assign Rider
                    </button>
                  ) : <span className="text-[10px]" style={{ color: 'var(--text-4)' }}>—</span>
                )}
              </div>
              <span className="text-right font-mono text-xs" style={{ color: '#EF4444' }}>
                {fmtKes(job.riderFee)}
              </span>
              <StatusBadge status={job.status} />
              {/* Actions */}
              <div className="flex flex-col gap-1">
                <button className="text-[9px] py-0.5 px-1.5 rounded cursor-pointer"
                  style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB' }}
                  title="Print Job Sheet"
                  onClick={() => setPrintJob(job)}>🖨️ Print</button>
                {job.status === 'pending' && !job.riderId && (
                  <button className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: '#EDE9FE', color: '#5B21B6', border: 'none', cursor: 'pointer' }}
                    onClick={() => setAssignTarget(job)}>Assign</button>
                )}
                {action && (
                  <button className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: '#DCFCE7', color: '#166534', border: 'none', cursor: 'pointer' }}
                    onClick={() => advanceJobStatus(job.id, action.status)}>
                    {action.label.replace('Mark ', '')}
                  </button>
                )}
                {job.status === 'in_transit' && (
                  <button className="text-[9px] py-0.5 px-1.5 rounded cursor-pointer"
                    style={{ background: '#FEE2E2', color: '#991B1B', border: 'none' }}
                    onClick={() => setFailTarget(job)}>Failed</button>
                )}
                {['pending', 'cancelled'].includes(job.status) && (
                  <button className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--bg-surface)', color: '#EF4444', border: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => deleteDeliveryJob(job.id)}>Del</button>
                )}
              </div>
            </div>
          )
        })}
        </div>{/* /overflow-x-auto */}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <JobModal
          onClose={() => setShowCreateModal(false)}
          repairs={repairs.map(r => ({ id: r.id, ref: r.ref, customerName: r.customerName, customerPhone: r.customerPhone }))}
          saleOrders={saleOrders.filter(so => so.status === 'confirmed' || so.status === 'quotation').map(so => ({ id: so.id, ref: so.ref, customerName: so.customerName }))}
          riders={riders}
          createDeliveryJob={createDeliveryJob}
          assignRiderToJob={assignRiderToJob}
        />
      )}
      {assignTarget && (
        <AssignModal
          job={assignTarget}
          riders={riders}
          onAssign={riderId => assignRiderToJob(assignTarget.id, riderId)}
          onClose={() => setAssignTarget(null)}
        />
      )}
      {failTarget && (
        <FailModal
          onConfirm={reason => advanceJobStatus(failTarget.id, 'failed', reason)}
          onClose={() => setFailTarget(null)}
        />
      )}
    </div>
  )
}

// ── Riders Tab ─────────────────────────────────────────────────────────────────
function RidersTab() {
  const { riders, addRider, updateRider, deliveryJobs } = useApp()

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '', phone: '', idNumber: '',
    vehicle: 'motorcycle' as Rider['vehicle'],
    vehicleReg: '', ratePerDelivery: '150',
  })

  function set(k: string, v: string) { setForm(p => ({ ...p, [k]: v })) }

  function submit() {
    if (!form.name || !form.phone) return
    addRider({
      name: form.name, phone: form.phone, idNumber: form.idNumber,
      vehicle: form.vehicle, vehicleReg: form.vehicleReg || undefined,
      active: true, ratePerDelivery: parseFloat(form.ratePerDelivery) || 150,
    })
    setForm({ name: '', phone: '', idNumber: '', vehicle: 'motorcycle', vehicleReg: '', ratePerDelivery: '150' })
    setShowForm(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{riders.length} rider{riders.length !== 1 ? 's' : ''} registered</p>
        <button className="btn-primary text-xs" onClick={() => setShowForm(p => !p)}>
          {showForm ? 'Cancel' : '+ Add Rider'}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="card p-4 flex flex-col gap-3">
          <p className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>New Rider</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1 text-t4">Full Name</p>
              <input className="form-input text-xs w-full" value={form.name}
                onChange={e => set('name', e.target.value)} placeholder="James Mwangi" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1 text-t4">Phone</p>
              <input className="form-input text-xs w-full" type="tel" value={form.phone}
                onChange={e => set('phone', e.target.value)} placeholder="+254 7..." maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1 text-t4">ID Number</p>
              <input className="form-input text-xs w-full" value={form.idNumber}
                onChange={e => set('idNumber', e.target.value)} placeholder="National ID" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1 text-t4">Vehicle</p>
              <select className="form-select text-xs w-full" value={form.vehicle}
                onChange={e => set('vehicle', e.target.value)}>
                <option value="motorcycle">Motorcycle</option>
                <option value="bicycle">Bicycle</option>
                <option value="car">Car</option>
                <option value="foot">On Foot</option>
              </select>
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1 text-t4">Vehicle Reg</p>
              <input className="form-input text-xs w-full" value={form.vehicleReg}
                onChange={e => set('vehicleReg', e.target.value)} placeholder="KMCK 001A" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1 text-t4">Rate / Delivery (KES)</p>
              <input type="number" className="form-input text-xs w-full" value={form.ratePerDelivery}
                onChange={e => set('ratePerDelivery', e.target.value)} />
            </div>
            <div className="flex items-end">
              <button className="btn-primary text-xs py-1.5 px-4" onClick={submit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Riders table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="table-head min-w-[700px]" style={{ gridTemplateColumns: '1fr 130px 120px 110px 120px 80px 80px 60px' }}>
            <span>Rider</span><span>Phone</span><span>ID Number</span>
            <span>Vehicle</span><span>Reg No.</span>
            <span className="text-right">Rate / Job</span>
            <span className="text-right">Total Jobs</span>
            <span>Status</span>
          </div>
          {riders.length === 0 ? (
            <div className="py-8 text-center text-xs text-t4 min-w-[700px]">No riders yet — add one above</div>
          ) : riders.map(rider => {
            const jobCount = deliveryJobs.filter(j => j.riderId === rider.id && j.status === 'delivered').length
            return (
              <div key={rider.id} className="table-row min-w-[700px]"
                style={{ gridTemplateColumns: '1fr 130px 120px 110px 120px 80px 80px 60px' }}>
                <div>
                  <p className="text-xs font-semibold text-t1">{rider.name}</p>
                </div>
                <span className="text-xs text-t2">{rider.phone}</span>
                <span className="font-mono text-[10px] text-t3">{rider.idNumber || '—'}</span>
                <span className="text-xs capitalize text-t2">{rider.vehicle}</span>
                <span className="font-mono text-[10px] text-t3">{rider.vehicleReg || '—'}</span>
                <span className="text-right font-mono text-xs font-semibold text-brand-navy">
                  {fmtKes(rider.ratePerDelivery)}
                </span>
                <span className="text-right font-mono text-xs text-t2">{jobCount}</span>
                <div className="flex justify-center">
                  <button
                    onClick={() => updateRider(rider.id, { active: !rider.active })}
                    className="cursor-pointer"
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, border: 'none', background: rider.active ? '#DCFCE7' : '#F3F4F6', color: rider.active ? '#166534' : '#6B7280' }}>
                    {rider.active ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Weekly Pay Tab ─────────────────────────────────────────────────────────────
function WeeklyPayTab() {
  const { riders, deliveryJobs, riderWeeklyPays, generateWeeklyPay, markWeeklyPayPaid, companySettings, users, currentUserId } = useApp()
  const currentUser = users.find(u => u.id === currentUserId)
  const canManagePay = ['director', 'finance_officer'].includes(currentUser?.role ?? '')

  const [printPay, setPrintPay] = useState<RiderWeeklyPay | null>(null)

  if (printPay) {
    return <PrintPaySlip pay={printPay} companySettings={companySettings} onDone={() => setPrintPay(null)} />
  }

  // Default to current week Monday
  function currentWeekMonday() {
    const d = new Date()
    const day = d.getDay()
    const diff = (day === 0 ? -6 : 1 - day)
    const mon = new Date(d); mon.setDate(d.getDate() + diff)
    return mon.toISOString().slice(0, 10)
  }

  const [weekStart, setWeekStart] = useState(currentWeekMonday)
  const [selectedRiderId, setSelectedRiderId] = useState<string>('all')

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart); d.setDate(d.getDate() + 6)
    return d.toISOString().slice(0, 10)
  }, [weekStart])

  // Per-rider summary for the selected week
  const riderSummaries = useMemo(() =>
    riders.filter(r => r.active).map(rider => {
      const jobs = deliveryJobs.filter(j =>
        j.riderId === rider.id &&
        j.status === 'delivered' &&
        j.deliveredAt &&
        j.deliveredAt.slice(0, 10) >= weekStart &&
        j.deliveredAt.slice(0, 10) <= weekEnd
      )
      const existingPay = riderWeeklyPays.find(p => p.riderId === rider.id && p.weekStart === weekStart)
      return {
        rider, jobs, existingPay,
        totalOwed: jobs.reduce((s, j) => s + j.riderFee, 0),
      }
    }), [riders, deliveryJobs, riderWeeklyPays, weekStart, weekEnd])

  const filteredSummaries = selectedRiderId === 'all'
    ? riderSummaries
    : riderSummaries.filter(s => s.rider.id === selectedRiderId)

  return (
    <div className="flex flex-col gap-4">
      {/* Week selector */}
      <div className="card p-4 flex items-center gap-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Week Starting (Monday)</p>
          <input type="date" className="form-input text-xs" value={weekStart}
            onChange={e => setWeekStart(e.target.value)} style={{ width: 160 }} />
        </div>
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          Week: <strong>{fmtDate(weekStart)}</strong> — <strong>{fmtDate(weekEnd)}</strong>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <p className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-4)' }}>Rider:</p>
          <select className="form-select text-xs" value={selectedRiderId}
            onChange={e => setSelectedRiderId(e.target.value)} style={{ width: 180 }}>
            <option value="all">All Riders</option>
            {riders.filter(r => r.active).map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary cards per rider */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {filteredSummaries.map(({ rider, jobs, existingPay, totalOwed }) => (
          <div key={rider.id} className="card overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-lt)' }}>
              <div>
                <p className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>{rider.name}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                  {rider.vehicle} · KES {rider.ratePerDelivery}/delivery
                </p>
              </div>
              {existingPay ? (
                <span className={`badge ${existingPay.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>
                  {existingPay.status === 'paid' ? '✓ Paid' : 'Pending Payment'}
                </span>
              ) : null}
            </div>
            <div className="px-4 py-3">
              {jobs.length === 0 ? (
                <p className="text-xs text-center py-2" style={{ color: 'var(--text-4)' }}>No deliveries this week</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      {jobs.length} delivery{jobs.length !== 1 ? 'ies' : ''}
                    </span>
                    <span className="text-sm font-bold" style={{ color: '#1B2762' }}>{fmtKes(totalOwed)}</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {jobs.map(j => (
                      <div key={j.id} className="flex items-center justify-between text-[10px] py-1 border-b"
                        style={{ borderColor: 'var(--border-lt)' }}>
                        <div className="min-w-0">
                          <span className="font-mono font-bold" style={{ color: '#1B2762' }}>{j.ref}</span>
                          <span className="ml-2 truncate" style={{ color: 'var(--text-2)' }}>{j.customerName}</span>
                        </div>
                        <span className="font-mono ml-2 flex-shrink-0" style={{ color: '#EF4444' }}>{fmtKes(j.riderFee)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="px-4 pb-3 flex justify-end gap-2">
              {!existingPay && jobs.length > 0 && canManagePay && (
                <button className="btn-primary text-xs py-1"
                  onClick={() => generateWeeklyPay(rider.id, weekStart)}>
                  Generate Pay
                </button>
              )}
              {existingPay && existingPay.status === 'pending' && canManagePay && (
                <button className="btn-primary text-xs py-1"
                  style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
                  onClick={() => {
                    if (confirm(`Confirm payment of ${fmtKes(existingPay.totalAmount)} to ${existingPay.riderName}?\n\nAn accounting vendor bill will be created automatically.`))
                      markWeeklyPayPaid(existingPay.id)
                  }}>
                  Confirm Payment — {fmtKes(existingPay.totalAmount)}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pay history */}
      {riderWeeklyPays.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-lt)]">
            <p className="text-xs font-semibold text-t1">Pay History</p>
          </div>
          <div className="overflow-x-auto">
            <div className="table-head min-w-[780px]" style={{ gridTemplateColumns: '90px 1fr 130px 60px 80px 100px 80px 80px 100px 50px' }}>
              <span>Ref</span><span>Rider</span><span>Week</span>
              <span className="text-right">Jobs</span>
              <span className="text-right">Rate</span>
              <span className="text-right">Total</span>
              <span>Status</span><span>Paid By</span><span>Invoice</span><span></span>
            </div>
            {[...riderWeeklyPays].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(pay => (
              <div key={pay.id} className="table-row min-w-[780px]"
                style={{ gridTemplateColumns: '90px 1fr 130px 60px 80px 100px 80px 80px 100px 50px' }}>
                <span className="font-mono text-[10px] font-bold text-brand-navy">{pay.ref}</span>
                <span className="text-xs text-t1">{pay.riderName}</span>
                <span className="text-[10px] text-t3">
                  {fmtDate(pay.weekStart)} – {fmtDate(pay.weekEnd)}
                </span>
                <span className="text-right font-mono text-xs">{pay.deliveryCount}</span>
                <span className="text-right font-mono text-xs text-t3">
                  {fmtKes(pay.ratePerDelivery)}
                </span>
                <span className="text-right font-mono text-xs font-bold text-brand-navy">
                  {fmtKes(pay.totalAmount)}
                </span>
                <div>
                  <span className={`badge ${pay.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>
                    {pay.status === 'paid' ? 'Paid' : 'Pending'}
                  </span>
                </div>
                <span className="text-[10px] text-t3">{pay.paidByName || '—'}</span>
                <div>
                  {pay.invoiceRef ? (
                    <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: '#DBEAFE', color: '#1E40AF' }}>
                      {pay.invoiceRef}
                    </span>
                  ) : (
                    <span className="text-[10px] text-t4">—</span>
                  )}
                </div>
                <div>
                  <button className="btn-outline text-[10px] py-0.5 px-2" onClick={() => setPrintPay(pay)} title="Print Pay Statement">🖨️</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Root Component ─────────────────────────────────────────────────────────────
export default function Delivery() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const { deliveryJobs, riderWeeklyPays } = useApp()
  const [tab, setTab] = useState<MainTab>('jobs')

  const pendingPay = riderWeeklyPays.filter(p => p.status === 'pending').length

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#10B98115', color: '#10B981' }}>
            <span className="text-base">🚚</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-extrabold text-text-1">Delivery</h1>
              <span className="badge badge-gray text-[9px]">{deliveryJobs.length} jobs</span>
            </div>
            <p className="text-[10px] text-text-3 mt-0.5">Pickups, deliveries &amp; rider management</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mod-tabs">
        {([
          { key: 'jobs',       label: 'Jobs',       count: deliveryJobs.length },
          { key: 'riders',     label: 'Riders',     count: undefined },
          { key: 'weekly_pay', label: 'Weekly Pay', count: pendingPay > 0 ? pendingPay : undefined },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`mod-tab ${tab === t.key ? 'active' : ''}`}>
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 badge badge-gray text-[9px]">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">
        {tab === 'jobs'       && <JobsTab />}
        {tab === 'riders'     && <RidersTab />}
        {tab === 'weekly_pay' && <WeeklyPayTab />}
      </div>
    </div>
  )
}
