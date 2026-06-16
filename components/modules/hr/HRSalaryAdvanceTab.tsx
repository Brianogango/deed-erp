'use client'
import { useMemo, useState } from 'react'
import { useApp, fmtDate, fmtKes, type SalaryAdvance } from '@/lib/store'
import { Badge, Field, Input, Modal, PanelHeader, RecordCard, Select, Textarea } from '@/components/ui'

const statusTone: Record<SalaryAdvance['status'], string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'cancelled',
  paid: 'paid',
  repaid: 'paid',
  cancelled: 'cancelled',
}

const normalizeUserText = (value?: string | null) => (value ?? '').trim().toLowerCase()

export default function HRSalaryAdvanceTab() {
  const {
    users, currentUserId, employees, departments, salaryAdvances,
    applySalaryAdvance, decideSalaryAdvance, markSalaryAdvancePaid, cancelSalaryAdvance,
    showToast,
  } = useApp()

  const currentUser = users.find(user => user.id === currentUserId) ?? null
  const isApprover = ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')
  const isFinance = ['director', 'finance_officer'].includes(currentUser?.role ?? '')
  const currentUsername = normalizeUserText(currentUser?.username)
  const myEmployee = employees.find(employee => {
    if (!currentUser) return false
    const employeeEmailUser = normalizeUserText(employee.email?.split('@')[0])
    return employee.userId === currentUser.id ||
      normalizeUserText(employee.fullName) === normalizeUserText(currentUser.name) ||
      (!!employeeEmailUser && employeeEmailUser === currentUsername) ||
      normalizeUserText(employee.employeeNo) === currentUsername
  }) ?? null

  const [showApply, setShowApply] = useState(false)
  const [amount, setAmount] = useState('')
  const [paymentTerms, setPaymentTerms] = useState<SalaryAdvance['paymentTerms']>('payroll_deduction')
  const [repaymentMonths, setRepaymentMonths] = useState('1')
  const [repaymentStartPeriod, setRepaymentStartPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [neededByDate, setNeededByDate] = useState('')
  const [reason, setReason] = useState('')
  const [decisionId, setDecisionId] = useState<string | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [filter, setFilter] = useState<'all' | SalaryAdvance['status']>('all')

  const myAdvances = useMemo(
    () => salaryAdvances.filter(item => item.employeeId === myEmployee?.id),
    [salaryAdvances, myEmployee?.id],
  )

  const visibleAdvances = useMemo(() => {
    const list = isApprover ? salaryAdvances : myAdvances
    return filter === 'all' ? list : list.filter(item => item.status === filter)
  }, [filter, isApprover, myAdvances, salaryAdvances])

  const pendingCount = salaryAdvances.filter(item => item.status === 'pending').length
  const approvedOutstanding = salaryAdvances
    .filter(item => item.status === 'approved' || item.status === 'paid')
    .reduce((sum, item) => sum + (item.outstandingAmount ?? item.amount), 0)

  const resetForm = () => {
    setAmount('')
    setPaymentTerms('payroll_deduction')
    setRepaymentMonths('1')
    setRepaymentStartPeriod(new Date().toISOString().slice(0, 7))
    setNeededByDate('')
    setReason('')
  }

  const submit = () => {
    if (!myEmployee) { showToast('No employee record linked. Contact HR.', 'error'); return }
    const advanceAmount = Number(amount)
    const months = Number(repaymentMonths)
    if (!advanceAmount || advanceAmount <= 0) { showToast('Enter a valid amount', 'error'); return }
    if (!months || months <= 0) { showToast('Select a repayment period', 'error'); return }
    applySalaryAdvance({
      employeeId: myEmployee.id,
      employeeName: myEmployee.fullName,
      employeeNo: myEmployee.employeeNo,
      departmentId: myEmployee.departmentId,
      jobTitle: myEmployee.jobTitle,
      amount: advanceAmount,
      paymentTerms,
      repaymentMonths: months,
      repaymentStartPeriod,
      neededByDate: neededByDate || undefined,
      reason: reason.trim(),
    })
    resetForm()
    setShowApply(false)
  }

  const decide = (approved: boolean) => {
    if (!decisionId) return
    decideSalaryAdvance(decisionId, approved, decisionNote.trim() || undefined)
    setDecisionId(null)
    setDecisionNote('')
  }

  const renderAdvanceCard = (item: SalaryAdvance) => {
    const dept = departments.find(department => department.id === item.departmentId)
    return (
      <RecordCard
        key={item.id}
        eyebrow={item.ref}
        title={item.employeeName}
        subtitle={`${dept?.name ?? 'No department'} · ${item.jobTitle ?? 'Employee'}`}
        amount={fmtKes(item.amount)}
        status={<Badge status={statusTone[item.status]} label={item.status.replace('_', ' ')} size="xs" />}
        accent={item.status === 'approved' ? '#10B981' : item.status === 'pending' ? '#F59E0B' : item.status === 'paid' ? '#3B82F6' : '#EF4444'}
        meta={[
          { label: 'Requested', value: fmtDate(item.requestedDate) },
          { label: 'Needed By', value: item.neededByDate ? fmtDate(item.neededByDate) : '—' },
          { label: 'Terms', value: item.paymentTerms === 'payroll_deduction' ? 'Payroll deduction' : 'Manual repayment' },
          { label: 'Start Period', value: item.repaymentStartPeriod },
          { label: 'Monthly Deduction', value: `${fmtKes(item.monthlyDeduction)}/mo` },
          { label: 'Outstanding', value: fmtKes(item.outstandingAmount ?? item.amount) },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {item.status === 'pending' && isApprover && (
              <>
                <button className="btn-primary text-[10px] py-1.5 px-3" onClick={() => { setDecisionId(item.id); setDecisionNote('') }}>Review</button>
              </>
            )}
            {item.status === 'pending' && item.createdByUserId === currentUserId && (
              <button className="btn-outline text-[10px] py-1.5 px-3" onClick={() => cancelSalaryAdvance(item.id)}>Cancel</button>
            )}
            {item.status === 'approved' && isFinance && (
              <button className="btn-primary text-[10px] py-1.5 px-3" style={{ background: '#3B82F6' }} onClick={() => markSalaryAdvancePaid(item.id)}>
                Disburse / Start Recovery
              </button>
            )}
          </div>
        }
      />
    )
  }

  const decisionTarget = decisionId ? salaryAdvances.find(item => item.id === decisionId) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-text-3">Pending Review</p>
          <p className="text-xl font-black text-amber-600 mt-1">{pendingCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-text-3">Outstanding Recovery</p>
          <p className="text-xl font-black text-emerald-600 mt-1">{fmtKes(approvedOutstanding)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[10px] uppercase tracking-wider font-bold text-text-3">My Applications</p>
          <p className="text-xl font-black text-primary-600 mt-1">{myAdvances.length}</p>
        </div>
      </div>

      {!myEmployee && (
        <div className="card p-5 text-center text-sm text-text-3">
          No employee record is linked to your user account. Contact HR before applying for a salary advance.
        </div>
      )}

      <div className="card overflow-hidden">
        <PanelHeader title={isApprover ? 'Salary Advance Applications' : 'My Salary Advances'} count={visibleAdvances.length}>
          <Select
            value={filter}
            onChange={value => setFilter(value as typeof filter)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'paid', label: 'Paid' },
              { value: 'repaid', label: 'Repaid' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
          {myEmployee && <button className="btn-primary text-[11px]" onClick={() => setShowApply(true)}>+ Apply</button>}
        </PanelHeader>

        <div className="p-3 space-y-3">
          {visibleAdvances.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">KES</div>
              <p className="text-xs font-bold text-text-2">No salary advance applications found</p>
              {myEmployee && <button className="btn-primary text-[11px]" onClick={() => setShowApply(true)}>Apply for Salary Advance</button>}
            </div>
          ) : visibleAdvances.map(renderAdvanceCard)}
        </div>
      </div>

      {showApply && myEmployee && (
        <Modal title="Apply for Salary Advance" subtitle={`${myEmployee.fullName} · ${myEmployee.employeeNo}`} width={520} onClose={() => setShowApply(false)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Amount (KES)" required>
              <Input type="number" value={amount} onChange={setAmount} placeholder="0" />
            </Field>
            <Field label="Payment Terms" required>
              <Select value={paymentTerms} onChange={value => setPaymentTerms(value as SalaryAdvance['paymentTerms'])} options={[
                { value: 'payroll_deduction', label: 'Deduct from payroll' },
                { value: 'manual_repayment', label: 'Manual repayment' },
              ]} />
            </Field>
            <Field label="Repayment Period" required>
              <Select value={repaymentMonths} onChange={setRepaymentMonths} options={[
                { value: '1', label: '1 month' },
                { value: '2', label: '2 months' },
                { value: '3', label: '3 months' },
                { value: '6', label: '6 months' },
              ]} />
            </Field>
            <Field label="Deduction Start Period" required>
              <Input type="month" value={repaymentStartPeriod} onChange={setRepaymentStartPeriod} />
            </Field>
            <Field label="Needed By">
              <Input type="date" value={neededByDate} onChange={setNeededByDate} />
            </Field>
            <div className="rounded-xl bg-surface border border-border-lt p-3 text-xs">
              <p className="font-bold text-text-2">Estimated deduction</p>
              <p className="font-mono text-primary-600 mt-1">{fmtKes(Math.ceil((Number(amount) || 0) / Math.max(1, Number(repaymentMonths) || 1)))}/month</p>
            </div>
            <div className="sm:col-span-2">
              <Field label="Reason" required>
                <Textarea value={reason} onChange={setReason} placeholder="Briefly explain why you need the advance" rows={4} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-outline" onClick={() => setShowApply(false)}>Cancel</button>
            <button className="btn-primary" onClick={submit}>Submit Application</button>
          </div>
        </Modal>
      )}

      {decisionTarget && (
        <Modal title="Review Salary Advance" subtitle={`${decisionTarget.ref} · ${decisionTarget.employeeName}`} width={460} onClose={() => setDecisionId(null)}>
          <div className="rounded-xl bg-surface border border-border-lt p-3 text-xs space-y-2">
            <div className="flex justify-between"><span>Amount</span><strong>{fmtKes(decisionTarget.amount)}</strong></div>
            <div className="flex justify-between"><span>Repayment</span><strong>{decisionTarget.repaymentMonths} months</strong></div>
            <div className="flex justify-between"><span>Payment terms</span><strong>{decisionTarget.paymentTerms === 'payroll_deduction' ? 'Payroll deduction' : 'Manual repayment'}</strong></div>
            <div className="flex justify-between"><span>Start period</span><strong>{decisionTarget.repaymentStartPeriod}</strong></div>
            <div className="flex justify-between"><span>Monthly deduction</span><strong>{fmtKes(decisionTarget.monthlyDeduction)}</strong></div>
            <p className="pt-2 border-t border-border-lt text-text-3">{decisionTarget.reason}</p>
          </div>
          <Field label="Decision Note">
            <Textarea value={decisionNote} onChange={setDecisionNote} placeholder="Optional note for the employee" rows={3} />
          </Field>
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => decide(false)}>Reject</button>
            <button className="btn-primary" onClick={() => decide(true)}>Approve</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
