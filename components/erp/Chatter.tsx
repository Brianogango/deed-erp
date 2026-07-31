'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Fa } from '@/components/icons'
import { faPaperPlane, faSync, faComments, faUser, faClock, faCalendarCheck } from '@fortawesome/free-solid-svg-icons'
import { fmtDate } from '@/lib/store'

type ChatterModel = 'sale_order' | 'purchase_order' | 'invoice' | 'repair' | 'opportunity'

interface DocumentMessage {
  id: string
  body: string
  authorName?: string | null
  messageType: string
  createdAt: string
}

interface DocumentActivity {
  id: string
  activityType: string
  summary: string
  dueDate?: string | null
  status: string
  createdAt: string
}

interface ChatterProps {
  model: ChatterModel
  recordId: string
  staffName?: string
  title?: string
  compact?: boolean
}

export default function Chatter({
  model,
  recordId,
  staffName = 'Staff',
  title = 'Chatter',
  compact = false,
}: ChatterProps) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<DocumentMessage[]>([])
  const [activities, setActivities] = useState<DocumentActivity[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [activitySummary, setActivitySummary] = useState('')
  const [activityType, setActivityType] = useState<'call' | 'meeting' | 'email' | 'todo'>('todo')
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchChatter = useCallback(async () => {
    if (!recordId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/chatter?model=${encodeURIComponent(model)}&recordId=${encodeURIComponent(recordId)}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
        setActivities(data.activities || [])
      }
    } catch {
      // ignore transient errors
    } finally {
      setLoading(false)
    }
  }, [model, recordId])

  useEffect(() => {
    fetchChatter()
    const id = setInterval(fetchChatter, 15000)
    return () => clearInterval(id)
  }, [fetchChatter])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const handleSend = async () => {
    if (!message.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/chatter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          recordId,
          body: message.trim(),
          authorName: staffName,
          messageType: 'comment',
        }),
      })
      if (res.ok) {
        setMessage('')
        await fetchChatter()
      }
    } finally {
      setSending(false)
    }
  }

  const handleAddActivity = async () => {
    if (!activitySummary.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/chatter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          recordId,
          kind: 'activity',
          activityType,
          summary: activitySummary.trim(),
        }),
      })
      if (res.ok) {
        setActivitySummary('')
        await fetchChatter()
      }
    } finally {
      setSending(false)
    }
  }

  const height = compact ? 'clamp(260px, 36vh, 360px)' : 'clamp(320px, 44vh, 440px)'

  return (
    <div
      className="bg-[var(--bg-card)] rounded-xl sm:rounded-2xl border border-[var(--border)] shadow-sm border-l-4 border-l-violet-500 flex flex-col overflow-hidden"
      style={{ height }}
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between shrink-0 bg-[var(--bg-card)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center shadow-sm">
            <Fa icon={faComments} className="text-white text-xs" />
          </div>
          <div>
            <h3 className="text-[11px] font-black text-[var(--text-1)] uppercase tracking-wider leading-none">{title}</h3>
            <p className="text-[9px] text-[var(--text-4)] font-bold mt-0.5">Messages &amp; activities</p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchChatter}
          disabled={loading}
          className="w-8 h-8 rounded-xl hover:bg-violet-50 text-[var(--text-4)] hover:text-violet-600 flex items-center justify-center transition-all disabled:opacity-50"
          title="Refresh"
        >
          <Fa icon={faSync} className={`text-xs ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {activities.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--border-lt)] bg-[var(--bg-surface)]/60 space-y-1.5 max-h-28 overflow-y-auto">
          {activities.slice(0, 5).map(act => (
            <div key={act.id} className="flex items-start gap-2 text-[10px] text-[var(--text-3)]">
              <Fa icon={faCalendarCheck} className="text-violet-500 mt-0.5 shrink-0" />
              <span>
                <strong className="uppercase">{act.activityType}</strong> · {act.summary}
                {act.dueDate ? ` · due ${fmtDate(act.dueDate)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[var(--bg-surface)]/40 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--text-4)]">
            <Fa icon={faComments} className="text-4xl opacity-30" />
            <p className="text-xs font-black uppercase tracking-wider text-[var(--text-3)]">No messages yet</p>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className="flex flex-col gap-1 items-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 text-xs leading-relaxed shadow-sm bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-2)]">
                <p className="font-medium whitespace-pre-wrap">{msg.body}</p>
              </div>
              <div className="flex items-center gap-1.5 px-1 text-[9px] font-bold text-[var(--text-4)] uppercase tracking-tight">
                <Fa icon={faUser} className="text-[8px] opacity-50" />
                <span>{msg.authorName || 'Staff'}</span>
                <span className="opacity-30">·</span>
                <Fa icon={faClock} className="text-[8px] opacity-50" />
                <span>{fmtDate(msg.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="px-3 sm:px-4 py-3 bg-[var(--bg-card)] border-t border-[var(--border)] shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <select
            aria-label="Activity type"
            className="form-input text-[10px] w-24 shrink-0"
            value={activityType}
            onChange={e => setActivityType(e.target.value as typeof activityType)}
          >
            <option value="todo">To-do</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="email">Email</option>
          </select>
          <input
            type="text"
            aria-label="Schedule activity"
            className="form-input text-xs flex-1"
            placeholder="Log a follow-up activity…"
            value={activitySummary}
            onChange={e => setActivitySummary(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddActivity()}
          />
          <button
            type="button"
            onClick={handleAddActivity}
            disabled={!activitySummary.trim() || sending}
            className="px-3 py-2 rounded-xl bg-violet-100 text-violet-700 text-[10px] font-bold uppercase disabled:opacity-40"
          >
            Activity
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="Chatter message"
            className="form-input text-xs flex-1"
            placeholder="Write an internal note…"
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="w-9 h-9 rounded-xl bg-violet-600 text-white flex items-center justify-center disabled:opacity-40"
          >
            <Fa icon={faPaperPlane} className="text-xs" />
          </button>
        </div>
      </div>
    </div>
  )
}
