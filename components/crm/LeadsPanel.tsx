'use client'

import { useCallback, useEffect, useState } from 'react'
import { fmtDate } from '@/lib/store'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Modal, Field, Input, Select } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'

export type LeadAttachment = {
  id: string
  name: string
  size: number
  contentType: string
  storedAt?: string
}

export type LeadRow = {
  id: string
  name: string
  companyName?: string | null
  email?: string | null
  phone?: string | null
  source?: string | null
  stage: string
  ownerId?: string | null
  owner?: { id: string; username?: string; email?: string } | null
  opportunityId?: string | null
  notes?: string | null
  inboundMessageId?: string | null
  emailSubject?: string | null
  emailSnippet?: string | null
  emailBody?: string | null
  emailReceivedAt?: string | null
  emailAttachments?: LeadAttachment[] | null
  createdAt: string
}

const STAGE_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'lost', label: 'Lost' },
  { value: 'converted', label: 'Converted' },
]

const SOURCE_OPTIONS = [
  { value: 'website', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'cold_call', label: 'Cold call' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'partner', label: 'Partner' },
  { value: 'inbound_email', label: 'Sales inbox' },
]

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function ownerLabel(row: LeadRow, salesReps: { id: string; name: string }[]) {
  if (!row.ownerId) return '—'
  const fromReps = salesReps.find(r => r.id === row.ownerId)?.name
  return fromReps || row.owner?.username || row.owner?.email || 'Assigned'
}

function isInbound(row: LeadRow) {
  return row.source === 'inbound_email' || Boolean(row.inboundMessageId) || Boolean(row.emailSubject) || Boolean(row.notes?.includes('Inbound email to sales@'))
}

function displayEmailContext(row: LeadRow) {
  if (row.emailSubject || row.emailSnippet || row.emailBody) {
    return {
      subject: row.emailSubject,
      snippet: row.emailSnippet,
      body: row.emailBody || row.notes,
    }
  }
  // Older inbound leads only have the notes blob
  if (!row.notes) return { subject: null, snippet: null, body: null }
  const subject =
    row.notes.match(/^Re:\s*(.+)$/m)?.[1]?.trim()
    || row.notes.match(/^Subject:\s*(.+)$/m)?.[1]?.trim()
    || null
  const parts = row.notes.split(/\n\n/)
  const body = parts.length > 1 ? parts.slice(1).join('\n\n').trim() : row.notes
  const snippet = body.replace(/\s+/g, ' ').trim()
  return {
    subject,
    snippet: snippet.length > 240 ? `${snippet.slice(0, 240)}…` : snippet,
    body,
  }
}

