'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

/**
 * Internal chat: a button in the top bar with the unread count, and a side
 * panel (full screen on a phone) with one-to-one and group conversations.
 * Messages carry text, a linked ERP record and a photo or file. Live through
 * /api/chat/stream; everything else is the /api/chat routes.
 */

type Person = { id: string; name: string; role: string }
type RecordLink = { type: string; id: string; title: string; subtitle?: string; href: string }
type Message = {
  id: string; conversationId: string; senderId: string; body: string
  record: RecordLink | null
  attachment: { name: string; contentType: string; size: number } | null
  createdAt: string; deleted: boolean
}
type Conversation = {
  id: string; kind: 'direct' | 'group'; name: string | null; createdBy: string
  memberIds: string[]; admins: string[]; lastMessageAt: string
  lastMessage: { senderId: string; preview: string; createdAt: string } | null
  unread: number
}
type SearchHit = { type: string; id: string; title: string; subtitle: string; href: string }
type View = { screen: 'list' } | { screen: 'chat'; id: string } | { screen: 'new' } | { screen: 'group' } | { screen: 'info'; id: string }

const RECORD_LABEL: Record<string, string> = {
  repair: 'Repair', sale_order: 'Sale order', invoice: 'Invoice', serial: 'Machine', contact: 'Contact', delivery: 'Delivery', purchase: 'Purchase order',
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
const timeLabel = (iso: string) => {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
  return day === today
    ? d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
    : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
}
const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong')
  return data as T
}

function Avatar({ name, group }: { name: string; group?: boolean }) {
  return (
    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ background: group ? 'var(--navy)' : 'linear-gradient(135deg, var(--navy), var(--accent-cyan))' }}>
      {group ? '#' : initials(name)}
    </span>
  )
}

