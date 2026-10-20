'use client'

import { goesToPurchases, suggestExpenseAccount } from '@/lib/accounting/bill-expense-accounts'
import type { Frequency } from '@/lib/recurring/recurring-bills'

type Account = { code: string; name: string }
type Line = { type?: string; desc: string; account?: string }

export type RepeatSettings = { enabled: boolean; frequency: Frequency; amountChanges: boolean }
export const NO_REPEAT: RepeatSettings = { enabled: false, frequency: 'monthly', amountChanges: false }

const label = (accounts: Account[], code: string) => {
  const a = accounts.find(x => x.code === code)
  return a ? `${a.code} ${a.name}` : code
}

/**
 * Under a vendor bill's lines: the vendor's usual expense account, a warning
 * when an overhead bill would land in Purchases, and the option to repeat it.
 */
export default function BillAccountGuide({
  vendorId, vendorName, lines, setLines, accounts, vendorDefault, canSetDefault, onSetDefault,
  vendorSuppliesStock, keepPurchases, setKeepPurchases, repeat, setRepeat, canRepeat,
}: {
  vendorId: string
  vendorName: string
  lines: Line[]
  setLines: (update: (prev: Line[]) => Line[]) => void
  accounts: Account[]
  vendorDefault?: string
  canSetDefault: boolean
  onSetDefault: (code: string) => void
  vendorSuppliesStock: boolean
  keepPurchases: boolean
  setKeepPurchases: (v: boolean) => void
  repeat: RepeatSettings
  setRepeat: (r: RepeatSettings) => void
  canRepeat: boolean
}) {
  if (!vendorId) return null
  const items = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.type !== 'section')
  const inPurchases = vendorSuppliesStock ? [] : items.filter(({ l }) => goesToPurchases(l.account))
  const setAccount = (index: number, code: string) =>
    setLines(prev => prev.map((x, j) => (j === index ? { ...x, account: code } : x)))
  const useForAll = (code: string) =>
    setLines(prev => prev.map(x => (x.type !== 'section' && goesToPurchases(x.account) ? { ...x, account: code } : x)))

  return (
    <div className="bill-account-guide">
      <div className="bill-account-guide__row">
        <span className="bill-account-guide__label">Usual expense account for {vendorName}</span>
        {canSetDefault ? (
          <select
            className="form-input text-xs"
            aria-label={`Usual expense account for ${vendorName}`}
            value={vendorDefault ?? ''}
            onChange={e => onSetDefault(e.target.value)}
          >
            <option value="">None set (lines start on Purchases)</option>
            {accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </select>
        ) : (
          <strong className="text-xs">{vendorDefault ? label(accounts, vendorDefault) : 'None set'}</strong>
        )}
        <span className="bill-account-guide__hint">Every new bill from this vendor starts with it.</span>
      </div>

      {inPurchases.length > 0 && (
        <div className="bill-account-guide__warn" role="alert">
          <p className="font-bold">
            {inPurchases.length === items.length ? 'This bill goes' : `${inPurchases.length} line${inPurchases.length === 1 ? '' : 's'} go`} to Purchases (stock bought for resale).
          </p>
          <p>
            {vendorName} has no purchase orders, so this looks like an overhead. Rent, power, water and internet belong in an
            operating expense account, or they show up as cost of sales.
          </p>
          <ul>
            {inPurchases.map(({ l, i }) => {
              const hint = suggestExpenseAccount(l.desc, vendorName)
              return (
                <li key={i}>
                  <span>{l.desc.trim() || `Line ${i + 1}`}</span>
                  {hint && accounts.some(a => a.code === hint) && (
                    <button type="button" className="btn-outline text-[11px]" onClick={() => setAccount(i, hint)}>
                      Use {label(accounts, hint)}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {vendorDefault && !goesToPurchases(vendorDefault) && (
            <button type="button" className="btn-outline text-[11px]" onClick={() => useForAll(vendorDefault)}>
              Use {label(accounts, vendorDefault)} for all
            </button>
          )}
          <label className="bill-account-guide__keep">
            <input type="checkbox" checked={keepPurchases} onChange={e => setKeepPurchases(e.target.checked)} />
            These are stock for resale, keep Purchases
          </label>
        </div>
      )}

      {canRepeat && (
        <div className="bill-account-guide__repeat">
          <label className="bill-account-guide__keep">
            <input type="checkbox" checked={repeat.enabled} onChange={e => setRepeat({ ...repeat, enabled: e.target.checked })} />
            Repeat this bill
          </label>
          {repeat.enabled && (
            <>
              <select
                className="form-input text-xs"
                aria-label="How often"
                value={repeat.frequency}
                onChange={e => setRepeat({ ...repeat, frequency: e.target.value as Frequency })}
              >
                <option value="monthly">Every month</option>
                <option value="quarterly">Every quarter</option>
                <option value="yearly">Every year</option>
              </select>
              <label className="bill-account-guide__keep">
                <input type="checkbox" checked={repeat.amountChanges} onChange={e => setRepeat({ ...repeat, amountChanges: e.target.checked })} />
                Amount changes each time (electricity, water)
              </label>
              <span className="bill-account-guide__hint">
                On this day each period Finance is notified, and the next draft is one click under Bills → Recurring bills.
                {repeat.amountChanges ? ' You type that period’s amount from the vendor’s invoice.' : ' Same lines and amounts as this bill.'}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
