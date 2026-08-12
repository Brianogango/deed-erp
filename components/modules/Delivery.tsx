// @ts-nocheck
'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  useDeliveryStore, fmtKes, fmtDate,
  DeliveryJob, DeliveryJobType, DeliveryJobStatus, Rider, RiderWeeklyPay,
} from '@/lib/store'
import { Confirm, Modal, Field, Input, Select, ModuleSkeleton, ModuleHeader, TabBar } from '@/components/ui'
import { StatusBadge } from '@/components/erp'
import { CalendarView } from '@/components/erp/CalendarView'
import { Fa, faPrint, faTruck } from '@/components/icons'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import {
  parseRiderFeeInput,
  suggestRiderFeePrefill,
} from '@/lib/delivery-job-fee'
import {
  DELIVERY_JOB_TYPE_LABELS,
  isGeneralDeliveryJob,
} from '@/lib/delivery-job-type'

// ── Print Components ───────────────────────────────────────────────────────────
function PrintJobSheet({ job, companySettings, onDone }: { job: DeliveryJob, companySettings: any, onDone: () => void }) {
  useEffect(() => {
    const handleAfterPrint = () => { onDone(); window.removeEventListener('afterprint', handleAfterPrint) }
    window.addEventListener('afterprint', handleAfterPrint)
    const timer = setTimeout(() => window.print(), 300)
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', handleAfterPrint) }
  }, [onDone])

  return (
    <div className="print-document-container bg-white text-black p-8 min-h-screen" style={{ fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif' }}>
      <div className="flex justify-between items-start border-b pb-6 mb-6" style={{ borderColor: 'var(--border-lt)' }}>
        <div>
          {companySettings?.logoUrl ? (
             <img src={companySettings?.logoUrl} style={{ maxHeight: 60, objectFit: 'contain', marginBottom: 8 }} alt="Logo" />
          ) : (
             <h2 className="text-xl font-bold mb-1">{companySettings?.name || 'Deed Technologies'}</h2>
          )}
          <p className="text-sm text-gray-600">{[companySettings?.address, companySettings?.city].filter(Boolean).join(', ') || '—'}</p>
          <p className="text-sm text-gray-600">Tel: {companySettings?.phone || '—'}</p>
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold tracking-widest text-gray-800 uppercase mb-2">DELIVERY JOB SHEET</h2>
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
          <p className="text-sm"><span className="font-semibold">Type:</span> {DELIVERY_JOB_TYPE_LABELS[job.type] ?? job.type}</p>
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
    <div className="print-document-container bg-white text-black p-8 min-h-screen" style={{ fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif' }}>
      <div className="flex justify-between items-start border-b pb-6 mb-6" style={{ borderColor: 'var(--border-lt)' }}>
        <div>
          {companySettings?.logoUrl ? (
             <img src={companySettings?.logoUrl} style={{ maxHeight: 60, objectFit: 'contain', marginBottom: 8 }} alt="Logo" />
          ) : (
             <h2 className="text-xl font-bold mb-1">{companySettings?.name || 'Deed Technologies'}</h2>
          )}
          <p className="text-sm text-gray-600">{[companySettings?.address, companySettings?.city].filter(Boolean).join(', ') || '—'}</p>
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold tracking-widest text-gray-800 uppercase mb-2">RIDER PAY STATEMENT</h2>
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

      <table data-no-responsive className="data-table mb-8">
        <thead>
          <tr>
            <th>Description</th>
            <th className="th-center">Deliveries</th>
            <th className="th-right">Rate</th>
            <th className="th-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Delivery Fees for Period</td>
            <td className="td-center td-mono">{pay.deliveryCount}</td>
            <td className="td-right td-mono">{fmtKes(pay.ratePerDelivery)}</td>
            <td className="td-right td-mono font-bold">{fmtKes(pay.totalAmount)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="font-black uppercase tracking-wider text-[10px]">Total Due</td>
            <td className="td-right td-mono text-sm">{fmtKes(pay.totalAmount)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="grid grid-cols-2 gap-12 mt-16 pt-8 border-t" style={{ borderColor: 'var(--border-lt)' }}>
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

const JOB_TYPE_LABELS = DELIVERY_JOB_TYPE_LABELS

const labelMap: Record<DeliveryJobStatus, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_transit: 'In transit',
  delivered: 'Delivered',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function TypeBadge({ type }: { type: DeliveryJobType }) {
  const colors: Record<DeliveryJobType, { bg: string; color: string; border: string }> = {
    repair_pickup:  { bg: 'var(--warning-bg)', color: 'var(--warning-text)', border: 'var(--warning-border, var(--border-lt))' },
    repair_dropoff: { bg: 'var(--info-bg, var(--bg-surface))', color: 'var(--navy)', border: 'var(--info-border, var(--border-lt))' },
    sales_delivery: { bg: 'var(--success-bg)', color: 'var(--success-text)', border: 'var(--success-border, var(--border-lt))' },
    general:        { bg: 'var(--bg-surface)', color: 'var(--text-2)', border: 'var(--border-lt)' },
  }
  const c = colors[type] ?? colors.general
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>{JOB_TYPE_LABELS[type] ?? type}</span>
}

// ── Job Form Modal ─────────────────────────────────────────────────────────────
function JobModal({
  onClose, repairs, saleOrders, riders,
  createDeliveryJob, assignRiderToJob, showToast,
}: {
  onClose: () => void
  repairs: { id: string; ref: string; customerName: string; customerPhone: string }[]
  saleOrders: { id: string; ref: string; customerName: string }[]
  riders: Rider[]
  createDeliveryJob: ReturnType<typeof useDeliveryStore>['createDeliveryJob']
  assignRiderToJob: ReturnType<typeof useDeliveryStore>['assignRiderToJob']
  showToast: ReturnType<typeof useDeliveryStore>['showToast']
}) {
  const [form, setForm] = useState({
    type: 'sales_delivery' as DeliveryJobType,
    saleOrderId: '', repairOrderId: '',
    riderId: '',
    customerName: '', customerPhone: '',
    pickupAddress: '', deliveryAddress: '',
    scheduledDate: new Date().toISOString().slice(0, 10),
    riderFee: '',
    notes: '',
  })

  function set(k: string, v: string) { setForm(p => ({ ...p, [k]: v })) }

  function selectType(type: DeliveryJobType) {
    setForm(p => ({
      ...p,
      type,
      // Clear document links that don't apply to the new type.
      saleOrderId: type === 'sales_delivery' ? p.saleOrderId : '',
      repairOrderId: type === 'repair_dropoff' ? p.repairOrderId : '',
    }))
  }

  function handleRiderChange(id: string) {
    const rider = riders.find(r => r.id === id)
    setForm(p => ({
      ...p,
      riderId: id,
      // Prefill only when the fee field is still empty and rider has a positive default.
      riderFee: suggestRiderFeePrefill(p.riderFee, rider?.ratePerDelivery),
    }))
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
    const fee = parseRiderFeeInput(form.riderFee)
    if (fee === null) {
      showToast('Enter the rider fee for this job (amount can vary per trip)', 'error')
      return
    }
    const isGeneral = isGeneralDeliveryJob(form.type)
    const job = createDeliveryJob({
      type: form.type,
      saleOrderId:   !isGeneral && form.saleOrderId ? form.saleOrderId : undefined,
      saleOrderRef:  !isGeneral && form.saleOrderId
        ? saleOrders.find(s => s.id === form.saleOrderId)?.ref
        : undefined,
      repairOrderId: !isGeneral && form.repairOrderId ? form.repairOrderId : undefined,
      repairOrderRef: !isGeneral && form.repairOrderId
        ? repairs.find(r => r.id === form.repairOrderId)?.ref
        : undefined,
      customerName:    form.customerName,
      customerPhone:   form.customerPhone,
      pickupAddress:   form.pickupAddress,
      deliveryAddress: form.deliveryAddress,
      scheduledDate:   form.scheduledDate,
      riderFee:        fee,
      billedTo:        isGeneral ? 'company' : undefined,
      notes:           form.notes,
    })
    // Pass the entered fee so assign never overwrites it with a zero default rate.
    if (form.riderId) assignRiderToJob(job.id, form.riderId, fee)
    onClose()
  }

  return (
    <Modal title="New Delivery Job" onClose={onClose} width={640}>
      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-semibold text-t2 block mb-1.5">Job Type *</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(JOB_TYPE_LABELS) as DeliveryJobType[]).map(t => (
              <button key={t} type="button" onClick={() => selectType(t)}
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  background: form.type === t ? 'var(--info-bg, var(--bg-surface))' : 'var(--bg-surface)',
                  color: form.type === t ? 'var(--navy)' : 'var(--text-4)',
                  border: `1px solid ${form.type === t ? 'var(--info-border, var(--border-lt))' : 'var(--border-lt)'}`,
                }}>
                {JOB_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          {isGeneralDeliveryJob(form.type) && (
            <p className="text-[10px] text-t4 mt-1.5">
              No sale order, repair, or invoice link. Use notes to describe the trip (courier, supplier pickup, internal move, etc.).
            </p>
          )}
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Scheduled Date *"><Input type="date" value={form.scheduledDate} onChange={v => set('scheduledDate', v)} /></Field>
          <Field label="Assign Rider">
            <Select value={form.riderId} onChange={handleRiderChange} options={[{ value: '', label: '— Assign later —' }, ...riders.filter(r => r.active).map(r => ({ value: r.id, label: `${r.name} · ${r.vehicle}` }))]} />
          </Field>
          <Field label="Rider Fee (KES) *">
            <Input type="number" min="0" step="1" value={form.riderFee} onChange={v => set('riderFee', v)} placeholder="Amount for this trip" />
          </Field>
        </div>
        <p className="text-[10px] text-t4 -mt-1">Fee is per job and can vary. Selecting a rider only suggests their default rate when this field is empty.</p>

        <Field label="Notes / Instructions">
          <textarea className="form-input text-xs w-full" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder={isGeneralDeliveryJob(form.type) ? 'Why this trip: courier docs, supplier pickup, shop transfer, etc.' : 'Special instructions, fragile items, gate code, etc.'} />
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
function AssignModal({
  job, riders, onAssign, onClose,
}: {
  job: DeliveryJob
  riders: Rider[]
  onAssign: (riderId: string, riderFee: number) => void
  onClose: () => void
}) {
  const [riderId, setRiderId] = useState(job.riderId ?? '')
  const [riderFee, setRiderFee] = useState(
    Number(job.riderFee) > 0 ? String(job.riderFee) : '',
  )

  function handleRiderChange(id: string) {
    const rider = riders.find(r => r.id === id)
    setRiderId(id)
    setRiderFee(prev => suggestRiderFeePrefill(prev, rider?.ratePerDelivery))
  }

  function submit() {
    if (!riderId) return
    const fee = parseRiderFeeInput(riderFee)
    if (fee === null) return
    onAssign(riderId, fee)
    onClose()
  }

  return (
    <Modal title={`Assign Rider — ${job.ref}`} onClose={onClose} width={400}>
      <div className="space-y-3">
        <Field label="Select Rider">
          <Select
            value={riderId}
            onChange={handleRiderChange}
            options={[
              { value: '', label: '— Select —' },
              ...riders.filter(r => r.active).map(r => ({
                value: r.id,
                label: r.ratePerDelivery > 0
                  ? `${r.name} · ${r.vehicle} · default KES ${r.ratePerDelivery}`
                  : `${r.name} · ${r.vehicle}`,
              })),
            ]}
          />
        </Field>
        <Field label="Rider Fee (KES) *">
          <Input type="number" min="0" step="1" value={riderFee} onChange={setRiderFee} placeholder="Amount for this trip" />
        </Field>
        <p className="text-[10px] text-t4">Enter the fee for this trip. It is not overwritten by the rider’s default rate.</p>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-outline text-[11px]" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-[11px]" onClick={submit} disabled={!riderId || parseRiderFeeInput(riderFee) === null}>Assign</button>
      </div>
    </Modal>
  )
}

// ── Edit Rider Fee Modal ───────────────────────────────────────────────────────
function EditFeeModal({
  job, onSave, onClose,
}: {
  job: DeliveryJob
  onSave: (fee: number) => void
  onClose: () => void
}) {
  const [riderFee, setRiderFee] = useState(String(job.riderFee ?? ''))
  const fee = parseRiderFeeInput(riderFee)
  return (
    <Modal title={`Edit Rider Fee — ${job.ref}`} onClose={onClose} width={380}>
      <Field label="Rider Fee (KES) *">
        <Input type="number" min="0" step="1" value={riderFee} onChange={setRiderFee} placeholder="Amount for this trip" />
      </Field>
      {job.riderName && (
        <p className="text-[10px] text-t4 mt-2">Rider: {job.riderName}. Fee is per job and can vary.</p>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-outline text-[11px]" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary text-[11px]"
          disabled={fee === null}
          onClick={() => { if (fee !== null) { onSave(fee); onClose() } }}
        >
          Save Fee
        </button>
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
        <button className="btn-primary text-[11px]" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => { onConfirm(reason); onClose() }}>Confirm Failed</button>
      </div>
    </Modal>
  )
}

// ── Jobs Tab ───────────────────────────────────────────────────────────────────
function JobsTab() {
  const {
    deliveryJobs, riders, repairs, saleOrders,
    createDeliveryJob, assignRiderToJob, updateDeliveryJob, advanceJobStatus, deleteDeliveryJob,
    showToast, companySettings,
  } = useDeliveryStore()

  const [printJob, setPrintJob] = useState<DeliveryJob | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [assignTarget, setAssignTarget] = useState<DeliveryJob | null>(null)
  const [feeTarget, setFeeTarget] = useState<DeliveryJob | null>(null)
  const [failTarget, setFailTarget] = useState<DeliveryJob | null>(null)
  const [filterStatus, setFilterStatus] = useState<DeliveryJobStatus | 'all'>('all')
  const [filterType, setFilterType] = useState<DeliveryJobType | 'all'>('all')
  const [jobsView, setJobsView] = useState<'list' | 'calendar'>('list')

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

  const deliveryPrimaryFilters: PrimaryFilterConfig[] = [
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All statuses',
      value: filterStatus,
      options: [
        { value: 'all', label: `All statuses (${deliveryJobs.length})` },
        ...(['pending', 'assigned', 'in_transit', 'delivered', 'failed'] as DeliveryJobStatus[]).map(status => ({
          value: status,
          label: `${labelMap[status] ?? status} (${stats[status]})`,
        })),
      ],
      onChange: value => setFilterStatus(value as DeliveryJobStatus | 'all'),
    },
    {
      key: 'type',
      label: 'Type',
      placeholder: 'All types',
      value: filterType,
      options: [
        { value: 'all', label: 'All types' },
        ...(Object.keys(JOB_TYPE_LABELS) as DeliveryJobType[]).map(type => ({
          value: type,
          label: JOB_TYPE_LABELS[type],
        })),
      ],
      onChange: value => setFilterType(value as DeliveryJobType | 'all'),
    },
  ]

  // Next status button labels
  function nextAction(job: DeliveryJob): { label: string; status: DeliveryJobStatus } | null {
    if (job.status === 'assigned')   return { label: 'Mark In Transit', status: 'in_transit' }
    if (job.status === 'in_transit') return { label: 'Mark Delivered',  status: 'delivered'  }
    return null
  }

  const jobColumns: ColumnDef<DeliveryJob>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: job => (
        <div>
          <p className="font-mono text-[10px] font-bold" style={{ color: 'var(--navy)' }}>{job.ref}</p>
          {job.saleOrderRef && <p className="text-[9px]" style={{ color: 'var(--text-4)' }}>{job.saleOrderRef}</p>}
          {job.invoiceRef && <p className="text-[9px]" style={{ color: 'var(--text-4)' }}>{job.invoiceRef}</p>}
          {job.repairOrderRef && <p className="text-[9px]" style={{ color: 'var(--text-4)' }}>{job.repairOrderRef}</p>}
        </div>
      ),
      accessor: job => job.ref,
      exportValue: job => job.ref,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '90px',
      render: job => <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{fmtDate(job.scheduledDate)}</span>,
      exportValue: job => job.scheduledDate,
    },
    {
      key: 'type', label: 'Type', priority: 2, width: '110px',
      render: job => <TypeBadge type={job.type} />,
      accessor: job => JOB_TYPE_LABELS[job.type],
      exportValue: job => JOB_TYPE_LABELS[job.type],
    },
    {
      key: 'customer', label: 'Customer / route', priority: 1, width: '1fr',
      render: job => (
        <div className="min-w-0">
          <p className="text-xs font-semibold erp-truncate" title={job.customerName} style={{ color: 'var(--text-1)' }}>{job.customerName}</p>
          <p className="text-[10px] erp-truncate" title={`${job.pickupAddress} → ${job.deliveryAddress}`} style={{ color: 'var(--text-3)' }}>
            {job.pickupAddress} → {job.deliveryAddress}
          </p>
          {job.notes && <p className="text-[9px] erp-truncate" title={job.notes} style={{ color: 'var(--text-4)' }}>{job.notes}</p>}
          {job.failureReason && (
            <p className="text-[9px]" style={{ color: 'var(--danger)' }}>Fail: {job.failureReason}</p>
          )}
        </div>
      ),
      accessor: job => `${job.customerName} ${job.pickupAddress} ${job.deliveryAddress}`,
      exportValue: job => job.customerName,
    },
    {
      key: 'rider', label: 'Rider', priority: 2, width: '140px',
      render: job => job.riderName ? (
        <p className="text-[10px] font-medium" style={{ color: 'var(--text-1)' }}>{job.riderName}</p>
      ) : job.status === 'pending' ? (
        <button className="text-[9px] px-2 py-0.5 rounded"
          style={{ background: 'var(--bg-surface)', color: 'var(--navy)', border: 'none', cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); setAssignTarget(job) }}>
          Assign Rider
        </button>
      ) : <span className="text-[10px]" style={{ color: 'var(--text-4)' }}>—</span>,
      exportValue: job => job.riderName || '',
    },
    {
      key: 'fee', label: 'Rider fee', priority: 3, width: '100px', align: 'right',
      render: job => (
        <button
          type="button"
          className="font-mono text-xs cursor-pointer underline-offset-2 hover:underline"
          style={{ color: 'var(--danger)', background: 'none', border: 'none', padding: 0 }}
          title="Edit rider fee"
          onClick={e => { e.stopPropagation(); setFeeTarget(job) }}
        >
          {fmtKes(job.riderFee)}
        </button>
      ),
      exportValue: job => job.riderFee,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '80px',
      render: job => <StatusBadge status={job.status} />,
      accessor: job => job.status,
      exportValue: job => job.status,
    },
  ]

  function jobRowActions(job: DeliveryJob) {
    const action = nextAction(job)
    return (
      <div className="flex flex-col gap-1">
        <button className="text-[9px] py-0.5 px-1.5 rounded cursor-pointer"
          style={{ background: 'var(--bg-muted)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
          title="Print Job Sheet"
          onClick={() => setPrintJob(job)}><Fa icon={faPrint} /> Print</button>
        {job.status === 'pending' && !job.riderId && (
          <button className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-surface)', color: 'var(--navy)', border: 'none', cursor: 'pointer' }}
            onClick={() => setAssignTarget(job)}>Assign</button>
        )}
        {!['cancelled'].includes(job.status) && (
          <button className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-muted)', color: 'var(--text-2)', border: '1px solid var(--border)', cursor: 'pointer' }}
            onClick={() => setFeeTarget(job)}>Edit fee</button>
        )}
        {action && (
          <button className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--success-bg)', color: 'var(--success-text)', border: 'none', cursor: 'pointer' }}
            onClick={() => advanceJobStatus(job.id, action.status)}>
            {action.label.replace('Mark ', '')}
          </button>
        )}
        {job.status === 'in_transit' && (
          <button className="text-[9px] py-0.5 px-1.5 rounded cursor-pointer"
            style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: 'none' }}
            onClick={() => setFailTarget(job)}>Failed</button>
        )}
        {['pending', 'cancelled'].includes(job.status) && (
          <button className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-surface)', color: 'var(--danger)', border: '1px solid var(--border)', cursor: 'pointer' }}
            onClick={() => deleteDeliveryJob(job.id)}>Del</button>
        )}
      </div>
    )
  }

  const jobStatusColors: Record<DeliveryJobStatus, string> = {
    pending: 'var(--warning)',
    assigned: 'var(--navy)',
    in_transit: 'var(--info)',
    delivered: 'var(--success)',
    failed: 'var(--danger)',
    cancelled: 'var(--text-4)',
  }

  const calendarItems = useMemo(() =>
    filtered.map(job => ({
      id: job.id,
      date: job.scheduledDate,
      title: `${job.ref} · ${job.customerName}`,
      color: jobStatusColors[job.status] ?? 'var(--navy)',
      onClick: () => {
        if (!job.riderId && (job.status === 'pending' || job.status === 'assigned')) {
          setAssignTarget(job)
          return
        }
        // Fall back to list so riders/status actions remain available.
        setJobsView('list')
        setFilterStatus(job.status)
      },
    })),
  [filtered])

  if (printJob) {
    return (
      <PrintJobSheet
        job={printJob}
        companySettings={companySettings || {}}
        onDone={() => setPrintJob(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap px-1">
        <div className="flex items-center gap-2 flex-wrap">
          {deliveryPrimaryFilters.map(f => (
            <div key={f.key} className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-4)] font-medium">{f.label}</span>
              <select
                className="form-input text-[11px] py-1 px-2"
                value={String(f.value)}
                onChange={e => f.onChange(e.target.value)}
                aria-label={f.label}
              >
                {f.options.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
          <button type="button" className="btn-primary text-xs" onClick={() => setShowCreateModal(true)}>
            + New Delivery Job
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {(['list', 'calendar'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setJobsView(v)}
              className="text-[11px] px-3 py-1.5 rounded-lg border font-medium capitalize cursor-pointer"
              style={{
                background: jobsView === v ? 'var(--navy)' : 'var(--bg-surface)',
                color: jobsView === v ? '#FFFFFF' : 'var(--text-3)',
                borderColor: jobsView === v ? 'var(--navy)' : 'var(--border-lt)',
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {jobsView === 'calendar' ? (
        <div className="card p-4">
          <p className="text-xs font-semibold text-[var(--text-2)] mb-3">
            Planned deliveries by scheduled date · click a job to assign a rider or jump to the list
          </p>
          <CalendarView items={calendarItems} />
        </div>
      ) : (
      <div className="card overflow-hidden">
        <DataTable
          tableId="delivery-jobs"
          columns={jobColumns}
          rows={filtered}
          rowKey={j => j.id}
          hideSearch
          primaryFilters={deliveryPrimaryFilters}
          onClearFilters={() => { setFilterStatus('all'); setFilterType('all') }}
          hideColumnFilters
          emptyMessage="No delivery jobs found"
          rowActions={jobRowActions}
          exportTitle="Delivery Jobs"
          exportFilename="delivery-jobs"
        />
      </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <JobModal
          onClose={() => setShowCreateModal(false)}
          repairs={repairs.map(r => ({ id: r.id, ref: r.ref, customerName: r.customerName, customerPhone: r.customerPhone }))}
          saleOrders={saleOrders.filter(so => so.status === 'sale' || so.status === 'quotation' || so.status === 'quotation_sent').map(so => ({ id: so.id, ref: so.ref, customerName: so.customerName }))}
          riders={riders}
          createDeliveryJob={createDeliveryJob}
          assignRiderToJob={assignRiderToJob}
          showToast={showToast}
        />
      )}
      {assignTarget && (
        <AssignModal
          job={assignTarget}
          riders={riders}
          onAssign={(riderId, fee) => assignRiderToJob(assignTarget.id, riderId, fee)}
          onClose={() => setAssignTarget(null)}
        />
      )}
      {feeTarget && (
        <EditFeeModal
          job={feeTarget}
          onSave={fee => {
            updateDeliveryJob(feeTarget.id, { riderFee: fee })
            showToast(`Rider fee updated to ${fmtKes(fee)}`)
          }}
          onClose={() => setFeeTarget(null)}
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
  const { riders, addRider, updateRider, deliveryJobs } = useDeliveryStore()

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '', phone: '', idNumber: '',
    vehicle: 'motorcycle' as Rider['vehicle'],
    vehicleReg: '',
    ratePerDelivery: '',
  })

  function set(k: string, v: string) { setForm(p => ({ ...p, [k]: v })) }

  function submit() {
    if (!form.name || !form.phone) return
    const rate = parseRiderFeeInput(form.ratePerDelivery)
    addRider({
      name: form.name, phone: form.phone, idNumber: form.idNumber,
      vehicle: form.vehicle, vehicleReg: form.vehicleReg || undefined,
      active: true,
      // Optional suggestion only — jobs still require their own fee.
      ratePerDelivery: rate ?? 0,
    })
    setForm({ name: '', phone: '', idNumber: '', vehicle: 'motorcycle', vehicleReg: '', ratePerDelivery: '' })
    setShowForm(false)
  }

  const riderColumns: ColumnDef<Rider>[] = [
    {
      key: 'name', label: 'Rider', priority: 1, width: '1fr',
      render: rider => <p className="text-xs font-semibold text-t1">{rider.name}</p>,
      accessor: rider => rider.name,
      exportValue: rider => rider.name,
    },
    {
      key: 'phone', label: 'Phone', priority: 1, width: '130px',
      render: rider => <span className="text-xs text-t2">{rider.phone}</span>,
      exportValue: rider => rider.phone,
    },
    {
      key: 'idNumber', label: 'ID number', priority: 3, width: '120px',
      render: rider => <span className="font-mono text-[10px] text-t3">{rider.idNumber || '—'}</span>,
      exportValue: rider => rider.idNumber || '',
    },
    {
      key: 'vehicle', label: 'Vehicle', priority: 2, width: '110px',
      render: rider => <span className="text-xs capitalize text-t2">{rider.vehicle}</span>,
      exportValue: rider => rider.vehicle,
    },
    {
      key: 'reg', label: 'Reg no.', priority: 3, width: '120px',
      render: rider => <span className="font-mono text-[10px] text-t3">{rider.vehicleReg || '—'}</span>,
      exportValue: rider => rider.vehicleReg || '',
    },
    {
      key: 'rate', label: 'Default rate', priority: 2, width: '110px', align: 'right',
      render: rider => (
        <input
          type="number"
          min="0"
          step="1"
          aria-label={`${rider.name} default rate`}
          className="form-input text-[11px] font-mono w-[88px] text-right"
          defaultValue={rider.ratePerDelivery || ''}
          placeholder="—"
          title="Optional default suggestion when creating jobs"
          onBlur={e => {
            const next = parseRiderFeeInput(e.target.value)
            updateRider(rider.id, { ratePerDelivery: next ?? 0 })
          }}
        />
      ),
      exportValue: rider => rider.ratePerDelivery,
    },
    {
      key: 'jobs', label: 'Total jobs', priority: 2, width: '90px', align: 'right',
      render: rider => {
        const jobCount = deliveryJobs.filter(j => j.riderId === rider.id && j.status === 'delivered').length
        return <span className="font-mono text-xs text-t2">{jobCount}</span>
      },
      exportValue: rider => deliveryJobs.filter(j => j.riderId === rider.id && j.status === 'delivered').length,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '80px',
      render: rider => (
        <button
          onClick={() => updateRider(rider.id, { active: !rider.active })}
          className="cursor-pointer"
          style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 600, border: 'none', background: rider.active ? 'var(--success-bg)' : 'var(--bg-muted)', color: rider.active ? 'var(--success-text)' : 'var(--text-4)' }}>
          {rider.active ? 'Active' : 'Inactive'}
        </button>
      ),
      accessor: rider => rider.active ? 'Active' : 'Inactive',
      exportValue: rider => rider.active ? 'Active' : 'Inactive',
    },
  ]

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
              <select aria-label="Rider vehicle" className="form-select text-xs w-full" value={form.vehicle}
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
              <p className="text-[10px] uppercase font-semibold mb-1 text-t4">Default rate (optional)</p>
              <input className="form-input text-xs w-full font-mono" type="number" min="0" step="1"
                value={form.ratePerDelivery}
                onChange={e => set('ratePerDelivery', e.target.value)}
                placeholder="Suggest only" />
            </div>
            <div className="flex items-end">
              <button className="btn-primary text-xs py-1.5 px-4" onClick={submit}>Save</button>
            </div>
          </div>
          <p className="text-[10px] text-t4">Default rate is only a suggestion when creating jobs. Each job still needs its own rider fee.</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <DataTable
          tableId="delivery-riders"
          columns={riderColumns}
          rows={riders}
          rowKey={r => r.id}
          searchPlaceholder="Search riders…"
          emptyMessage="No riders yet — add one above"
          exportTitle="Riders"
          exportFilename="delivery-riders"
        />
      </div>
    </div>
  )
}

// ── Weekly Pay Tab ─────────────────────────────────────────────────────────────
function WeeklyPayTab() {
  const { riders, deliveryJobs, riderWeeklyPays, generateWeeklyPay, markWeeklyPayPaid, companySettings, users, currentUserId } = useDeliveryStore()
  const currentUser = users.find(u => u.id === currentUserId)
  const canManagePay = ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')

  const [printPay, setPrintPay] = useState<RiderWeeklyPay | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)

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

  if (printPay) {
    return (
      <PrintPaySlip
        pay={printPay}
        companySettings={companySettings || {}}
        onDone={() => setPrintPay(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Week selector */}
      <div className="card p-4 flex items-center gap-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Week Starting (Monday)</p>
          <input type="date" aria-label="Week starting date" className="form-input text-xs" value={weekStart}
            onChange={e => setWeekStart(e.target.value)} style={{ width: 160 }} />
        </div>
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          Week: <strong>{fmtDate(weekStart)}</strong> — <strong>{fmtDate(weekEnd)}</strong>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <p className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-4)' }}>Rider:</p>
          <select aria-label="Filter pay statements by rider" className="form-select text-xs" value={selectedRiderId}
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
                    <span className="text-sm font-bold" style={{ color: 'var(--navy)' }}>{fmtKes(totalOwed)}</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {jobs.map(j => (
                      <div key={j.id} className="flex items-center justify-between text-[10px] py-1 border-b"
                        style={{ borderColor: 'var(--border-lt)' }}>
                        <div className="min-w-0">
                          <span className="font-mono font-bold" style={{ color: 'var(--navy)' }}>{j.ref}</span>
                          <span className="ml-2 truncate" style={{ color: 'var(--text-2)' }}>{j.customerName}</span>
                        </div>
                        <span className="font-mono ml-2 flex-shrink-0" style={{ color: 'var(--danger)' }}>{fmtKes(j.riderFee)}</span>
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
                  style={{ background: 'linear-gradient(135deg, var(--success), var(--success))' }}
                  onClick={() => setPendingConfirm({ msg: `Confirm payment of ${fmtKes(existingPay.totalAmount)} to ${existingPay.riderName}? An accounting vendor bill will be created automatically.`, action: () => markWeeklyPayPaid(existingPay.id) })}>
                  Confirm Payment — {fmtKes(existingPay.totalAmount)}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pay history */}
      {riderWeeklyPays.length > 0 && (() => {
        const payRows = [...riderWeeklyPays].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        const payColumns: ColumnDef<RiderWeeklyPay>[] = [
          {
            key: 'ref', label: 'Ref', priority: 1, width: '90px',
            render: pay => <span className="font-mono text-[10px] font-bold text-brand-navy">{pay.ref}</span>,
            accessor: pay => pay.ref,
            exportValue: pay => pay.ref,
          },
          {
            key: 'rider', label: 'Rider', priority: 1, width: '1fr',
            render: pay => <span className="text-xs text-t1">{pay.riderName}</span>,
            exportValue: pay => pay.riderName,
          },
          {
            key: 'week', label: 'Week', priority: 2, width: '130px',
            render: pay => (
              <span className="text-[10px] text-t3">{fmtDate(pay.weekStart)} – {fmtDate(pay.weekEnd)}</span>
            ),
            exportValue: pay => `${pay.weekStart} – ${pay.weekEnd}`,
          },
          {
            key: 'jobs', label: 'Jobs', priority: 3, width: '60px', align: 'right',
            render: pay => <span className="font-mono text-xs">{pay.deliveryCount}</span>,
            exportValue: pay => pay.deliveryCount,
          },
          {
            key: 'rate', label: 'Rate', priority: 3, width: '80px', align: 'right',
            render: pay => <span className="font-mono text-xs text-t3">{fmtKes(pay.ratePerDelivery)}</span>,
            exportValue: pay => pay.ratePerDelivery,
          },
          {
            key: 'total', label: 'Total', priority: 1, width: '100px', align: 'right',
            render: pay => <span className="font-mono text-xs font-bold text-brand-navy">{fmtKes(pay.totalAmount)}</span>,
            exportValue: pay => pay.totalAmount,
          },
          {
            key: 'status', label: 'Status', priority: 1, width: '80px',
            render: pay => (
              <span className={`badge ${pay.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>
                {pay.status === 'paid' ? 'Paid' : 'Pending'}
              </span>
            ),
            accessor: pay => pay.status,
            exportValue: pay => pay.status,
          },
          {
            key: 'paidBy', label: 'Paid by', priority: 3, width: '80px',
            render: pay => <span className="text-[10px] text-t3">{pay.paidByName || '—'}</span>,
            exportValue: pay => pay.paidByName || '',
          },
          {
            key: 'invoice', label: 'Invoice', priority: 2, width: '100px',
            render: pay => pay.invoiceRef ? (
              <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'var(--primary-light)', color: 'var(--info-text)' }}>
                {pay.invoiceRef}
              </span>
            ) : <span className="text-[10px] text-t4">—</span>,
            exportValue: pay => pay.invoiceRef || '',
          },
        ]
        return (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-lt)]">
              <p className="text-xs font-semibold text-t1">Pay History</p>
            </div>
            <DataTable
              tableId="delivery-weekly-pay"
              columns={payColumns}
              rows={payRows}
              rowKey={p => p.id}
              hideSearch
              emptyMessage="No pay history"
              rowActions={pay => (
                <button className="btn-outline text-[10px] py-0.5 px-2" onClick={() => setPrintPay(pay)} title="Print Pay Statement" aria-label="Print Pay Statement">
                  <Fa icon={faPrint} />
                </button>
              )}
              exportTitle="Rider Weekly Pay"
              exportFilename="rider-weekly-pay"
            />
          </div>
        )
      })()}
      {pendingConfirm && (
        <Confirm
          message={pendingConfirm.msg}
          confirmLabel="Confirm Payment"
          onConfirm={() => { pendingConfirm.action(); setPendingConfirm(null) }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  )
}

// ── Root Component ─────────────────────────────────────────────────────────────
export default function Delivery() {
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  useEffect(() => { setMounted(true) }, [])

  const { deliveryJobs, riderWeeklyPays } = useDeliveryStore()
  const [tab, setTab] = useState<MainTab>('jobs')

  const pendingPay = riderWeeklyPays.filter(p => p.status === 'pending').length

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page">
      <ModuleHeader
        title="Delivery"
        subtitle="Pickups, deliveries and rider management"
        icon={<Fa icon={faTruck} />}
        count={deliveryJobs.length}
        color="var(--success)"
      />

      <TabBar
        tabs={[
          { id: 'jobs', label: `Jobs (${deliveryJobs.length})` },
          { id: 'riders', label: 'Riders' },
          { id: 'weekly_pay', label: pendingPay > 0 ? `Weekly pay (${pendingPay})` : 'Weekly pay' },
        ]}
        active={tab}
        onChange={id => setTab(id as MainTab)}
        maxVisibleDesktop={6}
        ariaLabel="Delivery sections"
      />

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">
        {tab === 'jobs'       && <JobsTab />}
        {tab === 'riders'     && <RidersTab />}
        {tab === 'weekly_pay' && <WeeklyPayTab />}
      </div>
    </div>
  )
}
