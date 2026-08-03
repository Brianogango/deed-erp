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
import { faChevronDown, faPlus } from '@fortawesome/free-solid-svg-icons'

type Props = {
  value?: Partial<DocumentPaymentDetails> | null
  onChange: (next: DocumentPaymentDetails) => void
  bankAccounts: BankAccount[]
  companySettings: Pick<CompanySettings, 'name' | 'mpesaPaybill' | 'mpesaAccount' | 'currency'>
  /** Optional quick-add into Settings bank accounts. Return the new account id to auto-select. */
  onAddBankAccount?: (account: Omit<BankAccount, 'id'>) => string | void
  className?: string
  /** Start expanded (default: only when not using company default). */
  defaultOpen?: boolean
}

export default function PaymentDetailsPicker({
  value,
  onChange,
  bankAccounts,
  companySettings,
  onAddBankAccount,
  className = '',
  defaultOpen,
}: Props) {
  const modeName = useId()
  const details = normalizeDocumentPaymentDetails(value)
  const banks = useMemo(() => selectablePaymentBanks(bankAccounts), [bankAccounts])
  const [open, setOpen] = useState(() =>
    defaultOpen ?? !normalizeDocumentPaymentDetails(value).useCompanyDefault,
  )
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
    <div className={`border-t border-[var(--border-lt)] pt-3 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 text-left cursor-pointer group"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-[var(--text-2)]">
            PDF payment details
            {!open && (
              <span className="ml-2 font-normal text-[var(--text-4)]">
                · {details.useCompanyDefault ? 'Company default' : 'Custom accounts'}
              </span>
            )}
          </p>
          {!open && (
            <p className="text-[10px] text-[var(--text-4)] mt-0.5 truncate">{summary}</p>
          )}
        </div>
        <Fa
          icon={faChevronDown}
          className={`text-[10px] text-[var(--text-4)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[10px] text-[var(--text-4)]">
            Which bank / M-Pesa details print on the PDF. Order lines are unchanged.
          </p>

          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="radio"
                name={modeName}
                className="w-3.5 h-3.5"
                checked={details.useCompanyDefault}
                onChange={() => setDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })}
              />
              <span className="text-xs font-semibold text-[var(--text-2)]">Company default</span>
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
              <span className="text-xs font-semibold text-[var(--text-2)]">Select for this document</span>
            </label>
          </div>

          {!details.useCompanyDefault && (
            <div className="flex flex-col gap-1.5">
              {banks.length === 0 && (
                <p className="text-[10px] text-amber-700 font-semibold">No active bank accounts. Add one below or in Settings.</p>
              )}
              {banks.map(bank => (
                <label key={bank.id} className="flex items-center gap-2 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 shrink-0"
                    checked={details.bankAccountIds.includes(bank.id)}
                    onChange={() => toggleBank(bank.id)}
                  />
                  <span className="text-xs text-[var(--text-1)] truncate">
                    <span className="font-semibold">{bank.name}</span>
                    <span className="text-[var(--text-4)]"> · {bank.bankName} · {bank.accountNo}</span>
                  </span>
                </label>
              ))}

              {Boolean(companySettings.mpesaPaybill) && (
                <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 shrink-0"
                    checked={details.includeMpesa}
                    onChange={e => setDetails({ includeMpesa: e.target.checked, useCompanyDefault: false })}
                  />
                  <span className="text-xs text-[var(--text-1)] truncate">
                    <span className="font-semibold">M-Pesa Paybill</span>
                    <span className="text-[var(--text-4)]">
                      {' '}· {companySettings.mpesaPaybill}
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
                    <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] p-2.5 flex flex-col gap-2">
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
      )}
    </div>
  )
}
