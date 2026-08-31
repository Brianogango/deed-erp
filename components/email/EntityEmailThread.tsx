'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Message = {
  id: string
  direction: string
  subject: string | null
  body: string
  provider: string | null
  status: string
  sentAt: string | null
  deliveredAt: string | null
  receivedAt: string | null
  readAt: string | null
  createdAt: string
}

type Thread = {
  id: string
  participantEmail: string | null
  participantName: string | null
  mailbox: string | null
  subject: string | null
  unreadCount: number
  lastMessageAt: string
  messages: Message[]
}

const stamp = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function EntityEmailThread({
  entityType,
  entityId,
  title = 'Email conversation',
  showToast,
  compact = false,
}: {
  entityType: string
  entityId: string
  title?: string
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void
  compact?: boolean
}) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  const selected = useMemo(
    () => threads.find(thread => thread.id === selectedId) || threads[0] || null,
    [threads, selectedId],
  )

  const load = useCallback(async () => {
    if (!entityType || !entityId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ entityType, entityId })
      const res = await fetch(`/api/communications/email?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status !== 403) showToast?.(body.error || 'Could not load email history', 'error')
        return
      }
      const next = Array.isArray(body.threads) ? body.threads : []
      setThreads(next)
      if (!selectedId && next[0]?.id) setSelectedId(next[0].id)
    } catch {
      showToast?.('Could not load email history', 'error')
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId, selectedId, showToast])

  useEffect(() => { void load() }, [entityType, entityId])

  useEffect(() => {
    if (!selected?.id || !selected.unreadCount) return
    void fetch('/api/communications/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark_read',
        entityType,
        entityId,
        threadId: selected.id,
      }),
    }).catch(() => {})
  }, [selected?.id, selected?.unreadCount, entityType, entityId])

  const sendReply = async () => {
    if (!selected?.id || !reply.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/communications/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply',
          entityType,
          entityId,
          threadId: selected.id,
          message: reply.trim(),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Email reply could not be sent')
      setReply('')
      showToast?.('Email reply queued and recorded.', 'success')
      await load()
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : 'Email reply could not be sent', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-lt)] px-3.5 py-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-3)]">{title}</p>
          <p className="mt-0.5 text-[9px] text-[var(--text-4)]">
            {selected
              ? `${selected.participantName || selected.participantEmail || 'Customer'} · ${selected.mailbox || 'default'}`
              : 'Messages sent from this ERP record and customer replies'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {threads.length > 1 && (
            <select
              value={selected?.id || ''}
              onChange={event => setSelectedId(event.target.value)}
              className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] px-2 py-1.5 text-[9px] font-bold text-[var(--text-2)]"
            >
              {threads.map(thread => (
                <option key={thread.id} value={thread.id}>
                  {thread.subject || thread.participantEmail || 'Email thread'}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-[var(--border-lt)] px-2.5 py-1.5 text-[9px] font-bold text-[var(--text-3)]"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {!selected ? (
        <div className="px-4 py-7 text-center">
          <p className="text-[10px] font-semibold text-[var(--text-4)]">No email conversation recorded for this item yet.</p>
          <p className="mt-1 text-[9px] text-[var(--text-4)]">Use the record's Email/Send action first; replies will then stay linked here.</p>
        </div>
      ) : (
        <>
          <div className={`space-y-2.5 overflow-y-auto bg-[var(--bg-surface)]/45 px-3 py-3 ${compact ? 'max-h-[300px]' : 'max-h-[420px]'}`}>
            {selected.messages.map(message => {
              const outbound = message.direction === 'outbound'
              return (
                <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[90%] rounded-xl px-3 py-2.5 text-[10.5px] leading-relaxed shadow-sm ${outbound
                      ? 'rounded-br-sm bg-[#102A56] text-white'
                      : 'rounded-bl-sm border border-[var(--border-lt)] bg-[var(--bg-card)] text-[var(--text-2)]'}`}
                  >
                    {message.subject && (
                      <p className={`mb-1.5 text-[9px] font-black ${outbound ? 'text-blue-100' : 'text-[var(--text-4)]'}`}>
                        {message.subject}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <div className={`mt-1.5 flex flex-wrap items-center gap-2 text-[8px] ${outbound ? 'text-blue-100' : 'text-[var(--text-4)]'}`}>
                      <span>{stamp(message.receivedAt || message.sentAt || message.createdAt)}</span>
                      {outbound && <span className="uppercase">{message.status.replaceAll('_', ' ')}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="border-t border-[var(--border-lt)] p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={reply}
                onChange={event => setReply(event.target.value.slice(0, 20_000))}
                rows={compact ? 2 : 3}
                placeholder="Reply by email…"
                className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] px-3 py-2 text-[10.5px] text-[var(--text-1)] outline-none focus:border-[#00AEEF]"
              />
              <button
                type="button"
                onClick={() => void sendReply()}
                disabled={!reply.trim() || sending}
                className="rounded-lg bg-[#102A56] px-3.5 py-2.5 text-[9.5px] font-black text-white disabled:opacity-40"
              >
                {sending ? 'Sending…' : 'Reply'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
