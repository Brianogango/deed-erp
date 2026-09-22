// @ts-nocheck
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Fa } from '@/components/icons'
import { 
  faCheckCircle, faMicrochip, faUser, faClipboardList, 
  faShieldAlt, faArrowRight, faInfoCircle, faSignature,
  faMobileAlt, faLaptop, faDesktop, faPrint, faWrench
} from '@fortawesome/free-solid-svg-icons'

const DEVICE_TYPES = [
  { id: 'laptop',  label: 'Laptop',   icon: faLaptop },
  { id: 'desktop', label: 'Desktop',  icon: faDesktop },
  { id: 'phone',   label: 'Phone',    icon: faMobileAlt },
  { id: 'printer', label: 'Printer',  icon: faPrint },
  { id: 'other',   label: 'Other',    icon: faWrench },
]

export default function NewRepairPortalPage() {
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    productName: '',
    serialNumber: '',
    issueDescription: '',
    accessories: '',
    repairPath: '',
    deviceType: '',
    liabilityWaiverAccepted: false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ref: string; trackingUrl: string } | null>(null)
  const [error, setError] = useState('')

  const update = (key: string, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    const missing: string[] = []
    if (!form.deviceType) missing.push('Device Type')
    if (!form.repairPath) missing.push('Repair Path (Diagnosis First or Direct Repair)')
    if (missing.length) { setError(`Please select: ${missing.join(', ')}`); return }
    if (form.repairPath === 'direct_repair' && !form.liabilityWaiverAccepted) { setError('Please accept the liability waiver to proceed with direct repair'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unable to submit repair request')
      setResult({ ref: data.repair.ref, trackingUrl: data.trackingUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit repair request')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in zoom-in-95 duration-500">
        <div className="w-full max-w-xl bg-white rounded-[2.5rem] p-8 sm:p-12 shadow-2xl shadow-slate-200/50 border border-slate-100 text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-8 shadow-xl shadow-emerald-100/50">
            <Fa icon={faCheckCircle} className="text-4xl" />
          </div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-600 mb-2">Request Received</p>
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight mb-4">
            Ticket <span className="text-blue-600">#{result.ref}</span>
          </h1>
          <p className="text-slate-500 font-medium leading-relaxed mb-10 max-w-sm mx-auto">
            Your repair request is now in our system. Please bring your device to our shop for physical verification and assignment.
          </p>
          
          <div className="space-y-4">
            <Link href={result.trackingUrl} className="flex items-center justify-center gap-3 w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-blue-600 transition-all shadow-lg shadow-slate-200 group">
              Track Progress <Fa icon={faArrowRight} className="text-xs group-hover:translate-x-1 transition-transform" />
            </Link>
            <button onClick={() => window.location.reload()} className="text-slate-400 text-xs font-bold uppercase tracking-widest hover:text-slate-600 transition-colors">
              Submit Another Request
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans selection:bg-blue-100">
      <div className="max-w-4xl mx-auto">
        {/* Branding Header */}
        <div className="text-center mb-12 animate-in slide-in-from-top-4 duration-700">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm mb-6">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Deed Repair Portal</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight mb-4">Book Your Repair</h1>
          <p className="text-slate-500 font-medium max-w-lg mx-auto leading-relaxed">
            Fast, professional service for all your tech. Fill in the details below to start your service ticket.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {error && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-700 text-sm font-bold flex items-center gap-3">
              <Fa icon={faInfoCircle} /> {error}
            </div>
          )}

          {/* 1. Customer Info */}
          <div className="bg-white rounded-[2rem] p-6 sm:p-10 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Fa icon={faUser} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Customer Details</h2>
                <p className="text-xs text-slate-400 font-medium">How can we contact you?</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Full Name</label>
                <input required value={form.customerName} onChange={e => update('customerName', e.target.value)} 
                  className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium placeholder:text-slate-300"
                  placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Phone Number</label>
                <input required value={form.customerPhone} onChange={e => update('customerPhone', e.target.value)} 
                  className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium placeholder:text-slate-300"
                  placeholder="+254 7XX XXX XXX" />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Email Address (Optional)</label>
                <input type="email" value={form.customerEmail} onChange={e => update('customerEmail', e.target.value)} 
                  className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium placeholder:text-slate-300"
                  placeholder="john@example.com" />
              </div>
            </div>
          </div>

          {/* 2. Device Info */}
          <div className="bg-white rounded-[2rem] p-6 sm:p-10 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Fa icon={faMicrochip} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Device Information</h2>
                <p className="text-xs text-slate-400 font-medium">Tell us about the hardware</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
              {DEVICE_TYPES.map(dt => (
                <button key={dt.id} type="button" onClick={() => update('deviceType', dt.id)}
                  className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2 ${form.deviceType === dt.id ? 'bg-indigo-50 border-indigo-500 text-indigo-600 shadow-lg shadow-indigo-100' : 'bg-white border-slate-50 text-slate-400 hover:border-slate-200'}`}>
                  <Fa icon={dt.icon} className="text-xl" />
                  <span className="text-[10px] font-black uppercase tracking-tight">{dt.label}</span>
                </button>
              ))}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Device Name / Model</label>
                <input required value={form.productName} onChange={e => update('productName', e.target.value)} 
                  className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 focus:ring-2 focus:ring-indigo-500 transition-all font-medium placeholder:text-slate-300"
                  placeholder="e.g. MacBook Pro M1" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Serial / IMEI</label>
                <input value={form.serialNumber} onChange={e => update('serialNumber', e.target.value)} 
                  className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 focus:ring-2 focus:ring-indigo-500 transition-all font-medium placeholder:text-slate-300"
                  placeholder="Unique ID" />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Accessories Included</label>
                <input value={form.accessories} onChange={e => update('accessories', e.target.value)} 
                  className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 focus:ring-2 focus:ring-indigo-500 transition-all font-medium placeholder:text-slate-300"
                  placeholder="e.g. Charger, Original Box, Case" />
              </div>
            </div>
          </div>

          {/* 3. Issue Info */}
          <div className="bg-white rounded-[2rem] p-6 sm:p-10 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Fa icon={faClipboardList} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">The Problem</h2>
                <p className="text-xs text-slate-400 font-medium">Describe the symptoms</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Issue Description</label>
                <textarea required value={form.issueDescription} onChange={e => update('issueDescription', e.target.value)} rows={4}
                  className="w-full bg-slate-50 border-none rounded-3xl px-6 py-5 focus:ring-2 focus:ring-emerald-500 transition-all font-medium placeholder:text-slate-300 resize-none"
                  placeholder="What's happening with the device?" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button type="button" onClick={() => update('repairPath', 'diagnosis_first')}
                  className={`flex items-start gap-4 p-5 rounded-2xl border-2 transition-all text-left ${form.repairPath === 'diagnosis_first' ? 'bg-emerald-50 border-emerald-500 ring-4 ring-emerald-50' : 'bg-white border-slate-50 hover:border-slate-100'}`}>
                  <div className="text-2xl mt-1">🔍</div>
                  <div>
                    <p className={`text-xs font-black uppercase tracking-tight ${form.repairPath === 'diagnosis_first' ? 'text-emerald-700' : 'text-slate-600'}`}>Diagnosis First</p>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">Full inspection before any work starts.</p>
                  </div>
                </button>
                <button type="button" onClick={() => update('repairPath', 'direct_repair')}
                  className={`flex items-start gap-4 p-5 rounded-2xl border-2 transition-all text-left ${form.repairPath === 'direct_repair' ? 'bg-amber-50 border-amber-500 ring-4 ring-amber-50' : 'bg-white border-slate-50 hover:border-slate-100'}`}>
                  <div className="text-2xl mt-1">🔧</div>
                  <div>
                    <p className={`text-xs font-black uppercase tracking-tight ${form.repairPath === 'direct_repair' ? 'text-amber-700' : 'text-slate-600'}`}>Direct Repair</p>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">Skip inspection and start repair now.</p>
                  </div>
                </button>
              </div>

              {form.repairPath === 'direct_repair' && (
                <div className="p-6 rounded-[2rem] bg-amber-50 border border-amber-100 space-y-4 animate-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center gap-2 text-amber-700">
                    <Fa icon={faSignature} className="text-sm" />
                    <p className="text-[10px] font-black uppercase tracking-widest">Liability Waiver</p>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                    I authorise Deed to proceed with direct repair work and acknowledge that customer-caused damage, liquid damage, previous tampering, or unavailable parts may affect warranty coverage and repair outcome.
                  </p>
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input type="checkbox" checked={form.liabilityWaiverAccepted} onChange={e => update('liabilityWaiverAccepted', e.target.checked)}
                      className="w-5 h-5 rounded-lg border-amber-300 text-amber-600 focus:ring-amber-500" />
                    <span className="text-xs font-bold text-amber-900">I Accept & Authorize</span>
                  </label>
                </div>
              )}
            </div>
          </div>

          <button disabled={submitting} 
            className="w-full bg-slate-900 text-white py-6 rounded-[2rem] font-black uppercase tracking-[0.2em] text-sm shadow-2xl shadow-slate-200 hover:bg-blue-600 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Processing Request...' : 'Submit Repair Ticket'}
          </button>
        </form>

        <footer className="mt-16 text-center text-slate-400">
          <p className="text-[10px] font-black uppercase tracking-widest">© 2026 Deed Enterprise Resource Planning</p>
        </footer>
      </div>
    </main>
  )
}
