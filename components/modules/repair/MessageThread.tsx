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

interface MessageThreadProps {
  repairRef: string
  staffName: string
}

export default function MessageThread({ repairRef, staffName }: MessageThreadProps) {
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
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMessages()
    const interval = setInterval(fetchMessages, 10000) // Poll every 10s
    return () => clearInterval(interval)
  }, [repairRef])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    if (!message.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/portal/repair/${repairRef}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: 'staff',
          senderName: staffName,
          text: message.trim()
        })
      })
      if (res.ok) {
        setMessage('')
        await fetchMessages()
      }
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card flex flex-col h-[500px] border-l-4 border-l-blue-600 shadow-sm overflow-hidden bg-white">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
            <Fa icon={faComments} className="text-xs" />
          </div>
          <div>
            <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Customer Chat</h3>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Direct channel to client</p>
          </div>
        </div>
        <button 
          onClick={fetchMessages}
          disabled={loading}
          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50"
          title="Refresh messages"
        >
          <Fa icon={faSync} className={`text-xs ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Message List */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/30 custom-scrollbar"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 opacity-40">
            <Fa icon={faComments} className="text-4xl" />
            <div className="text-center">
              <p className="text-xs font-black uppercase tracking-widest">No messages yet</p>
              <p className="text-[10px] font-bold">Start the conversation below</p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col ${msg.sender === 'staff' ? 'items-end' : 'items-start'}`}
            >
              <div className={`
                max-w-[85%] rounded-2xl px-4 py-3 shadow-sm text-xs leading-relaxed
                ${msg.sender === 'staff' 
                  ? 'bg-slate-900 text-white rounded-tr-none' 
                  : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'}
              `}>
                <p className="font-medium whitespace-pre-wrap">{msg.text}</p>
              </div>
              <div className={`flex items-center gap-2 mt-1.5 px-1 text-[9px] font-bold uppercase tracking-tighter text-slate-400`}>
                <span className="flex items-center gap-1">
                  <Fa icon={faUser} className="text-[8px] opacity-50" />
                  {msg.senderName}
                </span>
                <span className="opacity-30">•</span>
                <span className="flex items-center gap-1">
                  <Fa icon={faClock} className="text-[8px] opacity-50" />
                  {fmtDate(msg.createdAt)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-100 shrink-0">
        <div className="relative flex items-center gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type your message..."
            disabled={sending}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all pr-14 disabled:opacity-50"
          />
          <button 
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className={`
              absolute right-1.5 p-2.5 rounded-xl transition-all shadow-sm
              ${message.trim() && !sending 
                ? 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 active:scale-95' 
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'}
            `}
          >
            <Fa icon={faPaperPlane} className={`text-xs ${sending ? 'animate-pulse' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  )
}
