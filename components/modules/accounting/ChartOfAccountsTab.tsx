'use client'

import { useMemo, useState } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtKes, type Account, type AccountType, type BankAccount } from '@/lib/store'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Modal, Field, Input, Select } from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'
import { useRouter } from 'next/navigation'

const TYPE_OPTIONS: { value: AccountType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'revenue', label: 'Income' },
  { value: 'expense', label: 'Expense' },
]

const ACCOUNT_TYPE_SELECT = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'revenue', label: 'Income' },
  { value: 'expense', label: 'Expense' },
]

const GROUP_SUGGESTIONS: Record<AccountType, string[]> = {
  asset: ['Cash at Bank', 'Cash in Hand', 'Receivables - Product', 'Inventory - Closing', 'PPE - Cost', 'Receivables - Tax'],
  liability: ['Payables - Product', 'Customer Liabilities', 'Accruals', 'Statutory Liabilities'],
  equity: ['Equity'],
  revenue: ['Revenue - Products', 'Revenue - Services', 'Other Income'],
  expense: ['Local Purchases', 'Direct Expenses', 'Operating Expenses', 'Employment Expenses', 'Finance Costs'],
}

function suggestNextCode(accounts: Account[], type: AccountType): string {
  const prefix =
    type === 'asset' ? '2'
    : type === 'liability' ? '3'
    : type === 'equity' ? '4'
    : type === 'revenue' ? '5'
    : '6'
  const nums = accounts
    .map(a => a.code)
    .filter(c => c.startsWith(prefix) && /^\d+$/.test(c))
    .map(c => Number(c))
    .filter(n => Number.isFinite(n))
  const next = (nums.length ? Math.max(...nums) + 1 : Number(`${prefix}001`))
  return String(next)
}

function suggestNextBankCode(accounts: Account[], kind: 'bank' | 'cash'): string {
  if (kind === 'cash') {
    const used = new Set(accounts.map(a => a.code))
    for (let i = 2211; i <= 2219; i += 1) {
      const code = String(i)
      if (!used.has(code)) return code
    }
    return suggestNextCode(accounts, 'asset')
  }
  const used = new Set(accounts.map(a => a.code))
  for (let i = 2201; i <= 2299; i += 1) {
    if (i === 2211) continue // reserved petty / mobile band
    const code = String(i)
    if (!used.has(code)) return code
  }
  return suggestNextCode(accounts, 'asset')
}

const FISCAL_YEAR = new Date().getFullYear().toString()

/** Account form state: type and opening balance may be blank on a NEW account. */
type AccountFormState = Omit<Account, 'id' | 'type' | 'balance'> & { type: AccountType | ''; balance: number | '' }

type BankForm = {
  name: string
  bankName: string
  accountNo: string
  currency: string
  openingBalance: string
  openingDate: string
  kind: 'bank' | 'cash' | ''
  mpesaPaybill: string
  mpesaAccount: string
}

const EMPTY_BANK: BankForm = {
  name: '',
  bankName: '',
  accountNo: '',
  currency: '',
  openingBalance: '',
  openingDate: '',
  kind: '',
  mpesaPaybill: '',
  mpesaAccount: '',
}

