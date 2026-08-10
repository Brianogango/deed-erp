'use client'

import { useEffect, useRef, useState } from 'react'
import {
  DIA_ASK_PLACEHOLDER,
  DIA_EMPTY_HINT,
  DIA_FULL_NAME,
  DIA_SHORT_NAME,
  DIA_TAGLINE,
} from '@/lib/jarvis/branding'

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
  toolCalls?: { toolName: string; allowed: boolean; error?: string | null }[]
}

interface JarvisPanelProps {
  open: boolean
  onClose: () => void
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

// Slide-over chat panel. Talks only to /api/jarvis/*, never touches any
// existing module's state — fully additive UI.
export default function JarvisPanel({ open, onClose }: JarvisPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const [speakReplies, setSpeakReplies] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognitionCtor()))
  }, [])

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])

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
    if (!speakReplies || typeof window === 'undefined' || !window.speechSynthesis) return
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
        aria-label={`${DIA_SHORT_NAME} — ${DIA_FULL_NAME}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-lt)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--primary)] text-[10px] font-extrabold text-white">{DIA_SHORT_NAME}</span>
            <div>
              <p className="text-sm font-bold text-[var(--text-1)]">{DIA_SHORT_NAME}</p>
              <p className="text-[10px] text-[var(--text-4)]">{DIA_FULL_NAME} · {DIA_TAGLINE}</p>
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
              aria-label={`Close ${DIA_SHORT_NAME}`}
            >
              Close
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-3)]">
              {DIA_EMPTY_HINT}
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
                    <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-4)]">Sources</p>
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
                                ? 'rounded-md bg-[var(--success-bg)] px-2 py-0.5 text-[9px] font-semibold text-[var(--success-text)]'
                                : 'rounded-md bg-[var(--bg-card)] px-2 py-0.5 text-[9px] font-semibold text-[var(--text-2)] border border-[var(--border-lt)]'
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
                                ? 'rounded-md bg-[var(--success-bg)] px-2 py-0.5 text-[9px] font-semibold text-[var(--success-text)]'
                                : 'rounded-md bg-[var(--bg-card)] px-2 py-0.5 text-[9px] font-semibold text-[var(--text-2)] border border-[var(--border-lt)]'
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

        <div className="border-t border-[var(--border-lt)] p-3 space-y-2">
          <label className="flex items-center gap-2 text-[10px] text-[var(--text-4)]">
            <input
              type="checkbox"
              checked={speakReplies}
              onChange={e => setSpeakReplies(e.target.checked)}
            />
            Speak replies (browser voice)
          </label>
          <div className="flex items-end gap-2">
            <textarea
              className="form-input flex-1 resize-none text-xs"
              rows={2}
              placeholder={DIA_ASK_PLACEHOLDER}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            {voiceSupported && (
              <button
                type="button"
                className={
                  listening
                    ? 'btn-primary px-3 py-2 text-xs bg-[var(--danger)] border-[var(--danger)]'
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
