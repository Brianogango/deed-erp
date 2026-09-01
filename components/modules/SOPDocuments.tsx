'use client'
import { Suspense, useState, useMemo, useRef, useEffect } from 'react'
import { useUrlRecordId, useUrlUiState } from '@/hooks/useUrlRecordId'
import { useHrStore } from '@/lib/store'
import { ModuleSkeleton, useMounted, ModuleHeader } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import { Fa } from '@/components/icons'
import {
  faFileLines, faPlus, faSearch, faPen, faTrash, faCheck, faXmark,
  faBookOpen, faTag, faListOl, faClock, faUser, faUpload, faDownload,
  faFilePdf, faFileWord, faFileImage, faFile, faBuilding, faEye,
} from '@fortawesome/free-solid-svg-icons'

const CYAN = 'var(--accent-cyan)'
const NAVY = 'var(--navy)'

// ── File size limit (must match server-side guard) ────────────────────────────
const MAX_FILE_BYTES = 5 * 1024 * 1024   // 5 MB
const ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]
const ALLOWED_EXTENSIONS = '.pdf,.doc,.docx,.jpg,.jpeg,.png'

// ── Departments ───────────────────────────────────────────────────────────────
const SOP_DEPARTMENTS = [
  { id: 'repairs',    label: 'Repairs & Technical',   color: '#0E7490', bg: '#CFFAFE', border: '#A5F3FC' },
  { id: 'sales',      label: 'Sales & CRM',            color: 'var(--primary-dark)', bg: 'var(--primary-light)', border: '#BFDBFE' },
  { id: 'inventory',  label: 'Inventory & Warehouse',  color: 'var(--success-text)', bg: 'var(--success-bg)', border: '#A7F3D0' },
  { id: 'finance',    label: 'Finance & Accounting',   color: 'var(--warning-text)', bg: 'var(--warning-bg)', border: '#FDE68A' },
  { id: 'hr',         label: 'HR & People',            color: '#5B21B6', bg: '#EDE9FE', border: '#DDD6FE' },
  { id: 'customer',   label: 'Customer Service',       color: '#9F1239', bg: '#FFE4E6', border: '#FECDD3' },
  { id: 'operations', label: 'Operations & Admin',     color: 'var(--text-3)', bg: 'var(--bg-muted)', border: 'var(--border-lt)' },
  { id: 'quality',    label: 'Quality & Compliance',   color: '#B45309', bg: '#FEF9C3', border: '#FDE68A' },
]

// ── SOP Categories ────────────────────────────────────────────────────────────
const SOP_CATEGORIES = [
  { id: 'intake',        label: 'Intake & Receiving' },
  { id: 'diagnosis',     label: 'Diagnosis & Assessment' },
  { id: 'repair',        label: 'Repair & Servicing' },
  { id: 'qc',            label: 'Quality Control' },
  { id: 'dispatch',      label: 'Dispatch & Delivery' },
  { id: 'sales_process', label: 'Sales Process' },
  { id: 'invoicing',     label: 'Invoicing & Payments' },
  { id: 'stock',         label: 'Stock Management' },
  { id: 'hr_process',    label: 'HR Process' },
  { id: 'compliance',    label: 'Compliance & Audit' },
  { id: 'customer_comm', label: 'Customer Communication' },
  { id: 'general',       label: 'General' },
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
  department: string
  purpose: string
  scope: string
  steps: SOPStep[]
  tags: string[]
  version: string
  status: 'draft' | 'active' | 'archived'
  reviewDate?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  createdByName: string
  createdAt: string
  updatedAt: string
}

const uid = () => crypto.randomUUID()

function emptyDoc(): Omit<SOPDoc, 'id' | 'createdByName' | 'createdAt' | 'updatedAt'> {
  return {
    title: '', category: 'general', department: 'operations', purpose: '', scope: '',
    steps: [{ id: uid(), order: 1, instruction: '', note: '' }],
    tags: [], version: '1.0', status: 'draft', reviewDate: '',
  }
}

function useSopDocs() {
  const { sopDocuments = [], saveSopDocuments } = useHrStore() as any
  return { docs: sopDocuments as SOPDoc[], save: saveSopDocuments as (d: SOPDoc[]) => void }
}

function fileIcon(mime?: string) {
  if (!mime) return faFile
  if (mime === 'application/pdf') return faFilePdf
  if (mime.includes('word')) return faFileWord
  if (mime.startsWith('image/')) return faFileImage
  return faFile
}

