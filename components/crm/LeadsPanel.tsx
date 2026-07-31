'use client'

import { useCallback, useEffect, useState } from 'react'
import { fmtDate } from '@/lib/store'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Modal, Field, Input, Select } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'

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
  createdAt: string
}

const STAGE_OPTIONS = [
  { value: 'new', label: 'New' },
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
]

export default function LeadsPanel({
  showToast,
  salesReps,
  currentUserId,
}: {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  salesReps: { id: string; name: string }[]
  currentUserId?: string
}) {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    companyName: '',
    email: '',
    phone: '',
    source: 'website',
    ownerId: currentUserId ?? '',
    notes: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
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

  useEffect(() => { void load() }, [load])

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
      await load()
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
      showToast(`Lead converted — opportunity created`, 'success')
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Convert failed', 'error')
    } finally {
      setConvertingId(null)
    }
  }

  const columns: ColumnDef<LeadRow>[] = [
    {
      key: 'name', label: 'Lead', priority: 1, width: '1.2fr',
      render: row => (
        <div>
          <p className="text-xs font-bold text-t1">{row.name}</p>
          {row.companyName && <p className="text-[10px] text-t3">{row.companyName}</p>}
        </div>
      ),
      exportValue: row => row.name,
    },
    {
      key: 'contact', label: 'Contact', priority: 2, width: '1fr',
      render: row => (
        <div className="text-[10px] text-t2">
          {row.email && <p>{row.email}</p>}
          {row.phone && <p>{row.phone}</p>}
        </div>
      ),
    },
    {
      key: 'stage', label: 'Stage', priority: 1, width: '100px',
      render: row => (
        <span className="text-[10px] font-semibold capitalize px-2 py-0.5 rounded-full bg-[var(--bg-muted)]">
          {row.stage.replace('_', ' ')}
        </span>
      ),
      exportValue: row => row.stage,
    },
    {
      key: 'source', label: 'Source', priority: 3, width: '90px',
      render: row => <span className="text-[10px] text-t3 capitalize">{row.source?.replace('_', ' ') ?? '—'}</span>,
    },
    {
      key: 'created', label: 'Created', priority: 3, width: '90px',
      render: row => <span className="text-[10px] text-t3">{fmtDate(row.createdAt.slice(0, 10))}</span>,
    },
  ]

  if (loading) {
    return <p className="text-xs text-t3 py-6 text-center">Loading leads…</p>
  }

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
          searchPlaceholder="Search leads…"
          emptyMessage="No leads yet"
          exportTitle="Leads"
          exportFilename="leads"
          rowActions={row => (
            row.stage !== 'converted' && row.stage !== 'lost' ? (
              <button
                type="button"
                className="btn-primary text-[10px] py-1 px-2"
                disabled={convertingId === row.id}
                onClick={() => void convertLead(row.id)}
              >
                {convertingId === row.id ? 'Converting…' : 'Convert'}
              </button>
            ) : null
          )}
        />
      </div>

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
