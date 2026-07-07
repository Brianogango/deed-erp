'use client'
import { useState, useMemo } from 'react'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { downloadPdf, printPdf } from '@/lib/pdf'
import { Badge, Field, Input, Modal, PanelHeader, Select } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faCheck, faCircleCheck, faMoneyBillWave, faDownload, faPrint } from '@fortawesome/free-solid-svg-icons'

export default function HRPayrollTab() {
  const {
    users, currentUserId, payrollRuns, payslips, journalEntries,
    createPayrollRun, approvePayrollRun, postPayrollRun, systemSettings,
  } = useApp()
  const { employees, departments } = useHrStore()

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
    const advanceDeductions = payslip.salaryAdvanceDeductions ?? []
    const advanceTotal = advanceDeductions.reduce((sum, item) => sum + item.amount, 0)
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
        ...(advanceDeductions.length > 0 ? [
          { text: `  Salary advance: ${fmtKes(advanceTotal)}`, x: 56, y: 596, size: 9 },
          ...advanceDeductions.slice(0, 4).map((item, index) => ({
            text: `    ${item.ref}: ${fmtKes(item.amount)} (remaining ${fmtKes(item.remainingAfter)})`,
            x: 56,
            y: 580 - index * 14,
            size: 8,
          })),
        ] : []),
        { text: `Net Pay:     ${fmtKes(payslip.netPay)}`,      x: 40, y: advanceDeductions.length > 0 ? 514 : 594, bold: true },
        { text: '─────────────────────────────',         x: 40, y: advanceDeductions.length > 0 ? 498 : 578 },
        { text: `Generated: ${fmtDate(payslip.generatedDate)}`, x: 40, y: advanceDeductions.length > 0 ? 480 : 560 },
        { text: `Bank Account: ${maskSensitive(emp?.bankAccount)}`, x: 40, y: advanceDeductions.length > 0 ? 462 : 542 },
        { text: 'Authorised by: ____________________',   x: 40, y: advanceDeductions.length > 0 ? 424 : 504 },
        { text: 'Employee sign-off: ____________________', x: 40, y: advanceDeductions.length > 0 ? 404 : 484 },
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

  type PayrollRunRow = typeof filteredRuns[number]

  const payrollRunColumns: ColumnDef<PayrollRunRow>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '100px',
      render: run => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{run.ref}</span>,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: run => <Badge status={run.status === 'posted' ? 'posted' : run.status === 'approved' ? 'active' : 'pending'} label={run.status.replace('_', ' ')} />,
      exportValue: run => run.status,
    },
    {
      key: 'netPay', label: 'Net Pay', priority: 1, width: '100px', align: 'right',
      render: run => <span className="font-mono font-semibold" style={{ fontSize: 11 }}>{fmtKes(run.totalNet)}</span>,
      exportValue: run => run.totalNet,
    },
    {
      key: 'period', label: 'Period', priority: 2, width: '90px',
      render: run => <span style={{ fontSize: 11 }}>{run.month}/{run.year}</span>,
      exportValue: run => `${run.month}/${run.year}`,
    },
    {
      key: 'employees', label: 'Employees', priority: 2, width: '90px',
      render: run => <span className="badge badge-blue">{run.lines.length}</span>,
      exportValue: run => run.lines.length,
    },
    {
      key: 'totalGross', label: 'Total Gross', priority: 2, width: '100px', align: 'right',
      render: run => <span className="font-mono" style={{ fontSize: 11 }}>{fmtKes(run.totalGross)}</span>,
      exportValue: run => run.totalGross,
    },
    {
      key: 'deductions', label: 'Deductions', priority: 3, width: '100px', align: 'right',
      render: run => <span className="font-mono" style={{ fontSize: 11, color: 'var(--danger)' }}>{fmtKes(run.totalDeductions)}</span>,
      exportValue: run => run.totalDeductions,
    },
  ]

  function payrollRunRowActions(run: PayrollRunRow) {
    return (
      <span className="flex gap-2 flex-wrap items-center">
        {run.status === 'pending_approval' && canApprovePayroll && (
          <button style={{ background: 'var(--success-bg)', border: 'none', borderRadius: 6, color: 'var(--success)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={e => { e.stopPropagation(); approvePayrollRun(run.id) }}>
            <Fa icon={faCheck} style={{ fontSize: 9 }} /> Approve
          </button>
        )}
        {run.status === 'approved' && canApprovePayroll && (
          <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: 'var(--navy)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            onClick={e => { e.stopPropagation(); postPayrollRun(run.id) }}>
            <Fa icon={faMoneyBillWave} style={{ fontSize: 9 }} /> Post to Accounting
          </button>
        )}
        {run.status === 'posted' && (
          <span className="flex items-center gap-1" style={{ color: 'var(--success)', fontSize: 10 }}>
            <Fa icon={faCircleCheck} style={{ fontSize: 11 }} /> Posted
          </span>
        )}
      </span>
    )
  }

  type PayslipRow = typeof filteredPayslips[number]

  const payslipColumns: ColumnDef<PayslipRow>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: ps => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{ps.ref}</span>,
    },
    {
      key: 'employee', label: 'Employee', priority: 1, width: '150px',
      render: ps => {
        const emp = employees.find(e => e.id === ps.employeeId)
        return (
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{ps.employeeName}</div>
            <div className="font-mono text-[10px]" style={{ color: 'var(--text-4)' }}>{emp?.employeeNo ?? ''}</div>
          </div>
        )
      },
      exportValue: ps => ps.employeeName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: ps => <Badge status={ps.status === 'published' ? 'posted' : 'draft'} label={ps.status} />,
      exportValue: ps => ps.status,
    },
    {
      key: 'netPay', label: 'Net Pay', priority: 1, width: '100px', align: 'right',
      render: ps => <span className="font-mono font-semibold" style={{ fontSize: 11, color: 'var(--success)' }}>{fmtKes(ps.netPay)}</span>,
      exportValue: ps => ps.netPay,
    },
    {
      key: 'department', label: 'Department', priority: 2, width: '110px',
      render: ps => {
        const emp = employees.find(e => e.id === ps.employeeId)
        const dept = departments.find(d => d.id === emp?.departmentId)
        return <span style={{ fontSize: 11 }}>{dept?.name ?? '—'}</span>
      },
    },
    {
      key: 'period', label: 'Period', priority: 2, width: '80px',
      render: ps => <span style={{ fontSize: 11 }}>{ps.month}/{ps.year}</span>,
      exportValue: ps => `${ps.month}/${ps.year}`,
    },
    {
      key: 'gross', label: 'Basic', priority: 2, width: '90px', align: 'right',
      render: ps => <span className="font-mono" style={{ fontSize: 11 }}>{canSeeSalary ? fmtKes(ps.grossPay) : '••••'}</span>,
      exportValue: ps => canSeeSalary ? ps.grossPay : '',
    },
    {
      key: 'deductions', label: 'Deductions', priority: 3, width: '100px', align: 'right',
      render: ps => <span className="font-mono" style={{ fontSize: 11, color: 'var(--danger)' }}>{canSeeSalary ? fmtKes(ps.deductions) : '••••'}</span>,
      exportValue: ps => canSeeSalary ? ps.deductions : '',
    },
  ]

  function payslipRowActions(ps: PayslipRow) {
    return ps.status === 'published' && canAccessPayslip(ps.employeeId) ? (
      <span className="flex gap-1 items-center">
        <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: 'var(--navy)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onClick={e => { e.stopPropagation(); printPayslipPdf(ps.id) }}><Fa icon={faPrint} style={{ fontSize: 9 }} /> Print</button>
        <button style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: 'var(--navy)', padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onClick={e => { e.stopPropagation(); downloadPayslipPdf(ps.id) }}><Fa icon={faDownload} style={{ fontSize: 9 }} /> PDF</button>
      </span>
    ) : null
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Payroll Runs */}
      {canManagePayroll && (
      <div className="card overflow-hidden">
        <PanelHeader title="Payroll Runs" count={filteredRuns.length}>
          <input className="form-input text-[11px] py-1.5" style={{ width: 160 }}
            placeholder="Search ref, period…" value={payrollSearch} onChange={e => setPayrollSearch(e.target.value)} />
          {canManageHR && (
            <button className="btn-primary text-[11px]" onClick={() => setShowPayrollModal(true)}>+ Create Payroll Run</button>
          )}
        </PanelHeader>
        <DataTable
          tableId="hr_payroll_runs"
          columns={payrollRunColumns}
          rows={filteredRuns}
          rowKey={run => run.id}
          hideSearch
          emptyMessage="No payroll runs found"
          rowActions={payrollRunRowActions}
          exportTitle="Payroll Runs"
          exportFilename="payroll-runs"
        />
      </div>
      )}

      {/* Payslips */}
      <div className="card overflow-hidden">
        <PanelHeader title="Payslips" count={filteredPayslips.length}>
          <input className="form-input text-[11px] py-1.5" style={{ width: 180 }}
            placeholder="Search employee, period…" value={payslipSearch} onChange={e => setPayslipSearch(e.target.value)} />
        </PanelHeader>
        <DataTable
          tableId="hr_payslips"
          columns={payslipColumns}
          rows={filteredPayslips}
          rowKey={ps => ps.id}
          hideSearch
          emptyMessage="No payslips found"
          rowActions={payslipRowActions}
          exportTitle="Payslips"
          exportFilename="payslips"
        />
      </div>

      {/* Payroll → Accounting journal postings */}
      {canManagePayroll && payrollJournals.length > 0 && (
        <div className="card overflow-hidden">
          <PanelHeader title="Payroll → Accounting Journal Postings" count={payrollJournals.length} />
          <div className="p-4 space-y-3 text-[12px]">
            {payrollJournals.map(item => (
              <div key={item.run.id} className="rounded-xl p-3" style={{ background: 'var(--success-bg)', border: '1px solid #BBF7D0' }}>
                <div className="flex justify-between items-center">
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-1)' }}>{item.run.ref}</div>
                    <div style={{ color: 'var(--text-4)' }}>Journal: {item.journal?.ref ?? '—'} · Posted {fmtDate(item.journal?.date ?? '')}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold" style={{ color: 'var(--success)' }}>{fmtKes(item.run.totalNet)}</div>
                    <div style={{ color: 'var(--text-4)', fontSize: 10 }}>Net pay</div>
                  </div>
                </div>
                {item.journal && (
                  <div className="mt-2 space-y-1">
                    {item.journal.lines.map((line: any) => (
                      <div key={line.id} className="flex justify-between text-[11px]" style={{ color: 'var(--text-3)' }}>
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
          <div className="rounded-xl p-3 mb-3 text-[12px]" style={{ background: 'var(--success-bg)', border: '1px solid #BBF7D0', color: 'var(--success-text)' }}>
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
