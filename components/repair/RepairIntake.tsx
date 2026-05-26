// @ts-nocheck
'use client'

import { useState } from 'react'
import { useApp, RepairOrder, fmtDate } from '@/lib/store'
import { Field, Input, Select, Textarea, Badge } from '@/components/ui'
import { Fa } from '@/components/icons'
import { 
  faArrowLeft, faSave, faUser, faMicrochip, faClipboardList, 
  faShieldAlt, faCheckCircle, faExclamationTriangle, faSignature,
  faCopy, faExternalLinkAlt, faPlusCircle, faSearch
} from '@fortawesome/free-solid-svg-icons'

const DEVICE_TYPES = [
  { id: 'laptop',  label: 'Laptop',   icon: '💻' },
  { id: 'desktop', label: 'Desktop',  icon: '🖥️' },
  { id: 'phone',   label: 'Phone',    icon: '📱' },
  { id: 'printer', label: 'Printer',  icon: '🖨️' },
  { id: 'other',   label: 'Other',    icon: '🔧' },
]

export default function RepairIntake({ onCancel, onSuccess }: { onCancel: () => void, onSuccess: (id: string) => void }) {
  const { repairs, contacts, warranties, createRepair, updateRepair, showToast } = useApp()
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
  const [successData, setSuccessData] = useState<{ id: string, ref: string } | null>(null)

  const setI = (k: keyof typeof intake, v: string | boolean) =>
    setIntake(prev => ({ ...prev, [k]: v }))

  const matchedWarranty = intake.serial.trim().length >= 4
    ? warranties.find(w => w.serialNumber.toLowerCase() === intake.serial.trim().toLowerCase() && w.status === 'active')
    : undefined
  const intakeUnderWarranty = !!matchedWarranty && !intake.clientCausedDamage

  // Duplicate Check
  const duplicateRepair = intake.serial.trim().length >= 4
    ? repairs.find(r => 
        r.serialNumber?.toLowerCase() === intake.serial.trim().toLowerCase() && 
        !['delivered', 'closed', 'cancelled', 'returned'].includes(r.status)
      )
    : undefined

  const handleCreateIntake = () => {
    if (!intake.customerName || !intake.customerPhone || !intake.brand || !intake.model) {
      showToast('Customer name, phone, device brand and model are required', 'error')
      return
    }

    if (duplicateRepair) {
      showToast(`Duplicate Found: This device is already in for repair (${duplicateRepair.ref})`, 'error')
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
      setSuccessData({ id: rep.id, ref: rep.ref })
    } catch (err) {
      showToast('Failed to create repair job', 'error')
    } finally {
      setLoading(false)
    }
  }

  const portalUrl = successData ? `https://erp.deed.co.ke/portal/repair/${successData.ref}` : ''
  const copyLink = () => {
    navigator.clipboard.writeText(portalUrl)
    showToast('Portal link copied!', 'success')
  }

  if (successData) {
    return (
      <div className="flex flex-col h-full bg-white animate-in zoom-in-95 duration-500 items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-6 shadow-xl shadow-emerald-100/50">
          <Fa icon={faCheckCircle} className="text-4xl" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">Repair Job Booked!</h2>
        <p className="text-slate-500 font-medium mb-8 max-w-sm">
          Ticket <span className="text-blue-600 font-bold">{successData.ref}</span> has been created. Share the tracking link below with the customer.
        </p>

        <div className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-3xl p-6 mb-8">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Client Portal Link</p>
          <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs font-mono text-blue-600 break-all mb-4">
            {portalUrl}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={copyLink} className="btn-secondary flex items-center justify-center gap-2 py-3 rounded-xl bg-white">
              <Fa icon={faCopy} /> Copy Link
            </button>
            <a href={portalUrl} target="_blank" className="btn-primary flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 shadow-lg shadow-blue-100">
              <Fa icon={faExternalLinkAlt} /> Open Portal
            </a>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button onClick={() => onSuccess(successData.id)} className="btn-primary px-8 py-3 rounded-2xl bg-slate-900">
            View Job Details
          </button>
          <button onClick={() => { setSuccessData(null); setIntake({ ...intake, brand: '', model: '', serial: '', issueDesc: '', accessories: '' }) }} className="btn-secondary px-8 py-3 rounded-2xl border-slate-200">
            Book Another
          </button>
        </div>
      </div>
    )
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
            <section className="card p-6 border-l-4 border-l-blue-500 shadow-sm">
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
                        if (m) {
                          setI('customerId', m.id)
                          setI('customerPhone', m.phone || '')
                          setI('customerEmail', m.email || '')
                        }
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
                      { value: 'website', label: 'Website' },
                      { value: 'whatsapp', label: 'WhatsApp' },
                    ]} />
                </Field>
              </div>
            </section>

            {/* 2. Device Section */}
            <section className="card p-6 border-l-4 border-l-indigo-500 shadow-sm">
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
                <Field label="Serial / IMEI" hint="Duplicate check based on this">
                  <div className="relative">
                    <Input value={intake.serial} onChange={v => setI('serial', v)} placeholder="Unique ID..." />
                    {duplicateRepair && (
                      <div className="mt-2 flex items-center gap-2 p-2 rounded-xl bg-red-50 border border-red-100 text-red-700 animate-pulse">
                        <Fa icon={faExclamationTriangle} className="text-xs" />
                        <p className="text-[10px] font-bold uppercase tracking-tight">ALREADY IN: {duplicateRepair.ref}</p>
                      </div>
                    )}
                  </div>
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
              {intake.serial.trim().length >= 4 && !duplicateRepair && (
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
            <section className="card p-6 border-l-4 border-l-emerald-500 shadow-sm">
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
                  <Field label="Customer Signature" required>
                    <Input value={intake.consentSignature} onChange={v => setI('consentSignature', v)} placeholder="Type full name as signature" />
                  </Field>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={intake.agreeTerms} onChange={e => setI('agreeTerms', e.target.checked)} />
                    <span className="text-[10px] font-medium text-slate-600 leading-tight">
                      I agree to the terms of service and authorize immediate repair.
                    </span>
                  </label>
                </div>
              )}
            </section>

            <div className="card p-5 bg-amber-50 border-amber-100">
              <div className="flex items-center gap-2 text-amber-700 mb-2">
                <Fa icon={faExclamationTriangle} className="text-xs" />
                <span className="text-[10px] font-black uppercase tracking-widest">Important Notice</span>
              </div>
              <p className="text-[10px] text-amber-800 leading-relaxed font-medium">
                Please ensure all physical damage is documented and the customer is informed of the estimated completion date.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