export default function LeadsPanel({
  showToast,
  salesReps,
  currentUserId,
  onConverted,
}: {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  salesReps: { id: string; name: string }[]
  currentUserId?: string
  /** Called after a successful convert so CRM can open the new opportunity / pipeline. */
  onConverted?: (opportunityId: string) => void
}) {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<LeadRow | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [savingOwnerId, setSavingOwnerId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    companyName: '',
    email: '',
    phone: '',
    source: 'website',
    ownerId: currentUserId ?? '',
    notes: '',
  })

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    // Soft reload keeps the table mounted — full unmount caused visible shake.
    if (!opts?.soft) setLoading(true)
    try {
      const res = await fetch('/api/leads')
      if (!res.ok) throw new Error('Failed to load leads')
      const data = await res.json()
      setLeads(Array.isArray(data) ? data : [])
    } catch {
      setLeads([])
      showToast('Could not load leads', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { void load({ soft: false }) }, [load])

  async function createLead() {
    if (!form.name.trim()) {
      showToast('Lead name is required', 'error')
      return
    }
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Create failed')
      }
      showToast('Lead created', 'success')
      setShowForm(false)
      setForm({ name: '', companyName: '', email: '', phone: '', source: 'website', ownerId: currentUserId ?? '', notes: '' })
      await load({ soft: true })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Create failed', 'error')
    }
  }

  async function convertLead(id: string) {
    setConvertingId(id)
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert', createContact: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Convert failed')
      showToast('Lead converted — opportunity created', 'success')
      setDetail(null)
      await load({ soft: true })
      const opportunityId = String(data.opportunity?.id || data.lead?.opportunityId || '')
      if (opportunityId) onConverted?.(opportunityId)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Convert failed', 'error')
    } finally {
      setConvertingId(null)
    }
  }

  async function deleteLead(row: LeadRow) {
    const label = row.name || 'this lead'
    const convertedNote = row.stage === 'converted'
      ? ' This lead is already converted — the opportunity will stay; only the lead record is removed.'
      : ''
    if (!window.confirm(`Delete “${label}”? This cannot be undone.${convertedNote}`)) return

    setDeletingId(row.id)
    try {
      const res = await fetch(`/api/leads/${row.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      showToast('Lead deleted', 'success')
      if (detail?.id === row.id) setDetail(null)
      setLeads(prev => prev.filter(l => l.id !== row.id))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function updateLeadFields(id: string, patch: { ownerId?: string | null; stage?: string }) {
    setSavingOwnerId(id)
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Update failed')

      // Converted leads own an opportunity — keep the pipeline owner in sync.
      const oppId = String(data.opportunityId || data.opportunity?.id || '')
      if (oppId && patch.ownerId !== undefined) {
        try {
          await fetch(`/api/opportunities/${oppId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ownerId: patch.ownerId || null,
              assignedToId: patch.ownerId || null,
            }),
          })
        } catch {
          /* opportunity sync is best-effort; lead owner already saved */
        }
      }

      const nextFields = {
        ownerId: data.ownerId ?? null,
        stage: data.stage ?? patch.stage,
        owner: data.owner ?? undefined,
        opportunityId: data.opportunityId ?? undefined,
      }
      setLeads(prev => prev.map(l => (l.id === id ? { ...l, ...nextFields } : l)))
      setDetail(prev => (prev && prev.id === id ? { ...prev, ...nextFields } : prev))
      showToast(
        patch.ownerId !== undefined
          ? (patch.ownerId ? 'Lead reassigned' : 'Lead unassigned')
          : 'Lead updated',
        'success',
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error')
    } finally {
      setSavingOwnerId(null)
    }
  }

  const columns: ColumnDef<LeadRow>[] = [
    {
      key: 'name', label: 'Lead', priority: 1, width: '1.1fr',
      render: row => (
        <button type="button" className="text-left" onClick={() => setDetail(row)}>
          <p className="text-xs font-bold text-t1 hover:underline">{row.name}</p>
          {row.companyName && <p className="text-[10px] text-t3">{row.companyName}</p>}
        </button>
      ),
      exportValue: row => row.name,
    },
    {
      key: 'emailContext', label: 'Email', priority: 1, width: '1.4fr',
      render: row => {
        const ctx = displayEmailContext(row)
        return (
          <button type="button" className="text-left w-full" onClick={() => setDetail(row)}>
            {isInbound(row) ? (
              <div>
                <p className="text-[11px] font-semibold text-t1 line-clamp-1">
                  {ctx.subject || '(no subject)'}
                </p>
                <p className="text-[10px] text-t3 line-clamp-2">
                  {ctx.snippet || row.email || 'Open for full message'}
                </p>
                {Array.isArray(row.emailAttachments) && row.emailAttachments.length > 0 && (
                  <p className="text-[9px] text-t3 mt-0.5">
                    {row.emailAttachments.length} attachment{row.emailAttachments.length === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-t2">
                {row.email && <p>{row.email}</p>}
                {row.phone && <p>{row.phone}</p>}
                {!row.email && !row.phone && <p className="text-t3">—</p>}
              </div>
            )}
          </button>
        )
      },
      exportValue: row => displayEmailContext(row).subject || row.email || '',
    },
    {
      key: 'stage', label: 'Stage', priority: 2, width: '90px',
      render: row => (
        <span className="text-[10px] font-semibold capitalize px-2 py-0.5 rounded-full bg-[var(--bg-muted)]">
          {row.stage.replace(/_/g, ' ')}
        </span>
      ),
      exportValue: row => row.stage,
    },
    {
      key: 'owner', label: 'Owner', priority: 2, width: '100px',
      render: row => <span className="text-[10px] text-t2">{ownerLabel(row, salesReps)}</span>,
      exportValue: row => ownerLabel(row, salesReps),
    },
    {
      key: 'source', label: 'Source', priority: 3, width: '90px',
      render: row => <span className="text-[10px] text-t3 capitalize">{row.source?.replace('_', ' ') ?? '—'}</span>,
    },
    {
      key: 'created', label: 'Created', priority: 3, width: '80px',
      render: row => <span className="text-[10px] text-t3">{fmtDate(row.createdAt.slice(0, 10))}</span>,
    },
  ]

  const detailAttachments = Array.isArray(detail?.emailAttachments) ? detail!.emailAttachments! : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <PrimaryActionButton onClick={() => setShowForm(true)}>+ New lead</PrimaryActionButton>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          tableId="crm-leads"
          columns={columns}
          rows={leads}
          rowKey={r => r.id}
          isLoading={loading}
          searchPlaceholder="Search leads…"
          emptyMessage="No leads yet"
          exportTitle="Leads"
          exportFilename="leads"
          rowActions={row => (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn-outline text-[10px] py-1 px-2"
                onClick={() => setDetail(row)}
              >
                Open
              </button>
              {row.stage !== 'converted' && row.stage !== 'lost' ? (
                <button
                  type="button"
                  className="btn-primary text-[10px] py-1 px-2"
                  disabled={convertingId === row.id || deletingId === row.id}
                  onClick={() => void convertLead(row.id)}
                >
                  {convertingId === row.id ? 'Converting…' : 'Convert'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-outline text-[10px] py-1 px-2"
                style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                disabled={deletingId === row.id || convertingId === row.id}
                onClick={() => void deleteLead(row)}
              >
                {deletingId === row.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        />
      </div>

      {detail && (() => {
        const ctx = displayEmailContext(detail)
        return (
        <Modal title={detail.name} onClose={() => setDetail(null)} width={680}>
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] uppercase font-bold text-t4">Company</p>
                <p className="text-t1">{detail.companyName || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-t4 mb-1">Owner</p>
                <Select
                  value={detail.ownerId || ''}
                  disabled={savingOwnerId === detail.id}
                  onChange={v => void updateLeadFields(detail.id, { ownerId: v || null })}
                  options={[{ value: '', label: '— Unassigned —' }, ...salesReps.map(r => ({ value: r.id, label: r.name }))]}
                />
                {detail.stage === 'converted' && (
                  <p className="text-[10px] text-t3 mt-1">Reassigns the linked opportunity owner too.</p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-t4">Contact</p>
                <p className="text-t1">{detail.email || '—'}</p>
                {detail.phone && <p className="text-t3">{detail.phone}</p>}
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-t4 mb-1">Stage</p>
                <Select
                  value={detail.stage}
                  disabled={savingOwnerId === detail.id || detail.stage === 'converted'}
                  onChange={v => void updateLeadFields(detail.id, { stage: v })}
                  options={STAGE_OPTIONS}
                />
                <p className="text-[10px] text-t3 mt-1 capitalize">Source: {detail.source?.replace(/_/g, ' ') ?? '—'}</p>
              </div>
            </div>

            {(ctx.subject || ctx.body || detail.notes) && (
              <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3 space-y-2">
                <p className="text-[10px] uppercase font-bold text-t4">
                  {isInbound(detail) ? 'Inbound email' : 'Notes'}
                </p>
                {ctx.subject && (
                  <p className="font-semibold text-t1">{ctx.subject}</p>
                )}
                {detail.emailReceivedAt && (
                  <p className="text-[10px] text-t3">
                    Received {new Date(detail.emailReceivedAt).toLocaleString()}
                  </p>
                )}
                <pre className="whitespace-pre-wrap text-[11px] text-t2 font-sans max-h-64 overflow-y-auto">
                  {ctx.body || detail.notes || 'No message body stored.'}
                </pre>
              </div>
            )}

            {detailAttachments.length > 0 && (
              <div>
                <p className="text-[10px] uppercase font-bold text-t4 mb-1">Attachments</p>
                <ul className="space-y-1">
                  {detailAttachments.map(att => (
                    <li key={att.id}>
                      <a
                        className="text-[11px] text-[var(--primary)] hover:underline"
                        href={`/api/leads/${detail.id}/attachments?file=${encodeURIComponent(att.id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {att.name}
                      </a>
                      <span className="text-[10px] text-t3 ml-2">
                        {formatBytes(att.size)} · {att.contentType}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex justify-between gap-2 mt-4">
            <button
              type="button"
              className="btn-outline text-xs"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
              disabled={deletingId === detail.id || convertingId === detail.id}
              onClick={() => void deleteLead(detail)}
            >
              {deletingId === detail.id ? 'Deleting…' : 'Delete'}
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-outline text-xs" onClick={() => setDetail(null)}>Close</button>
              {detail.stage !== 'converted' && detail.stage !== 'lost' && (
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={convertingId === detail.id || deletingId === detail.id}
                  onClick={() => void convertLead(detail.id)}
                >
                  {convertingId === detail.id ? 'Converting…' : 'Convert'}
                </button>
              )}
            </div>
          </div>
        </Modal>
        )
      })()}

      {showForm && (
        <Modal title="New lead" onClose={() => setShowForm(false)} width={520}>
          <div className="space-y-3">
            <Field label="Name *"><Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} /></Field>
            <Field label="Company"><Input value={form.companyName} onChange={v => setForm(f => ({ ...f, companyName: v }))} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email"><Input value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Source">
                <Select value={form.source} onChange={v => setForm(f => ({ ...f, source: v }))} options={SOURCE_OPTIONS} />
              </Field>
              <Field label="Owner">
                <Select
                  value={form.ownerId}
                  onChange={v => setForm(f => ({ ...f, ownerId: v }))}
                  options={[{ value: '', label: '— Unassigned —' }, ...salesReps.map(r => ({ value: r.id, label: r.name }))]}
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className="form-input w-full text-xs" rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" className="btn-outline text-xs" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="button" className="btn-primary text-xs" onClick={() => void createLead()}>Save lead</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
