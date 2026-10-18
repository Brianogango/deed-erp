'use client'

import { useEffect, useMemo, useState } from 'react'
import { fmtKes } from '@/lib/store'
import type { CrmReport } from '@/lib/crm/crm-report'

type Period = 'month' | '30d' | 'quarter' | 'year' | 'custom'

const iso = (d: Date) => d.toISOString().slice(0, 10)

function periodRange(p: Period): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  if (p === '30d') return { from: iso(new Date(now.getTime() - 29 * 86_400_000)), to: iso(now) }
  if (p === 'quarter') return { from: iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to: iso(now) }
  if (p === 'year') return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(now) }
  return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) }
}

const STAGE_LABEL: Record<string, string> = {
  prospecting: 'Prospecting', qualification: 'Qualification', proposal: 'Proposal',
  negotiation: 'Negotiation', on_hold: 'On hold', new: 'New',
}

function hours(h: number | null) {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${Math.round(h * 10) / 10} h`
  return `${Math.round(h / 24)} days`
}
const rate = (v: number | null) => (v === null ? '—' : `${v}%`)

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] px-4 py-3">
      <p className="text-[10px] uppercase font-bold text-t4">{label}</p>
      <p className="text-[13px] font-black mt-1" style={{ color: tone === 'bad' ? 'var(--danger)' : tone === 'good' ? 'var(--success)' : 'var(--text-1)' }}>{value}</p>
      {hint && <p className="text-[10px] text-t3 mt-0.5">{hint}</p>}
    </div>
  )
}

function Table({ title, head, rows, empty }: { title: string; head: string[]; rows: (string | number)[][]; empty: string }) {
  return (
    <section className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-card)] overflow-hidden">
      <h3 className="m-0 px-4 py-3 text-[12px] font-bold text-t1 border-b border-[var(--border-lt)] bg-[var(--bg-surface)]">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-[11px] text-t3">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr>{head.map((h, i) => <th key={h} className={`px-4 py-2 font-semibold text-t3 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-[var(--border-lt)]">
                  {r.map((c, ci) => <td key={ci} className={`px-4 py-2 ${ci ? 'text-right tabular-nums' : 'text-left text-t1 font-medium'}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * How leads became sales in a period: conversion, how fast each rep answered,
 * win rate and why business was lost. A rep sees their own numbers.
 */
export default function CrmReportPanel({ users }: { users: Array<{ id: string; name: string }> }) {
  const [period, setPeriod] = useState<Period>('month')
  const [range, setRange] = useState(periodRange('month'))
  const [report, setReport] = useState<CrmReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const names = useMemo(() => new Map(users.map(u => [u.id, u.name])), [users])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    fetch(`/api/crm/report?from=${range.from}&to=${range.to}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not load the report')
        if (live) setReport(data)
      })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : 'Could not load the report') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [range.from, range.to])

  const choose = (p: Period) => {
    setPeriod(p)
    if (p !== 'custom') setRange(periodRange(p))
  }

  const r = report
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {([['month', 'This month'], ['30d', 'Last 30 days'], ['quarter', 'This quarter'], ['year', 'This year'], ['custom', 'Custom']] as const).map(([p, label]) => (
          <button key={p} type="button" className={period === p ? 'btn-primary text-[11px] py-1.5 px-3' : 'btn-outline text-[11px] py-1.5 px-3'} onClick={() => choose(p)}>{label}</button>
        ))}
        {period === 'custom' && (
          <span className="flex items-center gap-2 text-[11px]">
            <input type="date" aria-label="From" className="form-input text-[11px]" value={range.from} onChange={e => setRange(v => ({ ...v, from: e.target.value }))} />
            to
            <input type="date" aria-label="To" className="form-input text-[11px]" value={range.to} onChange={e => setRange(v => ({ ...v, to: e.target.value }))} />
          </span>
        )}
        {loading && <span className="text-[11px] text-t3">Loading…</span>}
      </div>

      {error && <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Leads in" value={String(r.leads.created)} hint={`${r.leads.converted} converted · ${r.leads.lost} lost${r.leads.unassigned ? ` · ${r.leads.unassigned} unassigned` : ''}`} />
            <Tile label="Lead → deal" value={rate(r.leads.conversionRate)} hint="Leads converted into a deal" />
            <Tile label="First response" value={hours(r.leads.medianFirstResponseHours)} hint={`Median · ${rate(r.leads.contactedWithin24h)} contacted within 24 h`} />
            <Tile label="Never contacted" value={String(r.leads.neverContacted)} hint="Open leads with no call, email or message" tone={r.leads.neverContacted ? 'bad' : undefined} />
            <Tile label="Deals won" value={fmtKes(r.deals.wonValue)} hint={`${r.deals.won} deal${r.deals.won === 1 ? '' : 's'}`} tone={r.deals.won ? 'good' : undefined} />
            <Tile label="Win rate" value={rate(r.deals.winRate)} hint={`${r.deals.won} won · ${r.deals.lost} lost (${fmtKes(r.deals.lostValue)})`} />
            <Tile label="Time to close" value={r.deals.medianDaysToClose === null ? '—' : `${Math.round(r.deals.medianDaysToClose)} days`} hint="Median, deal opened → won" />
            <Tile label="Open pipeline" value={fmtKes(r.deals.openValue)} hint={`${r.deals.openCount} open deal${r.deals.openCount === 1 ? '' : 's'} (today)`} />
          </div>

          <Table
            title="By rep"
            head={['Rep', 'Leads', 'Not contacted', 'First response', 'Within 24 h', 'Converted', 'Won', 'Lost', 'Win rate', 'Won value']}
            rows={r.byRep.map(x => [
              names.get(x.id) ?? x.name, x.leads, x.notContacted, hours(x.medianFirstResponseHours), rate(x.contactedWithin24h),
              x.converted, x.dealsWon, x.dealsLost, rate(x.winRate), fmtKes(x.wonValue),
            ])}
            empty="No leads or closed deals in this period."
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Table
              title="Where leads come from"
              head={['Source', 'Leads', 'Converted', 'Rate']}
              rows={r.leads.bySource.map(s => [s.source.replace(/_/g, ' '), s.leads, s.converted, rate(s.conversionRate)])}
              empty="No leads in this period."
            />
            <Table
              title="Open pipeline by stage"
              head={['Stage', 'Deals', 'Value']}
              rows={r.deals.pipeline.map(p => [STAGE_LABEL[p.stage] ?? p.stage.replace(/_/g, ' '), p.deals, fmtKes(p.value)])}
              empty="No open deals."
            />
            <Table
              title="Why deals were lost"
              head={['Reason', 'Deals']}
              rows={r.deals.lostReasons.map(x => [x.reason, x.count])}
              empty="No deals lost in this period."
            />
            <Table
              title="Why leads were lost"
              head={['Reason', 'Leads']}
              rows={r.leads.lostReasons.map(x => [x.reason, x.count])}
              empty="No leads marked lost in this period."
            />
          </div>
        </>
      )}
    </div>
  )
}
