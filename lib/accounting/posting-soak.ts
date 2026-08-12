/**
 * Posting engine soak tooling (Finance Phase 10).
 * Read-only checklist — does NOT enable ACCOUNTING_POSTING_ENGINE.
 * Pure helpers for admin/soak report.
 */

import { isAccountingPostingEngineEnabled } from '@/lib/accounting/posting-flag'
import {
  assertPostingBalanced,
  buildCustomerInvoiceLines,
  buildExpenseApprovalLines,
  buildPosSaleLines,
  resolvePostingAccountLabel,
} from '@/lib/accounting/posting-service'

export type PostingEngineSurface = {
  id: string
  label: string
  path: string
  phase: string
}

/** Wired call sites when the engine flag is on (Phases 1–7). */
export const POSTING_ENGINE_SURFACES: PostingEngineSurface[] = [
  { id: 'customer_invoice', label: 'Customer invoice post', path: 'invoice-journals / postCustomerInvoice', phase: '1' },
  { id: 'vendor_bill', label: 'Vendor bill post', path: 'invoice-journals / postVendorBill', phase: '3' },
  { id: 'payment', label: 'Invoice payment', path: 'payments API / postInvoicePayment', phase: '1–2' },
  { id: 'outstanding', label: 'Outstanding allocate', path: 'payments allocations / postAllocateOutstanding', phase: '2' },
  { id: 'stock', label: 'Stock valuation STK', path: 'valuation-service / postStockJournal', phase: '4' },
  { id: 'bank_recon', label: 'Bank charge / interest', path: 'bank-recon/adjustments', phase: '5' },
  { id: 'expense', label: 'Expense approve / reimburse', path: 'expenses/post-journal', phase: '7' },
  { id: 'pos', label: 'POS sale journal', path: 'pos/post-sale-journal', phase: '7' },
]

export type PostingEngineSoakReport = {
  enabled: boolean
  defaultOff: true
  envVar: 'ACCOUNTING_POSTING_ENGINE'
  surfaces: PostingEngineSurface[]
  builderSelfCheck: { ok: boolean; samples: number; error?: string }
  guidance: string[]
  note: string
}

function runBuilderSelfCheck(): { ok: boolean; samples: number; error?: string } {
  try {
    const samples = [
      buildCustomerInvoiceLines({
        partnerName: 'Soak',
        ref: 'SOAK-INV',
        total: 1160,
        subtotal: 1000,
        tax: 160,
        revenueAccountLabel: '5000 - Sales Revenue',
      }),
      buildExpenseApprovalLines({
        amount: 500,
        ref: 'SOAK-EXP',
        description: 'Soak',
        category: 'transport',
        paymentMethod: 'reimbursement',
        submittedByName: 'Soak',
      }),
      buildPosSaleLines({
        total: 1160,
        subtotal: 1000,
        tax: 160,
        orderRef: 'SOAK-POS',
        paymentMethod: 'mpesa',
      }),
    ]
    for (const lines of samples) {
      const resolved = lines.map(l => ({
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        account: resolvePostingAccountLabel(l),
      }))
      assertPostingBalanced(resolved)
    }
    return { ok: true, samples: samples.length }
  } catch (err) {
    return {
      ok: false,
      samples: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function buildPostingEngineSoakReport(opts?: {
  enabled?: boolean
}): PostingEngineSoakReport {
  const enabled = opts?.enabled ?? isAccountingPostingEngineEnabled()
  const builderSelfCheck = runBuilderSelfCheck()
  const guidance = enabled
    ? [
        'Flag is ON — dual-write engine paths are active.',
        'Smoke: post invoice, register payment, expense approve, POS sale; then GET /api/admin/journal-parity.',
        'If parity drifts, set ACCOUNTING_POSTING_ENGINE=false and restart; investigate before re-enable.',
      ]
    : [
        'Flag is OFF (default) — blob / legacy persist paths remain live.',
        'Staging soak only: set ACCOUNTING_POSTING_ENGINE=true in the process env, restart the app, run smokes, re-check journal parity.',
        'Do not commit secrets or flip the default in .env.example / production without Finance sign-off.',
      ]

  return {
    enabled,
    defaultOff: true,
    envVar: 'ACCOUNTING_POSTING_ENGINE',
    surfaces: POSTING_ENGINE_SURFACES,
    builderSelfCheck,
    guidance,
    note: 'Soak tooling is read-only. This report never enables the engine.',
  }
}
