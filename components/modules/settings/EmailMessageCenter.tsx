'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type EmailMessage = {
  id: string
  direction: 'inbound' | 'outbound' | string
  subject: string | null
  body: string
  provider: string | null
  providerMessageId: string | null
  eventType: string | null
  entityType: string | null
  entityId: string | null
  senderEmail: string | null
  recipientEmail: string | null
  status: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  receivedAt: string | null
  createdAt: string
}

type ThreadSummary = {
  id: string
  participantEmail: string | null
  participantName: string | null
  mailbox: string | null
  subject: string | null
  entityType: string | null
  entityId: string | null
  status: string
  unreadCount: number
  lastMessageAt: string
  messageCount: number
  latest: {
    id: string
    direction: string
    subject: string | null
    body: string
    status: string
    createdAt: string
    receivedAt: string | null
    sentAt: string | null
  } | null
}

type SelectedThread = Omit<ThreadSummary, 'messageCount' | 'latest'> & {
  messages: EmailMessage[]
}

type ApiResponse = {
  folder: string
  mailbox: string
  unreadTotal: number
  threads: ThreadSummary[]
  selected: SelectedThread | null
}

const statusTone = (status: string) => {
  if (['delivered', 'read', 'received', 'sent'].includes(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (['failed', 'dead_letter'].includes(status)) return 'bg-red-50 text-red-700 border-red-200'
  if (['queued', 'sending', 'retrying'].includes(status)) return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-slate-50 text-slate-600 border-slate-200'
}

const when = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function EmailMessageCenter({
  showToast,
}: {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [folder, setFolder] = useState<'all' | 'inbox' | 'sent' | 'failed'>('all')
  const [mailbox, setMailbox] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async (threadId = selectedId) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ folder })
      if (mailbox !== 'all') params.set('mailbox', mailbox)
      if (query.trim()) params.set('q', query.trim())
      if (threadId) params.set('threadId', threadId)
      const res = await fetch(`/api/admin/email/messages?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not load email conversations', 'error')
        return
      }
      setData(body)
      if (!threadId && body.threads?.[0]?.id) setSelectedId(body.threads[0].id)
    } catch {
      showToast('Could not reach email message history', 'error')
    } finally {
      setLoading(false)
    }
  }, [folder, mailbox, query, selectedId, showToast])

  useEffect(() => { void load('') }, [folder, mailbox])
  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, 30000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!selectedId) return
    void load(selectedId)
    void fetch('/api/admin/email/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_read', threadId: selectedId }),
    }).catch(() => {})
  }, [selectedId])

  const selected = data?.selected && data.selected.id === selectedId ? data.selected : null
  const folders = useMemo(() => ([
    { id: 'all' as const, label: 'All' },
    { id: 'inbox' as const, label: 'Inbox' },
    { id: 'sent' as const, label: 'Sent' },
    { id: 'failed' as const, label: 'Failed' },
  ]), [])

  const sendReply = async () => {
    const text = reply.trim()
    if (!selectedId || !text) return
    setSending(true)
    try {
      const res = await fetch('/api/admin/email/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', threadId: selectedId, message: text }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Email reply could not be sent', 'error')
        return
      }
      setReply('')
      showToast('Email reply queued and logged', 'success')
      await load(selectedId)
    } catch {
      showToast('Could not send email reply', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">Email Message Center</p>
            {(data?.unreadTotal || 0) > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#00AEEF] px-1.5 py-0.5 text-[9px] font-black text-white">
                {data?.unreadTotal}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-gray-500">Outbound history, replies and linked ERP records across departmental mailboxes.</p>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row">
          <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1">
            {folders.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setFolder(item.id); setSelectedId('') }}
                className={`min-h-8 rounded-lg px-3 text-[10px] font-bold transition ${folder === item.id ? 'bg-white text-[#102A56] shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <select
            value={mailbox}
            onChange={event => { setMailbox(event.target.value); setSelectedId('') }}
            className="min-h-10 rounded-xl border border-gray-200 bg-white px-3 text-[10px] font-bold text-gray-600"
          >
            <option value="all">All mailboxes</option>
            <option value="sales">Sales</option>
            <option value="accounts">Accounts</option>
            <option value="repairs">Repairs</option>
            <option value="procurement">Procurement</option>
            <option value="hr">HR</option>
            <option value="default">General</option>
          </select>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && void load('')}
              placeholder="Search email, subject or ref"
              className="min-h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-[11px] outline-none focus:border-[#00AEEF] sm:w-56"
            />
            <button type="button" onClick={() => void load('')} className="min-h-10 rounded-xl border border-gray-200 px-3 text-[10px] font-bold text-gray-700">
              {loading ? 'Loading…' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-[600px] grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)]">
        <aside className={`border-r border-gray-100 bg-[#FAFCFF] ${selectedId ? 'hidden lg:block' : 'block'}`}>
          {!data?.threads?.length ? (
            <div className="px-5 py-12 text-center text-[11px] text-gray-400">No email conversations in this view.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {data.threads.map(thread => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedId(thread.id)}
                  className={`w-full px-4 py-3.5 text-left transition hover:bg-white ${selectedId === thread.id ? 'bg-white shadow-[inset_3px_0_0_#00AEEF]' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-extrabold text-[#14213D]">{thread.participantName || thread.participantEmail || 'Unknown recipient'}</p>
                      <p className="mt-0.5 truncate text-[9.5px] font-medium text-gray-400">{thread.participantEmail}</p>
                    </div>
                    {thread.unreadCount > 0 && (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#00AEEF] px-1.5 py-0.5 text-[9px] font-black text-white">{thread.unreadCount}</span>
                    )}
                  </div>
                  <p className="mt-2 truncate text-[10.5px] font-bold text-[#102A56]">{thread.subject || thread.latest?.subject || 'No subject'}</p>
                  <div className="mt-1 flex items-center gap-2">
                    {thread.mailbox && <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[8px] font-bold uppercase text-blue-700">{thread.mailbox}</span>}
                    {thread.entityId && (
                      <span className="truncate text-[8.5px] font-bold uppercase tracking-wide text-[#0878C9]">
                        {thread.entityType?.replaceAll('_', ' ')} · {thread.entityId}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-relaxed text-gray-600">
                    {thread.latest?.direction === 'inbound' ? '↙ ' : '↗ '}{thread.latest?.body || 'No message text'}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[9px] text-gray-400">
                    <span>{when(thread.latest?.createdAt || thread.lastMessageAt)}</span>
                    <span>{thread.messageCount} msg{thread.messageCount === 1 ? '' : 's'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className={`min-w-0 bg-white ${!selectedId ? 'hidden lg:flex lg:items-center lg:justify-center' : 'flex flex-col'}`}>
          {!selectedId ? (
            <div className="text-center">
              <p className="text-sm font-bold text-gray-700">Select an email conversation</p>
              <p className="mt-1 text-[11px] text-gray-400">Sent messages and incoming replies will appear here.</p>
            </div>
          ) : selected ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <button type="button" onClick={() => setSelectedId('')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 lg:hidden">‹</button>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-black text-[#14213D]">{selected.participantName || selected.participantEmail}</p>
                    <p className="mt-0.5 truncate text-[9.5px] text-gray-400">
                      {selected.participantEmail}
                      {selected.mailbox ? ` · ${selected.mailbox}` : ''}
                      {selected.entityId ? ` · ${selected.entityType?.replaceAll('_', ' ')} ${selected.entityId}` : ''}
                    </p>
                    <p className="mt-1 truncate text-[11px] font-bold text-gray-700">{selected.subject || 'No subject'}</p>
                  </div>
                </div>
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto bg-[#F7F9FC] px-4 py-4 sm:px-5">
                {selected.messages.map(message => {
                  const outbound = message.direction === 'outbound'
                  return (
                    <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[92%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[82%] ${outbound ? 'rounded-br-md bg-[#102A56] text-white' : 'rounded-bl-md border border-gray-200 bg-white text-[#1F2937]'}`}>
                        {message.subject && <p className={`mb-2 text-[10px] font-black ${outbound ? 'text-blue-100' : 'text-gray-500'}`}>{message.subject}</p>}
                        <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed">{message.body}</p>
                        <div className={`mt-2 flex flex-wrap items-center gap-2 text-[8.5px] ${outbound ? 'text-blue-100' : 'text-gray-400'}`}>
                          <span>{when(message.receivedAt || message.sentAt || message.createdAt)}</span>
                          {outbound && (
                            <span className={`rounded-full border px-1.5 py-0.5 font-bold uppercase ${statusTone(message.status)}`}>
                              {message.status.replaceAll('_', ' ')}
                            </span>
                          )}
                          {message.provider && <span>{message.provider}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <footer className="border-t border-gray-100 bg-white p-3 sm:p-4">
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={event => setReply(event.target.value.slice(0, 20000))}
                    onKeyDown={event => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void sendReply()
                    }}
                    rows={4}
                    placeholder="Reply by email…"
                    className="min-h-[92px] min-w-0 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[11px] leading-relaxed outline-none focus:border-[#00AEEF]"
                  />
                  <button
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={sending || !reply.trim()}
                    className="min-h-[44px] rounded-xl bg-[#102A56] px-5 text-[11px] font-black text-white disabled:opacity-40"
                  >
                    {sending ? 'Sending…' : 'Send Email'}
                  </button>
                </div>
                <div className="mt-1.5 flex justify-between text-[9px] text-gray-400">
                  <span>Replies stay on this ERP thread and use the same departmental mailbox.</span>
                  <span>{reply.length}/20,000</span>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[11px] text-gray-400">Loading conversation…</div>
          )}
        </div>
      </div>
    </section>
  )
}
