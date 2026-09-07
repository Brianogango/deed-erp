'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Fa } from '@/components/icons'
import {
  faChevronLeft,
  faComments,
  faInbox,
  faMagnifyingGlass,
  faPaperPlane,
  faRotate,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { startVisiblePoll } from '@/lib/visible-poll'

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
  if (['delivered', 'read', 'received'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (['failed', 'dead_letter'].includes(status)) return 'border-red-200 bg-red-50 text-red-700'
  if (['queued', 'sending', 'retrying'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

const when = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

function initials(name: string | null, phone: string) {
  const source = (name || phone).trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || 'SMS'
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
  const scrollRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => startVisiblePoll(() => { void load() }), [load])

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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [selected?.id, selected?.messages.length])

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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[12px] font-black text-[#14213D]">SMS conversations</h3>
            {(data?.unreadTotal || 0) > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#00AEEF] px-1.5 py-0.5 text-[9px] font-black text-white">
                {data?.unreadTotal}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[9px] text-slate-400">Two-way SMS threads. Email, WhatsApp, push and in-app stay on Overview.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            {folders.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setFolder(item.id); setSelectedId('') }}
                className={'min-h-8 rounded-lg px-3 text-[10px] font-bold transition ' + (folder === item.id ? 'bg-white text-[#0878C9] shadow-sm' : 'text-slate-500 hover:text-slate-800')}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1 sm:w-52">
              <Fa icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && void load('')}
                placeholder="Search name, phone or ref"
                className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-[10px] outline-none focus:border-cyan-400"
              />
            </div>
            <button
              type="button"
              onClick={() => void load('')}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-bold text-[#1A1F5E]"
            >
              <Fa icon={faRotate} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Loading' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-[560px] grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={'border-slate-100 bg-[#FBFDFF] lg:border-r ' + (selectedId ? 'hidden lg:block' : 'block')}>
          {!data?.threads?.length ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 px-5 py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-50 text-cyan-600">
                <Fa icon={faInbox} />
              </div>
              <p className="text-[12px] font-bold text-slate-600">No SMS conversations in this view.</p>
              <p className="text-[10px] text-slate-400">Change the folder or search term.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.threads.map(thread => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedId(thread.id)}
                  className={'w-full px-4 py-3.5 text-left transition hover:bg-white ' + (selectedId === thread.id ? 'bg-cyan-50/50' : '')}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-black text-cyan-700">
                      {initials(thread.participantName, thread.participantPhone)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[11px] font-black text-[#14213D]">{thread.participantName || thread.participantPhone}</p>
                        {thread.unreadCount > 0 && (
                          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#00AEEF] px-1.5 py-0.5 text-[9px] font-black text-white">{thread.unreadCount}</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[9px] font-medium text-slate-400">{thread.participantPhone}</p>
                      {thread.entityId && (
                        <p className="mt-1.5 truncate font-mono text-[9px] text-slate-400">
                          {thread.entityType?.replaceAll('_', ' ')} · {thread.entityId}
                        </p>
                      )}
                      <p className="mt-1.5 line-clamp-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-600">
                        <Fa
                          icon={thread.latest?.direction === 'inbound' ? faInbox : faPaperPlane}
                          className={'mt-0.5 shrink-0 text-[9px] ' + (thread.latest?.direction === 'inbound' ? 'text-cyan-600' : 'text-slate-400')}
                        />
                        <span>{thread.latest?.body || 'No message text'}</span>
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[9px] text-slate-400">
                        <span>{when(thread.latest?.createdAt || thread.lastMessageAt)}</span>
                        <span>{thread.messageCount} msg{thread.messageCount === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className={'min-w-0 bg-white ' + (!selectedId ? 'hidden lg:flex lg:items-center lg:justify-center' : 'flex flex-col')}>
          {!selectedId ? (
            <div className="flex flex-col items-center gap-2 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-50 text-cyan-600">
                <Fa icon={faComments} className="text-lg" />
              </div>
              <p className="text-[12px] font-bold text-slate-600">Select an SMS conversation</p>
              <p className="text-[10px] text-slate-400">Incoming replies and outbound history will appear here.</p>
            </div>
          ) : selected ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    aria-label="Back to conversations"
                    onClick={() => setSelectedId('')}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
                  >
                    <Fa icon={faChevronLeft} />
                  </button>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-black text-cyan-700">
                    {initials(selected.participantName, selected.participantPhone)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-black text-[#14213D]">{selected.participantName || selected.participantPhone}</p>
                    <p className="mt-0.5 truncate text-[9px] text-slate-400">
                      {selected.participantPhone}
                      {selected.entityId ? ` · ${selected.entityType?.replaceAll('_', ' ')} ${selected.entityId}` : ''}
                    </p>
                  </div>
                </div>
                <span className={'rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ' + (selected.status === 'opted_out' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                  {selected.status.replaceAll('_', ' ')}
                </span>
              </header>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-[#FBFDFF] px-4 py-4">
                {selected.messages.length === 0 ? (
                  <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
                    <Fa icon={faComments} className="text-2xl text-slate-300" />
                    <p className="text-[11px] font-bold text-slate-500">No messages in this thread yet.</p>
                  </div>
                ) : selected.messages.map(message => {
                  const outbound = message.direction === 'outbound'
                  return (
                    <div key={message.id} className={'flex ' + (outbound ? 'justify-end' : 'justify-start')}>
                      <div className={'max-w-[86%] rounded-2xl px-3.5 py-3 sm:max-w-[72%] ' + (outbound ? 'rounded-br-md bg-[#1A1F5E] text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-700')}>
                        <p className="whitespace-pre-wrap text-[11px] leading-relaxed">{message.body}</p>
                        <div className={'mt-2 flex flex-wrap items-center gap-2 text-[9px] ' + (outbound ? 'text-cyan-100' : 'text-slate-400')}>
                          <span>{when(message.receivedAt || message.sentAt || message.createdAt)}</span>
                          {outbound && (
                            <span className={'rounded-full border px-1.5 py-0.5 font-black uppercase ' + tone(message.status)}>
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

              <footer className="border-t border-slate-100 bg-white p-3 sm:p-4">
                {selected.status === 'opted_out' ? (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-[10px] font-medium text-red-700">
                    <Fa icon={faTriangleExclamation} className="mt-0.5 shrink-0" />
                    <span>This number replied STOP/UNSUBSCRIBE. Sending is blocked until consent is restored outside this screen.</span>
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
                      className="min-h-[76px] min-w-0 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-[11px] leading-relaxed outline-none focus:border-cyan-400"
                    />
                    <button
                      type="button"
                      onClick={() => void sendReply()}
                      disabled={sending || !reply.trim()}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#00AEEF] px-4 text-[10px] font-black text-white disabled:opacity-40"
                    >
                      <Fa icon={faPaperPlane} />
                      {sending ? 'Sending…' : 'Send SMS'}
                    </button>
                  </div>
                )}
                <div className="mt-1.5 flex justify-between text-[9px] text-slate-400">
                  <span>Ctrl/Cmd + Enter to send</span>
                  <span>{reply.length}/480</span>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[11px] text-slate-400">Loading conversation…</div>
          )}
        </div>
      </div>
    </section>
  )
}
