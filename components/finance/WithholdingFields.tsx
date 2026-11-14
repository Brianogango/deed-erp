'use client'

import { Field, Input, Select } from '@/components/ui'
import { WITHHELD_INCOME_TAX, WITHHELD_VAT, type WithholdingMethod } from '@/lib/accounting/withholding'

export type WithholdingEntry = { kind: WithholdingMethod | ''; amount: string; certificate: string }

export const NO_WITHHOLDING: WithholdingEntry = { kind: '', amount: '', certificate: '' }

/**
 * Tax the customer withheld from a payment and paid to KRA: which tax, how much,
 * and the certificate number. Used wherever a customer receipt is recorded.
 */
export function WithholdingFields({ value, onChange, suggest, hint }: {
  value: WithholdingEntry
  onChange: (next: WithholdingEntry) => void
  /** Amount to prefill when a kind is picked. */
  suggest: (kind: WithholdingMethod) => number
  /** Extra line under the fields, e.g. about leaving the amount received empty. */
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-lt)] p-3">
      <Field label="Customer withheld tax">
        <Select
          value={value.kind}
          onChange={picked => {
            const kind = picked as WithholdingMethod | ''
            onChange({ ...value, kind, amount: kind ? String(suggest(kind)) : '' })
          }}
          options={[
            { value: '', label: 'No — nothing withheld' },
            { value: WITHHELD_VAT, label: 'Withholding VAT (usually 2% before VAT)' },
            { value: WITHHELD_INCOME_TAX, label: 'Withholding income tax' },
          ]}
        />
      </Field>
      {value.kind && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount withheld">
            <Input type="number" value={value.amount} onChange={amount => onChange({ ...value, amount })} placeholder="0.00" />
          </Field>
          <Field label="Certificate number *">
            <Input value={value.certificate} onChange={certificate => onChange({ ...value, certificate })} placeholder="From the KRA certificate" />
          </Field>
          <p className="col-span-2 text-[10px] text-[var(--text-4)]">
            {value.kind === WITHHELD_VAT
              ? 'Settles this part of the invoice without money in the bank; it is deducted from the VAT you owe in the return.'
              : 'Settles this part of the invoice without money in the bank; it is a credit against income tax.'}
            {hint ? ` ${hint}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
