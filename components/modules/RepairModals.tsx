'use client'

import { useState } from 'react'
import { useApp, RepairOrder } from '@/lib/store'
import { Modal, Field, Input, Select, Textarea } from '@/components/ui'

export function AssignTechnicianModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { users, currentUserId, assignTechnicianToRepair } = useApp()
  const technicians = users.filter(u => ['repair_tech', 'lead_tech'].includes(u.role))
  const isReassign = !!repair.assignedTechnicianName

  return (
    <Modal title={isReassign ? 'Reassign Technician' : 'Assign Technician'} onClose={onClose} width={400}>
      {isReassign && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2"
          style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>
          <span>⚠️</span>
          <span>Currently assigned to <strong>{repair.assignedTechnicianName}</strong>. Selecting another will reassign.</span>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {[...technicians]
          .sort((a, b) => a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0)
          .map(tech => {
            const isMe = tech.id === currentUserId
            const isCurrent = tech.id === repair.assignedTechnicianId
            return (
              <button key={tech.id}
                onClick={() => { assignTechnicianToRepair(repair.id, tech.id); onClose() }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs text-left transition-all"
                style={{
                  border: `1px solid ${isCurrent ? '#A8D4E8' : '#E5E7EB'}`,
                  background: isCurrent ? '#E8F3FA' : '#F9FAFB',
                  cursor: 'pointer',
                }}
                onMouseOver={e => { if (!isCurrent) { (e.currentTarget as HTMLElement).style.background = isMe ? '#F0FDF4' : '#E8F3FA'; (e.currentTarget as HTMLElement).style.borderColor = isMe ? '#A7F3D0' : '#A8D4E8' } }}
                onMouseOut={e => { if (!isCurrent) { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; (e.currentTarget as HTMLElement).style.borderColor = '#E5E7EB' } }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                  style={{ background: isMe ? 'linear-gradient(135deg, #059669, #34D399)' : 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
                  {tech.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-t1">{tech.name}</p>
                  <p className="text-[10px] text-t3 capitalize">{tech.role.replace('_', ' ')}{isMe ? ' — you' : ''}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {isMe && <span className="badge text-[9px]" style={{ background: '#D1FAE5', color: '#065F46' }}>Me</span>}
                  {isCurrent && <span className="badge text-[9px]" style={{ background: '#DBEAFE', color: '#1E40AF' }}>Current</span>}
                </div>
              </button>
            )
          })}
      </div>
    </Modal>
  )
}

export function LogDiagnosisModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { logDiagnosis, updateRepair, showToast } = useApp()
  const [diagForm, setDiagForm] = useState({
    findings: '', faultDescription: '', recommendedAction: '', estimatedHours: '2',
    clientCausedDamage: false, clientDamageReason: '',
  })

  const handleLogDiagnosis = () => {
    if (!diagForm.findings || !diagForm.faultDescription) {
      showToast('Findings and fault description are required', 'error'); return
    }
    if (diagForm.clientCausedDamage && !diagForm.clientDamageReason) {
      showToast('Please select the type of client-caused damage', 'error'); return
    }
    logDiagnosis(repair.id, {
      findings: diagForm.findings, faultDescription: diagForm.faultDescription,
      recommendedAction: diagForm.recommendedAction,
      estimatedHours: Number(diagForm.estimatedHours) || 0,
    })
    if (diagForm.clientCausedDamage) {
      updateRepair(repair.id, {
        clientCausedDamage: true,
        clientDamageReason: diagForm.clientDamageReason || undefined,
        underWarranty: false,
      })
    }
    onClose()
  }

  return (
    <Modal title="Log Diagnosis" onClose={onClose} width={520}>
      <Field label="Findings" required>
        <Textarea value={diagForm.findings} onChange={v => setDiagForm(p => ({ ...p, findings: v }))} placeholder="What was found during inspection..." rows={3} />
      </Field>
      <Field label="Fault Description" required>
        <Textarea value={diagForm.faultDescription} onChange={v => setDiagForm(p => ({ ...p, faultDescription: v }))} placeholder="Technical description of the fault..." rows={2} />
      </Field>
      <Field label="Recommended Action">
        <Textarea value={diagForm.recommendedAction} onChange={v => setDiagForm(p => ({ ...p, recommendedAction: v }))} placeholder="What needs to be done to fix the issue..." rows={2} />
      </Field>
      <Field label="Estimated Labour Hours">
        <Input value={diagForm.estimatedHours} onChange={v => setDiagForm(p => ({ ...p, estimatedHours: v }))} type="number" />
      </Field>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E5E7EB' }}>
        <div className="px-3 py-2" style={{ background: '#F9FAFB', borderBottom: diagForm.clientCausedDamage ? '1px solid #FCD34D' : undefined }}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 flex-shrink-0" checked={diagForm.clientCausedDamage} onChange={e => setDiagForm(p => ({ ...p, clientCausedDamage: e.target.checked, clientDamageReason: '' }))} />
            <div>
              <p className="text-[11px] font-semibold text-t1">Client-caused damage detected</p>
              <p className="text-[10px] text-t3">
                {repair.underWarranty ? 'Device is under warranty — checking this will void it and charge the client.' : 'Damage caused by customer misuse (e.g. water spillage, drop). Client will be charged.'}
              </p>
            </div>
            {repair.underWarranty && !diagForm.clientCausedDamage && (
              <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: '#ECFDF5', color: '#065F46', border: '1px solid #6EE7B7' }}>WARRANTY ACTIVE</span>
            )}
          </label>
        </div>
        {diagForm.clientCausedDamage && (
          <div className="px-3 py-2.5 flex flex-col gap-2" style={{ background: '#FFFBEB' }}>
            <p className="text-[10px] font-medium" style={{ color: '#92400E' }}>Type of damage found</p>
            <select className="form-input w-full text-[11px] py-1" value={diagForm.clientDamageReason} onChange={e => setDiagForm(p => ({ ...p, clientDamageReason: e.target.value }))}>
              <option value="">— Select damage type —</option>
              <option value="Water/liquid spillage">Water / liquid spillage</option>
              <option value="Physical drop/impact damage">Physical drop / impact damage</option>
              <option value="Unauthorized repair attempt">Unauthorized repair attempt</option>
              <option value="Fire/heat/power surge damage">Fire / heat / power surge</option>
              <option value="Intentional damage">Intentional damage</option>
              <option value="Pest/rodent damage">Pest / rodent damage</option>
              <option value="Other client-caused damage">Other client-caused damage</option>
            </select>
            {repair.underWarranty && (
              <p className="text-[10px] font-semibold" style={{ color: '#DC2626' }}>⚠ Warranty will be voided — client becomes responsible for all repair costs.</p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2 justify-end mt-4">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleLogDiagnosis}>Save Diagnosis</button>
      </div>
    </Modal>
  )
}

type QuoteLine = { type: 'part' | 'labor' | 'logistics' | 'software' | 'license' | 'service'; description: string; qty: string; unitPrice: string }
const DEFAULT_LINES: QuoteLine[] = [{ type: 'labor', description: 'Labour & Service Charge', qty: '1', unitPrice: '5000' }]

export function QuoteModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { generateRepairQuote, companySettings } = useApp()
  const [applyVat, setApplyVat] = useState(repair.quote ? repair.quote.tax > 0 : true)
  const [quoteLines, setQuoteLines] = useState<QuoteLine[]>(() => {
    if (repair.quote) return repair.quote.lines.map(l => ({ type: l.type as any, description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice) }))
    return DEFAULT_LINES
  })

  const handleGenerateQuote = () => {
    const lines = quoteLines.map(line => {
      const qty = Number(line.qty) || 1
      const unitPrice = Number(line.unitPrice) || 0
      return { type: line.type, description: line.description, qty, unitPrice, subtotal: qty * unitPrice }
    })
    generateRepairQuote(repair.id, lines as any, applyVat)
    onClose()
  }

  return (
    <Modal title={repair.quote ? 'Update Quote' : 'Generate Quote'} subtitle={repair.ref} onClose={onClose} width={640}>
      <div className="overflow-x-auto w-full">
        <div className="min-w-[500px] flex flex-col gap-2 pb-2">
          <div className="grid gap-2 px-1" style={{ gridTemplateColumns: '120px 1fr 70px 110px 28px' }}>
            <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>TYPE</span>
            <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>DESCRIPTION</span>
            <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>QTY</span>
            <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>UNIT PRICE</span>
            <span />
          </div>
          {quoteLines.map((line, i) => (
            <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: '120px 1fr 70px 110px 28px' }}>
              <select className="form-input" style={{ fontSize: 12 }} value={line.type} onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, type: e.target.value as QuoteLine['type'] } : l))}>
                <option value="part">Part</option>
                <option value="labor">Labour</option>
                <option value="software">Software</option>
                <option value="license">License</option>
                <option value="logistics">Logistics</option>
                <option value="service">Service</option>
              </select>
              <input className="form-input" placeholder="Description" value={line.description} onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, description: e.target.value } : l))} />
              <input className="form-input" type="number" placeholder="1" value={line.qty} onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))} />
              <input className="form-input" type="number" placeholder="0" value={line.unitPrice} onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, unitPrice: e.target.value } : l))} />
              <button onClick={() => setQuoteLines(prev => prev.filter((_, j) => j !== i))} style={{ background: '#FEE2E2', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#EF4444', fontSize: 14, height: 32 }}>×</button>
            </div>
          ))}
          <div className="flex items-center justify-between mt-1">
            <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => setQuoteLines(prev => [...prev, { type: 'part', description: '', qty: '1', unitPrice: '0' }])}>
              + Add Line
            </button>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
              <input type="checkbox" checked={applyVat} onChange={e => setApplyVat(e.target.checked)} />
              Apply VAT ({companySettings.vatRate}%)
            </label>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
              Total: KES {quoteLines.reduce((s, l) => s + (Number(l.qty) || 1) * (Number(l.unitPrice) || 0), 0).toLocaleString()}
            </span>
          </div>
          </div>
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-3">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleGenerateQuote}>
          {repair.quote ? '✏️ Update & Resend to Customer' : 'Generate Quote'}
        </button>
      </div>
    </Modal>
  )
}

