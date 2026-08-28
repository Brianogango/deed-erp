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
const LIVE_ONLY = new Set(['2210', '2203'])

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
