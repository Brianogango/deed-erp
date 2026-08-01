'use client'

import { useId, useMemo, useState } from 'react'
import type { BankAccount, CompanySettings } from '@/lib/store'
import {
  DEFAULT_DOCUMENT_PAYMENT_DETAILS,
  normalizeDocumentPaymentDetails,
  selectablePaymentBanks,
  summarizePaymentDetails,
  type DocumentPaymentDetails,
} from '@/lib/document-payment-details'
import { Fa } from '@/components/icons'
import { faPlus } from '@fortawesome/free-solid-svg-icons'

type Props = {
  value?: Partial<DocumentPaymentDetails> | null
  onChange: (next: DocumentPaymentDetails) => void
  bankAccounts: BankAccount[]
  companySettings: Pick<CompanySettings, 'name' | 'mpesaPaybill' | 'mpesaAccount' | 'currency'>
  /** Optional quick-add into Settings bank accounts. Return the new account id to auto-select. */
  onAddBankAccount?: (account: Omit<BankAccount, 'id'>) => string | void
  className?: string
}

export default function PaymentDetailsPicker({
  value,
  onChange,
  bankAccounts,
  companySettings,
  onAddBankAccount,
  className = '',
}: Props) {
  const modeName = useId()
  const details = normalizeDocumentPaymentDetails(value)
  const banks = useMemo(() => selectablePaymentBanks(bankAccounts), [bankAccounts])
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBankName, setNewBankName] = useState('')
  const [newAccountNo, setNewAccountNo] = useState('')

  const summary = summarizePaymentDetails(details, bankAccounts, companySettings)

  const setDetails = (patch: Partial<DocumentPaymentDetails>) => {
    onChange(normalizeDocumentPaymentDetails({ ...details, ...patch }))
  }

  const toggleBank = (id: string) => {
    const has = details.bankAccountIds.includes(id)
    const bankAccountIds = has
      ? details.bankAccountIds.filter(x => x !== id)
      : [...details.bankAccountIds, id]
    setDetails({ useCompanyDefault: false, bankAccountIds })
  }

  const addBank = () => {
    if (!onAddBankAccount) return
    const name = newName.trim()
    const bankName = newBankName.trim() || name
    const accountNo = newAccountNo.trim()
    if (!name || !accountNo) return
    const newId = onAddBankAccount({
      name,
      bankName,
      accountNo,
      currency: companySettings.currency || 'KES',
      openingBalance: 0,
      openingDate: new Date().toISOString().slice(0, 10),
      active: true,
    })
    setNewName('')
    setNewBankName('')
    setNewAccountNo('')
    setShowAdd(false)
    if (newId) {
      setDetails({
        useCompanyDefault: false,
        bankAccountIds: details.bankAccountIds.includes(newId)
          ? details.bankAccountIds
          : [...details.bankAccountIds, newId],
      })
    }
  }

  return (
    <div className={`rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3 flex flex-col gap-3 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-[var(--text-2)]">Payment details on PDF</p>
          <p className="text-[10px] text-[var(--text-4)] mt-0.5">Choose which bank / M-Pesa details print on this document.</p>
        </div>
        <span className="text-[10px] font-semibold text-[var(--text-3)] text-right max-w-[50%]">{summary}</span>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="radio"
          name={modeName}
          className="w-3.5 h-3.5"
          checked={details.useCompanyDefault}
          onChange={() => setDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })}
        />
        <span className="text-xs font-semibold text-[var(--text-2)]">Use company default</span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="radio"
          name={modeName}
          className="w-3.5 h-3.5"
          checked={!details.useCompanyDefault}
          onChange={() => setDetails({
            useCompanyDefault: false,
            bankAccountIds: details.bankAccountIds.length
              ? details.bankAccountIds
              : banks.filter(b => b.id !== 'mpesa').slice(0, 1).map(b => b.id),
            includeMpesa: true,
          })}
        />
        <span className="text-xs font-semibold text-[var(--text-2)]">Select accounts for this document</span>
      </label>

      {!details.useCompanyDefault && (
        <div className="flex flex-col gap-2 pl-1">
          {banks.length === 0 && (
            <p className="text-[10px] text-amber-700 font-semibold">No active bank accounts. Add one below or in Settings.</p>
          )}
          {banks.map(bank => (
            <label key={bank.id} className="flex items-start gap-2 cursor-pointer select-none rounded-lg border border-[var(--border-lt)] px-2.5 py-2 hover:bg-white/60">
              <input
                type="checkbox"
                className="mt-0.5 w-3.5 h-3.5"
                checked={details.bankAccountIds.includes(bank.id)}
                onChange={() => toggleBank(bank.id)}
              />
              <span className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-[var(--text-1)] truncate">{bank.name}</span>
                <span className="text-[10px] text-[var(--text-4)] truncate">
                  {bank.bankName} · {bank.accountNo}
                </span>
              </span>
            </label>
          ))}

          {Boolean(companySettings.mpesaPaybill) && (
            <label className="flex items-start gap-2 cursor-pointer select-none rounded-lg border border-[var(--border-lt)] px-2.5 py-2 hover:bg-white/60">
              <input
                type="checkbox"
                className="mt-0.5 w-3.5 h-3.5"
                checked={details.includeMpesa}
                onChange={e => setDetails({ includeMpesa: e.target.checked, useCompanyDefault: false })}
              />
              <span className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-[var(--text-1)]">M-Pesa Paybill</span>
                <span className="text-[10px] text-[var(--text-4)]">
                  {companySettings.mpesaPaybill}
                  {companySettings.mpesaAccount ? ` · Acct ${companySettings.mpesaAccount}` : ''}
                </span>
              </span>
            </label>
          )}

          {onAddBankAccount && (
            <div className="pt-1">
              {!showAdd ? (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 hover:underline cursor-pointer"
                >
                  <Fa icon={faPlus} className="text-[9px]" /> Add bank account
                </button>
              ) : (
                <div className="rounded-lg border border-[var(--border-lt)] bg-white p-2.5 flex flex-col gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">New bank account</p>
                  <input
                    className="form-input text-xs"
                    placeholder="Display name e.g. NCBA Current"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                  />
                  <input
                    className="form-input text-xs"
                    placeholder="Bank name"
                    value={newBankName}
                    onChange={e => setNewBankName(e.target.value)}
                  />
                  <input
                    className="form-input text-xs"
                    placeholder="Account number"
                    value={newAccountNo}
                    onChange={e => setNewAccountNo(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <button type="button" className="btn-outline text-[10px]" onClick={() => setShowAdd(false)}>Cancel</button>
                    <button
                      type="button"
                      className="btn-primary text-[10px] disabled:opacity-50"
                      disabled={!newName.trim() || !newAccountNo.trim()}
                      onClick={addBank}
                    >
                      Save account
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Custom payment note</label>
        <textarea
          className="form-input text-xs"
          rows={2}
          placeholder="e.g. Use the document number as your payment reference"
          value={details.customNote ?? ''}
          onChange={e => setDetails({ customNote: e.target.value })}
        />
      </div>
    </div>
  )
}
