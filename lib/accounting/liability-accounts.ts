/**
 * Customer liability account codes.
 * 3100 = deposits / layby cash held (goods not yet collected)
 * 3102 = customer credits from cancelled paid invoices / credit notes
 *
 * Labels sourced from CoA role map (Finance Phase 1) — do not renumber.
 */

import { labelForRole } from '@/lib/accounting/coa-roles'

export const CUSTOMER_DEPOSITS_ACCOUNT = labelForRole('customer_deposits')
export const CUSTOMER_CREDITS_ACCOUNT = labelForRole('customer_credits')

export const CUSTOMER_DEPOSITS_CODE = '3100'
export const CUSTOMER_CREDITS_CODE = '3102'
