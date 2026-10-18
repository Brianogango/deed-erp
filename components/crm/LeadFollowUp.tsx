'use client'

import { useState } from 'react'
import { Field, Input, Select } from '@/components/ui'
import type { LeadActivity } from '@/lib/crm/lead-activity'

const TYPE_OPTIONS = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email (sent outside the ERP)' },
  { value: 'meeting', label: 'Meeting / visit' },
  { value: 'note', label: 'Note' },
]

const TYPE_LABEL: Record<string, string> = {
  call: 'Call', whatsapp: 'WhatsApp', email: 'Email', meeting: 'Meeting', note: 'Note',
}

/** Kenyan numbers: 07… / 01… → 2547… / 2541… for wa.me links. */
export function whatsappNumber(phone?: string | null): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`
  if (digits.length === 9 && /^[17]/.test(digits)) return `254${digits}`
  return digits
}

function inDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function followUpState(nextFollowUpAt?: string | null): 'overdue' | 'today' | 'later' | 'none' {
  if (!nextFollowUpAt) return 'none'
  const day = nextFollowUpAt.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  if (day < today) return 'overdue'
  if (day === today) return 'today'
  return 'later'
}

export default function LeadFollowUp<T extends { id: string }>({
  lead,
  onUpdated,
  onEmail,
  showToast,
}: {
  lead: {
    id: string
    stage: string
    email?: string | null
    phone?: string | null
    nextFollowUpAt?: string | null
    lastContactedAt?: string | null
    activity?: LeadActivity[] | null
  }
  onUpdated: (lead: T) => void
  onEmail?: () => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [type, setType] = useState('call')
  const [note, setNote] = useState('')
  const [next, setNext] = useState(inDays(2))
  const [saving, setSaving] = useState(false)
  const closed = lead.stage === 'converted' || lead.stage === 'lost'
  const activity = Array.isArray(lead.activity) ? lead.activity : []
  const wa = whatsappNumber(lead.phone)
  const state = followUpState(lead.nextFollowUpAt)

  async function save() {
    if (!note.trim()) { showToast('Write what happened', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log', type, note, nextFollowUpAt: next || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save')
      onUpdated(data)
      setNote('')
      setNext(inDays(2))
      showToast(next ? `Logged — follow up ${next}` : 'Logged', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-lt)] p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] uppercase font-bold text-t4">Follow-up</p>
        <p className="text-[11px]" style={{ color: state === 'overdue' ? 'var(--danger)' : state === 'today' ? 'var(--warning)' : 'var(--text-3)' }}>
          {lead.nextFollowUpAt
            ? `Next: ${lead.nextFollowUpAt.slice(0, 10)}${state === 'overdue' ? ' (overdue)' : state === 'today' ? ' (today)' : ''}`
            : closed ? '' : 'No follow-up set'}
          {lead.lastContactedAt ? ` · last contact ${lead.lastContactedAt.slice(0, 10)}` : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {onEmail && lead.email && (
          <button type="button" className="btn-primary text-[11px] py-1.5 px-3" onClick={onEmail}>Email</button>
        )}
        {lead.phone && (
          <a className="btn-outline text-[11px] py-1.5 px-3" href={`tel:${lead.phone.replace(/\s+/g, '')}`}>Call {lead.phone}</a>
        )}
        {wa && (
          <a className="btn-outline text-[11px] py-1.5 px-3" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a>
        )}
      </div>

      {!closed && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="What did you do?">
              <Select value={type} onChange={setType} options={TYPE_OPTIONS} />
            </Field>
            <Field label="Next follow-up">
              <Input type="date" value={next} onChange={setNext} />
            </Field>
          </div>
          <Field label="What happened">
            <textarea
              aria-label="What happened"
              className="form-input w-full text-[12px]"
              rows={2}
              value={note}
              placeholder="e.g. Called — wants 10 laptops, send quote by Friday"
              onChange={e => setNote(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline text-[11px] py-1.5 px-3" onClick={() => setNext('')}>No follow-up</button>
            <button type="button" className="btn-primary text-[11px] py-1.5 px-3" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Log it'}
            </button>
          </div>
        </div>
      )}

      {activity.length > 0 && (
        <ul className="space-y-2 max-h-56 overflow-y-auto">
          {activity.map(a => (
            <li key={a.id} className="text-[11px] border-l-2 border-[var(--border)] pl-2">
              <p className="text-t3">
                <strong className="text-t1">{TYPE_LABEL[a.type] ?? a.type}</strong> · {new Date(a.at).toLocaleString()} · {a.byName}
                {a.nextFollowUpAt ? ` · next ${a.nextFollowUpAt.slice(0, 10)}` : ''}
              </p>
              <p className="text-t2 whitespace-pre-wrap">{a.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
