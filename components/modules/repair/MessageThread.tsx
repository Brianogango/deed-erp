'use client'

import { useState, useEffect, useRef } from 'react'
import { Fa } from '@/components/icons'
import { faPaperPlane, faSync, faComments } from '@fortawesome/free-solid-svg-icons'
import { fmtDate } from '@/lib/store'
import { startVisiblePoll } from '@/lib/visible-poll'

interface Message {
  id: string
  sender: 'customer' | 'staff'
  senderName: string
  text: string
  timestamp?: string
  createdAt?: string
  read?: boolean
}

export default function MessageThread({ repairRef, staffName, customerName }: { repairRef: string; staffName: string; customerName?: string }) {
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
    return startVisiblePoll(() => { void fetchMessages() })
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

  const when = (m: Message) => {
    const raw = m.timestamp || m.createdAt
    const d = raw ? new Date(raw) : null
    if (!d || Number.isNaN(d.getTime())) return ''
    return `${fmtDate(raw!.slice(0, 10))} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }

  return (
    <section id="repair-messages" className="repair-chat" aria-label="Chat with the client">
      <header className="repair-chat__head">
        <span className="repair-chat__icon" aria-hidden="true"><Fa icon={faComments} /></span>
        <div className="repair-chat__title">
          <h3>Chat with {customerName || 'the client'}</h3>
          <p>They see this on their repair tracking page</p>
        </div>
        <button type="button" onClick={() => void fetchMessages()} disabled={loading} aria-label="Refresh messages" className="repair-chat__refresh">
          <Fa icon={faSync} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div ref={scrollRef} className="repair-chat__messages">
        {messages.length === 0 ? (
          <div className="repair-chat__empty">
            <Fa icon={faComments} aria-hidden="true" />
            <p>No messages yet. Write to the client below — they get it on their tracking page.</p>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`repair-chat__row ${msg.sender === 'staff' ? 'is-staff' : 'is-client'}`}>
              <div className="repair-chat__bubble">
                <p>{msg.text}</p>
              </div>
              <div className="repair-chat__meta">
                <span>{msg.sender === 'staff' ? msg.senderName : `${msg.senderName || customerName || 'Client'} (client)`}</span>
                <span aria-hidden="true">·</span>
                <span>{when(msg)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="repair-chat__compose">
        <textarea
          rows={1}
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
          placeholder="Write to the client…"
          aria-label="Message to the client"
          disabled={sending}
          className="form-input"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!message.trim() || sending}
          aria-label="Send message"
          className="repair-chat__send"
        >
          <Fa icon={faPaperPlane} />
        </button>
      </div>
    </section>
  )
}
