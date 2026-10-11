'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { DOCUMENT_RULES } from '@/lib/credit/credit-facility-rules'
import {
  BUSINESS_FIELDS, BUSINESS_TYPES, DECLARATION_TEXT, GROUPS, PAYMENT_METHODS, PAYMENT_POLICY_TERMS, STAKEHOLDERS,
  type FieldDef, type GroupDef,
} from '@/lib/credit/credit-form-fields'

type Json = Record<string, any>
type PortalDoc = { id: string; kind: string; name: string; status: string; uploadedVia: string; createdAt: string; note: string | null }
type PortalView = {
  ref: string; customer: string; status: string; editable: boolean
  requestedLimit: number; requestedTermsDays: number
  form: Json; prefill: Json; infoRequest: string | null
  documents: PortalDoc[]; expiresAt: string | null
}

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#1B2762] focus:outline-none focus:ring-2 focus:ring-[#1B2762]/15 disabled:bg-slate-100 disabled:text-slate-500'
const label = 'mb-1 block text-xs font-semibold text-slate-600'
const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'
const kes = (n: number) => `KES ${Number(n || 0).toLocaleString('en-KE')}`

function Field({ def, value, disabled, onChange }: { def: FieldDef; value: unknown; disabled: boolean; onChange: (v: string) => void }) {
  const v = value == null ? '' : String(value)
  return (
    <label className={def.type === 'textarea' ? 'sm:col-span-2' : ''}>
      <span className={label}>{def.label}</span>
      {def.type === 'textarea'
        ? <textarea className={input} rows={3} value={v} disabled={disabled} onChange={e => onChange(e.target.value)} />
        : <input className={input} type={def.type ?? 'text'} value={v} disabled={disabled} onChange={e => onChange(e.target.value)} />}
    </label>
  )
}

