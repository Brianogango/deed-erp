'use client'
import { useState, useEffect } from 'react'
import { useApp } from '@/lib/store'
import { ModuleSkeleton } from '@/components/ui'

type SOPCategory = 'sales' | 'repair' | 'credit' | 'hr'

interface RefSOP {
  id: string
  category: SOPCategory
  title: string
  content: string
  updatedAt: string
  createdByName: string
  fileName?: string
  fileData?: string
}

const CATEGORIES: { id: SOPCategory; label: string; icon: string; bg: string; color: string; border: string }[] = [
  { id: 'sales',  label: 'Sales SOPs',  icon: '🛒', bg: '#DBEAFE', color: '#1D4ED8', border: '#BFDBFE' },
  { id: 'repair', label: 'Repair SOPs', icon: '🔧', bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0' },
  { id: 'credit', label: 'Credit SOPs', icon: '💳', bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  { id: 'hr',     label: 'HR SOPs',     icon: '👥', bg: '#EDE9FE', color: '#5B21B6', border: '#DDD6FE' },
]

const SEED_SOPS: RefSOP[] = []

const LS_KEY = 'deed_ref_sops'

function loadSOPs(): RefSOP[] {
  if (typeof window === 'undefined') return SEED_SOPS
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as RefSOP[]
  } catch {}
  return SEED_SOPS
}

function saveSOPs(sops: RefSOP[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(sops)) } catch {}
}

const uid = () => Math.random().toString(36).slice(2, 9)

