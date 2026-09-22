'use client'
import { useState, useEffect } from 'react'
import { useHrStore, RefSOP, RefSOPCategory } from '@/lib/store'
import { useUrlUiState } from '@/hooks/useUrlRecordId'
import { Confirm, ModuleSkeleton, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import { Fa } from '@/components/icons'
import { faCartShopping, faCreditCard, faDownload, faFileLines, faUsers, faWrench, faPlus } from '@fortawesome/free-solid-svg-icons'

const CATEGORIES = [
  { id: 'sales' as const,  label: 'Sales',  icon: faCartShopping, bg: 'var(--primary-light)', color: 'var(--primary-dark)', border: '#BFDBFE' },
  { id: 'repair' as const, label: 'Repair', icon: faWrench, bg: 'var(--success-bg)', color: 'var(--success-text)', border: '#A7F3D0' },
  { id: 'credit' as const, label: 'Credit', icon: faCreditCard, bg: 'var(--warning-bg)', color: 'var(--warning-text)', border: '#FDE68A' },
  { id: 'hr' as const,     label: 'HR',     icon: faUsers, bg: '#EDE9FE', color: '#5B21B6', border: '#DDD6FE' },
]

export default function MyDocuments() {
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  useEffect(() => { setMounted(true) }, [])

  const { users, currentUserId, showToast, refSops: sops, addRefSop, updateRefSop, deleteRefSop } = useHrStore()
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin     = currentUser?.role === 'director'

  const [catFilterValue, setCatFilterValue] = useUrlUiState('category', 'all')
  const catFilter: RefSOPCategory | 'all' = CATEGORIES.some(c => c.id === catFilterValue)
    ? catFilterValue as RefSOPCategory
    : 'all'
  const setCatFilter = (value: RefSOPCategory | 'all') => setCatFilterValue(value)
  const [search, setSearch] = useUrlUiState('q', '')
  const [expanded, setExpanded]       = useState<Set<string>>(new Set())
  const [showModal, setShowModal]     = useState(false)
  const [editSop, setEditSop]         = useState<RefSOP | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)
  const [form, setForm]               = useState({ category: '' as RefSOPCategory | '', title: '', content: '', fileName: '', fileData: '' })

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function openCreate() {
    setEditSop(null)
    setForm({ category: '', title: '', content: '', fileName: '', fileData: '' })
    setShowModal(true)
  }

  function openEdit(s: RefSOP) {
    setEditSop(s)
    setForm({ category: s.category, title: s.title, content: s.content, fileName: s.fileName || '', fileData: s.fileData || '' })
    setShowModal(true)
  }

  function handleSave() {
    const missing: string[] = []
    if (!form.category) missing.push('Category')
    if (!form.title.trim()) missing.push('Title')
    if (!form.content.trim()) missing.push('Procedure Steps')
    if (missing.length || !form.category) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    const data = { ...form, category: form.category }
    if (editSop) {
      updateRefSop(editSop.id, data)
    } else {
      addRefSop(data)
    }
    setShowModal(false)
  }

  function handleDelete(id: string) {
    setPendingConfirm({ msg: 'Delete this SOP?', action: () => deleteRefSop(id) })
  }

  const q = search.toLowerCase()
  const visible = sops.filter(s =>
    (catFilter === 'all' || s.category === catFilter) &&
    (!q || s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q))
  )

  const counts = Object.fromEntries(
    CATEGORIES.map(c => [c.id, sops.filter(s => s.category === c.id).length])
  ) as Record<RefSOPCategory, number>

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page">
      <ModuleHeader
        title="My documents"
        subtitle="Personal quick-reference procedures and attachments"
        icon={<Fa icon={faFileLines} />}
        color="var(--navy)"
        primaryAction={isAdmin ? (
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openCreate} hideLabelOnMobile={false}>
            Add SOP
          </PrimaryActionButton>
        ) : undefined}
      />

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-3">

      {/* Category cards */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setCatFilter('all')}
          className="px-3 py-1 rounded-full text-[10px] font-semibold transition-all"
          style={{ background: catFilter === 'all' ? 'var(--navy)' : 'var(--bg-muted)', color: catFilter === 'all' ? '#fff' : 'var(--text-4)' }}>
          All
        </button>
        {CATEGORIES.map(c => (
          <button key={c.id}
            onClick={() => setCatFilter(catFilter === c.id ? 'all' : c.id)}
            className="px-3 py-1 rounded-full text-[10px] font-semibold transition-all"
            style={{ background: catFilter === c.id ? c.bg : 'var(--bg-muted)', color: catFilter === c.id ? c.color : 'var(--text-4)', border: `1px solid ${catFilter === c.id ? c.border : 'transparent'}` }}>
            <Fa icon={c.icon} className="mr-1" aria-hidden="true" />{c.label} ({counts[c.id]})
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border-lt)] flex items-center justify-between bg-[var(--bg-surface)]">
          <p className="text-[11px] font-semibold text-t2 uppercase tracking-wider">Procedures</p>
          <input aria-label="Search procedures" className="form-input text-[11px] py-1.5" style={{ width: 220 }}
            placeholder="Search procedures…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        
        {visible.length === 0 ? (
          <div className="py-14 text-center text-t3 text-sm">
            <div style={{ fontSize: 36 }} className="mb-2">📋</div>
            {sops.length === 0 ? 'No SOPs yet. Click "+ Add SOP" to get started.' : 'No procedures match your search.'}
          </div>
        ) : (
          <div className="w-full">
            <div className="flex flex-col divide-y divide-gray-100">
          {visible.map((s, i) => {
            const cat  = CATEGORIES.find(c => c.id === s.category)!
            const open = expanded.has(s.id)
            return (
                <div key={s.id} className="transition-colors">
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={() => toggleExpand(s.id)}>
                  <Fa icon={cat.icon} style={{ fontSize: 16, flexShrink: 0, color: cat.color }} aria-hidden="true" />
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
                        <button onClick={() => handleDelete(s.id)} className="btn-outline text-[10px] py-0.5 px-2" style={{ color: 'var(--danger)', borderColor: '#FCA5A5' }}>Delete</button>
                    </div>
                  )}
                    <span style={{ color: 'var(--text-4)', fontSize: 12, flexShrink: 0, marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
                  </div>
                  {open && (
                    <div style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--bg-muted)', padding: '16px 20px 20px 56px' }}>
                    <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {s.content.split('\n').filter(Boolean).map((line, li) => (
                        <li key={li} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                          <span style={{
                            minWidth: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: cat.bg, color: cat.color, fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1,
                          }}>
                            {li + 1}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: '1.5' }}>
                            {line.replace(/^\d+\.\s*/, '')}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {s.fileData && (
                      <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                        <a href={s.fileData} download={s.fileName || 'attachment'} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: 'var(--info-bg)', color: 'var(--primary-dark)', border: '1px solid #BFDBFE', textDecoration: 'none' }}>
                          <Fa icon={faDownload} className="mr-1.5" aria-hidden="true" />Download Attachment ({s.fileName})
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
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-4)' }}>×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Category *</label>
                <select className="form-input w-full text-[12px]" value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as RefSOPCategory | '' }))}>
                  <option value="">Select category…</option>
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
      </div>{/* mod-body */}
      {pendingConfirm && (
        <Confirm
          message={pendingConfirm.msg}
          onConfirm={() => { pendingConfirm.action(); setPendingConfirm(null) }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  )
}
