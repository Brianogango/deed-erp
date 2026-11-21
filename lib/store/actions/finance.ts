import { canManageFinance, canManageFullFinanceAction } from '../permissions'
import { sync } from '../sync'
import { customerCreditBalance } from '@/lib/customer-credit-view'
import { restoreCancelledInvoiceDecision, restoreSummary } from '@/lib/finance/restore-cancelled-invoice'
import { canApplyCustomerCredit, canPostOrPayCustomerInvoice, DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES, canPayOwnPostedInvoice, paymentJournalRef, canCancelOrResetInvoice } from '@/lib/finance-controls'
import { now, uid } from '../ids'
import type { InvoicePayment, Invoice, BankRecon, Deposit, DepositPayment, DepositStatus, InvoiceLine, JournalEntry, CustomerCredit } from '../finance'
import { autoMatchStatementLines } from '@/lib/accounting/bank-statement-match'
import { normalizeDocumentPaymentDetails } from '@/lib/document-payment-details'
import { buildExpenseApprovalChain } from '@/lib/expense-approval-chain'
import type { Expense } from '../expenses'
import { userIdsWithRoles } from '@/lib/in-app-notifications'
import { bankAccountIdForMethod, buildReversalJournal, buildInvoicePaymentJournal, buildCustomerCreditJournal } from '../journals'
import type { SaleOrder } from '../sales'
import { userCan } from '@/lib/auth/can'
import { validateCompanyAssetInput, type CompanyAsset, nextCompanyAssetRef, resolvedPpeAccountCode, historyEntry, canDeleteCompanyAsset, applyMove, applyCustodian, applyStatusChange, applyDispose, applyWriteOff } from '@/lib/company-property'
import { withBookDefaults, periodKey, canDepreciateAsset, periodAlreadyRun, monthlyBookDepreciation, applyBookDepreciationCharge } from '@/lib/company-property-ppe'
import { initialTaxWdv, applyKraAnnualAllowance } from '@/lib/tax/kra-capital-allowances'
import { buildDisposalJournal, depreciationJournalRef, buildDepreciationJournal } from '@/lib/accounting/ppe-journals'
import { invoicePersistBody, putInvoiceOrCreateThenPost, invoiceErrorMessage } from '@/lib/invoice-persist'
import { formatCustomerAddress } from '@/lib/sync-customer-documents'
import { assertBillableQty } from '@/lib/purchase/three-way-match'
import { readLockVersionFromResponse } from '@/lib/optimistic-lock'
import { invoiceDocState } from '@/lib/odoo-sales-flow'
import { PAID_TO_RIDER, riderFeeAccount } from '@/lib/delivery/rider-direct-pay'
import { isWithholdingMethod, WITHHOLDING_KINDS } from '@/lib/accounting/withholding'
import { type PaymentReversalInfo, applyReversalToInvoices, reversalJournalForStore } from '@/lib/accounting/payment-reversal'
import { nextPosTicketRef } from '@/lib/pos-orders-merge'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** finance actions of the store. `store` reads the provider's current state, setters and helpers. */
/**
 * Who to tell when a claim moves. The submitter was always told; nobody was
 * told the two things that actually block the money — that it is now someone
 * else's turn to approve, and that an approved claim is waiting to be paid.
 */
function notifyExpenseMoved(store: StoreDeps, params: {
  expense: Expense
  reviewerName: string
  reviewerId: string
  fullyApproved: boolean
  nextApproverRole?: string
}) {
  const { expense, fullyApproved, nextApproverRole } = params
  if (fullyApproved) {
    store.notifyUsers({
      // The people who may release the money — the same audience the claim
      // was raised to in the first place.
      recipientRoles: ['director', 'finance_officer'],
      recipients: userIdsWithRoles(store.users, ['director', 'finance_officer'], params.reviewerId),
      type: 'expense',
      title: `Ready to pay · ${expense.ref}`,
      body: `${expense.description} · KES ${Number(expense.amount || 0).toLocaleString('en-KE')} — approved${expense.submittedByName ? ` for ${expense.submittedByName}` : ''} and waiting for payment.`,
      module: 'expenses',
      path: `?tab=review&id=${expense.id}`,
      icon: '💸',
      entityKey: `expense:${expense.id}:ready_to_pay`,
      excludeUserId: params.reviewerId,
    })
    return
  }
  if (!nextApproverRole) return
  store.notifyUsers({
    recipientRoles: [nextApproverRole],
    recipients: userIdsWithRoles(store.users, [nextApproverRole], params.reviewerId),
    type: 'expense',
    title: `Your approval · ${expense.ref}`,
    body: `${expense.description} · KES ${Number(expense.amount || 0).toLocaleString('en-KE')} — approved by ${params.reviewerName}, now waiting for you.`,
    module: 'expenses',
    path: `?tab=review&id=${expense.id}`,
    icon: '⏳',
    entityKey: `expense:${expense.id}:awaiting:${nextApproverRole}`,
    excludeUserId: params.reviewerId,
  })
}