export function QAModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { completeRepairQA } = useApp()
  const [qcItems, setQcItems] = useState(repair.qcItems)

  const handleCompleteQA = () => {
    const qaResults = qcItems.map(item => ({ itemId: item.id, passed: item.passed, notes: item.notes }))
    completeRepairQA(repair.id, qaResults)
    onClose()
  }

  return (
    <Modal title="Complete QA Checklist" onClose={onClose} width={460}>
      {qcItems.length === 0 ? (
        <p className="text-xs text-t3 text-center py-4">Adding default QA checklist… please wait a moment and reopen.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {qcItems.map(item => (
            <label key={item.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer" style={{ border: '1px solid #E5E7EB', background: item.passed ? '#F0FDF4' : '#F9FAFB' }}>
              <input type="checkbox" checked={item.passed} style={{ accentColor: '#10B981' }}
                onChange={e => setQcItems(prev => prev.map(qi => qi.id === item.id ? { ...qi, passed: e.target.checked } : qi))} />
              <span className="text-xs text-t1">{item.description}</span>
            </label>
          ))}
          <p className="text-[10px] text-t3 mt-1">
            {qcItems.every(i => i.passed) ? '✓ All items passed — device will move to Ready' : '⚠ Some items failed — repair will require rework'}
          </p>
        </div>
      )}
      <div className="flex gap-2 justify-end mt-4">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        {qcItems.length > 0 && (
          <button className="btn-primary" onClick={handleCompleteQA}>
            {qcItems.every(i => i.passed) ? '✓ Pass QA' : '✗ Submit (Rework Required)'}
          </button>
        )}
      </div>
    </Modal>
  )
}

