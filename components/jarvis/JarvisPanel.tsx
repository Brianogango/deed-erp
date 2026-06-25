'use client'

import { useEffect, useRef, useState } from 'react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: { toolName: string; allowed: boolean; error?: string | null }[]
}

interface JarvisPanelProps {
  open: boolean
  onClose: () => void
}

// Slide-over chat panel. Talks only to /api/jarvis/*, never touches any
// existing module's state — fully additive UI.
export default function JarvisPanel({ open, onClose }: JarvisPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return
    setError(null)
    setInput('')
    setSending(true)

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])

    try {
      const res = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'JARVIS could not respond right now.')
        return
      }

      setConversationId(data.conversationId)
      setMessages(prev => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.reply,
          toolCalls: data.toolCalls,
        },
      ])
    } catch {
      setError('Could not reach JARVIS. Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  function startNewChat() {
    setConversationId(null)
    setMessages([])
    setError(null)
  }

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed right-0 top-0 z-[201] flex h-screen w-full max-w-md flex-col bg-[var(--bg-card)] shadow-2xl"
        role="dialog"
        aria-label="JARVIS AI assistant"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-lt)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--primary)] text-xs font-extrabold text-white">AI</span>
            <div>
              <p className="text-sm font-bold text-[var(--text-1)]">JARVIS</p>
              <p className="text-[10px] text-[var(--text-4)]">Reads ERP data only — never sends or posts anything for you</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--text-3)] hover:bg-[var(--bg-surface)]"
              onClick={startNewChat}
              aria-label="Start new chat"
            >
              New
            </button>
            <button
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--text-3)] hover:bg-[var(--bg-surface)]"
              onClick={onClose}
              aria-label="Close JARVIS panel"
            >
              Close
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-3)]">
              Ask me things like &ldquo;check stock for HP 240 laptops&rdquo;, &ldquo;track repair RPR-00012&rdquo;,
              &ldquo;which invoices are overdue&rdquo;, or &ldquo;draft a quote for Acme Ltd: 5x HP 240 laptops&rdquo;.
              I only answer from real ERP data and your company documents — I&apos;ll say so if I don&apos;t know.
            </div>
          )}

          {messages.map(m => (
            <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] rounded-2xl bg-[var(--primary)] px-3 py-2 text-xs text-white whitespace-pre-wrap'
                    : 'max-w-[85%] rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-1)] whitespace-pre-wrap'
                }
              >
                {m.content}
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.toolCalls.map((tc, i) => (
                      <span
                        key={i}
                        className={
                          tc.allowed
                            ? 'rounded-full bg-[var(--success-bg)] px-2 py-0.5 text-[9px] font-bold text-[var(--success-text)]'
                            : 'rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-[9px] font-bold text-[var(--danger-text)]'
                        }
                        title={tc.error ?? undefined}
                      >
                        {tc.allowed ? '✓' : '✕'} {tc.toolName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-4)]">
                Thinking…
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-text)]">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border-lt)] p-3">
          <div className="flex items-end gap-2">
            <textarea
              className="form-input flex-1 resize-none text-xs"
              rows={2}
              placeholder="Ask JARVIS about customers, stock, invoices, repairs…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            <button
              className="btn-primary px-3 py-2 text-xs disabled:opacity-50"
              onClick={() => void sendMessage()}
              disabled={sending || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
