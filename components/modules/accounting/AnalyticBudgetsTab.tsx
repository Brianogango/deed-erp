'use client'

import { useEffect, useState } from 'react'

type Analytic = { id: string; code: string; name: string; isActive: boolean }
type Budget = { id: string; name: string; dateFrom: string; dateTo: string; state: string; lines: Array<{ plannedAmount: string | number; accountCode: string; analyticAccount: Analytic }> }

export default function AnalyticBudgetsTab() {
  const [analytics, setAnalytics] = useState<Analytic[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [message, setMessage] = useState('')
  const [account, setAccount] = useState({ code: '', name: '' })
  const [budget, setBudget] = useState({ name: '', dateFrom: '', dateTo: '', analyticAccountId: '', accountCode: '', plannedAmount: '' })

  async function load() {
    const [a, b] = await Promise.all([fetch('/api/accounting/analytic-accounts'), fetch('/api/accounting/analytic-budgets')])
    if (a.ok) setAnalytics((await a.json()).analyticAccounts || [])
    if (b.ok) setBudgets((await b.json()).budgets || [])
  }
  useEffect(() => { void load() }, [])

  async function createAccount(e: React.FormEvent) {
    e.preventDefault(); setMessage('')
    const res = await fetch('/api/accounting/analytic-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) })
    const data = await res.json()
    if (!res.ok) return setMessage(data.error || 'Unable to create analytic account')
    setAccount({ code: '', name: '' }); setMessage('Analytic account created'); await load()
  }

  async function createBudget(e: React.FormEvent) {
    e.preventDefault(); setMessage('')
    const payload = { name: budget.name, dateFrom: budget.dateFrom, dateTo: budget.dateTo, lines: [{ analyticAccountId: budget.analyticAccountId, accountCode: budget.accountCode, plannedAmount: Number(budget.plannedAmount) }] }
    const res = await fetch('/api/accounting/analytic-budgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) return setMessage(data.error || 'Unable to create budget')
    setBudget({ name: '', dateFrom: '', dateTo: '', analyticAccountId: '', accountCode: '', plannedAmount: '' }); setMessage('Budget created'); await load()
  }

  return <div className="p-4 sm:p-6 space-y-6">
    <div><h2 className="text-lg font-black">Analytic accounting & budgets</h2><p className="text-xs text-[var(--text-3)]">Track posted journal actuals by department, project, branch, or cost centre. All dates and amounts must be entered.</p></div>
    {message && <p role="status" className="text-xs font-bold">{message}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={createAccount} className="card p-5 space-y-3">
        <h3 className="font-bold">New analytic account</h3>
        <input required className="form-input w-full" placeholder="Code" value={account.code} onChange={e=>setAccount({...account,code:e.target.value})}/>
        <input required className="form-input w-full" placeholder="Name" value={account.name} onChange={e=>setAccount({...account,name:e.target.value})}/>
        <button className="btn-primary" type="submit">Create analytic account</button>
      </form>
      <form onSubmit={createBudget} className="card p-5 space-y-3">
        <h3 className="font-bold">New budget line</h3>
        <input required className="form-input w-full" placeholder="Budget name" value={budget.name} onChange={e=>setBudget({...budget,name:e.target.value})}/>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">Start date<input required type="date" className="form-input w-full" value={budget.dateFrom} onChange={e=>setBudget({...budget,dateFrom:e.target.value})}/></label>
          <label className="text-xs">End date<input required type="date" className="form-input w-full" value={budget.dateTo} onChange={e=>setBudget({...budget,dateTo:e.target.value})}/></label>
        </div>
        <select required className="form-select w-full" value={budget.analyticAccountId} onChange={e=>setBudget({...budget,analyticAccountId:e.target.value})}><option value="">Choose analytic account</option>{analytics.filter(a=>a.isActive).map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select>
        <input required className="form-input w-full" placeholder="General ledger account code" value={budget.accountCode} onChange={e=>setBudget({...budget,accountCode:e.target.value})}/>
        <input required min="0" step="0.01" type="number" className="form-input w-full" placeholder="Planned amount (KES)" value={budget.plannedAmount} onChange={e=>setBudget({...budget,plannedAmount:e.target.value})}/>
        <button className="btn-primary" type="submit">Create budget</button>
      </form>
    </div>
    <div className="card overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left"><th className="p-3">Budget</th><th>Period</th><th>Dimension</th><th>GL account</th><th className="text-right p-3">Planned</th></tr></thead><tbody>{budgets.flatMap(b=>b.lines.map((l,i)=><tr key={b.id+String(i)} className="border-t border-[var(--border-lt)]"><td className="p-3 font-bold">{b.name}</td><td>{String(b.dateFrom).slice(0,10)} – {String(b.dateTo).slice(0,10)}</td><td>{l.analyticAccount.code} — {l.analyticAccount.name}</td><td>{l.accountCode}</td><td className="p-3 text-right font-mono">KES {Number(l.plannedAmount).toLocaleString()}</td></tr>))}</tbody></table></div>
  </div>
}
