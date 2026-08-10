'use client'

import { useMemo, useState } from 'react'
import {
  alignPaymentDetailsToTax,
  banksByPaymentRole,
  normalizeDocumentPaymentDetails,
  paymentRoleLabel,
  summarizePaymentDetails,
  type DocumentPaymentDetails,
  type PaymentBankRole,
} from '@/lib/document-payment-details'
import type { BankAccount } from '@/lib/store'
import { Fa } from '@/components/icons'
import { faChevronDown, faLock } from '@fortawesome/free-solid-svg-icons'

type Props = {
  value?: Partial<DocumentPaymentDetails> | null
  onChange: (next: DocumentPaymentDetails) => void
  bankAccounts: BankAccount[]
  /** When true (VAT invoice/quote), bank is locked to NCBA. */
  isVat: boolean
  className?: string
  defaultOpen?: boolean
  label?: string
  hint?: string
  readOnly?: boolean
}

/**
 * Per-document payment bank + note for quotation / proforma / invoice PDFs.
 * VAT → NCBA (locked). Non-VAT → ABSA or I&M.
 */
export default function PaymentDetailsPicker({
  value,
  onChange,
  bankAccounts,
  isVat,
  className = '',
  defaultOpen,
  label = 'Payment details',
  hint,
  readOnly = false,
}: Props) {
  const roles = useMemo(() => banksByPaymentRole(bankAccounts), [bankAccounts])
  // Display value aligned to VAT rules even if parent has not persisted yet.
  const details = useMemo(
    () => alignPaymentDetailsToTax(value, isVat, bankAccounts),
    [value, isVat, bankAccounts],
  )
  const note = details.customNote ?? ''
  const [open, setOpen] = useState(() =>
    defaultOpen ?? Boolean(normalizeDocumentPaymentDetails(value).customNote?.trim()),
  )

  const nonVatOptions = (['absa', 'im'] as PaymentBankRole[])
    .map(role => ({ role, bank: roles[role] }))
    .filter((o): o is { role: PaymentBankRole; bank: NonNullable<typeof o.bank> } => Boolean(o.bank))

  const selectedId = details.bankAccountIds[0]
  const selectedRole = (Object.entries(roles).find(([, b]) => b?.id === selectedId)?.[0] || null) as PaymentBankRole | null

  const defaultHint = isVat
    ? 'VAT invoices always use NCBA for bank transfer instructions (plus company M-Pesa).'
    : 'Non-VAT invoices use ABSA or I&M Bank — pick one for this document.'

  const setNote = (customNote: string) => {
    onChange({
      ...details,
      customNote,
    })
  }

  const selectNonVatBank = (bankId: string) => {
    if (readOnly || isVat) return
    onChange({
      useCompanyDefault: false,
      bankAccountIds: [bankId],
      includeMpesa: true,
      customNote: note,
    })
  }

  const preview = summarizePaymentDetails(details, bankAccounts)

  return (
    <div className={`invoice-pay-picker ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="invoice-pay-picker__toggle"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="invoice-pay-picker__label">{label}</p>
          {!open && (
            <p className="invoice-pay-picker__preview">{preview}</p>
          )}
        </div>
        <Fa
          icon={faChevronDown}
          className={`invoice-pay-picker__chevron ${open ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="invoice-pay-picker__body">
          <p className="invoice-pay-picker__hint">{hint || defaultHint}</p>

          {isVat ? (
            <div className="invoice-pay-picker__locked" role="status">
              <Fa icon={faLock} aria-hidden="true" />
              <div>
                <p className="invoice-pay-picker__bank-name">
                  {roles.ncba ? paymentRoleLabel('ncba') : 'NCBA'}
                </p>
                <p className="invoice-pay-picker__bank-meta">
                  {roles.ncba
                    ? `${roles.ncba.bankName} · ${roles.ncba.accountNo}`
                    : 'Add an NCBA bank account in Settings to print transfer details.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="invoice-pay-picker__options" role="radiogroup" aria-label="Payment bank">
              {nonVatOptions.length === 0 && (
                <p className="invoice-pay-picker__hint">
                  Add ABSA and/or I&amp;M Bank accounts in Settings to choose payment details.
                </p>
              )}
              {nonVatOptions.map(({ role, bank }) => {
                const checked = selectedId === bank.id || selectedRole === role
                return (
                  <label
                    key={bank.id}
                    className={`invoice-pay-picker__option ${checked ? 'is-selected' : ''} ${readOnly ? 'is-readonly' : ''}`}
                  >
                    <input
                      type="radio"
                      name="document-payment-bank"
                      value={bank.id}
                      checked={checked}
                      disabled={readOnly}
                      onChange={() => selectNonVatBank(bank.id)}
                    />
                    <span>
                      <span className="invoice-pay-picker__bank-name">{paymentRoleLabel(role)}</span>
                      <span className="invoice-pay-picker__bank-meta">
                        {bank.bankName} · {bank.accountNo}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          <label className="invoice-pay-picker__note-label" htmlFor="document-payment-note">
            Payment note (optional)
          </label>
          <textarea
            id="document-payment-note"
            className="form-input text-xs"
            rows={3}
            placeholder="e.g. Use this document number as the payment reference"
            value={note}
            readOnly={readOnly}
            disabled={readOnly}
            onChange={e => {
              if (readOnly) return
              setNote(e.target.value)
            }}
          />
          {readOnly && (
            <p className="invoice-pay-picker__readonly-msg">
              Reset to draft to change payment details.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