export default function CreditApplicationPortal() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token ?? '')
  const [app, setApp] = useState<PortalView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<Json>({})
  const [limit, setLimit] = useState('')
  const [terms, setTerms] = useState('30')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const adopt = useCallback((view: PortalView, keepForm = false) => {
    setApp(view)
    if (!keepForm) {
      const f = view.form && Object.keys(view.form).length ? view.form : {}
      setForm({ ...Object.fromEntries(Object.entries(view.prefill ?? {}).filter(([, v]) => v)), ...f })
      setLimit(view.requestedLimit ? String(view.requestedLimit) : '')
      setTerms(String(view.requestedTermsDays || 30))
      setDirty(false)
    }
  }, [])

  useEffect(() => {
    fetch(`/api/portal/credit/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error || 'This link is not valid')
        adopt(body.application)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'This link is not valid'))
  }, [token, adopt])

  const save = useCallback(async (quiet = false) => {
    if (!app?.editable) return true
    setBusy('save')
    try {
      const res = await fetch(`/api/portal/credit/${encodeURIComponent(token)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, requestedLimit: Number(limit) || undefined, requestedTermsDays: Number(terms) || undefined }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Could not save')
      adopt(body.application, true)
      setDirty(false)
      if (!quiet) setNotice({ kind: 'ok', text: 'Saved. You can come back to this link to finish later.' })
      return true
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save' })
      return false
    } finally {
      setBusy(null)
    }
  }, [app?.editable, token, form, limit, terms, adopt])

  // Save quietly a few seconds after the client stops typing.
  useEffect(() => {
    if (!dirty) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void save(true) }, 4000)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [dirty, form, limit, terms, save])

  const set = (key: string, v: unknown) => { setForm(f => ({ ...f, [key]: v })); setDirty(true) }
  const rows = (g: GroupDef): Json[] => {
    const r = Array.isArray(form[g.key]) ? form[g.key] as Json[] : []
    return r.length >= g.min ? r : [...r, ...Array.from({ length: g.min - r.length }, () => ({}))]
  }
  const setRow = (g: GroupDef, i: number, key: string, v: string) => set(g.key, rows(g).map((row, j) => j === i ? { ...row, [key]: v } : row))

  const upload = async (kind: string, file: File | undefined) => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setNotice({ kind: 'error', text: `${file.name} is larger than 10 MB` }); return }
    setBusy(kind)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind)
      const res = await fetch(`/api/portal/credit/${encodeURIComponent(token)}/documents`, { method: 'POST', body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Upload failed')
      adopt(body.application, true)
      setNotice({ kind: 'ok', text: `${file.name} uploaded` })
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (doc: PortalDoc) => {
    if (!window.confirm(`Remove ${doc.name}?`)) return
    setBusy(doc.id)
    try {
      const res = await fetch(`/api/portal/credit/${encodeURIComponent(token)}/documents/${doc.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Could not remove')
      adopt(body.application, true)
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not remove' })
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    if (!(await save(true))) return
    if (!window.confirm('Submit the application to Deed Technologies? You will not be able to change it afterwards.')) return
    setBusy('submit')
    try {
      const res = await fetch(`/api/portal/credit/${encodeURIComponent(token)}/submit`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Could not submit')
      adopt(body.application)
      setNotice({ kind: 'ok', text: 'Thank you — your application has been submitted. Our finance team will be in touch.' })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not submit' })
    } finally {
      setBusy(null)
    }
  }

  const required = useMemo(() => DOCUMENT_RULES.filter(r => r.kind !== 'credit_bureau_report'), [])

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className={`${card} max-w-md text-center`}>
          <img src="/deed-logo.png" alt="Deed Technologies" className="mx-auto mb-4 h-10" />
          <h1 className="text-lg font-bold text-slate-900">Credit application</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <p className="mt-4 text-sm text-slate-600">Contact <a className="font-semibold text-[#1B2762] underline" href="mailto:finance@deed.co.ke">finance@deed.co.ke</a></p>
        </div>
      </main>
    )
  }
  if (!app) return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading your application…</main>

  const locked = !app.editable

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className={card}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <img src="/deed-logo.png" alt="Deed Technologies" className="h-10 w-auto self-start" />
            <div className="sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Credit application</p>
              <p className="text-lg font-bold text-[#1B2762]">{app.ref}</p>
            </div>
          </div>
          <h1 className="mt-5 text-xl font-bold text-slate-900">{app.customer}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Dear Deed Technologies Partner, thank you for choosing Deed Technologies. To apply for credit terms, kindly complete this form and upload
            the required documents listed below. All shared information will be treated confidentially and used solely for internal purposes.
            For queries, contact <a className="font-semibold text-[#1B2762] underline" href="mailto:finance@deed.co.ke">finance@deed.co.ke</a>.
          </p>
          {locked && <p className="mt-4 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: '#E8F6EE', color: '#14532D' }}>Your application has been submitted and is with our finance team.</p>}
          {app.infoRequest && !locked && <p className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: '#FFF4DB', color: '#713F12' }}><b>Our finance team asked for:</b> {app.infoRequest}</p>}
          {!locked && app.expiresAt && <p className="mt-3 text-xs text-slate-500">Your progress is saved as you go. This link works until {app.expiresAt.slice(0, 10)}.</p>}
        </header>

        {notice && (
          <div role="status" className="sticky top-2 z-10 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow" style={{ background: notice.kind === 'ok' ? '#15803D' : '#B91C1C' }}>
            {notice.text}
            <button type="button" className="float-right opacity-80" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        <section className={card}>
          <h2 className="text-base font-bold text-slate-900">Business details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {BUSINESS_FIELDS.map(def => <Field key={def.key} def={def} value={form[def.key]} disabled={locked} onChange={v => set(def.key, v)} />)}
            <label>
              <span className={label}>Type of business</span>
              <select className={input} value={form.businessType ?? ''} disabled={locked} onChange={e => set('businessType', e.target.value)}>
                <option value="">Choose one</option>
                {BUSINESS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        </section>

        {GROUPS.map(g => (
          <section key={g.key} className={card}>
            <h2 className="text-base font-bold text-slate-900">{g.title}</h2>
            {g.note && <p className="mt-1 text-sm text-slate-600">{g.note}</p>}
            {rows(g).map((row, i) => (
              <div key={i} className="mt-4 rounded-xl border border-slate-200 p-4">
                <p className="mb-3 text-xs font-bold text-slate-500">{i + 1}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {g.fields.map(def => <Field key={def.key} def={def} value={row[def.key]} disabled={locked} onChange={v => setRow(g, i, def.key, v)} />)}
                </div>
              </div>
            ))}
            {!locked && rows(g).length < g.max && (
              <button type="button" className="mt-3 text-sm font-semibold text-[#1B2762] underline" onClick={() => set(g.key, [...rows(g), {}])}>Add another</button>
            )}
          </section>
        ))}

        <section className={card}>
          <h2 className="text-base font-bold text-slate-900">Business stakeholders</h2>
          <p className="mt-1 text-sm text-slate-600">All statements will be sent to the financial controller's email unless otherwise indicated.</p>
          {STAKEHOLDERS.map(([key, title]) => {
            const v = (form.stakeholders?.[key] ?? {}) as Json
            const put = (k: string, val: string) => set('stakeholders', { ...(form.stakeholders ?? {}), [key]: { ...v, [k]: val } })
            return (
              <div key={key} className="mt-4">
                <p className="mb-2 text-sm font-semibold text-slate-800">{title}</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field def={{ key: 'name', label: 'Full name' }} value={v.name} disabled={locked} onChange={val => put('name', val)} />
                  <Field def={{ key: 'email', label: 'Email', type: 'email' }} value={v.email} disabled={locked} onChange={val => put('email', val)} />
                  <Field def={{ key: 'phone', label: 'Cellphone' }} value={v.phone} disabled={locked} onChange={val => put('phone', val)} />
                </div>
              </div>
            )
          })}
        </section>

        <section className={card}>
          <h2 className="text-base font-bold text-slate-900">Credit details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label><span className={label}>Requested credit limit (KES)</span>
              <input className={input} inputMode="decimal" value={limit} disabled={locked} onChange={e => { setLimit(e.target.value.replace(/[^\d.]/g, '')); setDirty(true) }} /></label>
            <label><span className={label}>Requested credit terms (days)</span>
              <input className={input} inputMode="numeric" value={terms} disabled={locked} onChange={e => { setTerms(e.target.value.replace(/\D/g, '')); setDirty(true) }} /></label>
          </div>
          <p className="mt-2 text-xs text-slate-500">Standard credit terms are 30 days from the invoice date unless otherwise agreed.{limit ? ` Requested: ${kes(Number(limit))}.` : ''}</p>
        </section>

        <section className={card}>
          <h2 className="text-base font-bold text-slate-900">Documents</h2>
          <p className="mt-1 text-sm text-slate-600">PDF, photo, Word or Excel, up to 10 MB each. The signed forms are attached to the email you received.</p>
          <div className="mt-4 divide-y divide-slate-100">
            {required.map(rule => {
              const docs = app.documents.filter(d => d.kind === rule.kind)
              const ok = docs.some(d => d.status !== 'rejected')
              return (
                <div key={rule.kind} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{ok ? '✓ ' : ''}{rule.label}{rule.required ? '' : ' (optional)'}</p>
                      {rule.hint && <p className="text-xs text-slate-500">{rule.hint}</p>}
                    </div>
                    {!locked && (
                      <label className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold ${busy === rule.kind ? 'border-slate-200 text-slate-400' : 'border-[#1B2762] text-[#1B2762] hover:bg-[#1B2762]/5'}`}>
                        {busy === rule.kind ? 'Uploading…' : ok ? 'Add another' : 'Upload'}
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" disabled={Boolean(busy)}
                          onChange={e => { void upload(rule.kind, e.target.files?.[0]); e.target.value = '' }} />
                      </label>
                    )}
                  </div>
                  {docs.map(doc => (
                    <div key={doc.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-semibold text-slate-800">{doc.name}</span>
                      {doc.status === 'rejected' && <span className="font-semibold" style={{ color: '#B91C1C' }}>Not accepted{doc.note ? `: ${doc.note}` : ''} — please upload a new copy</span>}
                      {!locked && doc.uploadedVia === 'client' && <button type="button" className="ml-auto underline" style={{ color: '#B91C1C' }} disabled={Boolean(busy)} onClick={() => void remove(doc)}>Remove</button>}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </section>

        <section className={card}>
          <h2 className="text-base font-bold text-slate-900">Payment policy acceptance</h2>
          <p className="mt-1 text-sm text-slate-600">We acknowledge receipt and acceptance of Deed Technologies' Payment Policy for Corporate Clients:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {PAYMENT_POLICY_TERMS.map(t => <li key={t}>{t}</li>)}
          </ol>
          <p className="mt-4 text-xs font-semibold text-slate-600">Payment method</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {PAYMENT_METHODS.map(([key, l]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={Boolean(form.paymentMethods?.includes?.(key))} disabled={locked}
                  onChange={e => set('paymentMethods', e.target.checked ? [...(form.paymentMethods ?? []), key] : (form.paymentMethods ?? []).filter((m: string) => m !== key))} />
                {l}
              </label>
            ))}
          </div>
          <label className="mt-4 flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={Boolean(form.policyAccepted)} disabled={locked}
              onChange={e => { set('policyAccepted', e.target.checked); if (e.target.checked) set('policyAcceptedOn', new Date().toISOString().slice(0, 10)) }} />
            We accept Deed Technologies' Payment Policy for Corporate Clients and commit to adhering to these terms.
          </label>
        </section>

        <section className={card}>
          <h2 className="text-base font-bold text-slate-900">Customer declaration</h2>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={Boolean(form.declarationAccepted)} disabled={locked} onChange={e => set('declarationAccepted', e.target.checked)} />
            {DECLARATION_TEXT}
          </label>
          <p className="mt-2 text-xs text-slate-500">The signatories named above sign and stamp the application form uploaded under Documents.</p>
        </section>

        {!locked && (
          <div className="flex flex-col gap-3 pb-10 sm:flex-row sm:justify-end">
            <button type="button" className="rounded-xl border border-[#1B2762] px-5 py-3 text-sm font-semibold text-[#1B2762]" disabled={Boolean(busy)} onClick={() => void save()}>
              {busy === 'save' ? 'Saving…' : 'Save and finish later'}
            </button>
            <button type="button" className="rounded-xl bg-[#1B2762] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60" disabled={Boolean(busy)} onClick={() => void submit()}>
              {busy === 'submit' ? 'Submitting…' : 'Submit application'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
