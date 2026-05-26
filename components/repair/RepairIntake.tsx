'use client'

import { useState } from 'react'
import { useApp, RepairOrder, fmtDate } from '@/lib/store'
import { Field, Input, Select, Textarea, Badge } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faArrowLeft, faSave, faUser, faMicrochip, faClipboardList, faShieldAlt, faCheckCircle, faExclamationTriangle, faSignature } from '@fortawesome/free-solid-svg-icons'

const DEVICE_TYPES = [
  { id: 'laptop',  label: 'Laptop',   icon: '💻' },
  { id: 'desktop', label: 'Desktop',  icon: '🖥️' },
  { id: 'phone',   label: 'Phone',    icon: '📱' },
  { id: 'printer', label: 'Printer',  icon: '🖨️' },
  { id: 'other',   label: 'Other',    icon: '🔧' },
]

export default function RepairIntake({ onCancel, onSuccess }: { onCancel: () => void, onSuccess: (id: string) => void }) {
  const { contacts, warranties, createRepair, updateRepair, showToast } = useApp()
  const customers = contacts.filter(c => c.isCustomer)

  const [intake, setIntake] = useState({
    customerName: '', customerPhone: '', customerEmail: '',
    customerId: '',
    deviceType: 'laptop', customDeviceType: '',
    brand: '', model: '', serial: '',
    deviceCondition: 'good' as 'good' | 'fair' | 'poor' | 'damaged',
    accessories: '',
    issueDesc: '', priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    intakeChannel: 'walk_in' as 'walk_in' | 'website' | 'whatsapp' | 'call' | 'email' | 'rider_pickup',
    repairPath: 'diagnosis_first' as 'diagnosis_first' | 'direct_repair',
    estimatedCompletion: '',
    consentSignature: '',
    agreeTerms: false,
    liabilityWaiverAccepted: false,
    clientCausedDamage: false,
    clientDamageReason: '',
  })
  
  const [loading, setLoading] = useState(false)

  const setI = (k: keyof typeof intake, v: string | boolean) =>
    setIntake(prev => ({ ...prev, [k]: v }))

  const matchedWarranty = intake.serial.trim().length >= 4
    ? warranties.find(w => w.serialNumber.toLowerCase() === intake.serial.trim().toLowerCase() && w.status === 'active')
    : undefined
  const intakeUnderWarranty = !!matchedWarranty && !intake.clientCausedDamage

  const handleCreateIntake = () => {
    if (!intake.customerName || !intake.customerPhone || !intake.brand || !intake.model) {
      showToast('Customer name, phone, device brand and model are required', 'error')
      return
    }
    if (intake.repairPath === 'direct_repair' && (!intake.consentSignature.trim() || !intake.agreeTerms)) {
      showToast('Customer signature and terms agreement are required for direct repair consent', 'error')
      return
    }
    
    setLoading(true)
    try {
      const matchedCustomer = customers.find(c =>
        c.name.toLowerCase() === intake.customerName.toLowerCase()
      )
      const customerId = matchedCustomer?.id ?? 'guest-' + Date.now()
      const customerName = intake.customerName
      const deviceTypeLabel = intake.deviceType === 'other' ? intake.customDeviceType || 'Other' : intake.deviceType
      const productLabel = `${intake.brand} ${intake.model}`.trim()
      
      const rep = createRepair(
        customerId, customerName,
        productLabel, intake.serial,
        intake.issueDesc
      )
      
      const accessories = intake.accessories
        .split(',').map(n => n.trim()).filter(Boolean)
        .map(name => ({ name, received: true }))

      updateRepair(rep.id, {
        status: 'pending_verification',
        customerPhone: intake.customerPhone,
        customerEmail: intake.customerEmail,
        intakeChannel: intake.intakeChannel as RepairOrder['intakeChannel'],
        deviceCondition: intake.deviceCondition,
        priority: intake.priority,
        repairPath: intake.repairPath,
        estimatedCompletionDate: intake.estimatedCompletion || undefined,
        accessories,
        underWarranty: intakeUnderWarranty,
        warrantyId: matchedWarranty?.id,
        clientCausedDamage: intake.clientCausedDamage || undefined,
        clientDamageReason: intake.clientCausedDamage ? intake.clientDamageReason || undefined : undefined,
        notes: intake.repairPath === 'direct_repair'
          ? `[Direct Repair Consent] Signed by: ${intake.consentSignature}. Liability Waiver Accepted: YES. Device type: ${deviceTypeLabel}.\nTerms Agreed: Customer agrees to bypass the diagnosis phase, authorises the repair to proceed immediately for the reported issue only, and acknowledges that we are not liable for any other problems that may arise during or after the repair.`
          : `Device type: ${deviceTypeLabel}.`,
      })

      showToast(`Ticket ${rep.ref} created successfully`, 'success')
      onSuccess(rep.id)
    } catch (err) {
      showToast('Failed to create repair job', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50/50 animate-in fade-in duration-300">
      {/* Header Section */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sm:px-6 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button 
              onClick={onCancel}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-all active:scale-90"
            >
              <Fa icon={faArrowLeft} />
            </button>
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight">New Repair Intake</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Register device for service</p>
            </div>
          </div>
          <button 
            className={`btn-primary shadow-lg transition-all flex items-center gap-2 ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95'}`}
            onClick={handleCreateIntake}
            disabled={loading}
          >
            <Fa icon={faSave} />
            <span>{loading ? 'Booking...' : 'Book Repair Job'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Form Column */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* 1. Customer Section */}
            <section className="card p-6 border-l-4 border-l-blue-500">
              <div className="flex items-center gap-2 mb-6">
                <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600"><Fa icon={faUser} /></div>
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Customer Information</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Customer Name" required hint="Search or enter new name">
                  <div className="relative">
                    <input className="form-input font-medium" value={intake.customerName}
                      onChange={e => {
                        setI('customerName', e.target.value)
                        const m = customers.find(c => c.name.toLowerCase().startsWith(e.target.value.toLowerCase()))
                        if (m) setI('customerId', m.id)
                      }}
                      placeholder="Type name..." list="customer-list" />
                    <datalist id="customer-list">
                      {customers.map(c => <option key={c.id} value={c.name} />)}
                    </datalist>
                  </div>
                </Field>
                <Field label="Phone Number" required>
                  <Input value={intake.customerPhone} onChange={v => setI('customerPhone', v)} placeholder="+254 7XX XXX XXX" />
                </Field>
                <Field label="Email Address">
                  <Input value={intake.customerEmail} onChange={v => setI('customerEmail', v)} placeholder="customer@email.com" type="email" />
                </Field>
                <Field label="Intake Channel">
                  <Select value={intake.intakeChannel} onChange={v => setI('intakeChannel', v)}
                    options={[
                      { value: 'walk_in', label: 'Walk-in' },
                      { value: 'rider_pickup', label: 'Rider Pickup' },
                    ]} />
                </Field>
              </div>
            </section>

            {/* 2. Device Section */}
            <section className="card p-6 border-l-4 border-l-indigo-500">
              <div className="flex items-center gap-2 mb-6">
                <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600"><Fa icon={faMicrochip} /></div>
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Device Specifications</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Device Type" required>
                  <Select value={intake.deviceType} onChange={v => setI('deviceType', v)}
                    options={DEVICE_TYPES.map(dt => ({ value: dt.id, label: `${dt.icon}  ${dt.label}` }))} />
                </Field>
                {intake.deviceType === 'other' && (
                  <Field label="Specify Type" required>
                    <Input value={intake.customDeviceType} onChange={v => setI('customDeviceType', v)} placeholder="e.g. Smart TV" />
                  </Field>
                )}
                <Field label="Brand" required>
                  <Input value={intake.brand} onChange={v => setI('brand', v)} placeholder="e.g. HP, Apple" />
                </Field>
                <Field label="Model" required>
                  <Input value={intake.model} onChange={v => setI('model', v)} placeholder="e.g. MacBook Pro" />
                </Field>
                <Field label="Serial / IMEI" hint="Enter to check warranty">
                  <Input value={intake.serial} onChange={v => setI('serial', v)} placeholder="Unique ID..." />
                </Field>
                <Field label="Condition">
                  <Select value={intake.deviceCondition} onChange={v => setI('deviceCondition', v)}
                    options={[
                      { value: 'good',    label: 'Good — Clean' },
                      { value: 'fair',    label: 'Fair — Scratches' },
                      { value: 'poor',    label: 'Poor — Dents' },
                      { value: 'damaged', label: 'Damaged — Broken' },
                    ]} />
                </Field>
              </div>
              
              {/* Warranty Badge */}
              {intake.serial.trim().length >= 4 && (
                <div className="mt-4 animate-in zoom-in-95 duration-300">
                  {matchedWarranty ? (
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-800">
                      <Fa icon={faShieldAlt} className="text-emerald-500 text-lg" />
                      <div className="flex-1">
                        <p className="text-xs font-bold">Active Warranty Found</p>
                        <p className="text-[10px] opacity-80">{matchedWarranty.ref} • Expires {fmtDate(matchedWarranty.endDate)}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-black">COVERED</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500">
                      <Fa icon={faShieldAlt} className="opacity-30" />
                      <p className="text-[10px] font-bold uppercase tracking-tight">No active warranty for this serial</p>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 3. Problem Section */}
            <section className="card p-6 border-l-4 border-l-emerald-500">
              <div className="flex items-center gap-2 mb-6">
                <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600"><Fa icon={faClipboardList} /></div>
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Job Details</h3>
              </div>
              <div className="space-y-4">
                <Field label="Reported Issue" required>
                  <Textarea value={intake.issueDesc} onChange={v => setI('issueDesc', v)} placeholder="Describe what's wrong with the device..." rows={3} />
                </Field>
                <Field label="Accessories Included" hint="Comma-separated">
                  <Input value={intake.accessories} onChange={v => setI('accessories', v)} placeholder="charger, bag, cables..." />
                </Field>
              </div>
            </section>
          </div>

          {/* Sidebar Column */}
          <div className="space-y-6">
            
            {/* Workflow Selection */}
            <section className="card p-5 bg-white shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Workflow Path</p>
              <div className="flex flex-col gap-3">
                {([
                  { value: 'diagnosis_first', icon: '🔍', title: 'Diagnosis First', desc: 'Tech inspects before quote.' },
                  { value: 'direct_repair',   icon: '🔧', title: 'Direct Repair',   desc: 'Bypass inspection.' },
                ] as const).map(opt => (
                  <button 
                    key={opt.value} 
                    type="button" 
                    onClick={() => setI('repairPath', opt.value)}
                    className={`p-4 rounded-2xl border-2 transition-all text-left group active:scale-[0.98] ${
                      intake.repairPath === opt.value 
                        ? 'bg-blue-50 border-blue-600 ring-4 ring-blue-50' 
                        : 'bg-white border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl group-hover:scale-110 transition-transform">{opt.icon}</span>
                      <span className={`text-xs font-bold ${intake.repairPath === opt.value ? 'text-blue-700' : 'text-slate-700'}`}>{opt.title}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed font-medium">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {/* Direct Repair Consent UI */}
              {intake.repairPath === 'direct_repair' && (
                <div className="mt-4 p-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 space-y-4 animate-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center gap-2 text-indigo-700">
                    <Fa icon={faSignature} className="text-sm" />
                    <p className="text-[10px] font-black uppercase tracking-widest">Customer Consent</p>
                  </div>
                  <Field label="Customer Signature" required hint="Type full name to sign">
                    <Input value={intake.consentSignature} onChange={v => setI('consentSignature', v)} placeholder="Full Name..." />
                  </Field>
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      className="mt-1 w-4 h-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                      checked={intake.agreeTerms} 
                      onChange={e => setI('agreeTerms', e.target.checked)} 
                    />
                    <span className="text-[10px] text-indigo-900/70 font-medium leading-relaxed">
                      Customer acknowledges that we are not liable for any other problems that may arise during or after this direct repair.
                    </span>
                  </label>
                </div>
              )}
            </section>

            {/* Priority Selection */}
            <section className="card p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Job Priority</p>
              <div className="flex p-1 bg-slate-100 rounded-2xl border border-slate-200">
                {(['low', 'normal', 'high', 'urgent'] as const).map(p => (
                  <button 
                    key={p}
                    onClick={() => setI('priority', p)}
                    className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all ${
                      intake.priority === p 
                        ? 'bg-white text-slate-900 shadow-sm' 
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  )
}
