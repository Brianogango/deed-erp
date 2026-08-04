'use client'
import { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react'
import { useApp, fmtKes, fmtDate, ALL_CATEGORIES, type CategoryId } from '@/lib/store'
import { calcSalePriceFromCost } from '@/lib/sale-price-calculator'
import { useHrStore } from '@/hooks/useHrStore'
import { Badge, Confirm, Field, Input, Modal, ModuleSkeleton, PanelHeader, Select, Textarea, ExportButtons, useMounted } from '@/components/ui'
import { ModuleChrome } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { MODULE_IDS, USER_ROLES } from '@/lib/auth/types'
import { formatRoleLabel, isAdmin } from '@/lib/auth/access'
import { Fa } from '@/components/icons'
import {
  faBuilding, faUsers, faBriefcase, faBoxesStacked, faCartShopping,
  faScrewdriverWrench, faLandmark, faUserGroup, faCashRegister, faShieldHalved,
  faPlus, faCheck, faUpload, faBullseye, faChevronRight, faCog, faKey, faEnvelope,
} from '@fortawesome/free-solid-svg-icons'
import PartnerApiKeys from './settings/PartnerApiKeys'
import ApprovalRulesEditor from './settings/ApprovalRulesEditor'
import {
  BlobCutoverPanel,
  CurrencyRatesEditor,
  PricelistsPanel,
} from './settings/CurrencyPricelistCutover'
import { readGuardedImageAsDataUrl } from '@/lib/client-image-guard'
import { resolveSettingsSection } from '@/lib/dashboard-priority'
type Section =
  | 'general' | 'banks' | 'access' | 'email'
  | 'crm' | 'sales' | 'inventory' | 'purchase' | 'repair'
  | 'accounting' | 'hr_config' | 'pos' | 'security' | 'partner_api' | 'data_cutover'

type UserFormState = {
  id: string; employeeId: string; username: string; name: string; role: string
  modules: string[]; active: boolean; password: string
}
const blankUser: UserFormState = {
  id: '', employeeId: '', username: '', name: '', role: 'sales_rep', modules: ['dashboard'], active: true, password: '',
}

const SettingLabelContext = createContext('setting')

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const label = useContext(SettingLabelContext)
  return (
    <button
      type="button"
      aria-label={`${on ? 'Disable' : 'Enable'} ${label}`}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-[22px] w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-navy-500 focus:ring-offset-1 ${on ? 'bg-navy-500' : 'bg-gray-200'}`}
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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3.5 border-b border-gray-50 last:border-0 gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-gray-800 leading-tight">{label}</p>
        {desc && <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <SettingLabelContext.Provider value={label}>
        <div className="flex-shrink-0 self-start sm:self-auto">{children}</div>
      </SettingLabelContext.Provider>
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
          <span key={i} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-[var(--info-bg)] text-navy-500 border border-[#C7D2FE] font-medium">
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#C7D2FE] hover:bg-[#A5B4FC] text-navy-500 border-none cursor-pointer leading-none text-[10px] font-bold outline-none transition-colors"
              onClick={() => onChange(tags.filter((_, j) => j !== i))}
            >×</button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[11px] text-gray-400 italic">No items yet</span>}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          aria-label={placeholder.replace(/…$/, '')}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          className="flex-1 text-[12px] px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-navy-500 focus:ring-2 focus:ring-[#1B2762]/10 transition-all bg-white"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={add}
          className="text-[11px] px-4 py-2 bg-navy-500 hover:bg-navy-600 text-white border-none rounded-lg cursor-pointer font-semibold transition-colors whitespace-nowrap"
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

export default function Settings() {
  const mounted = useMounted()
  const {
    bankAccounts, updateBankAccount, addBankAccount, deleteBankAccount,
    companySettings, updateCompanySettings,
    systemSettings: ss, updateSystemSettings,
    users, currentUserId,
    createUser, updateUser, deleteUser, resendCredentials,
    unlockUser,
    posOrders,
    showToast,
  } = useApp()
  const { employees, updateEmployee } = useHrStore()

  // Deep links (?tab= / ?section=) land on the right section — e.g. the
  // dashboard's Active Users card links to /settings?tab=users → 'access'.
  const [section, setSection] = useState<Section>(() => {
    if (typeof window === 'undefined') return 'general'
    const params = new URLSearchParams(window.location.search)
    return resolveSettingsSection(params.get('tab') ?? params.get('section')) as Section
  })

  const [bankForm, setBankForm] = useState({ name: '', bankName: '', accountNo: '', currency: 'KES', openingBalance: '0', openingDate: new Date().toISOString().slice(0, 10) })
  const [editingBankId, setEditingBankId] = useState<string | null>(null)
  const [showBankModal, setShowBankModal] = useState(false)

  const [userForm, setUserForm] = useState<UserFormState>(blankUser)
  const [showUserModal, setShowUserModal] = useState(false)
  const [savingUser, setSavingUser] = useState(false)
  const [syncingDB, setSyncingDB] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; action: () => void } | null>(null)
  const [resetStep, setResetStep] = useState(0)
  const [emailStatus, setEmailStatus] = useState<{
    ready: boolean
    provider: string
    nodeEnv: string
    fromDefault: string
    mailboxes: Array<{ id: string; from: string; authConfigured: boolean }>
    missing: string[]
    hints: string[]
  } | null>(null)
  const [emailStatusLoading, setEmailStatusLoading] = useState(false)
  const [testEmailTo, setTestEmailTo] = useState('')
  const [testMailbox, setTestMailbox] = useState('default')
  const [sendingTestEmail, setSendingTestEmail] = useState(false)

  const loadEmailStatus = useCallback(async () => {
    setEmailStatusLoading(true)
    try {
      const res = await fetch('/api/integrations/email-status')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showToast(data.error || data.message || 'Could not load email status', 'error')
        return
      }
      setEmailStatus(data.status)
      setTestEmailTo(prev => prev || companySettings.email || '')
    } catch {
      showToast('Could not reach email status API', 'error')
    } finally {
      setEmailStatusLoading(false)
    }
  }, [companySettings.email, showToast])

  const sendTestEmail = async () => {
    setSendingTestEmail(true)
    try {
      const res = await fetch('/api/integrations/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmailTo.trim(), mailbox: testMailbox }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        showToast(data.error || data.message || 'Test email failed', 'error')
        if (data.status) setEmailStatus(data.status)
        return
      }
      if (data.status) setEmailStatus(data.status)
      showToast(`Test email sent to ${testEmailTo.trim()}`, 'success')
    } catch {
      showToast('Could not send test email', 'error')
    } finally {
      setSendingTestEmail(false)
    }
  }

  useEffect(() => {
    if (section === 'email') void loadEmailStatus()
  }, [section, loadEmailStatus])
  const [resetPhrase, setResetPhrase] = useState('')

  const MIGRATION_CONFIRMATION = 'MIGRATE DEED ERP DATA'
  const RESET_CONFIRMATION = 'RESET DEED ERP PRODUCTION DATA'

  const currentUser = users.find(user => user.id === currentUserId)
  const canManageSystemUsers = isAdmin(currentUser?.role)

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

  const sanitizeUsername = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9_.-]+/g, '.').replace(/^\.+|\.+$/g, '')
  const buildEmployeeUsername = (employee: typeof employees[number]) => {
    const base = employee.email?.split('@')[0] || employee.employeeNo || employee.fullName || employee.id
    return sanitizeUsername(base) || sanitizeUsername(employee.id)
  }
  const employeeHasUser = (employee: typeof employees[number]) => {
    const username = buildEmployeeUsername(employee)
    return users.some(user => user.username === username || user.name.toLowerCase() === employee.fullName.toLowerCase())
  }
  const selectableEmployees = employees
    .filter(employee => employee.status === 'active' && (!employeeHasUser(employee) || employee.id === userForm.employeeId))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
  const employeeOptions = selectableEmployees.map(employee => ({
    value: employee.id,
    label: `${employee.fullName}${employee.employeeNo ? ` (${employee.employeeNo})` : ''}${employee.email ? ` · ${employee.email}` : ''}`,
  }))
  const selectEmployeeForUser = (employeeId: string) => {
    const employee = employees.find(e => e.id === employeeId)
    if (!employee) {
      setUserForm(p => ({ ...p, employeeId, username: '', name: '', password: '' }))
      return
    }
    setUserForm(p => ({
      ...p,
      employeeId,
      username: buildEmployeeUsername(employee),
      name: employee.fullName,
      password: '',
    }))
  }

  const toggleUserModule = (mid: string) => {
    setUserForm(p => {
      const has = p.modules.includes(mid)
      const modules = has ? p.modules.filter(m => m !== mid) : [...p.modules, mid]
      return { ...p, modules: modules.length > 0 ? modules : ['dashboard'] }
    })
  }
  const saveUser = async () => {
    if (!canManageSystemUsers) {
      showToast('Only the Director can create, edit, or update system users.', 'error')
      return
    }
    try {
      setSavingUser(true)
      const selectedEmployee = userForm.id ? null : employees.find(e => e.id === userForm.employeeId)
      const username = userForm.id ? userForm.username.trim() : ''
      const name = userForm.id ? userForm.name.trim() : ''
      const password = userForm.id ? userForm.password : ''
      const payload = { username, name, role: userForm.role as any, modules: userForm.modules as any, active: userForm.active, ...(password ? { password } : {}) }
      if (!userForm.id && !selectedEmployee) {
        showToast('Select an existing active employee first.', 'error'); return
      }

      if (payload.modules.length === 0 || (userForm.id && (!payload.username || !payload.name))) {
        showToast('Complete all required fields (employee, role, and modules).', 'error'); return
      }
      if (userForm.id) await updateUser(userForm.id, payload)
      else {
        const user = await createUser({ employeeId: selectedEmployee!.id, role: payload.role, modules: payload.modules, active: true })
        if (selectedEmployee) updateEmployee(selectedEmployee.id, { userId: user.id })
      }
      setShowUserModal(false); setUserForm(blankUser)
    } finally { setSavingUser(false) }
  }
  const removeUser = (userId: string) => {
    if (!canManageSystemUsers) {
      showToast('Only the Director can delete system users.', 'error')
      return
    }
    const user = users.find(u => u.id === userId)
    if (!user) return
    setPendingConfirm({ msg: `Delete user "${user.username}"? This is irreversible.`, action: () => void deleteUser(userId) })
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

  const handleForceSync = () => {
    if (!canManageSystemUsers) {
      showToast('Only the Director or an administrator can run data migration.', 'error')
      return
    }
    const phrase = window.prompt(`Type ${MIGRATION_CONFIRMATION} to confirm this database migration.`)
    if (phrase?.trim() !== MIGRATION_CONFIRMATION) {
      showToast('Migration cancelled: typed confirmation did not match.', 'error')
      return
    }
    setPendingConfirm({
      msg: 'This will upload all local browser data to the PostgreSQL database and overwrite matching deed_ state keys. Continue?',
      action: async () => {
        setSyncingDB(true)
        try {
          const payload: Record<string, string> = {}
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && key.startsWith('deed_')) payload[key] = localStorage.getItem(key) || ''
          }
          const res = await fetch('/api/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-deed-confirmation': MIGRATION_CONFIRMATION },
            body: JSON.stringify(payload),
          })
          if (res.ok) showToast('Migration successful! All data is now in Postgres.', 'success')
          else showToast('Failed to sync. Please check the server logs.', 'error')
        } catch { showToast('An error occurred during migration.', 'error') }
        finally { setSyncingDB(false) }
      },
    })
  }

  const doResetAllData = async (confirmationPhrase = resetPhrase) => {
    const confirmation = confirmationPhrase.trim()
    if (confirmation !== RESET_CONFIRMATION) {
      showToast('Reset cancelled: typed confirmation did not match.', 'error')
      return
    }
    setResetting(true)
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      })
      if (!res.ok) { showToast('Server reset failed. Check logs.', 'error'); return }
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('deed_')) keys.push(k)
      }
      keys.forEach(k => localStorage.removeItem(k))
      showToast('All data has been cleared. Reloading…', 'success')
      window.location.reload()
    } catch { showToast('An error occurred during reset.', 'error') }
    finally { setResetting(false) }
  }

  const handleResetAllData = () => {
    if (!canManageSystemUsers || currentUser?.role !== 'director') {
      showToast('Only the Director can reset all ERP data.', 'error')
      return
    }
    setResetPhrase('')
    setResetStep(1)
  }

  const roleOptions = USER_ROLES.map(r => ({ value: r, label: formatRoleLabel(r) }))
  const moduleOptions = MODULE_IDS.map(m => ({ value: m, label: m === 'pos' ? 'Point of Sale' : formatRoleLabel(m) }))

  const nav: { id: Section; label: string; icon: any; group?: string }[] = [
    { id: 'general',    label: 'General',       icon: faBuilding,        group: 'Company' },
    { id: 'banks',      label: 'Bank Accounts', icon: faLandmark,        group: 'Company' },
    { id: 'access',     label: 'User Access',   icon: faUsers,           group: 'Company' },
    { id: 'email',      label: 'Email / SMTP',  icon: faEnvelope,        group: 'Company' },
    { id: 'crm',        label: 'CRM',           icon: faBullseye,        group: 'Modules' },
    { id: 'sales',      label: 'Sales',         icon: faBriefcase,       group: 'Modules' },
    { id: 'inventory',  label: 'Inventory',     icon: faBoxesStacked,    group: 'Modules' },
    { id: 'purchase',   label: 'Purchase',      icon: faCartShopping,    group: 'Modules' },
    { id: 'repair',     label: 'Repairs',       icon: faScrewdriverWrench, group: 'Modules' },
    { id: 'accounting', label: 'Accounting',    icon: faLandmark,        group: 'Modules' },
    { id: 'hr_config',  label: 'HR',            icon: faUserGroup,       group: 'Modules' },
    { id: 'pos',        label: 'Point of Sale', icon: faCashRegister,    group: 'Modules' },
    { id: 'security',   label: 'Security',      icon: faShieldHalved, group: 'System' },
    ...(canManageSystemUsers ? [{ id: 'data_cutover' as Section, label: 'Data Cutover', icon: faShieldHalved, group: 'System' }] : []),
    ...(canManageSystemUsers ? [{ id: 'partner_api' as Section, label: 'Partner API', icon: faKey, group: 'System' }] : []),
  ]

  const activeNav = nav.find(n => n.id === section)

  if (!mounted) return <ModuleSkeleton />

  const roleBadgeStyle = (role: string) => {
    if (role === 'director')     return { bg: 'var(--navy)', color: '#fff',     border: 'var(--navy)' }
    if (role === 'finance_officer') return { bg: 'var(--warning-bg)', color: 'var(--warning-text)', border: '#FDE68A' }
    if (role === 'technical_lead')  return { bg: '#ECFDF5', color: 'var(--success-text)', border: '#A7F3D0' }
    if (role === 'technician')      return { bg: '#F5F3FF', color: '#5B21B6', border: '#DDD6FE' }
    if (role === 'sales_rep')    return { bg: 'var(--info-bg)', color: 'var(--primary-dark)', border: '#BFDBFE' }
    return                              { bg: 'var(--bg-muted)', color: 'var(--text-3)', border: 'var(--border-lt)' }
  }

  return (
    <ModuleChrome
      title="System settings"
      subtitle="Configure company info, users, and module behaviour"
      icon={<Fa icon={faCog} />}
    >
      <div className="p-4 sm:p-5 pb-16">
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
                        ? 'bg-navy-500 text-white shadow-sm'
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
                    ? 'bg-navy-500 text-white border-transparent shadow-sm'
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
                <div className="w-7 h-7 rounded-lg bg-[var(--info-bg)] flex items-center justify-center">
                  <Fa icon={activeNav.icon} style={{ fontSize: 12, color: 'var(--navy)' }} />
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
                      : <Fa icon={faBuilding} style={{ fontSize: 22, color: 'var(--border)' }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer transition-colors">
                      <Fa icon={faUpload} style={{ fontSize: 9 }} /> Upload Logo
                      <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={async e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        try {
                          const dataUrl = await readGuardedImageAsDataUrl(file, { label: 'Company logo', maxBytes: 2 * 1024 * 1024, maxPixels: 12_000_000 })
                          updateCompanySettings({ logoUrl: dataUrl })
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : 'Company logo could not be validated', 'error')
                        } finally {
                          e.target.value = ''
                        }
                      }} />
                    </label>
                    {companySettings.logoUrl && (
                      <button className="block text-[10px] mt-1.5 text-red-400 hover:text-red-600 bg-transparent border-none cursor-pointer p-0 transition-colors" onClick={() => updateCompanySettings({ logoUrl: '' })}>Remove</button>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">JPG, PNG, or WebP · max 2 MB · shown on invoices &amp; PDFs</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3">
                  <Field label="Company Name"><Input value={companySettings.name} onChange={v => updateCompanySettings({ name: v })} /></Field>
                  <Field label="KRA PIN"><Input value={companySettings.kraPin} onChange={v => updateCompanySettings({ kraPin: v })} /></Field>
                  <Field label="Phone"><Input value={companySettings.phone} type="tel" onChange={v => updateCompanySettings({ phone: v })} maxLength={20} /></Field>
                  <Field label="Email"><Input value={companySettings.email} type="email" onChange={v => updateCompanySettings({ email: v })} maxLength={100} /></Field>
                  <Field label="Website"><Input value={companySettings.website} onChange={v => updateCompanySettings({ website: v })} /></Field>
                  <div className="sm:col-span-2">
                    <CurrencyRatesEditor
                      canWrite={currentUser?.role === 'director' || currentUser?.role === 'finance_officer'}
                      showToast={showToast}
                      companyCurrency={companySettings.currency}
                      onCompanyCurrencyChange={v => updateCompanySettings({ currency: v, functionalCurrency: 'KES' })}
                    />
                  </div>
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

              <SectionCard title="Document PDFs">
                <div className="py-3">
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Quotations, sales orders, pro-forma invoices, invoices and bills download as
                    clean PDF documents in a standard layout: company letterhead, customer block,
                    line items, totals, and a payment-details section. The layout automatically uses
                    the company logo, KRA PIN, contact details, bank account, M-Pesa, and footer
                    settings configured above.
                  </p>
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
                    className="text-[11px] font-semibold px-4 py-2 rounded-lg bg-navy-500 hover:bg-navy-600 text-white border-none cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap"
                    onClick={handleForceSync} disabled={syncingDB || !canManageSystemUsers}
                  >
                    {syncingDB ? 'Syncing…' : 'Start Migration'}
                  </button>
                </SettingRow>
                <SettingRow label="Reset All Data" desc="Permanently delete all business data from the database and this browser. User accounts are kept. Cannot be undone.">
                  <button
                    className="text-[11px] font-semibold px-4 py-2 rounded-lg border-none cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap"
                    style={{ background: resetting ? 'var(--border-strong)' : 'var(--danger)', color: '#fff' }}
                    onClick={handleResetAllData} disabled={resetting || currentUser?.role !== 'director'}
                  >
                    {resetting ? 'Resetting…' : 'Reset All Data'}
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
                <button className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-navy-500 hover:bg-navy-600 text-white border-none cursor-pointer transition-colors" onClick={openAddBank}>+ Add Account</button>
              </div>

              <DataTable
                tableId="settings-bank-accounts"
                columns={[
                  { key: 'name', label: 'Account name', priority: 1, width: '1.4fr', render: a => <span className="font-semibold text-gray-900">{a.name}</span>, exportValue: a => a.name },
                  { key: 'bank', label: 'Bank', priority: 2, width: '1.3fr', render: a => <span className="text-[11px] text-gray-500">{a.bankName}</span>, exportValue: a => a.bankName },
                  { key: 'accountNo', label: 'Account no', priority: 2, width: '1.1fr', render: a => <span className="font-mono text-[11px] text-gray-500">{a.accountNo}</span>, exportValue: a => a.accountNo },
                  { key: 'currency', label: 'Currency', priority: 3, width: '0.5fr', render: a => <span className="text-[11px] text-gray-500">{a.currency}</span>, exportValue: a => a.currency },
                  { key: 'balance', label: 'Opening bal', priority: 1, width: '1fr', render: a => <span className="font-mono text-[12px] font-semibold text-gray-900">{fmtKes(a.openingBalance)}</span>, exportValue: a => a.openingBalance },
                  { key: 'status', label: 'Status', priority: 1, width: '0.6fr', render: a => <Badge status={a.active ? 'active' : 'cancelled'} label={a.active ? 'Active' : 'Inactive'} />, accessor: a => a.active ? 'Active' : 'Inactive', exportValue: a => a.active ? 'Active' : 'Inactive' },
                ] as ColumnDef<typeof bankAccounts[number]>[]}
                rows={bankAccounts}
                rowKey={a => a.id}
                searchPlaceholder="Search accounts…"
                emptyMessage="No bank accounts yet"
                emptyAction={<button className="text-[11px] font-semibold px-4 py-2 rounded-lg bg-navy-500 text-white border-none cursor-pointer" onClick={openAddBank}>Add your first account</button>}
                rowActions={a => (
                  <div className="flex gap-1.5">
                    <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-navy-500 border border-blue-100 cursor-pointer transition-colors" onClick={() => openEditBank(a.id)}>Edit</button>
                    <button className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border cursor-pointer transition-colors ${a.active ? 'bg-red-50 hover:bg-red-100 text-red-600 border-red-100' : 'bg-green-50 hover:bg-green-100 text-green-700 border-green-100'}`} onClick={() => updateBankAccount(a.id, { active: !a.active })}>{a.active ? 'Disable' : 'Enable'}</button>
                    <button className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 cursor-pointer transition-colors" onClick={() => setPendingConfirm({ msg: `Delete "${a.name}"?`, action: () => deleteBankAccount(a.id) })}>Del</button>
                  </div>
                )}
                exportTitle="Bank Accounts"
                exportFilename="bank-accounts"
              />
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
                  <button className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-navy-500 hover:bg-navy-600 text-white border-none cursor-pointer transition-colors" onClick={() => { setUserForm(blankUser); setShowUserModal(true) }}>+ Add User</button>
                </div>

                <DataTable
                  tableId="settings-users"
                  columns={[
                    { key: 'name', label: 'Name', priority: 1, width: '1.2fr', render: user => <span className="font-semibold text-gray-900">{user.name}</span>, exportValue: user => user.name },
                    { key: 'username', label: 'Username', priority: 2, width: '0.9fr', render: user => <span className="font-mono text-[11px] text-gray-500">@{user.username}</span>, exportValue: user => user.username },
                    {
                      key: 'role', label: 'Role', priority: 1, width: '0.9fr',
                      render: user => {
                        const rb = roleBadgeStyle(user.role)
                        return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border" style={{ background: rb.bg, color: rb.color, borderColor: rb.border }}>{formatRoleLabel(user.role)}</span>
                      },
                      accessor: user => formatRoleLabel(user.role),
                      exportValue: user => formatRoleLabel(user.role),
                    },
                    {
                      key: 'modules', label: 'Modules', priority: 3, width: '3fr',
                      render: user => {
                        const modules = Array.isArray(user.modules) ? user.modules : []
                        return (
                          <span className="flex gap-1 flex-wrap">
                            {modules.map(m => (
                              <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{m === 'pos' ? 'POS' : formatRoleLabel(m)}</span>
                            ))}
                          </span>
                        )
                      },
                      exportValue: user => (Array.isArray(user.modules) ? user.modules : []).join(', '),
                    },
                    {
                      key: 'status', label: 'Status', priority: 1, width: '0.55fr',
                      render: user => (
                        <span>
                          <Badge status={user.active ? 'active' : 'cancelled'} label={user.active ? 'on' : 'off'} />
                          {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() && (
                            <span className="ml-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border bg-orange-50 text-orange-600 border-orange-200">Locked</span>
                          )}
                        </span>
                      ),
                      accessor: user => user.active ? 'on' : 'off',
                      exportValue: user => user.active ? 'on' : 'off',
                    },
                  ] as ColumnDef<typeof users[number]>[]}
                  rows={users}
                  rowKey={u => u.id}
                  searchPlaceholder="Search users…"
                  emptyMessage="No users"
                  rowActions={user => (
                    <div className="flex gap-1.5 flex-wrap">
                      <button className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${canManageSystemUsers ? 'bg-blue-50 hover:bg-blue-100 text-navy-500 border-blue-100 cursor-pointer' : 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100'}`} disabled={!canManageSystemUsers} onClick={() => { if (!canManageSystemUsers) return; const u = users.find(x => x.id === user.id); if (!u) return; setUserForm({ id: u.id, employeeId: '', username: u.username, name: u.name, role: u.role, modules: Array.isArray(u.modules) ? [...u.modules] : [], active: u.active, password: '' }); setShowUserModal(true) }}>Edit</button>
                      {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now() && (
                        <button className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${canManageSystemUsers ? 'bg-orange-50 hover:bg-orange-100 text-orange-600 border-orange-100 cursor-pointer' : 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100'}`} disabled={!canManageSystemUsers} onClick={() => { if (!canManageSystemUsers) return; void unlockUser(user.id) }}>Unlock</button>
                      )}
                      <button className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${canManageSystemUsers ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-100 cursor-pointer' : 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100'}`} disabled={!canManageSystemUsers} onClick={() => { if (!canManageSystemUsers) return; setPendingConfirm({ msg: `Reset password for ${user.name}?`, action: () => void resendCredentials(user.id) }) }}>Resend</button>
                      <button className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${!canManageSystemUsers || user.id === currentUserId ? 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100' : 'bg-red-50 hover:bg-red-100 text-red-600 border-red-100 cursor-pointer'}`} disabled={!canManageSystemUsers || user.id === currentUserId} onClick={() => { void removeUser(user.id) }}>Del</button>
                    </div>
                  )}
                  exportTitle="System Users"
                  exportFilename="system-users"
                />
              </div>

              {/* Role capabilities */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
                <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-widest mb-4">Role Capabilities</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { role: 'Director',          color: '#fff',     bg: 'var(--navy)', border: 'var(--navy)', desc: 'Full access to all modules, approvals, settings, user management, and audit trail.' },
                    { role: 'Admin Officer',     color: 'var(--navy)', bg: 'var(--info-bg)', border: '#C7D2FE', desc: 'Process, master-data, workflow control, invoicing, quotations, sales orders, customer records, and purchases.' },
                    { role: 'Finance Officer',   color: 'var(--warning-text)', bg: 'var(--warning-bg)', border: '#FDE68A', desc: 'Invoicing, bills, payments, bank/cash, tax, reconciliation, reports, CRM, quotations, sales orders, settlements, purchases, and workflow control.' },
                    { role: 'Inventory Officer', color: '#C2410C', bg: '#FFF7ED', border: '#FED7AA', desc: 'Physical stock control — receives goods, transfers, counts. No accounting.' },
                    { role: 'Kilimall Officer',  color: '#7E22CE', bg: '#FDF4FF', border: '#E9D5FF', desc: 'Processes Kilimall orders, allocates stock, manages returns and settlement uploads.' },
                    { role: 'Sales Rep',         color: 'var(--success)', bg: '#ECFDF5', border: '#A7F3D0', desc: 'CRM, quotations, sales orders, customer records. No purchasing or stock edits.' },
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

          {/* ════ EMAIL / SMTP ════ */}
          {section === 'email' && (
            <>
              <SectionCard
                title="Outbound email status"
                action={
                  <button
                    type="button"
                    className="btn-secondary text-[11px]"
                    disabled={emailStatusLoading}
                    onClick={() => void loadEmailStatus()}
                  >
                    {emailStatusLoading ? 'Checking…' : 'Refresh'}
                  </button>
                }
              >
                {!emailStatus ? (
                  <p className="text-xs text-gray-500 py-3">Click Refresh to check production mail configuration.</p>
                ) : (
                  <div className="py-3 flex flex-col gap-3">
                    <div className={`rounded-xl border px-3 py-2 text-xs font-semibold ${emailStatus.ready ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                      {emailStatus.ready
                        ? `Ready — provider ${emailStatus.provider}`
                        : `Not ready — provider ${emailStatus.provider} (${emailStatus.nodeEnv})`}
                    </div>
                    <p className="text-[11px] text-gray-500">Default From: <span className="font-mono text-gray-800">{emailStatus.fromDefault}</span></p>
                    {emailStatus.missing.length > 0 && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                        <p className="text-[11px] font-bold text-red-700 mb-1">Missing on server (.env)</p>
                        <p className="text-[11px] font-mono text-red-800">{emailStatus.missing.join(', ')}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {emailStatus.mailboxes.map(box => (
                        <div key={box.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{box.id}</p>
                          <p className="text-[11px] font-mono text-gray-800 mt-0.5">{box.from}</p>
                          <p className={`text-[10px] font-semibold mt-1 ${box.authConfigured ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {box.authConfigured ? 'Auth configured' : 'Auth missing'}
                          </p>
                        </div>
                      ))}
                    </div>
                    {emailStatus.hints.map(hint => (
                      <p key={hint} className="text-[11px] text-gray-500">• {hint}</p>
                    ))}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] text-slate-700 leading-relaxed">
                      <p className="font-bold mb-1">Put this in Contabo <span className="font-mono">/var/www/deed-erp/.env</span> then restart PM2:</p>
                      <pre className="font-mono text-[10px] whitespace-pre-wrap overflow-x-auto">{`EMAIL_PROVIDER=smtp
EMAIL_FROM=info@deed.co.ke
SMTP_HOST=mail.deed.co.ke
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=info@deed.co.ke
SMTP_PASS=YOUR_MAILBOX_PASSWORD
HR_EMAIL=hr@deed.co.ke
HR_TEAM_EMAIL=hr@deed.co.ke
LEAVE_APPLY_CC_EMAILS=edwin@deed.co.ke,dennis@deed.co.ke
SALES_EMAIL=sales@deed.co.ke
ACCOUNTS_EMAIL=accounts@deed.co.ke`}</pre>
                      <p className="mt-2">Covers RFQ mail, sales quotes, invoices, user credentials, portal notices, and leave emails. Leave apply goes <span className="font-mono">To: HR_TEAM_EMAIL</span> and <span className="font-mono">Cc: LEAVE_APPLY_CC_EMAILS</span> (Edwin + Dennis). Approve/reject goes to the applier&apos;s HR employee email only. Quotes send <span className="font-mono">From/Reply-To: SALES_EMAIL</span> and invoices <span className="font-mono">From/Reply-To: ACCOUNTS_EMAIL</span> — those mailboxes must exist in cPanel (password can match <span className="font-mono">SMTP_PASS</span>, or set dedicated <span className="font-mono">*_SMTP_USER/PASS</span>).</p>
                    </div>
                  </div>
                )}
              </SectionCard>
              <SectionCard title="Send test email">
                <div className="py-3 flex flex-col gap-3">
                  <Field label="Send to">
                    <Input value={testEmailTo} onChange={setTestEmailTo} placeholder="you@deed.co.ke" type="email" />
                  </Field>
                  <Field label="Mailbox">
                    <Select
                      value={testMailbox}
                      onChange={setTestMailbox}
                      options={[
                        { value: 'default', label: 'Default / info' },
                        { value: 'sales', label: 'Sales' },
                        { value: 'accounts', label: 'Accounts' },
                        { value: 'hr', label: 'HR' },
                      ]}
                    />
                  </Field>
                  <button
                    type="button"
                    className="btn-primary text-xs self-start min-h-[44px]"
                    disabled={sendingTestEmail || !testEmailTo.trim()}
                    onClick={() => void sendTestEmail()}
                  >
                    {sendingTestEmail ? 'Sending…' : 'Send test email'}
                  </button>
                </div>
              </SectionCard>
            </>
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
                {ss.salesPricelists && <PricelistsPanel showToast={showToast} />}
              </SectionCard>
              <SectionCard title="Sales price calculator">
                <p className="text-[11.5px] text-gray-500 pt-2 pb-1 leading-relaxed">
                  Set a markup % per product category. Inventory then fills sale price from cost automatically:
                  {' '}<span className="font-mono text-[11px]">sale = cost × (1 + % ÷ 100)</span>, rounded to whole KES.
                  Leave a category blank to turn auto-calc off for it.
                </p>
                <div className="py-2 space-y-0">
                  {ALL_CATEGORIES.map(cat => {
                    const map = ss.invCategorySaleMarkupPct ?? {}
                    const raw = map[cat]
                    const value = raw === undefined || raw === null ? '' : String(raw)
                    const exampleCost = 10000
                    const exampleSale = value !== '' && Number.isFinite(Number(value))
                      ? calcSalePriceFromCost(exampleCost, Number(value))
                      : null
                    return (
                      <div key={cat} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 border-b border-gray-50 last:border-0">
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-semibold text-gray-800">{cat}</p>
                          <p className="text-[10.5px] text-gray-400 mt-0.5">
                            {exampleSale !== null
                              ? `Example: cost ${fmtKes(exampleCost)} → sale ${fmtKes(exampleSale)}`
                              : 'No markup — sale price stays manual'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Input
                            type="number"
                            value={value}
                            onChange={v => {
                              const next: Partial<Record<CategoryId, number>> = { ...(ss.invCategorySaleMarkupPct ?? {}) }
                              const trimmed = v.trim()
                              if (trimmed === '') {
                                delete next[cat]
                              } else {
                                const n = Number(trimmed)
                                if (!Number.isFinite(n)) return
                                next[cat] = n
                              }
                              updateSystemSettings({ invCategorySaleMarkupPct: next })
                            }}
                            placeholder="—"
                          />
                          <span className="text-[11px] font-semibold text-gray-400 w-4">%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </SectionCard>
              <SectionCard title="Approval Thresholds">
                <p className="text-[11px] text-gray-400 pt-2 pb-1">
                  Configurable ladders stored in Postgres. Hardcoded fallbacks remain if DB is offline — never loses approval coverage.
                </p>
                <ApprovalRulesEditor
                  canWrite={currentUser?.role === 'director' || currentUser?.role === 'finance_officer'}
                  showToast={showToast}
                />
              </SectionCard>
              <SectionCard title="Orders">
                <SettingRow label="Confirmed Quotes → Sales Orders" desc="Mandatory flow: quote must be confirmed before becoming an order"><Toggle on={ss.salesConfirmedQuotesToOrders} onChange={v => updateSystemSettings({ salesConfirmedQuotesToOrders: v })} /></SettingRow>
                <SettingRow label="Lock Confirmed Sales" desc="Confirmed sales orders are locked; only a director can unlock to edit, and every unlock is audited"><Toggle on={ss.salesLockConfirmed} onChange={v => updateSystemSettings({ salesLockConfirmed: v })} /></SettingRow>
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
                <SettingRow label="Automated Inventory Valuation" desc="Dual-write weighted-average cost + STK journals on validated GRNs and deliveries (Prisma). Blobs stay untouched."><Toggle on={ss.invAutomatedValuation} onChange={v => updateSystemSettings({ invAutomatedValuation: v })} /></SettingRow>
                <SettingRow label="Costing Method" desc="Average cost is the default. FIFO consumes oldest inventory batch layers when company or product costing is set to FIFO.">
                  <Select value={ss.invCostingMethod} onChange={v => updateSystemSettings({ invCostingMethod: v as any })} options={[
                    { value: 'average',  label: 'Average Cost (default)' },
                    { value: 'fifo',     label: 'FIFO (InventoryBatch layers on GRN/delivery)' },
                    { value: 'standard', label: 'Standard Price (not yet posted)' },
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
              <SectionCard title="Diagnosis Fee (Diagnosis First)">
                <p className="text-[11px] text-[var(--text-3)] px-1 pb-2 leading-relaxed">
                  Flat fee for walk-in and corporate Diagnosis First jobs received from <strong>3 Aug 2026, 3:00pm</strong> (EAT).
                  Earlier jobs are not charged. Not credited against labour or parts. Appears on the final invoice with the repair
                  (optional early collection allowed). Direct Repair (declined diagnosis) and full warranty are exempt. VAT is always 0%.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-1 pb-2">
                  <Field label="Diagnosis fee (KES)">
                    <Input
                      type="number"
                      value={String(ss.diagnosisFeeKes ?? ss.diagnosisFeeRegularKes ?? 1000)}
                      onChange={v => {
                        const n = Math.max(0, Number(v) || 0)
                        updateSystemSettings({ diagnosisFeeKes: n, diagnosisFeeRegularKes: n, diagnosisFeeHighEndKes: n })
                      }}
                    />
                  </Field>
                </div>
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
                <SettingRow label="Bank Reconciliation" desc="Available in Cashbook — match bank statements against system entries monthly"><Toggle on={ss.accReconciliation} onChange={v => updateSystemSettings({ accReconciliation: v })} /></SettingRow>
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

                <DataTable
                  tableId="settings-pos-summary"
                  columns={[
                    { key: 'date', label: 'Date', priority: 1, width: '1fr', render: s => <span className="font-semibold text-t1">{fmtDate(s.date)}</span>, exportValue: s => s.date },
                    { key: 'orders', label: 'Orders', priority: 1, width: '0.7fr', render: s => <span className="text-gray-500">{s.count}</span>, exportValue: s => s.count },
                    { key: 'cash', label: 'Cash (KES)', priority: 2, width: '1fr', render: s => <span className="font-mono text-t2">{fmtKes(s.cash)}</span>, exportValue: s => s.cash },
                    { key: 'mpesa', label: 'M-Pesa (KES)', priority: 2, width: '1fr', render: s => <span className="font-mono text-t2">{fmtKes(s.mpesa)}</span>, exportValue: s => s.mpesa },
                    { key: 'card', label: 'Card (KES)', priority: 3, width: '1fr', render: s => <span className="font-mono text-t2">{fmtKes(s.card)}</span>, exportValue: s => s.card },
                    { key: 'total', label: 'Total revenue', priority: 1, width: '1.2fr', render: s => <span className="font-mono font-bold text-emerald-600">{fmtKes(s.total)}</span>, exportValue: s => s.total },
                  ] as ColumnDef<typeof posDailySummary[number]>[]}
                  rows={posDailySummary}
                  rowKey={s => s.date}
                  hideSearch
                  emptyMessage="No POS transactions recorded"
                  exportTitle="POS Daily Shift Summary"
                  exportFilename="pos_shift_summary"
                />
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
                <SettingRow label="Require Phone Verification on Portal" desc="Customers must enter the phone number on file to approve quotes or confirm payment via the portal"><Toggle on={ss.secPortalRequirePhoneVerification} onChange={v => updateSystemSettings({ secPortalRequirePhoneVerification: v })} /></SettingRow>
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
                      <span className="w-5 h-5 rounded-full bg-[var(--info-bg)] text-navy-500 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{r.rule}</span>
                      <span className="text-[12px] text-gray-500 leading-relaxed">{r.text}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="Role Permissions">
                <div className="py-1">
                  {[
                    { role: 'Director',          perms: 'Full system access — all modules, approvals, user rights, audit trail, and final overrides' },
                    { role: 'Admin Officer',     perms: 'Process & master-data control — contacts, POs, workflows, user onboarding. No payment posting' },
                    { role: 'Finance Officer',   perms: 'Money control — invoicing, payments, bank, tax, reconciliation. No physical stock actions' },
                    { role: 'Inventory Officer', perms: 'Stock in/out, goods receipt, transfers, counts. No accounting or payment access' },
                    { role: 'Kilimall Officer',  perms: 'Marketplace order processing, fulfilment, returns, settlement uploads' },
                    { role: 'Sales Rep',         perms: 'CRM, quotes, sales orders, contacts — no purchasing, stock edits, or finance' },
                    { role: 'Technical Lead',    perms: 'All repair jobs, technician assignment, QA sign-off, refurbishment — no accounting' },
                    { role: 'Technician',        perms: 'Assigned repair jobs only — diagnosis, parts request, status updates' },
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

          {/* ════ PARTNER API ════ */}
          {section === 'partner_api' && canManageSystemUsers && <PartnerApiKeys />}

          {/* ════ DATA CUTOVER ════ */}
          {section === 'data_cutover' && canManageSystemUsers && (
            <SectionCard title="Blob cutover (gated)">
              <BlobCutoverPanel
                canWrite={currentUser?.role === 'director'}
                showToast={showToast}
              />
            </SectionCard>
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
          <div className="flex flex-col sm:flex-row justify-end gap-2 mt-4">
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
            {!userForm.id ? (
              <div className="sm:col-span-2">
                <Field label="Employee" required hint="System users must be created from active HR employees. Name, username, and temporary password are generated automatically.">
                  <Select value={userForm.employeeId} onChange={selectEmployeeForUser} options={[{ value: '', label: 'Select employee…' }, ...employeeOptions]} />
                </Field>
              </div>
            ) : (
              <>
                <Field label="Full Name" required><Input value={userForm.name} onChange={v => setUserForm(p => ({ ...p, name: v }))} /></Field>
                <Field label="Username" required><Input value={userForm.username} onChange={v => setUserForm(p => ({ ...p, username: v }))} maxLength={50} pattern="^[a-zA-Z0-9_\-\.]+$" /></Field>
              </>
            )}
            <Field label="Role" required>
              <Select value={userForm.role} onChange={v => setUserForm(p => ({ ...p, role: v }))} options={roleOptions} />
            </Field>
            {userForm.id && (
              <Field label="Status">
                <Select value={userForm.active ? 'active' : 'inactive'} onChange={v => setUserForm(p => ({ ...p, active: v === 'active' }))} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
              </Field>
            )}
            {userForm.id && (
              <div className="sm:col-span-2">
                <Field label="Reset Password" hint="Leave blank to keep current.">
                  <Input type="password" value={userForm.password} onChange={v => setUserForm(p => ({ ...p, password: v }))} placeholder="Optional new password" />
                </Field>
              </div>
            )}
            <div className="sm:col-span-2">
              <Field label="Allowed Modules" required hint="Users can only enter modules enabled here.">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
                  {moduleOptions.map(opt => {
                    const sel = userForm.modules.includes(opt.value)
                    return (
                      <button key={opt.value} type="button" onClick={() => toggleUserModule(opt.value)}
                        className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-all cursor-pointer"
                        style={{ borderColor: sel ? '#A8D4E8' : 'var(--border-lt)', background: sel ? '#E8F3FA' : '#FFF', color: sel ? 'var(--navy)' : 'var(--text-4)', fontWeight: sel ? 600 : 400 }}>
                        <span className="truncate">{opt.label}</span>
                        <Fa icon={sel ? faCheck : faPlus} style={{ fontSize: sel ? 10 : 9, flexShrink: 0, marginLeft: 4 }} />
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row justify-end gap-2 mt-4">
            <button className="btn-outline" onClick={() => setShowUserModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={savingUser || (!userForm.id && !userForm.employeeId)} onClick={() => { void saveUser() }}>
              {savingUser ? 'Saving…' : userForm.id ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </Modal>
      )}
      </div>
      {pendingConfirm && (
        <Confirm
          message={pendingConfirm.msg}
          onConfirm={() => { pendingConfirm.action(); setPendingConfirm(null) }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
      {resetStep === 1 && (
        <Confirm
          message="Warning: This will permanently delete ALL business data. User accounts will be kept. This cannot be undone. Are you sure?"
          confirmLabel="Yes, Delete All"
          confirmColor="bg-red-600"
          onConfirm={() => setResetStep(2)}
          onCancel={() => setResetStep(0)}
        />
      )}
      {resetStep === 2 && (
        <Confirm
          message={`Final confirmation: type ${RESET_CONFIRMATION} in the prompt before deleting all business data.`}
          confirmLabel="Enter Confirmation"
          confirmColor="bg-red-700"
          onConfirm={() => {
            const phrase = window.prompt(`Type ${RESET_CONFIRMATION} to permanently delete all business data.`) ?? ''
            setResetPhrase(phrase)
            setResetStep(0)
            if (phrase.trim() === RESET_CONFIRMATION) void doResetAllData(phrase)
            else showToast('Reset cancelled: typed confirmation did not match.', 'error')
          }}
          onCancel={() => setResetStep(0)}
        />
      )}
    </ModuleChrome>
  )
}
