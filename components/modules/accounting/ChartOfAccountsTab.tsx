'use client'
import { useMemo } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtKes, type Account } from '@/lib/store'

const typeColor: Record<Account['type'], string> = {
  asset:     '#3B82F6',
  liability: '#EF4444',
  equity:    '#8B5CF6',
  revenue:   '#10B981',
  expense:   '#F59E0B',
}

const FISCAL_YEAR = new Date().getFullYear().toString()

export default function ChartOfAccountsTab() {
  const {
    accounts, outstandingAR, outstandingAP, totalRevenueDynamic,
    coaSearch, setCoaSearch, coaTypeFilter, setCoaTypeFilter,
    showAccountForm, setShowAccountForm, editAccountId, setEditAccountId,
    accountForm, setAccountForm, addAccount, updateAccount, showToast,
    canManageFinance,
  } = useAccounting()

  const payrollExpense = useMemo(() => {
    return accounts.filter(a => a.group === 'Salaries Expense' && !a.isDynamic)
      .reduce((s, a) => s + a.balance, 0)
  }, [accounts])
  const totalSalaries = payrollExpense || 48_000
  const netProfit = 0 // simplified — full P&L in ProfitLossTab

  const filteredAccounts = useMemo(() => {
    const q = coaSearch.toLowerCase()
    return accounts.filter(a =>
      (coaTypeFilter === 'all' || a.type === coaTypeFilter) &&
      (!q || a.name.toLowerCase().includes(q) || a.code.includes(q) ||
        a.group.toLowerCase().includes(q) || (a.subGroup ?? '').toLowerCase().includes(q))
    ).sort((a, b) => a.code.localeCompare(b.code))
  }, [accounts, coaSearch, coaTypeFilter])

  const getLiveBalance = (a: Account) => {
    if (!a.isDynamic) return a.balance
    if (a.dynamicKey === 'ar')      return outstandingAR
    if (a.dynamicKey === 'ap')      return outstandingAP
    if (a.dynamicKey === 'revenue') return totalRevenueDynamic
    if (a.dynamicKey === 'salaries')return totalSalaries
    if (a.dynamicKey === 'net_profit') return netProfit
    return 0
  }

  const openNewAccount = () => {
    setAccountForm({ code: '', name: '', type: 'asset', group: '', subGroup: '', isActive: true, balance: 0, notes: '' })
    setEditAccountId(null)
    setShowAccountForm(true)
  }
  const openEditAccount = (a: Account) => {
    setAccountForm({ code: a.code, name: a.name, type: a.type, group: a.group, subGroup: a.subGroup ?? '', isActive: a.isActive, balance: a.balance, notes: a.notes })
    setEditAccountId(a.id)
    setShowAccountForm(true)
  }
  const saveAccount = () => {
    if (!accountForm.code.trim() || !accountForm.name.trim()) return
    editAccountId ? updateAccount(editAccountId, accountForm) : addAccount(accountForm)
    setShowAccountForm(false)
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <input className="form-input text-[11px] py-1.5" style={{ width: 240 }}
          placeholder="Search code, name, group..."
          value={coaSearch} onChange={e => setCoaSearch(e.target.value)} />
        <div className="flex gap-1 flex-wrap">
          {(['all', 'asset', 'liability', 'equity', 'revenue', 'expense'] as const).map(t => (
            <button key={t} onClick={() => setCoaTypeFilter(t)}
              className={`px-2.5 py-1 rounded-md text-[10px] cursor-pointer capitalize border ${
                coaTypeFilter === t ? 'bg-[#E8F3FA] border-[#A8D4E8] text-brand-navy font-semibold' : 'bg-transparent border-transparent text-t3 hover:text-t1'
              }`}>{t}</button>
          ))}
        </div>
        <div className="ml-auto">
          <button className="btn-primary text-[11px]" onClick={openNewAccount}>+ New Account</button>
        </div>
      </div>

      <div className="mx-4 my-2 px-3 py-2 rounded-lg text-[11px] bg-[#E8F3FA] border border-[#A8D4E8] text-t2">
        <span className="text-purple-600 font-semibold">Accounting Basis: </span>
        Accrual · Double-entry · IFRS · Kenya Revenue Authority VAT 16% · KES · FY Jan–Dec {FISCAL_YEAR}
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: 820 }}>
          <div className="table-head" style={{ gridTemplateColumns: '72px 2fr 1.1fr 1fr 90px 120px 100px 60px' }}>
            <span>Code</span><span>Account Name</span><span>Group</span><span>Sub-Group</span>
            <span>Type</span><span>Balance (KSh)</span><span>Status</span><span>Edit</span>
          </div>
          {filteredAccounts.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No accounts found</p>
            : filteredAccounts.map(a => {
              const bal = getLiveBalance(a)
              return (
                <div key={a.id} className="table-row" style={{ gridTemplateColumns: '72px 2fr 1.1fr 1fr 90px 120px 100px 60px' }}>
                  <span className="font-mono text-[11px] font-semibold text-t3">{a.code}</span>
                  <div>
                    <p className="font-medium text-[12px]">{a.name}</p>
                    {a.isDynamic && <p className="text-[9px] text-t3">⚡ computed</p>}
                  </div>
                  <span className="text-[10px] text-t3">{a.group}</span>
                  <span className="text-[10px] text-t3">{a.subGroup ?? '—'}</span>
                  <span className="text-[10px] font-semibold capitalize" style={{ color: typeColor[a.type] }}>{a.type}</span>
                  <span className={`font-mono text-[11px] ${bal < 0 ? 'text-red-500' : ''}`}>
                    {bal !== 0 ? fmtKes(bal) : <span className="text-t4">—</span>}
                  </span>
                  <span>
                    <span className={`badge ${a.isActive ? 'badge-success' : 'badge-error'}`}>
                      {a.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </span>
                  <button className="text-[9px] px-2 py-0.5 rounded bg-[#E8F3FA] border border-[#A8D4E8] text-brand-navy cursor-pointer"
                    onClick={() => openEditAccount(a)}>Edit</button>
                </div>
              )
            })
          }
        </div>
      </div>

      {/* Account form modal */}
      {showAccountForm && (
        <div className="modal-overlay" onClick={() => setShowAccountForm(false)}>
          <div className="modal-box w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-t1">{editAccountId ? 'Edit Account' : 'New Account'}</h3>
              <button onClick={() => setShowAccountForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9CA3AF' }}>×</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Code *</label>
                <input className="form-input w-full text-[12px]" value={accountForm.code}
                  onChange={e => setAccountForm((p: any) => ({ ...p, code: e.target.value }))} placeholder="e.g. 1001" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Name *</label>
                <input className="form-input w-full text-[12px]" value={accountForm.name}
                  onChange={e => setAccountForm((p: any) => ({ ...p, name: e.target.value }))} placeholder="Account name" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Type</label>
                <select className="form-input w-full text-[12px]" value={accountForm.type}
                  onChange={e => setAccountForm((p: any) => ({ ...p, type: e.target.value }))}>
                  {['asset','liability','equity','revenue','expense'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Group</label>
                <input className="form-input w-full text-[12px]" value={accountForm.group}
                  onChange={e => setAccountForm((p: any) => ({ ...p, group: e.target.value }))} placeholder="e.g. Current Assets" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-t2 block mb-1">Opening Balance</label>
                <input className="form-input w-full text-[12px]" type="number" value={accountForm.balance}
                  onChange={e => setAccountForm((p: any) => ({ ...p, balance: Number(e.target.value) }))} />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input type="checkbox" checked={accountForm.isActive}
                  onChange={e => setAccountForm((p: any) => ({ ...p, isActive: e.target.checked }))}
                  style={{ accentColor: '#1B2762' }} />
                <span className="text-xs">Active account</span>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button className="btn-outline text-[11px]" onClick={() => setShowAccountForm(false)}>Cancel</button>
              <button className="btn-primary text-[11px]" onClick={saveAccount}>{editAccountId ? 'Save Changes' : 'Create Account'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
