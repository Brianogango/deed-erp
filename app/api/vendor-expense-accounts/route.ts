import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import {
  VENDOR_EXPENSE_ACCOUNTS_KEY, cleanVendorExpenseAccounts, isBillExpenseCode,
} from '@/lib/accounting/bill-expense-accounts'

export const dynamic = 'force-dynamic'

// Who writes bills reads the defaults; setting one is Finance's call.
const READ_ROLES = ['director', 'finance_officer', 'admin_officer']
const WRITE_ROLES = ['director', 'finance_officer']

async function read() {
  const state = await loadAppState([VENDOR_EXPENSE_ACCOUNTS_KEY])
  return cleanVendorExpenseAccounts(state[VENDOR_EXPENSE_ACCOUNTS_KEY])
}

/** GET /api/vendor-expense-accounts — { accounts: { [vendorId]: '6508' } } */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(READ_ROLES)
    return NextResponse.json({ accounts: await read() })
  })
}

/** PUT { vendorId, accountCode } — set a vendor's default; accountCode '' clears it. */
export async function PUT(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json().catch(() => ({})) as { vendorId?: unknown; accountCode?: unknown }
    const vendorId = String(body.vendorId ?? '').trim()
    const accountCode = String(body.accountCode ?? '').trim()
    if (!vendorId) return NextResponse.json({ error: 'Choose the vendor' }, { status: 422 })
    if (accountCode && !isBillExpenseCode(accountCode)) {
      return NextResponse.json({ error: 'Pick an expense account (6xxx)' }, { status: 422 })
    }
    const accounts = await withAppStateKeyLock(VENDOR_EXPENSE_ACCOUNTS_KEY, async () => {
      const current = await read()
      if (accountCode) current[vendorId] = accountCode
      else delete current[vendorId]
      await saveStoreKeys({ [VENDOR_EXPENSE_ACCOUNTS_KEY]: JSON.stringify(current) })
      return current
    })
    return NextResponse.json({ accounts })
  })
}
