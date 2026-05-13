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
  faPlus, faCheck, faUpload, faBullseye, faChevronRight,
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
      className={`relative inline-flex h-[22px] w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#1B2762] focus:ring-offset-1 ${on ? 'bg-[#1B2762]' : 'bg-gray-200'}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${on ? 'translate-x-[18px]' : 'translate-x-0'}`}
      />
    </button>
  )
}

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-gray-50 last:border-0 gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-gray-800 leading-tight">{label}</p>
        {desc && <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{desc}</p>}
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
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-[#EEF2FF] text-[#1B2762] border border-[#C7D2FE] font-medium">
            {t}
            <button
              className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#C7D2FE] hover:bg-[#A5B4FC] text-[#1B2762] border-none cursor-pointer leading-none text-[10px] font-bold outline-none transition-colors"
              onClick={() => onChange(tags.filter((_, j) => j !== i))}
            >×</button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[11px] text-gray-400 italic">No items yet</span>}
      </div>
              <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          className="flex-1 text-[12px] px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-[#1B2762] focus:ring-2 focus:ring-[#1B2762]/10 transition-all bg-white"
          placeholder={placeholder}
        />
        <button
          onClick={add}
          className="text-[11px] px-4 py-2 bg-[#1B2762] hover:bg-[#14204F] text-white border-none rounded-lg cursor-pointer font-semibold transition-colors whitespace-nowrap"
        >+ Add</button>
      </div>
    </div>
  )
}

function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center px-4 sm:px-5 py-3 border-b border-gray-50 gap-2 sm:gap-0">
        <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest">{title}</p>
        {action && <div>{action}</div>}
      </div>
      <div className="px-4 sm:px-5 py-1">{children}</div>
    </div>
  )
}

