'use client'
import { useState, useEffect } from 'react'
import { useApp } from '@/lib/store'

type SOPCategory = 'sales' | 'repair' | 'credit' | 'hr'

interface RefSOP {
  id: string
  category: SOPCategory
  title: string
  content: string
  updatedAt: string
  createdByName: string
}

const CATEGORIES: { id: SOPCategory; label: string; icon: string; bg: string; color: string; border: string }[] = [
  { id: 'sales',  label: 'Sales SOPs',  icon: '🛒', bg: '#DBEAFE', color: '#1D4ED8', border: '#BFDBFE' },
  { id: 'repair', label: 'Repair SOPs', icon: '🔧', bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0' },
  { id: 'credit', label: 'Credit SOPs', icon: '💳', bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  { id: 'hr',     label: 'HR SOPs',     icon: '👥', bg: '#EDE9FE', color: '#5B21B6', border: '#DDD6FE' },
]

const SEED_SOPS: RefSOP[] = [
  {
    id: 'rsop-s1', category: 'sales', title: 'Quotation Process',
    content: `1. Greet the customer and understand their requirements.\n2. Identify the correct product(s) from inventory.\n3. Generate a quotation from the Sales module — include all line items with correct prices.\n4. Review the quotation with the customer and adjust if needed.\n5. Email or print the quotation for the customer's records.\n6. Follow up within 24 hours if the customer has not confirmed.\n7. On confirmation, convert the quotation to a sales order.`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
  {
    id: 'rsop-s2', category: 'sales', title: 'Invoice Issuance',
    content: `1. Confirm the sales order is fully approved before invoicing.\n2. Navigate to Sales → Invoices and create invoice from the order.\n3. Verify quantities, prices, and customer details.\n4. Send the invoice to the customer via email or WhatsApp.\n5. Record any deposit or advance payment immediately.\n6. Follow up on outstanding balances within 7 days of the due date.`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
  {
    id: 'rsop-s3', category: 'sales', title: 'Customer Follow-up',
    content: `1. Review all open quotations and orders in the CRM daily.\n2. Call or message customers with pending quotes within 48 hours.\n3. Log all follow-up interactions in the CRM contact notes.\n4. Escalate unresponsive customers to the sales lead after 3 attempts.\n5. Close lost deals with a reason logged in the CRM pipeline.`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
  {
    id: 'rsop-r1', category: 'repair', title: 'Device Intake Procedure',
    content: `1. Welcome the customer and ask them to describe the problem clearly.\n2. Open Repairs → New Intake and fill in all customer and device details.\n3. Record the device's physical condition (scratches, cracks, accessories).\n4. Print the intake form and have the customer sign it.\n5. Give the customer their job reference number (REP/XXXX).\n6. Tag the device with the job reference and place it in the intake queue.\n7. Inform the customer of the estimated turnaround time.`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
  {
    id: 'rsop-r2', category: 'repair', title: 'Technician Repair Workflow',
    content: `1. Pick up the next assigned job from the repair queue.\n2. Diagnose the device and log findings in the system before touching any components.\n3. If parts are needed, submit a procurement request — do not order independently.\n4. Obtain customer approval for the repair quote before starting physical work.\n5. Complete the repair and run quality checks.\n6. Update the job status to "QC" and log all items tested.\n7. Hand over to front desk when status is "Ready".`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
  {
    id: 'rsop-r3', category: 'repair', title: 'Outsourcing a Repair',
    content: `1. Confirm the device cannot be repaired in-house and get lead tech approval.\n2. Identify a qualified vendor and agree on a cost estimate.\n3. Create an outsource job in the Outsource module — attach the repair order.\n4. Package the device securely and get the vendor to sign a handover receipt.\n5. Update the repair job location to "Outsourced".\n6. Follow up with the vendor every 3 business days.\n7. On return, inspect the device before updating status to "QC".`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
  {
    id: 'rsop-c1', category: 'credit', title: 'Credit Assessment',
    content: `1. Receive a credit request from sales or the customer directly.\n2. Verify the customer's transaction history — check outstanding invoices.\n3. Assess creditworthiness based on payment history and order size.\n4. Escalate credit limits above KES 50,000 to the finance manager.\n5. Document the approved credit limit in the customer's CRM profile.\n6. Inform the sales team of the outcome within one business day.`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
  {
    id: 'rsop-c2', category: 'credit', title: 'Debt Collection Procedure',
    content: `1. Run the Partner Ledger in Accounting to identify overdue invoices.\n2. Send a payment reminder by SMS/WhatsApp on day 1 of overdue.\n3. Call the customer directly on day 3 of overdue.\n4. Issue a formal demand letter on day 7 of overdue.\n5. Escalate to management on day 14 — freeze further credit.\n6. Refer to legal on day 30 if no payment arrangement has been made.\n7. Log all collection activities with dates and outcomes in CRM notes.`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
  {
    id: 'rsop-h1', category: 'hr', title: 'Leave Application Process',
    content: `1. Staff submits a leave request via the Leave module at least 5 working days in advance.\n2. The request must specify leave type, start date, end date, and reason.\n3. The direct supervisor is notified automatically and must approve or reject within 2 days.\n4. Approved leave is reflected in the HR calendar and payroll.\n5. Emergency leave should be communicated verbally first, then documented within 24 hours.\n6. Unapproved absenteeism is treated as unpaid leave and logged accordingly.`,
    updatedAt: '2026-04-01', createdByName: 'Admin',
  },
]

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
  const { users, currentUserId } = useApp()
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const isAdmin     = currentUser?.role === 'admin'

  const [sops, setSops]               = useState<RefSOP[]>(SEED_SOPS)
  const [catFilter, setCatFilter]     = useState<SOPCategory | 'all'>('all')
  const [search, setSearch]           = useState('')
  const [expanded, setExpanded]       = useState<Set<string>>(new Set())
  const [showModal, setShowModal]     = useState(false)
  const [editSop, setEditSop]         = useState<RefSOP | null>(null)
  const [form, setForm]               = useState({ category: 'sales' as SOPCategory, title: '', content: '' })

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
    setForm({ category: 'sales', title: '', content: '' })
    setShowModal(true)
  }

  function openEdit(s: RefSOP) {
    setEditSop(s)
    setForm({ category: s.category, title: s.title, content: s.content })
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CATEGORIES.map(c => (
          <button key={c.id}
            onClick={() => setCatFilter(catFilter === c.id ? 'all' : c.id)}
            style={{
              background: catFilter === c.id ? c.bg : 'var(--bg-card)',
              border: `1.5px solid ${catFilter === c.id ? c.border : '#E5E7EB'}`,
              borderRadius: 12, padding: '14px 12px', cursor: 'pointer',
              textAlign: 'left', transition: 'all 0.15s',
            }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</div>
            <p style={{ fontSize: 11, fontWeight: 700, color: catFilter === c.id ? c.color : '#374151' }}>{c.label}</p>
            <p style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{counts[c.id]} procedures</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        className="form-input w-full text-[12px]"
        placeholder="Search procedures by title or keyword…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* SOP list */}
      {visible.length === 0 ? (
        <div className="card p-12 text-center text-t3 text-sm">
          <div style={{ fontSize: 36 }} className="mb-2">📋</div>
          {sops.length === 0 ? 'No SOPs yet. Click "+ Add SOP" to get started.' : 'No procedures match your search.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {visible.map((s, i) => {
            const cat  = CATEGORIES.find(c => c.id === s.category)!
            const open = expanded.has(s.id)
            return (
              <div key={s.id} style={{ borderBottom: i < visible.length - 1 ? '1px solid var(--border-lt)' : 'none' }}>
                {/* Header row */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
                  style={{ background: 'var(--bg-card)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-muted)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'}
                  onClick={() => toggleExpand(s.id)}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-semibold text-t1">{s.title}</p>
                      <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: cat.bg, color: cat.color, border: `1px solid ${cat.border}`, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {cat.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-t3 mt-0.5">Updated {s.updatedAt}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => openEdit(s)}
                        style={{ fontSize: 10, padding: '3px 9px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#F9FAFB', color: '#374151', cursor: 'pointer' }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(s.id)}
                        style={{ fontSize: 10, padding: '3px 9px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#991B1B', cursor: 'pointer' }}>
                        Delete
                      </button>
                    </div>
                  )}
                  <span style={{ color: '#9CA3AF', fontSize: 12, flexShrink: 0, marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
                </div>

                {/* Expanded content */}
                {open && (
                  <div style={{ background: 'var(--bg-muted)', borderTop: '1px solid var(--border-lt)', padding: '12px 20px 16px 56px' }}>
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
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

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
