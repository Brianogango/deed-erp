'use client'

import { useState } from 'react'
import { useApp, RepairOrder } from '@/lib/store'
import { Modal, Field, Input, Select, Textarea } from '@/components/ui'
import { Fa } from '@/components/icons'
import { 
  faUserGear, 
  faStethoscope, 
  faFileInvoiceDollar, 
  faCheckCircle, 
  faTruck, 
  faTools, 
  faExclamationTriangle,
  faPlay,
  faHistory,
  faCartPlus,
  faUndo,
  faTimesCircle
} from '@fortawesome/free-solid-svg-icons'

/**
 * AssignTechnicianModal
 */
export function AssignTechnicianModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { users, currentUserId, assignTechnicianToRepair } = useApp()
  const technicians = users.filter(u => ['technician', 'technical_lead'].includes(u.role))
  const isReassign = !!repair.assignedTechnicianName

  return (
    <Modal 
      title={isReassign ? 'Reassign Technician' : 'Assign Technician'} 
      subtitle={`Job Reference: ${repair.ref}`}
      onClose={onClose} 
      width={440}
    >
      <div className="flex flex-col gap-4">
        {isReassign && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800">
            <Fa icon={faExclamationTriangle} className="mt-0.5 text-amber-500" />
            <p className="text-[11px] leading-relaxed">
              Currently assigned to <span className="font-bold">{repair.assignedTechnicianName}</span>. 
              Changing this will transfer all technical responsibility for this job.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
          {[...technicians]
            .sort((a, b) => a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0)
            .map(tech => {
              const isMe = tech.id === currentUserId
              const isCurrent = tech.id === repair.assignedTechnicianId
              return (
                <button 
                  key={tech.id}
                  onClick={() => { assignTechnicianToRepair(repair.id, tech.id); onClose() }}
                  className={`flex items-center gap-4 p-3 rounded-2xl border transition-all text-left group active:scale-[0.98] ${
                    isCurrent 
                      ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-100' 
                      : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm transition-transform group-hover:scale-110 ${
                    isMe ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-slate-700 to-slate-800'
                  }`}>
                    {tech.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 text-xs">{tech.name}</p>
                    <p className="text-[10px] text-slate-500 font-medium capitalize mt-0.5">
                      {tech.role.replace('_', ' ')}{isMe ? ' (You)' : ''}
                    </p>
                  </div>
                  {isCurrent && (
                    <div className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[9px] font-bold border border-blue-200">
                      CURRENT
                    </div>
                  )}
                </button>
              )
            })}
        </div>
      </div>
    </Modal>
  )
}

/**
 * LogDiagnosisModal
 */
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
    <Modal title="Log Diagnosis" subtitle={repair.ref} onClose={onClose} width={560}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4">
          <Field label="Technical Findings" required hint="What was discovered during physical inspection?">
            <Textarea 
              value={diagForm.findings} 
              onChange={v => setDiagForm(p => ({ ...p, findings: v }))} 
              placeholder="e.g. Blown capacitor on power board, liquid damage on trackpad connector..." 
              rows={3} 
            />
          </Field>
          
          <Field label="Fault Description" required hint="The core issue needing repair">
            <Input 
              value={diagForm.faultDescription} 
              onChange={v => setDiagForm(p => ({ ...p, faultDescription: v }))} 
              placeholder="e.g. Mainboard Power Failure" 
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Recommended Action">
              <Input 
                value={diagForm.recommendedAction} 
                onChange={v => setDiagForm(p => ({ ...p, recommendedAction: v }))} 
                placeholder="e.g. Component level repair" 
              />
            </Field>
            <Field label="Est. Labour Hours">
              <Input 
                value={diagForm.estimatedHours} 
                onChange={v => setDiagForm(p => ({ ...p, estimatedHours: v }))} 
                type="number" 
              />
            </Field>
          </div>
        </div>

        {/* Client Caused Damage Toggle */}
        <div className={`rounded-2xl overflow-hidden border transition-all ${diagForm.clientCausedDamage ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="p-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="mt-1">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 transition-all" 
                  checked={diagForm.clientCausedDamage} 
                  onChange={e => setDiagForm(p => ({ ...p, clientCausedDamage: e.target.checked, clientDamageReason: '' }))} 
                />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold text-slate-900 group-hover:text-amber-700 transition-colors">Client-caused damage detected</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  {repair.underWarranty 
                    ? 'Device is under warranty — checking this will void it and charge the client.' 
                    : 'Damage caused by customer misuse (e.g. liquid spill, drop). Client will be charged.'}
                </p>
              </div>
            </label>
          </div>
          
          {diagForm.clientCausedDamage && (
            <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-200">
              <div className="p-3 rounded-xl bg-white border border-amber-200 shadow-sm space-y-3">
                <Field label="Damage Category">
                  <select 
                    className="form-input text-xs font-medium" 
                    value={diagForm.clientDamageReason} 
                    onChange={e => setDiagForm(p => ({ ...p, clientDamageReason: e.target.value }))}
                  >
                    <option value="">— Select damage type —</option>
                    <option value="Water/liquid spillage">Water / liquid spillage</option>
                    <option value="Physical drop/impact damage">Physical drop / impact damage</option>
                    <option value="Unauthorized repair attempt">Unauthorized repair attempt</option>
                    <option value="Fire/heat/power surge damage">Fire / heat / power surge</option>
                    <option value="Intentional damage">Intentional damage</option>
                    <option value="Pest/rodent damage">Pest / rodent damage</option>
                    <option value="Other client-caused damage">Other client-caused damage</option>
                  </select>
                </Field>
                {repair.underWarranty && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 text-red-700 border border-red-100">
                    <Fa icon={faExclamationTriangle} className="text-xs" />
                    <p className="text-[10px] font-bold uppercase tracking-tight">Warranty will be voided</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-2 pt-4 border-t border-slate-100">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button className="btn-primary bg-indigo-600 hover:bg-indigo-700 min-w-[140px]" onClick={handleLogDiagnosis}>
            Save Diagnosis
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * QuoteModal
 */
export function QuoteModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { generateRepairQuote, companySettings } = useApp()
  const [applyVat, setApplyVat] = useState(repair.quote ? repair.quote.tax > 0 : true)
  const [quoteLines, setQuoteLines] = useState(() => {
    if (repair.quote) return repair.quote.lines.map(l => ({ type: l.type as any, description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice) }))
    return [{ type: 'labor' as const, description: 'Labour & Service Charge', qty: '1', unitPrice: '5000' }]
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

  const total = quoteLines.reduce((s, l) => s + (Number(l.qty) || 1) * (Number(l.unitPrice) || 0), 0)

  return (
    <Modal 
      title={repair.quote ? 'Update Quote' : 'Generate Quote'} 
      subtitle={`Job Ref: ${repair.ref}`} 
      onClose={onClose} 
      width={720}
    >
      <div className="flex flex-col gap-6">
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50/50 p-1">
          <table className="w-full min-w-[600px] border-separate border-spacing-y-1.5 px-2">
            <thead>
              <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-left px-3 py-2 w-20">Qty</th>
                <th className="text-left px-3 py-2 w-32">Unit Price</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {quoteLines.map((line, i) => (
                <tr key={i} className="group animate-in fade-in slide-in-from-left-2 duration-200" style={{ animationDelay: `${i * 50}ms` }}>
                  <td className="px-1">
                    <select className="form-input bg-white font-medium" value={line.type} onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, type: e.target.value as any } : l))}>
                      <option value="part">Part</option>
                      <option value="labor">Labour</option>
                      <option value="software">Software</option>
                      <option value="license">License</option>
                      <option value="logistics">Logistics</option>
                      <option value="service">Service</option>
                    </select>
                  </td>
                  <td className="px-1">
                    <input className="form-input bg-white" placeholder="Description..." value={line.description} onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, description: e.target.value } : l))} />
                  </td>
                  <td className="px-1">
                    <input className="form-input bg-white text-center" type="number" value={line.qty} onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))} />
                  </td>
                  <td className="px-1">
                    <input className="form-input bg-white text-right font-mono" type="number" value={line.unitPrice} onChange={e => setQuoteLines(prev => prev.map((l, j) => j === i ? { ...l, unitPrice: e.target.value } : l))} />
                  </td>
                  <td className="px-1 text-center">
                    <button 
                      onClick={() => setQuoteLines(prev => prev.filter((_, j) => j !== i))} 
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all active:scale-90"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="p-3 flex items-center justify-between border-t border-slate-200 mt-2 bg-white rounded-b-xl">
            <button 
              className="text-[11px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-all"
              onClick={() => setQuoteLines(prev => [...prev, { type: 'part', description: '', qty: '1', unitPrice: '0' }])}
            >
              + ADD LINE ITEM
            </button>
            
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={applyVat} onChange={e => setApplyVat(e.target.checked)} />
                <span className="text-[11px] font-bold text-slate-500 group-hover:text-slate-700">Apply VAT ({companySettings.vatRate}%)</span>
              </label>
              <div className="text-right">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Grand Total</p>
                <p className="text-lg font-black text-slate-900 font-mono">KES {total.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-slate-100">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button className="btn-primary bg-blue-600 hover:bg-blue-700 shadow-blue-200/50 min-w-[180px]" onClick={handleGenerateQuote}>
            <Fa icon={faFileInvoiceDollar} className="mr-2" />
            {repair.quote ? 'Update & Resend Quote' : 'Generate & Send Quote'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * QAModal
 */
export function QAModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { completeRepairQA } = useApp()
  const [qcItems, setQcItems] = useState(repair.qcItems)

  const handleCompleteQA = () => {
    const qaResults = qcItems.map(item => ({ itemId: item.id, passed: item.passed, notes: item.notes }))
    completeRepairQA(repair.id, qaResults)
    onClose()
  }

  const allPassed = qcItems.every(i => i.passed)

  return (
    <Modal title="Quality Assurance Checklist" subtitle={repair.ref} onClose={onClose} width={480}>
      <div className="flex flex-col gap-6">
        {qcItems.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center animate-pulse">
              <Fa icon={faTools} className="text-xl" />
            </div>
            <p className="text-xs font-medium">Loading checklist...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">Verify Repair Quality</p>
            {qcItems.map(item => (
              <label 
                key={item.id} 
                className={`flex items-center gap-4 p-4 rounded-2xl border cursor-pointer transition-all group ${
                  item.passed 
                    ? 'bg-emerald-50 border-emerald-200' 
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="relative flex items-center">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 rounded-lg border-slate-300 text-emerald-600 focus:ring-emerald-500 transition-all cursor-pointer"
                    checked={item.passed} 
                    onChange={e => setQcItems(prev => prev.map(qi => qi.id === item.id ? { ...qi, passed: e.target.checked } : qi))} 
                  />
                </div>
                <span className={`text-xs font-bold transition-colors ${item.passed ? 'text-emerald-900' : 'text-slate-700'}`}>
                  {item.description}
                </span>
                {item.passed && <Fa icon={faCheckCircle} className="ml-auto text-emerald-500 animate-in zoom-in duration-300" />}
              </label>
            ))}
          </div>
        )}

        <div className={`p-4 rounded-2xl border flex items-start gap-3 transition-all ${
          allPassed ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-amber-50 border-amber-100 text-amber-800'
        }`}>
          <Fa icon={allPassed ? faCheckCircle : faExclamationTriangle} className={`mt-0.5 ${allPassed ? 'text-emerald-500' : 'text-amber-500'}`} />
          <p className="text-[11px] leading-relaxed font-medium">
            {allPassed 
              ? 'Excellent! All tests passed. The device is now verified and ready for the customer.' 
              : 'Attention: Some tests are still pending or failed. Submitting now will flag this for rework.'}
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-slate-100">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button 
            className={`btn-primary min-w-[180px] shadow-lg transition-all ${
              allPassed 
                ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200/50' 
                : 'bg-amber-600 hover:bg-amber-700 shadow-amber-200/50'
            }`} 
            onClick={handleCompleteQA}
          >
            {allPassed ? '✓ PASS QUALITY CHECK' : '✗ SUBMIT AS FAILED'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * ScheduleDeliveryModal
 */
export function ScheduleDeliveryModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { riders, scheduleDelivery } = useApp()
  const [deliveryForm, setDeliveryForm] = useState({
    method: 'pickup' as 'pickup' | 'delivery' | 'courier', 
    scheduledDate: new Date().toISOString().slice(0, 10), 
    address: '', 
    riderId: '', 
    riderName: ''
  })

  const handleSchedule = () => {
    scheduleDelivery(repair.id, deliveryForm)
    onClose()
  }

  return (
    <Modal title="Schedule Delivery" subtitle={repair.ref} onClose={onClose} width={480}>
      <div className="flex flex-col gap-5">
        <div className="flex p-1 bg-slate-100 rounded-2xl border border-slate-200">
          {(['pickup', 'delivery', 'courier'] as const).map(m => (
            <button 
              key={m}
              onClick={() => setDeliveryForm(p => ({ ...p, method: m }))}
              className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
                deliveryForm.method === m 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="space-y-4 animate-in fade-in duration-300">
          <Field label="Scheduled Date" required>
            <Input type="date" value={deliveryForm.scheduledDate} onChange={v => setDeliveryForm(p => ({ ...p, scheduledDate: v }))} />
          </Field>

          {deliveryForm.method !== 'pickup' && (
            <>
              <Field label="Delivery Address" required>
                <Textarea 
                  value={deliveryForm.address} 
                  onChange={v => setDeliveryForm(p => ({ ...p, address: v }))} 
                  placeholder="Enter full physical address for delivery..." 
                  rows={2}
                />
              </Field>

              {deliveryForm.method === 'delivery' && (
                <Field label="Assign Rider" required>
                  <select 
                    className="form-input text-xs font-medium"
                    value={deliveryForm.riderId} 
                    onChange={e => {
                      const r = riders.find(x => x.id === e.target.value)
                      setDeliveryForm(p => ({ ...p, riderId: e.target.value, riderName: r?.name || '' }))
                    }}
                  >
                    <option value="">— Select internal rider —</option>
                    {riders.map(r => <option key={r.id} value={r.id}>{r.name} ({r.phone})</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-slate-100">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button className="btn-primary bg-blue-600 hover:bg-blue-700 shadow-blue-200/50 min-w-[160px]" onClick={handleSchedule}>
            <Fa icon={faTruck} className="mr-2" />
            Confirm Schedule
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * RepairProgressModal
 */
export function RepairProgressModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { updateRepairProgress, startRepair, markRepairComplete, createInvoiceFromRepair } = useApp()
  const [notes, setNotes] = useState('')

  const handleAction = () => {
    if (repair.status === 'approved' || (repair.status === 'assigned' && repair.repairPath === 'direct_repair')) {
      startRepair(repair.id)
    } else if (repair.status === 'in_repair') {
      markRepairComplete(repair.id)
    } else if (repair.status === 'ready') {
      createInvoiceFromRepair(repair.id, true)
    }
    onClose()
  }

  const getActionConfig = () => {
    if (repair.status === 'approved' || (repair.status === 'assigned' && repair.repairPath === 'direct_repair')) {
      return { title: 'Start Repair Job', btn: 'START REPAIR', color: 'bg-blue-600', icon: faPlay }
    }
    if (repair.status === 'in_repair') {
      return { title: 'Mark Repair Complete', btn: 'COMPLETE REPAIR', color: 'bg-emerald-600', icon: faCheckCircle }
    }
    if (repair.status === 'ready') {
      return { title: 'Create Invoice', btn: 'GENERATE INVOICE', color: 'bg-amber-600', icon: faFileInvoiceDollar }
    }
    return { title: 'Update Progress', btn: 'UPDATE', color: 'bg-slate-600', icon: faHistory }
  }

  const config = getActionConfig()

  return (
    <Modal title={config.title} subtitle={repair.ref} onClose={onClose} width={400}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white shadow-sm ${config.color}`}>
            <Fa icon={config.icon} className="text-xl" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-900 uppercase tracking-tight">Status Update</p>
            <p className="text-[10px] text-slate-500 font-medium">Moving job to next stage in workflow</p>
          </div>
        </div>
        
        <Field label="Progress Notes (Optional)">
          <Textarea value={notes} onChange={setNotes} placeholder="Any specific notes about this stage..." rows={3} />
        </Field>

        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button className={`btn-primary min-w-[160px] ${config.color}`} onClick={handleAction}>
            {config.btn}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * ProcurementModal
 */
export function ProcurementModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { requestProcurement } = useApp()
  const [form, setForm] = useState({
    items: [{ type: 'part' as const, description: '', qty: '1', estimatedCost: '0' }],
    urgency: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    notes: '',
  })

  const handleRequest = () => {
    requestProcurement(repair.id, form.items.map(i => ({ ...i, qty: Number(i.qty), estimatedCost: Number(i.estimatedCost) })), form.urgency, form.notes)
    onClose()
  }

  return (
    <Modal title="Request Procurement" subtitle={repair.ref} onClose={onClose} width={600}>
      <div className="flex flex-col gap-6">
        <div className="space-y-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Required Parts / Licenses</p>
          {form.items.map((item, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50/50 items-end">
              <div className="sm:col-span-3">
                <Field label="Type">
                  <select className="form-input bg-white" value={item.type} onChange={e => setForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, type: e.target.value as any } : x) }))}>
                    <option value="part">Hardware Part</option>
                    <option value="software">Software</option>
                    <option value="license">License</option>
                  </select>
                </Field>
              </div>
              <div className="sm:col-span-5">
                <Field label="Description">
                  <Input value={item.description} onChange={v => setForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, description: v } : x) }))} placeholder="e.g. Dell Latitude 5400 Screen" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Qty">
                  <Input type="number" value={item.qty} onChange={v => setForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, qty: v } : x) }))} />
                </Field>
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <button 
                  onClick={() => setForm(p => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <button 
            className="text-[10px] font-black text-blue-600 hover:text-blue-800 flex items-center gap-2"
            onClick={() => setForm(p => ({ ...p, items: [...p.items, { type: 'part', description: '', qty: '1', estimatedCost: '0' }] }))}
          >
            <Fa icon={faCartPlus} />
            ADD ANOTHER ITEM
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Urgency Level">
            <select className="form-input" value={form.urgency} onChange={e => setForm(p => ({ ...p, urgency: e.target.value as any }))}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
          <Field label="Additional Notes">
            <Input value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Any specific sourcing notes..." />
          </Field>
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-slate-100">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button className="btn-primary bg-slate-900 min-w-[180px]" onClick={handleRequest}>
            SUBMIT REQUEST
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * ReturnModal
 */
export function ReturnModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { returnToCustomer } = useApp()
  const [reason, setReason] = useState('')

  const handleReturn = () => {
    returnToCustomer(repair.id, reason)
    onClose()
  }

  return (
    <Modal title="Return to Customer" subtitle={repair.ref} onClose={onClose} width={400}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-amber-50 border border-amber-100 text-amber-800">
          <Fa icon={faUndo} className="text-xl text-amber-500" />
          <p className="text-[11px] font-medium leading-relaxed">
            Returning the device without completing repairs. This will move the job to <span className="font-bold">Returned</span> status.
          </p>
        </div>
        <Field label="Reason for Return" required>
          <Textarea value={reason} onChange={setReason} placeholder="Why is the device being returned? (e.g. Customer request, part unavailable)" rows={3} />
        </Field>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button className="btn-primary bg-amber-600 hover:bg-amber-700 min-w-[140px]" onClick={handleReturn}>
            CONFIRM RETURN
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * DeclineModal
 */
export function DeclineModal({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { updateRepair } = useApp()
  const [reason, setReason] = useState('')

  const handleDecline = () => {
    updateRepair(repair.id, { status: 'declined', notes: (repair.notes || '') + `\n[Declined] Reason: ${reason}` })
    onClose()
  }

  return (
    <Modal title="Decline Quote" subtitle={repair.ref} onClose={onClose} width={400}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-red-50 border border-red-100 text-red-800">
          <Fa icon={faTimesCircle} className="text-xl text-red-500" />
          <p className="text-[11px] font-medium leading-relaxed">
            The customer has declined the repair quote. The device will be marked as <span className="font-bold">Declined</span>.
          </p>
        </div>
        <Field label="Reason for Declining" required>
          <Textarea value={reason} onChange={setReason} placeholder="e.g. Cost too high, customer decided to buy new device..." rows={3} />
        </Field>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button className="btn-primary bg-red-600 hover:bg-red-700 min-w-[140px]" onClick={handleDecline}>
            MARK AS DECLINED
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * MarkDeliveredConfirm
 */
export function MarkDeliveredConfirm({ repair, onClose }: { repair: RepairOrder, onClose: () => void }) {
  const { deliverRepair } = useApp()

  const handleConfirm = () => {
    deliverRepair(repair.id)
    onClose()
  }

  return (
    <Modal title="Confirm Delivery" subtitle={repair.ref} onClose={onClose} width={400}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-4 py-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-inner">
            <Fa icon={faTruck} className="text-2xl" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">Mark as Delivered?</p>
            <p className="text-xs text-slate-500 mt-1 px-4">This confirms that the device has been successfully handed over to the customer.</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-4 border-t border-slate-100">
          <button className="btn-outline min-w-[100px]" onClick={onClose}>Cancel</button>
          <button className="btn-primary bg-emerald-600 hover:bg-emerald-700 min-w-[140px]" onClick={handleConfirm}>
            YES, DELIVERED
          </button>
        </div>
      </div>
    </Modal>
  )
}
