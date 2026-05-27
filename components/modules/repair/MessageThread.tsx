'use client'

import { useState, useEffect, useRef } from 'react'
import { Fa } from '@/components/icons'
import { faPaperPlane, faSync, faComments, faUser, faClock } from '@fortawesome/free-solid-svg-icons'
import { fmtDate } from '@/lib/store'

interface Message {
  id: string
  sender: 'customer' | 'staff'
  senderName: string
  text: string
  createdAt: string
  isRead: boolean
}

export default function MessageThread({ repairRef, staffName }: { repairRef: string; staffName: string }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchMessages = async () => {
    if (!repairRef) return
    setLoading(true)
    try {
      const res = await fetch(`/api/portal/repair/${repairRef}/messages?by=staff`)
      if (res.ok) setMessages((await res.json()).messages || [])
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetchMessages()
    const id = setInterval(fetchMessages, 10000)
    return () => clearInterval(id)
  }, [repairRef])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const handleSend = async () => {
    if (!message.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/portal/repair/${repairRef}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: 'staff', senderName: staffName, text: message.trim() }),
      })
      if (res.ok) { setMessage(''); await fetchMessages() }
    } catch {}
    finally { setSending(false) }
  }

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-100 shadow-sm border-l-4 border-l-blue-500 flex flex-col overflow-hidden" style={{ height: 'clamp(320px, 44vh, 440px)' }}>

      {/* Header */}
      <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-100">
            <Fa icon={faComments} className="text-white text-xs" />
          </div>
          <div>
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-wider leading-none">Customer Chat</h3>
            <p className="text-[9px] text-slate-400 font-bold mt-0.5">Direct channel to client</p>
          </div>
        </div>
        <button
          onClick={fetchMessages}
          disabled={loading}
          className="w-8 h-8 rounded-xl hover:bg-blue-50 text-slate-400 hover:text-blue-600 flex items-center justify-center transition-all disabled:opacity-50"
          title="Refresh"
        >
          <Fa icon={faSync} className={`text-xs ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/40 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-300">
            <Fa icon={faComments} className="text-4xl" />
            <div className="text-center">
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">No messages yet</p>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">Start the conversation below</p>
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`flex flex-col gap-1 ${msg.sender === 'staff' ? 'items-end' : 'items-start'}`}>
              <div className={`
                max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm
                ${msg.sender === 'staff'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'}
              `}>
                <p className="font-medium whitespace-pre-wrap">{msg.text}</p>
              </div>
              <div className="flex items-center gap-1.5 px-1 text-[9px] font-bold text-slate-400 uppercase tracking-tight">
                <Fa icon={faUser} className="text-[8px] opacity-50" />
                <span>{msg.senderName}</span>
                <span className="opacity-30">·</span>
                <Fa icon={faClock} className="text-[8px] opacity-50" />
                <span>{fmtDate(msg.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="px-3 sm:px-4 py-3 sm:py-3.5 bg-white border-t border-slate-100 shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Type a message…"
            disabled={sending}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0 ${
              message.trim() && !sending
                ? 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 active:scale-95'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Fa icon={faPaperPlane} className={`text-xs ${sending ? 'animate-pulse' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  )
}
