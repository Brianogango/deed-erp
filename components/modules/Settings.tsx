'use client'

import { useState, useRef } from 'react'
import { useSettingsStore } from '@/hooks/useSettingsStore'
import { useApp } from '@/lib/store'
import { Upload, Save, Trash2, Building2, CreditCard, Users, FileText, Download } from 'lucide-react'
import { Modal, Field, Input, Select } from '@/components/ui'

const TABS = [
  { id: 'company',   label: 'Company',             icon: Building2  },
  { id: 'banks',     label: 'Bank Accounts',        icon: CreditCard },
  { id: 'users',     label: 'Users & Permissions',  icon: Users      },
  { id: 'documents', label: 'Company Documents',    icon: FileText   },
]

const DOC_CATEGORIES = [
  { value: 'sop',      label: 'SOP'      },
  { value: 'policy',   label: 'Policy'   },
  { value: 'contract', label: 'Contract' },
  { value: 'other',    label: 'Other'    },
] as const

export default function Settings() {
  const { isSuperAdmin, users, currentUserId } = useApp()
  const { company, banks, documents, updateCompany, addBank, updateBank, toggleBank, addDocument, deleteDocument, reset } = useSettingsStore()
  const [tab, setTab] = useState('company')
  const [logoPreview, setLogoPreview] = useState(company.logoUrl)
  const [newBank, setNewBank] = useState({ name: '', bankName: '', accountNo: '', openingBalance: 0, active: true })

  // Documents state
  const docInputRef = useRef<HTMLInputElement>(null)
  const [docPending, setDocPending] = useState<File | null>(null)
  const [docForm, setDocForm] = useState({ name: '', category: 'sop' as 'sop' | 'policy' | 'contract' | 'other' })
  const [docUploading, setDocUploading] = useState(false)
  const [docFilter, setDocFilter] = useState('all')
  const [showDocModal, setShowDocModal] = useState(false)

  const currentUser = users.find(u => u.id === currentUserId)

  const handleDocFilePick = (file: File) => {
    if (file.size > 10 * 1024 * 1024) { alert('File too large — max 10 MB'); return }
    setDocPending(file)
    setDocForm(f => ({ ...f, name: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') }))
  }

  const handleDocSubmit = () => {
    if (!docPending) return
    setDocUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      addDocument({
        name: docForm.name.trim() || docPending.name,
        fileName: docPending.name,
        category: docForm.category,
        data: reader.result as string,
        uploadedAt: new Date().toISOString().slice(0, 10),
        uploadedBy: currentUser?.name ?? 'Admin',
        size: docPending.size,
      })
      setDocPending(null)
      setDocForm({ name: '', category: 'sop' })
      setDocUploading(false)
      setShowDocModal(false)
    }
    reader.onerror = () => setDocUploading(false)
    reader.readAsDataURL(docPending)
  }

  if (!isSuperAdmin()) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-1)' }}>Admin Access Required</h2>
        <p style={{ color: 'var(--text-3)' }}>Settings are available to administrators only.</p>
      </div>
    )
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setLogoPreview(url)
      updateCompany({ logoUrl: url })
    }
  }

  const handleAddBank = () => {
    if (!newBank.name || !newBank.bankName || !newBank.accountNo) return
    addBank(newBank)
    setNewBank({ name: '', bankName: '', accountNo: '', openingBalance: 0, active: true })
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">System Settings</h1>
          <p className="page-subtitle">Configure company details, bank accounts and permissions</p>
        </div>
        <button className="btn btn-ghost" onClick={reset}>
          <Trash2 size={14} />
          Reset Defaults
        </button>
      </div>

      {/* Tabs */}
      <div className="tabs mb-6">
        {TABS.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Company Tab */}
      {tab === 'company' && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Company Information</h2>
          </div>

          <div className="flex items-start gap-6 mb-6">
            <div className="relative flex-shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-24 h-24 object-contain rounded-xl border" style={{ borderColor: 'var(--border)' }} />
              ) : (
                <div className="w-24 h-24 rounded-xl flex items-center justify-center text-3xl" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)' }}>🏢</div>
              )}
              <label className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer" style={{ background: 'var(--brand-navy)', color: '#fff' }}>
                <Upload size={13} />
                <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
              </label>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Company Name</label>
                <input className="form-input" value={company.companyName} onChange={e => updateCompany({ companyName: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={company.email} onChange={e => updateCompany({ email: e.target.value })} maxLength={100} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" type="tel" value={company.phone} onChange={e => updateCompany({ phone: e.target.value })} maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
              </div>
              <div className="form-group">
                <label className="form-label">Address</label>
                <input className="form-input" value={company.address} onChange={e => updateCompany({ address: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">VAT Rate (%)</label>
                <input className="form-input" type="number" step="0.01" value={company.vatRate} onChange={e => updateCompany({ vatRate: Number(e.target.value) })} />
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <input className="form-input" value={company.currency} onChange={e => updateCompany({ currency: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="form-group mb-4">
            <label className="form-label">Invoice Footer Text</label>
            <input className="form-input" value={company.footerText} onChange={e => updateCompany({ footerText: e.target.value })} />
          </div>

          <button className="btn btn-primary w-full">
            <Save size={14} />
            Save Company Settings
          </button>
        </div>
      )}

      {/* Banks Tab */}
      {tab === 'banks' && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Bank Accounts</h2>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-6 p-4 rounded-lg" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)' }}>
            <input className="form-input" placeholder="Account name" value={newBank.name} onChange={e => setNewBank({ ...newBank, name: e.target.value })} />
            <input className="form-input" placeholder="Bank name" value={newBank.bankName} onChange={e => setNewBank({ ...newBank, bankName: e.target.value })} />
            <input className="form-input" placeholder="Account number" value={newBank.accountNo} onChange={e => setNewBank({ ...newBank, accountNo: e.target.value })} />
            <div className="flex gap-2">
              <input className="form-input" type="number" placeholder="Opening balance" value={newBank.openingBalance || ''} onChange={e => setNewBank({ ...newBank, openingBalance: Number(e.target.value) })} />
              <button className="btn btn-primary btn-sm flex-shrink-0" onClick={handleAddBank}>Add</button>
            </div>
          </div>

          <div className="overflow-x-auto w-full">
            <table className="table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Bank</th>
                  <th>Account No</th>
                  <th>Opening Bal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {banks.map(bank => (
                  <tr key={bank.id}>
                    <td className="font-medium">{bank.name}</td>
                    <td>{bank.bankName}</td>
                    <td className="font-mono text-xs">{bank.accountNo}</td>
                    <td>KES {bank.openingBalance.toLocaleString()}</td>
                    <td>
                      <button
                        className={`badge ${bank.active ? 'badge-green' : 'badge-gray'} cursor-pointer`}
                        onClick={() => toggleBank(bank.id)}
                      >
                        {bank.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {tab === 'users' && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Users & Permissions</h2>
          </div>
          <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>User management extends the auth service. Role assignments below.</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {[
              { role: 'Admin', perms: 'All modules' },
              { role: 'Sales Rep', perms: 'Sales, CRM, POS' },
              { role: 'Technician', perms: 'Repairs, Inventory' },
              { role: 'Finance', perms: 'Accounting, Invoices' },
              { role: 'Lead Tech', perms: 'Repairs + Assign' },
            ].map(r => (
              <div key={r.role} className="p-3 rounded-lg" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border)' }}>
                <div className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{r.role}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{r.perms}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Documents Tab */}
      {tab === 'documents' && (
        <div className="flex flex-col gap-4">

          {/* Document list */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border-lt)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                Documents ({documents.filter(d => docFilter === 'all' || d.category === docFilter).length})
              </span>
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {['all', ...DOC_CATEGORIES.map(c => c.value)].map(f => (
                    <button key={f} onClick={() => setDocFilter(f)}
                      className="px-3 py-1 rounded-lg text-[10px] capitalize cursor-pointer transition-all"
                      style={{ background: docFilter === f ? '#E8F3FA' : 'transparent', color: docFilter === f ? '#1B2762' : '#6B7280', border: `1px solid ${docFilter === f ? '#A8D4E8' : 'transparent'}`, fontWeight: docFilter === f ? 700 : 400 }}>
                      {f === 'all' ? 'All' : f.toUpperCase()}
                    </button>
                  ))}
                </div>
                <button className="btn-primary text-[11px] py-1.5 px-3" onClick={() => setShowDocModal(true)}>
                  + Add Document
                </button>
              </div>
            </div>

            {documents.filter(d => docFilter === 'all' || d.category === docFilter).length === 0
              ? <p className="py-10 text-center text-xs" style={{ color: 'var(--text-3)' }}>No documents uploaded yet</p>
              : documents.filter(d => docFilter === 'all' || d.category === docFilter).map(doc => (
                <div key={doc.id} className="flex items-center gap-3 px-5 py-3 border-b transition-colors"
                  style={{ borderColor: 'var(--border-lt)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <FileText size={18} style={{ color: '#3B82F6', flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{doc.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      {doc.fileName} · {(doc.size / 1024).toFixed(0)} KB · {doc.uploadedAt} · {doc.uploadedBy}
                    </div>
                  </div>
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase flex-shrink-0"
                    style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
                    {doc.category}
                  </span>
                  <a href={doc.data} download={doc.fileName}
                    className="p-1.5 rounded-lg transition-colors flex-shrink-0"
                    style={{ color: '#10B981' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#D1FAE5')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <Download size={15} />
                  </a>
                  <button onClick={() => deleteDocument(doc.id)}
                    className="p-1.5 rounded-lg transition-colors flex-shrink-0"
                    style={{ color: '#EF4444' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FEE2E2')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            }
          </div>

          {/* Document Upload Modal */}
          {showDocModal && (
            <Modal title="Add Company Document" onClose={() => { setShowDocModal(false); setDocPending(null); setDocForm({ name: '', category: 'sop' }) }} width={500}>
              <div className="flex flex-col gap-3">
                <Field label="Document Name">
                  <Input value={docForm.name} onChange={v => setDocForm(f => ({ ...f, name: v }))} placeholder="e.g. Employee Handbook" />
                </Field>
                <Field label="Category">
                  <Select value={docForm.category} onChange={v => setDocForm(f => ({ ...f, category: v as any }))} options={DOC_CATEGORIES.map(c => ({ value: c.value, label: c.label }))} />
                </Field>
                <Field label="File Attachment *">
                  <div className="flex items-center gap-3 mt-1">
                    <button className="btn-outline text-[11px] flex items-center gap-2 flex-shrink-0"
                      onClick={() => docInputRef.current?.click()} disabled={docUploading}>
                      <Upload size={14} />
                      {docPending ? 'Change File' : 'Choose File'}
                    </button>
                    {docPending
                      ? <span className="text-[11px] truncate font-semibold" style={{ color: '#10B981' }}>{docPending.name}</span>
                      : <span className="text-[10px] text-t3">PDF, Word — max 10 MB</span>
                    }
                    <input ref={docInputRef} type="file" className="hidden"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleDocFilePick(f); e.target.value = '' }} />
                  </div>
                </Field>
              </div>
              <div className="flex gap-2 justify-end mt-6">
                <button className="btn-outline text-[11px]" onClick={() => { setShowDocModal(false); setDocPending(null); setDocForm({ name: '', category: 'sop' }) }}>Cancel</button>
                <button className="btn-primary text-[11px]" onClick={handleDocSubmit} disabled={!docPending || docUploading}>
                  {docUploading ? 'Uploading…' : 'Upload Document'}
                </button>
              </div>
            </Modal>
          )}
        </div>
      )}
    </div>
  )
}
