'use client'

import { useState, useMemo } from 'react'
import {
  useApp, fmtKes, fmtDate,
  DeliveryJob, DeliveryJobType, DeliveryJobStatus, Rider, RiderWeeklyPay,
} from '@/lib/store'

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
const badgeClass = `badge text-[9px] ${status === 'pending' ? 'badge-warning' : status === 'assigned' ? 'badge-info' : status === 'in_transit' ? 'badge-primary' : status === 'delivered' ? 'badge-success' : status === 'failed' ? 'badge-error' : 'badge-secondary'}`
  return <span className={badgeClass}>{labelMap[status]}</span>
}

function TypeBadge({ type }: { type: DeliveryJobType }) {
  const badgeClass = type === 'repair_pickup' ? 'badge-warning text-[9px]' : type === 'repair_dropoff' ? 'badge-info text-[9px]' : 'badge-primary text-[9px]'
  return <span className={badgeClass}>{JOB_TYPE_LABELS[type]}</span>
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
    <div className="modal modal-open modal-middle">
      <div className="modal-box max-w-xl mx-auto">
        <h3 className="text-lg font-bold text-text-1">New Delivery Job</h3>
        <button onClick={onClose} className="btn btn-ghost btn-xs btn-square absolute right-2 top-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="space-y-4 py-4">
          {/* Type */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wide mb-2 block text-text-4">Job Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(JOB_TYPE_LABELS) as DeliveryJobType[]).map(t => (
                <button key={t}
                  onClick={() => set('type', t)}
                  className={`btn btn-xs ${form.type === t ? 'btn-primary' : 'btn-ghost'}`}>
                  {JOB_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Source link — repair_dropoff only */}
          {form.type === 'repair_dropoff' ? (
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Link to Repair Order</p>
              <select className="form-select text-xs w-full"
                value={form.repairOrderId}
                onChange={e => handleSourceChange(form.type, e.target.value)}>
                <option value="">— Select repair order —</option>
                {repairs.map(r => (
                  <option key={r.id} value={r.id}>{r.ref} · {r.customerName}</option>
                ))}
              </select>
            </div>
          ) : form.type === 'sales_delivery' ? (
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Link to Sale Order</p>
              <select className="form-select text-xs w-full"
                value={form.saleOrderId}
                onChange={e => handleSourceChange(form.type, e.target.value)}>
                <option value="">— Select sale order —</option>
                {saleOrders.map(s => (
                  <option key={s.id} value={s.id}>{s.ref} · {s.customerName}</option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Customer */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Customer Name</p>
              <input className="form-input text-xs w-full" value={form.customerName}
                onChange={e => set('customerName', e.target.value)} placeholder="Customer / recipient" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Phone</p>
              <input className="form-input text-xs w-full" value={form.customerPhone}
                onChange={e => set('customerPhone', e.target.value)} placeholder="+254..." />
            </div>
          </div>

          {/* Addresses */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>
                {form.type === 'repair_pickup' ? 'Collect From (Customer)' : form.type === 'repair_dropoff' ? 'Collect From (Shop)' : 'Pickup Address'}
              </p>
              <input className="form-input text-xs w-full" value={form.pickupAddress}
                onChange={e => set('pickupAddress', e.target.value)} placeholder="Where to collect from" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>
                {form.type === 'repair_pickup' ? 'Deliver To (Shop)' : form.type === 'repair_dropoff' ? 'Deliver To (Customer)' : 'Delivery Address'}
              </p>
              <input className="form-input text-xs w-full" value={form.deliveryAddress}
                onChange={e => set('deliveryAddress', e.target.value)} placeholder="Where to deliver to" />
            </div>
          </div>

          {/* Schedule + rider */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Scheduled Date</p>
              <input type="date" className="form-input text-xs w-full" value={form.scheduledDate}
                onChange={e => set('scheduledDate', e.target.value)} />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Assign Rider</p>
              <select className="form-select text-xs w-full" value={form.riderId}
                onChange={e => handleRiderChange(e.target.value)}>
                <option value="">— Assign later —</option>
                {riders.filter(r => r.active).map(r => (
                  <option key={r.id} value={r.id}>{r.name} · {r.vehicle}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>
                Rider Fee <span className="ml-1 font-normal">(KES)</span>
              </p>
              <input type="number" className="form-input text-xs w-full" value={form.riderFee}
                onChange={e => set('riderFee', e.target.value)} placeholder="150" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Notes / Instructions</p>
            <textarea className="form-input text-xs w-full" rows={2} value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Special instructions, fragile items, gate code, etc." />
          </div>
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border-lt)' }}>
          <button className="btn-secondary text-xs" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-xs" onClick={submit}>Create Job</button>
        </div>
      </div>
    </div>
  )
}

// ── Assign Rider Modal ─────────────────────────────────────────────────────────
function AssignModal({
  job, riders, onAssign, onClose,
}: {
  job: DeliveryJob
  riders: Rider[]
  onAssign: (riderId: string) => void
  onClose: () => void
}) {
  const [riderId, setRiderId] = useState(job.riderId ?? '')
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 400, background: 'rgba(0,0,0,0.45)' }}>
      <div className="card w-80 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-lt)' }}>
          <p className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Assign Rider — {job.ref}</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-3)' }}>×</button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <p className="text-[10px] uppercase font-semibold mb-1" style={{ color: 'var(--text-4)' }}>Select Rider</p>
            <select className="form-select text-xs w-full" value={riderId} onChange={e => setRiderId(e.target.value)}>
              <option value="">— Select —</option>
              {riders.filter(r => r.active).map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.vehicle} · KES {r.ratePerDelivery}/delivery
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary text-xs" onClick={onClose}>Cancel</button>
            <button className="btn-primary text-xs" onClick={() => { if (riderId) { onAssign(riderId); onClose() } }}>
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Failure Reason Modal ───────────────────────────────────────────────────────
function FailModal({ onConfirm, onClose }: { onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 400, background: 'rgba(0,0,0,0.45)' }}>
      <div className="card w-80 overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-lt)' }}>
          <p className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Mark as Failed</p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <textarea className="form-input text-xs w-full" rows={3} value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason for failed delivery (customer not home, wrong address, etc.)" />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary text-xs" onClick={onClose}>Cancel</button>
            <button className="btn-primary text-xs" style={{ background: '#EF4444' }}
              onClick={() => { onConfirm(reason); onClose() }}>Confirm Failed</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Jobs Tab ───────────────────────────────────────────────────────────────────
function JobsTab() {
  const {
    deliveryJobs, riders, repairs, saleOrders,
    createDeliveryJob, assignRiderToJob, advanceJobStatus, deleteDeliveryJob,
    showToast,
  } = useApp()

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
        <div className="table-head min-w-[700px]" style={{ gridTemplateColumns: '90px 90px 110px 1fr 140px 100px 80px 60px' }}>
          <span>Ref</span><span>Date</span><span>Type</span><span>Customer / Route</span>
          <span>Rider</span><span className="text-right">Rider Fee</span>
          <span>Status</span><span></span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-10 text-center text-xs text-t4 min-w-[700px]">
            No delivery jobs found
          </div>
        ) : filtered.map(job => {
          const action = nextAction(job)
          return (
            <div key={job.id} className="table-row items-start min-w-[700px]"
              style={{ gridTemplateColumns: '90px 90px 110px 1fr 140px 100px 80px 60px' }}>
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
                  <button className="btn text-[9px] py-0.5 px-1.5 rounded"
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
              <input className="form-input text-xs w-full" value={form.phone}
                onChange={e => set('phone', e.target.value)} placeholder="+254 7..." />
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
                    className={`badge cursor-pointer border-none ${rider.active ? 'badge-success' : 'badge-secondary'}`}>
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
  const { riders, deliveryJobs, riderWeeklyPays, generateWeeklyPay, markWeeklyPayPaid } = useApp()

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
              {!existingPay && jobs.length > 0 && (
                <button className="btn-primary text-xs py-1"
                  onClick={() => generateWeeklyPay(rider.id, weekStart)}>
                  Generate Pay
                </button>
              )}
              {existingPay && existingPay.status === 'pending' && (
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
            <div className="table-head min-w-[780px]" style={{ gridTemplateColumns: '90px 1fr 130px 60px 80px 100px 80px 80px 100px' }}>
              <span>Ref</span><span>Rider</span><span>Week</span>
              <span className="text-right">Jobs</span>
              <span className="text-right">Rate</span>
              <span className="text-right">Total</span>
              <span>Status</span><span>Paid By</span><span>Invoice</span>
            </div>
            {[...riderWeeklyPays].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(pay => (
              <div key={pay.id} className="table-row min-w-[780px]"
                style={{ gridTemplateColumns: '90px 1fr 130px 60px 80px 100px 80px 80px 100px' }}>
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
  const { deliveryJobs, riderWeeklyPays } = useApp()
  const [tab, setTab] = useState<MainTab>('jobs')

  const pendingPay = riderWeeklyPays.filter(p => p.status === 'pending').length

  return (
    <div className="flex flex-col gap-4 py-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-t1">Delivery</p>
          <p className="text-[10px] text-t3">
            Repair pickups &amp; drop-offs · Sales deliveries · Rider management
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {([
          { key: 'jobs',       label: `Jobs (${deliveryJobs.length})` },
          { key: 'riders',     label: 'Riders' },
          { key: 'weekly_pay', label: `Weekly Pay${pendingPay > 0 ? ` · ${pendingPay} pending` : ''}` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-xs font-medium transition-all rounded-lg cursor-pointer px-3.5 py-1.5 border ${
              tab === t.key
                ? 'bg-[#E8F3FA] border-[#A8D4E8] text-brand-navy font-semibold'
                : 'bg-transparent border-transparent text-t3 hover:text-t1'
            }`}>
            {t.label}
            {t.key === 'weekly_pay' && pendingPay > 0 && (
              <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white bg-amber-400">
                {pendingPay}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'jobs'       && <JobsTab />}
      {tab === 'riders'     && <RidersTab />}
      {tab === 'weekly_pay' && <WeeklyPayTab />}
    </div>
  )
}
