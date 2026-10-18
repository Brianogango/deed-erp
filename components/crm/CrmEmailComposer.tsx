'use client'

import { useState } from 'react'
import { Modal, Field, Input } from '@/components/ui'

function inDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Email a lead or a deal's contact without leaving the CRM. It goes out under
 * the rep's own name and work address; replies come back to the rep and to
 * sales@. The email is logged on the record, with a date to chase it.
 */
export default function CrmEmailComposer({
  target,
  defaultTo,
  defaultSubject,
  defaultBody,
  onSent,
  onClose,
  showToast,
}: {
  target: { leadId: string } | { opportunityId: string }
  defaultTo?: string | null
  defaultSubject?: string | null
  defaultBody?: string
  onSent: (data: Record<string, unknown>) => void
  onClose: () => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [to, setTo] = useState(defaultTo ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(defaultSubject ?? '')
  const [body, setBody] = useState(defaultBody ?? '')
  const [chase, setChase] = useState(inDays(3))
  const [sending, setSending] = useState(false)

  async function send() {
    const missing = [!to.trim() && 'To', !subject.trim() && 'Subject', !body.trim() && 'Message'].filter(Boolean)
    if (missing.length) { showToast(`Required: ${missing.join(', ')}`, 'error'); return }
    setSending(true)
    try {
      const res = await fetch('/api/crm/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, to, cc: cc || undefined, subject, body, nextFollowUpAt: chase || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The email was not sent')
      showToast(chase ? `Email sent — follow up ${chase} if no reply` : 'Email sent', 'success')
      onSent(data)
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The email was not sent', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal title="Send email" subtitle="Sent from your work address; replies come to you and to sales@" onClose={onClose} width={600}>
      <div className="space-y-3">
        <Field label="To *"><Input value={to} onChange={setTo} placeholder="customer@company.co.ke" /></Field>
        <Field label="Cc"><Input value={cc} onChange={setCc} placeholder="Optional, separate with commas" /></Field>
        <Field label="Subject *"><Input value={subject} onChange={setSubject} /></Field>
        <Field label="Message *">
          <textarea
            aria-label="Message"
            className="form-input w-full text-[12px]"
            rows={9}
            value={body}
            onChange={e => setBody(e.target.value)}
          />
        </Field>
        <Field label="Remind me to follow up if no reply">
          <Input type="date" value={chase} onChange={setChase} />
        </Field>
        <p className="text-[10px] text-t3">Your name and work email are added under the message.</p>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" className="btn-outline text-xs" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary text-xs" disabled={sending} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </Modal>
  )
}
