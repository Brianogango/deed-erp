'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DIA_FULL_NAME,
  DIA_SHORT_NAME,
  DIA_TAGLINE,
} from '@/lib/jarvis/branding'
import type { DiaActionCard } from '@/lib/jarvis/actions'
import {
  DIA_MODES,
  moduleFromPathname,
  startersForMode,
  type DiaMode,
  type DiaPageContext,
} from '@/lib/jarvis/modes'

interface AnswerSource {
  label: string
  kind: 'live' | 'knowledge'
  detail?: string | null
  url?: string | null
  updatedAt?: string | null
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: AnswerSource[]
  actions?: DiaActionCard[]
  toolCalls?: { toolName: string; allowed: boolean; error?: string | null }[]
}

interface JarvisPanelProps {
  open: boolean
  onClose: () => void
  onOpen?: () => void
  pathname?: string
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function formatSourceChip(s: AnswerSource): string {
  const bits = [s.label]
  if (s.detail && s.kind === 'live') bits.push(s.detail)
  bits.push(s.kind)
  if (s.updatedAt) bits.push(`updated ${s.updatedAt.slice(0, 10)}`)
  return bits.join(' · ')
}

function formatKes(n: number): string {
  return `KES ${Math.round(n).toLocaleString('en-KE')}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function ActionCards({
  actions,
  onCopied,
}: {
  actions: DiaActionCard[]
  onCopied: (label: string) => void
}) {
  if (!actions.length) return null

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-4)]">Actions</p>
      {actions.map((action, i) => {
        if (action.type === 'draft_message') {
          const payload = action.subject
            ? `Subject: ${action.subject}\n\n${action.body}`
            : action.body
          return (
            <div
              key={i}
              className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-2 space-y-1.5"
            >
              <p className="text-[10px] font-semibold text-[var(--text-2)]">
                Draft {action.channel}
                {action.recipientName ? ` · ${action.recipientName}` : ''}
              </p>
              {action.subject && (
                <p className="text-[10px] text-[var(--text-3)]">Subject: {action.subject}</p>
              )}
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--text-1)]">
                {action.body}
              </pre>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-[10px]"
                onClick={async () => {
                  const ok = await copyText(payload)
                  onCopied(ok ? 'Draft copied' : 'Copy failed')
                }}
              >
                Copy draft
              </button>
            </div>
          )
        }

        if (action.type === 'draft_quotation') {
          return (
            <div
              key={i}
              className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-2 space-y-1.5"
            >
              <p className="text-[10px] font-semibold text-[var(--text-2)]">
                Draft quotation · {action.companyName}
              </p>
              <p className="text-[10px] text-[var(--text-3)]">
                {action.lineCount} line{action.lineCount === 1 ? '' : 's'} · {formatKes(action.totalAmount)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn-secondary px-2 py-1 text-[10px]"
                  onClick={async () => {
                    const ok = await copyText(JSON.stringify(action.draftQuote, null, 2))
                    onCopied(ok ? 'Quote JSON copied' : 'Copy failed')
                  }}
                >
                  Copy JSON
                </button>
                <a
                  href="/sales"
                  className="btn-primary px-2 py-1 text-[10px] inline-flex items-center"
                >
                  Open Sales
                </a>
              </div>
            </div>
          )
        }

        return (
          <div
            key={i}
            className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-2 space-y-1"
          >
            <p className="text-[10px] font-semibold text-[var(--text-2)]">Sales@ lead import</p>
            <p className="text-[10px] text-[var(--text-3)]">
              Imported {action.imported}
              {action.skipped ? ` · skipped ${action.skipped}` : ''}
            </p>
            {action.message && (
              <p className="text-[10px] text-[var(--text-3)]">{action.message}</p>
            )}
            <a
              href="/crm"
              className="btn-secondary px-2 py-1 text-[10px] inline-flex items-center"
            >
              Review in CRM
            </a>
          </div>
        )
      })}
    </div>
  )
}

// Slide-over chat panel. Talks only to /api/jarvis/*, never touches any
// existing module's state — fully additive UI.
export default function JarvisPanel({ open, onClose, pathname }: JarvisPanelProps) {
  const [mode, setMode] = useState<DiaMode>('assist')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const [speakReplies, setSpeakReplies] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const speakRepliesRef = useRef(speakReplies)
  const modeRef = useRef(mode)

  const pageContext: DiaPageContext = useMemo(
    () => ({
      pathname: pathname || '/',
      module: moduleFromPathname(pathname || '/'),
    }),
    [pathname],
  )

  const modeMeta = DIA_MODES.find(m => m.id === mode) ?? DIA_MODES[0]
  const starters = useMemo(() => startersForMode(mode, pageContext), [mode, pageContext])

  useEffect(() => {
    speakRepliesRef.current = speakReplies
  }, [speakReplies])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognitionCtor()))
  }, [])

  // Voice mode defaults to spoken replies; leaving Voice does not force-off if user enabled it.
  useEffect(() => {
    if (mode === 'voice') setSpeakReplies(true)
  }, [mode])

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, statusNote])

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {
        /* ignore */
      }
    }
  }, [])

  function speakText(text: string) {
    if (!speakRepliesRef.current || typeof window === 'undefined' || !window.speechSynthesis) return
    try {
      window.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(text.slice(0, 600))
      utter.rate = 1
      window.speechSynthesis.speak(utter)
    } catch {
      /* ignore */
    }
  }

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || sending) return
    setError(null)
    setStatusNote(null)
    setInput('')
    setSending(true)

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])

    try {
      const res = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          mode: modeRef.current,
          pageContext,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? `${DIA_SHORT_NAME} could not respond right now.`)
        return
      }

      setConversationId(data.conversationId)
      setMessages(prev => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.reply,
          sources: data.sources,
          actions: Array.isArray(data.actions) ? data.actions : [],
          toolCalls: data.toolCalls,
        },
      ])
      if (typeof data.reply === 'string') speakText(data.reply)
    } catch {
      setError(`Could not reach ${DIA_SHORT_NAME}. Check your connection and try again.`)
    } finally {
      setSending(false)
    }
  }

  function toggleMic() {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setError('Speech recognition is not supported in this browser. Use Chrome/Edge, or type your question.')
      return
    }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop()
      setListening(false)
      return
    }

    const recognition = new Ctor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-KE'
    recognition.onresult = event => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setInput(transcript.trim())
      const last = event.results[event.results.length - 1]
      if (last?.isFinal) {
        const finalText = transcript.trim()
        if (finalText) void sendMessage(finalText)
      }
    }
    recognition.onerror = event => {
      setListening(false)
      if (event.error && event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(`Microphone error: ${event.error}`)
      }
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      setError(null)
      setStatusNote('Listening…')
    } catch {
      setError('Could not start the microphone.')
      setListening(false)
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
    setStatusNote(null)
  }

  function selectMode(next: DiaMode) {
    setMode(next)
    setStatusNote(null)
    setError(null)
    if (listening && recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        /* ignore */
      }
      setListening(false)
    }
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
        className="fixed inset-0 z-[201] flex h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-[var(--bg-card)] shadow-2xl md:inset-auto md:right-4 md:top-4 md:bottom-4 md:h-auto md:w-[460px] md:max-w-[calc(100vw-32px)] md:rounded-2xl md:border md:border-[var(--border)]"
        role="dialog"
        aria-label={`${DIA_SHORT_NAME} — ${DIA_FULL_NAME}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-lt)] px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[10px] font-extrabold text-white">
              {DIA_SHORT_NAME}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--text-1)]">{DIA_SHORT_NAME}</p>
              <p className="truncate text-[10px] text-[var(--text-4)]">
                {DIA_FULL_NAME} · {DIA_TAGLINE}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
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
              aria-label={`Close ${DIA_SHORT_NAME}`}
            >
              Close
            </button>
          </div>
        </div>

        <div
          className="flex gap-1 overflow-x-auto border-b border-[var(--border-lt)] px-3 py-2"
          role="tablist"
          aria-label={`${DIA_SHORT_NAME} modes`}
        >
          {DIA_MODES.map(m => {
            const active = mode === m.id
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={m.description}
                onClick={() => selectMode(m.id)}
                className={
                  active
                    ? 'shrink-0 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[10px] font-bold text-white'
                    : 'shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold text-[var(--text-3)] hover:bg-[var(--bg-surface)]'
                }
              >
                {m.short}
              </button>
            )
          })}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-4 space-y-3">
              <div>
                <p className="text-xs font-bold text-[var(--text-1)]">
                  {DIA_SHORT_NAME} {modeMeta.label}
                </p>
                <p className="mt-1 text-xs text-[var(--text-3)]">{modeMeta.emptyHint}</p>
                {mode === 'assist' && pageContext.module && (
                  <p className="mt-1 text-[10px] text-[var(--text-4)]">
                    Context: {pageContext.module}
                    {pageContext.pathname ? ` · ${pageContext.pathname}` : ''}
                  </p>
                )}
              </div>
              {starters.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {starters.map(s => (
                    <button
                      key={s.label}
                      type="button"
                      className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] px-2 py-1 text-[10px] font-semibold text-[var(--text-2)] hover:border-[var(--primary)]"
                      onClick={() => void sendMessage(s.prompt)}
                      disabled={sending}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
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
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-4)]">Sources</p>
                    <div className="flex flex-wrap gap-1">
                      {m.sources.map((s, i) => (
                        s.url ? (
                          <a
                            key={i}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className={
                              s.kind === 'live'
                                ? 'rounded-md bg-[var(--success-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success-text)]'
                                : 'rounded-md bg-[var(--bg-card)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-2)] border border-[var(--border-lt)]'
                            }
                            title={formatSourceChip(s)}
                          >
                            {formatSourceChip(s)}
                          </a>
                        ) : (
                          <span
                            key={i}
                            className={
                              s.kind === 'live'
                                ? 'rounded-md bg-[var(--success-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success-text)]'
                                : 'rounded-md bg-[var(--bg-card)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-2)] border border-[var(--border-lt)]'
                            }
                            title={formatSourceChip(s)}
                          >
                            {formatSourceChip(s)}
                          </span>
                        )
                      ))}
                    </div>
                  </div>
                )}
                {m.actions && m.actions.length > 0 && (
                  <ActionCards
                    actions={m.actions}
                    onCopied={label => setStatusNote(label)}
                  />
                )}
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.toolCalls.map((tc, i) => (
                      <span
                        key={i}
                        className={
                          tc.allowed
                            ? 'rounded-full bg-[var(--success-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--success-text)]'
                            : 'rounded-full bg-[var(--danger-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--danger-text)]'
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

          {statusNote && !error && (
            <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-3)]">
              {statusNote}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-text)]">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border-lt)] p-3 space-y-2">
          {(mode === 'voice' || speakReplies) && (
            <label className="flex items-center gap-2 text-[10px] text-[var(--text-4)]">
              <input
                type="checkbox"
                checked={speakReplies}
                onChange={e => setSpeakReplies(e.target.checked)}
              />
              Speak replies (browser voice)
            </label>
          )}
          {mode === 'voice' && listening && (
            <p className="text-[10px] font-semibold text-[var(--danger)]">Listening…</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              className="form-input flex-1 resize-none text-xs"
              rows={2}
              placeholder={modeMeta.placeholder}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            {(mode === 'voice' || voiceSupported) && voiceSupported && (
              <button
                type="button"
                className={
                  listening
                    ? 'btn-primary px-3 py-2 text-xs bg-[var(--danger)] border-[var(--danger)]'
                    : mode === 'voice'
                      ? 'btn-primary px-3 py-2 text-xs'
                      : 'btn-secondary px-3 py-2 text-xs'
                }
                onClick={toggleMic}
                disabled={sending}
                aria-label={listening ? 'Stop listening' : `Speak to ${DIA_SHORT_NAME}`}
                title={listening ? 'Listening… click to stop' : 'Speak your question'}
              >
                {listening ? '●' : 'Mic'}
              </button>
            )}
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
