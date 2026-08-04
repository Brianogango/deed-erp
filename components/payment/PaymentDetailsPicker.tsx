'use client'

import { useState } from 'react'
import {
  normalizeDocumentPaymentDetails,
  type DocumentPaymentDetails,
} from '@/lib/document-payment-details'
import { Fa } from '@/components/icons'
import { faChevronDown } from '@fortawesome/free-solid-svg-icons'

type Props = {
  value?: Partial<DocumentPaymentDetails> | null
  onChange: (next: DocumentPaymentDetails) => void
  className?: string
  /** Start expanded when a note is already set (default). */
  defaultOpen?: boolean
  /** Optional label override (defaults to Payment note). */
  label?: string
  /** Shown under the title when expanded. */
  hint?: string
  /** When true, note is view-only (sent / posted documents). */
  readOnly?: boolean
}

/**
 * Per-document payment note for quotation / proforma / invoice PDFs.
 * Bank / M-Pesa lines always use company defaults — no per-document bank picker.
 */
export default function PaymentDetailsPicker({
  value,
  onChange,
  className = '',
  defaultOpen,
  label = 'Payment note',
  hint = 'Optional text printed under Payment Details on the PDF (quotes, proformas, and invoices). Company bank / M-Pesa defaults still apply.',
  readOnly = false,
}: Props) {
  const details = normalizeDocumentPaymentDetails(value)
  const note = details.customNote ?? ''
  const [open, setOpen] = useState(() =>
    defaultOpen ?? Boolean(normalizeDocumentPaymentDetails(value).customNote?.trim()),
  )

  const setNote = (customNote: string) => {
    onChange(normalizeDocumentPaymentDetails({
      useCompanyDefault: true,
      bankAccountIds: [],
      includeMpesa: true,
      customNote,
    }))
  }

  const preview = note.trim()
    ? note.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0]
    : 'No custom note — company payment defaults only'

  return (
    <div className={`border-t border-[var(--border-lt)] pt-3 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 text-left cursor-pointer group"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-[var(--text-2)]">{label}</p>
          {!open && (
            <p className="text-[10px] text-[var(--text-4)] mt-0.5 truncate">{preview}</p>
          )}
        </div>
        <Fa
          icon={faChevronDown}
          className={`text-[10px] text-[var(--text-4)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-[10px] text-[var(--text-4)]">{hint}</p>
          <label className="sr-only" htmlFor="document-payment-note">{label}</label>
          <textarea
            id="document-payment-note"
            className="form-input text-xs"
            rows={3}
            placeholder="e.g. Pay to NCBA 1005157785 · use this document number as reference"
            value={note}
            readOnly={readOnly}
            disabled={readOnly}
            onChange={e => {
              if (readOnly) return
              setNote(e.target.value)
            }}
          />
          {readOnly && (
            <p className="text-[10px] text-amber-700 font-semibold">Reset to draft to change the payment note.</p>
          )}
        </div>
      )}
    </div>
  )
}
