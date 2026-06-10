'use client'
import { useState, useMemo } from 'react'
import { useApp } from '@/lib/store'
import { Fa } from '@/components/icons'
import {
  faFileLines, faPlus, faSearch, faChevronDown, faChevronUp,
  faPen, faTrash, faCheck, faXmark, faBookOpen, faTag,
  faCircleCheck, faListOl, faBuilding, faClock, faUser,
} from '@fortawesome/free-solid-svg-icons'

const CYAN = '#00AEEF'
const NAVY = '#1A1F5E'

// ── SOP Categories ────────────────────────────────────────────────────────────
const SOP_CATEGORIES = [
  { id: 'repair',        label: 'Repair & Technical',  color: '#0E7490', bg: '#CFFAFE', border: '#A5F3FC' },
  { id: 'sales',         label: 'Sales & CRM',          color: '#1D4ED8', bg: '#DBEAFE', border: '#BFDBFE' },
  { id: 'inventory',     label: 'Inventory & Warehouse', color: '#065F46', bg: '#D1FAE5', border: '#A7F3D0' },
  { id: 'finance',       label: 'Finance & Accounting',  color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  { id: 'hr',            label: 'HR & People',           color: '#5B21B6', bg: '#EDE9FE', border: '#DDD6FE' },
  { id: 'customer',      label: 'Customer Service',      color: '#9F1239', bg: '#FFE4E6', border: '#FECDD3' },
  { id: 'operations',    label: 'Operations & Admin',    color: '#374151', bg: '#F3F4F6', border: '#E5E7EB' },
  { id: 'quality',       label: 'Quality & Compliance',  color: '#B45309', bg: '#FEF9C3', border: '#FDE68A' },
]

interface SOPStep {
  id: string
  order: number
  instruction: string
  note?: string
}

interface SOPDoc {
  id: string
  title: string
  category: string
  purpose: string
  scope: string
  steps: SOPStep[]
  tags: string[]
  version: string
  status: 'draft' | 'active' | 'archived'
  createdByName: string
  createdAt: string
  updatedAt: string
  reviewDate?: string
}

const uid = () => crypto.randomUUID()

function emptyDoc(): Omit<SOPDoc, 'id' | 'createdByName' | 'createdAt' | 'updatedAt'> {
  return {
    title: '', category: 'repair', purpose: '', scope: '',
    steps: [{ id: uid(), order: 1, instruction: '', note: '' }],
    tags: [], version: '1.0', status: 'draft', reviewDate: '',
  }
}

// ── Storage helpers (persisted via app_state key deed_sop_documents) ──────────
function useSopDocs() {
  const { sopDocuments = [], saveSopDocuments } = useApp() as any
  return { docs: sopDocuments as SOPDoc[], save: saveSopDocuments as (d: SOPDoc[]) => void }
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SOPDocuments() {
  const { users, currentUserId } = useApp()
  const currentUser = users.find(u => u.id === currentUserId)
  const canEdit = ['director', 'admin_officer', 'technical_lead'].includes(currentUser?.role ?? '')

  const { docs, save } = useSopDocs()

  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('active')
  const [viewDoc, setViewDoc] = useState<SOPDoc | null>(null)
  const [editDoc, setEditDoc] = useState<Partial<SOPDoc> & { steps: SOPStep[] } | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return docs.filter(d => {
      if (filterCat !== 'all' && d.category !== filterCat) return false
      if (filterStatus !== 'all' && d.status !== filterStatus) return false
      if (q && !d.title.toLowerCase().includes(q) && !d.tags.some(t => t.toLowerCase().includes(q))) return false
      return true
    })
  }, [docs, search, filterCat, filterStatus])

  // ── Grouped by category ────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map: Record<string, SOPDoc[]> = {}
    filtered.forEach(d => {
      if (!map[d.category]) map[d.category] = []
      map[d.category].push(d)
    })
    return map
  }, [filtered])

  // ── CRUD ───────────────────────────────────────────────────────────────────
  function openCreate() {
    setIsNew(true)
    setEditDoc({ ...emptyDoc(), steps: [{ id: uid(), order: 1, instruction: '', note: '' }] })
    setTagInput('')
  }

  function openEdit(doc: SOPDoc) {
    setIsNew(false)
    setEditDoc({ ...doc, steps: doc.steps.map(s => ({ ...s })) })
    setTagInput('')
    setViewDoc(null)
  }

  function saveDoc() {
    if (!editDoc) return
    if (!editDoc.title?.trim()) { alert('Title is required'); return }
    if (!editDoc.steps?.some(s => s.instruction.trim())) { alert('At least one step is required'); return }

    const now = new Date().toISOString()
    const cleanSteps = (editDoc.steps ?? [])
      .filter(s => s.instruction.trim())
      .map((s, i) => ({ ...s, order: i + 1 }))

    if (isNew) {
      const newDoc: SOPDoc = {
        id: uid(),
        title: editDoc.title!.trim(),
        category: editDoc.category ?? 'operations',
        purpose: editDoc.purpose?.trim() ?? '',
        scope: editDoc.scope?.trim() ?? '',
        steps: cleanSteps,
        tags: editDoc.tags ?? [],
        version: editDoc.version ?? '1.0',
        status: editDoc.status ?? 'draft',
        reviewDate: editDoc.reviewDate ?? '',
        createdByName: currentUser?.name ?? 'Unknown',
        createdAt: now,
        updatedAt: now,
      }
      save([...docs, newDoc])
    } else {
      save(docs.map(d => d.id === editDoc.id
        ? { ...d, ...editDoc, steps: cleanSteps, updatedAt: now }
        : d
      ))
    }
    setEditDoc(null)
  }

  function deleteDoc(id: string) {
    if (!confirm('Delete this SOP? This cannot be undone.')) return
    save(docs.filter(d => d.id !== id))
    if (viewDoc?.id === id) setViewDoc(null)
  }

  function addStep() {
    setEditDoc(d => d ? {
      ...d,
      steps: [...d.steps, { id: uid(), order: d.steps.length + 1, instruction: '', note: '' }],
    } : d)
  }

  function removeStep(id: string) {
    setEditDoc(d => d ? { ...d, steps: d.steps.filter(s => s.id !== id) } : d)
  }

  function updateStep(id: string, patch: Partial<SOPStep>) {
    setEditDoc(d => d ? { ...d, steps: d.steps.map(s => s.id === id ? { ...s, ...patch } : s) } : d)
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (!t || editDoc?.tags?.includes(t)) { setTagInput(''); return }
    setEditDoc(d => d ? { ...d, tags: [...(d.tags ?? []), t] } : d)
    setTagInput('')
  }

  function removeTag(t: string) {
    setEditDoc(d => d ? { ...d, tags: (d.tags ?? []).filter(x => x !== t) } : d)
  }

  const catInfo = (id: string) => SOP_CATEGORIES.find(c => c.id === id) ?? SOP_CATEGORIES[6]
  const statusColor = (s: SOPDoc['status']) =>
    s === 'active' ? { bg: '#DCFCE7', text: '#065F46', border: '#A7F3D0' }
    : s === 'draft' ? { bg: '#FEF9C3', text: '#854D0E', border: '#FDE68A' }
    : { bg: '#F3F4F6', text: '#6B7280', border: '#E5E7EB' }

  // ── View Modal ─────────────────────────────────────────────────────────────
  if (viewDoc) {
    const cat = catInfo(viewDoc.category)
    const sc  = statusColor(viewDoc.status)
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--bg-page)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
          <button onClick={() => setViewDoc(null)} className="btn-outline text-xs px-3 py-1.5">← Back</button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-base text-t1 truncate">{viewDoc.title}</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                {viewDoc.status.toUpperCase()}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}>
                {cat.label}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-t3 flex-wrap">
              <span><Fa icon={faUser} className="mr-1" />{viewDoc.createdByName}</span>
              <span><Fa icon={faClock} className="mr-1" />v{viewDoc.version} · Updated {new Date(viewDoc.updatedAt).toLocaleDateString('en-KE')}</span>
              {viewDoc.reviewDate && <span>Review: {viewDoc.reviewDate}</span>}
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <button onClick={() => openEdit(viewDoc)} className="btn-outline text-xs px-3 py-1.5">Edit</button>
              <button onClick={() => deleteDoc(viewDoc.id)} className="btn-outline text-xs px-3 py-1.5" style={{ color: '#EF4444', borderColor: '#FCA5A5' }}>Delete</button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Purpose & Scope */}
          {(viewDoc.purpose || viewDoc.scope) && (
            <div className="grid sm:grid-cols-2 gap-4">
              {viewDoc.purpose && (
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-t4 mb-1">Purpose</p>
                  <p className="text-sm text-t2">{viewDoc.purpose}</p>
                </div>
              )}
              {viewDoc.scope && (
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-t4 mb-1">Scope</p>
                  <p className="text-sm text-t2">{viewDoc.scope}</p>
                </div>
              )}
            </div>
          )}

          {/* Steps */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-lt)' }}>
              <Fa icon={faListOl} style={{ color: CYAN }} />
              <span className="font-bold text-sm text-t1">Procedure Steps</span>
              <span className="ml-auto text-[11px] text-t3">{viewDoc.steps.length} steps</span>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border-lt)' }}>
              {viewDoc.steps.map((step, i) => (
                <div key={step.id} className="p-4 flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-sm text-white"
                    style={{ background: `linear-gradient(135deg, ${CYAN}, #0090C8)` }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-t1">{step.instruction}</p>
                    {step.note && <p className="text-[11px] text-t3 mt-1 italic">{step.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          {viewDoc.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {viewDoc.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(0,174,239,0.10)', color: CYAN, border: `1px solid rgba(0,174,239,0.25)` }}>
                  <Fa icon={faTag} className="text-[9px]" />{t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Edit / Create Modal ────────────────────────────────────────────────────
  if (editDoc) {
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--bg-page)' }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
          <button onClick={() => setEditDoc(null)} className="btn-outline text-xs px-3 py-1.5">Cancel</button>
          <h2 className="font-bold text-sm text-t1 flex-1">{isNew ? 'New SOP' : 'Edit SOP'}</h2>
          <button onClick={saveDoc} className="btn-primary text-xs px-4 py-1.5">
            <Fa icon={faCheck} className="mr-1.5" />Save SOP
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Title + Category + Status */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
            <div>
              <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">SOP Title *</label>
              <input className="form-input w-full" placeholder="e.g. Repair Intake SOP"
                value={editDoc.title ?? ''} onChange={e => setEditDoc(d => d ? { ...d, title: e.target.value } : d)} />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Category</label>
                <select className="form-input w-full" value={editDoc.category ?? 'operations'}
                  onChange={e => setEditDoc(d => d ? { ...d, category: e.target.value } : d)}>
                  {SOP_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Status</label>
                <select className="form-input w-full" value={editDoc.status ?? 'draft'}
                  onChange={e => setEditDoc(d => d ? { ...d, status: e.target.value as SOPDoc['status'] } : d)}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Version</label>
                <input className="form-input w-full" placeholder="1.0"
                  value={editDoc.version ?? '1.0'} onChange={e => setEditDoc(d => d ? { ...d, version: e.target.value } : d)} />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Purpose</label>
                <textarea className="form-input w-full" rows={2} placeholder="Why does this SOP exist?"
                  value={editDoc.purpose ?? ''} onChange={e => setEditDoc(d => d ? { ...d, purpose: e.target.value } : d)} />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Scope</label>
                <textarea className="form-input w-full" rows={2} placeholder="Who does this apply to?"
                  value={editDoc.scope ?? ''} onChange={e => setEditDoc(d => d ? { ...d, scope: e.target.value } : d)} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Review Date</label>
              <input type="date" className="form-input" value={editDoc.reviewDate ?? ''}
                onChange={e => setEditDoc(d => d ? { ...d, reviewDate: e.target.value } : d)} />
            </div>
          </div>

          {/* Steps */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-lt)' }}>
              <Fa icon={faListOl} style={{ color: CYAN }} />
              <span className="font-bold text-sm text-t1">Procedure Steps *</span>
            </div>
            <div className="p-4 space-y-3">
              {editDoc.steps.map((step, i) => (
                <div key={step.id} className="flex gap-3 items-start">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-black text-xs text-white mt-1"
                    style={{ background: `linear-gradient(135deg, ${CYAN}, #0090C8)` }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <input className="form-input w-full" placeholder={`Step ${i + 1} instruction…`}
                      value={step.instruction} onChange={e => updateStep(step.id, { instruction: e.target.value })} />
                    <input className="form-input w-full text-[11px]" placeholder="Optional note or tip…"
                      value={step.note ?? ''} onChange={e => updateStep(step.id, { note: e.target.value })} />
                  </div>
                  {editDoc.steps.length > 1 && (
                    <button onClick={() => removeStep(step.id)} className="mt-1 text-red-400 hover:text-red-600 transition-colors">
                      <Fa icon={faXmark} />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addStep} className="btn-outline text-xs px-3 py-1.5 mt-1">
                <Fa icon={faPlus} className="mr-1.5" />Add Step
              </button>
            </div>
          </div>

          {/* Tags */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
            <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-2">Tags</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {(editDoc.tags ?? []).map(t => (
                <span key={t} className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full cursor-pointer"
                  style={{ background: 'rgba(0,174,239,0.10)', color: CYAN, border: `1px solid rgba(0,174,239,0.25)` }}
                  onClick={() => removeTag(t)}>
                  {t} <Fa icon={faXmark} className="text-[9px]" />
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="form-input flex-1" placeholder="Add a tag and press Enter"
                value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
              <button onClick={addTag} className="btn-outline text-xs px-3">Add</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── List View ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-page)' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex flex-col sm:flex-row sm:items-center gap-3"
        style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${CYAN}, #0090C8)` }}>
            <Fa icon={faFileLines} className="text-white text-sm" />
          </div>
          <div>
            <h1 className="font-black text-base text-t1">Standards & SOPs</h1>
            <p className="text-[11px] text-t3">{docs.filter(d => d.status === 'active').length} active procedures</p>
          </div>
        </div>
        <div className="flex gap-2 sm:ml-auto flex-wrap">
          <div className="relative">
            <Fa icon={faSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-t4 text-xs" />
            <input className="form-input pl-8 text-xs w-44" placeholder="Search SOPs…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-input text-xs" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="all">All Categories</option>
            {SOP_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select className="form-input text-xs" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
          {canEdit && (
            <button onClick={openCreate} className="btn-primary text-xs px-3 py-1.5">
              <Fa icon={faPlus} className="mr-1.5" />New SOP
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(0,174,239,0.08)' }}>
              <Fa icon={faBookOpen} className="text-2xl" style={{ color: CYAN }} />
            </div>
            <p className="font-bold text-t2 text-sm mb-1">No SOPs found</p>
            <p className="text-t3 text-xs mb-4">
              {docs.length === 0
                ? 'Create your first Standard Operating Procedure to get started.'
                : 'Try adjusting your search or filters.'}
            </p>
            {canEdit && docs.length === 0 && (
              <button onClick={openCreate} className="btn-primary text-xs px-4 py-2">
                <Fa icon={faPlus} className="mr-1.5" />Create First SOP
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([catId, catDocs]) => {
              const cat = catInfo(catId)
              return (
                <div key={catId}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full"
                      style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}>
                      {cat.label}
                    </span>
                    <div className="h-px flex-1 rounded-full" style={{ background: 'var(--border-lt)' }} />
                    <span className="text-[11px] text-t3">{catDocs.length}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {catDocs.map(doc => {
                      const sc = statusColor(doc.status)
                      return (
                        <div key={doc.id}
                          className="rounded-xl border p-4 cursor-pointer transition-all duration-200 hover:shadow-md group"
                          style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}
                          onClick={() => setViewDoc(doc)}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="font-bold text-sm text-t1 group-hover:text-[#00AEEF] transition-colors leading-snug">
                              {doc.title}
                            </h3>
                            <span className="flex-shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                              {doc.status}
                            </span>
                          </div>
                          {doc.purpose && (
                            <p className="text-[11px] text-t3 mb-2 line-clamp-2">{doc.purpose}</p>
                          )}
                          <div className="flex items-center gap-2 text-[10px] text-t4 flex-wrap">
                            <span><Fa icon={faListOl} className="mr-1" />{doc.steps.length} steps</span>
                            <span>v{doc.version}</span>
                            <span className="ml-auto">{new Date(doc.updatedAt).toLocaleDateString('en-KE')}</span>
                          </div>
                          {doc.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {doc.tags.slice(0, 3).map(t => (
                                <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'rgba(0,174,239,0.08)', color: CYAN }}>
                                  {t}
                                </span>
                              ))}
                              {doc.tags.length > 3 && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'var(--bg-muted)', color: 'var(--text-3)' }}>
                                  +{doc.tags.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