function fileIconColor(mime?: string) {
  if (!mime) return 'var(--text-4)'
  if (mime === 'application/pdf') return 'var(--danger)'
  if (mime.includes('word')) return 'var(--primary)'
  if (mime.startsWith('image/')) return 'var(--success)'
  return 'var(--text-4)'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SOPDocuments() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <SOPDocumentsContent />
    </Suspense>
  )
}

function SOPDocumentsContent() {
  const mounted = useMounted()
  const { users, currentUserId } = useHrStore()
  const currentUser = users.find(u => u.id === currentUserId)
  const canEdit = ['director', 'admin_officer', 'technical_lead'].includes(currentUser?.role ?? '')

  const { docs, save } = useSopDocs()

  const [search, setSearch] = useUrlUiState('q', '')
  const [filterDept, setFilterDept] = useUrlUiState('dept', 'all')
  const [filterStatus, setFilterStatus] = useUrlUiState('status', 'active')
  const [viewId, setViewId]           = useUrlRecordId()
  const [editId, setEditId]           = useUrlRecordId({ param: 'edit', clearKeys: ['id'] })
  const [editDoc, setEditDoc]         = useState<Partial<SOPDoc> & { steps: SOPStep[] } | null>(null)
  const [isNew, setIsNew]             = useState(false)
  const [tagInput, setTagInput]       = useState('')
  const [fileError, setFileError]     = useState('')
  const [uploading, setUploading]     = useState(false)
  const [pendingFile, setPendingFile] = useState<{ dataUrl: string; fileName: string; fileType: string; fileSize: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewDoc = !editId && viewId ? docs.find(d => d.id === viewId) ?? null : null

  useEffect(() => {
    if (!editId) {
      if (!isNew) setEditDoc(null)
      return
    }
    const doc = docs.find(d => d.id === editId)
    if (!doc || editDoc?.id === editId) return
    setIsNew(false)
    setEditDoc({ ...doc, steps: doc.steps.map(s => ({ ...s })) })
    setTagInput('')
    setFileError('')
    setPendingFile(null)
  }, [docs, editDoc?.id, editId, isNew])

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return docs.filter(d => {
      if (filterDept !== 'all' && d.department !== filterDept) return false
      if (filterStatus !== 'all' && d.status !== filterStatus) return false
      if (q && !d.title.toLowerCase().includes(q) &&
          !d.tags.some(t => t.toLowerCase().includes(q)) &&
          !(d.purpose ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [docs, search, filterDept, filterStatus])

  // ── Grouped by department ──────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map: Record<string, SOPDoc[]> = {}
    filtered.forEach(d => {
      const key = d.department || 'operations'
      if (!map[key]) map[key] = []
      map[key].push(d)
    })
    return map
  }, [filtered])

  if (!mounted) return <ModuleSkeleton />

  // ── CRUD ───────────────────────────────────────────────────────────────────
  function openCreate() {
    setIsNew(true)
    setEditDoc({ ...emptyDoc(), steps: [{ id: uid(), order: 1, instruction: '', note: '' }] })
    setTagInput('')
    setFileError('')
    setPendingFile(null)
  }

  function openEdit(doc: SOPDoc) {
    setIsNew(false)
    setEditDoc({ ...doc, steps: doc.steps.map(s => ({ ...s })) })
    setTagInput('')
    setFileError('')
    setPendingFile(null)
    setEditId(doc.id)
  }

  async function saveDoc() {
    if (!editDoc) return
    if (!editDoc.title?.trim()) { alert('Title is required'); return }
    if (!editDoc.steps?.some(s => s.instruction.trim())) { alert('At least one step is required'); return }

    const now = new Date().toISOString()
    const cleanSteps = (editDoc.steps ?? [])
      .filter(s => s.instruction.trim())
      .map((s, i) => ({ ...s, order: i + 1 }))

    const sopId = isNew ? uid() : editDoc.id!

    // Upload file if one was selected
    if (pendingFile) {
      setUploading(true)
      try {
        const res = await fetch(`/api/sop-files/${sopId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataUrl: pendingFile.dataUrl,
            fileName: pendingFile.fileName,
            fileSize: pendingFile.fileSize,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Upload failed' }))
          setFileError(err.error ?? 'File upload failed')
          setUploading(false)
          return
        }
      } catch {
        setFileError('Network error during file upload. Please try again.')
        setUploading(false)
        return
      }
      setUploading(false)
    }

    const fileFields = pendingFile
      ? { fileName: pendingFile.fileName, fileType: pendingFile.fileType, fileSize: pendingFile.fileSize }
      : {}

    if (isNew) {
      const newDoc: SOPDoc = {
        id: sopId,
        title: editDoc.title!.trim(),
        category: editDoc.category ?? 'general',
        department: editDoc.department ?? 'operations',
        purpose: editDoc.purpose?.trim() ?? '',
        scope: editDoc.scope?.trim() ?? '',
        steps: cleanSteps,
        tags: editDoc.tags ?? [],
        version: editDoc.version ?? '1.0',
        status: editDoc.status ?? 'draft',
        reviewDate: editDoc.reviewDate ?? '',
        ...fileFields,
        createdByName: currentUser?.name ?? 'Unknown',
        createdAt: now,
        updatedAt: now,
      }
      save([...docs, newDoc])
    } else {
      save(docs.map(d => d.id === sopId
        ? { ...d, ...editDoc, id: sopId, steps: cleanSteps, ...fileFields, updatedAt: now }
        : d
      ))
    }
    setPendingFile(null)
    setEditId(null)
    setEditDoc(null)
  }

  function deleteDoc(id: string) {
    if (!confirm('Delete this SOP? This cannot be undone.')) return
    // Also clean up the file on the server (fire and forget)
    fetch(`/api/sop-files/${id}`, { method: 'DELETE' }).catch(() => {})
    save(docs.filter(d => d.id !== id))
    if (viewDoc?.id === id) setViewId(null)
  }

  async function removeFile(doc: SOPDoc) {
    if (!confirm('Remove the attached file from this SOP?')) return
    await fetch(`/api/sop-files/${doc.id}`, { method: 'DELETE' }).catch(() => {})
    save(docs.map(d => d.id === doc.id
      ? { ...d, fileName: undefined, fileType: undefined, fileSize: undefined, updatedAt: new Date().toISOString() }
      : d
    ))
  }

  // ── File selection with client-side guards ─────────────────────────────────
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError('')
    const file = e.target.files?.[0]
    if (!e.target.files) return
    e.target.value = ''   // reset so same file can be re-selected

    if (!file) return

    // Guard 1: MIME type
    if (!ALLOWED_MIME.includes(file.type)) {
      setFileError('Invalid file type. Accepted: PDF, Word (.doc/.docx), JPEG, PNG.')
      return
    }

    // Guard 2: File size (client-side check before reading)
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`File too large (${formatBytes(file.size)}). Maximum allowed size is 5 MB.`)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      // Guard 3: Double-check decoded size
      const base64 = dataUrl.split(',')[1] ?? ''
      const decodedSize = Math.floor(base64.length * 0.75)
      if (decodedSize > MAX_FILE_BYTES) {
        setFileError(`File too large after encoding (${formatBytes(decodedSize)}). Maximum allowed size is 5 MB.`)
        return
      }
      setPendingFile({ dataUrl, fileName: file.name, fileType: file.type, fileSize: file.size })
    }
    reader.onerror = () => setFileError('Failed to read file. Please try again.')
    reader.readAsDataURL(file)
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

  const deptInfo = (id: string) => SOP_DEPARTMENTS.find(d => d.id === id) ?? SOP_DEPARTMENTS[6]
  const catLabel = (id: string) => SOP_CATEGORIES.find(c => c.id === id)?.label ?? id
  const statusColor = (s: SOPDoc['status']) =>
    s === 'active'   ? { bg: 'var(--success-bg)', text: 'var(--success-text)', border: '#A7F3D0' }
    : s === 'draft'  ? { bg: '#FEF9C3', text: '#854D0E', border: '#FDE68A' }
    : { bg: 'var(--bg-muted)', text: 'var(--text-4)', border: 'var(--border-lt)' }

  // ── View Modal ─────────────────────────────────────────────────────────────
  if (viewDoc) {
    const dept = deptInfo(viewDoc.department)
    const sc   = statusColor(viewDoc.status)
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--bg-page)' }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
          <button onClick={() => setViewId(null)} className="btn-outline text-xs px-3 py-1.5">← Back</button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-base text-t1 truncate">{viewDoc.title}</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                {viewDoc.status.toUpperCase()}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: dept.bg, color: dept.color, border: `1px solid ${dept.border}` }}>
                {dept.label}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-t3 flex-wrap">
              <span><Fa icon={faUser} className="mr-1" />{viewDoc.createdByName}</span>
              <span><Fa icon={faClock} className="mr-1" />v{viewDoc.version} · Updated {new Date(viewDoc.updatedAt).toLocaleDateString('en-KE')}</span>
              {viewDoc.reviewDate && <span>Review: {viewDoc.reviewDate}</span>}
              <span className="text-[10px] text-t4">{catLabel(viewDoc.category)}</span>
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <button onClick={() => openEdit(viewDoc)} className="btn-outline text-xs px-3 py-1.5">Edit</button>
              <button onClick={() => deleteDoc(viewDoc.id)} className="btn-outline text-xs px-3 py-1.5" style={{ color: 'var(--danger)', borderColor: '#FCA5A5' }}>Delete</button>
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

          {/* Attached File */}
          {viewDoc.fileName && (
            <div className="rounded-xl border p-4 flex items-center gap-4" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(0,174,239,0.08)' }}>
                <Fa icon={fileIcon(viewDoc.fileType)} style={{ color: fileIconColor(viewDoc.fileType), fontSize: '1.2rem' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-t1 truncate">{viewDoc.fileName}</p>
                <p className="text-[11px] text-t3">
                  {viewDoc.fileType?.split('/').pop()?.toUpperCase() ?? 'FILE'}
                  {viewDoc.fileSize ? ` · ${formatBytes(viewDoc.fileSize)}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <a href={`/api/sop-files/${viewDoc.id}`} target="_blank" rel="noopener noreferrer"
                  className="btn-outline text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                  <Fa icon={faEye} />View
                </a>
                <a href={`/api/sop-files/${viewDoc.id}?download=1`} download={viewDoc.fileName}
                  className="btn-outline text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                  <Fa icon={faDownload} />Download
                </a>
                {canEdit && (
                  <button onClick={() => removeFile(viewDoc)} className="btn-outline text-xs px-3 py-1.5" style={{ color: 'var(--danger)', borderColor: '#FCA5A5' }}>
                    <Fa icon={faTrash} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Steps */}
          {viewDoc.steps.length > 0 && (
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
          )}

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
    const existingFile = !isNew ? docs.find(d => d.id === editDoc.id) : null
    return (
      <div className="flex flex-col h-full" style={{ background: 'var(--bg-page)' }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
          <button onClick={() => { setEditId(null); setEditDoc(null); setPendingFile(null); setFileError('') }} className="btn-outline text-xs px-3 py-1.5">Cancel</button>
          <h2 className="font-bold text-sm text-t1 flex-1">{isNew ? 'New SOP' : 'Edit SOP'}</h2>
          <button onClick={saveDoc} disabled={uploading} className="btn-primary text-xs px-4 py-1.5 disabled:opacity-60">
            {uploading ? 'Uploading…' : <><Fa icon={faCheck} className="mr-1.5" />Save SOP</>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Title + Department + Category + Status + Version */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
            <div>
              <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">SOP Title *</label>
              <input className="form-input w-full" placeholder="e.g. Repair Intake SOP"
                value={editDoc.title ?? ''} onChange={e => setEditDoc(d => d ? { ...d, title: e.target.value } : d)} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Department</label>
                <select aria-label="SOP department" className="form-input w-full" value={editDoc.department ?? 'operations'}
                  onChange={e => setEditDoc(d => d ? { ...d, department: e.target.value } : d)}>
                  {SOP_DEPARTMENTS.map(dep => <option key={dep.id} value={dep.id}>{dep.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Category</label>
                <select aria-label="SOP category" className="form-input w-full" value={editDoc.category ?? 'general'}
                  onChange={e => setEditDoc(d => d ? { ...d, category: e.target.value } : d)}>
                  {SOP_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Status</label>
                <select aria-label="SOP status" className="form-input w-full" value={editDoc.status ?? 'draft'}
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
              <div>
                <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider mb-1">Review Date</label>
                <input type="date" aria-label="SOP review date" className="form-input w-full" value={editDoc.reviewDate ?? ''}
                  onChange={e => setEditDoc(d => d ? { ...d, reviewDate: e.target.value } : d)} />
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
          </div>

          {/* File Attachment */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
            <div className="flex items-center justify-between">
              <label className="block text-[11px] font-bold text-t3 uppercase tracking-wider">Attach File (optional)</label>
              <span className="text-[10px] text-t4">PDF, Word, JPEG, PNG · Max 5 MB</span>
            </div>

            {/* Existing file on server */}
            {!pendingFile && existingFile?.fileName && (
              <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-lt)' }}>
                <Fa icon={fileIcon(existingFile.fileType)} style={{ color: fileIconColor(existingFile.fileType) }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-t1 truncate">{existingFile.fileName}</p>
                  {existingFile.fileSize && <p className="text-[10px] text-t3">{formatBytes(existingFile.fileSize)}</p>}
                </div>
                <button onClick={() => fileInputRef.current?.click()} className="btn-outline text-[10px] px-2 py-1">Replace</button>
              </div>
            )}

            {/* Pending file (selected but not yet uploaded) */}
            {pendingFile && (
              <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--success-bg)', border: '1px solid #A7F3D0' }}>
                <Fa icon={fileIcon(pendingFile.fileType)} style={{ color: fileIconColor(pendingFile.fileType) }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-t1 truncate">{pendingFile.fileName}</p>
                  <p className="text-[10px] text-t3">{formatBytes(pendingFile.fileSize)} · Will upload on save</p>
                </div>
                <button onClick={() => { setPendingFile(null); setFileError('') }} className="text-red-400 hover:text-red-600 transition-colors">
                  <Fa icon={faXmark} />
                </button>
              </div>
            )}

            {/* Upload button (shown when no pending file and no existing file, or to replace) */}
            {!pendingFile && !existingFile?.fileName && (
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 w-full justify-center py-3 rounded-xl border-2 border-dashed text-xs font-medium text-t3 hover:text-t1 transition-colors"
                style={{ borderColor: 'var(--border-lt)' }}>
                <Fa icon={faUpload} style={{ color: CYAN }} />
                Click to attach a file
              </button>
            )}

            {fileError && (
              <p className="text-xs font-medium" style={{ color: 'var(--danger)' }}>
                <Fa icon={faXmark} className="mr-1" />{fileError}
              </p>
            )}

            <input ref={fileInputRef} type="file" accept={ALLOWED_EXTENSIONS} className="hidden"
              onChange={handleFileSelect} />
          </div>

          {/* Steps */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}>
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-lt)' }}>
              <Fa icon={faListOl} style={{ color: CYAN }} />
              <span className="font-bold text-sm text-t1">Procedure Steps *</span>
              <span className="ml-auto text-[10px] text-t4">Leave empty steps — they are ignored on save</span>
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
    <div className="mod-page">
      <ModuleHeader
        title="Standards and SOPs"
        subtitle="Company procedure library and controlled documents"
        icon={<Fa icon={faFileLines} />}
        count={docs.filter(d => d.status === 'active').length}
        color={CYAN}
        primaryAction={canEdit ? (
          <PrimaryActionButton icon={<Fa icon={faPlus} />} onClick={openCreate} hideLabelOnMobile={false}>
            New SOP
          </PrimaryActionButton>
        ) : undefined}
      />

      <div className="filter-bar">
        <div className="flex gap-2 ml-auto flex-wrap">
          <div className="relative">
            <Fa icon={faSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-t4 text-xs" />
            <input aria-label="Search SOPs" className="form-input pl-8 text-xs w-44" placeholder="Search SOPs…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select aria-label="Filter SOPs by department" className="form-input text-xs" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
            <option value="all">All Departments</option>
            {SOP_DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <select aria-label="Filter SOPs by status" className="form-input text-xs" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="mod-body p-4 sm:p-6">
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
          <div className="space-y-8">
            {Object.entries(grouped).map(([deptId, deptDocs]) => {
              const dept = deptInfo(deptId)
              return (
                <div key={deptId}>
                  {/* Department header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: dept.bg, border: `1px solid ${dept.border}` }}>
                      <Fa icon={faBuilding} style={{ color: dept.color, fontSize: '0.7rem' }} />
                    </div>
                    <span className="text-sm font-black uppercase tracking-wider" style={{ color: dept.color }}>
                      {dept.label}
                    </span>
                    <div className="h-px flex-1 rounded-full" style={{ background: dept.border }} />
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: dept.bg, color: dept.color, border: `1px solid ${dept.border}` }}>
                      {deptDocs.length} SOP{deptDocs.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {deptDocs.map(doc => {
                      const sc = statusColor(doc.status)
                      return (
                        <div key={doc.id}
                          className="rounded-xl border p-4 cursor-pointer transition-all duration-200 hover:shadow-md group"
                          style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-card)' }}
                          onClick={() => setViewId(doc.id)}>
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
                            {doc.fileName && (
                              <span className="inline-flex items-center gap-1" style={{ color: fileIconColor(doc.fileType) }}>
                                <Fa icon={fileIcon(doc.fileType)} />
                                {doc.fileType?.split('/').pop()?.toUpperCase() ?? 'FILE'}
                              </span>
                            )}
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
