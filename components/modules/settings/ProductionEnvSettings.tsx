'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Field, Input, ToneBadge } from '@/components/ui'

type EnvKind = 'secret' | 'value' | 'flag'
type EnvField = {
  key: string
  category: string
  kind: EnvKind
  required: boolean
  generate: boolean
  readOnly: boolean
  description: string
  present: boolean
  length: number
  placeholder: boolean
  restartRequired: boolean
  value?: string
  database?: { host: string; user: string; name: string }
}

function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="settings-section-card bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center px-4 sm:px-5 py-3 border-b border-gray-50 gap-2 sm:gap-0">
        <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest">{title}</p>
        {action && <div>{action}</div>}
      </div>
      <div className="px-4 sm:px-5 py-1">{children}</div>
    </section>
  )
}

function statusFor(field: EnvField): { label: string; tone: 'sage' | 'coral' | 'honey' } {
  if (field.required && !field.present) return { label: 'Missing', tone: 'coral' }
  if (field.placeholder) return { label: 'Placeholder', tone: 'coral' }
  if (field.present) return { label: 'Set', tone: 'sage' }
  return { label: 'Optional', tone: 'honey' }
}

export default function ProductionEnvSettings({
  showToast,
}: {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [fields, setFields] = useState<EnvField[]>([])
  const [confirmPhrase, setConfirmPhrase] = useState('SAVE DEED ERP ENV')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [generate, setGenerate] = useState<Record<string, boolean>>({})
  const [confirm, setConfirm] = useState('')
  const [reload, setReload] = useState(true)
  const [addKey, setAddKey] = useState('')
  const [addValue, setAddValue] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/security/env', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 403) {
        setError('Only the Director can add or rotate production secrets.')
        return
      }
      if (!res.ok) throw new Error(data.error || 'Could not load environment settings')
      setFields(data.fields || [])
      setConfirmPhrase(data.confirmPhrase || 'SAVE DEED ERP ENV')
      setDrafts({})
      setGenerate({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load environment settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const grouped = useMemo(() => {
    const map = new Map<string, EnvField[]>()
    for (const field of fields) {
      const list = map.get(field.category) ?? []
      list.push(field)
      map.set(field.category, list)
    }
    return [...map.entries()]
  }, [fields])

  const issues = fields.filter(field => (field.required && !field.present) || field.placeholder)
  const pendingCount = Object.keys(drafts).filter(key => drafts[key] !== undefined && drafts[key] !== '').length
    + Object.values(generate).filter(Boolean).length
    + (addKey.trim() ? 1 : 0)

  const save = async () => {
    const updates: Record<string, string> = {}
    for (const [key, value] of Object.entries(drafts)) {
      const field = fields.find(item => item.key === key)
      if (field?.kind === 'secret' && value === '') continue
      updates[key] = value
    }
    const generateKeys = Object.entries(generate).filter(([, on]) => on).map(([key]) => key)
    const add = addKey.trim()
      ? { key: addKey.trim().toUpperCase(), value: addValue }
      : undefined
    if (!Object.keys(updates).length && !generateKeys.length && !add) {
      showToast('Nothing to save', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/security/env', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates,
          generate: generateKeys,
          add,
          reload,
          confirm,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setFields(data.fields || [])
      setDrafts({})
      setGenerate({})
      setAddKey('')
      setAddValue('')
      setConfirm('')
      showToast(data.message || 'Environment saved', data.reloadError ? 'error' : 'success')
      if (data.reloadError) showToast(`Saved, but reload failed: ${data.reloadError}`, 'error')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save environment', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-xs text-gray-500 py-4">Loading production environment…</p>
  }
  if (error) {
    return (
      <SectionCard title="Production environment">
        <p className="text-xs text-amber-800 py-3">{error}</p>
      </SectionCard>
    )
  }

  return (
    <>
      <SectionCard
        title="Production environment"
        action={
          <button type="button" className="btn-secondary text-[11px] min-h-[44px]" onClick={() => void load()}>
            Refresh
          </button>
        }
      >
        <div className="py-3 flex flex-col gap-3">
          <p className="text-[12px] text-gray-500 leading-relaxed">
            Add or rotate every live <span className="font-mono">.env</span> setting from here. Secret values are never sent back to the browser. Saving writes the server environment file; tick reload so PM2 picks up secrets immediately.
          </p>
          <div className={`rounded-xl border px-3 py-2 text-xs font-semibold ${issues.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            {issues.length
              ? `${issues.length} required or placeholder value${issues.length === 1 ? '' : 's'} still need attention.`
              : 'Required environment values are present and do not look like placeholders.'}
          </div>
        </div>
      </SectionCard>

      {grouped.map(([category, rows]) => (
        <SectionCard key={category} title={category}>
          {rows.map(field => {
            const status = statusFor(field)
            return (
              <div key={field.key} className="py-3.5 border-b border-gray-50 last:border-0 flex flex-col gap-2">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-gray-800 font-mono leading-tight">{field.key}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{field.description}</p>
                    {field.database && (
                      <p className="text-[11px] text-gray-500 mt-1 font-mono">
                        {field.database.user}@{field.database.host}/{field.database.name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
                    {field.present && <span className="text-[10px] text-gray-400 font-mono">{field.length} chars</span>}
                  </div>
                </div>
                {field.readOnly ? (
                  <p className="text-[11px] text-gray-500">Read only{field.value ? ` — ${field.value}` : ''}.</p>
                ) : field.kind === 'secret' ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="password"
                      autoComplete="new-password"
                      aria-label={`New value for ${field.key}`}
                      className="flex-1 text-[12px] px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-navy-500 min-h-[44px]"
                      placeholder={field.generate ? 'Paste a new secret or generate one' : 'Paste the provider secret'}
                      value={drafts[field.key] ?? ''}
                      onChange={e => {
                        setDrafts(prev => ({ ...prev, [field.key]: e.target.value }))
                        if (e.target.value) setGenerate(prev => ({ ...prev, [field.key]: false }))
                      }}
                    />
                    {field.generate && (
                      <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-gray-700 min-h-[44px] px-3 rounded-lg border border-gray-200 bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(generate[field.key])}
                          onChange={e => {
                            setGenerate(prev => ({ ...prev, [field.key]: e.target.checked }))
                            if (e.target.checked) setDrafts(prev => ({ ...prev, [field.key]: '' }))
                          }}
                        />
                        Generate
                      </label>
                    )}
                  </div>
                ) : field.kind === 'flag' ? (
                  <select
                    aria-label={field.key}
                    className="text-[12px] px-3 py-2 border border-gray-200 rounded-lg min-h-[44px] max-w-xs bg-white"
                    value={drafts[field.key] ?? field.value ?? ''}
                    onChange={e => setDrafts(prev => ({ ...prev, [field.key]: e.target.value }))}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    aria-label={field.key}
                    className="w-full text-[12px] px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-navy-500 min-h-[44px]"
                    value={drafts[field.key] ?? field.value ?? ''}
                    onChange={e => setDrafts(prev => ({ ...prev, [field.key]: e.target.value }))}
                  />
                )}
              </div>
            )
          })}
        </SectionCard>
      ))}

      <SectionCard title="Add a custom variable">
        <div className="py-3 flex flex-col gap-3">
          <p className="text-[11px] text-gray-500">Use this for provider keys that are not in the catalog yet. Names must be UPPER_SNAKE_CASE. Secret-looking names are stored but never displayed.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={addKey} onChange={setAddKey} placeholder="MPESA_CONSUMER_KEY" />
            </Field>
            <Field label="Value">
              <Input value={addValue} onChange={setAddValue} placeholder="Value" type="password" />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Save to the server">
        <div className="py-3 flex flex-col gap-3">
          <p className="text-[11px] text-gray-500">
            Type <span className="font-mono font-semibold">{confirmPhrase}</span> to confirm. Generating AUTH/NEXTAUTH secrets signs every user out. Generating MFA_ENCRYPTION_KEY requires privileged users to enroll a new authenticator.
          </p>
          <label className="inline-flex items-center gap-2 text-[12px] text-gray-700 min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={reload} onChange={e => setReload(e.target.checked)} />
            Reload the live app after saving so new secrets take effect
          </label>
          <Field label="Confirmation">
            <Input value={confirm} onChange={setConfirm} placeholder={confirmPhrase} />
          </Field>
          <button
            type="button"
            className="btn-primary text-xs self-start min-h-[44px]"
            disabled={saving || pendingCount === 0 || confirm !== confirmPhrase}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : `Save ${pendingCount || ''} change${pendingCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </SectionCard>
    </>
  )
}
