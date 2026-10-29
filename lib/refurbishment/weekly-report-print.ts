import type { RefurbWeeklyReport } from '@/lib/refurbishment/weekly-report'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`
const day = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'
const num = (n: number | null) => n == null ? '—' : String(n)

function table(title: string, head: string[], rows: string[][], empty: string): string {
  return `<h2>${esc(title)} <span>(${rows.length})</span></h2>` + (rows.length
    ? `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : `<p class="empty">${esc(empty)}</p>`)
}

/** The weekly report as a standalone printable page (print or save as PDF). */
export function refurbWeeklyReportHtml(r: RefurbWeeklyReport, generatedBy: string): string {
  const t = r.totals
  const tiles = [
    ['Completed', t.completed], ['Sent for retest', t.sentForRetest], ['Written off', t.writtenOff],
    ['Received', t.received], [r.isCurrentWeek ? 'Pending now' : 'Open at week end', t.pending],
    ['Avg days to complete', num(t.avgDaysToComplete)], ['Parts cost (completed)', kes(t.partsCostCompleted)],
  ]
  return `<!doctype html><html><head><meta charset="utf-8"><title>Refurbishment report ${esc(r.label)}</title>
<style>
  body { font: 12px/1.4 -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #14213d; margin: 24px; }
  h1 { font-size: 18px; margin: 0; } .sub { color: #64748b; margin: 2px 0 16px; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .tile { border: 1px solid #d9e1ea; border-radius: 8px; padding: 8px 10px; }
  .tile b { display: block; font-size: 16px; } .tile span { color: #64748b; font-size: 11px; }
  h2 { font-size: 13px; margin: 18px 0 6px; } h2 span { color: #64748b; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e5eaf0; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; color: #64748b; } .empty { color: #64748b; font-style: italic; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; } .warn { color: #b45309; }
  @media print { body { margin: 10mm; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head><body>
<h1>Refurbishment — weekly report</h1>
<p class="sub">${esc(r.label)} · generated ${esc(new Date().toLocaleString('en-GB'))} by ${esc(generatedBy)}</p>
<div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
${table('Completed', ['Ref', 'Device', 'Serial', 'Technician', 'Received', 'Completed', 'Days', 'Parts cost'],
    r.completed.map(c => [esc(c.ref), esc(c.productName), `<span class="mono">${esc(c.serialNumber)}</span>`, esc(c.assignedTechnicianName || '—'), day(c.intakeDate), day(c.completedDate), num(c.daysToComplete), kes(c.cost)]),
    'No machines completed this week')}
${table(r.isCurrentWeek ? 'Pending' : 'Open at the end of the week', ['Ref', 'Device', 'Serial', 'Technician', 'Stage', 'Age (days)', 'Waiting for'],
    r.pending.map(p => [esc(p.ref), esc(p.productName), `<span class="mono">${esc(p.serialNumber)}</span>`, esc(p.assignedTechnicianName || 'Unassigned'), esc(p.stage), num(p.ageDays), p.waitingParts.length ? `<span class="warn">${esc(p.waitingParts.join(', '))}</span>` : '—']),
    'Nothing pending')}
${table('Technicians', ['Technician', 'Completed', 'Written off', 'Still open', 'Avg days'],
    r.technicians.map(x => [esc(x.name), String(x.completed), String(x.writtenOff), String(x.open), num(x.avgDays)]),
    'No assigned work')}
${table('Written off', ['Ref', 'Device', 'Serial', 'Technician', 'Reason'],
    r.writtenOff.map(w => [esc(w.ref), esc(w.productName), `<span class="mono">${esc(w.serialNumber)}</span>`, esc(w.assignedTechnicianName || '—'), esc(/Written off: (.*)$/m.exec(w.techNotes ?? '')?.[1] ?? '—')]),
    'Nothing written off')}
${table('Received this week', ['Ref', 'Device', 'Serial', 'Issue'],
    r.received.map(j => [esc(j.ref), esc(j.productName), `<span class="mono">${esc(j.serialNumber)}</span>`, esc(j.intakeIssueDescription || '—')]),
    'No machines received')}
</body></html>`
}

export function printRefurbWeeklyReport(r: RefurbWeeklyReport, generatedBy: string): boolean {
  if (typeof window === 'undefined') return false
  const win = window.open('', '_blank', 'width=1000,height=760')
  if (!win) return false
  win.document.write(refurbWeeklyReportHtml(r, generatedBy))
  win.document.close()
  win.focus()
  win.setTimeout(() => win.print(), 300)
  return true
}
