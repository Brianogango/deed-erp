'use client'

import { useMemo } from 'react'
import type { RefurbishmentJob } from '@/lib/store'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faChevronLeft, faChevronRight, faPrint } from '@fortawesome/free-solid-svg-icons'
import {
  buildRefurbWeeklyReport,
  refurbWeekStart,
  type CompletedRow,
  type PendingRow,
  type ReportJob,
  type TechRow,
} from '@/lib/refurbishment/weekly-report'
import { printRefurbWeeklyReport } from '@/lib/refurbishment/weekly-report-print'

const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`
const day = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'
const num = (n: number | null) => (n == null ? '—' : String(n))

function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

const deviceCell = (j: { productName: string; serialNumber: string }) => (
  <div className="min-w-0">
    <p className="m-0 text-xs font-medium text-t1 erp-truncate" title={j.productName}>{j.productName}</p>
    <p className="m-0 font-mono text-[10px] text-t3">{j.serialNumber}</p>
  </div>
)
const refCell = (ref: string) => <span className="font-mono text-[11px] font-semibold" style={{ color: '#5B21B6' }}>{ref}</span>

export function RefurbWeeklyReport({
  jobs,
  weekStart,
  onWeekChange,
  onOpenJob,
  generatedBy,
  onPrintBlocked,
}: {
  jobs: RefurbishmentJob[]
  weekStart: string
  onWeekChange: (weekStart: string) => void
  onOpenJob: (id: string) => void
  generatedBy: string
  onPrintBlocked: () => void
}) {
  const thisWeek = refurbWeekStart(new Date())
  const report = useMemo(() => buildRefurbWeeklyReport(jobs as ReportJob[], weekStart), [jobs, weekStart])
  const t = report.totals

  const completedCols: ColumnDef<CompletedRow>[] = [
    { key: 'ref', label: 'Ref', priority: 1, width: '90px', render: c => refCell(c.ref), exportValue: c => c.ref },
    { key: 'device', label: 'Device', priority: 1, width: '1.6fr', render: deviceCell, accessor: c => `${c.productName} ${c.serialNumber}`, exportValue: c => `${c.productName} (${c.serialNumber})` },
    { key: 'tech', label: 'Technician', priority: 2, width: '1fr', render: c => <span className="text-xs">{c.assignedTechnicianName || '—'}</span>, exportValue: c => c.assignedTechnicianName || '' },
    { key: 'received', label: 'Received', priority: 3, width: '80px', render: c => <span className="text-xs text-t3">{day(c.intakeDate)}</span>, exportValue: c => c.intakeDate },
    { key: 'completed', label: 'Completed', priority: 2, width: '90px', render: c => <span className="text-xs">{day(c.completedDate)}</span>, exportValue: c => c.completedDate ?? '' },
    { key: 'days', label: 'Days', align: 'right' as const, priority: 2, width: '60px', render: c => <span className="text-xs">{num(c.daysToComplete)}</span>, exportValue: c => c.daysToComplete ?? '' },
    { key: 'cost', label: 'Parts cost', align: 'right' as const, priority: 2, width: '110px', render: c => <span className="text-xs">{c.cost ? kes(c.cost) : '—'}</span>, exportValue: c => c.cost },
    { key: 'status', label: 'Now', priority: 3, width: '100px', render: c => <span className="text-[11px] text-t3">{c.status === 'transferred' ? 'Sent for retest' : 'Ready'}</span>, exportValue: c => c.status },
  ]

  const pendingCols: ColumnDef<PendingRow>[] = [
    { key: 'ref', label: 'Ref', priority: 1, width: '90px', render: p => refCell(p.ref), exportValue: p => p.ref },
    { key: 'device', label: 'Device', priority: 1, width: '1.5fr', render: deviceCell, accessor: p => `${p.productName} ${p.serialNumber}`, exportValue: p => `${p.productName} (${p.serialNumber})` },
    { key: 'tech', label: 'Technician', priority: 2, width: '1fr', render: p => p.assignedTechnicianName ? <span className="text-xs">{p.assignedTechnicianName}</span> : <span className="text-xs" style={{ color: 'var(--warning)' }}>Unassigned</span>, exportValue: p => p.assignedTechnicianName || 'Unassigned' },
    { key: 'stage', label: 'Stage', priority: 1, width: '1.2fr', render: p => <span className="text-xs">{p.stage}</span>, exportValue: p => p.stage },
    {
      key: 'age', label: 'Age (days)', align: 'right' as const, priority: 1, width: '80px',
      render: p => <span className="text-xs font-semibold" style={{ color: (p.ageDays ?? 0) > 14 ? 'var(--danger)' : (p.ageDays ?? 0) > 7 ? 'var(--warning)' : 'var(--text-2)' }}>{num(p.ageDays)}</span>,
      exportValue: p => p.ageDays ?? '',
    },
    { key: 'waiting', label: 'Waiting for', priority: 2, width: '1.3fr', render: p => p.waitingParts.length ? <span className="text-[11px]" style={{ color: 'var(--warning)' }}>{p.waitingParts.join(', ')}</span> : <span className="text-[11px] text-t3">—</span>, exportValue: p => p.waitingParts.join(', ') },
  ]

  const techCols: ColumnDef<TechRow>[] = [
    { key: 'name', label: 'Technician', priority: 1, width: '1.4fr', render: x => <span className="text-xs font-medium">{x.name}</span>, exportValue: x => x.name },
    { key: 'completed', label: 'Completed', align: 'right' as const, priority: 1, width: '90px', render: x => <span className="text-xs">{x.completed}</span>, exportValue: x => x.completed },
    { key: 'wo', label: 'Written off', align: 'right' as const, priority: 2, width: '90px', render: x => <span className="text-xs">{x.writtenOff}</span>, exportValue: x => x.writtenOff },
    { key: 'open', label: 'Still open', align: 'right' as const, priority: 1, width: '90px', render: x => <span className="text-xs">{x.open}</span>, exportValue: x => x.open },
    { key: 'avg', label: 'Avg days', align: 'right' as const, priority: 2, width: '80px', render: x => <span className="text-xs">{num(x.avgDays)}</span>, exportValue: x => x.avgDays ?? '' },
  ]

  const writtenOffCols: ColumnDef<CompletedRow>[] = [
    { key: 'ref', label: 'Ref', priority: 1, width: '90px', render: c => refCell(c.ref), exportValue: c => c.ref },
    { key: 'device', label: 'Device', priority: 1, width: '1.5fr', render: deviceCell, exportValue: c => `${c.productName} (${c.serialNumber})` },
    { key: 'tech', label: 'Technician', priority: 2, width: '1fr', render: c => <span className="text-xs">{c.assignedTechnicianName || '—'}</span>, exportValue: c => c.assignedTechnicianName || '' },
    { key: 'reason', label: 'Reason', priority: 1, width: '2fr', render: c => <span className="text-xs text-t2">{/Written off: (.*)$/m.exec(c.techNotes ?? '')?.[1] ?? '—'}</span>, exportValue: c => /Written off: (.*)$/m.exec(c.techNotes ?? '')?.[1] ?? '' },
  ]

  const tiles: Array<[string, string | number, string?]> = [
    ['Completed', t.completed, 'var(--success)'],
    ['Sent for retest', t.sentForRetest],
    ['Written off', t.writtenOff, t.writtenOff ? 'var(--danger)' : undefined],
    ['Received', t.received],
    [report.isCurrentWeek ? 'Pending now' : 'Open at week end', t.pending, 'var(--warning)'],
    ['Avg days to complete', num(t.avgDaysToComplete)],
    ['Parts cost (completed)', t.partsCostCompleted ? kes(t.partsCostCompleted) : '—'],
  ]

  const section = (title: string, count: number, body: React.ReactNode, note?: string) => (
    <div className="card overflow-hidden">
      <div className="px-4 pt-3">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-t2">{title} ({count})</p>
        {note && <p className="m-0 mt-0.5 text-[11px] text-t3">{note}</p>}
      </div>
      <div className="p-2">{body}</div>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" className="btn-outline text-xs px-2.5" aria-label="Previous week" onClick={() => onWeekChange(shiftWeek(weekStart, -1))}>
            <Fa icon={faChevronLeft} />
          </button>
          <div className="min-w-[180px] text-center">
            <p className="m-0 text-sm font-semibold text-t1">{report.label}</p>
            <p className="m-0 text-[11px] text-t3">{report.isCurrentWeek ? 'This week (so far)' : 'Monday – Sunday'}</p>
          </div>
          <button
            type="button"
            className="btn-outline text-xs px-2.5"
            aria-label="Next week"
            disabled={weekStart >= thisWeek}
            onClick={() => onWeekChange(shiftWeek(weekStart, 1))}
          >
            <Fa icon={faChevronRight} />
          </button>
          {weekStart !== thisWeek && (
            <button type="button" className="btn-ghost text-xs" onClick={() => onWeekChange(thisWeek)}>This week</button>
          )}
        </div>
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={() => { if (!printRefurbWeeklyReport(report, generatedBy)) onPrintBlocked() }}
        >
          <Fa icon={faPrint} className="mr-1.5" />Print / PDF
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map(([label, value, color]) => (
          <div key={label} className="card px-3 py-2.5">
            <p className="m-0 text-lg font-bold" style={{ color: color ?? 'var(--text-1)' }}>{value}</p>
            <p className="m-0 text-[11px] text-t3">{label}</p>
          </div>
        ))}
      </div>

      {report.pendingByStage.length > 0 && report.isCurrentWeek && (
        <div className="card flex flex-wrap gap-2 px-4 py-3">
          {report.pendingByStage.map(s => (
            <span key={s.stage} className="rounded-full px-2.5 py-1 text-[11px]" style={{ background: 'var(--bg-muted)', color: 'var(--text-2)' }}>
              {s.stage}: <b>{s.count}</b>
            </span>
          ))}
        </div>
      )}

      {section('Completed', report.completed.length,
        <DataTable tableId="refurb-report-completed" columns={completedCols} rows={report.completed} rowKey={c => c.id} hideSearch hideColumnFilters
          onRowClick={c => onOpenJob(c.id)} emptyMessage="No machines completed this week" exportTitle={`Refurbishment completed ${report.label}`} exportFilename={`refurb-completed-${weekStart}`} />,
        'Marked ready in this week. Days = from intake to ready.')}

      {section(report.isCurrentWeek ? 'Pending' : 'Open at the end of the week', report.pending.length,
        <DataTable tableId="refurb-report-pending" columns={pendingCols} rows={report.pending} rowKey={p => p.id} hideSearch hideColumnFilters
          onRowClick={p => onOpenJob(p.id)} emptyMessage="Nothing pending" exportTitle={`Refurbishment pending ${report.label}`} exportFilename={`refurb-pending-${weekStart}`} />,
        report.isCurrentWeek ? 'Not yet ready, oldest first. Over 7 days in amber, over 14 in red.' : 'Received by the end of the week and not finished by then.')}

      {section('Technicians', report.technicians.length,
        <DataTable tableId="refurb-report-techs" columns={techCols} rows={report.technicians} rowKey={x => x.name} hideSearch hideColumnFilters
          emptyMessage="No assigned work" exportTitle={`Refurbishment by technician ${report.label}`} exportFilename={`refurb-technicians-${weekStart}`} />)}

      {report.writtenOff.length > 0 && section('Written off', report.writtenOff.length,
        <DataTable tableId="refurb-report-written-off" columns={writtenOffCols} rows={report.writtenOff} rowKey={c => c.id} hideSearch hideColumnFilters
          onRowClick={c => onOpenJob(c.id)} emptyMessage="Nothing written off" exportTitle={`Refurbishment written off ${report.label}`} exportFilename={`refurb-written-off-${weekStart}`} />)}
    </div>
  )
}
