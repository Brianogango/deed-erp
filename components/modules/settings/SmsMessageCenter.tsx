'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type MessageRow = {
  id: string
  direction: 'inbound' | 'outbound' | string
  body: string
  provider: string | null
  providerMessageId: string | null
  eventType: string | null
  entityType: string | null
  entityId: string | null
  senderPhone: string | null
  recipientPhone: string | null
  status: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  receivedAt: string | null
  createdAt: string
}

type ThreadSummary = {
  id: string
  participantPhone: string
  participantName: string | null
  entityType: string | null
  entityId: string | null
  status: string
  unreadCount: number
  lastMessageAt: string
  messageCount: number
  latest: {
    id: string
    direction: string
    body: string
    status: string
    createdAt: string
    receivedAt: string | null
    sentAt: string | null
  } | null
}

type SelectedThread = Omit<ThreadSummary, 'messageCount' | 'latest'> & {
  messages: MessageRow[]
}

type ApiResponse = {
  folder: string
  unreadTotal: number
  threads: ThreadSummary[]
  selected: SelectedThread | null
}

const tone = (status: string) => {
  if (['delivered', 'read', 'received'].includes(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
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

export default function SmsMessageCenter({
  showToast,
}: {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [folder, setFolder] = useState<'all' | 'inbox' | 'sent' | 'failed'>('all')
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
      if (query.trim()) params.set('q', query.trim())
      if (threadId) params.set('threadId', threadId)
      const res = await fetch(`/api/admin/sms/messages?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'Could not load SMS messages', 'error')
        return
      }
      setData(body)
      if (!threadId && body.threads?.[0]?.id) {
        setSelectedId(body.threads[0].id)
      }
    } catch {
      showToast('Could not reach SMS message history', 'error')
    } finally {
      setLoading(false)
    }
  }, [folder, query, selectedId, showToast])

  useEffect(() => { void load() }, [folder])
  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, 20000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!selectedId) return
    void load(selectedId)
    void fetch('/api/admin/sms/messages', {
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
      const res = await fetch('/api/admin/sms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', threadId: selectedId, message: text }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(body.error || 'SMS could not be sent', 'error')
        return
      }
      setReply('')
      showToast('SMS queued and logged', 'success')
      await load(selectedId)
    } catch {
      showToast('Could not send SMS reply', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">SMS Message Center</p>
            {(data?.unreadTotal || 0) > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#00AEEF] px-1.5 py-0.5 text-[9px] font-black text-white">
                {data?.unreadTotal}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-gray-500">Sent SMS, delivery status and customer/employee replies in one conversation history.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
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
          <div className="flex gap-2">
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && void load('')}
              placeholder="Search name, phone or ref"
              className="min-h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-[11px] outline-none focus:border-[#00AEEF] sm:w-52"
            />
            <button type="button" onClick={() => void load('')} className="min-h-10 rounded-xl border border-gray-200 px-3 text-[10px] font-bold text-gray-700">
              {loading ? 'Loading…' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-[560px] grid-cols-1 lg:grid-cols-[310px_minmax(0,1fr)]">
        <aside className={`border-r border-gray-100 bg-[#FAFCFF] ${selectedId ? 'hidden lg:block' : 'block'}`}>
          {!data?.threads?.length ? (
            <div className="px-5 py-12 text-center text-[11px] text-gray-400">No SMS conversations in this view.</div>
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
                      <p className="truncate text-[12px] font-extrabold text-[#14213D]">{thread.participantName || thread.participantPhone}</p>
                      <p className="mt-0.5 truncate text-[9.5px] font-medium text-gray-400">{thread.participantPhone}</p>
                    </div>
                    {thread.unreadCount > 0 && (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#00AEEF] px-1.5 py-0.5 text-[9px] font-black text-white">{thread.unreadCount}</span>
                    )}
                  </div>
                  {thread.entityId && (
                    <p className="mt-2 truncate text-[9px] font-bold uppercase tracking-wide text-[#0878C9]">
                      {thread.entityType?.replaceAll('_', ' ')} · {thread.entityId}
                    </p>
                  )}
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
              <p className="text-sm font-bold text-gray-700">Select an SMS conversation</p>
              <p className="mt-1 text-[11px] text-gray-400">Incoming replies and outbound history will appear here.</p>
            </div>
          ) : selected ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <button type="button" onClick={() => setSelectedId('')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 lg:hidden">‹</button>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-black text-[#14213D]">{selected.participantName || selected.participantPhone}</p>
                    <p className="mt-0.5 truncate text-[9.5px] text-gray-400">
                      {selected.participantPhone}
                      {selected.entityId ? ` · ${selected.entityType?.replaceAll('_', ' ')} ${selected.entityId}` : ''}
                    </p>
                  </div>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase ${selected.status === 'opted_out' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  {selected.status.replaceAll('_', ' ')}
                </span>
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto bg-[#F7F9FC] px-4 py-4 sm:px-5">
                {selected.messages.map(message => {
                  const outbound = message.direction === 'outbound'
                  return (
                    <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[86%] rounded-2xl px-3.5 py-3 shadow-sm sm:max-w-[72%] ${outbound ? 'rounded-br-md bg-[#102A56] text-white' : 'rounded-bl-md border border-gray-200 bg-white text-[#1F2937]'}`}>
                        <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed">{message.body}</p>
                        <div className={`mt-2 flex flex-wrap items-center gap-2 text-[8.5px] ${outbound ? 'text-blue-100' : 'text-gray-400'}`}>
                          <span>{when(message.receivedAt || message.sentAt || message.createdAt)}</span>
                          {outbound && (
                            <span className={`rounded-full border px-1.5 py-0.5 font-bold uppercase ${tone(message.status)}`}>
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
                {selected.status === 'opted_out' ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-[10.5px] font-medium text-red-700">
                    This number replied STOP/UNSUBSCRIBE. Sending is blocked until consent is restored outside this screen.
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <textarea
                      value={reply}
                      onChange={event => setReply(event.target.value.slice(0, 480))}
                      onKeyDown={event => {
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void sendReply()
                      }}
                      rows={3}
                      placeholder="Reply by SMS…"
                      className="min-h-[76px] min-w-0 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[11px] leading-relaxed outline-none focus:border-[#00AEEF]"
                    />
                    <button
                      type="button"
                      onClick={() => void sendReply()}
                      disabled={sending || !reply.trim()}
                      className="min-h-[44px] rounded-xl bg-[#102A56] px-5 text-[11px] font-black text-white disabled:opacity-40"
                    >
                      {sending ? 'Sending…' : 'Send SMS'}
                    </button>
                  </div>
                )}
                <div className="mt-1.5 flex justify-between text-[9px] text-gray-400">
                  <span>Ctrl/Cmd + Enter to send</span>
                  <span>{reply.length}/480</span>
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