export default function MyDocuments() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const { users, currentUserId, showToast } = useApp()
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin     = currentUser?.role === 'admin'

  const [sops, setSops]               = useState<RefSOP[]>(SEED_SOPS)
  const [catFilter, setCatFilter]     = useState<SOPCategory | 'all'>('all')
  const [search, setSearch]           = useState('')
  const [expanded, setExpanded]       = useState<Set<string>>(new Set())
  const [showModal, setShowModal]     = useState(false)
  const [editSop, setEditSop]         = useState<RefSOP | null>(null)
  const [form, setForm]               = useState({ category: 'sales' as SOPCategory, title: '', content: '', fileName: '', fileData: '' })

  useEffect(() => { setSops(loadSOPs()) }, [])

  function persist(next: RefSOP[]) { setSops(next); saveSOPs(next) }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function openCreate() {
    setEditSop(null)
    setForm({ category: 'sales', title: '', content: '', fileName: '', fileData: '' })
    setShowModal(true)
  }

  function openEdit(s: RefSOP) {
    setEditSop(s)
    setForm({ category: s.category, title: s.title, content: s.content, fileName: s.fileName || '', fileData: s.fileData || '' })
    setShowModal(true)
  }

  function handleSave() {
    if (!form.title.trim() || !form.content.trim()) return
    const now = new Date().toISOString().slice(0, 10)
    if (editSop) {
      persist(sops.map(s => s.id === editSop.id ? { ...s, ...form, updatedAt: now } : s))
    } else {
      persist([{ id: uid(), ...form, updatedAt: now, createdByName: currentUser?.name ?? 'Admin' }, ...sops])
    }
    setShowModal(false)
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this SOP?')) return
    persist(sops.filter(s => s.id !== id))
  }

  const q = search.toLowerCase()
  const visible = sops.filter(s =>
    (catFilter === 'all' || s.category === catFilter) &&
    (!q || s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q))
  )

  const counts = Object.fromEntries(
    CATEGORIES.map(c => [c.id, sops.filter(s => s.category === c.id).length])
  ) as Record<SOPCategory, number>

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="space-y-4 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-t1">SOPs Reference Library</h2>
          <p className="text-[11px] text-t3">Standard Operating Procedures for all staff to refer to</p>
        </div>
        {isAdmin && (
          <button className="btn-primary text-[11px] px-4 py-2" onClick={openCreate}>+ Add SOP</button>
        )}
      </div>

      {/* Category cards */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button onClick={() => setCatFilter('all')}
          className="px-3 py-1 rounded-full text-[10px] font-semibold transition-all"
          style={{ background: catFilter === 'all' ? '#1B2762' : '#F3F4F6', color: catFilter === 'all' ? '#fff' : '#6B7280' }}>
          All
        </button>
        {CATEGORIES.map(c => (
          <button key={c.id}
            onClick={() => setCatFilter(catFilter === c.id ? 'all' : c.id)}
            className="px-3 py-1 rounded-full text-[10px] font-semibold transition-all"
            style={{ background: catFilter === c.id ? c.bg : '#F3F4F6', color: catFilter === c.id ? c.color : '#6B7280', border: `1px solid ${catFilter === c.id ? c.border : 'transparent'}` }}>
            {c.icon} {c.label} ({counts[c.id]})
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border-lt)] flex items-center justify-between bg-[var(--bg-surface)]">
          <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider">Procedures</p>
          <input className="form-input text-[11px] py-1.5" style={{ width: 220 }}
            placeholder="Search procedures…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        
        {visible.length === 0 ? (
          <div className="py-14 text-center text-t3 text-sm">
            <div style={{ fontSize: 36 }} className="mb-2">📋</div>
            {sops.length === 0 ? 'No SOPs yet. Click "+ Add SOP" to get started.' : 'No procedures match your search.'}
          </div>
        ) : (
          <div className="overflow-x-auto w-full">
            <div className="min-w-[600px] flex flex-col divide-y divide-gray-100">
          {visible.map((s, i) => {
            const cat  = CATEGORIES.find(c => c.id === s.category)!
            const open = expanded.has(s.id)
            return (
                <div key={s.id} className="transition-colors">
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={() => toggleExpand(s.id)}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[12px] font-semibold text-t1">{s.title}</p>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: cat.bg, color: cat.color, border: `1px solid ${cat.border}`, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {cat.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-t3 mt-0.5">Updated {s.updatedAt}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(s)} className="btn-outline text-[10px] py-0.5 px-2">Edit</button>
                        <button onClick={() => handleDelete(s.id)} className="btn-outline text-[10px] py-0.5 px-2" style={{ color: '#EF4444', borderColor: '#FCA5A5' }}>Delete</button>
                    </div>
                  )}
                    <span style={{ color: '#9CA3AF', fontSize: 12, flexShrink: 0, marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
                  </div>
                  {open && (
                    <div style={{ background: '#F9FAFB', borderTop: '1px solid #F3F4F6', padding: '16px 20px 20px 56px' }}>
                    <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {s.content.split('\n').filter(Boolean).map((line, li) => (
                        <li key={li} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                          <span style={{
                            minWidth: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: cat.bg, color: cat.color, fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                          }}>
                            {li + 1}
                          </span>
                          <span style={{ fontSize: 12, color: '#374151', lineHeight: '1.5' }}>
                            {line.replace(/^\d+\.\s*/, '')}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {s.fileData && (
                      <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                        <a href={s.fileData} download={s.fileName || 'attachment'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', textDecoration: 'none' }}>
                          📄 Download Attachment ({s.fileName})
                        </a>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              )
            })}
            </div>
          </div>
        )}
      </div>

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      {showModal && isAdmin && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box w-full max-w-lg" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-t1">{editSop ? 'Edit SOP' : 'Add New SOP'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9CA3AF' }}>×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Category *</label>
                <select className="form-input w-full text-[12px]" value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as SOPCategory }))}>
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Title *</label>
                <input className="form-input w-full text-[12px]" placeholder="e.g. Quotation Process"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Procedure Steps *</label>
                <p className="text-[10px] text-t3 mb-1">Enter each step on a new line. Number them (1. 2. 3.) or leave plain.</p>
                <textarea className="form-input w-full text-[12px]" rows={12}
                  placeholder={"1. First step\n2. Second step\n3. Third step"}
                  value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Attachment (optional)</label>
                <div className="flex items-center gap-2">
                  <input type="file" accept=".pdf,.doc,.docx" className="form-input text-[11px] flex-1 py-1"
                    onChange={e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 5 * 1024 * 1024) { showToast('File too large — max 5 MB', 'error'); e.target.value = ''; return }
                      const reader = new FileReader()
                      reader.onload = () => setForm(f => ({ ...f, fileName: file.name, fileData: reader.result as string }))
                      reader.readAsDataURL(file)
                    }} />
                  {form.fileName && (
                    <button onClick={() => setForm(f => ({ ...f, fileName: '', fileData: '' }))} className="text-[10px] text-red-500 cursor-pointer hover:underline border-none bg-transparent">
                      Remove
                    </button>
                  )}
                </div>
                {form.fileName && <p className="text-[10px] text-t3 mt-1">Currently attached: <span className="font-semibold">{form.fileName}</span></p>}
              </div>
            </div>

            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-outline text-[11px] py-2 px-4" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary text-[11px] py-2 px-4"
                disabled={!form.title.trim() || !form.content.trim()}
                style={{ opacity: (!form.title.trim() || !form.content.trim()) ? 0.5 : 1 }}
                onClick={handleSave}>
                {editSop ? 'Save Changes' : 'Add SOP'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
