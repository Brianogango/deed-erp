'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes, useFinanceStore } from '@/lib/store'
import { customerCreditBalance } from '@/lib/customer-credit-view'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { financeInvoicePath } from '@/lib/finance-invoice'
import {
  AGING_LABELS, belongsToPartner, buildPartnerLedger, buildPartnerSummaries,
  type AgingBucket, type LedgerDoc, type LedgerLine, type LedgerSide, type OpenItem, type PartnerSummary,
} from '@/lib/accounting/partner-ledger'

const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => `${today().slice(0, 8)}01`
const yearStart = () => `${today().slice(0, 4)}-01-01`
const BUCKETS: AgingBucket[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90']

const KIND_LABEL: Record<LedgerLine['kind'], string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  credit_note: 'Credit note',
  payment: 'Payment',
  refund: 'Refund',
  cancellation: 'Cancelled',
  credit_applied: 'Credit used',
}

const words = (side: LedgerSide) => side === 'customer'
  ? { charge: 'Invoiced', payment: 'Received', owed: 'Customer owes us', owedShort: 'Owed to us', party: 'Customers', one: 'customer', credit: 'Store credit' }
  : { charge: 'Billed', payment: 'Paid', owed: 'We owe supplier', owedShort: 'We owe', party: 'Suppliers', one: 'supplier', credit: 'Supplier credit not used' }

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: 'due' | 'ok' | 'warn' | 'muted'; hint?: string }) {
  return (
    <div className={`partner-ledger__kpi${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <em>{hint}</em>}
    </div>
  )
}

function Aging({ aging, total }: { aging: Record<AgingBucket, number>; total: number }) {
  return (
    <div className="partner-ledger__aging" aria-label="Aging of what is owed">
      {BUCKETS.map(b => (
        <div key={b} className={`partner-ledger__bucket is-${b}`}>
          <span>{AGING_LABELS[b]}</span>
          <strong>{fmtKes(aging[b])}</strong>
          <i style={{ width: `${total > 0 ? Math.round((aging[b] / total) * 100) : 0}%` }} />
        </div>
      ))}
    </div>
  )
}

export default function PartnerLedgerTab() {
  const { allInvoices, contacts, plPartner, setPlPartner, plDateFrom, setPlDateFrom, plDateTo, setPlDateTo } = useAccounting()
  const { customerCredits, deposits, companySettings, bankAccounts, showToast } = useFinanceStore()
  const [downloading, setDownloading] = useState(false)
  const router = useRouter()
  const [overviewSide, setOverviewSide] = useState<LedgerSide>('customer')
  const [sideChoice, setSideChoice] = useState<LedgerSide | null>(null)
  const [view, setView] = useState<'statement' | 'open'>('statement')
  const [showSettled, setShowSettled] = useState(false)
  const [pick, setPick] = useState('')

  const docs = allInvoices as unknown as LedgerDoc[]
  const summaries = useMemo(() => buildPartnerSummaries(docs, today()), [docs])

  // The chosen partner: the URL holds a contact id, or a name for older links.
  const partner = useMemo(() => {
    const key = plPartner.trim()
    if (!key) return null
    const contact = contacts.find(c => c.id === key) ?? contacts.find(c => c.name.trim().toLowerCase() === key.toLowerCase())
    const summary = summaries.find(s => s.partnerId === key) ?? summaries.find(s => s.name.trim().toLowerCase() === key.toLowerCase())
    const name = contact?.name ?? summary?.name ?? key
    return { id: contact?.id ?? summary?.partnerId ?? null, name, contact }
  }, [plPartner, contacts, summaries])

  const partnerDocs = useMemo(
    () => (partner ? docs.filter(d => belongsToPartner(d, partner)) : []),
    [docs, partner],
  )
  const hasCustomer = partnerDocs.some(d => d.type === 'customer_invoice')
  const hasSupplier = partnerDocs.some(d => d.type === 'vendor_bill')
  const side: LedgerSide = sideChoice && (sideChoice === 'customer' ? hasCustomer : hasSupplier)
    ? sideChoice
    : hasCustomer ? 'customer' : 'supplier'
  const w = words(side)

  const ledger = useMemo(
    () => buildPartnerLedger({ docs: partnerDocs, side, from: plDateFrom, to: plDateTo, asOf: today() }),
    [partnerDocs, side, plDateFrom, plDateTo],
  )

  const storeCredit = partner?.id && side === 'customer' ? customerCreditBalance(customerCredits, partner.id) : 0
  const depositsHeld = partner?.id && side === 'customer'
    ? (deposits ?? [])
        .filter(d => d.customerId === partner.id && ['active', 'partially_paid', 'fully_paid'].includes(d.status))
        .reduce((s, d) => s + (Number(d.totalPaid) || 0), 0)
    : 0

  const selectPartner = (s: { partnerId: string | null; name: string; side?: LedgerSide }) => {
    setPlPartner(s.partnerId ?? s.name)
    setSideChoice(s.side ?? null)
    setView('statement')
    setPick('')
  }

  const pickOptions = useMemo(() => {
    const seen = new Set<string>()
    return summaries.filter(s => (seen.has(s.name) ? false : (seen.add(s.name), true))).map(s => s.name).sort((a, b) => a.localeCompare(b))
  }, [summaries])

  const onPick = (value: string) => {
    setPick(value)
    const hit = summaries.find(s => s.name.trim().toLowerCase() === value.trim().toLowerCase())
    if (hit) selectPartner(hit)
  }

  const periodLabel = plDateFrom || plDateTo
    ? `${plDateFrom ? fmtDate(plDateFrom) : 'Start'} – ${plDateTo ? fmtDate(plDateTo) : 'today'}`
    : 'All time'

  const toolbar = (
    <div className="partner-ledger__toolbar">
      <input
        className="form-input text-[12px] py-1.5 min-w-[240px]"
        list="partner-ledger-options"
        value={pick}
        onChange={e => onPick(e.target.value)}
        placeholder={partner ? 'Switch to another customer or supplier…' : 'Find a customer or supplier…'}
        aria-label="Find a customer or supplier"
      />
      <datalist id="partner-ledger-options">
        {pickOptions.map(n => <option key={n} value={n} />)}
      </datalist>
      {partner && (
        <>
          <div className="partner-ledger__periods" role="group" aria-label="Period">
            <button type="button" className={!plDateFrom && !plDateTo ? 'is-on' : ''} onClick={() => { setPlDateFrom(''); setPlDateTo('') }}>All time</button>
            <button type="button" className={plDateFrom === monthStart() && !plDateTo ? 'is-on' : ''} onClick={() => { setPlDateFrom(monthStart()); setPlDateTo('') }}>This month</button>
            <button type="button" className={plDateFrom === yearStart() && !plDateTo ? 'is-on' : ''} onClick={() => { setPlDateFrom(yearStart()); setPlDateTo('') }}>This year</button>
          </div>
          <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 134 }} value={plDateFrom} onChange={e => setPlDateFrom(e.target.value)} aria-label="From" title="From" />
          <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 134 }} value={plDateTo} onChange={e => setPlDateTo(e.target.value)} aria-label="To" title="To" />
          <button type="button" className="btn-secondary text-[11px] ml-auto" onClick={() => { setPlPartner(''); setSideChoice(null) }}>All {words(side).party.toLowerCase()}</button>
        </>
      )}
    </div>
  )

  // ── Overview: everyone with money open ────────────────────────────────────
  if (!partner) {
    const rows = summaries.filter(s => s.side === overviewSide && (showSettled || s.outstanding > 0.005 || s.unappliedCredit > 0.005))
    const ow = words(overviewSide)
    const sum = (k: keyof Pick<PartnerSummary, 'outstanding' | 'overdue' | 'over90' | 'unappliedCredit'>) => rows.reduce((s, r) => s + r[k], 0)
    const overviewColumns: ColumnDef<PartnerSummary>[] = [
      { key: 'name', label: overviewSide === 'customer' ? 'Customer' : 'Supplier', priority: 1, width: '1.6fr',
        render: r => <span className="text-[12px] font-semibold text-t1">{r.name}</span>, exportValue: r => r.name,
        footer: () => <span className="text-[11px] font-bold">{rows.length} {rows.length === 1 ? ow.one : ow.party.toLowerCase()}</span> },
      { key: 'open', label: 'Open docs', priority: 2, width: '90px', align: 'right',
        render: r => <span className="text-[11px] tabular-nums">{r.openCount || '—'}</span>, exportValue: r => r.openCount },
      { key: 'outstanding', label: ow.owedShort, priority: 1, width: '130px', align: 'right',
        render: r => <span className="font-mono text-[12px] font-semibold">{fmtKes(r.outstanding)}</span>, exportValue: r => r.outstanding,
        footer: () => <span className="font-mono text-[11px] font-bold">{fmtKes(sum('outstanding'))}</span> },
      { key: 'overdue', label: 'Overdue', priority: 1, width: '120px', align: 'right',
        render: r => <span className={`font-mono text-[12px] ${r.overdue > 0 ? 'text-red-600 font-semibold' : 'text-t4'}`}>{r.overdue > 0 ? fmtKes(r.overdue) : '—'}</span>, exportValue: r => r.overdue,
        footer: () => <span className="font-mono text-[11px] font-bold text-red-600">{fmtKes(sum('overdue'))}</span> },
      { key: 'over90', label: 'Over 90 days', priority: 2, width: '120px', align: 'right',
        render: r => <span className={`font-mono text-[11px] ${r.over90 > 0 ? 'text-red-700 font-semibold' : 'text-t4'}`}>{r.over90 > 0 ? fmtKes(r.over90) : '—'}</span>, exportValue: r => r.over90,
        footer: () => <span className="font-mono text-[11px] font-bold">{fmtKes(sum('over90'))}</span> },
      { key: 'credit', label: overviewSide === 'customer' ? 'Credit notes open' : 'Credit not used', priority: 3, width: '120px', align: 'right',
        render: r => <span className="font-mono text-[11px]">{r.unappliedCredit > 0 ? fmtKes(r.unappliedCredit) : '—'}</span>, exportValue: r => r.unappliedCredit },
      { key: 'oldest', label: 'Oldest due', priority: 2, width: '105px',
        render: r => <span className="text-[11px] text-t3">{r.oldestDue ? fmtDate(r.oldestDue) : '—'}</span>, exportValue: r => r.oldestDue ?? '' },
      { key: 'last', label: 'Last activity', priority: 3, width: '105px',
        render: r => <span className="text-[11px] text-t3">{r.lastActivity ? fmtDate(r.lastActivity) : '—'}</span>, exportValue: r => r.lastActivity },
    ]
    const allSide = summaries.filter(s => s.side === overviewSide)
    const total = allSide.reduce((s, r) => s + r.outstanding, 0)
    const aging: Record<AgingBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 }
    for (const s of allSide) BUCKETS.forEach(b => { aging[b] += s.aging[b] })
    return (
      <div className="partner-ledger">
        {toolbar}
        <div className="partner-ledger__tabs" role="tablist">
          {(['customer', 'supplier'] as LedgerSide[]).map(s => (
            <button key={s} type="button" role="tab" aria-selected={overviewSide === s} className={overviewSide === s ? 'is-on' : ''} onClick={() => setOverviewSide(s)}>
              {s === 'customer' ? 'Customers (receivable)' : 'Suppliers (payable)'}
            </button>
          ))}
        </div>
        <div className="partner-ledger__kpis">
          <Kpi label={overviewSide === 'customer' ? 'Total owed to us' : 'Total we owe'} value={fmtKes(total)} tone="due" />
          <Kpi label="Overdue" value={fmtKes(total - aging.current)} tone={total - aging.current > 0 ? 'due' : 'ok'} />
          <Kpi label="Over 90 days" value={fmtKes(aging.d90)} tone={aging.d90 > 0 ? 'warn' : 'muted'} />
          <Kpi label={overviewSide === 'customer' ? 'Customers owing' : 'Suppliers to pay'} value={String(allSide.filter(s => s.outstanding > 0.005).length)} />
          <Kpi label={overviewSide === 'customer' ? 'Credit notes open' : 'Supplier credit not used'} value={fmtKes(allSide.reduce((s, r) => s + r.unappliedCredit, 0))} tone="muted" />
        </div>
        <Aging aging={aging} total={total} />
        <div className="partner-ledger__bar">
          <label className="partner-ledger__check">
            <input type="checkbox" checked={showSettled} onChange={e => setShowSettled(e.target.checked)} />
            Include settled {ow.party.toLowerCase()}
          </label>
        </div>
        <DataTable
          tableId={`partner-ledger-overview-${overviewSide}`}
          columns={overviewColumns}
          rows={rows}
          rowKey={r => r.key}
          onRowClick={r => selectPartner(r)}
          rowLabel={r => r.name}
          searchPlaceholder={`Search ${ow.party.toLowerCase()}…`}
          emptyMessage={`No ${ow.party.toLowerCase()} with an open balance`}
          exportTitle={overviewSide === 'customer' ? 'Customer balances' : 'Supplier balances'}
          exportFilename={overviewSide === 'customer' ? 'customer-balances' : 'supplier-balances'}
        />
      </div>
    )
  }

  // ── One partner's statement ───────────────────────────────────────────────
  const openDoc = (id: string) => router.push(financeInvoicePath(id))
  const statementRows: LedgerLine[] = plDateFrom
    ? [{
        id: 'opening', date: plDateFrom, kind: 'payment', documentId: '', documentRef: '', reference: '',
        description: 'Balance brought forward', charge: 0, payment: 0, balance: ledger.opening, cleared: true, infoOnly: true,
      }, ...ledger.lines]
    : ledger.lines

  const statementColumns: ColumnDef<LedgerLine>[] = [
    { key: 'date', label: 'Date', priority: 1, width: '96px',
      render: l => <span className="text-[11px] text-t3">{fmtDate(l.date)}</span>, exportValue: l => l.date },
    { key: 'kind', label: 'Type', priority: 1, width: '100px',
      render: l => l.id === 'opening' ? <span className="text-[11px] text-t4">—</span>
        : <span className={`partner-ledger__kind is-${l.kind}`}>{KIND_LABEL[l.kind]}</span>,
      exportValue: l => (l.id === 'opening' ? '' : KIND_LABEL[l.kind]) },
    { key: 'doc', label: 'Document', priority: 1, width: '120px',
      render: l => <span className="font-mono text-[11px] text-t1">{l.documentRef}</span>, exportValue: l => l.documentRef },
    { key: 'desc', label: 'Details', priority: 2, width: '1.8fr',
      render: l => <span className={`text-[11px] ${l.id === 'opening' ? 'font-semibold text-t1' : 'text-t2'}`}>{l.description}{!l.cleared && <span className="partner-ledger__flag">Not cleared</span>}</span>,
      exportValue: l => l.description },
    { key: 'charge', label: w.charge, priority: 1, width: '115px', align: 'right',
      render: l => <span className="font-mono text-[11px]">{l.charge ? fmtKes(l.charge) : ''}</span>, exportValue: l => l.charge || '',
      footer: () => <span className="font-mono text-[11px] font-bold">{fmtKes(ledger.periodCharges)}</span> },
    { key: 'payment', label: w.payment, priority: 1, width: '115px', align: 'right',
      render: l => <span className={`font-mono text-[11px] ${l.infoOnly && l.id !== 'opening' ? 'text-t4' : ''}`}>{l.payment ? fmtKes(l.payment) : l.infoOnly && l.id !== 'opening' ? 'no money moved' : ''}</span>,
      exportValue: l => l.payment || '',
      footer: () => <span className="font-mono text-[11px] font-bold">{fmtKes(ledger.periodPayments)}</span> },
    { key: 'balance', label: 'Balance', priority: 1, width: '120px', align: 'right',
      render: l => <span className={`font-mono text-[11px] font-semibold ${l.balance < 0 ? 'text-emerald-600' : 'text-t1'}`}>{fmtKes(l.balance)}</span>,
      exportValue: l => l.balance,
      footer: () => <span className="font-mono text-[11px] font-bold">{fmtKes(ledger.closing)}</span> },
  ]

  const openColumns: ColumnDef<OpenItem>[] = [
    { key: 'ref', label: 'Document', priority: 1, width: '130px',
      render: o => <span className="font-mono text-[11px] text-t1">{o.ref}</span>, exportValue: o => o.ref,
      footer: () => <span className="text-[11px] font-bold">{ledger.openItems.length} open</span> },
    { key: 'date', label: 'Date', priority: 2, width: '96px', render: o => <span className="text-[11px] text-t3">{fmtDate(o.date)}</span>, exportValue: o => o.date },
    { key: 'due', label: 'Due', priority: 1, width: '96px', render: o => <span className="text-[11px] text-t2">{fmtDate(o.dueDate)}</span>, exportValue: o => o.dueDate },
    { key: 'age', label: 'Overdue by', priority: 1, width: '110px',
      render: o => o.daysOverdue > 0
        ? <span className={`partner-ledger__age is-${o.bucket}`}>{o.daysOverdue} day{o.daysOverdue === 1 ? '' : 's'}</span>
        : <span className="text-[11px] text-emerald-600">Not yet due</span>,
      exportValue: o => o.daysOverdue },
    { key: 'total', label: 'Total', priority: 2, width: '115px', align: 'right', render: o => <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>, exportValue: o => o.total },
    { key: 'paid', label: w.payment, priority: 2, width: '115px', align: 'right', render: o => <span className="font-mono text-[11px] text-t3">{o.paid ? fmtKes(o.paid) : '—'}</span>, exportValue: o => o.paid },
    { key: 'balance', label: 'Still owed', priority: 1, width: '120px', align: 'right',
      render: o => <span className="font-mono text-[11px] font-semibold text-red-600">{fmtKes(o.balance)}</span>, exportValue: o => o.balance,
      footer: () => <span className="font-mono text-[11px] font-bold">{fmtKes(ledger.outstanding)}</span> },
  ]

  const downloadStatement = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const [{ buildDeedStatementPdf }, { companyForPdf }] = await Promise.all([
        import('@/lib/deed-document-pdf'),
        import('@/lib/commercial-pdf'),
      ])
      const company = await companyForPdf(companySettings)
      const pc = partner.contact as any
      const statementDate = plDateTo || today()
      const doc = buildDeedStatementPdf({
        side,
        ref: partner.name,
        statementDate,
        periodLabel,
        partyName: partner.name,
        partyPhone: pc?.phone || undefined,
        partyEmail: pc?.email || undefined,
        partyTaxId: pc?.vatNumber || undefined,
        partyAddress: [pc?.address, pc?.city].filter(Boolean).join(', ') || undefined,
        opening: plDateFrom ? ledger.opening : null,
        periodCharges: ledger.periodCharges,
        periodPayments: ledger.periodPayments,
        closing: ledger.closing,
        overdue: ledger.overdue,
        aging: BUCKETS.map(b => [AGING_LABELS[b], ledger.aging[b]] as [string, number]),
        lines: ledger.lines.map(l => ({
          date: l.date,
          type: KIND_LABEL[l.kind],
          ref: l.documentRef,
          details: l.infoOnly ? `${l.description} (no money moved)` : l.description,
          charge: l.charge,
          payment: l.payment,
          balance: l.balance,
        })),
        openItems: ledger.openItems,
        creditAvailable: side === 'customer' ? storeCredit + ledger.unappliedCredit : ledger.unappliedCredit,
      }, company, bankAccounts as any)
      doc.save(`Statement - ${partner.name.replace(/[/\\]/g, '-')} - ${statementDate}.pdf`)
    } catch (err) {
      showToast(`Could not build the statement: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    } finally {
      setDownloading(false)
    }
  }

  const c = partner.contact as any
  const contactLine = [c?.phone, c?.email, c?.vatNumber ? `KRA ${c.vatNumber}` : ''].filter(Boolean).join(' · ')
  const creditValue = side === 'customer' ? storeCredit + ledger.unappliedCredit : ledger.unappliedCredit

  return (
    <div className="partner-ledger">
      {toolbar}
      <div className="partner-ledger__head">
        <div>
          <p className="partner-ledger__eyebrow">{side === 'customer' ? 'Customer statement' : 'Supplier statement'} · {periodLabel}</p>
          <h3 className="partner-ledger__name">{partner.name}</h3>
          {contactLine && <p className="partner-ledger__contact">{contactLine}</p>}
        </div>
        <div className="partner-ledger__head-actions">
        {hasCustomer && hasSupplier && (
          <div className="partner-ledger__tabs is-compact" role="tablist" aria-label="Ledger side">
            <button type="button" role="tab" aria-selected={side === 'customer'} className={side === 'customer' ? 'is-on' : ''} onClick={() => setSideChoice('customer')}>As customer</button>
            <button type="button" role="tab" aria-selected={side === 'supplier'} className={side === 'supplier' ? 'is-on' : ''} onClick={() => setSideChoice('supplier')}>As supplier</button>
          </div>
        )}
          <button type="button" className="btn-primary text-[12px] min-h-[38px] px-4" onClick={() => { void downloadStatement() }} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download statement (PDF)'}
          </button>
        </div>
      </div>

      <div className="partner-ledger__kpis">
        <Kpi label={w.owed} value={fmtKes(ledger.closing)} tone={ledger.closing > 0.005 ? 'due' : 'ok'}
          hint={ledger.closing < -0.005 ? (side === 'customer' ? 'In credit: we owe them' : 'In credit: they owe us') : plDateTo ? `as at ${fmtDate(plDateTo)}` : undefined} />
        <Kpi label="Overdue" value={fmtKes(ledger.overdue)} tone={ledger.overdue > 0 ? 'due' : 'muted'}
          hint={ledger.openItems.length ? `${ledger.openItems.length} open document${ledger.openItems.length === 1 ? '' : 's'}` : 'Nothing open'} />
        {plDateFrom && <Kpi label="Brought forward" value={fmtKes(ledger.opening)} tone="muted" hint={`before ${fmtDate(plDateFrom)}`} />}
        <Kpi label={`${w.charge} in period`} value={fmtKes(ledger.periodCharges)} />
        <Kpi label={`${w.payment} in period`} value={fmtKes(ledger.periodPayments)} tone="ok" />
        <Kpi label={w.credit} value={fmtKes(creditValue)} tone={creditValue > 0 ? 'warn' : 'muted'}
          hint={side === 'customer' && depositsHeld > 0 ? `+ ${fmtKes(depositsHeld)} deposits held` : undefined} />
        <Kpi label="Not confirmed yet" value={fmtKes(ledger.drafts.total)} tone={ledger.drafts.count ? 'warn' : 'muted'}
          hint={ledger.drafts.count ? `${ledger.drafts.count} draft${ledger.drafts.count === 1 ? '' : 's'}, not on the ledger` : 'No drafts'} />
        {ledger.uncleared.count > 0 && (
          <Kpi label="Payments not cleared" value={fmtKes(ledger.uncleared.total)} tone="warn" hint={`${ledger.uncleared.count} cheque/transfer`} />
        )}
        <Kpi label={side === 'customer' ? 'Last payment' : 'Last paid'} value={ledger.lastPayment ? fmtKes(ledger.lastPayment.amount) : '—'} tone="muted"
          hint={ledger.lastPayment ? `${fmtDate(ledger.lastPayment.date)}${ledger.avgDaysToPay != null ? ` · usually ${ledger.avgDaysToPay} days to pay` : ''}` : 'None recorded'} />
      </div>

      <Aging aging={ledger.aging} total={ledger.outstanding} />

      <div className="partner-ledger__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'statement'} className={view === 'statement' ? 'is-on' : ''} onClick={() => setView('statement')}>
          Statement <span>{ledger.lines.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'open'} className={view === 'open' ? 'is-on' : ''} onClick={() => setView('open')}>
          Open {side === 'customer' ? 'invoices' : 'bills'} <span>{ledger.openItems.length}</span>
        </button>
      </div>

      {view === 'statement' ? (
        <DataTable
          tableId={`partner-ledger-statement-${side}`}
          columns={statementColumns}
          rows={statementRows}
          rowKey={l => l.id}
          onRowClick={l => { if (l.documentId) openDoc(l.documentId) }}
          rowLabel={l => `${KIND_LABEL[l.kind]} ${l.documentRef} ${l.description}`}
          searchPlaceholder="Search this statement…"
          emptyMessage={`No ${side === 'customer' ? 'invoices or receipts' : 'bills or payments'} in this period`}
          exportTitle={`Statement — ${partner.name} — ${periodLabel}`}
          exportFilename={`statement-${partner.name.replace(/\s+/g, '-')}`}
        />
      ) : (
        <DataTable
          tableId={`partner-ledger-open-${side}`}
          columns={openColumns}
          rows={ledger.openItems}
          rowKey={o => o.documentId}
          onRowClick={o => openDoc(o.documentId)}
          rowLabel={o => o.ref}
          searchPlaceholder={`Search open ${side === 'customer' ? 'invoices' : 'bills'}…`}
          emptyMessage={`Nothing owed: every ${side === 'customer' ? 'invoice' : 'bill'} is settled`}
          exportTitle={`Open ${side === 'customer' ? 'invoices' : 'bills'} — ${partner.name}`}
          exportFilename={`open-items-${partner.name.replace(/\s+/g, '-')}`}
        />
      )}
      <p className="partner-ledger__note">
        Drafts are not on the ledger until confirmed. Credit used from a credit note moves no money (the credit note already lowered the balance).
        Click a line to open its {side === 'customer' ? 'invoice' : 'bill'}.
      </p>
    </div>
  )
}
