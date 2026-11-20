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
import { useDiaVoice } from '@/lib/jarvis/use-dia-voice'
import { DiaVoiceState } from './DiaVoiceState'

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
  /** Which model answered. Shown when it changes, so a fallback is visible. */
  model?: string
}

/**
 * The model that answered the previous assistant message, so the panel can
 * name the model only when it changes — once at the start of a conversation,
 * and again if the provider falls back mid-conversation, which otherwise
 * happened silently and changed the quality of every answer after it.
 */
function modelBefore(messages: ChatMessage[], id: string): string | undefined {
  const index = messages.findIndex(m => m.id === id)
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant' && messages[i].model) return messages[i].model
  }
  return undefined
}

interface JarvisPanelProps {
  open: boolean
  onClose: () => void
  onOpen?: () => void
  pathname?: string
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

type PendingFile = { id: string; name: string; mediaType: string; data: string; size: number }

const ATTACH_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf'
const MAX_FILES = 4
const MAX_PDF_BYTES = 7 * 1024 * 1024

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Photos are shrunk to 1600px JPEG: plenty for reading text, small to send. */
async function photoToJpeg(file: File): Promise<{ data: string; size: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not open the photo'))
      el.src = url
    })
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not open the photo')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('Could not open the photo')
    return { data: await readAsBase64(blob), size: blob.size }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function ConfirmActionCard({
  action,
}: {
  action: Extract<DiaActionCard, { type: 'confirm_action' }>
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'dismissed'>('idle')
  const [result, setResult] = useState<{ message: string; href?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setState('saving')
    setError(null)
    try {
      const res = await fetch('/api/jarvis/actions/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: action.token }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setError(data.error || data.message || 'Could not save')
        setState(res.status === 409 ? 'done' : 'idle')
        return
      }
      setResult({ message: data.message, href: data.href })
      setState('done')
    } catch {
      setError('Could not reach the server. Try again.')
      setState('idle')
    }
  }

  if (state === 'dismissed') {
    return <p className="text-[10px] text-[var(--text-4)]">{action.title} — cancelled, nothing saved.</p>
  }

  return (
    <div className="rounded-xl border border-[var(--primary)] bg-[var(--bg-card)] p-2 space-y-1.5">
      <p className="text-[11px] font-semibold text-[var(--text-1)]">{action.title}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
        {action.lines.map((l, i) => (
          <div key={i} className="contents">
            <dt className="text-[var(--text-4)]">{l.label}</dt>
            <dd className="text-[var(--text-2)] text-right tabular-nums">{l.value}</dd>
          </div>
        ))}
      </dl>
      {action.warnings?.map((w, i) => (
        <p key={i} className="rounded-md bg-[var(--warning-bg)] px-2 py-1 text-[10px] text-[var(--warning-text)]">{w}</p>
      ))}
      {error && <p className="text-[10px] text-[var(--danger-text)]">{error}</p>}
      {state === 'done' && result ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold text-[var(--success-text)]">✓ {result.message}</p>
          {result.href && <a href={result.href} className="btn-secondary px-2 py-1 text-[10px] shrink-0">Open</a>}
        </div>
      ) : state !== 'done' && (
        <div className="flex gap-1.5">
          <button type="button" className="btn-primary px-2 py-1 text-[10px]" disabled={state === 'saving'} onClick={() => void confirm()}>
            {state === 'saving' ? 'Saving…' : 'Confirm'}
          </button>
          <button type="button" className="btn-secondary px-2 py-1 text-[10px]" disabled={state === 'saving'} onClick={() => setState('dismissed')}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function cellText(v: string | number | null | undefined): string {
  if (v == null) return '—'
  return typeof v === 'number' ? v.toLocaleString('en-KE', { maximumFractionDigits: 2 }) : v
}

function ReportCard({ action, onCopied }: { action: Extract<DiaActionCard, { type: 'report' }>; onCopied: (label: string) => void }) {
  const csv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    return [action.columns, ...action.rows.map(r => action.columns.map(c => r[c])), action.columns.map(c => action.totals[c])]
      .map(row => row.map(q).join(',')).join('\n')
  }
  return (
    <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] p-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-1)]">{action.title}</p>
          <p className="text-[10px] text-[var(--text-4)]">
            {action.period ? `${action.period.from} to ${action.period.to}` : 'As of now'}
            {Object.entries(action.filters).map(([k, v]) => ` · ${k}: ${v}`).join('')}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-[10px] shrink-0"
          onClick={async () => onCopied((await copyText(csv())) ? 'Report copied — paste into Excel or Sheets' : 'Copy failed')}
        >
          Copy
        </button>
      </div>
      <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border-lt)]">
        <table className="w-full text-[10px] tabular-nums">
          <thead className="sticky top-0 bg-[var(--bg-surface)]">
            <tr>{action.columns.map((c, i) => <th key={c} className={`px-2 py-1 font-semibold text-[var(--text-3)] whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {action.rows.map((r, ri) => (
              <tr key={ri} className="border-t border-[var(--border-lt)]">
                {action.columns.map((c, i) => <td key={c} className={`px-2 py-1 text-[var(--text-2)] ${i === 0 ? 'text-left' : 'text-right whitespace-nowrap'}`}>{cellText(r[c])}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-[var(--bg-surface)]">
            <tr className="border-t border-[var(--border)]">
              {action.columns.map((c, i) => <td key={c} className={`px-2 py-1 font-bold text-[var(--text-1)] ${i === 0 ? 'text-left' : 'text-right whitespace-nowrap'}`}>{cellText(action.totals[c])}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      {(action.truncated || action.note) && (
        <p className="text-[10px] text-[var(--text-4)]">
          {action.truncated ? `Showing ${action.rows.length} of ${action.rowCount} rows; totals cover all. ` : ''}{action.note}
        </p>
      )}
    </div>
  )
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
        if (action.type === 'confirm_action') {
          return <ConfirmActionCard key={action.token} action={action} />
        }
        if (action.type === 'report') {
          return <ReportCard key={i} action={action} onCopied={onCopied} />
        }
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
  const [error, setError] = useState<string | null>(null)
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const [files, setFiles] = useState<PendingFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sendRef = useRef<(text?: string) => void>(() => {})
  const modeRef = useRef(mode)

  const voice = useDiaVoice({
    thinking: sending,
    onTranscript: text => sendRef.current(text),
  })
  // A finished sentence from the microphone goes straight out, without ever
  // passing through the typing box and overwriting what is being typed there.
  sendRef.current = (text?: string) => { void sendMessage(text) }

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
    modeRef.current = mode
  }, [mode])

  // Voice mode defaults to spoken replies; leaving Voice does not force-off if user enabled it.
  useEffect(() => {
    if (mode === 'voice') voice.setSpeakReplies(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, statusNote])

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    const attached = files
    if ((!text && !attached.length) || sending) return
    setError(null)
    setStatusNote(null)
    setInput('')
    setFiles([])
    setSending(true)

    const shown = attached.length ? `${text}${text ? '\n' : ''}📎 ${attached.map(f => f.name).join(', ')}` : text
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: shown }
    setMessages(prev => [...prev, userMsg])

    try {
      const res = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          attachments: attached.map(f => ({ name: f.name, mediaType: f.mediaType, data: f.data })),
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
          model: typeof data.model === 'string' ? data.model : undefined,
          sources: data.sources,
          actions: Array.isArray(data.actions) ? data.actions : [],
          toolCalls: data.toolCalls,
        },
      ])
      if (typeof data.reply === 'string') voice.speak(data.reply)
    } catch {
      setError(`Could not reach ${DIA_SHORT_NAME}. Check your connection and try again.`)
    } finally {
      setSending(false)
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length) return
    setError(null)
    const room = MAX_FILES - files.length
    if (room <= 0) { setError(`Attach up to ${MAX_FILES} files at a time.`); return }
    const picked = Array.from(list).slice(0, room)
    const next: PendingFile[] = []
    for (const file of picked) {
      try {
        if (file.type === 'application/pdf') {
          if (file.size > MAX_PDF_BYTES) { setError(`${file.name} is over 7 MB.`); continue }
          next.push({ id: `${file.name}-${Date.now()}-${next.length}`, name: file.name, mediaType: 'application/pdf', data: await readAsBase64(file), size: file.size })
        } else if (file.type.startsWith('image/')) {
          const jpeg = await photoToJpeg(file)
          next.push({ id: `${file.name}-${Date.now()}-${next.length}`, name: file.name, mediaType: 'image/jpeg', data: jpeg.data, size: jpeg.size })
        } else {
          setError('Only photos and PDFs can be attached.')
        }
      } catch {
        setError(`Could not read ${file.name}.`)
      }
    }
    if (list.length > room) setError(`Only ${MAX_FILES} files at a time — the rest were left out.`)
    setFiles(prev => [...prev, ...next])
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
    setFiles([])
    setError(null)
    setStatusNote(null)
  }

  function selectMode(next: DiaMode) {
    setMode(next)
    setStatusNote(null)
    setError(null)
    // Changing what DIA is for mid-sentence should not leave it talking or listening.
    if (voice.listening) voice.toggleMic()
    voice.stopSpeaking()
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
        className="safe-top safe-bottom fixed inset-0 z-[201] flex h-[var(--app-h)] w-full max-w-none flex-col overflow-hidden bg-[var(--bg-card)] shadow-2xl md:inset-auto md:right-4 md:top-4 md:bottom-4 md:h-auto md:w-[460px] md:max-w-[calc(100vw-32px)] md:rounded-2xl md:border md:border-[var(--border)]"
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
            <div key={m.id} className={m.role === 'user' ? 'dia-message-in flex justify-end' : 'dia-message-in flex justify-start'}>
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
                {m.model && m.model !== modelBefore(messages, m.id) && (
                  <p className="mt-1.5 text-[10px] text-[var(--text-4)]">Answered by {m.model}</p>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="dia-message-in rounded-2xl border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-4)]">
                <DiaVoiceState state="thinking" />
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
          {(mode === 'voice' || voice.speakReplies) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="flex items-center gap-2 text-[10px] text-[var(--text-4)]">
                <input
                  type="checkbox"
                  checked={voice.speakReplies}
                  onChange={e => {
                    voice.setSpeakReplies(e.target.checked)
                    if (!e.target.checked) voice.stopSpeaking()
                  }}
                />
                Speak replies
              </label>
              {voice.speakReplies && voice.voices.length > 1 && (
                <label className="flex items-center gap-1 text-[10px] text-[var(--text-4)]">
                  <span className="sr-only">Reply voice</span>
                  <select
                    className="rounded-md border border-[var(--border-lt)] bg-[var(--bg-surface)] px-1 py-0.5 text-[10px] text-[var(--text-2)]"
                    value={voice.voiceURI ?? ''}
                    onChange={e => voice.setVoiceURI(e.target.value || null)}
                  >
                    {voice.voices.map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                    ))}
                  </select>
                </label>
              )}
              {voice.state !== 'idle' && <DiaVoiceState state={voice.state} className="ml-auto" />}
              {voice.speaking && (
                <button
                  type="button"
                  className="btn-secondary px-2 py-0.5 text-[10px]"
                  onClick={voice.stopSpeaking}
                >
                  Stop speaking
                </button>
              )}
            </div>
          )}
          {voice.interim && (
            <p className="dia-interim text-[11px] italic text-[var(--text-3)]">
              {voice.interim}
            </p>
          )}
          {voice.error && (
            <p className="text-[10px] font-semibold text-[var(--danger-text)]">{voice.error}</p>
          )}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {files.map(f => (
                <span key={f.id} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-lt)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] text-[var(--text-2)]">
                  {f.mediaType === 'application/pdf' ? 'PDF' : 'Photo'} · {f.name.length > 28 ? `${f.name.slice(0, 25)}…` : f.name}
                  <button type="button" className="text-[var(--text-4)] hover:text-[var(--danger)]" aria-label={`Remove ${f.name}`} onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))}>×</button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACH_ACCEPT}
            multiple
            className="hidden"
            onChange={e => { void addFiles(e.target.files); e.target.value = '' }}
          />
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || files.length >= MAX_FILES}
              aria-label="Attach a photo or PDF"
              title="Attach a photo or PDF (invoice, receipt, quote, business card) for DIA to read"
            >
              Attach
            </button>
            <textarea
              className="form-input flex-1 resize-none text-xs"
              rows={2}
              placeholder={modeMeta.placeholder}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
            {voice.supported && (
              <button
                type="button"
                className={
                  voice.listening
                    ? 'btn-danger px-3 py-2 text-xs'
                    : mode === 'voice'
                      ? 'btn-primary px-3 py-2 text-xs'
                      : 'btn-secondary px-3 py-2 text-xs'
                }
                onClick={voice.toggleMic}
                disabled={sending}
                aria-label={voice.listening ? 'Stop listening' : `Speak to ${DIA_SHORT_NAME}`}
                title={voice.listening ? 'Listening — click to stop' : voice.speaking ? 'Speak now; this stops DIA' : 'Speak your question'}
              >
                {voice.listening ? 'Stop' : 'Mic'}
              </button>
            )}
            <button
              className="btn-primary px-3 py-2 text-xs disabled:opacity-50"
              onClick={() => void sendMessage()}
              disabled={sending || (!input.trim() && !files.length)}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
