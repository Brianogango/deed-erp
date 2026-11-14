import { canManageHR, canApprovePayroll, canManageFullFinanceAction, canManageHRAssets } from '../permissions'
import type { SalaryAdvance, PayrollRun, EmployeeAssetAssignment, HRDocument } from '../hr'
import { calculatePayroll } from '@/lib/payroll'
import { now, uid } from '../ids'
import { aggregatePayroll } from '@/lib/business-logic'
import { sync } from '../sync'
import type { JournalEntry } from '../finance'
import { isoDate, accountLine, bankAccountLabel } from '../journals'
import { allocateDocNumberSync } from '@/lib/doc-numbers'
import { userCan } from '@/lib/auth/can'
import type { RepairOrder } from '../repairs'
import { allocateRepairRef, takenRepairRefs } from '@/lib/repair-ref'
import { useHrStore as useHrDomainStore } from '@/hooks/useHrStore'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** hr actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createHrActions(store: StoreDeps): Pick<AppState, 'createPayrollRun' | 'approvePayrollRun' | 'postPayrollRun' | 'payPayrollRun' | 'applySalaryAdvance' | 'decideSalaryAdvance' | 'markSalaryAdvancePaid' | 'cancelSalaryAdvance' | 'assignAssetToEmployee' | 'acknowledgeEmployeeAsset' | 'returnEmployeeAsset' | 'reassignEmployeeAsset' | 'uploadMyDocument'> {
  return {
    createPayrollRun: (month, year) => {
        if (!canManageHR(store.currentUser())) { store.showToast('Only HR admins can prepare payroll', 'error'); throw new Error('Unauthorized payroll run creation') }
        const periodKey = `${year}-${month}`
        const recoveryUpdates = new Map<string, SalaryAdvance>()
        const lines = store.empRef.current.filter(emp => emp.status === 'active').map(emp => {
          // Statutory Kenyan payroll (NSSF tiers, SHIF, PAYE bands + personal relief)
          // rather than a flat deduction, so payslip figures are compliant.
          const breakdown = calculatePayroll(emp.basicSalary, emp.housingAllowance ?? 0, emp.transportAllowance ?? 0)
          const baseLine = {
            employeeId: emp.id,
            employeeName: emp.fullName,
            basicSalary: emp.basicSalary,
            allowances: (emp.housingAllowance ?? 0) + (emp.transportAllowance ?? 0),
            deductions: breakdown.totalDeductions,
            netPay: breakdown.netSalary,
          }
          const activeAdvances = store.salaryAdvancesRef.current.filter(advance =>
            advance.employeeId === emp.id &&
            advance.status === 'paid' &&
            advance.paymentTerms === 'payroll_deduction' &&
            advance.repaymentStartPeriod <= periodKey &&
            (advance.outstandingAmount ?? advance.amount) > 0 &&
            !(advance.deductions ?? []).some(deduction => deduction.period === periodKey)
          )
          const salaryAdvanceDeductions = activeAdvances.map(advance => {
            const outstanding = advance.outstandingAmount ?? advance.amount
            const deductionAmount = Math.min(advance.monthlyDeduction, outstanding)
            const remainingAfter = Math.max(0, outstanding - deductionAmount)
            recoveryUpdates.set(advance.id, {
              ...advance,
              amountRecovered: (advance.amountRecovered ?? 0) + deductionAmount,
              outstandingAmount: remainingAfter,
              status: remainingAfter <= 0 ? 'repaid' : advance.status,
              deductions: [
                ...(advance.deductions ?? []),
                { payrollRunId: '', period: periodKey, amount: deductionAmount, date: now() },
              ],
            })
            return { advanceId: advance.id, ref: advance.ref, amount: deductionAmount, remainingAfter }
          })
          const advanceDeductionTotal = salaryAdvanceDeductions.reduce((sum, deduction) => sum + deduction.amount, 0)
          return {
            ...baseLine,
            statutoryDeductions: baseLine.deductions,
            salaryAdvanceDeductions,
            deductions: baseLine.deductions + advanceDeductionTotal,
            netPay: baseLine.netPay - advanceDeductionTotal,
          }
        })
        const { totalGross, totalDeductions, totalNet } = aggregatePayroll(lines)
        const payroll: PayrollRun = { id: uid(), ref: `PAY/${year}/${month}`, month, year, status: 'pending_approval', lines, totalGross, totalDeductions, totalNet }
        store.setPayrollRuns(prev => [payroll, ...prev])
            
            const newPayslips = lines.map((line, index) => ({ id: uid(), ref: `PS/${year}/${month}/${String(index + 1).padStart(3, '0')}`, payrollRunId: payroll.id, employeeId: line.employeeId, employeeName: line.employeeName, month, year, grossPay: line.basicSalary + line.allowances, deductions: line.deductions, salaryAdvanceDeductions: line.salaryAdvanceDeductions, netPay: line.netPay, status: 'draft' as const, generatedDate: now(), downloadUrl: `/payslips/${year}-${month}-${line.employeeId}.pdf` }))
            store.setPayslips(prev => [...newPayslips, ...prev])
            if (recoveryUpdates.size > 0) {
              const payslipByEmployee = new Map(newPayslips.map(payslip => [payslip.employeeId, payslip.id]))
              const nextAdvances = store.salaryAdvancesRef.current.map(advance => {
                const updated = recoveryUpdates.get(advance.id)
                if (!updated) return advance
                return {
                  ...updated,
                  deductions: updated.deductions.map(deduction => deduction.payrollRunId
                    ? deduction
                    : { ...deduction, payrollRunId: payroll.id, payslipId: payslipByEmployee.get(updated.employeeId) }),
                }
              })
              store.salaryAdvancesRef.current = nextAdvances
              store.setSalaryAdvances(nextAdvances)
              // Persist each recovered advance (deductions/outstanding/status) to Prisma.
              recoveryUpdates.forEach((_v, advanceId) => {
                const persisted = nextAdvances.find(a => a.id === advanceId)
                if (persisted) sync(`/api/salary-advances/${advanceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deductions: persisted.deductions, amountRecovered: persisted.amountRecovered, outstandingAmount: persisted.outstandingAmount, status: persisted.status }) })
              })
            }
            // The server recalculates each payslip (one-off pay items, staff loans, deduction cap), so
            // once it has saved the run, reload the runs and payslips it holds so the screen shows the same figures.
            void sync('/api/payroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: payroll, payslips: newPayslips }) })
              .then(async res => {
                if (!res || !res.ok) return
                const fresh = await fetch('/api/payroll', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
                if (fresh?.runs) store.setPayrollRuns(fresh.runs)
                if (fresh?.payslips) store.setPayslips(fresh.payslips)
              })
              .catch(() => {})
            
        store.setWorkflowApprovals(prev => [{ id: uid(), process: 'payroll', ref: payroll.ref, targetId: payroll.id, targetName: `Payroll ${month}/${year}`, stepName: 'Finance Approval', approverRole: 'finance_officer', status: 'pending', requestedBy: store.currentUser()?.name ?? 'HR', requestedDate: now() }, ...prev])
        store.addAuditLog('create_payroll', payroll.ref, `Payroll prepared for ${month}/${year}`)
        store.showToast('Payroll run created and sent for approval')
        return payroll
      },

    approvePayrollRun: (id) => {
        if (!canApprovePayroll(store.currentUser())) { store.showToast('Only Finance or HR approvers can approve payroll', 'error'); return }
        const payroll = store.payrollRef.current.find(run => run.id === id)
        if (!payroll) return
            store.setPayrollRuns(prev => {
              const next = prev.map(run => run.id === id ? { ...run, status: 'approved' as const } : run)
              sync(`/api/payroll/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) })
              return next
            })
        store.setWorkflowApprovals(prev => prev.map(flow => flow.targetId === id && flow.process === 'payroll' && flow.status === 'pending' ? { ...flow, status: 'approved', approverUserId: store.currentUser()?.id, decisionDate: now() } : flow))
        store.addAuditLog('approve_payroll', payroll.ref, `Payroll approved by ${store.currentUser()?.name}`)
        store.showToast('Payroll approved')
      },

    postPayrollRun: async (id) => {
        const payroll = store.payrollRef.current.find(run => run.id === id)
        if (!payroll) return
        if (!canApprovePayroll(store.currentUser())) { store.showToast('Only Finance or HR approvers can post payroll', 'error'); return }
        if (payroll.status !== 'approved') { store.showToast('Payroll must be approved before posting', 'error'); return }
        // The statutory GL journal is created by the payroll posting transaction
        // (6601/6606/6609 Dr; 3310/3302-3306/3311/1931 Cr). postedJournalId is
        // system-controlled there — sending it is rejected with 400.
        let serverJournalId: string | null = null
        try {
          const res = await fetch(`/api/payroll/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'posted' }),
          })
          const payload = await res.json().catch(() => ({})) as { error?: string; item?: { postedJournalId?: string } }
          if (!res.ok) { store.showToast(payload.error || 'Payroll posting failed', 'error'); return }
          serverJournalId = payload.item?.postedJournalId ?? null
        } catch {
          store.showToast('Payroll posting failed', 'error'); return
        }
        // Display-side summary for the blob ledger only. Mirror-skip (source
        // 'payroll') keeps it out of the GL — the API journal is authoritative.
        const journal: JournalEntry = {
          id: uid(), ref: `JRN/PAY/${payroll.year}/${payroll.month}`, date: now(), source: 'payroll', description: `Payroll journal for ${payroll.month}/${payroll.year}`, status: 'posted', payrollRunId: payroll.id,
          lines: [
            { id: uid(), account: '6601 - Salaries', description: `Payroll expense ${payroll.ref}`, debit: payroll.totalGross, credit: 0 },
            { id: uid(), account: '3311 - Other Payroll Deductions Payable', description: `Payroll deductions ${payroll.ref}`, debit: 0, credit: payroll.totalDeductions },
            { id: uid(), account: '3310 - Net Payroll Payable', description: `Net salaries payable ${payroll.ref}`, debit: 0, credit: payroll.totalNet },
          ],
          totalDebit: payroll.totalGross,
          totalCredit: payroll.totalGross,
        }
        store.setJournalEntries(prev => (prev.some(j => j.ref === journal.ref) ? prev : [journal, ...prev]))
        store.setPayrollRuns(prev => prev.map(run => run.id === id ? { ...run, status: 'posted' as const, postedJournalId: journal.id } : run))
        store.setPayslips(prev => prev.map(payslip => payslip.payrollRunId === payroll.id ? { ...payslip, status: 'published' } : payslip))
        store.addAuditLog('post_payroll', payroll.ref, `Payroll posted to accounting (GL journal ${serverJournalId ?? 'unknown'})`)
        store.showToast('Payroll posted to accounting journal')
      },

    payPayrollRun: async (id, bankAccountId, reference, paymentDate) => {
        const user = store.currentUser()
        if (!user || !canManageFullFinanceAction(user)) {
          store.showToast('Only Finance or Director can pay payroll', 'error'); return
        }
        const payroll = store.payrollRef.current.find(run => run.id === id)
        if (!payroll) return
        if (payroll.status !== 'posted') {
          store.showToast('Payroll must be posted before it can be paid', 'error'); return
        }
        const journalRef = `JRN/PAYROLL-PAY/${payroll.ref}`
        if (store.journalEntries.some(j => j.ref === journalRef)) {
          store.showToast('Payroll is already paid', 'info'); return
        }
        const actualBankId = bankAccountId || 'ncba'
        const paidDate = paymentDate || now()
        try {
          const res = await fetch(`/api/payroll/${id}/pay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bankAccountId: actualBankId,
              reference: reference || undefined,
              paymentDate: paidDate,
            }),
          })
          const payload = await res.json().catch(() => ({})) as { error?: string; journal?: { id?: string; ref?: string } }
          if (!res.ok) {
            store.showToast(payload.error || 'Payroll payment failed', 'error'); return
          }
          const journal: JournalEntry = {
            id: payload.journal?.id || uid(),
            ref: payload.journal?.ref || journalRef,
            date: isoDate(paidDate),
            source: 'payment',
            description: `Payroll payment — ${payroll.ref}`,
            status: 'posted',
            payrollRunId: payroll.id,
            bankAccountId: actualBankId,
            lines: [
              accountLine('3310 - Net Payroll Payable', `Settle net payroll ${payroll.ref}`, payroll.totalNet, 0),
              accountLine(bankAccountLabel(actualBankId), `Payroll cash payment ${payroll.ref}`, 0, payroll.totalNet),
            ],
            totalDebit: payroll.totalNet,
            totalCredit: payroll.totalNet,
          }
          store.setJournalEntries(prev => prev.some(j => j.ref === journal.ref) ? prev : [journal, ...prev])
          store.setPayslips(prev => prev.map(ps => ps.payrollRunId === payroll.id
            ? { ...ps, paymentStatus: 'paid', paidAt: isoDate(paidDate), paymentReference: reference }
            : ps))
          store.addAuditLog('pay_payroll', payroll.ref, `Payroll paid from ${actualBankId}${reference ? ` (Ref: ${reference})` : ''}`)
          store.showToast('Payroll payment posted to Cashbook', 'success')
        } catch {
          store.showToast('Payroll payment failed', 'error')
        }
      },

    applySalaryAdvance: (request) => {
        const user = store.currentUser()
        if (!user) { store.showToast('You must be logged in to apply for a salary advance', 'error'); throw new Error('Not authenticated') }
        const amount = Number(request.amount) || 0
        const repaymentMonths = Math.max(1, Number(request.repaymentMonths) || 1)
        if (amount <= 0) { store.showToast('Enter a valid advance amount', 'error'); throw new Error('Invalid amount') }
        if (!request.reason.trim()) { store.showToast('Enter a reason for the advance', 'error'); throw new Error('Missing reason') }
        const currentPeriod = now().slice(0, 7)
        let advance: SalaryAdvance
        try {
          advance = {
            ...request,
            amount,
            paymentTerms: request.paymentTerms ?? 'payroll_deduction',
            repaymentMonths,
            repaymentStartPeriod: request.repaymentStartPeriod || currentPeriod,
            monthlyDeduction: Math.ceil(amount / repaymentMonths),
            amountRecovered: 0,
            outstandingAmount: amount,
            deductions: [],
            id: uid(),
            ref: allocateDocNumberSync('ADV'), // the server's record carries its own
            requestedDate: now(),
            status: 'pending',
            createdByUserId: user.id,
          }
        } catch (err: any) {
          store.showToast(err?.message || 'Could not create salary advance reference', 'error')
          throw err
        }
        store.salaryAdvancesRef.current = [advance, ...store.salaryAdvancesRef.current]
        store.setSalaryAdvances(prev => [advance, ...prev])
        void fetch('/api/salary-advances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(advance),
        })
          .then(async res => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({} as { error?: string }))
              store.salaryAdvancesRef.current = store.salaryAdvancesRef.current.filter(item => item.id !== advance.id)
              store.setSalaryAdvances(prev => prev.filter(item => item.id !== advance.id))
              store.setWorkflowApprovals(prev => prev.filter(flow => !(flow.targetId === advance.id && flow.process === 'salary_advance')))
              store.showToast(err.error || 'Failed to save salary advance', 'error')
              return
            }
            const saved = await res.json() as SalaryAdvance
            if (!saved?.id) return
            store.salaryAdvancesRef.current = store.salaryAdvancesRef.current.map(item =>
              item.id === advance.id ? { ...item, ...saved } : item,
            )
            store.setSalaryAdvances(prev => prev.map(item =>
              item.id === advance.id ? { ...item, ...saved } : item,
            ))
            store.setWorkflowApprovals(prev => prev.map(flow =>
              flow.targetId === advance.id && flow.process === 'salary_advance'
                ? { ...flow, targetId: saved.id, ref: saved.ref || flow.ref }
                : flow,
            ))
          })
          .catch(() => {
            store.salaryAdvancesRef.current = store.salaryAdvancesRef.current.filter(item => item.id !== advance.id)
            store.setSalaryAdvances(prev => prev.filter(item => item.id !== advance.id))
            store.showToast('Failed to save salary advance', 'error')
          })
        store.setWorkflowApprovals(prev => [{
          id: uid(), process: 'salary_advance', ref: advance.ref, targetId: advance.id, targetName: advance.employeeName,
          stepName: 'Salary Advance Approval', approverRole: 'finance_officer', status: 'pending',
          requestedBy: user.name, requestedDate: now(),
        }, ...prev])
        store.addAuditLog('salary_advance_apply', advance.ref, `${advance.employeeName} requested ${store.fmtKes(amount)}`)
        store.showToast(`Salary advance ${advance.ref} submitted for approval`)
        return advance
      },

    decideSalaryAdvance: (id, approved, note) => {
        const user = store.currentUser()
        if (!userCan(user, 'managePayroll')) {
          store.showToast('Only Finance or Director can review salary advances', 'error')
          return
        }
        const advance = store.salaryAdvancesRef.current.find(item => item.id === id)
        if (!advance) return
        if (advance.status !== 'pending') { store.showToast('This salary advance has already been reviewed', 'error'); return }
        const status: SalaryAdvance['status'] = approved ? 'approved' : 'rejected'
        const patch = {
          status,
          approvedByUserId: user?.id,
          approvedByName: user?.name,
          decisionDate: now(),
          decisionNote: note,
        }
        store.salaryAdvancesRef.current = store.salaryAdvancesRef.current.map(item => item.id === id ? { ...item, ...patch } : item)
        store.setSalaryAdvances(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
        sync(`/api/salary-advances/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'decide', approved, note }) })
        store.setWorkflowApprovals(prev => prev.map(flow => flow.targetId === id && flow.process === 'salary_advance' && flow.status === 'pending'
          ? { ...flow, status: approved ? 'approved' : 'rejected', approverUserId: user?.id, decisionDate: now() }
          : flow))
        store.addAuditLog('salary_advance_decide', advance.ref, `${approved ? 'Approved' : 'Rejected'} by ${user?.name}`)
        store.showToast(`Salary advance ${approved ? 'approved' : 'rejected'}`)
      },

    markSalaryAdvancePaid: (id, paidDate = now().slice(0, 10)) => {
        const user = store.currentUser()
        if (!userCan(user, 'managePayroll')) {
          store.showToast('Only Finance can mark salary advances as paid', 'error')
          return
        }
        const advance = store.salaryAdvancesRef.current.find(item => item.id === id)
        if (!advance) return
        if (advance.status !== 'approved') { store.showToast('Only approved advances can be marked paid', 'error'); return }
        const patch = {
          status: 'paid' as const,
          paidDate,
          outstandingAmount: advance.outstandingAmount ?? advance.amount,
          amountRecovered: advance.amountRecovered ?? 0,
          deductions: advance.deductions ?? [],
        }
        store.salaryAdvancesRef.current = store.salaryAdvancesRef.current.map(item => item.id === id ? { ...item, ...patch } : item)
        store.setSalaryAdvances(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
        sync(`/api/salary-advances/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pay', paidDate }) })
        store.addAuditLog('salary_advance_paid', advance.ref, `Marked paid by ${user?.name}`)
        store.showToast('Salary advance marked as paid')
      },

    cancelSalaryAdvance: (id) => {
        const user = store.currentUser()
        const advance = store.salaryAdvancesRef.current.find(item => item.id === id)
        if (!advance) return
        if (advance.status !== 'pending') { store.showToast('Only pending advances can be cancelled', 'error'); return }
        if (advance.createdByUserId !== user?.id && !userCan(user, 'managePayroll')) {
          store.showToast('You can only cancel your own pending advance', 'error')
          return
        }
        store.salaryAdvancesRef.current = store.salaryAdvancesRef.current.map(item => item.id === id ? { ...item, status: 'cancelled' as const } : item)
        store.setSalaryAdvances(prev => prev.map(item => item.id === id ? { ...item, status: 'cancelled' as const } : item))
        sync(`/api/salary-advances/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })
        store.setWorkflowApprovals(prev => prev.map(flow => flow.targetId === id && flow.process === 'salary_advance' && flow.status === 'pending'
          ? { ...flow, status: 'rejected', approverUserId: user?.id, decisionDate: now() }
          : flow))
        store.showToast('Salary advance cancelled')
      },

    assignAssetToEmployee: (employeeId, productId, qty, serialId, handoverCondition = 'good', handoverNotes = '') => {
        const employee = store.empRef.current.find(emp => emp.id === employeeId)
        const product = store.prodRef.current.find(prod => prod.id === productId)
        if (!employee || !product) return
        if (!canManageHRAssets(store.currentUser())) { store.showToast('Only HR or inventory controllers can assign assets', 'error'); return }
        const serial = serialId ? store.serialRef.current.find(item => item.id === serialId) : undefined
        if (product.requiresSerial && !serial) { store.showToast('Serialized assets require a serial selection', 'error'); return }
        const assignment: EmployeeAssetAssignment = { id: uid(), employeeId, employeeName: employee.fullName, productId, productName: product.name, serialId, serialNumber: serial?.serial, qty, assignedDate: now(), status: 'assigned', acknowledgedByEmployee: false, handoverCondition, handoverNotes }
        store.setEmployeeAssetAssignments(prev => [assignment, ...prev])
        if (serial) {
          store.setSerials(prev => prev.map(item => item.id === serial.id ? { ...item, status: 'assigned', location: 'employee' } : item))
        } else {
          store.setBulkStock(prev => store.upsertBulkStock(prev, productId, 'warehouse', -qty))
        }
        store.setProducts(prev => prev.map(item => item.id === productId ? { ...item, stockQty: Math.max(0, item.stockQty - qty) } : item))
        const empUserId2 = employee.userId
        if (empUserId2) {
          store.notifyUsers({
            recipients: [empUserId2],
            type: 'asset',
            title: 'Asset assigned to you',
            body: `${product.name}${serial ? ` (S/N: ${serial.serial})` : ` ×${qty}`} has been issued to you. Please acknowledge receipt.`,
            module: 'hr',
            path: '?tab=self_service',
            icon: '💻',
            entityKey: `asset:${assignment.id}:assigned`,
            excludeUserId: store.currentUserId,
          })
        }
        store.addAuditLog('assign_asset', assignment.productName, `Assigned ${assignment.productName} to ${employee.fullName}`)
        store.showToast('Asset assigned to employee')
      },

    acknowledgeEmployeeAsset: (assignmentId, notes) => {
        const assignment = store.assetRef.current.find(item => item.id === assignmentId)
        if (!assignment || assignment.acknowledgedByEmployee) return
        const employee = store.empRef.current.find(item => item.id === assignment.employeeId)
        const user = store.currentUser()
        if (!(user && (canManageHRAssets(user) || employee?.userId === user.id))) { store.showToast('Only HR, inventory, or the assigned employee can acknowledge this asset', 'error'); return }
        store.setEmployeeAssetAssignments(prev => prev.map(item => item.id === assignmentId ? { ...item, acknowledgedByEmployee: true, acknowledgmentDate: now(), handoverNotes: notes ?? item.handoverNotes } : item))
        store.addAuditLog('acknowledge_asset', assignment.productName, `Acknowledged ${assignment.productName} by ${assignment.employeeName}`)
        store.showToast('Asset acknowledged')
      },

    returnEmployeeAsset: (assignmentId, returnLocation, condition, notes) => {
        const assignment = store.assetRef.current.find(item => item.id === assignmentId)
        if (!assignment || assignment.status !== 'assigned') return
        if (!canManageHRAssets(store.currentUser())) { store.showToast('Only HR or inventory controllers can receive returned assets', 'error'); return }
        const product = store.prodRef.current.find(item => item.id === assignment.productId)
        if (!product) return
        store.setEmployeeAssetAssignments(prev => prev.map(item => item.id === assignmentId ? { ...item, status: 'returned', returnedDate: now(), returnLocation, returnCondition: condition, returnInspectionNotes: notes } : item))
        if (condition === 'damaged') {
          if (assignment.serialId) {
            store.setSerials(prev => prev.map(serial => serial.id === assignment.serialId ? { ...serial, status: 'under_repair', location: 'repair_unit' } : serial))
          } else {
            store.setBulkStock(prev => store.upsertBulkStock(prev, assignment.productId, 'repair_unit', assignment.qty))
          }
          const repair: RepairOrder = {
            id: uid(),
            ref: allocateRepairRef(takenRepairRefs(store.repairsRef.current)),
            status: 'received',
            customerId: assignment.employeeId,
            customerName: assignment.employeeName,
            customerPhone: '',
            productId: assignment.productId,
            productName: assignment.productName,
            serialNumber: assignment.serialNumber ?? '',
            serialId: assignment.serialId,
            intakeChannel: 'walk_in',
            intakeDate: new Date().toISOString(),
            intakeNotes: `Internal asset return - ${notes || 'Damaged on return'}`,
            issueDescription: `Device returned damaged from employee asset assignment`,
            accessories: [],
            underWarranty: false,
            partsUsed: [],
            laborCost: 0,
            logisticsCost: 0,
            total: 0,
            qcItems: [],
            createdBy: store.currentUser()?.username ?? 'system',
            createdDate: now(),
            notes,
            slaMissed: false,
            date: now(),
            description: `Internal asset return inspection: ${notes || 'Damaged on return'}`,
            technicianName: '',
            intakeSource: 'employee_asset_return',
            linkedEmployeeId: assignment.employeeId,
            bookedByName: store.currentUser()?.name ?? 'System',
          }
          store.setRepairs(prev => [repair, ...prev])
          store.addAuditLog('return_asset_repair', assignment.productName, `Damaged return routed to repair for ${assignment.productName}`)
          store.showToast(`Damaged asset routed to repair unit via ${repair.ref}`, 'info')
          return
        }
        if (assignment.serialId) {
          store.setSerials(prev => prev.map(serial => serial.id === assignment.serialId ? { ...serial, status: 'available', location: returnLocation } : serial))
        } else {
          store.setBulkStock(prev => store.upsertBulkStock(prev, assignment.productId, returnLocation, assignment.qty))
        }
        store.setProducts(prev => prev.map(item => item.id === assignment.productId ? { ...item, stockQty: item.stockQty + assignment.qty } : item))
        store.addAuditLog('return_asset', assignment.productName, `Returned ${assignment.productName} from ${assignment.employeeName} in ${condition} condition`)
        store.showToast('Asset returned to inventory')
      },

    reassignEmployeeAsset: (assignmentId, employeeId) => {
        const assignment = store.assetRef.current.find(item => item.id === assignmentId)
        const employee = store.empRef.current.find(item => item.id === employeeId)
        if (!assignment || !employee || assignment.status !== 'assigned') return
        if (!canManageHRAssets(store.currentUser())) { store.showToast('Only HR or inventory controllers can reassign assets', 'error'); return }
        store.setEmployeeAssetAssignments(prev => prev.map(item => item.id === assignmentId ? { ...item, status: 'reassigned', returnedDate: now(), returnLocation: 'employee' } : item))
        store.setEmployeeAssetAssignments(prev => [{ ...assignment, id: uid(), employeeId: employee.id, employeeName: employee.fullName, assignedDate: now(), previousAssignmentId: assignment.id, status: 'assigned', acknowledgedByEmployee: false, acknowledgmentDate: undefined }, ...prev])
        store.addAuditLog('reassign_asset', assignment.productName, `Reassigned ${assignment.productName} to ${employee.fullName}`)
        store.showToast('Asset reassigned')
      },

    uploadMyDocument: (document) => {
        const user = store.currentUser()
        if (!user) { store.showToast('You must be logged in to upload documents', 'error'); throw new Error('Not authenticated') }
        const emp = store.empRef.current.find(e => e.userId === user.id)
        if (!emp) { store.showToast('No employee record linked to your account. Contact HR.', 'error'); throw new Error('No employee record') }
        const doc: HRDocument = {
          ...document,
          id: uid(),
          employeeId: emp.id,
          uploadedByUserId: user.id,
          uploadedByName: user.name,
          uploadedDate: now(),
          visibility: 'employee_visible',
        }
        useHrDomainStore.getState().setHRDocuments(prev => [doc, ...prev])
        store.addAuditLog('upload_document', doc.title, `${user.name} uploaded document: ${doc.title}`)
        store.showToast('Document uploaded successfully')
        return doc
      },
  }
}
