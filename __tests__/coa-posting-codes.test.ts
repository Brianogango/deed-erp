import { describe, expect, it } from 'vitest'
import { buildZeroBalanceCoaTemplate } from '@/lib/accounting/coa-template'
import { extractAccountCode } from '@/lib/accounting/ids'
import { COMPANY_ACCOUNT_FALLBACKS, CATEGORY_ACCOUNT_DEFAULTS } from '@/lib/product-accounts'
import { COA_ROLE_CODES } from '@/lib/accounting/coa-roles'
import { expenseAccountForCategory } from '@/lib/accounting/expense-pos-accounts'
import { FX_GAIN_ACCOUNT, FX_LOSS_ACCOUNT } from '@/lib/accounting/fx-journals'
import {
  ACCUM_DEPR_LABELS,
  DEPR_EXPENSE_LABEL,
  DISPOSAL_GAIN_LABEL,
  DISPOSAL_LOSS_LABEL,
  PPE_COST_LABELS,
} from '@/lib/company-property-ppe'

// Codes that posting references but which intentionally live only on the
// production chart (legacy cashbook banks, not part of the empty-DB template).
//
// 2210 was in here on the strength of that comment, and the comment was wrong:
// 2210 IS in the template, and the exemption was hiding the code most likely to
// be absent from a production chart built from the blob seed rather than the
// template — which would refuse every POS session close carrying M-Pesa takings.
// Only genuinely absent codes belong here, and each needs a reason.
const LIVE_ONLY = new Set(['2203'])

describe('posting-path account codes exist in the CoA template', () => {
  const templateCodes = new Set(buildZeroBalanceCoaTemplate().map(a => a.code))
  const expectPosted = (labelOrCode: string) => {
    const code = extractAccountCode(labelOrCode) ?? labelOrCode
    expect(
      templateCodes.has(code) || LIVE_ONLY.has(code),
      `account ${code} (${labelOrCode}) must be in the CoA template`,
    ).toBe(true)
  }

  it('covers company fallbacks and category defaults', () => {
    Object.values(COMPANY_ACCOUNT_FALLBACKS).forEach(expectPosted)
    for (const cat of Object.values(CATEGORY_ACCOUNT_DEFAULTS)) {
      Object.values(cat).forEach(v => {
        if (typeof v === 'string' && /^\d{4}$/.test(v)) expectPosted(v)
      })
    }
  })

  it('covers CoA role codes used by invoice/payroll/payment journals', () => {
    Object.values(COA_ROLE_CODES).forEach(expectPosted)
  })

  it('covers every expense category label', () => {
    for (const cat of ['courier', 'office_supplies', 'water', 'printing', 'transport', 'meals', 'utilities', 'software', 'hardware', 'maintenance', 'other']) {
      expectPosted(expenseAccountForCategory(cat))
    }
  })

  it('covers FX revaluation accounts', () => {
    expectPosted(FX_GAIN_ACCOUNT)
    expectPosted(FX_LOSS_ACCOUNT)
  })

  it('covers PPE cost, accumulated depreciation, and disposal accounts', () => {
    Object.values(PPE_COST_LABELS).forEach(expectPosted)
    Object.values(ACCUM_DEPR_LABELS).forEach(expectPosted)
    expectPosted(DEPR_EXPENSE_LABEL)
    expectPosted(DISPOSAL_GAIN_LABEL)
    expectPosted(DISPOSAL_LOSS_LABEL)
  })

  it('covers sales returns and opening balance equity', () => {
    expectPosted('5099 - Sales Returns & Refunds')
    expectPosted('4004 - Opening Balance Equity')
  })
})

/**
 * The six flows wired to POST /api/accounting/system-journals.
 *
 * These journals were built in the browser and only ever reached the ledger
 * through the blob mirror, which never validated an account against anything.
 * Now they go through resolveAccountId, which refuses the WHOLE entry on a
 * missing or inactive account — so for a POS session close, one absent code
 * loses the cash over/short posting along with the memo lines.
 *
 * Every code below is written as a literal rather than imported, because the
 * point is to catch someone changing a hardcoded label in lib/store.tsx to a
 * code the chart does not carry.
 */
describe('system-journal flows only reference accounts the chart carries', () => {
  const templateCodes = new Set(buildZeroBalanceCoaTemplate().map(a => a.code))
  const mustExist = (flow: string, labels: string[]) => {
    for (const label of labels) {
      const code = extractAccountCode(label) ?? label
      expect(
        templateCodes.has(code),
        `${flow} posts to ${code} (${label}), which is not in the CoA template`,
      ).toBe(true)
    }
  }

  it('POS session close', () => {
    // 2210 is hardcoded in closePOSSession rather than going through
    // bankAccountLabel, so it cannot fall back to 2211 if the chart lacks it.
    mustExist('POS session close', [
      '2211 - Petty Cash',
      '2210 - M-Pesa Paybill',
      '2201 - ABSA Bank',
      '2202 - Equity Bank',
      '6595 - Cash Over/Short',
    ])
  })

  it('RMA refund', () => {
    mustExist('RMA refund', [
      '5099 — Sales Returns & Refunds',
      '2211 - Petty Cash / Mobile Money',
      '2201 - ABSA Bank',
    ])
  })

  it('buy-back settled as store credit', () => {
    mustExist('buy-back store credit', ['6114 - Trade-in Purchases', '3313 - Customer Credits'])
  })

  it('credit note raised from a sale order', () => {
    mustExist('sale order credit note', [
      '5000 - Sales Revenue',
      '3301 - Output VAT Payable',
      '3313 - Customer Credits',
    ])
  })

  it('delivery charge added to a posted invoice', () => {
    mustExist('delivery charge adjustment', [
      '1800 - Accounts Receivable',
      '5000 - Sales Revenue',
      '3301 - Output VAT Payable',
    ])
  })

  it('fixed asset capitalisation from inventory', () => {
    mustExist('PPE capitalise from inventory', ['1200 — Inventory', '3000 — Accounts Payable'])
  })

  it('an em dash separator still yields the code', () => {
    // Several PPE and returns labels use an em dash rather than a hyphen.
    expect(extractAccountCode('5099 — Sales Returns & Refunds')).toBe('5099')
    expect(extractAccountCode('1200 — Inventory')).toBe('1200')
  })
})