export default function HRSettings() {
  const {
    bankAccounts, updateBankAccount, addBankAccount, deleteBankAccount,
    companySettings, updateCompanySettings,
    systemSettings: ss, updateSystemSettings,
    users, currentUserId,
    createUser, updateUser, deleteUser,
    unlockUser,
    posOrders,
  } = useApp()

  const [section, setSection] = useState<Section>('general')

  const [bankForm, setBankForm] = useState({ name: '', bankName: '', accountNo: '', currency: 'KES', openingBalance: '0', openingDate: new Date().toISOString().slice(0, 10) })
  const [editingBankId, setEditingBankId] = useState<string | null>(null)
  const [showBankModal, setShowBankModal] = useState(false)

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
      else await createUser({ username: payload.username, name: payload.name, role: payload.role, modules: payload.modules, active: payload.active, password: userForm.password, mustChangePassword: true })
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
      cur.total += o.total; cur.count += 1
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
        if (key && key.startsWith('deed_')) payload[key] = localStorage.getItem(key) || ''
      }
      const res = await fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (res.ok) alert('Migration successful! All data is now in Postgres.')
      else alert('Failed to sync. Please check the server logs.')
    } catch { alert('An error occurred during migration.') }
    finally { setSyncingDB(false) }
  }

  const roleOptions = USER_ROLES.map(r => ({ value: r, label: formatRoleLabel(r) }))
  const moduleOptions = MODULE_IDS.map(m => ({ value: m, label: m === 'pos' ? 'Point of Sale' : formatRoleLabel(m) }))

  const nav: { id: Section; label: string; icon: any; group?: string }[] = [
    { id: 'general',    label: 'General',       icon: faBuilding,        group: 'Company' },
    { id: 'banks',      label: 'Bank Accounts', icon: faLandmark,        group: 'Company' },
    { id: 'access',     label: 'User Access',   icon: faUsers,           group: 'Company' },
    { id: 'crm',        label: 'CRM',           icon: faBullseye,        group: 'Modules' },
    { id: 'sales',      label: 'Sales',         icon: faBriefcase,       group: 'Modules' },
    { id: 'inventory',  label: 'Inventory',     icon: faBoxesStacked,    group: 'Modules' },
    { id: 'purchase',   label: 'Purchase',      icon: faCartShopping,    group: 'Modules' },
    { id: 'repair',     label: 'Repairs',       icon: faScrewdriverWrench, group: 'Modules' },
    { id: 'accounting', label: 'Accounting',    icon: faLandmark,        group: 'Modules' },
    { id: 'hr_config',  label: 'HR',            icon: faUserGroup,       group: 'Modules' },
    { id: 'pos',        label: 'Point of Sale', icon: faCashRegister,    group: 'Modules' },
    { id: 'security',   label: 'Security',      icon: faShieldHalved,    group: 'System' },
  ]

  const activeNav = nav.find(n => n.id === section)

  const roleBadgeStyle = (role: string) => {
    if (role === 'admin')        return { bg: '#1B2762', color: '#fff',     border: '#1B2762' }
    if (role === 'finance')      return { bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' }
    if (role === 'lead_tech')    return { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' }
    if (role === 'repair_tech')  return { bg: '#F5F3FF', color: '#5B21B6', border: '#DDD6FE' }
    if (role === 'sales_rep')    return { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' }
    return                              { bg: '#F3F4F6', color: '#374151', border: '#E5E7EB' }
  }

  return (
    <div className="max-w-6xl mx-auto pb-16">

      {/* ── Page header ── */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
        <div>
          <h2 className="text-[15px] font-bold text-gray-900 leading-tight">System Settings</h2>
          <p className="text-[11.5px] text-gray-400 mt-0.5">Configure company info, users, and module behaviour</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Desktop sidebar ── */}
        <aside className="hidden lg:block w-52 flex-shrink-0 sticky top-4">
          <nav className="bg-white rounded-2xl border border-gray-100 shadow-sm p-2 space-y-0.5">
            {['Company', 'Modules', 'System'].map(group => (
              <div key={group}>
                <p className="text-[9.5px] font-bold text-gray-300 uppercase tracking-widest px-3 pt-3 pb-1">{group}</p>
                {nav.filter(n => n.group === group).map(item => (
                  <button key={item.id} onClick={() => setSection(item.id)}
                    className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-[11.5px] font-medium cursor-pointer transition-all border-none text-left ${
                      section === item.id
                        ? 'bg-[#1B2762] text-white shadow-sm'
                        : 'bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                    }`}>
                    <Fa icon={item.icon} fixedWidth style={{ fontSize: 11, opacity: section === item.id ? 1 : 0.6 }} />
                    {item.label}
                    {section === item.id && <Fa icon={faChevronRight} className="ml-auto" style={{ fontSize: 8 }} />}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        {/* ── Mobile nav ── */}
        <div className="lg:hidden w-full -mx-0">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide px-0.5">
            {nav.map(item => (
              <button key={item.id} onClick={() => setSection(item.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium whitespace-nowrap flex-shrink-0 border transition-all cursor-pointer ${
                  section === item.id
                    ? 'bg-[#1B2762] text-white border-transparent shadow-sm'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-800'
                }`}>
                <Fa icon={item.icon} style={{ fontSize: 11 }} />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">

          {/* Section heading */}
          <div className="flex items-center gap-2 mb-4">
            {activeNav && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#EEF2FF] flex items-center justify-center">
                  <Fa icon={activeNav.icon} style={{ fontSize: 12, color: '#1B2762' }} />
                </div>
                <h3 className="text-[13px] font-bold text-gray-800">{activeNav.label}</h3>
              </div>
            )}
          </div>

          {/* ════ GENERAL ════ */}
          {section === 'general' && (
            <>
              <SectionCard title="Company Identity">
                <div className="flex items-start gap-4 py-4 mb-2 border-b border-gray-50">
                  <div className="w-[60px] h-[60px] rounded-xl border-2 border-gray-100 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {companySettings.logoUrl
                      ? <img src={companySettings.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                      : <Fa icon={faBuilding} style={{ fontSize: 22, color: '#D1D5DB' }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer transition-colors">
                      <Fa icon={faUpload} style={{ fontSize: 9 }} /> Upload Logo
                      <input type="file" className="hidden" accept="image/*" onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) { const r = new FileReader(); r.onload = ev => updateCompanySettings({ logoUrl: ev.target?.result as string }); r.readAsDataURL(file) }
                      }} />
                    </label>
                    {companySettings.logoUrl && (
                      <button className="block text-[10px] mt-1.5 text-red-400 hover:text-red-600 bg-transparent border-none cursor-pointer p-0 transition-colors" onClick={() => updateCompanySettings({ logoUrl: '' })}>Remove</button>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">PNG or JPG · shown on invoices &amp; PDFs</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3">
                  <Field label="Company Name"><Input value={companySettings.name} onChange={v => updateCompanySettings({ name: v })} /></Field>
                  <Field label="KRA PIN"><Input value={companySettings.kraPin} onChange={v => updateCompanySettings({ kraPin: v })} /></Field>
                  <Field label="Phone"><Input value={companySettings.phone} type="tel" onChange={v => updateCompanySettings({ phone: v })} maxLength={20} /></Field>
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
                  <div className="sm:col-span-2">
                    <Field label="Invoice Footer"><Textarea value={companySettings.invoiceFooter} onChange={v => updateCompanySettings({ invoiceFooter: v })} /></Field>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="System Access">
                <SettingRow label="Multi-User Roles" desc="Allow multiple roles with different permissions per user"><Toggle on={ss.multiUserRoles} onChange={v => updateSystemSettings({ multiUserRoles: v })} /></SettingRow>
                <SettingRow label="Enforce Department Access" desc="Restrict data visibility based on employee department"><Toggle on={ss.enforceDeptAccess} onChange={v => updateSystemSettings({ enforceDeptAccess: v })} /></SettingRow>
                <SettingRow label="Audit Logs" desc="Track all user actions and data changes system-wide"><Toggle on={ss.auditLogs} onChange={v => updateSystemSettings({ auditLogs: v })} /></SettingRow>
              </SectionCard>

              <SectionCard title="Database">
                <SettingRow label="Migrate to Postgres" desc="Upload all local browser data to your PostgreSQL database.">
                  <button
                    className="text-[11px] font-semibold px-4 py-2 rounded-lg bg-[#1B2762] hover:bg-[#14204F] text-white border-none cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap"
                    onClick={handleForceSync} disabled={syncingDB}
                  >
                    {syncingDB ? 'Syncing…' : 'Start Migration'}
                  </button>
                </SettingRow>
              </SectionCard>
            </>
          )}

          {/* ════ BANKS ════ */}
          {section === 'banks' && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3.5 border-b border-gray-50 gap-3 sm:gap-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-gray-800">Bank Accounts</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">{bankAccounts.length}</span>
                </div>
                <button className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B2762] hover:bg-[#14204F] text-white border-none cursor-pointer transition-colors" onClick={openAddBank}>+ Add Account</button>
              </div>

              {bankAccounts.length === 0 ? (
                <div className="py-14 text-center">
                  <Fa icon={faLandmark} style={{ fontSize: 28, color: '#E5E7EB' }} />
                  <p className="text-[12px] text-gray-400 mt-3">No bank accounts yet</p>
                  <button className="mt-3 text-[11px] font-semibold px-4 py-2 rounded-lg bg-[#1B2762] text-white border-none cursor-pointer" onClick={openAddBank}>Add your first account</button>
                </div>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="sm:hidden divide-y divide-gray-50">
                    {bankAccounts.map(a => (
                      <div key={a.id} className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="min-w-0">
                            <p className="font-bold text-[13px] text-gray-900 truncate">{a.name}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">{a.bankName}</p>
                            <p className="font-mono text-[11px] text-gray-400 mt-0.5">{a.accountNo} · {a.currency}</p>
                          </div>
                          <Badge status={a.active ? 'active' : 'cancelled'} label={a.active ? 'Active' : 'Inactive'} />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[13px] font-bold text-gray-900">{fmtKes(a.openingBalance)}</span>
                          <div className="flex gap-1.5">
                            <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1B2762] border border-blue-100 cursor-pointer transition-colors" onClick={() => openEditBank(a.id)}>Edit</button>
                            <button className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border cursor-pointer transition-colors ${a.active ? 'bg-red-50 hover:bg-red-100 text-red-600 border-red-100' : 'bg-green-50 hover:bg-green-100 text-green-700 border-green-100'}`} onClick={() => updateBankAccount(a.id, { active: !a.active })}>{a.active ? 'Disable' : 'Enable'}</button>
                            <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 cursor-pointer transition-colors" onClick={() => { if (window.confirm(`Delete "${a.name}"?`)) deleteBankAccount(a.id) }}>Del</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden sm:block">
                    <Table cols={[
                      { label: 'Account Name', width: '1.4fr' },
                      { label: 'Bank', width: '1.3fr' },
                      { label: 'Account No', width: '1.1fr' },
                      { label: 'Currency', width: '0.5fr' },
                      { label: 'Opening Bal', width: '1fr' },
                      { label: 'Status', width: '0.6fr' },
                      { label: 'Actions', width: '1.1fr' },
                    ]}>
                      {bankAccounts.map(a => (
                        <div key={a.id} className="table-row">
                          <span className="font-semibold text-gray-900">{a.name}</span>
                          <span className="text-[11px] text-gray-500">{a.bankName}</span>
                          <span className="font-mono text-[11px] text-gray-500">{a.accountNo}</span>
                          <span className="text-[11px] text-gray-500">{a.currency}</span>
                          <span className="font-mono text-[12px] font-semibold text-gray-900">{fmtKes(a.openingBalance)}</span>
                          <span><Badge status={a.active ? 'active' : 'cancelled'} label={a.active ? 'Active' : 'Inactive'} /></span>
                          <span className="flex gap-1.5">
                            <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1B2762] border border-blue-100 cursor-pointer transition-colors" onClick={() => openEditBank(a.id)}>Edit</button>
                            <button className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border cursor-pointer transition-colors ${a.active ? 'bg-red-50 hover:bg-red-100 text-red-600 border-red-100' : 'bg-green-50 hover:bg-green-100 text-green-700 border-green-100'}`} onClick={() => updateBankAccount(a.id, { active: !a.active })}>{a.active ? 'Disable' : 'Enable'}</button>
                            <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 cursor-pointer transition-colors" onClick={() => { if (window.confirm(`Delete "${a.name}"?`)) deleteBankAccount(a.id) }}>Del</button>
                          </span>
                        </div>
                      ))}
                    </Table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ════ USER ACCESS ════ */}
          {section === 'access' && (
            <div className="flex flex-col gap-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3.5 border-b border-gray-50 gap-3 sm:gap-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-gray-800">System Users</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">{users.length}</span>
                  </div>
                  <button className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B2762] hover:bg-[#14204F] text-white border-none cursor-pointer transition-colors" onClick={() => { setUserForm(blankUser); setShowUserModal(true) }}>+ Add User</button>
                </div>

                {/* Mobile user cards */}
                <div className="sm:hidden divide-y divide-gray-50">
                  {users.map(user => {
                    const rb = roleBadgeStyle(user.role)
                    const modules = Array.isArray(user.modules) ? user.modules : []
                    return (
                      <div key={user.id} className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="font-bold text-[13px] text-gray-900">{user.name}</p>
                            <p className="font-mono text-[11px] text-gray-400 mt-0.5">@{user.username}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border" style={{ background: rb.bg, color: rb.color, borderColor: rb.border }}>{formatRoleLabel(user.role)}</span>
                            <Badge status={user.active ? 'active' : 'cancelled'} label={user.active ? 'On' : 'Off'} />
                            {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-orange-50 text-orange-600 border-orange-200">Locked</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-3">
                          {modules.slice(0, 6).map(m => (
                            <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{m === 'pos' ? 'POS' : formatRoleLabel(m)}</span>
                          ))}
                          {modules.length > 6 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">+{modules.length - 6}</span>}
                        </div>
                        <div className="flex gap-2">
                          <button className="flex-1 text-[11px] font-medium py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1B2762] border border-blue-100 cursor-pointer transition-colors" onClick={() => { const u = users.find(x => x.id === user.id); if (!u) return; setUserForm({ id: u.id, username: u.username, name: u.name, role: u.role, modules: Array.isArray(u.modules) ? [...u.modules] : [], active: u.active, password: '' }); setShowUserModal(true) }}>Edit</button>
                          {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() && (
                            <button className="flex-1 text-[11px] font-medium py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-100 cursor-pointer transition-colors" onClick={() => { void unlockUser(user.id) }}>Unlock</button>
                          )}
                          <button className={`flex-1 text-[11px] font-medium py-1.5 rounded-lg border transition-colors ${user.id === currentUserId ? 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100' : 'bg-red-50 hover:bg-red-100 text-red-600 border-red-100 cursor-pointer'}`} disabled={user.id === currentUserId} onClick={() => { void removeUser(user.id) }}>Delete</button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block">
                  <Table cols={[
                    { label: 'Name', width: '1.2fr' },
                    { label: 'Username', width: '0.9fr' },
                    { label: 'Role', width: '0.9fr' },
                    { label: 'Modules', width: '3fr' },
                    { label: 'Status', width: '0.55fr' },
                    { label: 'Actions', width: '0.9fr' },
                  ]}>
                    {users.map(user => {
                      const rb = roleBadgeStyle(user.role)
                      const modules = Array.isArray(user.modules) ? user.modules : []
                      return (
                        <div key={user.id} className="table-row">
                          <span className="font-semibold text-gray-900">{user.name}</span>
                          <span className="font-mono text-[11px] text-gray-500">@{user.username}</span>
                          <span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border" style={{ background: rb.bg, color: rb.color, borderColor: rb.border }}>{formatRoleLabel(user.role)}</span>
                          </span>
                          <span className="flex gap-1 flex-wrap">
                            {modules.map(m => (
                              <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{m === 'pos' ? 'POS' : formatRoleLabel(m)}</span>
                            ))}
                          </span>
                          <span>
                            <Badge status={user.active ? 'active' : 'cancelled'} label={user.active ? 'on' : 'off'} />
                            {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() && (
                              <span className="ml-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border bg-orange-50 text-orange-600 border-orange-200">Locked</span>
                            )}
                          </span>
                          <span className="flex gap-1.5">
                            <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1B2762] border border-blue-100 cursor-pointer transition-colors" onClick={() => { const u = users.find(x => x.id === user.id); if (!u) return; setUserForm({ id: u.id, username: u.username, name: u.name, role: u.role, modules: Array.isArray(u.modules) ? [...u.modules] : [], active: u.active, password: '' }); setShowUserModal(true) }}>Edit</button>
                            {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() && (
                              <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-100 cursor-pointer transition-colors" onClick={() => { void unlockUser(user.id) }}>Unlock</button>
                            )}
                            <button className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${user.id === currentUserId ? 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100' : 'bg-red-50 hover:bg-red-100 text-red-600 border-red-100 cursor-pointer'}`} disabled={user.id === currentUserId} onClick={() => { void removeUser(user.id) }}>Del</button>
                          </span>
                        </div>
                      )
                    })}
                  </Table>
                </div>
              </div>

              {/* Role capabilities */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
                <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest mb-4">Role Capabilities</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { role: 'Director',          color: '#fff',     bg: '#1B2762', border: '#1B2762', desc: 'Full access to all modules, approvals, settings, user management, and audit trail.' },
                    { role: 'Admin Officer',     color: '#1B2762', bg: '#EEF2FF', border: '#C7D2FE', desc: 'Process, master-data, and workflow control. No payment posting or accounting.' },
                    { role: 'Finance Officer',   color: '#92400E', bg: '#FFFBEB', border: '#FDE68A', desc: 'Invoicing, bills, payments, bank/cash, tax, reconciliation, and financial reports.' },
                    { role: 'Inventory Officer', color: '#C2410C', bg: '#FFF7ED', border: '#FED7AA', desc: 'Physical stock control — receives goods, transfers, counts. No accounting.' },
                    { role: 'Kilimall Officer',  color: '#7E22CE', bg: '#FDF4FF', border: '#E9D5FF', desc: 'Processes Kilimall orders, allocates stock, manages returns and settlement uploads.' },
                    { role: 'Sales Rep',         color: '#059669', bg: '#ECFDF5', border: '#A7F3D0', desc: 'CRM, quotations, sales orders, customer records. No purchasing or stock edits.' },
                    { role: 'Technical Lead',    color: '#0891B2', bg: '#ECFEFF', border: '#A5F3FC', desc: 'Assigns repair jobs, QA sign-off, refurbishment oversight. No accounting.' },
                    { role: 'Technician',        color: '#5B21B6', bg: '#F5F3FF', border: '#DDD6FE', desc: 'Works on assigned repair jobs only. Diagnosis, parts request, status updates.' },
                  ].map(r => (
                    <div key={r.role} className="rounded-xl p-4 border" style={{ background: r.bg, borderColor: r.border }}>
                      <p className="text-[11px] font-bold mb-1.5" style={{ color: r.color }}>{r.role}</p>
                      <p className="text-[11px] text-gray-500 leading-relaxed">{r.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════ CRM ════ */}
          {section === 'crm' && (
            <>
              <SectionCard title="Core">
                <SettingRow label="Enable Leads & Opportunities" desc="Track customer enquiries through a sales pipeline"><Toggle on={ss.crmLeads} onChange={v => updateSystemSettings({ crmLeads: v })} /></SettingRow>
                <SettingRow label="Lead Scoring" desc="Auto-score leads based on behaviour and attributes"><Toggle on={ss.crmLeadScoring} onChange={v => updateSystemSettings({ crmLeadScoring: v })} /></SettingRow>
                <SettingRow label="Tags & Source Tracking" desc="Label leads by source — WhatsApp, walk-in, referral, etc."><Toggle on={ss.crmTags} onChange={v => updateSystemSettings({ crmTags: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Pipeline Stages">
                <div className="py-3">
                  <p className="text-[11px] text-gray-400 mb-3">These stages drive the CRM pipeline.</p>
                  <TagEditor tags={ss.crmPipelineStages} onChange={v => updateSystemSettings({ crmPipelineStages: v })} placeholder="Add stage…" />
                </div>
              </SectionCard>
              <SectionCard title="Activities & Automation">
                <SettingRow label="Enforce: Next Activity Required" desc="No opportunity can sit without a scheduled follow-up"><Toggle on={ss.crmEnforceNextActivity} onChange={v => updateSystemSettings({ crmEnforceNextActivity: v })} /></SettingRow>
                <SettingRow label="Auto-assign Leads" desc="Round-robin assignment to available sales reps"><Toggle on={ss.crmAutoAssignLeads} onChange={v => updateSystemSettings({ crmAutoAssignLeads: v })} /></SettingRow>
                <SettingRow label="Auto Follow-up after Quote Sent" desc="Create a follow-up task 2 days after a quote is sent"><Toggle on={ss.crmAutoFollowUpAfterQuote} onChange={v => updateSystemSettings({ crmAutoFollowUpAfterQuote: v })} /></SettingRow>
              </SectionCard>
            </>
          )}

          {/* ════ SALES ════ */}
          {section === 'sales' && (
            <>
              <SectionCard title="Quotations">
                <SettingRow label="Quotation Templates" desc="Save and reuse standard quote layouts"><Toggle on={ss.salesQuotationTemplates} onChange={v => updateSystemSettings({ salesQuotationTemplates: v })} /></SettingRow>
                <SettingRow label="Optional Products" desc="Include optional line items on quotes for customer selection"><Toggle on={ss.salesOptionalProducts} onChange={v => updateSystemSettings({ salesOptionalProducts: v })} /></SettingRow>
                <SettingRow label="Digital Signature" desc="Require customer e-signature on confirmed orders"><Toggle on={ss.salesDigitalSignature} onChange={v => updateSystemSettings({ salesDigitalSignature: v })} /></SettingRow>
                <SettingRow label="Online Acceptance" desc="Customer can approve quotes via a shareable link"><Toggle on={ss.salesOnlineAcceptance} onChange={v => updateSystemSettings({ salesOnlineAcceptance: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Pricing">
                <SettingRow label="Enable Pricelists" desc="Multiple pricing tiers per customer segment or volume"><Toggle on={ss.salesPricelists} onChange={v => updateSystemSettings({ salesPricelists: v })} /></SettingRow>
                <SettingRow label="Discount Control" desc="Require manager approval for discounts above a threshold"><Toggle on={ss.salesDiscountControl} onChange={v => updateSystemSettings({ salesDiscountControl: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Orders">
                <SettingRow label="Confirmed Quotes → Sales Orders" desc="Mandatory flow: quote must be confirmed before becoming an order"><Toggle on={ss.salesConfirmedQuotesToOrders} onChange={v => updateSystemSettings({ salesConfirmedQuotesToOrders: v })} /></SettingRow>
              </SectionCard>
            </>
          )}

          {/* ════ INVENTORY ════ */}
          {section === 'inventory' && (
            <>
              <SectionCard title="Core Rules">
                <SettingRow label="Products Created in Inventory Only" desc="Prevent ad-hoc product creation from Sales, POS, or Purchases"><Toggle on={ss.invProductsMasterOnly} onChange={v => updateSystemSettings({ invProductsMasterOnly: v })} /></SettingRow>
                <SettingRow label="No Direct Stock Edits" desc="Stock can only change via validated inventory operations"><Toggle on={ss.invNoDirectStockEdits} onChange={v => updateSystemSettings({ invNoDirectStockEdits: v })} /></SettingRow>
                <SettingRow label="Multi-Step Routes" desc="Receipt → Quality Check → Stock (vs. direct to stock)"><Toggle on={ss.invMultiStepRoutes} onChange={v => updateSystemSettings({ invMultiStepRoutes: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Storage Locations">
                <div className="py-3"><TagEditor tags={ss.invStorageLocations} onChange={v => updateSystemSettings({ invStorageLocations: v })} placeholder="Add location…" /></div>
              </SectionCard>
              <SectionCard title="Tracking">
                <SettingRow label="Serial Number Tracking" desc="Track individual units — laptops, CPUs, phones by serial"><Toggle on={ss.invSerialNumbers} onChange={v => updateSystemSettings({ invSerialNumbers: v })} /></SettingRow>
                <SettingRow label="Lot Tracking" desc="Track batches of accessories or consumables"><Toggle on={ss.invLots} onChange={v => updateSystemSettings({ invLots: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Valuation">
                <SettingRow label="Automated Inventory Valuation" desc="Auto-compute stock value on every movement"><Toggle on={ss.invAutomatedValuation} onChange={v => updateSystemSettings({ invAutomatedValuation: v })} /></SettingRow>
                <SettingRow label="Costing Method" desc="How unit cost is determined for stock valuation">
                  <Select value={ss.invCostingMethod} onChange={v => updateSystemSettings({ invCostingMethod: v as any })} options={[
                    { value: 'fifo',     label: 'FIFO (recommended)' },
                    { value: 'average',  label: 'Average Cost' },
                    { value: 'standard', label: 'Standard Price' },
                  ]} />
                </SettingRow>
              </SectionCard>
            </>
          )}

          {/* ════ PURCHASE ════ */}
          {section === 'purchase' && (
            <>
              <SectionCard title="Core Flow">
                <SettingRow label="Purchase Agreements" desc="Framework agreements with vendors (blanket orders)"><Toggle on={ss.purPurchaseAgreements} onChange={v => updateSystemSettings({ purPurchaseAgreements: v })} /></SettingRow>
                <SettingRow label="Vendor Pricelists" desc="Store and apply vendor-specific pricing per product"><Toggle on={ss.purVendorPricelists} onChange={v => updateSystemSettings({ purVendorPricelists: v })} /></SettingRow>
                <SettingRow label="Enforce RFQ → PO → Receipt → Bill" desc="Full purchase flow — no skipping steps"><Toggle on={ss.purEnforceRFQFlow} onChange={v => updateSystemSettings({ purEnforceRFQFlow: v })} /></SettingRow>
                <SettingRow label="Store Vendor Lead Times" desc="Record expected delivery times per vendor and product"><Toggle on={ss.purStoreLeadTimes} onChange={v => updateSystemSettings({ purStoreLeadTimes: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Approval Controls">
                <SettingRow label="Require Approval for High-Value Purchases" desc="Orders above the threshold need admin sign-off before confirming"><Toggle on={ss.purRequireApprovalHighValue} onChange={v => updateSystemSettings({ purRequireApprovalHighValue: v })} /></SettingRow>
                {ss.purRequireApprovalHighValue && (
                  <div className="pt-3 pb-2">
                    <Field label="High-Value Threshold (KES)">
                      <Input type="number" value={String(ss.purHighValueThreshold)} onChange={v => updateSystemSettings({ purHighValueThreshold: Number(v) })} />
                    </Field>
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* ════ REPAIR ════ */}
          {section === 'repair' && (
            <>
              <SectionCard title="Enable">
                <SettingRow label="Repair Orders" desc="Accept and track device repair jobs end-to-end"><Toggle on={ss.repRepairOrders} onChange={v => updateSystemSettings({ repRepairOrders: v })} /></SettingRow>
                <SettingRow label="Warranty Tracking" desc="Flag and handle repairs that fall within the warranty period"><Toggle on={ss.repWarrantyTracking} onChange={v => updateSystemSettings({ repWarrantyTracking: v })} /></SettingRow>
                <SettingRow label="Parts Consumption from Inventory" desc="Deduct parts used in repairs from stock automatically on completion"><Toggle on={ss.repPartsConsumption} onChange={v => updateSystemSettings({ repPartsConsumption: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Flow Enforcement">
                <SettingRow label="Enforce Repair Flow" desc="Check-in → Diagnosis → Approval → Repair → QC → Release — steps cannot be skipped"><Toggle on={ss.repEnforceFlow} onChange={v => updateSystemSettings({ repEnforceFlow: v })} /></SettingRow>
                <SettingRow label="Only Assigned Technician Sees Job" desc="Technicians cannot view or edit repair jobs not assigned to them"><Toggle on={ss.repOnlyAssignedTechSeesJob} onChange={v => updateSystemSettings({ repOnlyAssignedTechSeesJob: v })} /></SettingRow>
                <SettingRow label="Admin / Lead Assigns Jobs" desc="Only admins and lead techs can assign repair jobs to technicians"><Toggle on={ss.repAdminAssignsJobs} onChange={v => updateSystemSettings({ repAdminAssignsJobs: v })} /></SettingRow>
              </SectionCard>
            </>
          )}

          {/* ════ ACCOUNTING ════ */}
          {section === 'accounting' && (
            <>
              <SectionCard title="Core Documents">
                <SettingRow label="Customer Invoices" desc="Issue invoices to customers for sales"><Toggle on={ss.accCustomerInvoices} onChange={v => updateSystemSettings({ accCustomerInvoices: v })} /></SettingRow>
                <SettingRow label="Vendor Bills" desc="Record supplier invoices as accounts payable"><Toggle on={ss.accVendorBills} onChange={v => updateSystemSettings({ accVendorBills: v })} /></SettingRow>
                <SettingRow label="Credit Notes" desc="Issue and receive credit notes for returns and adjustments"><Toggle on={ss.accCreditNotes} onChange={v => updateSystemSettings({ accCreditNotes: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Taxes">
                <SettingRow label="Enable VAT" desc="Apply VAT on sales and purchases"><Toggle on={ss.accVatEnabled} onChange={v => updateSystemSettings({ accVatEnabled: v })} /></SettingRow>
                {ss.accVatEnabled && (
                  <div className="pt-3 pb-2">
                    <Field label="VAT Rate (%) — Kenya standard is 16%">
                      <Input type="number" value={String(companySettings.vatRate)} onChange={v => updateCompanySettings({ vatRate: Number(v) })} />
                    </Field>
                  </div>
                )}
              </SectionCard>
              <SectionCard title="Payments & Journals">
                <SettingRow label="Bank Journals" desc="Record and reconcile payments through bank accounts"><Toggle on={ss.accBankJournals} onChange={v => updateSystemSettings({ accBankJournals: v })} /></SettingRow>
                <SettingRow label="M-Pesa Journals" desc="Record M-Pesa Paybill collections and disbursements"><Toggle on={ss.accMpesaJournals} onChange={v => updateSystemSettings({ accMpesaJournals: v })} /></SettingRow>
                <SettingRow label="Bank Reconciliation" desc="Match bank statements against system cashbook entries monthly"><Toggle on={ss.accReconciliation} onChange={v => updateSystemSettings({ accReconciliation: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Controls">
                <SettingRow label="Lock Dates After Period Closing" desc="Prevent edits to accounting entries in closed periods"><Toggle on={ss.accLockDates} onChange={v => updateSystemSettings({ accLockDates: v })} /></SettingRow>
                <SettingRow label="Approval Required for Refunds" desc="Refunds need admin or finance approval before processing"><Toggle on={ss.accApprovalForRefunds} onChange={v => updateSystemSettings({ accApprovalForRefunds: v })} /></SettingRow>
              </SectionCard>
            </>
          )}

          {/* ════ HR CONFIG ════ */}
          {section === 'hr_config' && (
            <>
              <SectionCard title="Enable">
                <SettingRow label="Attendance Tracking" desc="Clock-in / clock-out tracking per employee shift"><Toggle on={ss.hrAttendance} onChange={v => updateSystemSettings({ hrAttendance: v })} /></SettingRow>
                <SettingRow label="Leave Management" desc="Employees apply for leave via Self Service; HR approves here"><Toggle on={ss.hrLeaves} onChange={v => updateSystemSettings({ hrLeaves: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="Access Controls">
                <SettingRow label="Restrict Salary Information" desc="Only HR Admin and Finance can view salary, deductions, and payslip data"><Toggle on={ss.hrRestrictSalaryInfo} onChange={v => updateSystemSettings({ hrRestrictSalaryInfo: v })} /></SettingRow>
                <SettingRow label="Role-Based Visibility" desc="Employees in Self Service only see their own records — not company-wide data"><Toggle on={ss.hrRoleBasedVisibility} onChange={v => updateSystemSettings({ hrRoleBasedVisibility: v })} /></SettingRow>
              </SectionCard>
            </>
          )}

          {/* ════ POS ════ */}
          {section === 'pos' && (
            <div className="flex flex-col gap-4">
              <SectionCard title="Point of Sale Configuration">
                <SettingRow label="POS Session Control" desc="Require opening and closing a cash session for each shift"><Toggle on={ss.posSessionControl} onChange={v => updateSystemSettings({ posSessionControl: v })} /></SettingRow>
                <SettingRow label="Cash Control" desc="Count cash at session open and close; track discrepancies"><Toggle on={ss.posCashControl} onChange={v => updateSystemSettings({ posCashControl: v })} /></SettingRow>
                <SettingRow label="Receipt Printing" desc="Auto-generate a receipt after each POS sale"><Toggle on={ss.posReceiptPrinting} onChange={v => updateSystemSettings({ posReceiptPrinting: v })} /></SettingRow>
              </SectionCard>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3 border-b border-gray-50 gap-3 sm:gap-0">
                  <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest">Daily Shift Summary</p>
                  <ExportButtons
                    title="POS Daily Shift Summary"
                    filename="pos_shift_summary"
                    headers={['Date', 'Orders', 'Cash (KES)', 'M-Pesa (KES)', 'Card (KES)', 'Total Revenue (KES)']}
                    rows={posDailySummary.map(s => [fmtDate(s.date), s.count, s.cash, s.mpesa, s.card, s.total])}
                  />
                </div>

                {/* Mobile POS cards */}
                <div className="sm:hidden divide-y divide-gray-50">
                  {posDailySummary.length === 0 ? (
                    <div className="py-10 text-center text-[12px] text-gray-400">No POS transactions recorded</div>
                  ) : posDailySummary.map(s => (
                    <div key={s.date} className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold text-[12px] text-gray-800">{fmtDate(s.date)}</p>
                        <span className="text-[11px] text-gray-400">{s.count} orders</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[{ label: 'Cash', val: s.cash, c: '#6B7280' }, { label: 'M-Pesa', val: s.mpesa, c: '#059669' }, { label: 'Card', val: s.card, c: '#2563EB' }].map(x => (
                          <div key={x.label} className="rounded-lg bg-gray-50 px-2 py-2">
                            <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">{x.label}</p>
                            <p className="font-mono text-[11px] font-bold mt-0.5" style={{ color: x.c }}>{fmtKes(x.val)}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-gray-50 flex justify-between items-center">
                        <span className="text-[11px] text-gray-400">Total</span>
                        <span className="font-mono font-bold text-[13px] text-emerald-600">{fmtKes(s.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop POS table */}
                <div className="hidden sm:block">
                  <Table cols={[
                    { label: 'Date', width: '1fr' },
                    { label: 'Orders', width: '0.7fr' },
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
                        <span className="text-gray-500">{s.count}</span>
                        <span className="font-mono text-t2">{fmtKes(s.cash)}</span>
                        <span className="font-mono text-t2">{fmtKes(s.mpesa)}</span>
                        <span className="font-mono text-t2">{fmtKes(s.card)}</span>
                        <span className="font-mono font-bold text-emerald-600">{fmtKes(s.total)}</span>
                      </div>
                    ))}
                  </Table>
                </div>
              </div>
            </div>
          )}

          {/* ════ SECURITY ════ */}
          {section === 'security' && (
            <>
              <SectionCard title="Data Protection">
                <SettingRow label="Disable Product Deletion" desc="Products can be archived but never permanently deleted — preserves history"><Toggle on={ss.secDisableProductDeletion} onChange={v => updateSystemSettings({ secDisableProductDeletion: v })} /></SettingRow>
                <SettingRow label="Disable Manual Stock Manipulation" desc="Stock levels can only change through validated inventory operations"><Toggle on={ss.secDisableStockManipulation} onChange={v => updateSystemSettings({ secDisableStockManipulation: v })} /></SettingRow>
                <SettingRow label="Lock Invoices After Validation" desc="Validated invoices cannot be edited — corrections require a credit note"><Toggle on={ss.secDisableInvoiceEditAfterValidation} onChange={v => updateSystemSettings({ secDisableInvoiceEditAfterValidation: v })} /></SettingRow>
              </SectionCard>
              <SectionCard title="System Rules">
                <div className="py-1">
                  {[
                    { rule: '1', text: 'Products are created in Inventory and referenced from Sales, Purchase, POS, and Repairs — never duplicated.' },
                    { rule: '2', text: 'No duplicate data entry across modules. One record, many references.' },
                    { rule: '3', text: 'Every sale must trace back to a stock movement, an invoice, and a payment.' },
                    { rule: '4', text: 'Every repair must trace the device, assigned technician, parts consumed, and final outcome.' },
                  ].map(r => (
                <div key={r.rule} className="flex gap-2 sm:gap-3 py-3.5 border-b border-gray-50 last:border-0 items-start">
                      <span className="w-5 h-5 rounded-full bg-[#EEF2FF] text-[#1B2762] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{r.rule}</span>
                      <span className="text-[12px] text-gray-500 leading-relaxed">{r.text}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="Role Permissions">
                <div className="py-1">
                  {[
                    { role: 'Admin',       perms: 'Full system access including destructive operations and settings' },
                    { role: 'Finance',     perms: 'Accounting, payroll approval, bank recon — no HR records or repairs' },
                    { role: 'Lead Tech',   perms: 'Assign and manage repairs, view inventory — no accounting' },
                    { role: 'Repair Tech', perms: 'Own assigned jobs only — no pricing, invoicing, or other modules' },
                    { role: 'Sales Rep',   perms: 'Sales, CRM, POS, Contacts — no finance, HR, or stock edits' },
                  ].map(r => (
                    <div key={r.role} className="flex gap-3 py-3.5 border-b border-gray-50 last:border-0 items-start">
                      <span className="w-20 sm:w-24 text-[11px] font-bold text-gray-700 flex-shrink-0">{r.role}</span>
                      <span className="text-[11.5px] text-gray-500 leading-relaxed">{r.perms}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Currency">
              <Select value={bankForm.currency} onChange={v => setBankForm(p => ({ ...p, currency: v }))} options={[
                { value: 'KES', label: 'KES' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' },
              ]} />
            </Field>
            <Field label="Opening Date"><Input type="date" value={bankForm.openingDate} onChange={v => setBankForm(p => ({ ...p, openingDate: v }))} /></Field>
          </div>
          <Field label="Opening Balance (KES)"><Input type="number" value={bankForm.openingBalance} onChange={v => setBankForm(p => ({ ...p, openingBalance: v }))} /></Field>
          <div className="flex justify-end gap-2 mt-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full Name" required><Input value={userForm.name} onChange={v => setUserForm(p => ({ ...p, name: v }))} /></Field>
            <Field label="Username" required><Input value={userForm.username} onChange={v => setUserForm(p => ({ ...p, username: v }))} maxLength={50} pattern="^[a-zA-Z0-9_\-\.]+$" /></Field>
            <Field label="Role" required>
              <Select value={userForm.role} onChange={v => setUserForm(p => ({ ...p, role: v }))} options={roleOptions} />
            </Field>
            <Field label="Status">
              <Select value={userForm.active ? 'active' : 'inactive'} onChange={v => setUserForm(p => ({ ...p, active: v === 'active' }))} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={userForm.id ? 'Reset Password' : 'Password'} required={!userForm.id} hint={userForm.id ? 'Leave blank to keep current.' : 'Min 6 characters.'}>
                <Input type="password" value={userForm.password} onChange={v => setUserForm(p => ({ ...p, password: v }))} placeholder={userForm.id ? 'Optional new password' : 'Temporary password'} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Allowed Modules" required hint="Users can only enter modules enabled here.">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 rounded-xl border p-3" style={{ borderColor: '#E5E7EB', background: '#F9FAFB' }}>
                  {moduleOptions.map(opt => {
                    const sel = userForm.modules.includes(opt.value)
                    return (
                      <button key={opt.value} type="button" onClick={() => toggleUserModule(opt.value)}
                        className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-all cursor-pointer"
                        style={{ borderColor: sel ? '#A8D4E8' : '#E5E7EB', background: sel ? '#E8F3FA' : '#FFF', color: sel ? '#1B2762' : '#6B7280', fontWeight: sel ? 600 : 400 }}>
                        <span className="truncate">{opt.label}</span>
                        <Fa icon={sel ? faCheck : faPlus} style={{ fontSize: sel ? 10 : 9, flexShrink: 0, marginLeft: 4 }} />
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
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
