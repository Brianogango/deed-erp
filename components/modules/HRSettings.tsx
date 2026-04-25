'use client'
import { useState, useMemo } from 'react'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { Badge, Field, Input, Modal, PanelHeader, Select, Table, Textarea, ExportButtons } from '@/components/ui'
import { MODULE_IDS, USER_ROLES } from '@/lib/auth/types'
import { formatRoleLabel } from '@/lib/auth/access'
import { Fa } from '@/components/icons'
import {
  faBuilding, faUsers, faBriefcase, faBoxesStacked, faCartShopping,
  faScrewdriverWrench, faLandmark, faUserGroup, faCashRegister, faShieldHalved,
  faPlus, faCheck, faUpload, faBullseye,
} from '@fortawesome/free-solid-svg-icons'

type Section =
  | 'general' | 'banks' | 'access'
  | 'crm' | 'sales' | 'inventory' | 'purchase' | 'repair'
  | 'accounting' | 'hr_config' | 'pos' | 'security'

type UserFormState = {
  id: string; username: string; name: string; role: string
  modules: string[]; active: boolean; password: string
}
const blankUser: UserFormState = {
  id: '', username: '', name: '', role: 'sales_rep', modules: ['dashboard'], active: true, password: '',
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${on ? 'bg-blue-900' : 'bg-gray-300'}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${on ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  )
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-100 last:border-0 gap-4">
      <div className="flex-1">
        <p className="text-[12px] font-semibold text-gray-900 m-0">{label}</p>
        {desc && <p className="text-[11px] text-gray-500 mt-1 leading-relaxed m-0">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function TagEditor({ tags, onChange, placeholder = 'Add item…' }: { tags: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')
  const add = () => {
    const v = input.trim()
    if (v && !tags.includes(v)) { onChange([...tags, v]); setInput('') }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {tags.map((t, i) => (
          <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-900 inline-flex items-center gap-1.5 border border-blue-100 font-medium">
            {t}
            <button className="bg-transparent border-none cursor-pointer text-blue-400 hover:text-blue-600 p-0 leading-none text-[14px] font-bold outline-none flex items-center justify-center" onClick={() => onChange(tags.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          className="flex-1 text-[11px] px-3 py-1.5 border border-gray-200 rounded-md outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          placeholder={placeholder}
        />
        <button onClick={add} className="text-[11px] px-4 py-1.5 bg-blue-900 hover:bg-blue-800 text-white border-none rounded-md cursor-pointer font-semibold transition-colors">Add</button>
      </div>
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden shadow-sm mb-6 border border-gray-200/75">
      <div className="flex justify-between items-center px-5 py-3.5 bg-gray-50/80 border-b border-gray-100">
        <p className="text-[11px] font-bold text-gray-700 uppercase tracking-widest m-0">{title}</p>
        {action && <div>{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

export default function HRSettings() {
  const {
    bankAccounts, updateBankAccount, addBankAccount, deleteBankAccount,
    companySettings, updateCompanySettings,
    systemSettings: ss, updateSystemSettings,
    users, currentUserId, employees,
    createUser, updateUser, deleteUser,
    posOrders,
  } = useApp()

  const [section, setSection] = useState<Section>('general')

  // Bank form
  const [bankForm, setBankForm] = useState({ name: '', bankName: '', accountNo: '', currency: 'KES', openingBalance: '0', openingDate: new Date().toISOString().slice(0, 10) })
  const [editingBankId, setEditingBankId] = useState<string | null>(null)
  const [showBankModal, setShowBankModal] = useState(false)

  // User form
  const [userForm, setUserForm] = useState<UserFormState>(blankUser)
  const [showUserModal, setShowUserModal] = useState(false)
  const [savingUser, setSavingUser] = useState(false)
  const [syncingDB, setSyncingDB] = useState(false)

  const openAddBank = () => {
    setBankForm({ name: '', bankName: '', accountNo: '', currency: 'KES', openingBalance: '0', openingDate: new Date().toISOString().slice(0, 10) })
    setEditingBankId(null); setShowBankModal(true)
  }
  const openEditBank = (id: string) => {
    const a = bankAccounts.find(b => b.id === id)
    if (!a) return
    setBankForm({ name: a.name, bankName: a.bankName, accountNo: a.accountNo, currency: a.currency, openingBalance: String(a.openingBalance), openingDate: a.openingDate })
    setEditingBankId(id); setShowBankModal(true)
  }
  const saveBank = () => {
    const data = { name: bankForm.name, bankName: bankForm.bankName, accountNo: bankForm.accountNo, openingBalance: Number(bankForm.openingBalance), openingDate: bankForm.openingDate }
    if (editingBankId) updateBankAccount(editingBankId, data)
    else addBankAccount({ ...data, currency: bankForm.currency, active: true })
    setShowBankModal(false)
  }

  const toggleUserModule = (mid: string) => {
    setUserForm(p => {
      const has = p.modules.includes(mid)
      const modules = has ? p.modules.filter(m => m !== mid) : [...p.modules, mid]
      return { ...p, modules: modules.length > 0 ? modules : ['dashboard'] }
    })
  }
  const saveUser = async () => {
    try {
      setSavingUser(true)
      const payload = { username: userForm.username.trim(), name: userForm.name.trim(), role: userForm.role as any, modules: userForm.modules as any, active: userForm.active, ...(userForm.password ? { password: userForm.password } : {}) }
      if (!payload.username || !payload.name || payload.modules.length === 0 || (!userForm.id && !userForm.password)) {
        alert('Complete all required fields (name, username, modules, password for new users).'); return
      }
      if (userForm.id) await updateUser(userForm.id, payload)
      else await createUser({ username: payload.username, name: payload.name, role: payload.role, modules: payload.modules, active: payload.active, password: userForm.password })
      setShowUserModal(false); setUserForm(blankUser)
    } finally { setSavingUser(false) }
  }
  const removeUser = async (userId: string) => {
    const user = users.find(u => u.id === userId)
    if (!user || !window.confirm(`Delete user "${user.username}"? This is irreversible.`)) return
    await deleteUser(userId)
  }

  const posDailySummary = useMemo(() => {
    const map = new Map<string, { date: string; cash: number; mpesa: number; card: number; total: number; count: number }>()
    posOrders.forEach(o => {
      const cur = map.get(o.date) || { date: o.date, cash: 0, mpesa: 0, card: 0, total: 0, count: 0 }
      if (o.payment === 'cash') cur.cash += o.total
      if (o.payment === 'mpesa') cur.mpesa += o.total
      if (o.payment === 'card') cur.card += o.total
      cur.total += o.total
      cur.count += 1
      map.set(o.date, cur)
    })
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date))
  }, [posOrders])

  const handleForceSync = async () => {
    if (!window.confirm('This will upload all local browser data to the Postgres database. Continue?')) return
    setSyncingDB(true)
    try {
      const payload: Record<string, string> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('deed_')) {
          payload[key] = localStorage.getItem(key) || ''
        }
      }
      const res = await fetch('/api/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) alert('Migration successful! All data is now in Postgres.')
      else alert('Failed to sync. Please check the server logs.')
    } catch (err) {
      alert('An error occurred during migration.')
    } finally { setSyncingDB(false) }
  }

  const roleOptions = USER_ROLES.map(r => ({ value: r, label: formatRoleLabel(r) }))
  const moduleOptions = MODULE_IDS.map(m => ({ value: m, label: m === 'pos' ? 'Point of Sale' : formatRoleLabel(m) }))

  const nav: { id: Section; label: string; icon: any }[] = [
    { id: 'general',     label: 'General',      icon: faBuilding },
    { id: 'banks',       label: 'Bank Accounts', icon: faLandmark },
    { id: 'access',      label: 'User Access',   icon: faUsers },
    { id: 'crm',         label: 'CRM',           icon: faBullseye },
    { id: 'sales',       label: 'Sales',         icon: faBriefcase },
    { id: 'inventory',   label: 'Inventory',     icon: faBoxesStacked },
    { id: 'purchase',    label: 'Purchase',      icon: faCartShopping },
    { id: 'repair',      label: 'Repairs',       icon: faScrewdriverWrench },
    { id: 'accounting',  label: 'Accounting',    icon: faLandmark },
    { id: 'hr_config',   label: 'HR',            icon: faUserGroup },
    { id: 'pos',         label: 'Point of Sale', icon: faCashRegister },
    { id: 'security',    label: 'Security',      icon: faShieldHalved },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-5">
        <h2 className="text-base font-bold text-t1">System Settings</h2>
        <p className="text-[11px] text-t3">Configure modules, users, and company preferences</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* ── Left nav ── */}
        <div className="w-full md:w-52 flex-shrink-0 sticky top-4">
          <div className="card p-1.5 flex flex-row md:flex-col gap-0.5 overflow-x-auto scrollbar-hide">
            {nav.map(item => (
              <button key={item.id} onClick={() => setSection(item.id)}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-md text-[11.5px] font-medium cursor-pointer transition-all whitespace-nowrap border-none text-left ${
                  section === item.id 
                    ? 'bg-blue-50 text-blue-900' 
                    : 'bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}>
                <Fa icon={item.icon} fixedWidth className={section === item.id ? 'text-blue-700' : 'text-gray-400'} />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right content ── */}
        <div className="flex-1 min-w-0 pb-12">

        {/* ════ GENERAL ════ */}
        {section === 'general' && (
          <>
            <Card title="Company Identity">
              <div className="flex items-center gap-4 pb-4 mb-4 border-b border-gray-100">
                <div className="w-16 h-16 rounded-xl border-2 border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {companySettings.logoUrl
                    ? <img src={companySettings.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                    : <Fa icon={faBuilding} className="text-3xl text-gray-300" />}
                </div>
                <div>
                  <label className="btn-outline text-[11px] flex items-center gap-1.5 cursor-pointer">
                    <Fa icon={faUpload} style={{ fontSize: 10 }} /> Upload Logo
                    <input type="file" className="hidden" accept="image/*" onChange={e => {
                      const file = e.target.files?.[0]
                      if (file) { const r = new FileReader(); r.onload = ev => updateCompanySettings({ logoUrl: ev.target?.result as string }); r.readAsDataURL(file) }
                    }} />
                  </label>
                  {companySettings.logoUrl && (
                    <button style={{ display: 'block', fontSize: 10, marginTop: 4, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => updateCompanySettings({ logoUrl: '' })}>Remove</button>
                  )}
                  <p style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>PNG or JPG — appears on invoices &amp; PDFs</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Company Name"><Input value={companySettings.name} onChange={v => updateCompanySettings({ name: v })} /></Field>
                <Field label="KRA PIN"><Input value={companySettings.kraPin} onChange={v => updateCompanySettings({ kraPin: v })} /></Field>
                <Field label="Phone"><Input value={companySettings.phone} type="tel" onChange={v => updateCompanySettings({ phone: v })} maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" /></Field>
                <Field label="Email"><Input value={companySettings.email} type="email" onChange={v => updateCompanySettings({ email: v })} maxLength={100} /></Field>
                <Field label="Website"><Input value={companySettings.website} onChange={v => updateCompanySettings({ website: v })} /></Field>
                <Field label="Currency">
                  <Select value={companySettings.currency} onChange={v => updateCompanySettings({ currency: v })} options={[
                    { value: 'KES', label: 'KES — Kenyan Shilling' },
                    { value: 'USD', label: 'USD — US Dollar' },
                    { value: 'EUR', label: 'EUR — Euro' },
                    { value: 'GBP', label: 'GBP — British Pound' },
                  ]} />
                </Field>
                <Field label="Address"><Input value={companySettings.address} onChange={v => updateCompanySettings({ address: v })} /></Field>
                <Field label="City / Postal"><Input value={companySettings.city} onChange={v => updateCompanySettings({ city: v })} /></Field>
                <Field label="Fiscal Year Start">
                  <Select value={ss.fiscalYearStart} onChange={v => updateSystemSettings({ fiscalYearStart: v })} options={[
                    { value: 'January', label: 'January – December' },
                    { value: 'April',   label: 'April – March' },
                    { value: 'July',    label: 'July – June' },
                    { value: 'October', label: 'October – September' },
                  ]} />
                </Field>
                <Field label="VAT Rate (%)"><Input type="number" value={String(companySettings.vatRate)} onChange={v => updateCompanySettings({ vatRate: Number(v) })} /></Field>
                <Field label="M-Pesa Paybill"><Input value={companySettings.mpesaPaybill} onChange={v => updateCompanySettings({ mpesaPaybill: v })} /></Field>
                <Field label="M-Pesa Account"><Input value={companySettings.mpesaAccount} onChange={v => updateCompanySettings({ mpesaAccount: v })} /></Field>
                <div className="col-span-2">
                  <Field label="Invoice Footer"><Textarea value={companySettings.invoiceFooter} onChange={v => updateCompanySettings({ invoiceFooter: v })} /></Field>
                </div>
              </div>
            </Card>
            <Card title="System Access">
              <Row label="Multi-User Roles" desc="Allow multiple roles with different permissions per user"><Toggle on={ss.multiUserRoles} onChange={v => updateSystemSettings({ multiUserRoles: v })} /></Row>
              <Row label="Enforce Department Access" desc="Restrict data visibility based on employee department"><Toggle on={ss.enforceDeptAccess} onChange={v => updateSystemSettings({ enforceDeptAccess: v })} /></Row>
              <Row label="Audit Logs" desc="Track all user actions and data changes system-wide"><Toggle on={ss.auditLogs} onChange={v => updateSystemSettings({ auditLogs: v })} /></Row>
            </Card>
            <Card title="Database Management">
              <Row label="Migrate to Postgres" desc="Upload all local browser data to your new Vercel Postgres database.">
                <button className="btn-primary text-[11px] whitespace-nowrap" onClick={handleForceSync} disabled={syncingDB}>
                  {syncingDB ? 'Syncing...' : 'Start Migration'}
                </button>
              </Row>
            </Card>
          </>
        )}

        {/* ════ BANKS ════ */}
        {section === 'banks' && (
          <div className="card overflow-hidden">
            <PanelHeader title="Bank Accounts" count={bankAccounts.length}>
              <button className="btn-primary text-[11px]" onClick={openAddBank}>+ Add Account</button>
            </PanelHeader>
            <Table cols={[
              { label: 'Account Name', width: '1.4fr' },
              { label: 'Bank', width: '1.3fr' },
              { label: 'Account No', width: '1.1fr' },
              { label: 'Currency', width: '0.6fr' },
              { label: 'Opening Bal', width: '1fr' },
              { label: 'Status', width: '0.7fr' },
              { label: 'Actions', width: '1.1fr' },
            ]}>
              {bankAccounts.map(a => (
                <div key={a.id} className="table-row">
                  <span className="font-semibold text-gray-900">{a.name}</span>
                  <span className="text-[11px] text-gray-600">{a.bankName}</span>
                  <span className="font-mono text-[11px] text-gray-600">{a.accountNo}</span>
                  <span className="text-[11px] text-gray-600">{a.currency}</span>
                  <span className="font-mono text-[11px] font-medium text-gray-900">{fmtKes(a.openingBalance)}</span>
                  <span><Badge status={a.active ? 'active' : 'cancelled'} label={a.active ? 'Active' : 'Inactive'} /></span>
                  <span className="flex gap-1.5">
                    <button className="bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-md text-blue-900 px-2.5 py-1 text-[10px] font-medium cursor-pointer transition-colors" onClick={() => openEditBank(a.id)}>Edit</button>
                    <button className={`${a.active ? 'bg-red-50 hover:bg-red-100 border-red-100 text-red-600' : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-100 text-emerald-700'} border rounded-md px-2.5 py-1 text-[10px] font-medium cursor-pointer transition-colors`} onClick={() => updateBankAccount(a.id, { active: !a.active })}>{a.active ? 'Disable' : 'Enable'}</button>
                    <button className="bg-red-50 hover:bg-red-100 border border-red-100 rounded-md text-red-600 px-2.5 py-1 text-[10px] font-medium cursor-pointer transition-colors" onClick={() => { if (window.confirm(`Delete "${a.name}"?`)) deleteBankAccount(a.id) }}>Del</button>
                  </span>
                </div>
              ))}
            </Table>
          </div>
        )}

        {/* ════ USER ACCESS ════ */}
        {section === 'access' && (
          <div className="flex flex-col gap-3">
            <div className="card overflow-hidden">
              <PanelHeader title="System Users" count={users.length}>
                <button className="btn-primary text-[11px]" onClick={() => { setUserForm(blankUser); setShowUserModal(true) }}>+ Add User</button>
              </PanelHeader>
              <Table cols={[
                { label: 'Name', width: '1.2fr' },
                { label: 'Username', width: '0.9fr' },
                { label: 'Role', width: '0.9fr' },
                { label: 'Modules', width: '3fr' },
                { label: 'Status', width: '0.6fr' },
                { label: 'Actions', width: '0.9fr' },
              ]}>
                {users.map(user => (
                  <div key={user.id} className="table-row">
                <span className="font-semibold text-gray-900">{user.name}</span>
                <span className="font-mono text-[11px] text-blue-900">@{user.username}</span>
                    <span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                    user.role === 'admin' ? 'bg-blue-50 text-blue-900' :
                    user.role === 'finance' ? 'bg-amber-50 text-amber-700' :
                    'bg-cyan-50 text-cyan-700'
                  }`}>{formatRoleLabel(user.role)}</span>
                    </span>
                    <span className="flex gap-1 flex-wrap">
                      {user.modules.map(m => (
                    <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">
                          {m === 'pos' ? 'POS' : formatRoleLabel(m)}
                        </span>
                      ))}
                    </span>
                    <span><Badge status={user.active ? 'active' : 'cancelled'} label={user.active ? 'active' : 'inactive'} /></span>
                <span className="flex gap-1.5">
                  <button className="bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-md text-blue-900 px-2.5 py-1 text-[10px] font-medium cursor-pointer transition-colors" onClick={() => {
                        const u = users.find(x => x.id === user.id)!
                        setUserForm({ id: u.id, username: u.username, name: u.name, role: u.role, modules: [...u.modules], active: u.active, password: '' })
                        setShowUserModal(true)
                      }}>Edit</button>
                  <button className={`bg-red-50 hover:bg-red-100 border border-red-100 rounded-md text-red-600 px-2.5 py-1 text-[10px] font-medium transition-colors ${user.id === currentUserId ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`} disabled={user.id === currentUserId} onClick={() => { void removeUser(user.id) }}>Del</button>
                    </span>
                  </div>
                ))}
              </Table>
            </div>
            <div className="card p-4">
              <p className="text-xs font-bold text-t1 mb-3">Role Capabilities</p>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                {[
                  { role: 'Admin',       color: '#1B2762', bg: 'rgba(27,39,98,0.07)',   desc: 'Full access to all modules including HR, Settings, Users, Payroll, and Accounting.' },
                  { role: 'Finance',     color: '#92400E', bg: 'rgba(245,158,11,0.07)', desc: 'Access to Accounting, Payroll approvals, Bank Reconciliation, and Reports.' },
                  { role: 'Lead Tech',   color: '#0891B2', bg: 'rgba(8,145,178,0.07)',  desc: 'Manages Repairs, assigns jobs, views Inventory and Delivery.' },
                  { role: 'Repair Tech', color: '#5B21B6', bg: 'rgba(139,92,246,0.07)', desc: 'Works on assigned repair jobs only. Limited to Repairs and Self Service.' },
                  { role: 'Sales Rep',   color: '#059669', bg: 'rgba(16,185,129,0.07)', desc: 'Handles Sales, CRM, POS, and Contacts. No finance or HR access.' },
                ].map(r => (
                  <div key={r.role} className="rounded-xl p-3.5 border" style={{ background: r.bg, borderColor: `${r.color}20` }}>
                    <p className="font-bold text-xs m-0" style={{ color: r.color }}>{r.role}</p>
                    <p className="text-gray-500 leading-relaxed m-0 mt-1.5 text-[10.5px]">{r.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════ CRM ════ */}
        {section === 'crm' && (
          <>
            <Card title="Core">
              <Row label="Enable Leads & Opportunities" desc="Track customer enquiries through a sales pipeline"><Toggle on={ss.crmLeads} onChange={v => updateSystemSettings({ crmLeads: v })} /></Row>
              <Row label="Lead Scoring" desc="Auto-score leads based on behaviour and attributes"><Toggle on={ss.crmLeadScoring} onChange={v => updateSystemSettings({ crmLeadScoring: v })} /></Row>
              <Row label="Tags & Source Tracking" desc="Label leads by source — WhatsApp, walk-in, referral, etc."><Toggle on={ss.crmTags} onChange={v => updateSystemSettings({ crmTags: v })} /></Row>
            </Card>
            <Card title="Pipeline Stages">
              <p className="text-[11px] text-gray-400 mb-3">These stages drive the CRM pipeline. Click × to remove, type to add.</p>
              <TagEditor tags={ss.crmPipelineStages} onChange={v => updateSystemSettings({ crmPipelineStages: v })} placeholder="Add stage…" />
            </Card>
            <Card title="Activities & Automation">
              <Row label="Enforce: Next Activity Required" desc="No opportunity can sit without a scheduled follow-up"><Toggle on={ss.crmEnforceNextActivity} onChange={v => updateSystemSettings({ crmEnforceNextActivity: v })} /></Row>
              <Row label="Auto-assign Leads" desc="Round-robin assignment to available sales reps"><Toggle on={ss.crmAutoAssignLeads} onChange={v => updateSystemSettings({ crmAutoAssignLeads: v })} /></Row>
              <Row label="Auto Follow-up after Quote Sent" desc="Create a follow-up task 2 days after a quote is sent"><Toggle on={ss.crmAutoFollowUpAfterQuote} onChange={v => updateSystemSettings({ crmAutoFollowUpAfterQuote: v })} /></Row>
            </Card>
          </>
        )}

        {/* ════ SALES ════ */}
        {section === 'sales' && (
          <>
            <Card title="Quotations">
              <Row label="Quotation Templates" desc="Save and reuse standard quote layouts"><Toggle on={ss.salesQuotationTemplates} onChange={v => updateSystemSettings({ salesQuotationTemplates: v })} /></Row>
              <Row label="Optional Products" desc="Include optional line items on quotes for customer selection"><Toggle on={ss.salesOptionalProducts} onChange={v => updateSystemSettings({ salesOptionalProducts: v })} /></Row>
              <Row label="Digital Signature" desc="Require customer e-signature on confirmed orders"><Toggle on={ss.salesDigitalSignature} onChange={v => updateSystemSettings({ salesDigitalSignature: v })} /></Row>
              <Row label="Online Acceptance" desc="Customer can approve quotes via a shareable link"><Toggle on={ss.salesOnlineAcceptance} onChange={v => updateSystemSettings({ salesOnlineAcceptance: v })} /></Row>
            </Card>
            <Card title="Pricing">
              <Row label="Enable Pricelists" desc="Multiple pricing tiers per customer segment or volume"><Toggle on={ss.salesPricelists} onChange={v => updateSystemSettings({ salesPricelists: v })} /></Row>
              <Row label="Discount Control" desc="Require manager approval for discounts above a threshold"><Toggle on={ss.salesDiscountControl} onChange={v => updateSystemSettings({ salesDiscountControl: v })} /></Row>
            </Card>
            <Card title="Orders">
              <Row label="Confirmed Quotes → Sales Orders" desc="Mandatory flow: quote must be confirmed before becoming an order"><Toggle on={ss.salesConfirmedQuotesToOrders} onChange={v => updateSystemSettings({ salesConfirmedQuotesToOrders: v })} /></Row>
            </Card>
          </>
        )}

        {/* ════ INVENTORY ════ */}
        {section === 'inventory' && (
          <>
            <Card title="Core Rules">
              <Row label="Products Created in Inventory Only" desc="Prevent ad-hoc product creation from Sales, POS, or Purchases"><Toggle on={ss.invProductsMasterOnly} onChange={v => updateSystemSettings({ invProductsMasterOnly: v })} /></Row>
              <Row label="No Direct Stock Edits" desc="Stock can only change via validated inventory operations — no manual adjustments for non-admins"><Toggle on={ss.invNoDirectStockEdits} onChange={v => updateSystemSettings({ invNoDirectStockEdits: v })} /></Row>
              <Row label="Multi-Step Routes" desc="Receipt → Quality Check → Stock (vs. direct to stock)"><Toggle on={ss.invMultiStepRoutes} onChange={v => updateSystemSettings({ invMultiStepRoutes: v })} /></Row>
            </Card>
            <Card title="Storage Locations">
              <TagEditor tags={ss.invStorageLocations} onChange={v => updateSystemSettings({ invStorageLocations: v })} placeholder="Add location…" />
            </Card>
            <Card title="Tracking">
              <Row label="Serial Number Tracking" desc="Track individual units — laptops, CPUs, phones by serial"><Toggle on={ss.invSerialNumbers} onChange={v => updateSystemSettings({ invSerialNumbers: v })} /></Row>
              <Row label="Lot Tracking" desc="Track batches of accessories or consumables"><Toggle on={ss.invLots} onChange={v => updateSystemSettings({ invLots: v })} /></Row>
            </Card>
            <Card title="Valuation">
              <Row label="Automated Inventory Valuation" desc="Auto-compute stock value on every movement"><Toggle on={ss.invAutomatedValuation} onChange={v => updateSystemSettings({ invAutomatedValuation: v })} /></Row>
              <Row label="Costing Method" desc="How unit cost is determined for stock valuation">
                <Select value={ss.invCostingMethod} onChange={v => updateSystemSettings({ invCostingMethod: v as any })} options={[
                  { value: 'fifo',     label: 'FIFO — First In First Out (recommended)' },
                  { value: 'average',  label: 'Average Cost' },
                  { value: 'standard', label: 'Standard Price' },
                ]} />
              </Row>
            </Card>
          </>
        )}

        {/* ════ PURCHASE ════ */}
        {section === 'purchase' && (
          <>
            <Card title="Core Flow">
              <Row label="Purchase Agreements" desc="Framework agreements with vendors (blanket orders)"><Toggle on={ss.purPurchaseAgreements} onChange={v => updateSystemSettings({ purPurchaseAgreements: v })} /></Row>
              <Row label="Vendor Pricelists" desc="Store and apply vendor-specific pricing per product"><Toggle on={ss.purVendorPricelists} onChange={v => updateSystemSettings({ purVendorPricelists: v })} /></Row>
              <Row label="Enforce RFQ → PO → Receipt → Bill" desc="Full purchase flow — no skipping steps"><Toggle on={ss.purEnforceRFQFlow} onChange={v => updateSystemSettings({ purEnforceRFQFlow: v })} /></Row>
              <Row label="Store Vendor Lead Times" desc="Record expected delivery times per vendor and product"><Toggle on={ss.purStoreLeadTimes} onChange={v => updateSystemSettings({ purStoreLeadTimes: v })} /></Row>
            </Card>
            <Card title="Approval Controls">
              <Row label="Require Approval for High-Value Purchases" desc="Orders above the threshold need admin sign-off before confirming"><Toggle on={ss.purRequireApprovalHighValue} onChange={v => updateSystemSettings({ purRequireApprovalHighValue: v })} /></Row>
              {ss.purRequireApprovalHighValue && (
                <div style={{ paddingTop: 8 }}>
                  <Field label="High-Value Threshold (KES)">
                    <Input type="number" value={String(ss.purHighValueThreshold)} onChange={v => updateSystemSettings({ purHighValueThreshold: Number(v) })} />
                  </Field>
                </div>
              )}
            </Card>
          </>
        )}

        {/* ════ REPAIR ════ */}
        {section === 'repair' && (
          <>
            <Card title="Enable">
              <Row label="Repair Orders" desc="Accept and track device repair jobs end-to-end"><Toggle on={ss.repRepairOrders} onChange={v => updateSystemSettings({ repRepairOrders: v })} /></Row>
              <Row label="Warranty Tracking" desc="Flag and handle repairs that fall within the warranty period"><Toggle on={ss.repWarrantyTracking} onChange={v => updateSystemSettings({ repWarrantyTracking: v })} /></Row>
              <Row label="Parts Consumption from Inventory" desc="Deduct parts used in repairs from stock automatically on completion"><Toggle on={ss.repPartsConsumption} onChange={v => updateSystemSettings({ repPartsConsumption: v })} /></Row>
            </Card>
            <Card title="Flow Enforcement">
              <Row label="Enforce Repair Flow" desc="Device check-in → Diagnosis → Approval → Repair → QC → Release — steps cannot be skipped"><Toggle on={ss.repEnforceFlow} onChange={v => updateSystemSettings({ repEnforceFlow: v })} /></Row>
              <Row label="Only Assigned Technician Sees Job" desc="Technicians cannot view or edit repair jobs not assigned to them"><Toggle on={ss.repOnlyAssignedTechSeesJob} onChange={v => updateSystemSettings({ repOnlyAssignedTechSeesJob: v })} /></Row>
              <Row label="Admin / Lead Assigns Jobs" desc="Only admins and lead techs can assign repair jobs to technicians"><Toggle on={ss.repAdminAssignsJobs} onChange={v => updateSystemSettings({ repAdminAssignsJobs: v })} /></Row>
            </Card>
          </>
        )}

        {/* ════ ACCOUNTING ════ */}
        {section === 'accounting' && (
          <>
            <Card title="Core Documents">
              <Row label="Customer Invoices" desc="Issue invoices to customers for sales"><Toggle on={ss.accCustomerInvoices} onChange={v => updateSystemSettings({ accCustomerInvoices: v })} /></Row>
              <Row label="Vendor Bills" desc="Record supplier invoices as accounts payable"><Toggle on={ss.accVendorBills} onChange={v => updateSystemSettings({ accVendorBills: v })} /></Row>
              <Row label="Credit Notes" desc="Issue and receive credit notes for returns and adjustments"><Toggle on={ss.accCreditNotes} onChange={v => updateSystemSettings({ accCreditNotes: v })} /></Row>
            </Card>
            <Card title="Taxes">
              <Row label="Enable VAT" desc="Apply VAT on sales and purchases"><Toggle on={ss.accVatEnabled} onChange={v => updateSystemSettings({ accVatEnabled: v })} /></Row>
              {ss.accVatEnabled && (
                <div style={{ paddingTop: 8 }}>
                  <Field label="VAT Rate (%) — Kenya standard is 16%">
                    <Input type="number" value={String(companySettings.vatRate)} onChange={v => updateCompanySettings({ vatRate: Number(v) })} />
                  </Field>
                </div>
              )}
            </Card>
            <Card title="Payments & Journals">
              <Row label="Bank Journals" desc="Record and reconcile payments through bank accounts"><Toggle on={ss.accBankJournals} onChange={v => updateSystemSettings({ accBankJournals: v })} /></Row>
              <Row label="M-Pesa Journals" desc="Record M-Pesa Paybill collections and disbursements"><Toggle on={ss.accMpesaJournals} onChange={v => updateSystemSettings({ accMpesaJournals: v })} /></Row>
              <Row label="Bank Reconciliation" desc="Match bank statements against system cashbook entries monthly"><Toggle on={ss.accReconciliation} onChange={v => updateSystemSettings({ accReconciliation: v })} /></Row>
            </Card>
            <Card title="Controls">
              <Row label="Lock Dates After Period Closing" desc="Prevent edits to accounting entries in closed periods"><Toggle on={ss.accLockDates} onChange={v => updateSystemSettings({ accLockDates: v })} /></Row>
              <Row label="Approval Required for Refunds" desc="Refunds need admin or finance approval before processing"><Toggle on={ss.accApprovalForRefunds} onChange={v => updateSystemSettings({ accApprovalForRefunds: v })} /></Row>
            </Card>
          </>
        )}

        {/* ════ HR CONFIG ════ */}
        {section === 'hr_config' && (
          <>
            <Card title="Enable">
              <Row label="Attendance Tracking" desc="Clock-in / clock-out tracking per employee shift"><Toggle on={ss.hrAttendance} onChange={v => updateSystemSettings({ hrAttendance: v })} /></Row>
              <Row label="Leave Management" desc="Employees apply for leave via Self Service; HR approves here"><Toggle on={ss.hrLeaves} onChange={v => updateSystemSettings({ hrLeaves: v })} /></Row>
            </Card>
            <Card title="Access Controls">
              <Row label="Restrict Salary Information" desc="Only HR Admin and Finance can view salary, deductions, and payslip data"><Toggle on={ss.hrRestrictSalaryInfo} onChange={v => updateSystemSettings({ hrRestrictSalaryInfo: v })} /></Row>
              <Row label="Role-Based Visibility" desc="Employees in Self Service only see their own records — not company-wide data"><Toggle on={ss.hrRoleBasedVisibility} onChange={v => updateSystemSettings({ hrRoleBasedVisibility: v })} /></Row>
            </Card>
          </>
        )}

        {/* ════ POS ════ */}
        {section === 'pos' && (
          <div className="flex flex-col gap-4">
            <Card title="Point of Sale Configuration">
              <Row label="POS Session Control" desc="Require opening and closing a cash session for each shift"><Toggle on={ss.posSessionControl} onChange={v => updateSystemSettings({ posSessionControl: v })} /></Row>
              <Row label="Cash Control" desc="Count cash at session open and close; track discrepancies"><Toggle on={ss.posCashControl} onChange={v => updateSystemSettings({ posCashControl: v })} /></Row>
              <Row label="Receipt Printing" desc="Auto-generate a receipt after each POS sale"><Toggle on={ss.posReceiptPrinting} onChange={v => updateSystemSettings({ posReceiptPrinting: v })} /></Row>
            </Card>
            <Card 
              title="Daily Shift & Cash Flow Summary"
              action={
                <ExportButtons 
                  title="POS Daily Shift Summary" 
                  filename="pos_shift_summary" 
                  headers={['Date', 'Orders', 'Cash (KES)', 'M-Pesa (KES)', 'Card (KES)', 'Total Revenue (KES)']} 
                  rows={posDailySummary.map(s => [fmtDate(s.date), s.count, s.cash, s.mpesa, s.card, s.total])} 
                />
              }
            >
              <Table cols={[
                { label: 'Date', width: '1fr' },
                { label: 'Orders', width: '0.8fr' },
                { label: 'Cash (KES)', width: '1fr' },
                { label: 'M-Pesa (KES)', width: '1fr' },
                { label: 'Card (KES)', width: '1fr' },
                { label: 'Total Revenue', width: '1.2fr' },
              ]}>
                {posDailySummary.length === 0 ? (
                  <div className="py-6 text-center text-xs text-t3">No POS transactions recorded</div>
                ) : posDailySummary.map(s => (
                  <div key={s.date} className="table-row">
                    <span className="font-semibold text-t1">{fmtDate(s.date)}</span>
                    <span>{s.count}</span>
                    <span className="font-mono text-t2">{fmtKes(s.cash)}</span>
                    <span className="font-mono text-t2">{fmtKes(s.mpesa)}</span>
                    <span className="font-mono text-t2">{fmtKes(s.card)}</span>
                    <span className="font-mono font-bold" style={{ color: '#10B981' }}>{fmtKes(s.total)}</span>
                  </div>
                ))}
              </Table>
            </Card>
          </div>
        )}

        {/* ════ SECURITY ════ */}
        {section === 'security' && (
          <>
            <Card title="Data Protection Rules">
              <Row label="Disable Product Deletion" desc="Products can be archived but never permanently deleted — preserves history"><Toggle on={ss.secDisableProductDeletion} onChange={v => updateSystemSettings({ secDisableProductDeletion: v })} /></Row>
              <Row label="Disable Manual Stock Manipulation" desc="Stock levels can only change through validated inventory operations (receipts, returns, repairs)"><Toggle on={ss.secDisableStockManipulation} onChange={v => updateSystemSettings({ secDisableStockManipulation: v })} /></Row>
              <Row label="Lock Invoices After Validation" desc="Validated invoices cannot be edited — corrections require a credit note"><Toggle on={ss.secDisableInvoiceEditAfterValidation} onChange={v => updateSystemSettings({ secDisableInvoiceEditAfterValidation: v })} /></Row>
            </Card>
            <Card title="System Integration Rules">
              <div className="flex flex-col">
                {[
                  { rule: 'Rule 1', text: 'Products are created in Inventory and referenced from Sales, Purchase, POS, and Repairs — never duplicated.' },
                  { rule: 'Rule 2', text: 'No duplicate data entry across modules. One record, many references.' },
                  { rule: 'Rule 3', text: 'Every sale must trace back to a stock movement, an invoice, and a payment.' },
                  { rule: 'Rule 4', text: 'Every repair must trace the device, assigned technician, parts consumed, and final outcome.' },
                ].map(r => (
                  <div key={r.rule} className="flex gap-3 py-3 border-b border-gray-100 last:border-0">
                    <span className="font-bold text-blue-900 flex-shrink-0 text-[11px]">{r.rule}:</span>
                    <span className="text-gray-600 text-[11px] leading-relaxed">{r.text}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Role-Based Access Summary">
              <div className="flex flex-col text-[11px]">
                {[
                  { role: 'Admin',       perms: 'Full system access including destructive operations and settings' },
                  { role: 'Finance',     perms: 'Accounting, payroll approval, bank recon — no HR records or repairs' },
                  { role: 'Lead Tech',   perms: 'Assign and manage repairs, view inventory — no accounting' },
                  { role: 'Repair Tech', perms: 'Own assigned jobs only — no pricing, invoicing, or other modules' },
                  { role: 'Sales Rep',   perms: 'Sales, CRM, POS, Contacts — no finance, HR, or stock edits' },
                ].map(r => (
                  <div key={r.role} className="flex gap-3 py-3 border-b border-gray-100 last:border-0">
                    <span className="font-bold text-gray-900 w-24 flex-shrink-0">{r.role}</span>
                    <span className="text-gray-600 leading-relaxed">{r.perms}</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

      </div>
      </div>

      {/* ── Bank Modal ── */}
      {showBankModal && (
        <Modal title={editingBankId ? 'Edit Bank Account' : 'Add Bank Account'} onClose={() => setShowBankModal(false)} width={480}>
          <Field label="Account Name"><Input value={bankForm.name} onChange={v => setBankForm(p => ({ ...p, name: v }))} placeholder="e.g. NCBA Current Account" /></Field>
          <Field label="Bank Name"><Input value={bankForm.bankName} onChange={v => setBankForm(p => ({ ...p, bankName: v }))} placeholder="e.g. NCBA Bank Kenya PLC" /></Field>
          <Field label="Account Number"><Input value={bankForm.accountNo} onChange={v => setBankForm(p => ({ ...p, accountNo: v }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency">
              <Select value={bankForm.currency} onChange={v => setBankForm(p => ({ ...p, currency: v }))} options={[
                { value: 'KES', label: 'KES' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' },
              ]} />
            </Field>
            <Field label="Opening Date"><Input type="date" value={bankForm.openingDate} onChange={v => setBankForm(p => ({ ...p, openingDate: v }))} /></Field>
          </div>
          <Field label="Opening Balance (KES)"><Input type="number" value={bankForm.openingBalance} onChange={v => setBankForm(p => ({ ...p, openingBalance: v }))} /></Field>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-outline" onClick={() => setShowBankModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={!bankForm.name || !bankForm.accountNo} onClick={saveBank}>
              {editingBankId ? 'Save Changes' : 'Add Account'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── User Modal ── */}
      {showUserModal && (
        <Modal title={userForm.id ? 'Edit System User' : 'Add System User'} onClose={() => setShowUserModal(false)} width={620}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full Name" required><Input value={userForm.name} onChange={v => setUserForm(p => ({ ...p, name: v }))} /></Field>
            <Field label="Username" required><Input value={userForm.username} onChange={v => setUserForm(p => ({ ...p, username: v }))} maxLength={50} pattern="^[a-zA-Z0-9_\-\.]+$" /></Field>
            <Field label="Role" required>
              <Select value={userForm.role} onChange={v => setUserForm(p => ({ ...p, role: v }))} options={roleOptions} />
            </Field>
            <Field label="Status">
              <Select value={userForm.active ? 'active' : 'inactive'} onChange={v => setUserForm(p => ({ ...p, active: v === 'active' }))} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            </Field>
            <div className="col-span-2">
              <Field label={userForm.id ? 'Reset Password' : 'Password'} required={!userForm.id} hint={userForm.id ? 'Leave blank to keep current.' : 'Min 6 characters.'}>
                <Input type="password" value={userForm.password} onChange={v => setUserForm(p => ({ ...p, password: v }))} placeholder={userForm.id ? 'Optional new password' : 'Temporary password'} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Allowed Modules" required hint="Users can only enter modules enabled here.">
                <div className="grid grid-cols-3 gap-2 rounded-xl border p-3" style={{ borderColor: '#E5E7EB', background: '#F9FAFB' }}>
                  {moduleOptions.map(opt => {
                    const sel = userForm.modules.includes(opt.value)
                    return (
                      <button key={opt.value} type="button" onClick={() => toggleUserModule(opt.value)}
                        className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                        style={{ borderColor: sel ? '#A8D4E8' : '#E5E7EB', background: sel ? '#E8F3FA' : '#FFF', color: sel ? '#1B2762' : '#6B7280', fontWeight: sel ? 600 : 400 }}>
                        <span>{opt.label}</span>
                        <Fa icon={sel ? faCheck : faPlus} style={{ fontSize: sel ? 10 : 9 }} />
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-outline" onClick={() => setShowUserModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={savingUser} onClick={() => { void saveUser() }}>
              {savingUser ? 'Saving…' : userForm.id ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
