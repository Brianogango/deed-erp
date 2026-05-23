'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function NewRepairPortalPage() {
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    productName: '',
    serialNumber: '',
    issueDescription: '',
    accessories: '',
    repairPath: 'diagnosis_first',
    liabilityWaiverAccepted: false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ref: string; trackingUrl: string } | null>(null)
  const [error, setError] = useState('')

  const update = (key: string, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
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
      <main className="min-h-screen bg-slate-50 px-4 py-12">
        <section className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-sm border border-slate-200">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Repair request received</p>
          <h1 className="mt-3 text-3xl font-bold text-slate-900">Reference {result.ref}</h1>
          <p className="mt-4 text-slate-600">Your request has been submitted for staff verification. Please present the device and accessories exactly as described so the team can confirm condition and begin the workflow.</p>
          <Link href={result.trackingUrl} className="mt-6 inline-flex rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700">Track this repair</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <form onSubmit={submit} className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-sm border border-slate-200 space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Deed repair portal</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Submit a repair request</h1>
          <p className="mt-3 text-slate-600">Customer-submitted repairs are created as <strong>pending verification</strong>. Staff must verify the device, accessories, warranty, and waiver details before assignment.</p>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">Customer name<input required value={form.customerName} onChange={e => update('customerName', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="block text-sm font-medium text-slate-700">Phone number<input required value={form.customerPhone} onChange={e => update('customerPhone', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="block text-sm font-medium text-slate-700">Email address<input type="email" value={form.customerEmail} onChange={e => update('customerEmail', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="block text-sm font-medium text-slate-700">Device / product<input required value={form.productName} onChange={e => update('productName', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="block text-sm font-medium text-slate-700">Serial number<input value={form.serialNumber} onChange={e => update('serialNumber', e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="block text-sm font-medium text-slate-700">Accessories received<input value={form.accessories} onChange={e => update('accessories', e.target.value)} placeholder="Charger, case, battery..." className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        </div>

        <label className="block text-sm font-medium text-slate-700">Issue description<textarea required value={form.issueDescription} onChange={e => update('issueDescription', e.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-800">Preferred workflow</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="rounded-lg border border-slate-200 p-3 text-sm"><input type="radio" checked={form.repairPath === 'diagnosis_first'} onChange={() => update('repairPath', 'diagnosis_first')} className="mr-2" /> Diagnosis first</label>
            <label className="rounded-lg border border-slate-200 p-3 text-sm"><input type="radio" checked={form.repairPath === 'direct_repair'} onChange={() => update('repairPath', 'direct_repair')} className="mr-2" /> Direct repair with waiver</label>
          </div>
          {form.repairPath === 'direct_repair' && (
            <label className="mt-4 flex gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <input type="checkbox" checked={form.liabilityWaiverAccepted} onChange={e => update('liabilityWaiverAccepted', e.target.checked)} />
              <span>I authorise Deed to proceed with direct repair work and acknowledge that customer-caused damage, liquid damage, previous tampering, or unavailable parts may affect warranty coverage and repair outcome.</span>
            </label>
          )}
        </div>

        <button disabled={submitting} className="w-full rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">{submitting ? 'Submitting…' : 'Submit repair request'}</button>
      </form>
    </main>
  )
}