export default function ChartOfAccountsTab() {
  const {
    accounts, bankAccounts, outstandingAR, outstandingAP, totalRevenueDynamic,
    currentYearNetProfit, currentYearNetProfitLoading, currentYearNetProfitError,
    coaSearch, setCoaSearch, coaTypeFilter, setCoaTypeFilter,
    showAccountForm, setShowAccountForm, editAccountId, setEditAccountId,
    accountForm: accountFormRaw, setAccountForm, addAccount, updateAccount, addBankAccount, showToast,
  } = useAccounting()
  const accountForm = accountFormRaw as unknown as AccountFormState

  const router = useRouter()
  const [selectedId, setSelectedId] = useUrlRecordId({ param: 'accountId' })
  const [showBankForm, setShowBankForm] = useState(false)
  const [bankForm, setBankForm] = useState<BankForm>(EMPTY_BANK)

  const payrollExpense = useMemo(() => {
    return accounts.filter(a => a.group === 'Salaries Expense' && !a.isDynamic)
      .reduce((s, a) => s + a.balance, 0)
  }, [accounts])
  const totalSalaries = payrollExpense || 0

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
    if (a.dynamicKey === 'ar') return outstandingAR
    if (a.dynamicKey === 'ap') return outstandingAP
    if (a.dynamicKey === 'revenue') return totalRevenueDynamic
    if (a.dynamicKey === 'salaries') return totalSalaries
    if (a.dynamicKey === 'net_profit') return currentYearNetProfit ?? 0
    return 0
  }

  const selected = selectedId ? accounts.find(a => a.id === selectedId) ?? null : null
  const linkedBank: BankAccount | undefined = selected?.bankAccountId
    ? bankAccounts.find(b => b.id === selected.bankAccountId)
    : bankAccounts.find(b =>
      selected && (b.name === selected.name || b.id === selected.code || selected.notes?.includes(b.id)),
    )

  const openNewAccount = () => {
    // Type, group, code and opening balance start blank; the next free code
    // for the chosen type is only shown as a placeholder.
    const blank: AccountFormState = {
      code: '',
      name: '',
      type: '',
      group: '',
      subGroup: '',
      isActive: true,
      balance: '',
      notes: '',
    }
    setAccountForm(blank)
    setEditAccountId(null)
    setShowAccountForm(true)
  }

  const openEditAccount = (a: Account) => {
    setSelectedId(a.id)
    setAccountForm({
      code: a.code,
      name: a.name,
      type: a.type,
      group: a.group,
      subGroup: a.subGroup ?? '',
      isActive: a.isActive,
      balance: a.balance,
      notes: a.notes ?? '',
      bankAccountId: a.bankAccountId,
    })
    setEditAccountId(a.id)
    setShowAccountForm(true)
  }

  const saveAccount = () => {
    const missing: string[] = []
    if (!accountForm.code.trim()) missing.push('Code')
    if (!accountForm.name.trim()) missing.push('Account name')
    if (!accountForm.type) missing.push('Type')
    if (!String(accountForm.group ?? '').trim()) missing.push('Group')
    const balanceRaw = accountForm.balance
    if (balanceRaw === '' || balanceRaw === null || balanceRaw === undefined || !Number.isFinite(Number(balanceRaw))) missing.push('Opening balance')
    if (missing.length || !accountForm.type) {
      showToast(`Required: ${missing.join(', ')}`, 'error')
      return
    }
    const payload: Omit<Account, 'id'> = { ...accountForm, type: accountForm.type, balance: Number(balanceRaw) }
    const dup = accounts.find(a => a.code === accountForm.code.trim() && a.id !== editAccountId)
    if (dup) {
      showToast(`Code ${accountForm.code} already exists`, 'error')
      return
    }
    if (editAccountId) {
      updateAccount(editAccountId, payload)
      showToast('Account updated', 'success')
    } else {
      const created = addAccount({ ...payload })
      setSelectedId(created.id)
      showToast('Account created', 'success')
    }
    setShowAccountForm(false)
  }

  const openAddBank = () => {
    setBankForm({ ...EMPTY_BANK })
    setShowBankForm(true)
  }

  const saveBank = () => {
    const missing: string[] = []
    if (!bankForm.kind) missing.push('Wallet type')
    if (!bankForm.currency) missing.push('Currency')
    if (!bankForm.name.trim()) missing.push('Account name')
    if (!bankForm.accountNo.trim()) missing.push('Account number')
    if (!bankForm.openingDate) missing.push('Opening date')
    const openingRaw = bankForm.openingBalance.trim()
    if (openingRaw === '' || !Number.isFinite(Number(openingRaw))) missing.push('Opening balance')
    if (missing.length || !bankForm.kind) {
      showToast(`Required: ${missing.join(', ')}`, 'error')
      return
    }
    const kind = bankForm.kind
    const openingBalance = Number(openingRaw)
    const code = suggestNextBankCode(accounts, kind)
    const group = kind === 'cash' ? 'Cash in Hand' : 'Cash at Bank'
    const subGroup = group

    const bankPayload: Omit<BankAccount, 'id'> = {
      name: bankForm.name.trim(),
      bankName: (bankForm.bankName || bankForm.name).trim(),
      accountNo: bankForm.accountNo.trim(),
      currency: bankForm.currency,
      openingBalance,
      openingDate: bankForm.openingDate,
      active: true,
      mpesaPaybill: bankForm.mpesaPaybill.trim() || undefined,
      mpesaAccount: bankForm.mpesaAccount.trim() || undefined,
    }

    // Store uses its own id generator — create bank first, then CoA with that id.
    const createdBankId = addBankAccount(bankPayload)
    const coa = addAccount({
      code,
      name: bankForm.name.trim(),
      type: 'asset',
      group,
      subGroup,
      isActive: true,
      balance: openingBalance,
      notes: `Liquidity account for cashbook wallet ${createdBankId}`,
      bankAccountId: createdBankId,
    })
    setSelectedId(coa.id)
    setShowBankForm(false)
    showToast(`Bank added — CoA ${code} + cashbook wallet`, 'success')
  }

  const columns: ColumnDef<Account>[] = [
    {
      key: 'code', label: 'Code', priority: 1, width: '88px',
      render: a => <span className="font-mono text-[12px] font-semibold text-t2">{a.code}</span>,
      accessor: a => a.code,
      exportValue: a => a.code,
    },
    {
      key: 'name', label: 'Account name', priority: 1, width: '2fr',
      render: a => (
        <div className="min-w-0">
          <p className="font-medium text-[12px] text-t1 truncate">{a.name}</p>
          <p className="text-[10px] text-t3 truncate">
            {a.group}{a.subGroup ? ` · ${a.subGroup}` : ''}
            {a.bankAccountId ? ' · Bank' : ''}
            {a.isDynamic ? ' · Computed' : ''}
          </p>
        </div>
      ),
      accessor: a => a.name,
      exportValue: a => a.name,
    },
    {
      key: 'type', label: 'Type', priority: 2, width: '96px',
      render: a => (
        <span className="text-[11px] font-medium capitalize text-t2">
          {a.type === 'revenue' ? 'Income' : a.type}
        </span>
      ),
      accessor: a => a.type,
      exportValue: a => a.type === 'revenue' ? 'Income' : a.type,
    },
    {
      key: 'balance', label: 'Balance', priority: 1, width: '120px',
      render: a => {
        if (a.dynamicKey === 'net_profit' && currentYearNetProfit == null) {
          return (
            <span className={`text-[11px] ${currentYearNetProfitError ? 'text-[var(--danger)]' : 'text-t4'}`}>
              {currentYearNetProfitError ? 'Unavailable' : currentYearNetProfitLoading ? 'Loading…' : 'No posted GL data'}
            </span>
          )
        }
        const bal = getLiveBalance(a)
        return (
          <span className={`font-mono text-[12px] tabular-nums ${bal < 0 ? 'text-[var(--danger)]' : 'text-t1'}`}>
            {fmtKes(bal)}
          </span>
        )
      },
      exportValue: a => a.dynamicKey === 'net_profit' && currentYearNetProfit == null ? '' : getLiveBalance(a),
      footer: pageRows => (
        <span className="font-mono text-[12px] font-bold tabular-nums">
          {fmtKes(pageRows.reduce((sum, account) => sum + getLiveBalance(account), 0))}
        </span>
      ),
    },
    {
      key: 'status', label: 'Status', priority: 2, width: '88px',
      render: a => (
        <span className={`badge ${a.isActive ? 'badge-success' : 'badge-gray'}`}>
          {a.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
      accessor: a => (a.isActive ? 'Active' : 'Inactive'),
      exportValue: a => (a.isActive ? 'Active' : 'Inactive'),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--border-lt)' }}>
        <input
          className="form-input text-[11px] py-1.5 w-full sm:w-auto sm:min-w-[240px]"
          placeholder="Search code, name, group…"
          value={coaSearch}
          onChange={e => setCoaSearch(e.target.value)}
          aria-label="Search chart of accounts"
        />
        <div className="flex gap-1 flex-wrap" role="tablist" aria-label="Account type">
          {TYPE_OPTIONS.map(t => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={coaTypeFilter === t.value}
              onClick={() => setCoaTypeFilter(t.value)}
              className={`px-2.5 py-1 rounded-md text-[10px] cursor-pointer border ${
                coaTypeFilter === t.value
                  ? 'bg-[var(--info-bg)] border-[var(--info)] text-[var(--info-text)] font-semibold'
                  : 'bg-transparent border-transparent text-t3 hover:text-t1'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {(coaSearch || coaTypeFilter !== 'all') && (
            <button
              type="button"
              className="btn-outline text-[11px]"
              onClick={() => {
                setCoaSearch('')
                setCoaTypeFilter('all')
              }}
            >
              Clear filters
            </button>
          )}
          <span className="text-[10px] text-t3 whitespace-nowrap">
            {filteredAccounts.length} account{filteredAccounts.length === 1 ? '' : 's'}
          </span>
          <button type="button" className="btn-outline text-[11px]" onClick={openAddBank}>
            Add bank
          </button>
          <PrimaryActionButton onClick={openNewAccount}>New</PrimaryActionButton>
        </div>
      </div>

      <div className="mx-4 my-2 px-3 py-2 rounded-lg text-[11px] border border-[var(--border-lt)] bg-[var(--bg-surface)] text-t2">
        Chart of Accounts · Accrual · KES · FY {FISCAL_YEAR}. Select a row to open the account. Use <strong>Add bank</strong> to create a cashbook wallet and matching liquidity account (Odoo-style).
      </div>

      {selected && (
        <div className="mx-4 mb-2 px-3 py-2.5 rounded-lg border border-[var(--border-lt)] bg-[var(--bg-card)] flex flex-wrap items-center gap-3 justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-t3">Account details</p>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-sm font-semibold text-t1 truncate">
                <span className="font-mono text-t3 mr-2">{selected.code}</span>
                {selected.name}
              </p>
              <p className={`font-mono text-sm font-bold ${getLiveBalance(selected) < 0 ? 'text-[var(--danger)]' : 'text-t1'}`}>
                {fmtKes(getLiveBalance(selected))}
              </p>
            </div>
            <p className="text-[11px] text-t3">
              {selected.type === 'revenue' ? 'Income' : selected.type}
              {' · '}
              {selected.group}
              {selected.subGroup ? ` · ${selected.subGroup}` : ''}
              {linkedBank ? ` · Wallet: ${linkedBank.name}` : ''}
              {selected.isDynamic ? ' · Computed balance' : ''}
              {' · '}
              {selected.isActive ? 'Active' : 'Inactive'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {linkedBank && (
              <button
                type="button"
                className="btn-outline text-[11px]"
                onClick={() => router.push(`/finance?tab=cashbook&bankAccount=${encodeURIComponent(linkedBank.id)}`)}
              >
                Open in Banking
              </button>
            )}
            <button type="button" className="btn-outline text-[11px]" onClick={() => setSelectedId(null)}>
              Clear
            </button>
            <button type="button" className="btn-primary text-[11px]" onClick={() => openEditAccount(selected)}>
              Edit
            </button>
          </div>
        </div>
      )}

      <DataTable
        tableId="chart-of-accounts"
        columns={columns}
        rows={filteredAccounts}
        rowKey={a => a.id}
        hideSearch
        emptyMessage={coaSearch || coaTypeFilter !== 'all' ? 'No accounts match these filters' : 'No accounts found'}
        onRowClick={a => setSelectedId(a.id)}
        rowLabel={a => `${a.code} ${a.name}`}
        rowClassName={a => (a.id === selectedId ? 'bg-[var(--info-bg)]' : '')}
        rowActions={a => (
          <button
            type="button"
            className="btn-outline text-[10px] py-1 px-2"
            onClick={e => {
              e.stopPropagation()
              setSelectedId(a.id)
            }}
          >
            View details
          </button>
        )}
        exportTitle="Chart of Accounts"
        exportFilename="chart-of-accounts"
      />

      {showAccountForm && (
        <Modal
          title={editAccountId ? 'Edit account' : 'New account'}
          onClose={() => setShowAccountForm(false)}
          width={560}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Code *">
              <Input
                value={accountForm.code}
                onChange={v => setAccountForm((p: AccountFormState) => ({ ...p, code: v }))}
                placeholder={!editAccountId && accountForm.type ? `Next free: ${suggestNextCode(accounts, accountForm.type)}` : 'e.g. 2203'}
              />
            </Field>
            <Field label="Account name *">
              <Input
                value={accountForm.name}
                onChange={v => setAccountForm((p: AccountFormState) => ({ ...p, name: v }))}
                placeholder="e.g. ABSA Current"
              />
            </Field>
            <Field label="Type *">
              <Select
                value={accountForm.type}
                onChange={v => {
                  const type = v as AccountType | ''
                  setAccountForm((p: AccountFormState) => ({ ...p, type }))
                }}
                options={[{ value: '', label: 'Select type…' }, ...ACCOUNT_TYPE_SELECT]}
              />
            </Field>
            <Field label="Group *">
              <input
                className="form-input w-full"
                value={accountForm.group}
                onChange={e => setAccountForm((p: AccountFormState) => ({ ...p, group: e.target.value }))}
                placeholder="e.g. Cash at Bank"
                list="coa-group-suggestions"
              />
              <datalist id="coa-group-suggestions">
                {(accountForm.type ? GROUP_SUGGESTIONS[accountForm.type] : [])?.map(g => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
            <Field label="Sub-group">
              <Input
                value={accountForm.subGroup ?? ''}
                onChange={v => setAccountForm((p: AccountFormState) => ({ ...p, subGroup: v }))}
                placeholder="Optional"
              />
            </Field>
            <Field label="Opening balance *">
              <Input
                type="number"
                value={accountForm.balance === '' || accountForm.balance == null ? '' : String(accountForm.balance)}
                onChange={v => setAccountForm((p: AccountFormState) => ({ ...p, balance: v.trim() === '' ? '' : Number(v) }))}
                placeholder="Enter 0 if none"
              />
            </Field>
            <div className="sm:col-span-2 flex items-center gap-2 pt-1">
              <input
                id="coa-active"
                type="checkbox"
                checked={Boolean(accountForm.isActive)}
                onChange={e => setAccountForm((p: AccountFormState) => ({ ...p, isActive: e.target.checked }))}
                style={{ accentColor: 'var(--primary)' }}
              />
              <label htmlFor="coa-active" className="text-xs text-t2">Active</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" className="btn-outline text-[11px]" onClick={() => setShowAccountForm(false)}>Cancel</button>
            <button type="button" className="btn-primary text-[11px]" onClick={saveAccount}>
              {editAccountId ? 'Save' : 'Create'}
            </button>
          </div>
        </Modal>
      )}

      {showBankForm && (
        <Modal title="Add bank" onClose={() => setShowBankForm(false)} width={520}>
          <p className="text-[11px] text-t3 mb-3">
            Creates a cashbook wallet and a matching Chart of Accounts liquidity line (same pattern as Odoo Accounting → Banks).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Wallet type *">
              <Select
                value={bankForm.kind}
                onChange={v => setBankForm(p => ({ ...p, kind: v as BankForm['kind'] }))}
                options={[
                  { value: '', label: 'Select wallet type…' },
                  { value: 'bank', label: 'Bank account' },
                  { value: 'cash', label: 'Cash / M-Pesa' },
                ]}
              />
            </Field>
            <Field label="Currency *">
              <Select
                value={bankForm.currency}
                onChange={v => setBankForm(p => ({ ...p, currency: v }))}
                options={[
                  { value: '', label: 'Select currency…' },
                  { value: 'KES', label: 'KES' },
                  { value: 'USD', label: 'USD' },
                  { value: 'EUR', label: 'EUR' },
                ]}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Account name *">
                <Input
                  value={bankForm.name}
                  onChange={v => setBankForm(p => ({ ...p, name: v }))}
                  placeholder="e.g. Stanbic Current Account"
                />
              </Field>
            </div>
            <Field label="Bank name">
              <Input
                value={bankForm.bankName}
                onChange={v => setBankForm(p => ({ ...p, bankName: v }))}
                placeholder="e.g. Stanbic Bank Kenya"
              />
            </Field>
            <Field label="Account number *">
              <Input
                value={bankForm.accountNo}
                onChange={v => setBankForm(p => ({ ...p, accountNo: v }))}
                placeholder="Account / till number"
              />
            </Field>
            <Field label="Opening date *">
              <Input
                type="date"
                value={bankForm.openingDate}
                onChange={v => setBankForm(p => ({ ...p, openingDate: v }))}
              />
            </Field>
            <Field label={`Opening balance${bankForm.currency ? ` (${bankForm.currency})` : ''} *`}>
              <Input
                type="number"
                value={bankForm.openingBalance}
                onChange={v => setBankForm(p => ({ ...p, openingBalance: v }))}
                placeholder="Enter 0 if none"
              />
            </Field>
            <Field label="M-Pesa paybill">
              <Input
                value={bankForm.mpesaPaybill}
                onChange={v => setBankForm(p => ({ ...p, mpesaPaybill: v }))}
                placeholder="Optional"
              />
            </Field>
            <Field label="M-Pesa account">
              <Input
                value={bankForm.mpesaAccount}
                onChange={v => setBankForm(p => ({ ...p, mpesaAccount: v }))}
                placeholder="Optional"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" className="btn-outline text-[11px]" onClick={() => setShowBankForm(false)}>Cancel</button>
            <button type="button" className="btn-primary text-[11px]" onClick={saveBank}>
              Create bank
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
