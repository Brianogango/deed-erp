'use client'
import { useState, useMemo } from 'react'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { downloadPdf, printPdf } from '@/lib/pdf'
import { Badge, Field, Input, Modal, PanelHeader, Select, Table } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faCheck, faCircleCheck, faMoneyBillWave, faDownload, faPrint } from '@fortawesome/free-solid-svg-icons'

export default function HRPayrollTab() {
  const {
    users, currentUserId, employees, departments, payrollRuns, payslips, journalEntries,
    createPayrollRun, approvePayrollRun, postPayrollRun, systemSettings,
  } = useApp()

  const currentUser      = users.find(u => u.id === currentUserId) ?? null
  const isAdmin          = currentUser?.role === 'director'
  const isFinance        = currentUser?.role === 'finance_officer'
  const canManageHR      = isAdmin
  const canManagePayroll = isAdmin || isFinance
  const canApprovePayroll = canManagePayroll
  const canSeeSalary     = isFinance || !systemSettings.hrRestrictSalaryInfo
  const normalizeUserText = (value?: string | null) => (value ?? '').trim().toLowerCase()
  const currentUsername = normalizeUserText(currentUser?.username)
  const currentEmployee = employees.find(employee => {
    if (!currentUser) return false
    const employeeEmailUser = normalizeUserText(employee.email?.split('@')[0])
    return employee.userId === currentUser.id ||
      normalizeUserText(employee.fullName) === normalizeUserText(currentUser.name) ||
      (!!employeeEmailUser && employeeEmailUser === currentUsername) ||
      normalizeUserText(employee.employeeNo) === currentUsername
  }) ?? null
  const canAccessPayslip = (employeeId: string) => canManagePayroll || (!!currentEmployee && currentEmployee.id === employeeId)

  const maskSensitive = (val?: string) => {
    if (!val) return 'N/A'
    if (isFinance) return val
    if (val.length <= 4) return '****'
    return '*'.repeat(val.length - 4) + val.slice(-4)
  }

  const payrollJournals = useMemo(() =>
    payrollRuns.filter(r => r.postedJournalId).map(r => ({
      run: r,
      journal: journalEntries.find(j => j.id === r.postedJournalId),
    })),
  [payrollRuns, journalEntries])

  const [payrollSearch, setPayrollSearch] = useState('')
  const [payslipSearch, setPayslipSearch] = useState('')
  const [showPayrollModal, setShowPayrollModal] = useState(false)
  const [payrollMonth, setPayrollMonth] = useState(new Date().toISOString().slice(5, 7))
  const [payrollYear, setPayrollYear]   = useState(String(new Date().getFullYear()))

  const createPayroll = () => {
    createPayrollRun(payrollMonth, Number(payrollYear))
    setShowPayrollModal(false)
  }

  const buildPayslipLines = (payslipId: string) => {
    const payslip = payslips.find(p => p.id === payslipId)
    if (!payslip || payslip.status !== 'published' || !canAccessPayslip(payslip.employeeId)) return null
    const emp  = employees.find(e => e.id === payslip.employeeId)
    const dept = departments.find(d => d.id === emp?.departmentId)
    return {
      fileName: `Payslip-${payslip.ref.replaceAll('/', '-')}.pdf`,
      lines: [
        { text: 'DEED TECHNOLOGIES LIMITED',             x: 40, y: 800, size: 18, bold: true },
        { text: 'Official Payslip',                      x: 40, y: 782, size: 11 },
        { text: `Ref: ${payslip.ref}`,                   x: 40, y: 754 },
        { text: `Employee: ${payslip.employeeName}`,     x: 40, y: 736 },
        { text: `Employee No: ${emp?.employeeNo ?? 'N/A'}`, x: 40, y: 718 },
        { text: `Department: ${dept?.name ?? 'N/A'}`,   x: 40, y: 700 },
        { text: `Job Title: ${emp?.jobTitle ?? 'N/A'}`, x: 40, y: 682 },
        { text: `Pay Period: ${payslip.month}/${payslip.year}`, x: 40, y: 664 },
        { text: '─────────────────────────────',         x: 40, y: 648 },
        { text: `Gross Pay:   ${fmtKes(payslip.grossPay)}`,    x: 40, y: 630 },
        { text: `Deductions:  ${fmtKes(payslip.deductions)}`,  x: 40, y: 612 },
        { text: `Net Pay:     ${fmtKes(payslip.netPay)}`,      x: 40, y: 594, bold: true },
        { text: '─────────────────────────────',         x: 40, y: 578 },
        { text: `Generated: ${fmtDate(payslip.generatedDate)}`, x: 40, y: 560 },
        { text: `Bank Account: ${maskSensitive(emp?.bankAccount)}`, x: 40, y: 542 },
        { text: 'Authorised by: ____________________',   x: 40, y: 504 },
        { text: 'Employee sign-off: ____________________', x: 40, y: 484 },
      ],
    }
  }

  const downloadPayslipPdf = (id: string) => { const p = buildPayslipLines(id); if (p) downloadPdf(p.fileName, p.lines) }
  const printPayslipPdf    = (id: string) => { const p = buildPayslipLines(id); if (p) printPdf(p.fileName, p.lines) }

  const filteredRuns = payrollRuns.filter(r => {
    const s = payrollSearch.toLowerCase()
    return !s || r.ref.toLowerCase().includes(s) || `${r.month}/${r.year}`.includes(s)
  })

  const filteredPayslips = payslips.filter(p => {
    if (!canAccessPayslip(p.employeeId)) return false
    const s = payslipSearch.toLowerCase()
    return !s || p.ref.toLowerCase().includes(s) || p.employeeName.toLowerCase().includes(s) ||
      `${p.month}/${p.year}`.includes(s)
  })

  return (
    <div className="flex flex-col gap-3">
      {/* Payroll Runs */}
      {canManagePayroll && (
      <div className="card overflow-hidden">
        <PanelHeader title="Payroll Runs" count={filteredRuns.length}>
          <input className="form-input text-11 py-1.5" style={{ width: 160 }}
            placeholder="Search ref, period…" value={payrollSearch} onChange={e => setPayrollSearch(e.target.value)} />
          {canManageHR && (
            <button className="btn-primary text-11" onClick={() => setShowPayrollModal(true)}>+ Create Payroll Run</button>
          )}
        </PanelHeader>
        <Table cols={[
          { label: 'Ref',          width: '1fr' },
          { label: 'Period',       width: '0.7fr' },
          { label: 'Employees',    width: '0.7fr' },
          { label: 'Total Gross',  width: '1fr' },
          { label: 'Deductions',   width: '1fr' },
          { label: 'Net Pay',      width: '1fr' },
          { label: 'Status',       width: '0.9fr' },
          { label: 'Actions',      width: '1.4fr' },
        ]}>
          {filteredRuns.map(run => (
            <div key={run.id} className="table-row">
              <span className="font-mono text-11 font-semibold" style={{ color: 'var(--ink-navy)' }}>{run.ref}</span>
              <span style={{ fontSize: 11 }}>{run.month}/{run.year}</span>
              <span><span className="badge badge-blue">{run.lines.length}</span></span>
              <span className="font-mono" style={{ fontSize: 11 }}>{fmtKes(run.totalGross)}</span>
              <span className="font-mono" style={{ fontSize: 11, color: '#EF4444' }}>{fmtKes(run.totalDeductions)}</span>
              <span className="font-mono font-semibold" style={{ fontSize: 11 }}>{fmtKes(run.totalNet)}</span>
              <span>
                <Badge
                  status={run.status === 'posted' ? 'posted' : run.status === 'approved' ? 'active' : 'pending'}
                  label={run.status.replace('_', ' ')}
                />
              </span>
              <span className="flex gap-2 flex-wrap items-center">
                {run.status === 'pending_approval' && canApprovePayroll && (
                  <button style={{ background: '#F0FDF4', border: 'none', borderRadius: 6, color: '#059669', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => approvePayrollRun(run.id)}>
                    <Fa icon={faCheck} style={{ fontSize: 9 }} /> Approve
                  </button>
                )}
                {run.status === 'approved' && canApprovePayroll && (
                  <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: 'var(--ink-navy)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => postPayrollRun(run.id)}>
                    <Fa icon={faMoneyBillWave} style={{ fontSize: 9 }} /> Post to Accounting
                  </button>
                )}
                {run.status === 'posted' && (
                  <span className="flex items-center gap-1" style={{ color: '#059669', fontSize: 10 }}>
                    <Fa icon={faCircleCheck} style={{ fontSize: 11 }} /> Posted
                  </span>
                )}
              </span>
            </div>
          ))}
        </Table>
      </div>
      )}

      {/* Payslips */}
      <div className="card overflow-hidden">
        <PanelHeader title="Payslips" count={filteredPayslips.length}>
          <input className="form-input text-11 py-1.5" style={{ width: 180 }}
            placeholder="Search employee, period…" value={payslipSearch} onChange={e => setPayslipSearch(e.target.value)} />
        </PanelHeader>
        <Table cols={[
          { label: 'Ref',        width: '0.9fr' },
          { label: 'Employee',   width: '1.3fr' },
          { label: 'Department', width: '1fr' },
          { label: 'Period',     width: '0.7fr' },
          { label: 'Basic',      width: '0.9fr' },
          { label: 'Deductions', width: '0.9fr' },
          { label: 'Net Pay',    width: '0.9fr' },
          { label: 'Status',     width: '0.8fr' },
          { label: 'Actions',    width: '1.3fr' },
        ]}>
          {filteredPayslips.map(ps => {
            const emp  = employees.find(e => e.id === ps.employeeId)
            const dept = departments.find(d => d.id === emp?.departmentId)
            return (
              <div key={ps.id} className="table-row">
                <span className="font-mono text-11 font-semibold" style={{ color: 'var(--ink-navy)' }}>{ps.ref}</span>
                <span>
                  <div style={{ fontWeight: 600, color: '#111827' }}>{ps.employeeName}</div>
                  <div className="font-mono text-10" style={{ color: '#9CA3AF' }}>{emp?.employeeNo ?? ''}</div>
                </span>
                <span style={{ fontSize: 11 }}>{dept?.name ?? '—'}</span>
                <span style={{ fontSize: 11 }}>{ps.month}/{ps.year}</span>
                <span className="font-mono" style={{ fontSize: 11 }}>{canSeeSalary ? fmtKes(ps.grossPay) : '••••'}</span>
                <span className="font-mono" style={{ fontSize: 11, color: '#EF4444' }}>{canSeeSalary ? fmtKes(ps.deductions) : '••••'}</span>
                <span className="font-mono font-semibold" style={{ fontSize: 11, color: '#059669' }}>{fmtKes(ps.netPay)}</span>
                <span><Badge status={ps.status === 'published' ? 'posted' : 'draft'} label={ps.status} /></span>
                <span className="flex gap-1 items-center">
                  {ps.status === 'published' && canAccessPayslip(ps.employeeId) && (
                    <>
                      <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: 'var(--ink-navy)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => printPayslipPdf(ps.id)}><Fa icon={faPrint} style={{ fontSize: 9 }} /> Print</button>
                      <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: 'var(--ink-navy)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => downloadPayslipPdf(ps.id)}><Fa icon={faDownload} style={{ fontSize: 9 }} /> PDF</button>
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </Table>
      </div>

      {/* Payroll → Accounting journal postings */}
      {canManagePayroll && payrollJournals.length > 0 && (
        <div className="card overflow-hidden">
          <PanelHeader title="Payroll → Accounting Journal Postings" count={payrollJournals.length} />
          <div className="p-4 space-y-3 text-12">
            {payrollJournals.map(item => (
              <div key={item.run.id} className="rounded-xl p-3" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                <div className="flex justify-between items-center">
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827' }}>{item.run.ref}</div>
                    <div style={{ color: '#6B7280' }}>Journal: {item.journal?.ref ?? '—'} · Posted {fmtDate(item.journal?.date ?? '')}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold" style={{ color: '#059669' }}>{fmtKes(item.run.totalNet)}</div>
                    <div style={{ color: '#9CA3AF', fontSize: 10 }}>Net pay</div>
                  </div>
                </div>
                {item.journal && (
                  <div className="mt-2 space-y-1">
                    {item.journal.lines.map((line: any) => (
                      <div key={line.id} className="flex justify-between text-11" style={{ color: '#4B5563' }}>
                        <span>{line.account}</span>
                        <span>{line.debit > 0 ? `Dr ${fmtKes(line.debit)}` : `Cr ${fmtKes(line.credit)}`}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Payroll Run modal */}
      {showPayrollModal && (
        <Modal title="Create Payroll Run" onClose={() => setShowPayrollModal(false)} width={420}>
          <div className="rounded-xl p-3 mb-3 text-12" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#065F46' }}>
            This will calculate payroll for all {employees.filter(e => e.status === 'active').length} active employees based on their current salary data.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Month">
              <Select value={payrollMonth} onChange={setPayrollMonth} options={[
                { value: '01', label: 'January' },  { value: '02', label: 'February' },
                { value: '03', label: 'March' },    { value: '04', label: 'April' },
                { value: '05', label: 'May' },      { value: '06', label: 'June' },
                { value: '07', label: 'July' },     { value: '08', label: 'August' },
                { value: '09', label: 'September' },{ value: '10', label: 'October' },
                { value: '11', label: 'November' }, { value: '12', label: 'December' },
              ]} />
            </Field>
            <Field label="Year"><Input value={payrollYear} onChange={setPayrollYear} type="number" /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button className="btn-outline" onClick={() => setShowPayrollModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={createPayroll}>Create Payroll</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
