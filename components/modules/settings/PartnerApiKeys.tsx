'use client'
import { useEffect, useState } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { Badge, Confirm, Field, Input, Modal } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faKey, faPlus, faCopy, faCircleInfo } from '@fortawesome/free-solid-svg-icons'

interface PartnerKey {
  id: string
  name: string
  prefix: string
  isActive: boolean
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center px-4 sm:px-5 py-3 border-b border-gray-50 gap-2 sm:gap-0">
        <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest">{title}</p>
        {action && <div>{action}</div>}
      </div>
      <div className="px-4 sm:px-5 py-1">{children}</div>
    </div>
  )
}

export default function PartnerApiKeys() {
  const { showToast } = useApp()
  const [keys, setKeys] = useState<PartnerKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [partnerName, setPartnerName] = useState('')
  const [creating, setCreating] = useState(false)
  const [freshKey, setFreshKey] = useState<{ name: string; key: string } | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<PartnerKey | null>(null)

  const refresh = () => {
    fetch('/api/partner-keys')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data?.items) setKeys(data.items) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])

  const createKey = async () => {
    const name = partnerName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/partner-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`)
      setFreshKey({ name, key: data.key })
      setShowCreate(false)
      setPartnerName('')
      refresh()
    } catch (err) {
      showToast(`Could not create the API key: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  const revokeKey = async (target: PartnerKey) => {
    try {
      const res = await fetch(`/api/partner-keys/${target.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Server error (${res.status})`)
      showToast(`Access revoked for ${target.name}`)
      refresh()
    } catch (err) {
      showToast(`Could not revoke the key: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    }
  }

  const copyKey = () => {
    if (!freshKey) return
    navigator.clipboard?.writeText(freshKey.key)
      .then(() => showToast('API key copied to clipboard'))
      .catch(() => showToast('Copy failed — select and copy the key manually', 'error'))
  }

  return (
    <>
      <SectionCard
        title="Partner API Keys"
        action={
          <button className="btn-primary text-[11px]" onClick={() => setShowCreate(true)}>
            <Fa icon={faPlus} style={{ fontSize: 10, marginRight: 5 }} />New Partner Key
          </button>
        }
      >
        <div className="rounded-xl p-3 my-3 flex gap-2.5 items-start" style={{ background: 'var(--info-bg)', border: '1px solid #BFDBFE' }}>
          <Fa icon={faCircleInfo} style={{ fontSize: 12, color: 'var(--navy)', marginTop: 2 }} />
          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--navy-dark)' }}>
            Partners use these keys to read your sellable catalog at{' '}
            <code className="font-mono text-[10.5px] px-1 py-0.5 rounded bg-white border border-gray-200">GET /api/public/v1/products</code>{' '}
            — active, priced, in-stock products only, with no cost prices or internal data.
            Each key is shown <strong>once</strong> at creation; share it with exactly one partner so access can be revoked individually.
            See <code className="font-mono text-[10.5px] px-1 py-0.5 rounded bg-white border border-gray-200">docs/PARTNER_API.md</code> for the full integration guide.
          </p>
        </div>

        {loading ? (
          <p className="text-[11.5px] text-gray-400 py-4">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-[11.5px] text-gray-400 py-4 italic">No partner keys yet — create one to give a reseller access.</p>
        ) : (
          <div className="py-1">
            {keys.map(k => (
              <div key={k.id} className="flex flex-col sm:flex-row sm:items-center justify-between py-3.5 border-b border-gray-50 last:border-0 gap-2">
                <div className="min-w-0 flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'var(--info-bg)' }}>
                    <Fa icon={faKey} style={{ fontSize: 10, color: 'var(--navy)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-gray-800 leading-tight truncate">{k.name}</p>
                    <p className="text-[10.5px] text-gray-400 mt-0.5 font-mono">
                      {k.prefix}…
                      <span className="font-sans"> · created {fmtDate(k.createdAt)} · {k.lastUsedAt ? `last used ${fmtDate(k.lastUsedAt)}` : 'never used'}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge status={k.isActive ? 'active' : 'cancelled'} label={k.isActive ? 'active' : 'revoked'} />
                  {k.isActive && (
                    <button
                      className="text-[10.5px] px-2.5 py-1.5 rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer font-semibold transition-colors"
                      onClick={() => setRevokeTarget(k)}
                    >Revoke</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {showCreate && (
        <Modal title="New Partner API Key" onClose={() => setShowCreate(false)} width={440}>
          <Field label="Partner / Site Name">
            <Input value={partnerName} onChange={setPartnerName} placeholder="e.g. Jumia Storefront — Acme Ltd" />
          </Field>
          <p className="text-[11px] text-gray-400 mb-3">Use one key per partner so each can be revoked without affecting the others.</p>
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn-primary" onClick={createKey} disabled={!partnerName.trim() || creating}>
              {creating ? 'Creating…' : 'Create Key'}
            </button>
          </div>
        </Modal>
      )}

      {freshKey && (
        <Modal title={`API Key for ${freshKey.name}`} onClose={() => setFreshKey(null)} width={520}>
          <div className="rounded-xl p-3 mb-3" style={{ background: 'var(--warning-bg)', border: '1px solid #FDE68A' }}>
            <p className="text-[11.5px] font-semibold" style={{ color: 'var(--warning-text)' }}>
              This key is shown only once — copy it now and share it with the partner over a secure channel.
            </p>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 border border-gray-200 mb-3">
            <code className="font-mono text-[11.5px] break-all flex-1">{freshKey.key}</code>
            <button className="btn-outline text-[11px] flex-shrink-0" onClick={copyKey}>
              <Fa icon={faCopy} style={{ fontSize: 10, marginRight: 4 }} />Copy
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mb-3">
            The partner sends it on every request: <code className="font-mono text-[10px]">Authorization: Bearer {freshKey.key.slice(0, 12)}…</code>
          </p>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setFreshKey(null)}>Done</button>
          </div>
        </Modal>
      )}

      {revokeTarget && (
        <Confirm
          title="Revoke partner access"
          message={`Revoke API access for "${revokeTarget.name}"? Their site will stop receiving your catalog immediately. This cannot be undone.`}
          confirmLabel="Revoke"
          onConfirm={() => { revokeKey(revokeTarget); setRevokeTarget(null) }}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </>
  )
}