export function createFinanceActions(store: StoreDeps): Pick<AppState, 'allocatePaymentToInvoice' | 'generateReceipt' | 'getCustomerCreditBalance' | 'applyCustomerCreditToInvoice' | 'addStatementLine' | 'updateStatementLine' | 'deleteStatementLine' | 'matchStatementLine' | 'unmatchStatementLine' | 'autoMatchStatements' | 'saveBankRecon' | 'updateBankRecon' | 'updateBankAccount' | 'addBankAccount' | 'deleteBankAccount' | 'getDocumentPaymentDetails' | 'setDocumentPaymentDetails' | 'submitExpense' | 'reviewExpense' | 'payExpense' | 'reimburseExpense' | 'expenseAction' | 'createDeposit' | 'addDepositPayment' | 'completeDeposit' | 'cancelDeposit' | 'createCompanyAsset' | 'updateCompanyAsset' | 'deleteCompanyAsset' | 'moveCompanyAsset' | 'setCompanyAssetCustodian' | 'setCompanyAssetStatus' | 'disposeCompanyAsset' | 'writeOffCompanyAsset' | 'runCompanyAssetDepreciation' | 'linkSerialToCompanyAsset' | 'addAccount' | 'updateAccount' | 'createManualInvoice' | 'importOpeningBalances' | 'moveInvoiceLine' | 'addInvoiceSection' | 'updateInvoice' | 'postInvoice' | 'setInvoicePaymentBlocked' | 'registerPayment' | 'reverseInvoicePayment' | 'resetInvoiceToDraft' | 'restoreCancelledInvoice' | 'cancelInvoice' | 'deleteInvoice' | 'addAuditLog' | 'allocateDocRef'> {
  return {
    allocatePaymentToInvoice: (paymentId, invoiceId, amount) => {
        if (!canManageFinance(store.currentUser())) {
          store.showToast('Only Finance or Admin Officer can allocate payments', 'error'); return;
        }
        const payment = store.payments.find(p => p.id === paymentId)
        const invoice = store.invoices.find(i => i.id === invoiceId)
        if (!payment || !invoice) return
        store.setPayments(prev => {
          const next = prev.map(p => {
            if (p.id !== paymentId) return p
            const existing = p.invoices.find(i => i.invoiceId === invoiceId)
            const updated = existing 
              ? p.invoices.map(i => i.invoiceId === invoiceId ? { ...i, amountAllocated: i.amountAllocated + amount } : i)
              : [...p.invoices, { invoiceId, invoiceRef: invoice.ref, amountAllocated: amount }]
            return { ...p, invoices: updated }
          })
          const updatedP = next.find(p => p.id === paymentId)
          if (updatedP) sync(`/api/payments/${paymentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedP) })
          return next
        })
        store.setInvoices(prev => {
          const next = prev.map(i => {
            if (i.id !== invoiceId) return i
            // Payment progress is derived from amountPaid — status stays Posted.
            return { ...i, amountPaid: i.amountPaid + amount }
          })
          const updatedI = next.find(i => i.id === invoiceId)
          if (updatedI) sync(`/api/invoices/${invoiceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedI) })
          return next
        })
        store.addAuditLog('allocate_payment', payment.ref, `Allocated ${store.fmtKes(amount)} to invoice ${invoice.ref}`)
        store.showToast(`Allocated ${store.fmtKes(amount)} to ${invoice.ref}`, 'success')
      },

    generateReceipt: (paymentId) => {
        const payment = store.payments.find(p => p.id === paymentId)
        if (!payment) return
        store.showToast(`Receipt ${payment.receiptNumber} generated.`, 'info')
      },

    getCustomerCreditBalance: (customerId) => customerCreditBalance(store.customerCreditsRef.current, customerId),

    applyCustomerCreditToInvoice: async (invoiceId, requestedAmount) => {
        const actor = store.currentUser()
        if (!canApplyCustomerCredit(actor?.role)) {
          store.showToast('Only Finance, Admin Officer, or Director can apply customer credit', 'error')
          return
        }
        const inv = store.invRef.current.find(i => i.id === invoiceId)
        if (!inv || inv.type !== 'customer_invoice') return
        if (inv.status === 'draft' || inv.status === 'cancelled') {
          store.showToast('Post the invoice before applying customer credit', 'error')
          return
        }
        const balance = Math.max(0, inv.total - inv.amountPaid)
        if (balance <= 0) {
          store.showToast('Invoice is already fully paid', 'info')
          return
        }
  
        let remaining = Math.min(requestedAmount ?? balance, balance)
        const applications: { creditId: string; amount: number; ref: string }[] = []
        const appliedAt = now()
        const appliedBy = actor?.name ?? 'Finance'
  
        const nextCredits = store.customerCreditsRef.current.map(credit => {
          if (remaining <= 0 || credit.customerId !== inv.partnerId || !['available', 'partially_used'].includes(credit.status) || credit.balance <= 0) return credit
          const amount = Math.min(remaining, credit.balance)
          remaining -= amount
          const nextBalance = Math.max(0, credit.balance - amount)
          applications.push({ creditId: credit.id, amount, ref: credit.ref })
          return {
            ...credit,
            balance: nextBalance,
            status: nextBalance <= 0 ? 'used' : 'partially_used',
            applications: [
              ...(credit.applications ?? []),
              { invoiceId: inv.id, invoiceRef: inv.ref, amount, date: appliedAt, appliedBy },
            ],
          }
        })
  
        const applied = applications.reduce((sum, item) => sum + item.amount, 0)
        if (applied <= 0) {
          store.showToast('No available customer credit for this invoice', 'info')
          return
        }
  
        const paymentId = crypto.randomUUID()
        const payment: InvoicePayment = {
          id: paymentId,
          date: appliedAt,
          amount: applied,
          method: 'customer_credit',
          reference: applications.map(a => a.ref).join(', '),
          recordedBy: appliedBy,
        }
        const prevCredits = store.customerCreditsRef.current
        const prevInvoice = inv
        store.setCustomerCredits(nextCredits as CustomerCredit[])
        const updatedInvoice: Invoice = {
          ...inv,
          amountPaid: inv.amountPaid + applied,
          payments: [...(inv.payments ?? []), payment],
          notes: `${inv.notes || ''}\nApplied customer credit ${applications.map(a => `${a.ref} (${store.fmtKes(a.amount)})`).join(', ')}`.trim(),
        }
        store.setInvoices(prev => prev.map(i => i.id === inv.id ? updatedInvoice : i))
        // No journal is built here: /api/invoices/[id]/payments books the credit
        // application itself (Dr 3313 / Cr 1800). The browser's own JRN/CAPP copy
        // reached the ledger too, so every applied credit came off the customer's
        // balance twice (INV/2026/0262).
  
        try {
          const res = await fetch(`/api/invoices/${inv.id}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: applied,
              paymentMethod: 'customer_credit',
              reference: payment.reference,
              paidAt: appliedAt,
              idempotencyKey: paymentId,
            }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `Credit apply failed (${res.status})`)
          }
        } catch (err: any) {
          store.setCustomerCredits(prevCredits)
          store.setInvoices(prev => prev.map(i => i.id === inv.id ? prevInvoice : i))
          store.showToast(err?.message || 'Failed to apply customer credit', 'error')
          return
        }
  
        store.addAuditLog('apply_customer_credit', inv.ref, `Applied ${store.fmtKes(applied)} customer credit to ${inv.ref}`)
        store.showToast(`Applied ${store.fmtKes(applied)} customer credit`, 'success')
      },

    addStatementLine: (line) => {
        const locked = store.systemSettings.accLockDates && store.bankRecons.some(r => r.bankAccountId === line.bankAccountId && r.month === line.month && r.status === 'reconciled')
        if (locked) { store.showToast('This reconciled bank period is locked. Reopen it before adding statement lines.', 'error'); return }
        store.setBankStatementLines(prev => [...prev, { ...line, id: uid() }])
      },

    updateStatementLine: (id, p) => {
        const line = store.bankStatementLines.find(l => l.id === id)
        const bankAccountId = p.bankAccountId ?? line?.bankAccountId
        const month = p.month ?? line?.month
        const locked = !!bankAccountId && !!month && store.systemSettings.accLockDates && store.bankRecons.some(r => r.bankAccountId === bankAccountId && r.month === month && r.status === 'reconciled')
        if (locked) { store.showToast('This reconciled bank period is locked. Reopen it before editing statement lines.', 'error'); return }
        store.setBankStatementLines(prev => prev.map(l => l.id === id ? { ...l, ...p } : l))
      },

    deleteStatementLine: (id) => {
        const line = store.bankStatementLines.find(l => l.id === id)
        const locked = !!line && store.systemSettings.accLockDates && store.bankRecons.some(r => r.bankAccountId === line.bankAccountId && r.month === line.month && r.status === 'reconciled')
        if (locked) { store.showToast('This reconciled bank period is locked. Reopen it before deleting statement lines.', 'error'); return }
        store.setBankStatementLines(prev => prev.filter(l => l.id !== id))
      },

    matchStatementLine: (statementId, entryId) => {
        const line = store.bankStatementLines.find(l => l.id === statementId)
        const locked = !!line && store.systemSettings.accLockDates && store.bankRecons.some(r => r.bankAccountId === line.bankAccountId && r.month === line.month && r.status === 'reconciled')
        if (locked) { store.showToast('This reconciled bank period is locked. Reopen it before changing matches.', 'error'); return }
        store.setBankStatementLines(prev => prev.map(l =>
          l.id === statementId ? { ...l, matchedEntryId: entryId } : l
        ))
      },

    unmatchStatementLine: (statementId) => {
        const line = store.bankStatementLines.find(l => l.id === statementId)
        const locked = !!line && store.systemSettings.accLockDates && store.bankRecons.some(r => r.bankAccountId === line.bankAccountId && r.month === line.month && r.status === 'reconciled')
        if (locked) { store.showToast('This reconciled bank period is locked. Reopen it before changing matches.', 'error'); return }
        store.setBankStatementLines(prev => prev.map(l =>
          l.id === statementId ? { ...l, matchedEntryId: undefined } : l
        ))
      },

    autoMatchStatements: (bankAccountId, month, cashbookEntries) => {
        const locked = store.systemSettings.accLockDates && store.bankRecons.some(r => r.bankAccountId === bankAccountId && r.month === month && r.status === 'reconciled')
        if (locked) { store.showToast('This reconciled bank period is locked. Reopen it before auto-matching.', 'error'); return 0 }
        const scoped = store.bankStatementLines.filter(
          l => l.bankAccountId === bankAccountId && l.month === month,
        )
        const { lines: matchedScoped, matchedCount } = autoMatchStatementLines({
          statementLines: scoped,
          cashbookEntries,
          bankAccountId,
          month,
        })
        const byId = new Map(matchedScoped.map(l => [l.id, l]))
        store.setBankStatementLines(prev => prev.map(l => byId.get(l.id) ?? l))
        return matchedCount
      },

    saveBankRecon: (recon) => {
        if (!canManageFullFinanceAction(store.currentUser())) {
          store.showToast('Only Finance or Director can save bank reconciliations', 'error'); return;
        }
        const user = store.currentUser()
        const existing = store.bankRecons.find(r => r.bankAccountId === recon.bankAccountId && r.month === recon.month)
        if (existing && existing.status === 'reconciled' && store.systemSettings.accLockDates && recon.status !== 'pending') {
          store.showToast('This reconciled bank period is locked. Reopen it before resaving.', 'error'); return
        }
        if (existing) {
          const updatedRecon = { ...existing, ...recon, reconciledBy: user?.name, reconciledAt: now() }
          store.setBankRecons(prev => prev.map(r => r.id === existing.id ? updatedRecon : r))
          store.addAuditLog(recon.status === 'pending' ? 'reopen_bank_recon' : 'update_bank_recon', `${recon.bankAccountId}/${recon.month}`, `Bank reconciliation ${recon.status === 'pending' ? 'reopened' : 'updated'} for ${recon.bankAccountId} ${recon.month}`)
        } else {
          const newRecon: BankRecon = { ...recon, id: uid(), reconciledBy: user?.name, reconciledAt: now() }
          store.setBankRecons(prev => [...prev, newRecon])
          store.addAuditLog('save_bank_recon', `${recon.bankAccountId}/${recon.month}`, `Bank reconciliation saved as ${recon.status}`)
        }
        store.showToast(recon.status === 'reconciled' ? 'Bank period reconciled and locked' : 'Bank reconciliation saved', 'success')
      },

    updateBankRecon: (id, p) => {
        const existing = store.bankRecons.find(r => r.id === id)
        if (existing?.status === 'reconciled' && store.systemSettings.accLockDates && p.status !== 'pending') {
          store.showToast('This reconciled bank period is locked. Reopen it before editing.', 'error'); return
        }
        store.setBankRecons(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
      },

    updateBankAccount: (id, p) => store.setBankAccountsState(prev => prev.map(a => a.id === id ? { ...a, ...p } : a)),

    addBankAccount: (a) => {
        const id = uid()
        store.setBankAccountsState(prev => [...prev, { ...a, id }])
        return id
      },

    deleteBankAccount: (id) => store.setBankAccountsState(prev => prev.filter(a => a.id !== id)),

    getDocumentPaymentDetails: (documentId) =>
        normalizeDocumentPaymentDetails(store.documentPaymentDetails[documentId]),

    setDocumentPaymentDetails: (documentId, details) => {
        if (!documentId) return
        const next = normalizeDocumentPaymentDetails(details)
        store.setDocumentPaymentDetailsState(prev => ({ ...prev, [documentId]: next }))
      },

    submitExpense: (e) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return null }
        const expenseRule = store.dbApprovalRules.find(r => r.approvalType === 'expense' && r.isActive)
        const approvalChain = buildExpenseApprovalChain(
          Number(e.amount) || 0,
          expenseRule?.thresholds,
        )
        // Strip receiptDataUrl from the expense object saved in deed_expenses.
        // Receipts are stored separately under expense_receipt_<id> via the API so
        // the deed_expenses blob stays small and loads instantly.
        const { receiptDataUrl: _receiptBlob, ...eMeta } = e as (typeof e & { receiptDataUrl?: string })
        const expense: Expense = {
          ...eMeta,
          id: uid(),
          ref: store.expenseRef(),
          submittedByUserId: user.id,
          submittedByName: user.name,
          submittedDate: now(),
          status: 'submitted',
          approvalChain,
          createdAt: now(),
        }
        // Upload the receipt blob separately (non-blocking)
        if (_receiptBlob) {
          fetch(`/api/expense-receipts/${expense.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl: _receiptBlob,
              fileName: expense.receiptFileName,
              fileType: expense.receiptFileType,
              fileSize: expense.receiptFileSize,
            }),
          }).then(res => {
            if (!res.ok) throw new Error(String(res.status))
          }).catch(() => {
            // It used to fail silently, leaving a claim that says it has a
            // receipt the server never stored. Open the claim and attach it again.
            store.showToast('The receipt did not upload — open the claim and attach it again', 'error')
          })
        }
        store.setExpenses(prev => [expense, ...prev])
        // Notify finance / director approvers (not the submitter)
        store.notifyUsers({
          recipientRoles: ['director', 'finance_officer'],
          recipients: userIdsWithRoles(store.users, ['director', 'finance_officer'], user.id),
          type: 'expense',
          title: `Expense claim from ${expense.submittedByName}`,
          // The number is still provisional here; the server's EXP number replaces it a moment later.
          body: `${expense.description} · KES ${expense.amount.toLocaleString()}`,
          module: 'expenses',
          icon: '💰',
          entityKey: `expense:${expense.id}:submitted`,
          excludeUserId: user.id,
        })
        store.showToast('Expense claim submitted', 'success')
        return expense
      },

    // Approve / reject, pay and reimburse go through the server, which
    // changes the claim and posts its journal together (they used to be two
    // saves that could disagree: a claim "paid" with no payment in the books).
    reviewExpense: (id, approved, notes) => {
        void store.storeCtxRef.current!.expenseAction({ action: 'review', ids: [id], approved, notes })
      },

    payExpense: (id, method, bankAccountId, reference, paymentDate, notes) => {
        void store.storeCtxRef.current!.expenseAction({
          action: 'pay', ids: [id], method: method || 'bank', bankAccountId, reference,
          date: paymentDate || now().slice(0, 10), notes,
        })
      },

    reimburseExpense: (id, notes, method, bankAccountId, reference, paymentDate) => {
        void store.storeCtxRef.current!.expenseAction({
          action: 'pay', ids: [id], method: method || 'bank', bankAccountId, reference,
          date: paymentDate || now().slice(0, 10), notes,
        })
      },

    expenseAction: async (body) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return { ok: false } }
        let res: Response
        try {
          res = await fetch('/api/expenses/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        } catch {
          store.showToast('No connection — nothing was changed', 'error')
          return { ok: false, error: 'offline' }
        }
        const data = await res.json().catch(() => ({})) as { claims?: Expense[]; failed?: { reason: string }[]; batchRef?: string; error?: string }
        if (!res.ok) {
          store.showToast(data.error || 'Could not save — nothing was changed', 'error')
          return { ok: false, error: data.error }
        }
        const rows = data.claims ?? []
        const byId = new Map(rows.map(r => [r.id, r]))
        if (rows.length) store.setExpenses(prev => prev.map(e => byId.get(e.id) ?? e))
        const skipped = data.failed ?? []

        if (body.action === 'review') {
          for (const claim of rows) {
            const fullyApproved = claim.status === 'approved'
            const rejected = claim.status === 'rejected'
            const pending = claim.approvalChain?.find(s => s.status === 'pending')
            if (claim.submittedByUserId) {
              store.notifyUsers({
                recipients: [claim.submittedByUserId],
                type: 'expense',
                title: rejected ? 'Expense claim rejected' : fullyApproved ? 'Expense claim approved ✓' : 'Expense claim — next approval',
                body: rejected
                  ? `Your expense claim ${claim.ref} was rejected by ${user.name}.${body.notes ? ' Note: ' + body.notes : ''} You can correct it and send it again.`
                  : fullyApproved
                    ? `Your expense claim ${claim.ref} (${claim.description}) is fully approved.${body.notes ? ' Note: ' + body.notes : ''}`
                    : `Your expense claim ${claim.ref} was approved by ${user.name}. Awaiting ${pending?.role?.replace('_', ' ') ?? 'next approver'}.`,
                module: 'expenses',
                path: `?id=${claim.id}`,
                icon: rejected ? '❌' : fullyApproved ? '💰' : '⏳',
                entityKey: `expense:${claim.id}:review`,
                excludeUserId: user.id,
              })
            }
            if (!rejected) {
              notifyExpenseMoved(store, { expense: claim, reviewerName: user.name, reviewerId: user.id, fullyApproved, nextApproverRole: pending?.role })
            }
          }
          const verb = body.approved ? 'approved' : 'rejected'
          store.showToast(
            rows.length === 1 && !skipped.length
              ? (body.approved ? (rows[0].status === 'approved' ? 'Expense approved and posted' : 'Step approved — awaiting next approver') : 'Expense rejected')
              : `${rows.length} claim${rows.length === 1 ? '' : 's'} ${verb}${skipped.length ? ` · ${skipped.length} skipped: ${skipped.map(f => f.reason).join('; ')}` : ''}`,
            body.approved ? 'success' : 'info',
          )
        } else if (body.action === 'pay') {
          const total = rows.reduce((sum, r) => sum + r.amount, 0)
          for (const claim of rows) {
            if (claim.submittedByUserId && claim.status === 'reimbursed') {
              store.notifyUsers({
                recipients: [claim.submittedByUserId],
                type: 'expense',
                title: 'Expense reimbursed',
                body: `${claim.ref} (${claim.description}) was reimbursed${data.batchRef ? ` with ${data.batchRef}` : ''}.`,
                module: 'expenses',
                path: `?id=${claim.id}`,
                icon: '💸',
                entityKey: `expense:${claim.id}:paid`,
                excludeUserId: user.id,
              })
            }
          }
          for (const claim of rows) {
            store.addAuditLog('post_expense_payment', claim.ref, `${claim.ref} ${claim.status}${data.batchRef ? ` with ${data.batchRef}` : ''}`)
          }
          store.showToast(
            rows.length > 1
              ? `${data.batchRef}: ${rows.length} claims paid in one payment of ${store.fmtKes(total)}`
              : rows[0]?.status === 'reimbursed' ? 'Expense reimbursed and posted' : 'Expense marked paid',
            'success',
          )
        } else {
          const done = body.action === 'edit' ? 'Claim updated' : body.action === 'withdraw' ? 'Claim withdrawn' : 'Claim sent again for approval'
          store.showToast(done, 'success')
          if (body.action === 'resubmit' && rows[0]) {
            const claim = rows[0]
            store.notifyUsers({
              recipientRoles: ['director', 'finance_officer'],
              recipients: userIdsWithRoles(store.users, ['director', 'finance_officer'], user.id),
              type: 'expense',
              title: `Expense claim sent again by ${claim.submittedByName}`,
              body: `${claim.ref} · ${claim.description} · KES ${claim.amount.toLocaleString()}`,
              module: 'expenses',
              icon: '💰',
              entityKey: `expense:${claim.id}:resubmitted:${claim.history?.length ?? 0}`,
              excludeUserId: user.id,
            })
          }
        }
        return { ok: true, batchRef: data.batchRef, count: rows.length }
      },

    createDeposit: async (d) => {
        const user = store.currentUser()
        if (!user) throw new Error('Please log in to continue')
  
        const { initialPayment = 0, payMethod = 'cash', payRef, ...depositInput } = d
        const paid = Number(initialPayment)
        if (!Number.isFinite(paid) || paid <= 0) {
          throw new Error('Initial payment must be greater than zero')
        }
        if (
          !depositInput.customerId ||
          !depositInput.customerName.trim() ||
          depositInput.items.length === 0 ||
          depositInput.items.some(item =>
            !item.productId || !item.productName.trim() || item.qty <= 0 || item.unitPrice < 0
          )
        ) {
          throw new Error('Complete the customer and every reserved item before saving')
        }
        if (paid > depositInput.totalValue) {
          throw new Error('Initial payment cannot exceed the order total')
        }
  
        // Allocate the linked quotation reference before persisting either record.
        // If allocation fails, the deposit is not partially created.
        const quotationRef = await store.storeCtxRef.current!.allocateDocRef('QUO')
        const provisionalId = uid()
        const response = await fetch('/api/deposits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...depositInput,
            id: provisionalId,
            initialPayment: paid,
            payMethod,
            payRef,
          }),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(String(body?.error ?? 'Could not save deposit'))
        }
  
        const deposit = body as Deposit
        store.setDeposits(prev => [deposit, ...prev])
        // No journal is built here. /api/deposits posted the receipt journal in
        // the same transaction that created this deposit, as
        // JRN/DEP/<ref>/<full payment id>. The local copy used a truncated id,
        // so the two refs never matched, the mirror could not dedupe them, and
        // every deposit receipt landed in the ledger twice.
  
        const soLines = deposit.items.map(item => ({
          id: uid(),
          productId: item.productId,
          productName: item.productName,
          qty: item.qty,
          unitPrice: item.unitPrice,
          discount: 0,
          taxRate: 0,
          subtotal: item.total,
          serialIds: [],
          accountCode: '',
        }))
        const saleOrder: SaleOrder = {
          id: uid(),
          ref: quotationRef,
          status: 'quotation',
          customerId: deposit.customerId,
          customerName: deposit.customerName,
          date: now(),
          validUntil: store.addDays(now(), 30),
          lines: soLines,
          ...store.calcSO(soLines),
          notes: `Linked to deposit ${deposit.ref}`,
          createdByUserId: user.id,
          createdByName: user.name,
        }
        const quotationResponse = await fetch('/api/sale-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saleOrder),
        })
        if (quotationResponse.ok) {
          store.setSaleOrders(prev => [saleOrder, ...prev])
        } else {
          store.showToast(
            `${deposit.ref} was created, but its linked quotation could not be saved. Please retry from Sales.`,
            'error',
          )
        }
        return deposit
      },

    addDepositPayment: (depositId, p) => {
        let updatedDeposit: Deposit | undefined
        let paymentToSync: DepositPayment | undefined
        store.setDeposits(prev => prev.map(d => {
          if (d.id !== depositId) return d
          const amount = Math.min(Math.max(Number(p.amount) || 0, 0), d.balance)
          if (amount <= 0) return d
          const payment: DepositPayment = { ...p, id: uid(), amount }
          const totalPaid = d.totalPaid + payment.amount
          const balance = Math.max(0, d.totalValue - totalPaid)
          const status: DepositStatus = balance <= 0 ? 'fully_paid' : totalPaid > 0 ? 'partially_paid' : 'active'
          updatedDeposit = { ...d, payments: [...d.payments, payment], totalPaid, balance, status }
          paymentToSync = payment
          return updatedDeposit
        }))
        if (updatedDeposit && paymentToSync) {
          // The receipt journal is posted by /api/deposits/[id]/payments. The
          // local copy keyed its ref on a truncated payment id that never
          // matched the server's, so the ledger took the receipt twice.
          // idempotencyKey makes a retry safe: the service returns the existing
          // deposit rather than taking a second payment.
          store.syncOrWarn(`/api/deposits/${depositId}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: paymentToSync.amount,
              method: paymentToSync.method,
              ref: paymentToSync.ref,
              idempotencyKey: paymentToSync.id,
            }),
          }, message => store.showToast(message, 'error'), 'Deposit payment could not be recorded — please retry')
          store.showToast('Payment recorded', 'success')
        } else {
          store.showToast('Payment must be greater than zero and within the remaining balance', 'error')
        }
      },

    completeDeposit: (depositId) => {
        const deposit = store.deposits.find(d => d.id === depositId)
        if (!deposit) return
        if (deposit.status !== 'fully_paid') {
          store.showToast('Only fully paid deposits can be marked as collected', 'error')
          return
        }
        // A customer deposit is a liability until the sale is invoiced. Clearing
        // 3100 straight into revenue skips VAT and the AR subledger, which is why
        // /complete requires an invoice and refuses to recognise revenue itself.
        //
        // This used to build the entry locally — crediting 5000 when no invoice
        // was linked — and POST to /complete with an empty body, which failed its
        // schema every time. sync() swallowed the 422, so the liability looked
        // cleared while the server had done nothing, and the only thing reaching
        // the ledger was the blob mirror replaying the wrong journal.
        let appliedAmount = 0
        let appliedInvoiceId: string | undefined
        if (deposit.totalPaid > 0) {
          const linkedSo = store.saleOrders.find(s => (s.notes || '').includes(deposit.ref))
          const linkedInv = linkedSo
            ? store.invRef.current.find(i =>
                i.type === 'customer_invoice'
                && i.status === 'posted'
                && i.saleOrderId === linkedSo.id
                && (i.total - i.amountPaid) > 0)
            : undefined
          if (!linkedInv) {
            store.showToast(
              `Post the invoice for ${deposit.ref}'s sale order first — a deposit cannot be taken to revenue directly`,
              'error',
            )
            return
          }
          appliedInvoiceId = linkedInv.id
          appliedAmount = Math.min(deposit.totalPaid, linkedInv.total - linkedInv.amountPaid)
          if (appliedAmount > 0) {
            const payment: InvoicePayment = {
              id: uid(),
              date: now(),
              amount: appliedAmount,
              method: 'deposit_apply',
              reference: deposit.ref,
              recordedBy: store.currentUser()?.name || 'Finance',
            }
            store.setInvoices(prev => prev.map(i => {
              if (i.id !== linkedInv.id) return i
              return {
                ...i,
                amountPaid: i.amountPaid + payment.amount,
                payments: [...(i.payments || []), payment],
                notes: `${i.notes || ''}\nApplied deposit ${deposit.ref} (${store.fmtKes(payment.amount)})`.trim(),
              }
            }))
          }
        }
        store.setDeposits(prev => prev.map(d =>
          d.id === depositId ? { ...d, status: 'completed' as DepositStatus, completedAt: now() } : d
        ))
        store.syncOrWarn(`/api/deposits/${depositId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: appliedInvoiceId,
            ...(appliedAmount > 0 ? { amount: appliedAmount } : {}),
          }),
        }, message => store.showToast(message, 'error'), 'Deposit could not be applied to its invoice — please retry')
        store.showToast('Deposit applied to its invoice — liability cleared', 'success')
      },

    cancelDeposit: (depositId, reason) => {
        // The refund journal is posted by /api/deposits/[id]/cancel as
        // JRN/DEP/REFUND/<ref>/<paymentId>. The local copy used
        // JRN/REFUND/<ref> — a different ref, so the mirror added a second
        // reversal and the deposit liability was cleared twice.
        store.setDeposits(prev => prev.map(d =>
          d.id === depositId ? { ...d, status: 'cancelled' as DepositStatus, cancelledAt: now(), cancelReason: reason } : d
        ))
        store.syncOrWarn(`/api/deposits/${depositId}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        }, message => store.showToast(message, 'error'), 'Deposit cancellation could not be recorded — please retry')
        store.showToast('Deposit cancelled', 'info')
      },

    createCompanyAsset: (input) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return null }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can record company property', 'error')
          return null
        }
        const error = validateCompanyAssetInput(input, store.companyAssets)
        if (error) { store.showToast(error, 'error'); return null }
        const serialId = input.serialId?.trim() || undefined
        if (serialId) {
          const serial = store.serialRef.current.find(s => s.id === serialId)
          if (!serial || serial.status !== 'available') {
            store.showToast('Trading serial must be available in stock', 'error')
            return null
          }
        }
        const at = new Date().toISOString()
        const status = input.status && ['draft', 'in_use', 'in_storage'].includes(input.status) ? input.status : 'draft'
        const books = withBookDefaults({
          category: input.category,
          costKes: Number(input.costKes) || 0,
          usefulLifeMonths: input.usefulLifeMonths,
          residualKes: input.residualKes,
          depreciationMethod: input.depreciationMethod,
          accumDeprKes: input.accumDeprKes,
        })
        const serial = serialId ? store.serialRef.current.find(s => s.id === serialId) : undefined
        let record: CompanyAsset = {
          id: uid(),
          ref: nextCompanyAssetRef(store.companyAssets.map(a => a.ref)),
          name: input.name.trim(),
          description: input.description?.trim() || undefined,
          category: input.category,
          assetClass: input.assetClass,
          ppeAccountCode: resolvedPpeAccountCode(input),
          qty: Number(input.qty),
          unit: (input.unit || 'each').trim() || 'each',
          assetTag: input.assetTag?.trim() || undefined,
          serialNumber: input.serialNumber?.trim() || serial?.serial || undefined,
          serialId,
          locationName: input.locationName.trim(),
          custodianEmployeeId: input.custodianEmployeeId?.trim() || undefined,
          custodianName: input.custodianName?.trim() || undefined,
          status,
          condition: input.condition,
          acquiredDate: input.acquiredDate,
          acquiredVia: input.acquiredVia,
          supplierName: input.supplierName?.trim() || undefined,
          purchaseOrderRef: input.purchaseOrderRef?.trim() || undefined,
          billRef: input.billRef?.trim() || undefined,
          expenseRef: input.expenseRef?.trim() || undefined,
          costKes: books.costKes,
          usefulLifeMonths: books.usefulLifeMonths,
          residualKes: books.residualKes,
          depreciationMethod: books.depreciationMethod,
          accumDeprKes: books.accumDeprKes,
          taxWdvKes: initialTaxWdv(books.costKes),
          notes: input.notes?.trim() || undefined,
          history: [
            historyEntry({
              at,
              action: 'create',
              toStatus: status,
              toLocation: input.locationName.trim(),
              userId: user.id,
              userName: user.name,
              note: input.acquiredVia === 'opening' ? 'Opening register — no journal posted' : undefined,
            }),
          ],
          createdByUserId: user.id,
          createdByName: user.name,
          createdAt: at,
          updatedAt: at,
        }
        if (serialId) store.setSerialCapitalised(serialId)
        record = store.capitaliseCompanyAsset(record)
        store.setCompanyAssets(prev => [record, ...prev])
        store.addAuditLog('create_company_asset', record.ref, `${record.name} (${record.qty} ${record.unit}) at ${record.locationName}`)
        store.showToast(record.capitaliseJournalRef ? `${record.ref} recorded and capitalised` : `${record.ref} recorded`, 'success')
        return record
      },

    updateCompanyAsset: (id, input) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can edit company property', 'error')
          return
        }
        const existing = store.companyAssets.find(a => a.id === id)
        if (!existing) { store.showToast('Asset item not found', 'error'); return }
        const error = validateCompanyAssetInput(input, store.companyAssets, id)
        if (error) { store.showToast(error, 'error'); return }
        const at = new Date().toISOString()
        const nextStatus = existing.status === 'draft' && input.status && ['draft', 'in_use', 'in_storage'].includes(input.status)
          ? input.status
          : existing.status
        const books = withBookDefaults({
          category: input.category,
          costKes: Number(input.costKes) || 0,
          usefulLifeMonths: input.usefulLifeMonths ?? existing.usefulLifeMonths,
          residualKes: input.residualKes ?? existing.residualKes,
          depreciationMethod: input.depreciationMethod ?? existing.depreciationMethod,
          accumDeprKes: existing.accumDeprKes,
        })
        let next: CompanyAsset = {
          ...existing,
          name: input.name.trim(),
          description: input.description?.trim() || undefined,
          category: input.category,
          assetClass: input.assetClass,
          ppeAccountCode: resolvedPpeAccountCode(input),
          qty: Number(input.qty),
          unit: (input.unit || existing.unit || 'each').trim() || 'each',
          assetTag: input.assetTag?.trim() || undefined,
          serialNumber: input.serialNumber?.trim() || existing.serialNumber,
          locationName: input.locationName.trim(),
          custodianEmployeeId: input.custodianEmployeeId?.trim() || undefined,
          custodianName: input.custodianName?.trim() || undefined,
          status: nextStatus,
          condition: input.condition,
          acquiredDate: input.acquiredDate,
          acquiredVia: input.acquiredVia,
          supplierName: input.supplierName?.trim() || undefined,
          purchaseOrderRef: input.purchaseOrderRef?.trim() || undefined,
          billRef: input.billRef?.trim() || undefined,
          expenseRef: input.expenseRef?.trim() || undefined,
          costKes: books.costKes,
          usefulLifeMonths: books.usefulLifeMonths,
          residualKes: books.residualKes,
          depreciationMethod: books.depreciationMethod,
          notes: input.notes?.trim() || undefined,
          updatedAt: at,
          history: nextStatus !== existing.status
            ? [...existing.history, historyEntry({
                at,
                action: 'status',
                fromStatus: existing.status,
                toStatus: nextStatus,
                userId: user.id,
                userName: user.name,
              })]
            : existing.history,
        }
        if (!existing.taxWdvKes) next.taxWdvKes = initialTaxWdv(books.costKes)
        next = store.capitaliseCompanyAsset(next)
        store.setCompanyAssets(prev => prev.map(a => a.id === id ? next : a))
        store.showToast('Asset item updated', 'success')
      },

    deleteCompanyAsset: (id) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can delete company property', 'error')
          return
        }
        const existing = store.companyAssets.find(a => a.id === id)
        if (!existing) return
        if (!canDeleteCompanyAsset(existing.status)) {
          store.showToast('Only draft items can be deleted. Dispose or write off live records.', 'error')
          return
        }
        if (existing.serialId) {
          const serial = store.serialRef.current.find(s => s.id === existing.serialId)
          if (serial?.status === 'capitalised') store.setSerialCapitalised(existing.serialId, true)
        }
        store.setCompanyAssets(prev => prev.filter(a => a.id !== id))
        store.addAuditLog('delete_company_asset', existing.ref, `Deleted draft ${existing.name}`)
        store.showToast(`${existing.ref} deleted`, 'info')
      },

    moveCompanyAsset: (id, locationName, note) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can move company property', 'error')
          return
        }
        const existing = store.companyAssets.find(a => a.id === id)
        if (!existing) return
        const result = applyMove(existing, locationName, { userId: user.id, userName: user.name, at: new Date().toISOString() }, note)
        if (!result.ok) { store.showToast(result.error, 'error'); return }
        store.setCompanyAssets(prev => prev.map(a => a.id === id ? result.asset : a))
        store.addAuditLog('move_company_asset', existing.ref, `${existing.locationName} → ${result.asset.locationName}`)
        store.showToast(`${existing.ref} moved to ${result.asset.locationName}`, 'success')
      },

    setCompanyAssetCustodian: (id, custodian, note) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can change custodians', 'error')
          return
        }
        const existing = store.companyAssets.find(a => a.id === id)
        if (!existing) return
        const result = applyCustodian(existing, custodian, { userId: user.id, userName: user.name, at: new Date().toISOString() }, note)
        if (!result.ok) { store.showToast(result.error, 'error'); return }
        store.setCompanyAssets(prev => prev.map(a => a.id === id ? result.asset : a))
        store.showToast(result.asset.custodianName ? `Custodian set to ${result.asset.custodianName}` : 'Custodian cleared', 'success')
      },

    setCompanyAssetStatus: async (id, status, note, opts) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can change property status', 'error')
          return
        }
        const existing = store.companyAssets.find(a => a.id === id)
        if (!existing) return
        const at = new Date().toISOString()
        const result = applyStatusChange(existing, status, { userId: user.id, userName: user.name, at }, note)
        if (!result.ok) { store.showToast(result.error, 'error'); return }
        let next = store.capitaliseCompanyAsset(result.asset)
        if (status === 'under_repair' && opts?.createRepair && !existing.repairId) {
          const companyName = String(store.companySettings.name || '').trim()
          const self = store.contacts.find(c => {
            const n = String(c.name || '').trim().toLowerCase()
            const t = String(c.tradingName || '').trim().toLowerCase()
            const target = companyName.toLowerCase()
            return c.isCustomer && target && (n === target || t === target)
          })
          if (!self) {
            store.showToast('Add a customer contact named like the company to open a repair job', 'error')
          } else {
            const repair = await store.storeCtxRef.current?.createRepair(
              self.id,
              self.name,
              existing.name,
              existing.serialNumber || existing.assetTag || existing.ref,
              note || `Company property ${existing.ref} under repair`,
            )
            if (repair) {
              next = {
                ...next,
                repairId: repair.id,
                repairRef: repair.ref,
                history: [
                  ...next.history,
                  historyEntry({
                    at,
                    action: 'repair_job',
                    userId: user.id,
                    userName: user.name,
                    note: repair.ref,
                  }),
                ],
              }
            }
          }
        }
        store.setCompanyAssets(prev => prev.map(a => a.id === id ? next : a))
        store.addAuditLog('update_company_asset', existing.ref, `${existing.status} → ${status}`)
        store.showToast(`${existing.ref} marked ${status.replace(/_/g, ' ')}`, 'success')
      },

    disposeCompanyAsset: (id, qty, opts) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can dispose company property', 'error')
          return
        }
        const existing = store.companyAssets.find(a => a.id === id)
        if (!existing) return
        const at = new Date().toISOString()
        const proceeds = Number(opts?.proceedsKes) || 0
        const suffix = qty < existing.qty ? `P${(existing.disposedQty ?? 0) + qty}` : undefined
        const draft = existing.assetClass === 'capital'
          ? buildDisposalJournal(existing, qty, proceeds, at.slice(0, 10), '2211 - Petty Cash', suffix)
          : null
        const journalRef = store.pushPpeJournal(draft)
        const result = applyDispose(existing, qty, { userId: user.id, userName: user.name, at }, opts)
        if (!result.ok) { store.showToast(result.error, 'error'); return }
        const next = {
          ...result.asset,
          disposalJournalRef: result.asset.status === 'disposed' ? (journalRef || result.asset.disposalJournalRef) : result.asset.disposalJournalRef,
        }
        if (next.status === 'disposed' && existing.serialId) {
          const serial = store.serialRef.current.find(s => s.id === existing.serialId)
          if (serial?.status === 'capitalised') {
            store.setSerials(prev => prev.map(s => s.id === existing.serialId ? { ...s, status: 'written_off' } : s))
          }
        }
        store.setCompanyAssets(prev => prev.map(a => a.id === id ? next : a))
        store.addAuditLog('dispose_company_asset', existing.ref, next.status === 'disposed' ? 'Disposed' : `Disposed ${qty} of ${existing.qty}`)
        store.showToast(next.status === 'disposed' ? `${existing.ref} disposed` : `${existing.ref} quantity reduced`, 'success')
      },

    writeOffCompanyAsset: (id, reason) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can write off company property', 'error')
          return
        }
        const existing = store.companyAssets.find(a => a.id === id)
        if (!existing) return
        const at = new Date().toISOString()
        const draft = existing.assetClass === 'capital'
          ? buildDisposalJournal(existing, existing.qty, 0, at.slice(0, 10))
          : null
        const journalRef = store.pushPpeJournal(draft)
        const result = applyWriteOff(existing, { userId: user.id, userName: user.name, at }, reason)
        if (!result.ok) { store.showToast(result.error, 'error'); return }
        const next = { ...result.asset, disposalJournalRef: journalRef || result.asset.disposalJournalRef }
        if (existing.serialId) {
          const serial = store.serialRef.current.find(s => s.id === existing.serialId)
          if (serial?.status === 'capitalised') {
            store.setSerials(prev => prev.map(s => s.id === existing.serialId ? { ...s, status: 'written_off' } : s))
          }
        }
        store.setCompanyAssets(prev => prev.map(a => a.id === id ? next : a))
        store.addAuditLog('write_off_company_asset', existing.ref, reason || 'Written off')
        store.showToast(`${existing.ref} written off`, 'info')
      },

    runCompanyAssetDepreciation: (period) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'viewCompanyProperty')) {
          store.showToast('Only Finance, Admin, or a Director can run depreciation', 'error')
          return
        }
        const key = period && /^\d{4}-\d{2}$/.test(period) ? period : periodKey()
        const already = store.journalEntries.some(j => j.ref === depreciationJournalRef(key))
        if (already) {
          store.showToast(`Depreciation ${key} is already posted`, 'info')
          return
        }
        const [yearStr, monthStr] = key.split('-')
        const year = Number(yearStr)
        const month = Number(monthStr)
        const date = new Date(year, month, 0).toISOString().slice(0, 10)
        const charges: Array<{ asset: CompanyAsset; amount: number }> = []
        const nextAssets = store.companyAssets.map(asset => {
          if (!canDepreciateAsset(asset)) return asset
          if (periodAlreadyRun(asset.lastDepreciatedPeriod, key)) return asset
          const amount = monthlyBookDepreciation(asset)
          let next = applyBookDepreciationCharge(asset, amount, key)
          const kra = applyKraAnnualAllowance(next, year)
          next = kra.asset
          if (amount > 0) charges.push({ asset, amount })
          return next
        })
        const draft = buildDepreciationJournal(key, charges, date)
        const ref = store.pushPpeJournal(draft)
        store.setCompanyAssets(nextAssets)
        store.addAuditLog('depreciate_company_assets', key, ref ? `${charges.length} assets · ${ref}` : 'No book charge this period')
        store.showToast(ref ? `Posted depreciation ${key}` : `No depreciation to post for ${key}`, ref ? 'success' : 'info')
      },

    linkSerialToCompanyAsset: (assetId, serialId) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return }
        if (!userCan(user, 'manageCompanyProperty')) {
          store.showToast('Only a Director or Admin Officer can link a trading serial', 'error')
          return
        }
        const existing = store.companyAssets.find(a => a.id === assetId)
        if (!existing) { store.showToast('Asset item not found', 'error'); return }
        if (existing.serialId) { store.showToast('This item already has a trading serial', 'error'); return }
        const serial = store.serialRef.current.find(s => s.id === serialId)
        if (!serial || serial.status !== 'available') {
          store.showToast('Trading serial must be available in stock', 'error')
          return
        }
        const at = new Date().toISOString()
        let next: CompanyAsset = {
          ...existing,
          serialId: serial.id,
          serialNumber: existing.serialNumber || serial.serial,
          updatedAt: at,
          history: [
            ...existing.history,
            historyEntry({
              at,
              action: 'link_serial',
              userId: user.id,
              userName: user.name,
              note: serial.serial,
            }),
          ],
        }
        store.setSerialCapitalised(serial.id)
        next = store.capitaliseCompanyAsset(next)
        store.setCompanyAssets(prev => prev.map(a => a.id === assetId ? next : a))
        store.showToast(`${existing.ref} linked to serial ${serial.serial}`, 'success')
      },

    // ── Chart of Accounts ──────────────────────────────────────────────────────
    // The chart of accounts is saved to account_codes; the deed_accounts screen copy is frozen.
    addAccount: (a) => {
        const account = { ...a, id: uid() }
        store.setAccounts(p => [...p, account])
        void store.saveAccountToServer('POST', '/api/accounting/accounts', account).then(error => {
          if (!error) return
          store.setAccounts(p => p.filter(x => x.id !== account.id))
          store.showToast(`Account ${a.code} not saved: ${error}`, 'error')
        })
        store.showToast(`Account ${a.code} added`)
        return account
      },

    updateAccount: (id, p) => {
        const before = store.accountRef.current.find(a => a.id === id)
        if (!before) return
        const next = { ...before, ...p }
        store.setAccounts(prev => prev.map(a => a.id === id ? next : a))
        void store.saveAccountToServer('PUT', `/api/accounting/accounts/${encodeURIComponent(id)}`, next).then(error => {
          if (!error) return
          store.setAccounts(prev => prev.map(a => a.id === id ? before : a))
          store.showToast(`Account ${before.code} not saved: ${error}`, 'error')
        })
        store.showToast('Account updated')
      },

    // ── Invoices ──────────────────────────────────────────────────────────────
    createManualInvoice: (type, partnerId, partnerName, dueDate, lines, vatRate, notes = '', documentDate, customerPoNumber) => {
        if (type === 'customer_invoice') {
          // Laptops and other serial-tracked machines leave stock only through a
          // validated delivery or the POS till (lib/sales/serial-invoice-gate.ts).
          const typed = new Set(lines
            .filter(l => (l.type ?? 'item') !== 'section')
            .map(l => String(l.desc ?? '').trim().replace(/\s+/g, ' ').toLowerCase())
            .filter(Boolean))
          const machine = store.prodRef.current.find(p =>
            (p.requiresSerial || String(p.trackingMethod ?? '').toUpperCase() === 'SERIAL')
            && typed.has(String(p.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()))
          if (machine) {
            store.showToast(`${machine.name} is serial-tracked: sell it through a sale order and validate the delivery (or at the POS till), so the machine leaves stock with its serial number.`, 'error')
            return null
          }
        }
        const builtLines: InvoiceLine[] = lines
          .filter(l => {
            if ((l.type ?? 'item') === 'section') return !!String(l.desc || '').trim()
            return true
          })
          .map(l => {
            if ((l.type ?? 'item') === 'section') {
              return {
                id: uid(),
                lineType: 'section' as const,
                description: String(l.desc).trim(),
                qty: 0,
                unitPrice: 0,
                taxRate: 0,
                subtotal: 0,
              }
            }
            const qty = Number(l.qty) || 1
            const unitPrice = Number(l.price) || 0
            const taxRate = vatRate > 0 ? vatRate : Number(l.tax) || 0
            const discountPct = Math.min(100, Math.max(0, Number(l.discount) || 0))
            const gross = qty * unitPrice
            const discountAmount = Math.round(gross * discountPct) / 100
            const subtotal = Math.max(0, gross - discountAmount)
            return {
              id: uid(),
              lineType: 'item' as const,
              description: l.desc,
              qty,
              unitPrice,
              taxRate,
              ...(discountPct > 0 ? { discountPct } : {}),
              ...(String(l.account ?? '').trim() ? { accountCode: String(l.account).trim() } : {}),
              subtotal,
            }
          })
        const itemLines = builtLines.filter(l => l.lineType !== 'section')
        const subtotal = itemLines.reduce((s, l) => s + l.subtotal, 0)
        const taxTotal = itemLines.reduce((s, l) => s + Math.round(l.subtotal * l.taxRate / 100), 0)
        const invoice: Invoice = {
          id: uid(),
          // Placeholder ref — the official number is assigned when posted.
          ref: store.draftInvoiceRef(type),
          type,
          status: 'draft',
          partnerId,
          partnerName,
          date: documentDate || now(),
          dueDate: dueDate || store.addDays(now(), 0),
          lines: builtLines,
          subtotal,
          taxTotal,
          total: subtotal + taxTotal,
          amountPaid: 0,
          notes,
          ...(customerPoNumber?.trim() ? { customerPoNumber: customerPoNumber.trim() } : {}),
        }
        store.setInvoices(prev => [invoice, ...prev])
        void store.saveInvoiceToServer(invoice, msg => store.showToast(msg, 'error'))
        store.showToast(`${type === 'vendor_bill' ? 'Bill' : 'Invoice'} ${invoice.ref} created`, 'success')
        return invoice
      },

    importOpeningBalances: async (invoices) => {
        // Server first: the posted-at-create path validates dates and the
        // fiscal lock and posts the journal exactly once. Only documents the
        // server accepted are added here, so a refused row leaves nothing behind.
        const saved: Invoice[] = []
        const failed: string[] = []
        for (const invoice of invoices) {
          let reason = ''
          const ok = await store.saveInvoiceToServer(invoice, msg => { reason = msg })
          if (ok) saved.push(invoice)
          else failed.push(`${invoice.ref} (${invoice.partnerName}): ${reason || 'not saved'}`)
        }
        if (saved.length) store.setInvoices(prev => [...saved.filter(inv => !prev.some(p => p.id === inv.id)), ...prev])
        return { saved, failed }
      },

    moveInvoiceLine: (invoiceId, lineId, direction) => {
        const inv = store.invRef.current.find(i => i.id === invoiceId)
        if (!inv) return
        if (inv.status !== 'draft') {
          store.showToast('Only draft invoices can reorder lines', 'error')
          return
        }
        const index = (inv.lines || []).findIndex(l => l.id === lineId)
        const target = index + direction
        if (index < 0 || target < 0 || target >= (inv.lines || []).length) return
        const lines = [...(inv.lines || [])]
        ;[lines[index], lines[target]] = [lines[target], lines[index]]
        store.storeCtxRef.current!.updateInvoice(invoiceId, { lines })
      },

    addInvoiceSection: (invoiceId, title) => {
        const inv = store.invRef.current.find(i => i.id === invoiceId)
        if (!inv) return
        if (inv.status !== 'draft') {
          store.showToast('Only draft invoices can add sections', 'error')
          return
        }
        const sectionTitle = String(title ?? '').trim() || 'Section'
        const lines = [...(inv.lines || []), {
          id: uid(),
          lineType: 'section' as const,
          description: sectionTitle,
          qty: 0,
          unitPrice: 0,
          taxRate: 0,
          subtotal: 0,
        }]
        store.storeCtxRef.current!.updateInvoice(invoiceId, { lines })
      },

    updateInvoice: (id, p) => {
        const existing = store.invRef.current.find(i => i.id === id)
        if (!existing) return
        const protectedStatus = existing.status !== 'draft' && existing.status !== 'cancelled'
        const cancelling = p.status === 'cancelled'
        // Allow linking a rider delivery job / address on posted invoices without unlocking lines.
        const keys = Object.keys(p)
        const deliveryLinkOnly = keys.length > 0 && keys.every(k => k === 'deliveryJobId' || k === 'deliveryAddress')
        if (protectedStatus && !cancelling && !deliveryLinkOnly && store.systemSettings.secDisableInvoiceEditAfterValidation) {
          store.showToast('Posted documents are locked. Reset to draft first, then edit and save.', 'error')
          return
        }
        if (cancelling && existing.status !== 'cancelled') {
          const related = store.journalEntries.filter(j => j.invoiceId === id && !j.ref.startsWith('REV/'))
          const reversals = related
            .filter(j => !store.journalEntries.some(existingJournal => existingJournal.ref === `REV/${j.ref}`))
            .map(j => buildReversalJournal(j, existing.ref, `${existing.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`))
          if (reversals.length > 0) {
            store.setJournalEntries(prev => [...reversals, ...prev])
            store.addAuditLog('reverse_invoice', existing.ref, `${existing.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled with ${reversals.length} reversal journal${reversals.length === 1 ? '' : 's'}`)
          } else {
            store.addAuditLog('cancel_invoice', existing.ref, `${existing.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`)
          }
        }
        store.setInvoices(prev => {
          const next = prev.map(i => i.id === id ? { ...i, ...p } : i)
          const updated = next.find(i => i.id === id)
          if (updated) {
            store.invRef.current = next
            sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoicePersistBody(updated as unknown as Record<string, unknown>)) })
          }
          return next
        })
        if (
          existing.type !== 'vendor_bill'
          && ('partnerId' in p || 'partnerName' in p || 'invoiceAddress' in p)
        ) {
          const contact = store.contacts.find(c => c.id === (p.partnerId ?? existing.partnerId))
          const name = String(p.partnerName ?? existing.partnerName ?? contact?.name ?? '').trim()
          store.syncCustomerIdentityToDocuments({
            contactId: p.partnerId ?? existing.partnerId,
            saleOrderId: existing.saleOrderId,
            invoiceId: id,
            identity: {
              name,
              email: contact?.email || undefined,
              phone: contact?.phone || contact?.mobile || undefined,
              address: 'invoiceAddress' in p
                ? (p.invoiceAddress || undefined)
                : (existing.invoiceAddress || (contact ? formatCustomerAddress(contact) : undefined)),
              customerId: p.partnerId ?? existing.partnerId,
            },
          })
        }
      },

    postInvoice: async (id, forcedRef) => {
        const actor = store.currentUser()
        if (!canManageFinance(actor)) {
          store.showToast('Only Finance or Admin Officer can post invoices', 'error'); return
        }
        const inv = store.invRef.current.find(i => i.id === id)
        if (!inv) return
        if (inv.status === 'posted') {
          store.showToast(`${inv.ref} is already posted`, 'info'); return
        }
        const gate = canPostOrPayCustomerInvoice({
          role: actor?.role,
          invoiceType: inv.type,
          action: 'post',
        })
        if (!gate.ok) { store.showToast(gate.reason || 'Cannot post invoice', 'error'); return }
        if (!inv.lines || inv.lines.length === 0) {
          store.showToast('Cannot post an invoice with no line items', 'error'); return
        }
        // Vendor bill 3-way match: billed qty must still fit received − previously billed.
        if (inv.type === 'vendor_bill' && inv.purchaseOrderId) {
          const po = store.poRef.current.find(p => p.id === inv.purchaseOrderId)
          if (!po) { store.showToast('Linked purchase order not found', 'error'); return }
          try {
            for (const line of inv.lines) {
              const poLine = po.lines.find(l =>
                l.productId && line.productId && l.productId === line.productId
              ) || po.lines.find(l => line.description?.includes(l.productName))
              if (!poLine) continue
              // qtyBilled already includes this draft bill's qty from createBillFromPO —
              // assert using received vs (billed − this line) + this line ≡ received ≥ billed.
              const alreadyBilledExcludingThis = Math.max(0, (poLine.qtyBilled ?? 0) - Math.floor(Number(line.qty) || 0))
              assertBillableQty(
                { qty: poLine.qty, qtyReceived: poLine.qtyReceived, qtyBilled: alreadyBilledExcludingThis },
                Number(line.qty) || 0,
              )
            }
          } catch (err) {
            store.showToast(err instanceof Error ? err.message : 'Three-way match failed', 'error')
            return
          }
        }
        // Posting assigns the official number: drafts carry a placeholder ref
        // until Finance confirms them (Odoo behaviour).
        const finalRef = store.isDraftInvoiceRef(inv.ref)
          ? (forcedRef ?? await store.storeCtxRef.current!.allocateDocRef(inv.type === 'vendor_bill' ? 'BILL' : 'INV'))
          : inv.ref
        const postedMeta = {
          ref: finalRef,
          status: 'posted' as const,
          postedByUserId: actor?.id,
          postedByName: actor?.name,
          postedAt: now(),
        }
        const linesWithTax = (inv.lines || []).map(l => ({
          ...l,
          taxCategory: l.taxCategory || (Number(l.taxRate) > 0 ? 'standard_16' : 'out_of_scope'),
        }))
        const postedInvoice = { ...inv, ...postedMeta, lines: linesWithTax }
        store.setInvoices(p => p.map(i => i.id === id ? postedInvoice : i))
        let ledgerWarning: string | null = null
        try {
          // Edit PUT already incremented Prisma lockVersion; the local row still
          // holds the pre-edit value. Omit + one retry, same as sale-order Confirm.
          // A 404 means Create Bill never reached Prisma — create as draft, then
          // post using the server id so a new UUID cannot 404 again.
          const { res, data, id: postedId } = await putInvoiceOrCreateThenPost(
            id,
            postedInvoice as unknown as Record<string, unknown>,
          )
          if (!res.ok) {
            const err = invoiceErrorMessage(data, 'Could not post invoice to accounting')
            store.setInvoices(p => p.map(i => i.id === id ? inv : i))
            store.showToast(err, 'error')
            return
          }
          if (postedId !== id) {
            const remapped = { ...postedInvoice, id: postedId }
            store.invRef.current = store.invRef.current.map(i => i.id === id ? remapped : i)
            store.setInvoices(p => p.map(i => i.id === id ? remapped : i))
            store.setPurchaseOrders(p => p.map(po => po.billId === id ? { ...po, billId: postedId } : po))
          }
          ledgerWarning = typeof (data as { ledgerWarning?: unknown } | null)?.ledgerWarning === 'string'
            ? String((data as { ledgerWarning: string }).ledgerWarning)
            : null
          const postedLock = readLockVersionFromResponse(data)
          if (postedLock !== undefined) {
            const withLock = { ...(postedId !== id ? { ...postedInvoice, id: postedId } : postedInvoice), lockVersion: postedLock }
            store.invRef.current = store.invRef.current.map(i => i.id === postedId || i.id === id ? withLock : i)
            store.setInvoices(p => p.map(i => i.id === postedId || i.id === id ? withLock : i))
          }
        } catch {
          store.setInvoices(p => p.map(i => i.id === id ? inv : i))
          store.showToast('Could not post invoice to accounting', 'error')
          return
        }
        // Auto-post GL journal using the shared posting engine.
        store.postInvoiceJournalOnce({ ...inv, ref: finalRef })
        store.addAuditLog('post_invoice', finalRef, `Posted by ${actor?.name || 'Finance'}`)
        if (ledgerWarning) {
          store.showToast(`${finalRef} is confirmed but NOT booked in the ledger: ${ledgerWarning}. Tell Finance — it shows in the health check.`, 'error')
        } else {
          store.showToast(`${finalRef} posted to accounting`)
        }
      },

    setInvoicePaymentBlocked: (id, blocked) => {
        const actor = store.currentUser()
        if (!canManageFullFinanceAction(actor)) {
          store.showToast('Only Finance or Director can block or release invoice payments', 'error'); return
        }
        const inv = store.invRef.current.find(i => i.id === id)
        if (!inv || invoiceDocState(inv.status) !== 'posted') {
          store.showToast('Only posted invoices can be blocked', 'error'); return
        }
        store.setInvoices(p => {
          const next = p.map(i => i.id === id ? { ...i, paymentBlocked: blocked } : i)
          const updated = next.find(i => i.id === id)
          if (updated) sync(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoicePersistBody(updated as unknown as Record<string, unknown>)) })
          return next
        })
        store.addAuditLog(blocked ? 'block_invoice_payment' : 'release_invoice_payment', inv.ref, `${blocked ? 'Payment blocked' : 'Payment released'} by ${actor?.name ?? 'Finance'}`)
        store.showToast(blocked ? `${inv.ref} payment blocked` : `${inv.ref} payment released`)
      },

    registerPayment: async (invoiceId, amount, method, bankAccountId, reference, paymentDate) => {
        const actor = store.currentUser()
        if (!canManageFinance(actor)) {
          store.showToast('Only Finance or Admin Officer can register payments', 'error'); return false
        }
        const inv = store.invRef.current.find(i => i.id === invoiceId)
        if (!inv) return false
        // Use the shared document-state projection (not a raw === 'posted' check):
        // a posted invoice hydrated from Prisma carries status 'approved'/'invoiced',
        // which the header badge and "Register payment" button already treat as
        // Posted. A raw equality here rejected those, so the button appeared but the
        // payment failed with "Only posted invoices can receive payments".
        if (invoiceDocState(inv.status) !== 'posted') {
          store.showToast('Only posted invoices can receive payments', 'error'); return false
        }
        if (inv.paymentBlocked) { store.showToast('Payments are blocked on this invoice — release the block first', 'error'); return false }
        const sodThreshold = store.systemSettings.accAdminOfficerInvoiceLimitKes ?? DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES
        const gate = canPostOrPayCustomerInvoice({
          role: actor?.role,
          invoiceType: inv.type,
          action: 'pay',
        })
        if (!gate.ok) { store.showToast(gate.reason || 'Cannot register payment', 'error'); return false }
        const sod = canPayOwnPostedInvoice({
          role: actor?.role,
          actorUserId: actor?.id,
          postedByUserId: inv.postedByUserId,
          invoiceTotal: inv.total,
          sodThresholdKes: sodThreshold,
        })
        if (!sod.ok) { store.showToast(sod.reason || 'Segregation of duties blocked this payment', 'error'); return false }
        const balance = inv.total - inv.amountPaid
        if (balance <= 0) { store.showToast('Invoice is already fully paid', 'info'); return false }
        const capped = Math.min(amount, balance)
        const paymentId = crypto.randomUUID()
        const paidToRider = method === PAID_TO_RIDER && inv.type !== 'vendor_bill'
        const withheld = isWithholdingMethod(method) && inv.type !== 'vendor_bill' ? WITHHOLDING_KINDS[method] : null
        if (isWithholdingMethod(method) && !withheld) { store.showToast('Withholding is recorded on customer invoices only', 'error'); return false }
        if (withheld && !reference?.trim()) { store.showToast('Enter the withholding certificate number', 'error'); return false }
        const journal = buildInvoicePaymentJournal(inv, capped, method, bankAccountId, paymentDate, paymentId,
          withheld ? withheld.accountLabel : paidToRider ? riderFeeAccount(store.accounts.map(a => a.code)).label : undefined)
        if (store.journalEntries.some(j => j.ref === journal.ref)) {
          store.showToast('This payment journal was already posted', 'info'); return false
        }
        const prevInvoice = inv
        const newPayment: InvoicePayment = {
          id: paymentId,
          date: paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString(),
          amount: capped,
          method: method || 'cash',
          reference: reference || undefined,
          bankAccountId: paidToRider || withheld ? undefined : bankAccountIdForMethod(method, bankAccountId),
          recordedBy: actor?.name || 'Finance',
        }
        const append = `\nPaid ${store.fmtKes(capped)} via ${method || 'cash'}${bankAccountId ? ` (Bank: ${bankAccountId})` : ''}${reference ? ` Ref: ${reference}` : ''}`
        store.setInvoices(p => p.map(i => {
          if (i.id !== invoiceId) return i
          return {
            ...i,
            amountPaid: i.amountPaid + capped,
            notes: (i.notes || '') + append,
            payments: [...(i.payments || []), newPayment],
          }
        }))
        store.setJournalEntries(p => [journal, ...p])
        try {
          const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: capped,
              paymentMethod: method || 'cash',
              reference: reference || undefined,
              paidAt: paymentDate,
              bankAccountId: withheld ? undefined : bankAccountId,
              idempotencyKey: paymentId,
            }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || `Payment failed (${res.status})`)
          }
        } catch (err: any) {
          store.setInvoices(p => p.map(i => i.id === invoiceId ? prevInvoice : i))
          store.setJournalEntries(p => p.filter(j => j.ref !== journal.ref))
          store.showToast(err?.message || 'Payment could not be registered', 'error')
          return false
        }
        store.addAuditLog('register_payment', invoiceId, `Registered payment of KES ${capped} for ${inv.ref}${reference ? ` (Ref: ${reference})` : ''}`)
        store.showToast('Payment registered')
        return true
      },

    reverseInvoicePayment: async (invoiceId, paymentId, reason) => {
        const actor = store.currentUser()
        if (!userCan(actor, 'invoices.payments.reverse')) {
          store.showToast('Only Finance or a Director can reverse a payment', 'error'); return false
        }
        const inv = store.invRef.current.find(i => i.id === invoiceId)
        if (!inv) return false
        try {
          const res = await fetch(`/api/invoices/${invoiceId}/payments/${paymentId}/reverse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
          })
          const body = await res.json().catch(() => ({})) as { error?: string; reversal?: PaymentReversalInfo & { amountPaidByInvoice: Record<string, number>; reversalJournalRef: string | null } }
          if (!res.ok || !body.reversal) throw new Error(body.error || `Reversal failed (${res.status})`)
          const reversal = body.reversal
          store.setInvoices(prev => {
            const next = applyReversalToInvoices(prev as unknown as Array<Record<string, any>>, reversal, reversal.amountPaidByInvoice) as unknown as Invoice[]
            store.invRef.current = next
            return next
          })
          const originalRef = paymentJournalRef(inv.ref, paymentId)
          if (reversal.reversalJournalRef) {
            store.setJournalEntries(prev => {
              const rev = reversalJournalForStore(prev as unknown as Array<Record<string, any>>, originalRef, reversal.reversalJournalRef!, reason, reversal.reversedAt)
              return rev ? [rev as unknown as JournalEntry, ...prev] : prev
            })
          }
          store.addAuditLog('reverse_payment', invoiceId, `Reversed payment of ${store.fmtKes(reversal.amount)} on ${inv.ref}: ${reason}`)
          store.showToast(`Payment of ${store.fmtKes(reversal.amount)} reversed — ${inv.ref} owes it again`, 'success')
          return true
        } catch (err) {
          store.showToast(err instanceof Error ? err.message : 'Payment could not be reversed', 'error')
          return false
        }
      },

    resetInvoiceToDraft: (id) => {
        const actor = store.currentUser()
        if (!canCancelOrResetInvoice(actor?.role)) {
          store.showToast('Only Finance, Admin Officer, or Director can reset invoices to draft', 'error')
          return
        }
        const inv = store.invRef.current.find(i => i.id === id)
        if (!inv) return
        if (inv.status === 'cancelled') {
          store.showToast('Cancelled invoices cannot be reset to draft', 'error')
          return
        }
        if (inv.status === 'draft') {
          store.showToast('Document is already a draft', 'info')
          return
        }
        if (inv.amountPaid > 0) {
          store.showToast('Invoices with payments cannot be reset. Cancel to create credit instead.', 'error')
          return
        }
        const related = store.journalEntries.filter(j => j.invoiceId === id && !j.ref.startsWith('REV/'))
        const reversals = related
          .filter(j => !store.journalEntries.some(existingJournal => existingJournal.ref === `REV/${j.ref}`))
          .map(j => buildReversalJournal(j, inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} reset to draft`))
        // Keep reset audit off customer-facing invoice notes / PDFs — audit log only.
        const draft: Invoice = {
          ...inv,
          status: 'draft',
          amountPaid: 0,
          payments: [],
        }
        // Optimistic UI — Edit / Confirm appear immediately; revert if the API fails.
        if (reversals.length > 0) store.setJournalEntries(prev => [...reversals, ...prev])
        store.setInvoices(prev => {
          const next = prev.map(i => i.id === id ? draft : i)
          store.invRef.current = next
          return next
        })
        void (async () => {
          try {
            const res = await fetch(`/api/invoices/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              // Explicit intent. The server will not un-post an invoice on a
              // status of 'draft' alone, because that is what every stale tab
              // carries — an ordinary edit from one used to reverse the GL
              // journal without anybody asking.
              body: JSON.stringify({ ...draft, resetToDraft: true }),
            })
            if (!res.ok) {
              const data = await res.json().catch(() => null) as { error?: string } | null
              store.setInvoices(prev => {
                const next = prev.map(i => i.id === id ? inv : i)
                store.invRef.current = next
                return next
              })
              if (reversals.length > 0) {
                store.setJournalEntries(prev => prev.filter(j => !reversals.some(r => r.id === j.id)))
              }
              store.showToast(data?.error || `Could not reset ${inv.type === 'vendor_bill' ? 'bill' : 'invoice'} to draft`, 'error')
              return
            }
            store.addAuditLog('reset_invoice_draft', inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} reset to draft${reversals.length ? ` with ${reversals.length} reversal journal${reversals.length === 1 ? '' : 's'}` : ''}`)
            store.showToast(`${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} reset to draft — you can edit and confirm`)
          } catch {
            store.setInvoices(prev => {
              const next = prev.map(i => i.id === id ? inv : i)
              store.invRef.current = next
              return next
            })
            if (reversals.length > 0) {
              store.setJournalEntries(prev => prev.filter(j => !reversals.some(r => r.id === j.id)))
            }
            store.showToast(`Could not reset ${inv.type === 'vendor_bill' ? 'bill' : 'invoice'} to draft — check your connection`, 'error')
          }
        })()
      },

    restoreCancelledInvoice: (id) => {
        const actor = store.currentUser()
        const inv = store.invRef.current.find(i => i.id === id)
        if (!inv) return
        const decision = restoreCancelledInvoiceDecision({
          invoice: inv as never,
          credits: store.customerCredits as never,
          allowed: canCancelOrResetInvoice(actor?.role),
        })
        if (!decision.ok) { store.showToast(decision.error, 'error'); return }

        const noun = inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'
        const creditToVoid = decision.creditToVoid
        // Back as a draft: the cancellation's reversal stands, and confirming
        // it again posts a fresh journal. Payments cannot ride along — the
        // decision above refuses a paid document.
        const draft: Invoice = {
          ...inv,
          status: 'draft',
          amountPaid: 0,
          payments: [],
          notes: `${inv.notes || ''}\nRestored from cancelled by ${actor?.name ?? 'Finance'}${creditToVoid ? `; credit note ${creditToVoid.ref} voided.` : '.'}`.trim(),
        }
        const previousCredits = store.customerCredits
        const previousJournals = store.journalEntries

        // A credit raised by the cancellation is taken back with it, and its
        // journal reversed, or the customer would keep money for a document
        // that is live again.
        let creditReversal: JournalEntry | null = null
        if (creditToVoid) {
          const creditJournal = store.journalEntries.find(j => j.ref === `JRN/${creditToVoid.ref}` || j.ref.endsWith(creditToVoid.ref))
          if (creditJournal && !store.journalEntries.some(j => j.ref === `REV/${creditJournal.ref}`)) {
            creditReversal = buildReversalJournal(creditJournal, inv.ref, `${noun} restored from cancelled`)
            store.setJournalEntries(prev => [creditReversal!, ...prev])
          }
          store.setCustomerCredits(prev => prev.map(c => c.id === creditToVoid.id
            ? { ...c, status: 'void' as const, balance: 0, notes: `${c.notes || ''}\nVoided when ${inv.ref} was restored.`.trim() }
            : c))
        }
        store.setInvoices(prev => {
          const next = prev.map(i => i.id === id ? draft : i)
          store.invRef.current = next
          return next
        })

        void (async () => {
          const undo = () => {
            store.setInvoices(prev => {
              const next = prev.map(i => i.id === id ? inv : i)
              store.invRef.current = next
              return next
            })
            store.setCustomerCredits(previousCredits)
            store.setJournalEntries(previousJournals)
          }
          try {
            const res = await fetch(`/api/invoices/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...draft, restoreFromCancelled: true }),
            })
            if (!res.ok) {
              const data = await res.json().catch(() => null) as { error?: string } | null
              undo()
              store.showToast(data?.error || `Could not restore ${noun.toLowerCase()} ${inv.ref}`, 'error')
              return
            }
            store.addAuditLog(
              'restore_cancelled_invoice',
              inv.ref,
              `${noun} ${inv.ref} restored from cancelled to draft${creditToVoid ? ` — credit note ${creditToVoid.ref} voided` : ''}`,
            )
            store.showToast(restoreSummary(inv as never, creditToVoid))
          } catch {
            undo()
            store.showToast(`Could not restore ${noun.toLowerCase()} ${inv.ref} — check your connection`, 'error')
          }
        })()
      },

    cancelInvoice: async (id, forcedCreditRef) => {
        const actor = store.currentUser()
        if (!canCancelOrResetInvoice(actor?.role)) {
          store.showToast('Only Finance, Admin Officer, or Director can cancel invoices', 'error')
          return
        }
        const inv = store.invRef.current.find(i => i.id === id)
        if (!inv) return
        if (inv.status === 'draft') {
          store.showToast('Delete draft invoices instead of cancelling them', 'info')
          return
        }
        if (inv.status === 'cancelled') {
          store.showToast('Document is already cancelled', 'info')
          return
        }
  
        const isPaidCustomerInvoice = inv.type === 'customer_invoice' && inv.amountPaid > 0
        let credit: CustomerCredit | null = null
        if (isPaidCustomerInvoice) {
          const creditAmount = Math.min(inv.amountPaid, inv.total)
          credit = {
            id: uid(),
            ref: forcedCreditRef ?? await store.storeCtxRef.current!.allocateDocRef('CN'),
            customerId: inv.partnerId,
            customerName: inv.partnerName,
            sourceInvoiceId: inv.id,
            sourceInvoiceRef: inv.ref,
            amount: creditAmount,
            balance: creditAmount,
            status: 'available',
            createdAt: now(),
            createdBy: actor?.name ?? 'Finance',
            notes: `Credit note generated from cancelled paid invoice ${inv.ref}`,
            applications: [],
          }
          store.setCustomerCredits(prev => [credit!, ...prev])
          store.setJournalEntries(prev => [buildCustomerCreditJournal(inv, credit!.ref, creditAmount), ...prev])
        } else {
          const related = store.journalEntries.filter(j => j.invoiceId === id && !j.ref.startsWith('REV/'))
          const reversals = related
            .filter(j => !store.journalEntries.some(existingJournal => existingJournal.ref === `REV/${j.ref}`))
            .map(j => buildReversalJournal(j, inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`))
          if (reversals.length > 0) store.setJournalEntries(prev => [...reversals, ...prev])
        }
  
        const cancelled: Invoice = {
          ...inv,
          status: 'cancelled',
          notes: `${inv.notes || ''}\nCancelled by ${actor?.name ?? 'Finance'}${credit ? `; credit note ${credit.ref} created for ${store.fmtKes(credit.amount)}.` : '.'}`.trim(),
        }
        store.setInvoices(prev => prev.map(i => i.id === id ? cancelled : i))
        // Server reverses Prisma posting journal (unpaid) or posts 3102 credit journal (paid).
        sync(`/api/invoices/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...cancelled, creditRef: credit?.ref }),
        })
        store.addAuditLog('cancel_invoice', inv.ref, credit ? `Paid invoice cancelled; credit note ${credit.ref} created for ${store.fmtKes(credit.amount)}` : `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`)
        store.showToast(credit ? `Invoice cancelled — credit note ${credit.ref} created` : `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} cancelled`)
      },

    deleteInvoice: (id) => {
        const inv = store.invRef.current.find(i => i.id === id)
        if (!inv) return
        if (inv.status === 'draft') {
          store.setInvoices(p => p.filter(i => i.id !== id))
          sync(`/api/invoices/${id}`, { method: 'DELETE' })
          store.addAuditLog('delete_draft_invoice', inv.ref, `Draft ${inv.type === 'vendor_bill' ? 'bill' : 'invoice'} deleted`)
          store.showToast('Draft document deleted')
          return
        }
        if (inv.status === 'cancelled') { store.showToast('Document is already cancelled', 'info'); return }
        store.storeCtxRef.current.cancelInvoice(id)
      },

    addAuditLog: (action, documentRef, details) => { store.addAuditLog(action, documentRef, details) },

    allocateDocRef: async (prefix) => {
        const { prefixToKind, allocateDocNumber, allocateDocNumberSync } = await import('@/lib/doc-numbers')
        const kind = prefixToKind(prefix)
        if (kind === 'pos') {
          if (typeof window !== 'undefined') {
            try {
              return await allocateDocNumber(kind)
            } catch {
              /* fall through to local POS/NNNN high-water */
            }
          }
          return nextPosTicketRef(store.posOrders.map(o => o.ref))
        }
        if (typeof window !== 'undefined' && kind) {
          // Two more tries before the clash-free local number: a brief network
          // blip should still get the next number in the real sequence.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              return await allocateDocNumber(kind)
            } catch {
              if (attempt < 2) await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
            }
          }
          console.warn(`[doc-numbers] server did not issue a ${prefix} number; using a temporary one`)
        }
        return allocateDocNumberSync(prefix)
      },
  }
}