export function ScheduleDeliveryModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { riders, scheduleDelivery } = useApp()
  const [deliveryForm, setDeliveryForm] = useState({
    method: 'pickup' as 'pickup' | 'delivery' | 'courier', scheduledDate: new Date().toISOString().slice(0, 10), address: '', riderId: '', riderName: '',
  })

  return (
    <Modal title="Schedule Delivery" onClose={onClose} width={420}>
      <Field label="Delivery Method">
        <Select value={deliveryForm.method} onChange={v => setDeliveryForm(p => ({ ...p, method: v as any }))} options={[{ value: 'pickup', label: 'Customer Pickup' }, { value: 'delivery', label: 'Home Delivery' }, { value: 'courier', label: 'Courier Service' }]} />
      </Field>
      <Field label="Scheduled Date">
        <input className="form-input" type="date" value={deliveryForm.scheduledDate} onChange={e => setDeliveryForm(p => ({ ...p, scheduledDate: e.target.value }))} />
      </Field>
      {deliveryForm.method !== 'pickup' && (
        <Field label="Delivery Address"><Textarea value={deliveryForm.address} onChange={v => setDeliveryForm(p => ({ ...p, address: v }))} rows={2} /></Field>
      )}
      {deliveryForm.method === 'delivery' && (
        <Field label="Delivery Person">
          <Select value={deliveryForm.riderId}
            onChange={v => { const rider = riders.find(r => r.id === v); setDeliveryForm(p => ({ ...p, riderId: v, riderName: rider?.name ?? '' })) }}
            options={[{ value: '', label: '— Select rider —' }, ...riders.filter(r => r.active).map(r => ({ value: r.id, label: `${r.name} (${r.vehicle})` }))]} />
        </Field>
      )}
      <div className="flex gap-2 justify-end">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => { scheduleDelivery(repair.id, deliveryForm.method, deliveryForm.scheduledDate, deliveryForm.address, deliveryForm.riderId || undefined, deliveryForm.riderName || undefined); onClose() }}>Schedule</button>
      </div>
    </Modal>
  )
}