export default function ChatDock({ currentUserId, showToast }: { currentUserId: string | null; showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>({ screen: 'list' })
  const [people, setPeople] = useState<Person[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [mounted, setMounted] = useState(false)
  const seenLast = useRef<Map<string, string>>(new Map())
  const firstLoad = useRef(true)
  const openRef = useRef(open)
  const viewRef = useRef(view)
  openRef.current = open
  viewRef.current = view

  useEffect(() => { setMounted(true) }, [])

  const nameOf = useCallback((id: string) => people.find(p => p.id === id)?.name ?? 'Someone', [people])
  // Loaders read these through refs so they never change identity: a new
  // people list must not restart the live connection (it used to loop).
  const nameOfRef = useRef(nameOf)
  nameOfRef.current = nameOf
  const toastRef = useRef(showToast)
  toastRef.current = showToast
  const titleOf = useCallback((c: Conversation) => {
    if (c.kind === 'group') return c.name || 'Group'
    const other = c.memberIds.find(id => id !== currentUserId)
    return other ? nameOf(other) : 'Just you'
  }, [currentUserId, nameOf])

  const loadPeople = useCallback(async () => {
    try { setPeople((await api<{ people: Person[] }>('/api/chat/people')).people) } catch { /* retried on open */ }
  }, [])

  const loadConversations = useCallback(async () => {
    if (!currentUserId) return
    try {
      const list = (await api<{ conversations: Conversation[] }>('/api/chat/conversations')).conversations
      // A new message from someone else, not on screen: a short toast.
      if (!firstLoad.current) {
        for (const c of list) {
          const prev = seenLast.current.get(c.id)
          const last = c.lastMessage
          if (!last || last.createdAt === prev || last.senderId === currentUserId) continue
          const onScreen = openRef.current && viewRef.current.screen === 'chat' && viewRef.current.id === c.id && document.visibilityState === 'visible'
          if (!onScreen && c.unread > 0) toastRef.current(`💬 ${c.kind === 'group' ? `${c.name || 'Group'}: ` : ''}${nameOfRef.current(last.senderId)} — ${last.preview.slice(0, 60)}`, 'info')
        }
      }
      firstLoad.current = false
      seenLast.current = new Map(list.map(c => [c.id, c.lastMessage?.createdAt ?? '']))
      setConversations(list)
    } catch { /* keeps the last list */ }
  }, [currentUserId])

  const activeId = view.screen === 'chat' ? view.id : null
  const loadMessages = useCallback(async (id: string, mode: 'all' | 'new' = 'all') => {
    try {
      let fromOthers = false
      if (mode === 'new') {
        const known = messages.filter(m => m.conversationId === id)
        const after = known.at(-1)?.createdAt
        const fresh = (await api<{ messages: Message[] }>(`/api/chat/conversations/${id}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`)).messages
          .filter(f => !known.some(k => k.id === f.id && k.deleted === f.deleted))
        if (fresh.length) setMessages(prev => [...prev.filter(m => !fresh.some(f => f.id === m.id)), ...fresh])
        fromOthers = fresh.some(f => f.senderId !== currentUserId)
      } else {
        setLoadingMessages(true)
        setMessages((await api<{ messages: Message[] }>(`/api/chat/conversations/${id}/messages`)).messages)
        fromOthers = true
      }
      // Read only what someone else sent; the server ignores it when nothing was unread.
      if (fromOthers && document.visibilityState === 'visible') void fetch(`/api/chat/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
    } catch (err) {
      toastRef.current(err instanceof Error ? err.message : 'Could not load the messages', 'error')
    } finally {
      setLoadingMessages(false)
    }
  }, [messages, currentUserId])
  const loadMessagesRef = useRef(loadMessages)
  loadMessagesRef.current = loadMessages

  // Live: a change for me (new message, read, group change) reloads what is on screen.
  const loadConversationsRef = useRef(loadConversations)
  loadConversationsRef.current = loadConversations
  useEffect(() => {
    if (!currentUserId) return
    void loadPeople()
    void loadConversationsRef.current()
    const source = new EventSource('/api/chat/stream')
    const refresh = () => {
      void loadConversationsRef.current()
      const v = viewRef.current
      if (openRef.current && v.screen === 'chat') void loadMessagesRef.current(v.id, 'new')
    }
    source.addEventListener('chat', refresh)
    window.addEventListener('focus', refresh)
    return () => { source.close(); window.removeEventListener('focus', refresh) }
  }, [currentUserId, loadPeople])

  useEffect(() => { if (activeId) void loadMessagesRef.current(activeId, 'all') }, [activeId])

  // Other screens open a chat with: window.dispatchEvent(new CustomEvent('deed:open-chat', { detail: { userId } }))
  useEffect(() => {
    const onOpen = async (e: Event) => {
      const userId = (e as CustomEvent<{ userId?: string }>).detail?.userId
      setOpen(true)
      if (!userId) return
      try {
        const { id } = await api<{ id: string }>('/api/chat/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'direct', userId }) })
        await loadConversations()
        setView({ screen: 'chat', id })
      } catch (err) { showToast(err instanceof Error ? err.message : 'Could not open the chat', 'error') }
    }
    window.addEventListener('deed:open-chat', onOpen)
    return () => window.removeEventListener('deed:open-chat', onOpen)
  }, [loadConversations, showToast])

  const unread = conversations.reduce((s, c) => s + c.unread, 0)

  if (!currentUserId) return null

  const panel = open && mounted ? createPortal(
    // chat-dock: full screen on a phone (components/erp/mobile-chrome.css pads other dialogs).
    <div className="chat-dock fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Chat">
      <button type="button" aria-label="Close chat" className="absolute inset-0 hidden bg-black/20 sm:block" onClick={() => setOpen(false)} />
      {/* A section, not a div: the global "[role=dialog] > div" modal-card style must not apply to this full-height panel. */}
      <section className="relative flex h-[100dvh] w-full flex-col bg-[var(--bg-card)] shadow-2xl sm:w-[420px] sm:border-l sm:border-[var(--border-lt)]">
        {view.screen === 'list' && (
          <ConversationList
            conversations={conversations}
            titleOf={titleOf}
            nameOf={nameOf}
            currentUserId={currentUserId}
            onOpen={id => setView({ screen: 'chat', id })}
            onNew={() => setView({ screen: 'new' })}
            onNewGroup={() => setView({ screen: 'group' })}
            onClose={() => setOpen(false)}
          />
        )}
        {view.screen === 'new' && (
          <PeoplePicker
            people={people.filter(p => p.id !== currentUserId)}
            onBack={() => setView({ screen: 'list' })}
            onPick={async p => {
              try {
                const { id } = await api<{ id: string }>('/api/chat/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'direct', userId: p.id }) })
                await loadConversations()
                setView({ screen: 'chat', id })
              } catch (err) { showToast(err instanceof Error ? err.message : 'Could not start the chat', 'error') }
            }}
          />
        )}
        {view.screen === 'group' && (
          <GroupForm
            people={people.filter(p => p.id !== currentUserId)}
            onBack={() => setView({ screen: 'list' })}
            onCreate={async (name, memberIds) => {
              const { id } = await api<{ id: string }>('/api/chat/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'group', name, memberIds }) })
              await loadConversations()
              setView({ screen: 'chat', id })
            }}
          />
        )}
        {view.screen === 'chat' && (() => {
          const c = conversations.find(x => x.id === view.id)
          return (
            <ChatThread
              conversation={c}
              title={c ? titleOf(c) : 'Chat'}
              currentUserId={currentUserId}
              nameOf={nameOf}
              messages={messages.filter(m => m.conversationId === view.id)}
              loading={loadingMessages}
              onBack={() => { setView({ screen: 'list' }); void loadConversations() }}
              onInfo={() => setView({ screen: 'info', id: view.id })}
              onOpenRecord={href => { router.push(href); if (window.innerWidth < 640) setOpen(false) }}
              onSend={async input => {
                const res = input.file
                  ? await (async () => {
                      const form = new FormData()
                      form.set('body', input.body)
                      if (input.record) form.set('record', JSON.stringify(input.record))
                      form.set('file', input.file!)
                      return api<{ message: Message }>(`/api/chat/conversations/${view.id}/messages`, { method: 'POST', body: form })
                    })()
                  : await api<{ message: Message }>(`/api/chat/conversations/${view.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: input.body, record: input.record }) })
                setMessages(prev => [...prev.filter(m => m.id !== res.message.id), res.message])
                void loadConversations()
              }}
              onDelete={async id => {
                try {
                  await api(`/api/chat/messages/${id}`, { method: 'DELETE' })
                  setMessages(prev => prev.map(m => m.id === id ? { ...m, deleted: true, body: '', record: null, attachment: null } : m))
                } catch (err) { showToast(err instanceof Error ? err.message : 'Could not delete it', 'error') }
              }}
              showToast={showToast}
            />
          )
        })()}
        {view.screen === 'info' && (() => {
          const c = conversations.find(x => x.id === view.id)
          if (!c) return null
          return (
            <GroupInfo
              conversation={c}
              people={people}
              currentUserId={currentUserId}
              onBack={() => setView({ screen: 'chat', id: c.id })}
              onChange={async change => {
                try {
                  await api(`/api/chat/conversations/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
                  await loadConversations()
                  if (change.leave) setView({ screen: 'list' })
                } catch (err) { showToast(err instanceof Error ? err.message : 'Could not change the group', 'error') }
              }}
            />
          )
        })()}
      </section>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open) { setView({ screen: 'list' }); void loadConversations() } }}
        className={`icon-btn relative w-9 h-9 focus-ring ${open ? 'active' : ''}`}
        aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
        title="Chat"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full z-10 px-1 text-[10px] font-black text-white shadow-md ring-2 ring-[var(--bg-card)]" style={{ background: '#00AEEF' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {panel}
    </>
  )
}

function PanelHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border-lt)] px-3 py-2.5" style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}>
      {onBack && (
        <button type="button" onClick={onBack} className="icon-btn h-9 w-9 focus-ring" aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[var(--text-1)]">{title}</p>
        {sub && <p className="truncate text-[11px] text-[var(--text-3)]">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

function ConversationList({ conversations, titleOf, nameOf, currentUserId, onOpen, onNew, onNewGroup, onClose }: {
  conversations: Conversation[]; titleOf: (c: Conversation) => string; nameOf: (id: string) => string; currentUserId: string
  onOpen: (id: string) => void; onNew: () => void; onNewGroup: () => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const shown = conversations.filter(c => !q.trim() || titleOf(c).toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      <PanelHeader
        title="Chat"
        sub="Messages between Deed staff"
        right={(
          <button type="button" onClick={onClose} className="icon-btn h-9 w-9 focus-ring" aria-label="Close chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      />
      <div className="flex gap-2 px-3 py-2">
        <button type="button" className="btn-primary flex-1 text-xs" onClick={onNew}>New chat</button>
        <button type="button" className="btn-outline flex-1 text-xs" onClick={onNewGroup}>New group</button>
      </div>
      <div className="px-3 pb-2">
        <input className="form-input w-full text-sm" placeholder="Search chats…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {shown.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-[var(--text-3)]">{conversations.length ? 'No chat matches' : 'No chats yet. Start one with New chat or New group.'}</p>
        )}
        {shown.map(c => (
          <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-muted)]">
            <Avatar name={titleOf(c)} group={c.kind === 'group'} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-sm ${c.unread ? 'font-bold text-[var(--text-1)]' : 'font-semibold text-[var(--text-1)]'}`}>{titleOf(c)}</span>
                {c.lastMessage && <span className="flex-shrink-0 text-[10px] text-[var(--text-3)]">{timeLabel(c.lastMessage.createdAt)}</span>}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className={`truncate text-xs ${c.unread ? 'text-[var(--text-1)]' : 'text-[var(--text-3)]'}`}>
                  {c.lastMessage
                    ? `${c.lastMessage.senderId === currentUserId ? 'You: ' : c.kind === 'group' ? `${nameOf(c.lastMessage.senderId).split(' ')[0]}: ` : ''}${c.lastMessage.preview}`
                    : c.kind === 'group' ? `${c.memberIds.length} people` : 'Say hello'}
                </span>
                {c.unread > 0 && <span className="flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-black text-white" style={{ background: '#00AEEF' }}>{c.unread}</span>}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function PeoplePicker({ people, onBack, onPick }: { people: Person[]; onBack: () => void; onPick: (p: Person) => void | Promise<void> }) {
  const [q, setQ] = useState('')
  const shown = people.filter(p => !q.trim() || `${p.name} ${p.role}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      <PanelHeader title="New chat" sub="Choose who to message" onBack={onBack} />
      <div className="px-3 py-2"><input autoFocus className="form-input w-full text-sm" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {shown.map(p => (
          <button key={p.id} type="button" onClick={() => void onPick(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-muted)]">
            <Avatar name={p.name} />
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--text-1)]">{p.name}</span><span className="block truncate text-[11px] text-[var(--text-3)]">{p.role}</span></span>
          </button>
        ))}
        {!shown.length && <p className="px-4 py-8 text-center text-xs text-[var(--text-3)]">No one matches</p>}
      </div>
    </>
  )
}

function GroupForm({ people, onBack, onCreate }: { people: Person[]; onBack: () => void; onCreate: (name: string, ids: string[]) => Promise<void> }) {
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const shown = people.filter(p => !q.trim() || `${p.name} ${p.role}`.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = (id: string) => setPicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return (
    <>
      <PanelHeader title="New group" sub={`${picked.size} chosen`} onBack={onBack} />
      <div className="space-y-2 px-3 py-2">
        {error && <p role="alert" className="rounded-md px-2 py-1.5 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</p>}
        <input autoFocus className="form-input w-full text-sm" placeholder="Group name, e.g. Workshop" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
        <input className="form-input w-full text-sm" placeholder="Search people to add…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {shown.map(p => (
          <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--bg-muted)]">
            <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
            <Avatar name={p.name} />
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--text-1)]">{p.name}</span><span className="block truncate text-[11px] text-[var(--text-3)]">{p.role}</span></span>
          </label>
        ))}
      </div>
      <div className="border-t border-[var(--border-lt)] p-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button type="button" className="btn-primary w-full" disabled={saving} onClick={async () => {
          setError('')
          if (name.trim().length < 2) return setError('Give the group a name')
          if (!picked.size) return setError('Add at least one person')
          setSaving(true)
          try { await onCreate(name.trim(), [...picked]) } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the group') } finally { setSaving(false) }
        }}>{saving ? 'Creating…' : 'Create group'}</button>
      </div>
    </>
  )
}

function GroupInfo({ conversation, people, currentUserId, onBack, onChange }: {
  conversation: Conversation; people: Person[]; currentUserId: string; onBack: () => void
  onChange: (change: { name?: string; add?: string[]; remove?: string; leave?: boolean }) => Promise<void>
}) {
  const isAdmin = conversation.admins.includes(currentUserId)
  const [name, setName] = useState(conversation.name ?? '')
  const [adding, setAdding] = useState('')
  const members = conversation.memberIds.map(id => people.find(p => p.id === id) ?? { id, name: 'Former user', role: '' })
  const addable = people.filter(p => !conversation.memberIds.includes(p.id))
  return (
    <>
      <PanelHeader title={conversation.name || 'Group'} sub={`${conversation.memberIds.length} people`} onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
        {isAdmin && (
          <div className="flex gap-2">
            <input className="form-input flex-1 text-sm" value={name} onChange={e => setName(e.target.value)} maxLength={80} aria-label="Group name" />
            <button type="button" className="btn-outline text-xs" disabled={name.trim() === (conversation.name ?? '')} onClick={() => void onChange({ name })}>Rename</button>
          </div>
        )}
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">People</p>
          {members.map(m => (
            <div key={m.id} className="flex items-center gap-3 py-1.5">
              <Avatar name={m.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--text-1)]">{m.name}{m.id === currentUserId ? ' (you)' : ''}</span>
                <span className="block truncate text-[11px] text-[var(--text-3)]">{conversation.admins.includes(m.id) ? 'Group admin' : m.role}</span>
              </span>
              {isAdmin && m.id !== currentUserId && (
                <button type="button" className="text-[11px] font-semibold" style={{ color: 'var(--danger-text)' }} onClick={() => void onChange({ remove: m.id })}>Remove</button>
              )}
            </div>
          ))}
        </div>
        {isAdmin && addable.length > 0 && (
          <div className="flex gap-2">
            <select className="form-select flex-1 text-sm" value={adding} onChange={e => setAdding(e.target.value)} aria-label="Add a person">
              <option value="">Add someone…</option>
              {addable.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
            </select>
            <button type="button" className="btn-primary text-xs" disabled={!adding} onClick={() => { void onChange({ add: [adding] }); setAdding('') }}>Add</button>
          </div>
        )}
        <button type="button" className="btn-outline w-full text-xs" style={{ color: 'var(--danger-text)' }} onClick={() => { if (window.confirm('Leave this group? You will stop getting its messages.')) void onChange({ leave: true }) }}>Leave group</button>
      </div>
    </>
  )
}

function ChatThread({ conversation, title, currentUserId, nameOf, messages, loading, onBack, onInfo, onOpenRecord, onSend, onDelete, showToast }: {
  conversation: Conversation | undefined; title: string; currentUserId: string; nameOf: (id: string) => string
  messages: Message[]; loading: boolean
  onBack: () => void; onInfo: () => void; onOpenRecord: (href: string) => void
  onSend: (input: { body: string; record: RecordLink | null; file: File | null }) => Promise<void>
  onDelete: (id: string) => void
  showToast: (m: string, t?: 'success' | 'error' | 'info') => void
}) {
  const [text, setText] = useState('')
  const [record, setRecord] = useState<RecordLink | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [linking, setLinking] = useState(false)
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const isGroup = conversation?.kind === 'group'

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const send = async () => {
    if (sending || (!text.trim() && !record && !file)) return
    setSending(true)
    try {
      await onSend({ body: text, record, file })
      setText(''); setRecord(null); setFile(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Not sent — try again', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PanelHeader
        title={title}
        sub={isGroup ? `${conversation?.memberIds.length ?? 0} people` : undefined}
        onBack={onBack}
        right={isGroup ? <button type="button" className="text-xs font-semibold" style={{ color: 'var(--info-text)' }} onClick={onInfo}>Group</button> : undefined}
      />
      <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3" style={{ background: 'var(--bg-muted)' }}>
        {loading && !messages.length && <p className="text-center text-xs text-[var(--text-3)]">Loading…</p>}
        {!loading && !messages.length && <p className="py-8 text-center text-xs text-[var(--text-3)]">No messages yet. Say hello, link a record or send a photo.</p>}
        {messages.map(m => {
          const mine = m.senderId === currentUserId
          return (
            <div key={m.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[85%]">
                {isGroup && !mine && <p className="mb-0.5 px-1 text-[10px] font-semibold text-[var(--text-3)]">{nameOf(m.senderId)}</p>}
                <div className="rounded-2xl px-3 py-2 text-sm shadow-sm" style={mine
                  ? { background: '#20164D', color: '#fff', borderBottomRightRadius: 6 }
                  : { background: 'var(--bg-card)', color: 'var(--text-1)', borderBottomLeftRadius: 6 }}>
                  {m.deleted && <p className="italic opacity-70">Message deleted</p>}
                  {m.attachment && (m.attachment.contentType.startsWith('image/')
                    ? (
                      <a href={`/api/chat/messages/${m.id}/file`} target="_blank" rel="noreferrer" className="mb-1 block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/chat/messages/${m.id}/file`} alt={m.attachment.name} className="max-h-56 rounded-lg object-cover" loading="lazy" />
                      </a>
                    ) : (
                      <a href={`/api/chat/messages/${m.id}/file?download=1`} className="mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 no-underline" style={{ background: mine ? 'rgba(255,255,255,0.12)' : 'var(--bg-muted)', color: 'inherit' }}>
                        <span aria-hidden="true">📎</span>
                        <span className="min-w-0"><span className="block truncate text-xs font-semibold">{m.attachment.name}</span><span className="block text-[10px] opacity-70">{sizeLabel(m.attachment.size)}</span></span>
                      </a>
                    ))}
                  {m.record && (
                    <button type="button" onClick={() => onOpenRecord(m.record!.href)} className="mb-1 block w-full rounded-lg px-2 py-1.5 text-left" style={{ background: mine ? 'rgba(255,255,255,0.12)' : '#E0F6FD', color: mine ? '#fff' : '#20164D', border: mine ? 'none' : '1px solid #00AEEF' }}>
                      <span className="block text-[10px] font-semibold uppercase opacity-80">{RECORD_LABEL[m.record.type] ?? 'Record'}</span>
                      <span className="block truncate text-xs font-bold">{m.record.title}</span>
                      {m.record.subtitle && <span className="block truncate text-[11px] opacity-80">{m.record.subtitle}</span>}
                    </button>
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                </div>
                <p className={`mt-0.5 flex items-center gap-2 px-1 text-[10px] text-[var(--text-3)] ${mine ? 'justify-end' : ''}`}>
                  {timeLabel(m.createdAt)}
                  {mine && !m.deleted && (
                    <button type="button" className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" onClick={() => { if (window.confirm('Delete this message for everyone?')) onDelete(m.id) }}>Delete</button>
                  )}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>
      {linking && <RecordSearch onPick={r => { setRecord(r); setLinking(false) }} onClose={() => setLinking(false)} />}
      <div className="border-t border-[var(--border-lt)] bg-[var(--bg-card)] p-2" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        {(record || file) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {record && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[11px]" style={{ background: '#E0F6FD', color: '#20164D', border: '1px solid #00AEEF' }}>
                🔗 <span className="truncate">{RECORD_LABEL[record.type] ?? 'Record'} {record.title}</span>
                <button type="button" aria-label="Remove link" onClick={() => setRecord(null)}>×</button>
              </span>
            )}
            {file && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[11px]" style={{ background: 'var(--bg-muted)' }}>
                📎 <span className="truncate">{file.name}</span> · {sizeLabel(file.size)}
                <button type="button" aria-label="Remove file" onClick={() => setFile(null)}>×</button>
              </span>
            )}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <button type="button" className="icon-btn h-10 w-10 flex-shrink-0 focus-ring" aria-label="Attach a photo or file" title="Photo or file" onClick={() => fileInput.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          <button type="button" className="icon-btn h-10 w-10 flex-shrink-0 focus-ring" aria-label="Link a record" title="Link a repair, order, invoice…" onClick={() => setLinking(v => !v)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
          </button>
          <input ref={fileInput} type="file" className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={e => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ''
              if (f && f.size > 10 * 1024 * 1024) { showToast('Files can be up to 10 MB', 'error'); return }
              setFile(f)
            }} />
          <textarea
            className="form-input min-h-[40px] flex-1 resize-none text-sm"
            rows={1}
            placeholder="Message…"
            value={text}
            maxLength={4000}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            style={{ maxHeight: 120 }}
          />
          <button type="button" className="btn-primary h-10 flex-shrink-0 px-3 text-xs" disabled={sending || (!text.trim() && !record && !file)} onClick={() => void send()}>
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </>
  )
}

function RecordSearch({ onPick, onClose }: { onPick: (r: RecordLink) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setHits([]); return }
    let cancelled = false
    setBusy(true)
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : { results: [] }))
        .then(d => { if (!cancelled) setHits(Array.isArray(d.results) ? d.results.slice(0, 12) : []) })
        .catch(() => {})
        .finally(() => { if (!cancelled) setBusy(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])
  const grouped = useMemo(() => hits, [hits])
  return (
    <div className="max-h-[45%] overflow-y-auto border-t border-[var(--border-lt)] bg-[var(--bg-card)] p-2">
      <div className="mb-1 flex items-center gap-2">
        <input autoFocus className="form-input flex-1 text-sm" placeholder="Find a repair, order, invoice, machine, contact…" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className="text-xs text-[var(--text-3)]" onClick={onClose}>Cancel</button>
      </div>
      {busy && <p className="px-1 text-[11px] text-[var(--text-3)]">Searching…</p>}
      {!busy && q.trim().length >= 2 && !grouped.length && <p className="px-1 text-[11px] text-[var(--text-3)]">Nothing found</p>}
      {grouped.map(h => (
        <button key={`${h.type}-${h.id}`} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-muted)]"
          onClick={() => onPick({ type: h.type, id: h.id, title: h.title, subtitle: h.subtitle, href: h.href })}>
          <span className="w-20 flex-shrink-0 text-[10px] font-semibold uppercase text-[var(--text-3)]">{RECORD_LABEL[h.type] ?? h.type}</span>
          <span className="min-w-0"><span className="block truncate text-xs font-semibold text-[var(--text-1)]">{h.title}</span><span className="block truncate text-[11px] text-[var(--text-3)]">{h.subtitle}</span></span>
        </button>
      ))}
    </div>
  )
}