export function DeclineQuoteModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { approveRepairQuote } = useApp()
  const [declineReason, setDeclineReason] = useState('')
  return (
    <Modal title="Decline Repair Quote" onClose={onClose} width={440}>
      <div className="p-3 rounded-lg mb-3 text-xs" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>Declining will cancel this repair. The customer will be notified and the device prepared for return.</div>
      <Field label="Reason for declining"><Textarea value={declineReason} onChange={v => setDeclineReason(v)} rows={3} placeholder="e.g. Cost too high, customer changed mind..." /></Field>
      <div className="flex gap-2 justify-end">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ background: '#DC2626' }} onClick={() => { approveRepairQuote(repair.id, false, declineReason || 'Quote declined'); onClose() }}>Confirm Decline</button>
      </div>
    </Modal>
  )
}

export function ConfirmDeliveryModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { deliverRepair } = useApp()
  return (
    <Modal title="Confirm Delivery" onClose={onClose} width={400}>
      <p className="text-xs text-t2 mb-4">Confirm that <strong>{repair.productName}</strong> has been successfully delivered/collected by <strong>{repair.customerName}</strong>.</p>
      <div className="flex gap-2 justify-end">
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ background: '#0D9488' }} onClick={() => { deliverRepair(repair.id, repair.customerName, repair.customerPhone); onClose() }}>✓ Confirm Delivery</button>
      </div>
    </Modal>
  )
}

export function MarkUnrepairableModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { markUnrepairable, showToast } = useApp()
  const [returnReason, setReturnReason] = useState('')
  return (
    <Modal title="Mark as Unrepairable" onClose={onClose} width={500}>
      <div className="mb-4 p-3 rounded text-xs" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>⚠️ This will mark the device as unrepairable and notify the customer for return pickup.</div>
      <Field label="Reason (will be sent to customer)" required><Textarea value={returnReason} onChange={v => setReturnReason(v)} rows={4} placeholder="e.g., Motherboard damage beyond repair..." /></Field>
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="btn-outline">Cancel</button>
        <button onClick={() => { if (!returnReason) { showToast('Please provide a reason', 'error'); return }; markUnrepairable(repair.id, returnReason); onClose() }} style={{ padding: '8px 18px', borderRadius: 8, background: '#991B1B', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Mark as Unrepairable</button>
      </div>
    </Modal>
  )
}