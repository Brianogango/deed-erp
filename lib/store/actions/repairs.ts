import { type OutsourceVendor, type OutsourceJob, OUTSOURCE_SERVICE_TYPES, type OutsourcePayment, type OutsourceStatement, type RepairOrder } from '../repairs'
import { uid, now } from '../ids'
import type { Contact, Quote, SaleOrder } from '../sales'
import { repairOutsourceReadiness, repairHasLoggedDiagnosis } from '@/lib/repair-outsource'
import { defaultExpectedReturnDate, findStockSerialForOutsource, statusAfterUnfixedReturn, planWeeklyStatements, weekOf, OUTSOURCE_COST_ACCOUNT } from '@/lib/repair/outsource-jobs'
import { downloadedThisSession } from '@/lib/store-freshness'
import { contactPaymentTermsDays } from '@/lib/due-date'
import { isOutsourceOverdue, outsourceDaysLate } from '@/lib/repair/outsource-visibility'
import { userIdsWithRoles } from '@/lib/in-app-notifications'
import type { RepairStatus, RepairDiagnosis, RepairQuoteLine, RepairQuote, RepairQAItem } from '@/lib/repair-types'
import { prepareRepairQcItemsForRound, buildDefaultRepairQcItems, summarizeFailedQcItems } from '@/lib/repair-qc'
import { canManageFinance, canManageProcurement } from '../permissions'
import { invoiceDocState, canReverseConfirmedSale } from '@/lib/odoo-sales-flow'
import { ensureRepairIntakeTimestamp } from '@/lib/repair-datetime'
import { repairDatesWriteError } from '@/lib/data-validation'
import { shouldChargeDiagnosisFee, resolveDiagnosisFee, diagnosisFeeExitPatch, isDiagnosisFeeSettled, ensureDiagnosisFeeInQuoteLines, isDiagnosisFeeLine, taxableQuoteSubtotal } from '@/lib/diagnosis-fee'
import { formatCustomerAddress } from '@/lib/sync-customer-documents'
import { isDirector, canonicalRole } from '@/lib/auth/roles'
import { resolveRepairWarranty } from '@/lib/repair-warranty'
import { userCan } from '@/lib/auth/can'
import { isRepairAssignerRole, isAssignableTechnician, isRepairTechActor } from '@/lib/repair/assignable-technicians'
import { isDirectRepairPath, quotableStatusesForPath, isQuoteAwaitingApproval, isQuoteDeclinedReopenable, startableStatusesForPath, returnableStatusesForPath } from '@/lib/repair-path'
import { applyLoggedDiagnosis } from '@/lib/repair-diagnosis-log'
import { isRepairNoCharge, isRepairBillingExempt, normalizeBillingExemptReason, startableStatusesWhenBillingExempt, canMarkRepairBillingExempt, BILLING_EXEMPT_REASON_LABELS } from '@/lib/repair-billing-exempt'
import { findSaleOrderForRepair, findSalesQuoteForRepair, isDiagnosisFeeOnlyLines } from '@/lib/repair/sale-order-link'
import { saleLineFieldsForRepairQuoteLine } from '@/lib/sales/non-stock-line'
import { reissueOnRevision, reissueAfterClientDecision, reissueBlocker } from '@/lib/repair/invoice-reissue'
import { sync } from '../sync'
import type { InvoiceLine, JournalEntry, Invoice } from '../finance'
import { repairPriceChangeImpact, describeRepairPriceChange } from '@/lib/repair/document-impact'
import { allocateDocNumberSync } from '@/lib/doc-numbers'
import { planRepairPartReserve, planRepairPartConsume } from '@/lib/inventory/repair-parts-stock'
import type { LocationId } from '../core'
import { invoicePersistBody, putInvoiceWithLockRetry } from '@/lib/invoice-persist'
import type { DeliveryJob } from '../delivery'
import { applyRepairHandover, canCloseRepairAfterHandover, repairHasInvoiceLink } from '@/lib/repair-handover'
import { buildRepairInvoiceCharges, repairInvoiceChargeTotal, invoiceMatchesRepairCharges, repairBillsFeeOnly } from '@/lib/repair-invoice'
import { readLockVersionFromResponse } from '@/lib/optimistic-lock'
import { requestSaleOrderInvoice } from '@/lib/sales/create-invoice-request'
import { planRepairConsolidation, supersededOrderBlockers } from '@/lib/repair/consolidation-plan'
import { mergedSaleOrderFromPlan, executeRepairConsolidation } from '@/lib/repair/consolidation-execute'
import { ensureArray } from '@/lib/safe-local-state'
import { evaluateRepairTransition } from '@/lib/repair-transition-policy'
import { getPreviousRepairProgressStatus } from '@/lib/repair-progress'
import { countCorrectionBlocker, countCorrectionNote, requestAfterCountCheck, purchaseOrderBlocker, partsOrderNote, requestAfterPurchaseOrder } from '@/lib/repair/parts-request'
import type { StockAdjustment, SerialNumber } from '../inventory'
import type { POLine } from '../purchasing'
import { CATEGORY_CONFIG, type CategoryId } from '@/lib/product-categories'
import { resolveProductAccounts } from '@/lib/product-accounts'
import { refurbPartsOrderNote } from '@/lib/refurbishment/parts-request'
import { canConvertRetainedRepair, canCreateTradeInFromRepair, findRepairCatalogProduct, buyBackConditionFromRepair, matchRepairDeviceSerial } from '@/lib/repair-retain-convert'
import type { BuyBack } from '../after-sales'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** repairs actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createRepairActions(store: StoreDeps): Pick<AppState, 'createOutsourceJobBill' | 'addOutsourceVendor' | 'updateOutsourceVendor' | 'addOutsourceJob' | 'returnOutsourceJob' | 'cancelOutsourceJob' | 'updateOutsourceJob' | 'deleteOutsourceVendor' | 'chargeOutsourceToRepair' | 'remindLateOutsourceJobs' | 'prepareOutsourceStatements' | 'holdOutsourceStatementJob' | 'releaseOutsourceJobHold' | 'confirmOutsourceStatement' | 'recordOutsourcePayment' | 'createRepair' | 'updateRepair' | 'deleteRepair' | 'checkWarrantyForRepair' | 'fileWarrantyClaim' | 'verifyRepairIntake' | 'assignTechnicianToRepair' | 'logDiagnosis' | 'stopAtDiagnosis' | 'markDiagnosisFeePaid' | 'generateRepairQuote' | 'sendQuoteToCustomer' | 'approveRepairQuote' | 'startRepair' | 'markRepairComplete' | 'addRepairQAItem' | 'completeRepairQA' | 'markPartsArrived' | 'markRepairReady' | 'scheduleDelivery' | 'deliverRepair' | 'closeRepairJob' | 'createInvoiceFromRepair' | 'consolidateRepairInvoices' | 'reviewPortalPayment' | 'canViewRepair' | 'getVisibleRepairs' | 'updateRepairProgress' | 'moveRepairToPreviousProgress' | 'requestProcurement' | 'correctPartsCount' | 'raisePartsPurchaseOrder' | 'appendRepairHistory' | 'declineQuote' | 'waiveDiagnosisFee' | 'markRepairNoCharge' | 'markUnrepairable' | 'returnToCustomer' | 'leaveDeviceWithDeed' | 'convertRetainedRepairToDonation' | 'convertRetainedRepairToBuyBack' | 'createTradeInFromRepair'> {
  /** Move the planned parts to the repair unit: serials are assigned to the repair, bulk stock is transferred. */
  const applyReserveSteps = (steps: ReturnType<typeof planRepairPartReserve>['steps'], repairId: string, repairRef: string) => {
    for (const step of steps) {
      if (step.kind === 'assign_serial') {
        store.setSerials(p => p.map(s => s.id === step.serialId
          ? { ...s, status: 'assigned' as const, repairId, location: 'repair_unit' as LocationId }
          : s))
        store.addMove(step.productId, step.productName, 1, 'transfer', step.reason, repairRef, step.from, 'repair_unit', [step.serialNumber])
      } else {
        store.setBulkStock(prev => {
          let next = store.upsertBulkStock(prev, step.productId, step.from, -step.qty)
          next = store.upsertBulkStock(next, step.productId, step.to, step.qty)
          return next
        })
        store.addMove(step.productId, step.productName, step.qty, 'transfer', step.reason, repairRef, step.from, step.to, [])
      }
    }
  }

  /** A stock machine back from a vendor (or never sent) returns to where it sat. */
  const returnStockSerial = (job: OutsourceJob, reason: string) => {
    const serial = store.serialRef.current.find(s => s.id === job.stockSerialId)
    if (!serial || serial.location !== 'vendor') return
    const home = (job.stockFromLocation ?? 'warehouse') as LocationId
    store.setSerials(p => p.map(s => s.id === serial.id ? { ...s, location: home } : s))
    store.addMove(serial.productId, serial.productName, 1, 'transfer', reason, job.ref, 'vendor', home, [serial.serial])
  }

  return {
    createOutsourceJobBill: (jobId) => {
        const job = store.outsourceJobsRef.current.find(j => j.id === jobId)
        if (!job) return
        if (job.billId && store.invRef.current.some(i => i.id === job.billId && i.status !== 'cancelled')) {
          store.showToast(`${job.ref} already has a bill`, 'info'); return
        }
        if (job.statementId) { store.showToast(`${job.ref} is billed on statement ${job.statementRef ?? ''}`.trim(), 'info'); return }
        if (!(Number(job.finalCost) > 0)) { store.showToast(`${job.ref} has no final cost to bill`, 'error'); return }
        const billId = store.createOutsourceBill(job, Number(job.finalCost))
        store.setOutsourceJobs(prev => prev.map(j => j.id === jobId ? { ...j, billId } : j))
      },

    addOutsourceVendor: (v) => {
        const vendor: OutsourceVendor = { ...v, id: uid(), createdAt: now(), active: true }
        // Bills are raised against a Contacts record. Reuse the one with this
        // name (adding the vendor used to post a second one every time), and
        // say so when the contact could not be saved.
        const sameName = (c: Contact) => c.name.trim().toLowerCase() === v.name.trim().toLowerCase()
        const existing = store.contacts.find(c => sameName(c) && c.isVendor) ?? store.contacts.find(sameName)
        if (existing) vendor.contactId = existing.id
        store.setOutsourceVendors(prev => [...prev, vendor])
        if (!existing) {
          const contactPayload: Omit<Contact, 'id' | 'createdAt'> = {
            type: 'company',
            name: v.name,
            phone: v.phone,
            email: v.email ?? '',
            address: v.address ?? '',
            isCustomer: false,
            isVendor: true,
            tags: ['outsource-vendor'],
            notes: v.notes,
          }
          fetch('/api/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(contactPayload),
          }).then(async r => {
            if (!r.ok) throw new Error(String(r.status))
            const c = await r.json()
            store.setContacts(p => [c, ...p])
            store.setOutsourceVendors(prev => prev.map(x => x.id === vendor.id ? { ...x, contactId: c.id } : x))
          }).catch(() => {
            store.showToast(`${v.name} was added, but its contact could not be saved — add it in Contacts so Finance can bill it`, 'error')
          })
        }
        store.showToast('Vendor added', 'success')
        return vendor
      },

    updateOutsourceVendor: (id, p) => {
        store.setOutsourceVendors(prev => prev.map(v => v.id === id ? { ...v, ...p } : v))
      },

    deleteOutsourceVendor: (id) => {
        const vendor = store.outsourceVendors.find(v => v.id === id)
        if (!vendor) return false
        const used = store.outsourceJobsRef.current.filter(j => j.vendorId === id).length
        if (used > 0) {
          store.showToast(`${vendor.name} has ${used} job${used === 1 ? '' : 's'} on record — make it inactive instead`, 'error')
          return false
        }
        store.setOutsourceVendors(prev => prev.filter(v => v.id !== id))
        store.showToast(`${vendor.name} removed`, 'success')
        return true
      },

    addOutsourceJob: (j) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return null }
        const linkedRepair = j.repairOrderId ? store.repairsRef.current.find(r => r.id === j.repairOrderId) : undefined
        if (j.repairOrderId) {
          if (!linkedRepair) {
            store.showToast('Linked repair was not found', 'error')
            return null
          }
          const existing = store.getActiveOutsourceJob(j.repairOrderId)
          if (existing) {
            store.showToast(`Repair is already outsourced via ${existing.ref}. Mark it returned before sending out again.`, 'error')
            return null
          }
          if (['ready', 'verified_released', 'collected', 'closed', 'cancelled', 'declined', 'unrepairable', 'returned'].includes(linkedRepair.status)) {
            store.showToast('This repair is already closed or cannot be outsourced at this stage', 'error')
            return null
          }
          const readiness = repairOutsourceReadiness(linkedRepair)
          if (!readiness.ok) {
            store.showToast(readiness.reason, 'error')
            return null
          }
        }
        const vendor = store.outsourceVendors.find(v => v.id === j.vendorId)
        if (vendor && vendor.active === false) {
          store.showToast(`${vendor.name} is inactive — choose another vendor or make it active again`, 'error')
          return null
        }
        // A machine of ours (no repair) leaves the shelf: it moves to Vendor.
        const stockSerial = !linkedRepair ? findStockSerialForOutsource(store.serialRef.current, j.serial) : undefined
        if (stockSerial) {
          const holding = store.outsourceJobsRef.current.find(x => x.status === 'sent' && x.stockSerialId === stockSerial.id)
          if (holding) {
            store.showToast(`${stockSerial.serial} is already at ${holding.vendorName} via ${holding.ref}`, 'error')
            return null
          }
        }
        const job: OutsourceJob = {
          ...j,
          id: uid(),
          // Server counter (OUT/NNNN), swapped in when it answers. Counting
          // the jobs this screen had loaded gave two people the same number.
          ref: store.outsourceRef(),
          sentByUserId: user.id,
          sentByName: user.name,
          previousRepairStatus: linkedRepair?.status,
          expectedReturnDate: j.expectedReturnDate || defaultExpectedReturnDate(j.sentDate, j.serviceType) || undefined,
          ...(stockSerial ? { stockSerialId: stockSerial.id, stockFromLocation: stockSerial.location } : {}),
          status: 'sent',
          createdAt: now(),
        }
        store.setOutsourceJobs(prev => [job, ...prev])
        if (stockSerial) {
          store.setSerials(p => p.map(s => s.id === stockSerial.id ? { ...s, location: 'vendor' as LocationId } : s))
          store.addMove(stockSerial.productId, stockSerial.productName, 1, 'transfer', `Sent to ${job.vendorName} for ${OUTSOURCE_SERVICE_TYPES.find(t => t.value === job.serviceType)?.label ?? job.serviceType}`, job.ref, stockSerial.location, 'vendor', [stockSerial.serial])
        }
        if (linkedRepair) {
          const lockedRepair = store.markRepairLockedForOutsource(linkedRepair, job)
          store.setRepairs(prev => prev.map(r => r.id === linkedRepair.id ? lockedRepair : r))
          store.syncRepairToPortal(lockedRepair, `Device sent to vendor — repair remains in progress until ${job.ref} is returned`)
          store.addAuditLog('outsource_repair', linkedRepair.id, `Repair locked in repair and sent to ${job.vendorName} via ${job.ref}`)
        }
        store.showToast(`Job ${job.ref} created`, 'success')
  
        const notifBody = `${job.ref}: ${job.deviceDescription} → ${job.vendorName} for ${OUTSOURCE_SERVICE_TYPES.find(t => t.value === job.serviceType)?.label ?? job.serviceType}. Sent by ${user.name}.`
        store.notifyUsers({
          recipientRoles: ['technical_lead'],
          recipients: userIdsWithRoles(store.users, ['technical_lead'], user.id),
          type: 'repair',
          title: 'Repair Outsourced',
          body: notifBody,
          module: 'outsource',
          icon: '🔧',
          entityKey: `outsource:${job.id}:created`,
          excludeUserId: user.id,
        })
  
        return job
      },

    returnOutsourceJob: (id, p) => {
        const job = store.outsourceJobsRef.current.find(j => j.id === id)
        if (!job) return false
        // Only a job still out can come back. Two people (or two tabs) marking
        // the same job returned used to raise two vendor bills.
        if (job.status !== 'sent') {
          store.showToast(`${job.ref} was already ${job.status === 'cancelled' ? 'cancelled' : 'marked returned'}${job.returnedByName ? ` by ${job.returnedByName}` : ''}`, 'error')
          return false
        }
        const receiver = store.currentUser()
        const receivedBy = receiver?.name ?? job.sentByName
        // Claim the job before anything else, so a second click finds it returned.
        store.outsourceJobsRef.current = store.outsourceJobsRef.current.map(j => j.id === id ? { ...j, status: p.isResolved ? 'returned_resolved' : 'returned_unresolved' } : j)
  
        // A vendor that charged gets a bill whether or not the device came
        // back fixed (it used to be billed only when fixed, so a charge for an
        // unfixed device counted as owed in Outsource with no bill anywhere).
        // Weekly vendors: the cost waits for the week's statement (one bill a
        // week). Per-job vendors are billed now, as before.
        const vendor = store.outsourceVendors.find(v => v.id === job.vendorId)
        const billsWeekly = (vendor?.billing ?? 'weekly') === 'weekly'
        const billId = !billsWeekly && p.finalCost && p.finalCost > 0 ? store.createOutsourceBill(job, p.finalCost) : undefined
  
        store.setOutsourceJobs(prev => prev.map(j =>
          j.id === id
            ? { ...j, ...p, status: p.isResolved ? 'returned_resolved' : 'returned_unresolved', returnedByUserId: receiver?.id, returnedByName: receivedBy, ...(billId ? { billId } : {}) }
            : j
        ))
  
        if (job.repairOrderId) {
          const repair = store.repairsRef.current.find(r => r.id === job.repairOrderId)
  
          const resumeStatus: RepairStatus = 'qc'
  
          if (p.isResolved) {
            const qcItems = prepareRepairQcItemsForRound(repair?.qcItems, uid)
            const returnedRepair = repair ? {
              ...repair,
              status: resumeStatus,
              repairCompletedDate: repair.repairCompletedDate ?? now(),
              qcItems,
              qcFailReason: undefined,
              qcFailedDate: undefined,
              qcFailedBy: undefined,
              qcPassedDate: undefined,
              qcApprovedBy: undefined,
              statusHistory: [
                ...(repair.statusHistory ?? []),
                {
                  status: resumeStatus,
                  date: now(),
                  note: `Outsource job ${job.ref} returned fixed from ${job.vendorName}; moved to QC`,
                  by: receivedBy,
                },
              ],
            } : null
            store.setRepairs(prev => prev.map(r =>
              r.id === job.repairOrderId && returnedRepair ? returnedRepair : r
            ))
            if (returnedRepair) store.syncRepairToPortal(returnedRepair, `Outsource job ${job.ref} returned fixed — repair moved to QC`)
            store.addAuditLog('advance_repair', job.repairOrderId, `Outsource job ${job.ref} returned resolved; repair resumed at ${resumeStatus}`)
  
            store.notifyUsers({
              recipientRoles: ['technical_lead'],
              recipients: [
                repair?.assignedTechnicianId,
                ...userIdsWithRoles(store.users, ['technical_lead']),
              ],
              type: 'repair',
              title: repair?.assignedTechnicianId ? 'Outsource returned — repair resumed' : `Outsource job ${job.ref} resolved`,
              body: repair?.assignedTechnicianId
                ? `${job.ref}: ${job.deviceDescription} came back fixed from ${job.vendorName}. Repair ${repair.ref} resumed at ${resumeStatus}.`
                : `${job.deviceDescription} returned fixed from ${job.vendorName}. ${repair ? `Repair ${repair.ref} resumed at ${resumeStatus}.` : ''}`,
              module: repair?.assignedTechnicianId ? 'repair' : 'outsource',
              icon: '✅',
              entityKey: `outsource:${job.id}:returned_ok`,
              excludeUserId: store.currentUserId,
            })
          } else {
            // Unresolved — apply next-step to the linked repair
            const nextStep = p.repairNextStep ?? 'keep'
            if (repair) {
              const newStatus = statusAfterUnfixedReturn(nextStep, job.previousRepairStatus) as RepairStatus
              const returnedRepair = {
                ...repair,
                status: newStatus,
                statusHistory: [
                  ...(repair.statusHistory ?? []),
                  {
                    status: newStatus,
                    date: now(),
                    note: `Outsource job ${job.ref} returned unresolved from ${job.vendorName}`,
                    by: receivedBy,
                  },
                ],
              }
              store.setRepairs(prev => prev.map(r =>
                r.id === job.repairOrderId ? returnedRepair : r
              ))
              store.syncRepairToPortal(returnedRepair, `Outsource job ${job.ref} returned unresolved`)
              store.addAuditLog('advance_repair', job.repairOrderId,
                `Status set to ${newStatus} after outsource job ${job.ref} returned unresolved`)
            }
  
            const nextLabel = p.repairNextStep === 'unrepairable' ? 'marked unrepairable'
              : p.repairNextStep === 'in_repair' ? 'moved back to in-repair'
              : `back at ${statusAfterUnfixedReturn('keep', job.previousRepairStatus).replace(/_/g, ' ')}`
            store.notifyUsers({
              recipientRoles: ['technical_lead'],
              recipients: [
                repair?.assignedTechnicianId,
                ...userIdsWithRoles(store.users, ['technical_lead']),
              ],
              type: 'repair',
              title: repair?.assignedTechnicianId ? 'Outsource returned — not fixed' : `Outsource job ${job.ref} unresolved`,
              body: repair?.assignedTechnicianId
                ? `${job.ref}: ${job.deviceDescription} came back unfixed from ${job.vendorName}. Repair ${repair?.ref ?? ''} ${nextLabel}.`
                : `${job.deviceDescription} returned unfixed from ${job.vendorName}. ${repair ? `Repair ${repair.ref} ${nextLabel}.` : ''}`,
              module: repair?.assignedTechnicianId ? 'repair' : 'outsource',
              icon: '⚠️',
              entityKey: `outsource:${job.id}:returned_bad`,
              excludeUserId: store.currentUserId,
            })
          }
        }
  
        if (job.stockSerialId) returnStockSerial(job, `Back from ${job.vendorName}${p.isResolved ? ' — fixed' : ' — not fixed'}`)
        if (!billId) {
          const week = billsWeekly && p.finalCost && p.finalCost > 0 ? weekOf(p.returnedDate) : null
          store.showToast(week ? `Job marked as returned — billed on ${job.vendorName}'s statement for the week of ${week.weekStart}` : 'Job marked as returned', 'success')
        }
        return true
      },

    cancelOutsourceJob: (id, reason) => {
        const job = store.outsourceJobsRef.current.find(j => j.id === id)
        if (!job) return false
        if (job.status !== 'sent') { store.showToast(`${job.ref} is no longer out — it cannot be cancelled`, 'error'); return false }
        const why = reason.trim()
        if (!why) { store.showToast('Say why the job is cancelled', 'error'); return false }
        const user = store.currentUser()
        const by = user?.name ?? 'Unknown'
        store.outsourceJobsRef.current = store.outsourceJobsRef.current.map(j => j.id === id ? { ...j, status: 'cancelled' } : j)
        store.setOutsourceJobs(prev => prev.map(j => j.id === id
          ? { ...j, status: 'cancelled', cancelledDate: now(), cancelledByName: by, cancelReason: why }
          : j))
        if (job.repairOrderId) {
          const repair = store.repairsRef.current.find(r => r.id === job.repairOrderId)
          if (repair) {
            // Back where it was before it went out.
            const back = (job.previousRepairStatus && job.previousRepairStatus !== repair.status ? job.previousRepairStatus : repair.status) as RepairStatus
            const restored = {
              ...repair,
              status: back,
              statusHistory: [
                ...(repair.statusHistory ?? []),
                { status: back, date: now(), note: `Outsource job ${job.ref} to ${job.vendorName} cancelled: ${why}`, by },
              ],
            }
            store.setRepairs(prev => prev.map(r => r.id === repair.id ? restored : r))
            store.syncRepairToPortal(restored, `Outsource job ${job.ref} cancelled — repair continues in our workshop`)
            store.addAuditLog('outsource_cancel', repair.id, `Outsource job ${job.ref} cancelled (${why}); repair back at ${back}`)
          }
        }
        if (job.stockSerialId) returnStockSerial(job, `Outsource job ${job.ref} cancelled`)
        store.showToast(`${job.ref} cancelled`, 'success')
        return true
      },

    updateOutsourceJob: (id, p) => {
        const job = store.outsourceJobsRef.current.find(j => j.id === id)
        if (!job) return false
        if (job.status !== 'sent') { store.showToast(`${job.ref} is back — only open jobs can be changed`, 'error'); return false }
        if (p.vendorId && p.vendorId !== job.vendorId) {
          const vendor = store.outsourceVendors.find(v => v.id === p.vendorId)
          if (!vendor) { store.showToast('Vendor not found', 'error'); return false }
          if (vendor.active === false) { store.showToast(`${vendor.name} is inactive`, 'error'); return false }
          p = { ...p, vendorName: vendor.name }
        }
        const labels: Record<string, string> = { vendorName: 'vendor', serviceType: 'service', issueDescription: 'work to do', quotedCost: 'quote', expectedReturnDate: 'promised date', notes: 'notes', accessories: 'accessories', sentDate: 'date sent' }
        const changed = Object.entries(p)
          .filter(([k, v]) => k !== 'vendorId' && (job as unknown as Record<string, unknown>)[k] !== v && labels[k])
          .map(([k, v]) => `${labels[k]}: ${String((job as unknown as Record<string, unknown>)[k] ?? '—')} → ${String(v ?? '—')}`)
        if (!changed.length) return true
        const by = store.currentUser()?.name ?? 'Unknown'
        store.setOutsourceJobs(prev => prev.map(j => j.id === id
          ? { ...j, ...p, editLog: [...(j.editLog ?? []), { date: now(), by, note: changed.join('; ') }] }
          : j))
        if (p.vendorName && job.repairOrderId) {
          store.addAuditLog('outsource_repair', job.repairOrderId, `${job.ref} moved from ${job.vendorName} to ${p.vendorName}`)
        }
        store.showToast(`${job.ref} updated`, 'success')
        return true
      },

    remindLateOutsourceJobs: () => {
        const due = store.outsourceJobsRef.current.filter(j =>
          isOutsourceOverdue(j) && j.expectedReturnDate && j.lateReminderFor !== j.expectedReturnDate)
        if (!due.length) return
        const ids = new Set(due.map(j => j.id))
        store.outsourceJobsRef.current = store.outsourceJobsRef.current.map(j => ids.has(j.id) ? { ...j, lateReminderFor: j.expectedReturnDate } : j)
        store.setOutsourceJobs(prev => prev.map(j => ids.has(j.id) ? { ...j, lateReminderFor: j.expectedReturnDate } : j))
        for (const job of due) {
          const late = outsourceDaysLate(job) ?? 0
          store.notifyUsers({
            recipientRoles: ['technical_lead'],
            recipients: [job.sentByUserId, ...userIdsWithRoles(store.users, ['technical_lead'])],
            type: 'repair',
            title: `${job.ref} is late at ${job.vendorName}`,
            body: `${job.deviceDescription} was promised back on ${job.expectedReturnDate} (${late === 1 ? '1 day' : `${late} days`} ago). Chase the vendor, or mark it returned if it is back.`,
            module: 'outsource',
            icon: '⏰',
            entityKey: `outsource:${job.id}:late:${job.expectedReturnDate}`,
          })
        }
      },

    prepareOutsourceStatements: () => {
        // Only from complete, current copies: preparing from a half-loaded
        // list would bill a week twice or miss jobs.
        if (!downloadedThisSession(['deed_outsourceJobs', 'deed_outsourceVendors', 'deed_outsourceStatements'])) return
        const weekly = new Set(store.outsourceVendors.filter(v => (v.billing ?? 'weekly') === 'weekly').map(v => v.id))
        const plans = planWeeklyStatements(store.outsourceJobsRef.current, weekly)
        if (!plans.length) return
        const statements = [...store.outsourceStatementsRef.current]
        const created: OutsourceStatement[] = []
        const assigned = new Map<string, { id: string; ref: string }>()
        for (const plan of plans) {
          const vendor = store.outsourceVendors.find(v => v.id === plan.vendorId)
          const lines = plan.jobs.map(j => ({
            jobId: j.id,
            jobRef: j.ref,
            description: `${OUTSOURCE_SERVICE_TYPES.find(t => t.value === j.serviceType)?.label ?? j.serviceType} — ${j.deviceDescription}`,
            amount: Math.round(Number(j.finalCost) * 100) / 100,
          }))
          // A pending statement for that week takes late entries; a confirmed
          // one is never changed, so they go on another for the same week.
          const open = statements.find(st => st.vendorId === plan.vendorId && st.weekStart === plan.weekStart && st.status === 'pending')
          if (open) {
            const merged = { ...open, lines: [...open.lines, ...lines], total: Math.round((open.total + lines.reduce((a, l) => a + l.amount, 0)) * 100) / 100 }
            statements[statements.indexOf(open)] = merged
            for (const l of lines) assigned.set(l.jobId, { id: open.id, ref: open.ref })
            continue
          }
          const sameWeek = statements.filter(st => st.vendorId === plan.vendorId && st.weekStart === plan.weekStart).length
          // A fixed id per vendor and week: two people preparing at once save
          // the same statement, not two.
          const statement: OutsourceStatement = {
            id: `ost-${plan.vendorId}-${plan.weekStart}${sameWeek ? `-${sameWeek + 1}` : ''}`,
            ref: store.outsourceStatementRef(),
            vendorId: plan.vendorId,
            vendorName: vendor?.name ?? plan.jobs[0]?.vendorName ?? 'Vendor',
            weekStart: plan.weekStart,
            weekEnd: plan.weekEnd,
            lines,
            total: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100,
            status: 'pending',
            createdAt: now(),
          }
          statements.unshift(statement)
          created.push(statement)
          for (const l of lines) assigned.set(l.jobId, { id: statement.id, ref: statement.ref })
        }
        store.outsourceStatementsRef.current = statements
        store.setOutsourceStatements(statements)
        store.outsourceJobsRef.current = store.outsourceJobsRef.current.map(j => assigned.has(j.id) ? { ...j, statementId: assigned.get(j.id)!.id, statementRef: assigned.get(j.id)!.ref } : j)
        store.setOutsourceJobs(prev => prev.map(j => assigned.has(j.id) ? { ...j, statementId: assigned.get(j.id)!.id, statementRef: assigned.get(j.id)!.ref } : j))
        for (const st of created) {
          store.notifyUsers({
            recipientRoles: ['finance_officer', 'admin_officer'],
            recipients: userIdsWithRoles(store.users, ['finance_officer', 'admin_officer']),
            type: 'repair',
            title: `${st.vendorName}: weekly statement ready`,
            body: `${st.lines.length} job${st.lines.length === 1 ? '' : 's'} returned ${st.weekStart} to ${st.weekEnd}, ${store.fmtKes(st.total)}. Check and confirm it in Outsource → Statements.`,
            module: 'outsource',
            icon: '🧾',
            entityKey: `outsource-statement:${st.id}`,
          })
        }
      },

    holdOutsourceStatementJob: (statementId, jobId, reason) => {
        const st = store.outsourceStatementsRef.current.find(x => x.id === statementId)
        if (!st || st.status !== 'pending') { store.showToast('Only a statement not yet confirmed can change', 'error'); return false }
        const line = st.lines.find(l => l.jobId === jobId)
        if (!line) return false
        const why = reason.trim()
        if (!why) { store.showToast('Say why this job is held back', 'error'); return false }
        const by = store.currentUser()?.name ?? 'Unknown'
        const lines = st.lines.filter(l => l.jobId !== jobId)
        const updated = { ...st, lines, total: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100 }
        // An empty statement goes; there is nothing left to bill on it.
        const next = lines.length
          ? store.outsourceStatementsRef.current.map(x => x.id === statementId ? updated : x)
          : store.outsourceStatementsRef.current.filter(x => x.id !== statementId)
        store.outsourceStatementsRef.current = next
        store.setOutsourceStatements(next)
        const hold = { reason: why, by, date: now() }
        store.outsourceJobsRef.current = store.outsourceJobsRef.current.map(j => j.id === jobId ? { ...j, statementId: undefined, statementRef: undefined, billingHold: hold } : j)
        store.setOutsourceJobs(prev => prev.map(j => j.id === jobId ? { ...j, statementId: undefined, statementRef: undefined, billingHold: hold } : j))
        store.showToast(`${line.jobRef} held back from ${st.ref}`, 'success')
        return true
      },

    releaseOutsourceJobHold: (jobId) => {
        const job = store.outsourceJobsRef.current.find(j => j.id === jobId)
        if (!job?.billingHold) return false
        store.outsourceJobsRef.current = store.outsourceJobsRef.current.map(j => j.id === jobId ? { ...j, billingHold: undefined } : j)
        store.setOutsourceJobs(prev => prev.map(j => j.id === jobId ? { ...j, billingHold: undefined } : j))
        store.showToast(`${job.ref} will be billed on its week's statement`, 'success')
        return true
      },

    confirmOutsourceStatement: (statementId) => {
        const user = store.currentUser()
        // Finance Officer, Admin Officer or Director (who may post bills and payments).
        if (!canManageFinance(user)) { store.showToast('Only Finance, an Admin Officer or the Director can confirm a statement', 'error'); return null }
        const st = store.outsourceStatementsRef.current.find(x => x.id === statementId)
        if (!st) return null
        if (st.status !== 'pending') { store.showToast(`${st.ref} is already confirmed${st.billRef ? ` (${st.billRef})` : ''}`, 'info'); return null }
        if (!st.lines.length || !(st.total > 0)) { store.showToast(`${st.ref} has nothing to bill`, 'error'); return null }
        const vendor = store.outsourceVendors.find(v => v.id === st.vendorId)
        const contactId = vendor?.contactId
          ?? store.contacts.find(c => c.isVendor && c.name.trim().toLowerCase() === st.vendorName.trim().toLowerCase())?.id
          ?? st.vendorId
        const account = store.accounts.some(a => a.code === OUTSOURCE_COST_ACCOUNT.code) ? OUTSOURCE_COST_ACCOUNT.code : undefined
        const bill: Invoice = {
          id: uid(),
          ref: store.draftInvoiceRef('vendor_bill'),
          type: 'vendor_bill',
          status: 'draft',
          partnerId: contactId,
          partnerName: st.vendorName,
          date: now(),
          dueDate: new Date(Date.now() + contactPaymentTermsDays(store.contacts.find(c => c.id === contactId), store.systemSettings.purDefaultPaymentTermsDays ?? 30) * 86_400_000).toISOString(),
          // One line per job, so the bill reads like the statement.
          lines: st.lines.map(l => ({
            id: uid(),
            description: `${l.jobRef} · ${l.description}`,
            ...(account ? { accountCode: account } : {}),
            qty: 1,
            unitPrice: l.amount,
            taxRate: 0,
            subtotal: l.amount,
          })),
          subtotal: st.total,
          taxTotal: 0,
          total: st.total,
          amountPaid: 0,
          notes: `Outsource statement ${st.ref} — jobs returned ${st.weekStart} to ${st.weekEnd} · confirmed by ${user?.name ?? 'staff'}`,
        }
        store.invRef.current = [bill, ...store.invRef.current]
        store.setInvoices(p => [bill, ...p])
        void store.saveInvoiceToServer(bill, msg => store.showToast(msg, 'error'))
        const jobIds = new Set(st.lines.map(l => l.jobId))
        const confirmed = { ...st, status: 'confirmed' as const, billId: bill.id, billRef: bill.ref, confirmedAt: now(), confirmedByName: user?.name }
        store.outsourceStatementsRef.current = store.outsourceStatementsRef.current.map(x => x.id === statementId ? confirmed : x)
        store.setOutsourceStatements(prev => prev.map(x => x.id === statementId ? confirmed : x))
        // The jobs point at the bill too: paying the vendor finds it through them.
        store.outsourceJobsRef.current = store.outsourceJobsRef.current.map(j => jobIds.has(j.id) ? { ...j, billId: bill.id } : j)
        store.setOutsourceJobs(prev => prev.map(j => jobIds.has(j.id) ? { ...j, billId: bill.id } : j))
        store.addAuditLog('create_bill', bill.ref, `Outsource statement ${st.ref} (${st.vendorName}, week of ${st.weekStart}) confirmed into draft bill`)
        store.showToast(`Draft bill for ${st.vendorName} created — post it in Finance to pay`, 'success')
        return bill.ref
      },

    chargeOutsourceToRepair: (jobId, amount) => {
        const job = store.outsourceJobsRef.current.find(j => j.id === jobId)
        if (!job?.repairOrderId) return false
        if (job.customerChargeAddedAt) { store.showToast(`${job.ref} is already on the customer's quote`, 'info'); return false }
        const price = Math.round(Number(amount))
        if (!(price > 0)) { store.showToast('Enter what the customer pays for this work', 'error'); return false }
        const repair = store.repairsRef.current.find(r => r.id === job.repairOrderId)
        if (!repair) return false
        if (isRepairNoCharge(repair)) { store.showToast(`${repair.ref} is not charged to the customer`, 'info'); return false }
        if (repair.invoiceId) { store.showToast(`${repair.ref} is already invoiced — add the charge on the invoice in Finance`, 'error'); return false }
        if (!repair.quote) { store.showToast(`${repair.ref} has no quote yet — add the outsourced work when quoting`, 'error'); return false }
        const service = OUTSOURCE_SERVICE_TYPES.find(t => t.value === job.serviceType)?.label ?? job.serviceType
        const line: RepairQuoteLine = {
          id: uid(),
          type: 'service',
          description: `${service} (specialist repair, ${job.ref})`,
          qty: 1,
          unitPrice: price,
          subtotal: price,
          reserved: false,
        }
        const vatRate = Number(store.companySettings.vatRate) || 0
        const addedTax = repair.quote.tax > 0 ? Math.round(price * vatRate / 100) : 0
        const by = store.currentUser()?.name ?? 'Unknown'
        const prevTotal = repair.quote.total
        const quote: RepairQuote = {
          ...repair.quote,
          lines: [...repair.quote.lines, line],
          subtotal: repair.quote.subtotal + price,
          tax: repair.quote.tax + addedTax,
          total: repair.quote.total + price + addedTax,
          ...(repair.quote.approvedTotal != null ? { approvedTotal: repair.quote.approvedTotal + price + addedTax } : {}),
          prevTotal,
          changeSummary: `Added ${service} done by a specialist (${job.ref})`,
        }
        // Merge into the latest row: this runs straight after the return,
        // whose status change may not have reached repairsRef yet.
        store.setRepairs(prev => prev.map(r => r.id === repair.id
          ? {
            ...r,
            quote,
            statusHistory: [
              ...(r.statusHistory ?? []),
              { status: r.status, date: now(), note: `Added ${store.fmtKes(price)} for outsourced ${service} (${job.ref}) to the quote`, by },
            ],
          }
          : r))
        store.setOutsourceJobs(prev => prev.map(j => j.id === jobId ? { ...j, customerChargeAmount: price, customerChargeAddedAt: now() } : j))
        store.addAuditLog('outsource_charge', repair.id, `Outsourced work ${job.ref} added to the quote at ${price}`)
        store.showToast(`${store.fmtKes(price)} added to ${repair.ref}'s quote`, 'success')
        return true
      },

    recordOutsourcePayment: async (p) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return null }
        if (!canManageFinance(user)) { store.showToast('Only Finance or Admin Officer can pay vendors', 'error'); return null }
        // Pay the vendor's own bills, oldest first, through Finance's payment
        // step: cash/bank is posted and each bill shows as paid. Payments
        // recorded only here used to leave the bills unpaid in Finance (so they
        // could be paid twice) and never reached the cash book.
        const open = store.outsourceVendorBills(p.vendorId)
          .filter(b => invoiceDocState(b.status) === 'posted' && b.total - b.amountPaid > 0.5)
          .sort((x, y) => String(x.date).localeCompare(String(y.date)))
        const payable = open.reduce((sum, b) => sum + (b.total - b.amountPaid), 0)
        if (p.amount > payable + 0.5) {
          const drafts = store.outsourceVendorBills(p.vendorId).filter(b => invoiceDocState(b.status) === 'draft')
          store.showToast(drafts.length
            ? `Only ${store.fmtKes(payable)} can be paid now — ${drafts.map(b => b.ref).join(', ')} still ${drafts.length === 1 ? 'needs' : 'need'} Finance to confirm (post) ${drafts.length === 1 ? 'it' : 'them'} first`
            : `Amount exceeds the ${store.fmtKes(payable)} owed on posted bills`, 'error')
          return null
        }
        let remaining = p.amount
        const paidRefs: string[] = []
        for (const bill of open) {
          if (remaining <= 0.5) break
          const amt = Math.min(remaining, bill.total - bill.amountPaid)
          // Only what the server recorded counts (registerPayment shows the reason when it refuses).
          const ok = await store.storeCtxRef.current!.registerPayment(bill.id, amt, p.method, p.bankAccountId, p.reference, p.date)
          if (!ok) break
          paidRefs.push(bill.ref)
          remaining -= amt
        }
        const paid = Math.round((p.amount - remaining) * 100) / 100
        if (paid <= 0) return null
        const payment: OutsourcePayment = {
          ...p,
          amount: paid,
          id: uid(),
          ref: await store.storeCtxRef.current!.allocateDocRef('OPAY'),
          paidByUserId: user.id,
          paidByName: user.name,
          createdAt: now(),
          postedToAccounts: true,
          billRefs: paidRefs,
        }
        store.setOutsourcePayments(prev => [payment, ...prev])
        store.showToast(remaining > 0.5
          ? `Paid ${store.fmtKes(paid)} of ${store.fmtKes(p.amount)} (${paidRefs.join(', ')}) — the rest was not paid`
          : `Payment ${payment.ref} recorded against ${paidRefs.join(', ')}`, remaining > 0.5 ? 'error' : 'success')
        return payment
      },

    // ── Repairs ───────────────────────────────────────────────────────────────
    createRepair: async (customerId, customerName, productName, serial, desc, intake) => {
        const customer = store.contacts.find(c => c.id === customerId)
        const user = store.currentUser()
        // Official ticket is allocated by POST before this returns so the
        // booking success screen never shares a timestamp placeholder (REP-227532).
        const bookedAt = new Date().toISOString()
        const intakePatch = intake ? { ...intake } : {}
        delete (intakePatch as Partial<RepairOrder>).id
        delete (intakePatch as Partial<RepairOrder>).ref
        const draft: RepairOrder = {
          id: uid(),
          ref: `REP-${Date.now().toString().slice(-6)}`,
          
          // Customer & Device
          customerPhone: customer?.phone ?? '',
          customerEmail: customer?.email,
          productId: '',
          deviceCondition: 'good',
          
          // Intake
          intakeChannel: 'walk_in',
          intakeNotes: desc,
          accessories: [],
          
          // Warranty
          underWarranty: false,
          warrantyVerificationStatus: serial.trim() ? 'not_checked' : 'pending_manual_review',
          serialWarrantyException: !serial.trim(),
          serialWarrantyExceptionReason: !serial.trim() ? 'other' : undefined,
          serialWarrantyExceptionNotes: !serial.trim() ? 'Serial number was not captured during intake.' : undefined,
          
          // Repair
          partsUsed: [],
          laborCost: 0,
          logisticsCost: 0,
          total: 0,
          
          // QA
          qcItems: [],
          
          // Metadata
          createdBy: user?.username ?? 'system',
          bookedByName: user?.name ?? 'System',
          createdDate: now(),
          notes: '',
          slaMissed: false,
          
          // Legacy fields
          date: now(),
          technicianName: '',
  
          // Booking extras (path, warranty, waiver, accessories, …) must be on
          // the object BEFORE POST — a follow-up updateRepair races the create
          // write and can leave jobs stuck on diagnosis_first / no warranty.
          ...intakePatch,
          customerId,
          customerName,
          productName,
          serialNumber: serial,
          issueDescription: desc,
          description: desc,
          intakeDate: ensureRepairIntakeTimestamp(
            (intakePatch as Partial<RepairOrder>).intakeDate ?? bookedAt,
          ),
          status: (intakePatch as Partial<RepairOrder>).status ?? 'received',
        }
        const res = await fetch('/api/repairs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        })
        if (!res.ok) {
          store.showToast('Could not allocate a repair ticket number', 'error')
          throw new Error('Failed to create repair')
        }
        const serverRepair = await res.json() as RepairOrder
        const merged: RepairOrder = {
          ...draft,
          ...serverRepair,
          id: serverRepair.id || draft.id,
          ref: serverRepair.ref || draft.ref,
          previousRefs: serverRepair.previousRefs,
        }
        store.setRepairs(p => [merged, ...p])
        store.syncRepairToPortal(merged, 'Repair booked in')
        store.addAuditLog('create_repair', merged.ref, `Repair job created for ${customerName} - ${productName}`)
        store.notifyUsers({
          recipientRoles: ['technical_lead'],
          recipients: userIdsWithRoles(store.users, ['technical_lead'], store.currentUserId),
          type: 'repair',
          title: 'New repair job booked',
          body: `${customerName} — ${productName}`,
          module: 'repair',
          path: `?id=${merged.id}`,
          icon: '🛠️',
          entityKey: `repair:${merged.id}:booked`,
          excludeUserId: store.currentUserId,
        })
        store.showToast(`${merged.ref} created`)
        return merged
      },

    updateRepair: (id, p) => {
        const existing = store.repairsRef.current.find(r => r.id === id)
        if (!existing) return
        const patch = { ...p }
        if ('intakeDate' in patch && patch.intakeDate != null) {
          patch.intakeDate = ensureRepairIntakeTimestamp(patch.intakeDate)
        }
        if ('intakeDate' in patch || 'date' in patch) {
          const dateErr = repairDatesWriteError({
            intakeDate: 'intakeDate' in patch ? patch.intakeDate : existing.intakeDate,
            date: 'date' in patch ? patch.date : existing.date,
          })
          if (dateErr) { store.showToast(dateErr, 'error'); return }
        }
        const applyPatch = (base: RepairOrder): RepairOrder => {
          const updatedBase = { ...base, ...patch }
          const partsTotal = (patch.partsUsed ?? base.partsUsed ?? []).reduce((a, x) => a + x.qty * x.price, 0)
          const feeDue = shouldChargeDiagnosisFee(updatedBase) && (updatedBase.diagnosisStopped || updatedBase.diagnosisFeeStatus === 'applicable')
            ? (updatedBase.diagnosisFee ?? 0)
            : 0
          return {
            ...updatedBase,
            total: updatedBase.underWarranty && updatedBase.warrantyCoverage === 'full'
              ? 0
              : partsTotal + updatedBase.laborCost + feeDue,
          }
        }
        let updated = applyPatch(existing)
        store.setRepairs(prev => prev.map(r => {
          if (r.id !== id) return r
          updated = applyPatch(r)
          return updated
        }))
        store.repairsRef.current = store.repairsRef.current.map(r => r.id === id ? updated : r)
        // Sync portal when customer-visible intake / report fields change
        if (
          'qcReportData' in patch || 'diagnosisReportData' in patch || 'preRepairPhotos' in patch || 'issuePhotos' in patch
          || 'repairPath' in patch || 'liabilityWaiverAccepted' in patch || 'notes' in patch
          || 'issueDescription' in patch || 'customerName' in patch || 'customerPhone' in patch || 'customerEmail' in patch
          || 'intakeDate' in patch
        ) {
          setTimeout(() => store.syncRepairToPortal(updated), 0)
        }
        if ('customerName' in patch || 'customerPhone' in patch || 'customerEmail' in patch || 'customerId' in patch) {
          const contact = store.contacts.find(c => c.id === updated.customerId)
          store.syncCustomerIdentityToDocuments({
            contactId: updated.customerId,
            saleOrderId: updated.saleOrderId,
            repairId: updated.id,
            invoiceId: updated.invoiceId,
            identity: {
              name: String(updated.customerName || '').trim(),
              email: updated.customerEmail || contact?.email || undefined,
              phone: updated.customerPhone || contact?.phone || contact?.mobile || undefined,
              address: contact ? formatCustomerAddress(contact) : undefined,
              customerId: updated.customerId,
            },
          })
        }
      },

    deleteRepair: async (id) => {
        const user = store.currentUser()
        if (!user || !isDirector(user.role)) {
          store.showToast('Only a director can delete a repair', 'error'); return false
        }
        const repair = store.repairsRef.current.find(r => r.id === id)
        if (!repair) {
          store.showToast('Repair no longer exists. Refresh the list and try again.', 'error')
          return false
        }
        try {
          const response = await fetch(`/api/repairs/${id}`, { method: 'DELETE' })
          if (!response.ok) {
            const payload = await response.json().catch(() => null) as { error?: string } | null
            store.showToast(payload?.error || 'Could not delete the repair', 'error')
            return false
          }
        } catch {
          store.showToast('Could not reach the server to delete the repair', 'error')
          return false
        }
        store.setRepairs(p => p.filter(r => r.id !== id))
        store.setOutsourceJobs(p => p.map(j => j.repairOrderId === id ? { ...j, repairOrderId: undefined } : j))
        store.addAuditLog('delete_repair', repair.ref, `Repair ${repair.ref} deleted by ${user.name}`)
        store.showToast(`Repair ${repair.ref} deleted`)
        return true
      },

    checkWarrantyForRepair: (repairId, serial) => {
        const decision = resolveRepairWarranty(store.warRef.current, serial)
        const war = decision.warranty
        if (decision.covered && war) {
          store.setRepairs(p => p.map(r => r.id === repairId ? { ...r, warrantyId: war.id, underWarranty: true, laborCost: 0, total: 0 } : r))
          store.addAuditLog('warranty_check', repairId, `Active warranty ${war.ref} applied`)
          store.showToast(`✓ Active warranty ${war.ref} — repair is FREE`, 'info')
          return true
        }
        store.showToast('No active warranty for this serial number', 'error')
        return false
      },

    fileWarrantyClaim: (repairId, notes) => {
        const repair = store.repairsRef.current.find(r => r.id === repairId)
        if (!repair) return
        if (!repair.underWarranty) { store.showToast('Repair is not under warranty', 'error'); return }
        if (repair.warrantyClaimId) { store.showToast('Warranty claim already filed', 'error'); return }
        const claimId = `WC-${Date.now()}`
        store.setRepairs(p => p.map(r => r.id === repairId ? { ...r, warrantyClaimId: claimId } : r))
        store.addAuditLog('warranty_claim', repairId, `Warranty claim filed: ${claimId}${notes ? ` — ${notes}` : ''}`)
        store.showToast(`Warranty claim ${claimId} filed`, 'success')
      },

    // ── Repair Workflow Actions ──────────────────────────────────────────────
    verifyRepairIntake: (repairId, notes = '') => {
        const actor = store.currentUser()
        if (!userCan(actor, 'repair.verify')) {
          store.showToast('Only authorised staff can verify repair intake', 'error'); return
        }
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) { store.showToast('Repair not found', 'error'); return }
        if (repair.status !== 'pending_verification') {
          store.showToast('Only pending verification repairs can be verified', 'error'); return
        }
        const verified: RepairOrder = {
          ...repair,
          status: 'received',
          verificationDate: now(),
          verifiedBy: actor!.name,
          verificationNotes: notes.trim() || undefined,
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? verified : r))
        store.syncRepairToPortal(verified, 'Device verified by staff — repair received')
        store.notifyUsers({
          recipientRoles: ['technical_lead'],
          recipients: userIdsWithRoles(store.users, ['technical_lead'], actor!.id),
          type: 'repair',
          title: `Repair intake verified: ${repair.ref}`,
          body: `${repair.productName} for ${repair.customerName} is ready for assignment.`,
          module: 'repair',
          path: `?id=${repair.id}`,
          icon: '✅',
          entityKey: `repair:${repair.id}:verified`,
          excludeUserId: actor!.id,
        })
        store.addAuditLog('verify_repair_intake', repairId, `${actor!.name} verified intake${notes ? `: ${notes}` : ''}`)
        store.showToast(`${repair.ref} verified and moved to received`)
      },

    assignTechnicianToRepair: async (repairId, technicianId) => {
        const actor = store.currentUser()
        if (!actor || !isRepairAssignerRole(actor.role)) {
          store.showToast('Only the Technical Lead can assign repairs', 'error'); return
        }
        const tech = store.users.find(u => u.id === technicianId)
        if (!tech) { store.showToast('Technician not found', 'error'); return }
        const exitedEmployeeIds = new Set(store.empRef.current.filter(e => e.status === 'exited').map(e => e.id))
        if (!isAssignableTechnician(tech, exitedEmployeeIds)) {
          store.showToast('Cannot assign an inactive or exited technician', 'error'); return
        }
        const repair = store.repairs.find(r => r.id === repairId)
  
        const assignedPatch = {
          assignedTechnicianId: technicianId,
          assignedTechnicianName: tech.name,
          assignedDate: now(),
          status: (repair?.status === 'received' ? 'assigned' : repair?.status) as RepairOrder['status'],
          technicianName: tech.name,
        }
  
        store.setRepairs(p => p.map(r => r.id === repairId ? { ...r, ...assignedPatch } : r))
  
        try {
          const res = await fetch(`/api/repairs/${encodeURIComponent(repairId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(assignedPatch),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string }
            if (repair) store.setRepairs(p => p.map(r => r.id === repairId ? repair : r))
            store.showToast(err.error || 'Could not assign technician', 'error')
            return
          }
        } catch {
          if (repair) store.setRepairs(p => p.map(r => r.id === repairId ? repair : r))
          store.showToast('Could not assign technician', 'error')
          return
        }
  
        if (repair) {
          store.notifyUsers({
            recipients: [technicianId],
            type: 'assignment',
            title: 'Repair job assigned to you',
            body: `${repair.productName} — ${repair.issueDescription?.slice(0, 80) ?? 'See repair details'}.`,
            module: 'repair',
            path: `?id=${repair.id}`,
            icon: '🛠️',
            entityKey: `repair:${repair.id}:assigned`,
            excludeUserId: actor.id,
          })
          store.syncRepairToPortal({ ...repair, ...assignedPatch }, `Assigned to ${tech.name}`)
        }
        store.addAuditLog('assign_technician', repairId, `${actor.name} assigned to ${tech.name}`)
        store.showToast(`Assigned to ${tech.name}`)
      },

    logDiagnosis: async (repairId, diagnosisInput, extras) => {
        const user = store.currentUser()
        if (!user) return
        const repair = store.repairsRef.current.find(r => r.id === repairId)
        if (!repair) return
        if (isDirectRepairPath(repair.repairPath)) {
          store.showToast('Direct Repair jobs skip diagnosis — change the workflow path first if diagnosis is required', 'error')
          return
        }
        const isAssignedTech = repair.assignedTechnicianId === user.id
        const isLeadOrDirector = userCan(user, 'repair.lead')
        if (!isAssignedTech && !isLeadOrDirector) {
          store.showToast('Only the assigned technician or lead technician can log or update a diagnosis', 'error'); return
        }
  
        const previousHistory = repair.diagnosisHistory?.length ? repair.diagnosisHistory : repair.diagnosis ? [repair.diagnosis] : []
        const nextRevision = previousHistory.length + 1
        const isRevision = previousHistory.length > 0
        const diagnosis: RepairDiagnosis = {
          ...diagnosisInput,
          id: uid(),
          revision: nextRevision,
          revisionType: (diagnosisInput as any).revisionType ?? (isRevision ? 'update' : 'initial'),
          revisionReason: (diagnosisInput as any).revisionReason,
          diagnosedBy: user.name,
          diagnosedDate: now(),
        }
        const updated = applyLoggedDiagnosis(repair, diagnosis, extras, user.name)
        store.repairsRef.current = store.repairsRef.current.map(r => r.id === repairId ? updated : r)
        store.setRepairs(p => p.map(r => r.id === repairId ? updated : r))
  
        try {
          const res = await fetch(`/api/repairs/${encodeURIComponent(repairId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: updated.status,
              diagnosis: updated.diagnosis,
              diagnosisHistory: updated.diagnosisHistory,
              statusHistory: updated.statusHistory,
              ...(extras ?? {}),
            }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string }
            store.repairsRef.current = store.repairsRef.current.map(r => r.id === repairId ? repair : r)
            store.setRepairs(p => p.map(r => r.id === repairId ? repair : r))
            store.showToast(err.error || 'Could not save diagnosis', 'error')
            return
          }
        } catch {
          store.repairsRef.current = store.repairsRef.current.map(r => r.id === repairId ? repair : r)
          store.setRepairs(p => p.map(r => r.id === repairId ? repair : r))
          store.showToast('Could not save diagnosis', 'error')
          return
        }
  
        store.syncRepairToPortal(updated, isRevision ? 'Diagnosis updated — latest findings are available' : 'Diagnosis completed')
        store.addAuditLog(isRevision ? 'update_diagnosis' : 'diagnose_repair', repairId, `${isRevision ? 'Diagnosis updated' : 'Diagnosis logged'}: ${diagnosis.findings}`)
        store.showToast(isRevision ? 'Diagnosis update saved — revise the quote if pricing changed' : 'Diagnosis logged — you can generate a quote and pick parts')
      },

    stopAtDiagnosis: (repairId) => {
        const user = store.currentUser()
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return
        if (isDirectRepairPath(repair.repairPath)) {
          store.showToast('Stop at diagnosis only applies to Diagnosis First repairs', 'error'); return
        }
        const isManager = userCan(user, 'repair.manage')
        if (!user || (!isManager && repair.assignedTechnicianId !== user.id)) {
          store.showToast('Only the assigned technician or a manager can stop at diagnosis', 'error'); return
        }
        const resolved = resolveDiagnosisFee(repair, store.systemSettings)
        const DIAGNOSIS_FEE = resolved.amount
        const alreadyPaid = isDiagnosisFeeSettled(repair) || resolved.status === 'paid'
        const nextFeeStatus = DIAGNOSIS_FEE <= 0
          ? (resolved.status as RepairOrder['diagnosisFeeStatus'])
          : alreadyPaid
            ? 'paid'
            : 'applicable'
        const stopped: RepairOrder = {
          ...repair,
          diagnosisStopped: true,
          diagnosisFee: DIAGNOSIS_FEE,
          diagnosisFeeStatus: nextFeeStatus,
          diagnosisFeeBilling: repair.diagnosisFeeBilling ?? resolved.billing,
          customerBillingType: repair.customerBillingType ?? resolved.customerType,
          laborCost: 0,
          logisticsCost: 0,
          total: DIAGNOSIS_FEE,
          status: 'ready',
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? { ...r, ...stopped } : r))
        store.repairsRef.current = store.repairsRef.current.map(r => r.id === repairId ? { ...r, ...stopped } : r)
        // Raise the diagnosis-fee invoice now, unless the job is no-charge or the
        // fee is already settled.
        if (DIAGNOSIS_FEE > 0 && !alreadyPaid && !isRepairNoCharge(stopped) && !repair.invoiceId && !(repair as any).linkedInvoiceId) {
          void store.storeCtxRef.current!.createInvoiceFromRepair(repairId, false)
        }
        store.addAuditLog('stop_at_diagnosis', repairId, `Repair stopped at diagnosis — KES ${DIAGNOSIS_FEE} diagnosis fee ${alreadyPaid ? '(already paid)' : 'due (not credited against repairs)'}`)
        store.showToast(
          DIAGNOSIS_FEE <= 0
            ? 'Repair closed at diagnosis — no diagnosis fee'
            : alreadyPaid
              ? `Repair closed at diagnosis — diagnosis fee KES ${DIAGNOSIS_FEE.toLocaleString('en-KE')} already paid`
              : `Repair closed at diagnosis — KES ${DIAGNOSIS_FEE.toLocaleString('en-KE')} diagnosis fee due (not credited against repair)`,
        )
      },

    markDiagnosisFeePaid: (repairId, method) => {
        const user = store.currentUser()
        if (!user) return
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return
        const resolved = resolveDiagnosisFee(repair, store.systemSettings)
        if (resolved.amount <= 0) {
          store.showToast('No diagnosis fee on this job', 'error')
          return
        }
        if (isDiagnosisFeeSettled(repair)) {
          store.showToast('Diagnosis fee already marked paid')
          return
        }
        const canMark = userCan(user, 'repair.fee.mark_paid')
        if (!canMark) {
          store.showToast('Only sales, finance, admin officer, or a director can mark the diagnosis fee paid', 'error')
          return
        }
        const at = now()
        const payMethod = method?.trim() || 'cash'
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          diagnosisFee: resolved.amount,
          diagnosisFeeStatus: 'paid',
          diagnosisFeeBilling: r.diagnosisFeeBilling ?? resolved.billing,
          customerBillingType: r.customerBillingType ?? resolved.customerType,
          diagnosisFeePaidAt: at,
          diagnosisFeePaidBy: user.id,
          diagnosisFeePaidMethod: payMethod,
        } : r))
        store.addAuditLog(
          'diagnosis_fee_paid',
          repairId,
          `Diagnosis fee KES ${resolved.amount.toLocaleString('en-KE')} marked paid (${payMethod}) — not credited against repair bill`,
        )
        store.showToast(`Diagnosis fee KES ${resolved.amount.toLocaleString('en-KE')} recorded as paid`)
      },

    generateRepairQuote: async (repairId, incomingLines, applyVat = false) => {
        const user = store.currentUser()
        if (!user) return
        const repair = store.repairsRef.current.find(r => r.id === repairId)
        if (!repair) return
        if (store.blockIfOutsourced(repairId, 'update the repair quote')) return
        const canGenerate = userCan(user, 'repair.quote.generate') || repair.assignedTechnicianId === user.id
        if (!canGenerate) {
          store.showToast('Only the assigned technician or authorised staff can generate a quote', 'error'); return
        }
        const QUOTABLE_STATUSES = quotableStatusesForPath(repair.repairPath)
        // A sent quote still waiting on the customer may be corrected in place.
        const amendingSentQuote = isQuoteAwaitingApproval(repair.status) && !!repair.quote
        if (!QUOTABLE_STATUSES.includes(repair.status) && !amendingSentQuote) {
          store.showToast('Cannot generate a new quote at this stage', 'error'); return
        }
        if (!isDirectRepairPath(repair.repairPath) && !repairHasLoggedDiagnosis(repair)) {
          store.showToast('Log diagnosis before generating a quote or picking parts', 'error'); return
        }
        if (!incomingLines.length) {
          store.showToast('Add at least one quote line before generating a quote', 'error'); return
        }
        const invalidLine = incomingLines.find(line => !line.description?.trim?.() || Number(line.qty) <= 0 || Number(line.unitPrice) < 0)
        if (invalidLine) {
          store.showToast('Every quote line needs a description, quantity greater than zero, and a non-negative price', 'error'); return
        }
        const isUpdate = !!repair.quote
        const prevQuote = repair.quote
        const reopeningAfterDecline = isQuoteDeclinedReopenable(repair.status)
  
        // ── Gap 3: Reverse reserved stock on quote revision ───────────────────
        // If parts were already reserved (markPartsArrived ran), unreserve them
        // so stock is accurate before new parts are evaluated.
        if (isUpdate && prevQuote) {
          const reservedParts = repair.partsUsed?.filter(p => p.reservedDate && !p.usedDate) ?? []
          reservedParts.forEach(part => {
            const prod = store.prodRef.current.find(x => x.id === part.productId)
            if (!prod) return
            if (prod.requiresSerial) {
              // Return assigned serials back to available
              store.setSerials(prev => prev.map(s =>
                s.productId === part.productId && s.status === 'assigned' && s.repairId === repairId
                  ? { ...s, status: 'available' as const, repairId: undefined }
                  : s
              ))
            } else {
              // Restore bulk stock
              store.setBulkStock(prev => store.upsertBulkStock(prev, part.productId, 'repair_unit', part.qty))
              store.addMove(part.productId, part.productName, part.qty, 'in',
                `Stock unreserved — quote revision ${repair.ref}`, repair.ref, 'repair_unit', 'warehouse')
            }
          })
        }
  
        const resolvedFee = resolveDiagnosisFee(repair, store.systemSettings)
        // Fee stays on the quote for visibility but is never credited against labour/parts.
        // Fees already paid early still appear as a locked quote line (settled separately).
        const chargeFee = shouldChargeDiagnosisFee(repair) && resolvedFee.amount > 0
        const incomingWithFee = ensureDiagnosisFeeInQuoteLines(
          incomingLines.map(line => ({
            ...line,
            subtotal: Number(line.qty) * Number(line.unitPrice),
            isDiagnosisFee: isDiagnosisFeeLine(line as any) || undefined,
          })),
          resolvedFee.amount,
          chargeFee,
        )
  
        const lines: RepairQuoteLine[] = incomingWithFee.map(line => ({
          ...line,
          type: line.type as RepairQuoteLine['type'],
          id: uid(),
          reserved: false,
          isDiagnosisFee: isDiagnosisFeeLine(line) || undefined,
        }))
  
        const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
        // Diagnosis fee is always 0% VAT — tax only non-fee lines
        const tax = applyVat ? Math.round(taxableQuoteSubtotal(lines) * (store.companySettings.vatRate / 100)) : 0
  
        // ── Gap 1: Build change diff summary ─────────────────────────────────
        let changeSummary: string | undefined
        let prevTotal: number | undefined
        if (isUpdate && prevQuote) {
          prevTotal = prevQuote.total
          const fmtKesLocal = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0 })}`
          const diffLines: string[] = []
          const prevByDesc = new Map(prevQuote.lines.map(l => [l.description.toLowerCase(), l]))
          const newByDesc = new Map(incomingLines.map(l => [l.description.toLowerCase(), l]))
          // Removed lines
          prevQuote.lines.forEach(l => {
            if (!newByDesc.has(l.description.toLowerCase())) {
              diffLines.push(`Removed: ${l.description} (was ${fmtKesLocal(l.subtotal)})`)
            }
          })
          // Added lines
          incomingLines.forEach(l => {
            if (!prevByDesc.has(l.description.toLowerCase())) {
              diffLines.push(`Added: ${l.description} — ${l.qty} × ${fmtKesLocal(l.unitPrice)} = ${fmtKesLocal(l.subtotal)}`)
            }
          })
          // Modified lines
          incomingLines.forEach(l => {
            const prev = prevByDesc.get(l.description.toLowerCase())
            if (!prev) return
            if (prev.qty !== l.qty || prev.unitPrice !== l.unitPrice) {
              diffLines.push(`Changed: ${l.description} — ${fmtKesLocal(prev.subtotal)} → ${fmtKesLocal(l.subtotal)}${prev.qty !== l.qty ? ` (qty ${prev.qty}→${l.qty})` : ''}${prev.unitPrice !== l.unitPrice ? ` (price ${fmtKesLocal(prev.unitPrice)}→${fmtKesLocal(l.unitPrice)})` : ''}`)
            }
          })
          if (diffLines.length === 0) diffLines.push('No line-item changes — total updated')
          diffLines.push(`Total: ${fmtKesLocal(prevQuote.total)} → ${fmtKesLocal(subtotal + (applyVat ? Math.round(subtotal * (store.companySettings.vatRate / 100)) : 0))}`)
          if (reopeningAfterDecline) {
            diffLines.unshift(
              `Re-quote after customer decline${prevQuote.rejectionReason ? ` (“${prevQuote.rejectionReason}”)` : ''}`,
            )
          }
          changeSummary = diffLines.join('\n')
        } else if (reopeningAfterDecline && prevQuote) {
          prevTotal = prevQuote.total
          changeSummary = `Re-quote after customer decline${prevQuote.rejectionReason ? ` (“${prevQuote.rejectionReason}”)` : ''}`
        }
  
        const quote: RepairQuote = {
          id: uid(),
          lines,
          subtotal,
          tax,
          total: subtotal + tax,
          validUntil: '',
          sentDate: now(),
          diagnosisRevision: repair.diagnosis?.revision,
          diagnosisFaultSummary: repair.diagnosis?.faultDescription,
          ...(changeSummary ? { changeSummary, prevTotal } : {}),
        }
  
        const derivedLaborCost = lines.filter(l => l.type === 'labor').reduce((s, l) => s + l.subtotal, 0)
        const derivedLogisticsCost = lines.filter(l => l.type === 'logistics').reduce((s, l) => s + l.subtotal, 0)
  
        // Chained lookup: a dangling salesQuoteId (e.g. the local quote list was
        // rebuilt from the server) must fall through to the repair-link search,
        // otherwise a revision creates a brand-new quote → duplicate quotes.
        const existingSalesQuote = (repair.salesQuoteId ? store.quotes.find(q => q.id === repair.salesQuoteId) : undefined)
          ?? store.quotes.find(q => q.source === 'repair' && (q.repairId === repair.id || q.repairRef === repair.ref))
          ?? (repair.salesQuoteRef ? store.quotes.find(q => q.ref === repair.salesQuoteRef || q.quoteNumber === repair.salesQuoteRef) : undefined)
        // Even if the quote is missing from local state, an id recorded on the
        // repair means it exists server-side — update it instead of duplicating.
        const existingSalesQuoteId = existingSalesQuote?.id ?? repair.salesQuoteId
  
        // Resolve one durable repair quotation. Older repair blobs can lose
        // saleOrderId after refresh; the repair marker in notes survives and
        // lets a retry update the existing quotation instead of creating a new one.
        const preferredSaleOrderId =
          repair.saleOrderId ?? (repair as any).linkedSaleOrderId ?? existingSalesQuote?.saleOrderId
        const linkedSaleOrder = findSaleOrderForRepair(store.saleOrders as any[], {
          ...repair,
          saleOrderId: preferredSaleOrderId,
        })
        let linkedSaleOrderId = linkedSaleOrder?.id ?? preferredSaleOrderId
        let linkedSaleOrderRef =
          linkedSaleOrder?.ref
          ?? linkedSaleOrder?.orderNumber
          ?? repair.saleOrderRef
          ?? (repair as any).linkedSaleOrderRef
  
        const soLines = quote.lines.map(l => ({
          id: uid(),
          ...saleLineFieldsForRepairQuoteLine(l),
        }))
  
        // Full warranty / billing-exempt = company pays, so no client sign-off.
        // Direct Repair skips diagnosis only — its quote still goes to the
        // client for approval like any other.
        const isFullWarranty = repair.underWarranty && repair.warrantyCoverage === 'full'
        const isBillingExempt = isRepairBillingExempt(repair)
        const isNoCharge = isFullWarranty || isBillingExempt
        const chargeTotal = isNoCharge ? 0 : quote.total
        // Only full warranty + billing-exempt quotes are auto-approved.
        const quoteStatus: RepairStatus = isNoCharge ? 'approved' : 'awaiting_approval'
        if (isNoCharge) {
          quote.approvedDate = now()
          quote.approvedBy = isBillingExempt
            ? `No-charge (${normalizeBillingExemptReason(repair.billingExemptReason)}) — auto-approved`
            : 'Warranty (auto-approved)'
        }
  
        // A posted invoice on this job means the revision cannot flow into
        // billing yet: it waits for the client, then Finance credits and
        // reissues (lib/repair/invoice-reissue.ts). Until then the confirmed
        // sale order and the invoice stay as they are.
        const replacedInvoiceIds = new Set(repair.previousInvoiceIds ?? [])
        const liveInvoices = store.invoices.filter(inv => !replacedInvoiceIds.has(inv.id))
        const invoiceForReissue = (repair.invoiceId ? liveInvoices.find(inv => inv.id === repair.invoiceId) : undefined)
          ?? ((repair as any).linkedInvoiceId ? liveInvoices.find(inv => inv.id === (repair as any).linkedInvoiceId) : undefined)
          ?? liveInvoices.find(inv => inv.repairId === repair.id && inv.status !== 'cancelled')
        const invoiceReissue = isUpdate && !isNoCharge
          ? reissueOnRevision({
              invoice: invoiceForReissue,
              previousTotal: Number(prevQuote?.total ?? 0),
              revisedTotal: quote.total,
              now: now(),
              existing: repair.invoiceReissue,
            })
          : null
  
        if (invoiceReissue) {
          // Sale order is carried forward by the Finance reissue.
        } else if (linkedSaleOrderId) {
          const soPatch = {
            ...(isNoCharge
              ? { status: 'sale' as const, confirmedAt: linkedSaleOrder?.confirmedAt ?? new Date().toISOString(), reserveStock: false }
              : {}),
            lines: soLines,
            subtotal: quote.subtotal,
            taxAmount: quote.tax,
            taxTotal: quote.tax,
            totalAmount: chargeTotal,
            total: chargeTotal,
            notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
            source: 'repair',
            repairId: repair.id,
            repairRef: repair.ref,
          }
          // A paid revision sends the job back to the client, so the order in
          // Sales reopens as a quotation with it (the server checks nothing was
          // delivered or invoiced). No-charge jobs stay confirmed.
          const revisionPatch = isNoCharge ? soPatch : { ...soPatch, status: 'quotation' as const, repairRevision: true }
          store.setSaleOrders(p => p.map(s => s.id === linkedSaleOrderId ? { ...s, ...revisionPatch } : s))
          // Always push the revision to the server — even when the SO isn't in
          // local state (e.g. it was created by the customer-portal approval).
          // A refusal is shown: it used to be dropped, leaving Sales on the old
          // quote while the repair showed the new one.
          store.syncOrWarn(
            `/api/sale-orders/${linkedSaleOrderId}`,
            { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(revisionPatch) },
            message => store.showToast(`Quote saved on the repair, but Sales was not updated: ${message}`, 'error'),
            'Could not update the quotation in Sales',
          )
        } else if (chargeTotal >= 1) {
          const soId = uid()
          const autoConfirm = isNoCharge
          const soRef = await store.storeCtxRef.current!.allocateDocRef(autoConfirm ? 'SO' : 'QUO')
          const saleOrderRecord = {
            id: soId, ref: soRef, status: autoConfirm ? 'sale' as const : 'quotation' as const,
            ...(autoConfirm ? { confirmedAt: new Date().toISOString() } : {}),
            customerId: repair.customerId, customerName: repair.customerName,
            date: now(),
            lines: soLines, subtotal: quote.subtotal, taxTotal: quote.tax, total: chargeTotal,
            notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
            source: 'repair',
            repairId: repair.id,
            repairRef: repair.ref,
            createdByUserId: user.id,
          }
          store.setSaleOrders(p => [saleOrderRecord, ...p])
          sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleOrderRecord) })
          linkedSaleOrderId = soId
          linkedSaleOrderRef = soRef
        }
  
        // Push a Sales Quote so the repair quote appears in the Sales module
        const salesQuoteLines = quote.lines.map(l => ({
          id: uid(),
          productId: l.productId ?? '',
          productName: l.productName ?? l.description,
          sku: '',
          description: l.description,
          qty: l.qty,
          unit: saleLineFieldsForRepairQuoteLine(l).unit ?? 'pcs',
          listPrice: l.unitPrice,
          unitPrice: l.unitPrice,
          discount: 0,
          discountAmount: 0,
          taxRate: applyVat ? store.companySettings.vatRate : 0,
          taxAmount: applyVat ? Math.round(l.subtotal * (store.companySettings.vatRate / 100)) : 0,
          subtotal: l.subtotal,
          lineTotal: applyVat ? l.subtotal + Math.round(l.subtotal * (store.companySettings.vatRate / 100)) : l.subtotal,
        }))
        const isQuoteUpdate = !!existingSalesQuoteId
        // Never CREATE a sales quote below KES 1 (e.g. full-warranty repairs) —
        // updating an existing quote to a lower total is still allowed.
        const shouldPushSalesQuote = isQuoteUpdate || chargeTotal >= 1
        const salesQuoteId = shouldPushSalesQuote ? (existingSalesQuoteId ?? uid()) : undefined
        const salesQuoteRef = shouldPushSalesQuote
          ? (repair.salesQuoteRef ?? existingSalesQuote?.ref ?? existingSalesQuote?.quoteNumber ?? await store.storeCtxRef.current!.allocateDocRef('QUO'))
          : undefined
        const salesQuoteRecord = {
          ...existingSalesQuote,
          id: salesQuoteId,
          quoteNumber: existingSalesQuote?.quoteNumber ?? salesQuoteRef,
          ref: salesQuoteRef,
          clientId: repair.customerId,
          companyId: repair.customerId,
          companyName: repair.customerName,
          contactPersonId: repair.contactPersonId ?? repair.customerId,
          contactPersonName: repair.contactPersonName ?? repair.customerName,
          opportunityName: `Repair — ${repair.ref}`,
          ownerId: user.id,
          ownerName: user.name,
          status: isFullWarranty || isBillingExempt ? 'accepted' : 'sent',
          source: 'repair',
          repairId: repair.id,
          repairRef: repair.ref,
          lines: salesQuoteLines,
          subtotal: quote.subtotal,
          discountAmount: 0,
          discountPercent: 0,
          taxAmount: quote.tax,
          taxTotal: quote.tax,
          totalAmount: chargeTotal,
          total: chargeTotal,
          saleOrderId: linkedSaleOrderId,
          version: existingSalesQuoteId ? ((store.quotes.find(q => q.id === existingSalesQuoteId)?.version ?? 1) + 1) : 1,
          quoteDate: existingSalesQuote?.quoteDate ?? now(),
          issueDate: now(),
          validUntil: quote.validUntil,
          sentDate: now(),
          viewCount: existingSalesQuote?.viewCount ?? 0,
          createdBy: user.id,
          createdByName: user.name,
          createdAt: existingSalesQuote?.createdAt ?? now(),
          updatedAt: now(),
        }
        if (isQuoteUpdate) {
          // Upsert locally — the quote may be absent from local state if the
          // list was rebuilt from the server after the original POST failed.
          store.setQuotes(p => (p.some(q => q.id === existingSalesQuoteId)
            ? p.map(q => q.id === existingSalesQuoteId ? { ...q, ...salesQuoteRecord } : q)
            : [salesQuoteRecord as unknown as Quote, ...p]) as Quote[])
          // PUT the revision; if the quote never reached the server, create it.
          fetch(`/api/quotes/${existingSalesQuoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(salesQuoteRecord) })
            .then(res => {
              if (res.status === 404) {
                return fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(salesQuoteRecord) })
              }
              return res
            })
            .catch(() => {})
        } else if (shouldPushSalesQuote) {
          store.setQuotes(p => [salesQuoteRecord as unknown as Quote, ...p])
          sync('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(salesQuoteRecord) })
        }
  
        const existingInvoice = (repair.invoiceId ? liveInvoices.find(inv => inv.id === repair.invoiceId) : undefined)
          ?? ((repair as any).linkedInvoiceId ? liveInvoices.find(inv => inv.id === (repair as any).linkedInvoiceId) : undefined)
          ?? (existingSalesQuote?.invoiceId ? liveInvoices.find(inv => inv.id === existingSalesQuote.invoiceId) : undefined)
          ?? liveInvoices.find(inv =>
            inv.repairId === repair.id ||
            (!!linkedSaleOrderId && inv.saleOrderId === linkedSaleOrderId) ||
            inv.notes?.includes(repair.ref)
          )
        // An invoice id recorded on the repair means one exists server-side even
        // when it is missing from local state — always patch it on revision.
        const invoiceIdToUpdate = existingInvoice?.id ?? repair.invoiceId ?? (repair as any).linkedInvoiceId
        // A posted invoice is never rewritten: the revision waits for the
        // client, then Finance credits it and reissues. Only drafts follow.
        if (isUpdate && invoiceIdToUpdate && !invoiceReissue) {
          const invoiceLines: InvoiceLine[] = quote.lines.map(l => ({
            id: uid(),
            productId: l.productId,
            description: `[${l.type.toUpperCase()}] ${l.description}`,
            qty: l.qty,
            unitPrice: l.unitPrice,
            taxRate: quote.tax > 0 ? store.companySettings.vatRate : 0,
            subtotal: l.subtotal,
          }))
          const revisionNote = changeSummary ? `Repair quote revision ${repair.ref}:\n${changeSummary}` : `Repair quote revised: ${repair.ref}`
          const invoicePatch = {
            lines: invoiceLines,
            subtotal: quote.subtotal,
            taxTotal: quote.tax,
            taxAmount: quote.tax,
            total: chargeTotal,
            totalAmount: chargeTotal,
            repairId: repair.id,
          }
          store.setInvoices(p => p.map(inv => inv.id === invoiceIdToUpdate ? {
            ...inv,
            ...invoicePatch,
            saleOrderId: linkedSaleOrderId ?? inv.saleOrderId,
            notes: `${inv.notes ?? ''}\n${revisionNote}`.trim(),
          } : inv))
          sync(`/api/invoices/${invoiceIdToUpdate}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...invoicePatch, ...(linkedSaleOrderId ? { saleOrderId: linkedSaleOrderId } : {}) }),
          })
        }
  
        // ── Gap 2: Handle orphaned procurement requests on revision ──────────
        // Cancel pending/ordered procurement requests and their linked draft POs
        // when the quote changes. New missing parts will trigger fresh requests
        // when the revised quote is approved.
        if (isUpdate && prevQuote) {
          const newPartIds = new Set(lines.filter(l => l.type === 'part' && l.productId).map(l => l.productId!))
          const prevPartIds = new Set(prevQuote.lines.filter(l => l.type === 'part' && l.productId).map(l => l.productId!))
          // Cancel requests for parts removed from the quote
          const removedPartIds = [...prevPartIds].filter(id => !newPartIds.has(id))
          const requestsToCancel = (repair.procurementRequests ?? []).filter(req =>
            ['pending', 'ordered'].includes(req.status) &&
            req.items.some(i => removedPartIds.includes(i.productId))
          )
          if (requestsToCancel.length > 0) {
            const cancelIds = new Set(requestsToCancel.map(r => r.id))
            // Cancel linked draft POs that have no vendor assigned yet
            store.setPurchaseOrders(prev => prev.map(po => {
              if (!po.repairId || po.repairId !== repairId) return po
              if (!po.procurementRequestId || !cancelIds.has(po.procurementRequestId)) return po
              if (po.status !== 'draft' || po.vendorId) return po
              const updated = { ...po, status: 'cancelled' as const }
              sync(`/api/purchase-orders/${po.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
              return updated
            }))
          }
        }
  
        const savedRepair: RepairOrder = {
          ...repair,
          quote,
          laborCost: derivedLaborCost,
          logisticsCost: derivedLogisticsCost,
          total: chargeTotal,
          diagnosisFee: chargeFee ? resolvedFee.amount : (repair.diagnosisFeeStatus === 'waived' ? 0 : repair.diagnosisFee),
          diagnosisFeeStatus: chargeFee
            ? (repair.diagnosisFeeStatus === 'paid' || repair.diagnosisFeePaidAt ? 'paid' : 'applicable')
            : (isDirectRepairPath(repair.repairPath) || isNoCharge ? 'not_applicable' : repair.diagnosisFeeStatus),
          diagnosisFeeBilling: repair.diagnosisFeeBilling ?? resolvedFee.billing,
          customerBillingType: repair.customerBillingType ?? resolvedFee.customerType,
          deviceTier: resolvedFee.tier ?? repair.deviceTier,
          status: quoteStatus,
          quoteApprovalDeadline: undefined,
          ...(invoiceReissue ? { invoiceReissue } : {}),
          ...(linkedSaleOrderId ? { saleOrderId: linkedSaleOrderId, saleOrderRef: linkedSaleOrderRef } : {}),
          ...(salesQuoteId ? { salesQuoteId, salesQuoteRef } : {}),
          ...(invoiceIdToUpdate ? { invoiceId: invoiceIdToUpdate } : {}),
          ...(isUpdate ? {
            partsUsed: [],
            procurementRequests: (repair.procurementRequests ?? []).map(req =>
              ['pending', 'ordered'].includes(req.status) ? { ...req, status: 'cancelled' as const } : req
            ),
          } : {}),
        }
        store.repairsRef.current = store.repairsRef.current.map(r => r.id === repairId ? savedRepair : r)
        store.setRepairs(p => p.map(r => r.id === repairId ? savedRepair : r))
  
        if (isFullWarranty) {
          store.notifyUsers({
            recipientRoles: ['finance_officer'],
            recipients: [
              repair.assignedTechnicianId,
              ...userIdsWithRoles(store.users, ['finance_officer']),
            ],
            type: 'repair',
            title: `Warranty repair approved: ${repair.ref}`,
            body: `${repair.productName} (${repair.customerName}) is fully covered under warranty. Quote auto-approved — KES 0 charge.`,
            module: 'repair', path: `?id=${repair.id}`, icon: '🛡️',
            entityKey: `repair:${repair.id}:warranty_approved`,
            excludeUserId: store.currentUserId,
          })
          store.syncRepairToPortal({ ...repair, quote, status: 'approved', total: 0 }, 'Repair is fully covered under warranty — no charge')
          store.addAuditLog('generate_quote', repairId, `Warranty quote auto-approved (full coverage): KES 0`)
          store.showToast('Quote auto-approved — repair is fully covered under warranty')
        } else {
          const coverageLabel = repair.underWarranty ? (repair.warrantyCoverage === 'partial' ? ' (partial warranty — uncovered items)' : ' (warranty voided — client pays)') : ''
          const portalMsg = reopeningAfterDecline
            ? `Revised quote after your previous decline — new total KES ${chargeTotal.toLocaleString('en-KE')}. Please review and approve.`
            : isUpdate
              ? `Quote revised — new total KES ${chargeTotal.toLocaleString('en-KE')}. Please review and re-approve.`
              : 'Quote sent — awaiting your approval'
          store.syncRepairToPortal({ ...repair, quote, laborCost: derivedLaborCost, logisticsCost: derivedLogisticsCost, total: chargeTotal, status: 'awaiting_approval' }, portalMsg)
          const auditDetail = isUpdate && changeSummary
            ? `Quote revised: KES ${prevQuote?.total ?? 0} → KES ${quote.total}\n${changeSummary}`
            : `Quote ${isUpdate ? 'updated' : 'generated'}${coverageLabel}: KES ${quote.total}`
          store.addAuditLog(isUpdate ? 'update_quote' : 'generate_quote', repairId, auditDetail)
          let customerNotified = false
          if (repair.customerEmail || repair.customerPhone) {
            const trackingUrl = typeof window !== 'undefined'
              ? `${window.location.origin}/portal/repair/${encodeURIComponent(repair.ref)}`
              : undefined
            try {
              const notifyResponse = await fetch('/api/notifications/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'quote',
                  repairRef: repair.ref,
                  quoteTotal: quote.total,
                  quoteUrl: trackingUrl,
                  changeSummary,
                  isRevision: isUpdate,
                  idempotencyKey: `repair-quote:${repair.id}:${quote.id}`,
                  channels: ['email', 'whatsapp', 'sms'],
                }),
              })
              const notifyResult = await notifyResponse.json().catch(() => null)
              customerNotified = Boolean(notifyResponse.ok && notifyResult?.success)
            } catch {
              customerNotified = false
            }
          }
          store.showToast(
            customerNotified
              ? reopeningAfterDecline
                ? 'Revised quote sent after decline — customer re-notified for approval'
                : isUpdate
                  ? 'Quote updated — customer re-notified for approval'
                  : 'Quote generated — customer notified for approval'
              : (repair.customerEmail || repair.customerPhone)
                ? (isUpdate ? 'Quote updated, but customer notification could not be confirmed' : 'Quote generated, but customer notification could not be confirmed')
                : (isUpdate ? 'Quote updated — no customer email or phone is available' : 'Quote generated — no customer email or phone is available'),
            customerNotified ? 'success' : 'info',
          )
        }
  
        // Say what the re-price means for documents already raised from this job.
        // Going back a stage and re-quoting is allowed and usually has nothing to
        // do with money — but when it does, a confirmed sale order or a posted
        // invoice quietly stops agreeing with the quote, and until now nothing
        // mentioned it. The system cannot edit those itself, so the least it can
        // do is name the follow-up at the moment the price moves.
        if (isUpdate && prevQuote) {
          const impact = repairPriceChangeImpact({
            previousTotal: prevQuote.total,
            nextTotal: quote.total,
            saleOrder: findSaleOrderForRepair(store.soRef.current, repair),
            invoice: repair.invoiceId
              ? store.invRef.current.find(inv => inv.id === repair.invoiceId)
              : store.invRef.current.find(inv => inv.repairId === repair.id),
          })
          if (invoiceReissue) {
            store.showToast(`${invoiceReissue.invoiceRef || 'The invoice'} is already posted, so it is not changed. When the client approves the revised quote, Finance will credit it and reissue.`, 'info')
          } else if (impact.impacts.length > 0) {
            store.showToast(describeRepairPriceChange(impact), impact.needsAttention ? 'error' : 'info')
          }
        }
  
        return quote
      },

    sendQuoteToCustomer: async (repairId) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair?.quote) { store.showToast('No quote to send', 'error'); return }
        
        // Update status to awaiting approval
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: 'awaiting_approval',
        } : r))
        
        store.addAuditLog('send_quote', repair.ref, `Quote sent to ${repair.customerName}`)
        
        // Send via the available customer channel: email now, phone messaging fallback.
        if (repair.customerEmail || repair.customerPhone) {
          try {
            const portalUrl = process.env.NEXT_PUBLIC_APP_URL 
              ? `${process.env.NEXT_PUBLIC_APP_URL}/portal/quotes/${repair.id}`
              : undefined
  
            const response = await fetch('/api/notifications/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'quote',
                customerName: repair.customerName,
                customerEmail: repair.customerEmail,
                customerPhone: repair.customerPhone,
                channels: repair.customerEmail ? ['email'] : undefined,
                repairRef: repair.ref,
                deviceName: repair.productName,
                quoteTotal: repair.quote.total,
                quoteUrl: portalUrl
              })
            })
  
            const result = await response.json()
  
            if (result.success) {
              const sentChannel = result.results?.email?.success ? 'EMAIL' : result.channel?.toUpperCase()
              store.showToast(`Quote sent to ${repair.customerName} via ${sentChannel || 'notification'}`, 'success')
            } else {
              store.showToast(`Quote sent • Notification failed: ${result.error}`, 'error')
            }
          } catch {
            store.showToast('Quote sent • Notification error', 'error')
          }
        } else {
          store.showToast(`Quote prepared • No email or phone number for ${repair.customerName}`, 'info')
        }
      },

    approveRepairQuote: async (repairId, approved, reason) => {
        const foundRepair = store.repairs.find(r => r.id === repairId)
        if (!foundRepair?.quote) return
        // A revision on an already-invoiced job: the client's answer decides
        // whether Finance reissues (approved) or the old invoice stands.
        const reissueDecided = foundRepair.invoiceReissue?.status === 'awaiting_client'
          ? reissueAfterClientDecision(foundRepair.invoiceReissue, approved, now())
          : foundRepair.invoiceReissue
        const repair = reissueDecided === foundRepair.invoiceReissue ? foundRepair : { ...foundRepair, invoiceReissue: reissueDecided }
        // Sale order and invoice are carried forward by the Finance reissue.
        const soFrozenForReissue = reissueDecided?.status === 'pending'
        if (reissueDecided !== foundRepair.invoiceReissue) {
          store.setRepairs(p => p.map(r => r.id === repairId ? { ...r, invoiceReissue: reissueDecided } : r))
          if (reissueDecided?.status === 'pending') {
            store.notifyUsers({
              recipientRoles: ['finance_officer', 'director'],
              recipients: userIdsWithRoles(store.users, ['finance_officer', 'director'], store.currentUserId),
              type: 'repair',
              title: `Reissue invoice ${reissueDecided.invoiceRef} — ${repair.ref}`,
              body: `The client approved a revised quote (KES ${reissueDecided.previousTotal.toLocaleString('en-KE')} → ${reissueDecided.revisedTotal.toLocaleString('en-KE')}). Credit ${reissueDecided.invoiceRef} and reissue from the repair before it is released.`,
              module: 'repair', path: `?id=${repair.id}`, icon: '🧾',
              entityKey: `repair:${repair.id}:invoice_reissue:${reissueDecided.invoiceId}`,
              excludeUserId: store.currentUserId,
            })
          }
        }
        
        if (!approved) {
          // The same stamp the Decline action makes. Without it this path left
          // the fee unset, so the job could not be billed for the diagnosis
          // that was already done.
          const feePatch = diagnosisFeeExitPatch(repair, store.systemSettings)
          store.setRepairs(p => p.map(r => r.id === repairId ? {
            ...r,
            quote: {
              ...r.quote!,
              rejectedDate: now(),
              rejectionReason: reason,
            },
            status: 'declined',
            ...feePatch,
          } : r))
  
          store.addAuditLog(
            'reject_quote',
            repairId,
            `Quote rejected: ${reason || 'No reason provided'}${feePatch.diagnosisFee && feePatch.diagnosisFeeStatus !== 'paid' ? ` — diagnosis fee KES ${feePatch.diagnosisFee} still due` : ''}`,
          )
          store.showToast(
            feePatch.diagnosisFee && feePatch.diagnosisFeeStatus !== 'paid'
              ? `Quote rejected — diagnosis fee KES ${feePatch.diagnosisFee.toLocaleString('en-KE')} still to bill`
              : 'Quote rejected — repair job declined',
          )
          return
        }
        
        // Reserve parts from inventory
        const partLines = repair.quote!.lines.filter(line => line.type === 'part')
        let allPartsAvailable = true
        
        for (const line of partLines) {
          if (!line.productId) continue
          
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) continue
          
          if (product.requiresSerial) {
            const availableSerials = store.serialRef.current.filter(s => 
              s.productId === line.productId && 
              s.status === 'available' && 
              (s.location === 'warehouse' || s.location === 'shop' || s.location === 'repair_unit')
            )
            
            if (availableSerials.length < line.qty) {
              allPartsAvailable = false
              store.showToast(`Insufficient stock for ${product.name}`, 'error')
              break
            }
          } else {
            const stock = store.calcStockByLocation(product, store.serialRef.current, store.bulkStock, product.id)
            const available = stock.warehouse + stock.shop + stock.repair_unit
            
            if (available < line.qty) {
              allPartsAvailable = false
              store.notifyUsers({
                recipientRoles: ['technical_lead', 'inventory_officer'],
                recipients: userIdsWithRoles(store.users, ['technical_lead', 'inventory_officer'], store.currentUserId),
                type: 'repair',
                title: 'Part needed for repair',
                body: `${repair.ref} — ${product.name} × ${line.qty} (only ${available} in stock)`,
                module: 'repair',
                path: `?id=${repair.id}`,
                icon: '🔧',
                entityKey: `repair:${repair.id}:part_oos:${line.productId}`,
                excludeUserId: store.currentUserId,
              })
              store.showToast(`Insufficient stock for ${product.name}`, 'error')
              break
            }
          }
        }
        
        if (!allPartsAvailable) {
          // Client approved but parts are missing — move to awaiting_parts and auto-request procurement
          const missingItems = partLines.filter(line => {
            if (!line.productId) return false
            const product = store.prodRef.current.find(p => p.id === line.productId)
            if (!product) return false
            if (product.requiresSerial) {
              const available = store.serialRef.current.filter(s => s.productId === line.productId && s.status === 'available').length
              return available < line.qty
            } else {
              const stock = store.calcStockByLocation(product, store.serialRef.current, store.bulkStock, product.id)
              return (stock.warehouse + stock.shop + stock.repair_unit) < line.qty
            }
          }).map(line => ({
            productId: line.productId,
            productName: line.productName || line.description,
            qty: line.qty,
            description: `Auto-procurement for repair ${repair.ref}`,
          }))
  
          // Mark quote as approved by client but repair is waiting on parts
          store.setRepairs(p => p.map(r => r.id === repairId ? {
            ...r,
            status: 'awaiting_parts',
            quote: { ...r.quote!, approvedDate: now(), approvedBy: 'customer' },
          } : r))
          store.syncRepairToPortal({ ...repair, status: 'awaiting_parts' }, 'Quote approved — sourcing parts')
  
          if (missingItems.length > 0) {
            const procRef = allocateDocNumberSync('PROC')
            const newProc = {
              id: uid(), ref: procRef, repairId, repairRef: repair.ref,
              requestedBy: repair.assignedTechnicianId ?? repair.createdBy,
              requestedByName: repair.assignedTechnicianName ?? repair.bookedByName ?? 'System',
              requestedDate: now(), urgency: 'high', status: 'pending' as const,
              notes: `Auto-generated — parts needed for approved quote on ${repair.ref}`,
              items: missingItems.map(item => ({
                type: 'part', productId: item.productId ?? '', productName: item.productName,
                description: item.description, qty: String(item.qty), estimatedCost: '', supplier: '',
              })),
            }
            store.setRepairs(p => p.map(r => r.id === repairId ? {
              ...r, procurementRequests: [...(r.procurementRequests ?? []), newProc],
            } : r))
  
            // Repair records demand only. Procurement owns supplier selection
            // and Purchase Order creation from this approved request.
  
            store.notifyUsers({
              recipientRoles: ['technical_lead', 'inventory_officer'],
              recipients: userIdsWithRoles(store.users, ['technical_lead', 'inventory_officer'], store.currentUserId),
              type: 'repair',
              title: `Parts needed: ${repair.ref}`,
              body: `Client approved quote. ${missingItems.length} part(s) need procurement before repair can start.`,
              module: 'repair', path: `?id=${repair.id}`, icon: '📦',
              entityKey: `repair:${repair.id}:parts_needed`,
              excludeUserId: store.currentUserId,
            })
            store.showToast('Quote approved — parts sourcing required before repair can start', 'info')
          }
  
          // Approval converts the repair quotation into the existing Sales Order.
          // Do not create an invoice while parts are still being sourced.
          let awaitingSoId = repair.saleOrderId ?? (repair as any).linkedSaleOrderId
          let awaitingSoRef = repair.saleOrderRef ?? (repair as any).linkedSaleOrderRef
          const linkedAwaitingSo = findSaleOrderForRepair(store.soRef.current, repair)
          awaitingSoId = linkedAwaitingSo?.id ?? awaitingSoId
          awaitingSoRef = linkedAwaitingSo?.ref ?? linkedAwaitingSo?.orderNumber ?? awaitingSoRef
          const approvedSoLines = repair.quote!.lines.map(l => ({
            id: uid(),
            ...saleLineFieldsForRepairQuoteLine(l),
          }))
          if (!awaitingSoId) {
            awaitingSoId = uid()
            awaitingSoRef = await store.storeCtxRef.current!.allocateDocRef('SO')
            const awaitingSo: SaleOrder = {
            id: awaitingSoId, ref: awaitingSoRef, status: 'sale', confirmedAt: new Date().toISOString(),
            customerId: repair.customerId, customerName: repair.customerName,
            date: now(),
              lines: approvedSoLines,
              subtotal: repair.quote!.subtotal, taxTotal: repair.quote!.tax, total: repair.quote!.total,
              notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
              source: 'repair', repairId: repair.id, repairRef: repair.ref,
              createdByUserId: repair.createdBy,
            }
            store.setSaleOrders(p => [awaitingSo, ...p])
            sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(awaitingSo) })
          } else {
            const soPatch = {
              status: 'sale' as const,
              confirmedAt: linkedAwaitingSo?.confirmedAt ?? new Date().toISOString(),
              reserveStock: false,
              lines: approvedSoLines,
              subtotal: repair.quote!.subtotal,
              taxAmount: repair.quote!.tax,
              taxTotal: repair.quote!.tax,
              totalAmount: repair.quote!.total,
              total: repair.quote!.total,
              notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
              source: 'repair', repairId: repair.id, repairRef: repair.ref,
            }
            if (!soFrozenForReissue) {
              store.setSaleOrders(p => p.map(order => order.id === awaitingSoId ? { ...order, ...soPatch } : order))
              sync(`/api/sale-orders/${awaitingSoId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(soPatch) })
            }
          }
  
          const approvedRepair = {
            ...repair,
            status: 'awaiting_parts' as const,
            quote: { ...repair.quote!, approvedDate: repair.quote!.approvedDate ?? now(), approvedBy: repair.quote!.approvedBy ?? 'customer' },
            saleOrderId: awaitingSoId,
            saleOrderRef: awaitingSoRef,
          }
          store.repairsRef.current = store.repairsRef.current.map(r => r.id === repairId ? approvedRepair : r)
          store.setRepairs(p => p.map(r => r.id === repairId ? approvedRepair : r))
  
          const approvedSalesQuote = findSalesQuoteForRepair(store.quotes, repair)
          if (approvedSalesQuote) {
            store.setQuotes(p => {
              const next = p.map(q => q.id === approvedSalesQuote.id ? {
                ...q,
                status: 'accepted' as const,
                saleOrderId: awaitingSoId ?? q.saleOrderId,
                acceptedDate: q.acceptedDate ?? now(),
                convertedDate: q.convertedDate ?? now(),
              } : q)
              const updated = next.find(q => q.id === approvedSalesQuote.id)
              if (updated) sync(`/api/quotes/${approvedSalesQuote.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
              return next
            })
          }
          return
        }
        
        // Reserve parts — transfer bulk into repair_unit + assign serials
        const updatedLines = repair.quote!.lines.map(line => ({
          ...line,
          reserved: line.type === 'part',
        }))
  
        const reserveLines = partLines
          .filter(line => line.productId)
          .map(line => {
            const product = store.prodRef.current.find(p => p.id === line.productId)
            return {
              productId: line.productId!,
              productName: line.productName ?? line.description,
              qty: line.qty,
              requiresSerial: Boolean(product?.requiresSerial),
            }
          })
        const reservePlan = planRepairPartReserve({
          repairRef: repair.ref,
          lines: reserveLines,
          stockFor: (productId) => {
            const product = store.prodRef.current.find(p => p.id === productId)
            const locs = store.calcStockByLocation(product, store.serialRef.current, store.bulkStock, productId)
            return { warehouse: locs.warehouse, shop: locs.shop, repair_unit: locs.repair_unit }
          },
          availableSerialsFor: (productId) => store.serialRef.current
            .filter(s => s.productId === productId && s.status === 'available'
              && (s.location === 'warehouse' || s.location === 'shop' || s.location === 'repair_unit'))
            .map(s => ({ id: s.id, serial: s.serial, location: s.location })),
        })
        applyReserveSteps(reservePlan.steps, repairId, repair.ref)
  
        const partsUsedNow = partLines.map(line => ({
          productId: line.productId ?? '',
          productName: line.productName ?? line.description,
          qty: line.qty,
          price: line.unitPrice,
          reservedDate: now(),
        }))
  
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          quote: {
            ...r.quote!,
            approvedDate: now(),
            approvedBy: 'customer',
            lines: updatedLines,
          },
          status: 'approved',
          partsUsed: partsUsedNow,
        } : r))
  
        // Confirm the existing commercial lineage only. Approval must never
        // create an invoice; the invoice is created from this SO after QC/Ready.
        const soLines = repair.quote!.lines.map(l => ({
          id: uid(),
          ...saleLineFieldsForRepairQuoteLine(l),
        }))
  
        let soId: string
        let soRef: string
        const linkedApprovedSo = findSaleOrderForRepair(store.soRef.current, repair)
        const presetSoId = linkedApprovedSo?.id ?? repair.saleOrderId ?? (repair as any).linkedSaleOrderId
        const presetSoRef = linkedApprovedSo?.ref ?? linkedApprovedSo?.orderNumber ?? repair.saleOrderRef ?? (repair as any).linkedSaleOrderRef
        if (presetSoId) {
          soId = presetSoId
          soRef = presetSoRef ?? repair.ref
          const soPatch = {
            status: 'sale' as const,
            confirmedAt: linkedApprovedSo?.confirmedAt ?? new Date().toISOString(),
            reserveStock: false,
            lines: soLines,
            subtotal: repair.quote!.subtotal,
            taxAmount: repair.quote!.tax,
            taxTotal: repair.quote!.tax,
            totalAmount: repair.quote!.total,
            total: repair.quote!.total,
            notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
            source: 'repair',
            repairId: repair.id,
            repairRef: repair.ref,
          }
          if (!soFrozenForReissue) {
            store.setSaleOrders(p => p.map(order => order.id === soId ? { ...order, ...soPatch } : order))
            sync(`/api/sale-orders/${soId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(soPatch) })
          }
        } else {
          soId = uid()
          soRef = await store.storeCtxRef.current!.allocateDocRef('SO')
          const newSo: SaleOrder = {
            id: soId, ref: soRef, status: 'sale', confirmedAt: new Date().toISOString(),
            customerId: repair.customerId, customerName: repair.customerName,
            date: now(),
            lines: soLines, subtotal: repair.quote!.subtotal, taxTotal: repair.quote!.tax, total: repair.quote!.total,
            notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
            source: 'repair', repairId: repair.id, repairRef: repair.ref,
            createdByUserId: repair.createdBy,
          }
          store.setSaleOrders(p => [newSo, ...p])
          sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSo) })
        }
  
        const approvedRepair = {
          ...repair,
          quote: {
            ...repair.quote!,
            approvedDate: repair.quote!.approvedDate ?? now(),
            approvedBy: repair.quote!.approvedBy ?? 'customer',
            lines: updatedLines,
          },
          status: 'approved' as const,
          partsUsed: partsUsedNow,
          saleOrderId: soId,
          saleOrderRef: soRef,
        }
        store.repairsRef.current = store.repairsRef.current.map(row => row.id === repairId ? approvedRepair : row)
        store.setRepairs(p => p.map(row => row.id === repairId ? approvedRepair : row))
  
        const approvedSalesQuote = findSalesQuoteForRepair(store.quotes, repair)
        if (approvedSalesQuote) {
          store.setQuotes(p => {
            const next = p.map(q => q.id === approvedSalesQuote.id ? {
              ...q,
              status: 'accepted' as const,
              saleOrderId: soId,
              acceptedDate: q.acceptedDate ?? now(),
              convertedDate: q.convertedDate ?? now(),
            } : q)
            const updated = next.find(q => q.id === approvedSalesQuote.id)
            if (updated) sync(`/api/quotes/${approvedSalesQuote.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return next
          })
        }
  
        store.addAuditLog('approve_quote', repairId, `Quote approved → ${soRef}; invoice deferred until repair is Ready`)
        store.showToast(`Quote approved — ${soRef} confirmed. Invoice will be created after QC when the repair is Ready.`)
      },

    startRepair: (repairId) => {
        const user = store.currentUser()
        if (!user) return
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return
        if (store.blockIfOutsourced(repairId, 'start repair work')) return
        const isAssignedTech = repair.assignedTechnicianId === user.id
        if (!isAssignedTech) {
          store.showToast('Only the assigned technician can start the repair', 'error'); return
        }
        // Diagnosis First needs quote approval; Direct Repair / billing-exempt may start earlier
        const validStartStatuses = (
          isRepairBillingExempt(repair)
            ? startableStatusesWhenBillingExempt()
            : startableStatusesForPath(repair.repairPath)
        ) as RepairStatus[]
        if (!validStartStatuses.includes(repair.status)) {
          store.showToast(
            isRepairBillingExempt(repair) || isDirectRepairPath(repair.repairPath)
              ? 'Repair cannot start at this stage'
              : 'Client must approve the quote before repair can start',
            'error',
          )
          return
        }
        const defaultQA = repair.qcItems.length === 0 ? buildDefaultRepairQcItems(uid) : []
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: 'in_repair',
          repairStartDate: now(),
          ...(defaultQA.length ? { qcItems: defaultQA } : {}),
        } : r))
  
        store.syncRepairToPortal({ ...repair, status: 'in_repair', repairStartDate: now() }, 'Repair in progress')
        store.addAuditLog('start_repair', repairId, 'Repair work started')
        store.showToast('Repair work started')
      },

    markRepairComplete: (repairId) => {
        const user = store.currentUser()
        if (!user) return
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return
        if (store.blockIfOutsourced(repairId, 'move to QC')) return
        if (repair.assignedTechnicianId !== user.id) {
          store.showToast('Only the assigned technician can mark the repair as complete', 'error'); return
        }
        if (repair.status !== 'in_repair') {
          store.showToast('Repair must be in progress to mark complete', 'error'); return
        }
  
        const completedAt = now()
        // Seed defaults if missing; clear prior pass ticks so re-QC cannot skip old checks
        const qcItems = prepareRepairQcItemsForRound(repair.qcItems, uid)
        const updated: RepairOrder = {
          ...repair,
          status: 'qc',
          repairCompletedDate: completedAt,
          qcItems,
          qcFailReason: undefined,
          qcFailedDate: undefined,
          qcFailedBy: undefined,
          qcPassedDate: undefined,
          qcApprovedBy: undefined,
          statusHistory: [
            ...(repair.statusHistory ?? []),
            { status: 'qc', date: completedAt, note: 'Repair complete — undergoing quality check', by: user.name },
          ],
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? updated : r))
        store.syncRepairToPortal(updated, 'Repair complete — undergoing quality check')
        store.addAuditLog('complete_repair', repairId, 'Technician marked repair complete — awaiting QC')
        store.showToast('Repair marked complete — QC can now proceed')
      },

    addRepairQAItem: (repairId, description) => {
        const qaItem: RepairQAItem = {
          id: uid(),
          description,
          passed: false,
        }
        
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          qcItems: [...(r.qcItems ?? []), qaItem],
        } : r))
      },

    completeRepairQA: (repairId, qaResults, failReason) => {
        const user = store.currentUser()
        if (!user) return
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return
        if (store.blockIfOutsourced(repairId, 'perform QC')) return
        if (repair.status !== 'qc') {
          store.showToast('Repair must be in QC to complete quality check', 'error'); return
        }
        // Directors/leads can always QA; technicians (and users acting as one) can QA any repair they did NOT work on
        const isAuthorized = userCan(user, 'repair.lead')
          || (isRepairTechActor(user) && repair.assignedTechnicianId !== user.id)
        if (!isAuthorized) {
          store.showToast('You cannot perform QA on a repair you worked on — a different technician must do QC', 'error'); return
        }
  
        const testedAt = now()
        const baseItems = (repair.qcItems?.length
          ? repair.qcItems
          : buildDefaultRepairQcItems(uid))
        const anyIdMatch = qaResults.some(res => baseItems.some(item => item.id === res.itemId))
        const updatedQCItems: RepairQAItem[] = anyIdMatch
          ? baseItems.map(item => {
              const result = qaResults.find(res => res.itemId === item.id)
              return result ? {
                ...item,
                passed: !!result.passed,
                testedBy: user.name,
                testedDate: testedAt,
                notes: result.notes,
              } : { ...item, passed: false, testedBy: user.name, testedDate: testedAt }
            })
          : (qaResults.length > 0
            ? qaResults.map(res => ({
                id: res.itemId || uid(),
                description: res.description || 'QC check',
                passed: !!res.passed,
                testedBy: user.name,
                testedDate: testedAt,
                notes: res.notes,
              }))
            : baseItems.map(item => ({
                ...item,
                passed: false,
                testedBy: user.name,
                testedDate: testedAt,
              })))
  
        // Never auto-pass an empty checklist
        const allPassed = updatedQCItems.length > 0 && updatedQCItems.every(item => item.passed)
        const failedSummary = summarizeFailedQcItems(updatedQCItems)
        const trimmedFailReason = String(failReason ?? '').trim()
  
        if (!allPassed && !trimmedFailReason) {
          store.showToast('A fail reason is required when QC does not pass', 'error')
          return
        }
  
        if (allPassed) {
          const partsToConsume = repair.partsUsed.filter(part => part.reservedDate && !part.usedDate) || []
          // The Settings toggle must actually gate consumption.
          const consumptionEnabled = store.systemSettings.repPartsConsumption !== false
          const consumeLines = consumptionEnabled ? partsToConsume.map(part => {
            const product = store.prodRef.current.find(p => p.id === part.productId)
            return {
              productId: part.productId,
              productName: part.productName,
              qty: part.qty,
              requiresSerial: Boolean(product?.requiresSerial),
            }
          }) : []
          // Apply consume plan against a mutable local stock snapshot so multi-line
          // deductions don't over-allocate the same units in one QC pass.
          const localBulk = store.bulkStock.map(l => ({ ...l }))
          const consumePlan = planRepairPartConsume({
            repairRef: repair.ref,
            lines: consumeLines,
            stockFor: (productId) => {
              const product = store.prodRef.current.find(p => p.id === productId)
              const locs = store.calcStockByLocation(product, store.serialRef.current, localBulk, productId)
              return { warehouse: locs.warehouse, shop: locs.shop, repair_unit: locs.repair_unit }
            },
            assignedSerialsFor: (productId) => store.serialRef.current
              .filter(s => s.productId === productId && s.repairId === repairId && s.status === 'assigned')
              .map(s => ({ id: s.id, serial: s.serial, location: (s.location || 'repair_unit') as LocationId })),
          })
          // A failed/partial plan must not mark parts consumed — they could never
          // be re-consumed, and inventory would diverge from the repair ledger.
          if (consumePlan.errors && consumePlan.errors.length > 0) {
            store.showToast(`Cannot complete QC — parts consumption failed: ${consumePlan.errors[0]}`, 'error')
            return
          }
          for (const step of consumePlan.steps) {
            if (step.kind === 'consume_serial') {
              store.setSerials(p => p.map(s => s.id === step.serialId ? { ...s, status: 'sold' as const } : s))
              store.setProducts(p => p.map(x => x.id === step.productId ? { ...x, stockQty: Math.max(0, x.stockQty - 1) } : x))
              store.addMove(step.productId, step.productName, 1, 'out', step.reason, repair.ref ?? repairId, step.from, undefined, [step.serialNumber])
            } else {
              store.setBulkStock(prev => store.upsertBulkStock(prev, step.productId, step.from, -step.qty))
              // Keep local snapshot in sync for subsequent steps in this plan.
              const idx = localBulk.findIndex(l => l.productId === step.productId && l.location === step.from)
              if (idx >= 0) localBulk[idx] = { ...localBulk[idx], qty: Math.max(0, localBulk[idx].qty - step.qty) }
              store.setProducts(p => p.map(x => x.id === step.productId ? { ...x, stockQty: Math.max(0, x.stockQty - step.qty) } : x))
              store.addMove(step.productId, step.productName, step.qty, 'out', step.reason, repair.ref ?? repairId, step.from, undefined, [])
            }
          }
  
          const passedRepair: RepairOrder = {
            ...repair,
            qcItems: updatedQCItems,
            qcPassedDate: testedAt,
            qcApprovedBy: user.name,
            qcFailReason: undefined,
            qcFailedDate: undefined,
            qcFailedBy: undefined,
            status: 'ready',
            partsUsed: repair.partsUsed.map(part => ({
              ...part,
              usedDate: part.reservedDate && !part.usedDate ? testedAt : part.usedDate,
            })),
            statusHistory: [
              ...(repair.statusHistory ?? []),
              { status: 'ready', date: testedAt, note: 'QA passed — device ready for collection', by: user.name },
            ],
          }
          store.setRepairs(p => p.map(r => r.id === repairId ? passedRepair : r))
          store.syncRepairToPortal(passedRepair, 'Device ready for collection')
  
          // Post the repair-parts COGS journal (Dr 6301 / Cr 1200) for the parts
          // this pass consumed. The consumed lines travel in the request body:
          // the server's own copy of the repair is only updated by the async
          // store sync that `setRepairs` above kicked off, so a server-side
          // `usedDate` filter would read the pre-QC blob and find nothing to
          // post — which is why repair COGS silently never reached the ledger.
          // Idempotent per repair+product — safe on every pass.
          if (consumptionEnabled && partsToConsume.length > 0) {
            void fetch(`/api/repairs/${repairId}/parts-cogs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                parts: partsToConsume.map(part => ({ productId: part.productId, qty: part.qty })),
              }),
            })
              .then(async res => {
                if (!res.ok) {
                  const payload = await res.json().catch(() => null) as { error?: string } | null
                  store.showToast(payload?.error || 'Parts posted to accounting with warnings', 'error')
                }
              })
              .catch(() => store.showToast('Parts cost journal could not post — finance can retry from the repair', 'error'))
          }
  
          // QC owns workshop quality only. Billing remains independent: becoming
          // Ready must never create, confirm, post, or rewrite an invoice.
  
          store.notifyUsers({
            recipientRoles: ['finance_officer'],
            recipients: [
              repair.assignedTechnicianId,
              ...userIdsWithRoles(store.users, ['finance_officer']),
            ],
            type: 'repair',
            title: `Device ready: ${repair.ref}`,
            body: `${repair.productName} for ${repair.customerName} has passed QA and is ready for collection/delivery.`,
            module: 'repair', path: `?id=${repair.id}`,
            icon: '✅',
            entityKey: `repair:${repair.id}:qc_pass`,
            excludeUserId: user.id,
          })
          store.addAuditLog('complete_qc', repairId, 'QA passed — device ready for customer')
          store.showToast('QA passed — device ready for pickup')
        } else {
          const historyNote = `QA failed: ${trimmedFailReason}${failedSummary ? ` — ${failedSummary}` : ''}`
          const failedRepair: RepairOrder = {
            ...repair,
            qcItems: updatedQCItems,
            qcFailReason: trimmedFailReason,
            qcFailedDate: testedAt,
            qcFailedBy: user.name,
            qcPassedDate: undefined,
            qcApprovedBy: undefined,
            status: 'in_repair',
            // Do not stamp/overwrite repairCompletedDate on fail
            statusHistory: [
              ...(repair.statusHistory ?? []),
              { status: 'in_repair', date: testedAt, note: historyNote, by: user.name },
            ],
          }
          store.setRepairs(p => p.map(r => r.id === repairId ? failedRepair : r))
  
          if (repair.assignedTechnicianId) {
            store.notifyUsers({
              recipients: [repair.assignedTechnicianId],
              type: 'repair',
              title: '❌ Repair failed QA',
              body: `${repair.ref} requires rework. Reason: ${trimmedFailReason}${failedSummary ? `. Failed: ${failedSummary}` : ''}`,
              module: 'repair',
              path: `?id=${repair.id}`,
              icon: '❌',
              entityKey: `repair:${repair.id}:qc_fail`,
              excludeUserId: user.id,
            })
          }
          // Portal must mirror ERP — in_repair, not qc
          store.syncRepairToPortal(failedRepair, historyNote)
          store.addAuditLog('fail_qc', repairId, historyNote)
          store.showToast('QA failed — repair requires rework', 'error')
        }
      },

    markPartsArrived: (repairId) => {
        const actor = store.currentUser()
        // Admin officers chase the purchase for the desk, so they may close it too.
        if (!userCan(actor, 'repair.parts.arrived')) {
          store.showToast('Only the Technical Lead, Inventory Officer or Admin Officer can mark parts as arrived', 'error'); return
        }
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair || repair.status !== 'awaiting_parts') return
  
        const partLines = (repair.quote?.lines ?? []).filter(l => l.type === 'part' && l.productId)
  
        // Reserve parts now that stock has arrived — into repair_unit
        const arrivedReserve = planRepairPartReserve({
          repairRef: repair.ref,
          lines: partLines.map(line => {
            const product = store.prodRef.current.find(p => p.id === line.productId)
            return {
              productId: line.productId!,
              productName: line.productName ?? line.description,
              qty: line.qty,
              requiresSerial: Boolean(product?.requiresSerial),
            }
          }),
          stockFor: (productId) => {
            const product = store.prodRef.current.find(p => p.id === productId)
            const locs = store.calcStockByLocation(product, store.serialRef.current, store.bulkStock, productId)
            return { warehouse: locs.warehouse, shop: locs.shop, repair_unit: locs.repair_unit }
          },
          availableSerialsFor: (productId) => store.serialRef.current
            .filter(s => s.productId === productId && s.status === 'available')
            .map(s => ({ id: s.id, serial: s.serial, location: s.location })),
        })
        applyReserveSteps(arrivedReserve.steps, repairId, repair.ref)
  
        const updatedLines = (repair.quote?.lines ?? []).map(l => ({
          ...l,
          reserved: l.type === 'part' ? true : l.reserved,
        }))
        const partsUsedNow = partLines.map(line => ({
          productId: line.productId ?? '',
          productName: line.productName ?? line.description,
          qty: line.qty,
          price: line.unitPrice,
          reservedDate: now(),
        }))
  
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: 'approved',
          quote: r.quote ? { ...r.quote, lines: updatedLines } : r.quote,
          partsUsed: partsUsedNow,
          procurementRequests: (r.procurementRequests ?? []).map(req => req.status === 'pending' ? { ...req, status: 'received' as const } : req),
        } : r))
  
        if (repair.assignedTechnicianId) {
          store.notifyUsers({
            recipients: [repair.assignedTechnicianId],
            type: 'repair',
            title: '📦 Parts have arrived — ready to start',
            body: `${repair.ref} — ${repair.productName}`,
            module: 'repair',
            path: `?id=${repair.id}`,
            icon: '📦',
            entityKey: `repair:${repair.id}:parts_arrived`,
            excludeUserId: actor?.id,
          })
        }
        store.syncRepairToPortal({ ...repair, status: 'approved' }, 'Parts arrived — repair resuming')
        store.addAuditLog('parts_arrived', repairId, `${actor!.name} confirmed parts arrived and reserved`)
        store.showToast('Parts received and reserved — technician notified')
      },

    markRepairReady: (repairId) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return
        }
        if (store.blockIfOutsourced(repairId, 'mark the repair ready')) return
        const missingSteps: string[] = []
        if (repair.status === 'pending_verification') {
          missingSteps.push('intake verification')
        }
        const requiresFullWorkflow = !repair.diagnosisStopped && repair.repairPath !== 'direct_repair' && !isRepairBillingExempt(repair)
        if (requiresFullWorkflow && !repair.diagnosis) {
          missingSteps.push('diagnosis')
        }
        if (requiresFullWorkflow && !repair.quote) {
          missingSteps.push('quote generation')
        }
        const quoteApproved =
          !repair.quote ||
          !!repair.quote.approvedDate ||
          ['approved', 'awaiting_parts', 'in_repair', 'qc', 'ready', 'delivered'].includes(repair.status)
        if (requiresFullWorkflow && repair.quote && !quoteApproved) {
          missingSteps.push('quote approval')
        }
        const qaPassed = (repair.qcItems?.length ?? 0) > 0 && repair.qcItems.every(item => item.passed)
        if (!repair.diagnosisStopped && !repair.qcPassedDate && !qaPassed) {
          missingSteps.push('QA sign-off')
        }
        if (missingSteps.length > 0) {
          store.showToast(`Complete required steps before ready: ${missingSteps.join(' → ')}`, 'error')
          return
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? { ...r, status: 'ready' } : r))
  
        // Auto-post the draft invoice created at quote-approval time (Path B procurement flow).
        // Path A already creates the invoice as 'posted', so this only fires for drafts.
        if (repair?.invoiceId) {
          const inv = store.invRef.current.find(i => i.id === repair.invoiceId)
          if (inv && inv.status === 'draft' && inv.lines.length > 0) {
            store.setInvoices(p => {
              const next = p.map(i => i.id === inv.id ? { ...i, status: 'posted' as const } : i)
              const updated = next.find(i => i.id === inv.id)
              if (updated) sync(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoicePersistBody(updated as unknown as Record<string, unknown>)) })
              return next
            })
            // Post GL journal: AR debit / Sales Revenue credit / VAT credit
            const journal: JournalEntry = {
              id: uid(), ref: `JRN/${inv.ref}`, date: now(), source: 'invoice',
              description: `Invoice ${inv.ref} — ${inv.partnerName} (auto-posted on repair ready)`,
              status: 'posted', invoiceId: inv.id,
              lines: [
                { id: uid(), account: '1800 - Accounts Receivable', description: `AR: ${inv.partnerName}`, debit: inv.total, credit: 0 },
                { id: uid(), account: '5000 - Sales Revenue', description: `Revenue: ${inv.ref}`, debit: 0, credit: inv.subtotal },
                ...(inv.taxTotal > 0 ? [{ id: uid(), account: '3301 - Output VAT Payable', description: `VAT on ${inv.ref}`, debit: 0, credit: inv.taxTotal }] : []),
              ],
              totalDebit: inv.total, totalCredit: inv.total,
            }
            store.setJournalEntries(p => [journal, ...p])
            store.addAuditLog('post_invoice', inv.ref, `Auto-posted on repair ready — ${repair.ref}`)
          }
        }
  
        // Confirm the Sale Order if it's still a quotation (Path B — parts were sourced)
        if (repair?.saleOrderId) {
          store.setSaleOrders(prev => {
            const next = prev.map(s => s.id === repair.saleOrderId && (s.status === 'quotation' || s.status === 'quotation_sent')
              ? { ...s, status: 'sale' as const, confirmedAt: new Date().toISOString() }
              : s
            )
            const updated = next.find(s => s.id === repair.saleOrderId)
            if (updated?.status === 'sale') sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...updated, reserveStock: false }) })
            return next
          })
        }
  
        if (!isRepairNoCharge(repair) && !repair.invoiceId && !(repair as any).linkedInvoiceId) {
          void store.storeCtxRef.current!.createInvoiceFromRepair(repairId)
        }
  
        if (repair?.assignedTechnicianId) {
          store.notifyUsers({
            recipientRoles: ['finance_officer'],
            recipients: [
              repair.assignedTechnicianId,
              ...userIdsWithRoles(store.users, ['finance_officer']),
            ],
            type: 'repair',
            title: `Device ready — ${repair.ref}`,
            body: `${repair.productName} for ${repair.customerName} has been marked ready for pickup/delivery.`,
            module: 'repair',
            path: `?id=${repair.id}`,
            icon: '✅',
            entityKey: `repair:${repair.id}:ready`,
            excludeUserId: store.currentUserId,
          })
        }
        if (repair) store.syncRepairToPortal({ ...repair, status: 'ready' }, 'Repair complete — device ready for collection')
        store.addAuditLog('mark_ready', repairId, 'Device ready for pickup')
        store.showToast('Device marked ready for pickup — invoice posted, technician notified')
      },

    scheduleDelivery: async (repairId, method, scheduledDate, address, riderId, riderName) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (store.blockIfOutsourced(repairId, 'schedule delivery')) return false
        const reissueHold = reissueBlocker(repair?.invoiceReissue)
        if (reissueHold) { store.showToast(reissueHold, 'error'); return false }
        let deliveryJobId: string | undefined
  
        if (method === 'delivery' && repair) {
          const user = store.currentUser()
          const rider = riderId ? store.riders.find(r => r.id === riderId) : undefined
          // Server-allocated atomic ref (see createDeliveryJob) — never the
          // per-browser counter that produced duplicate DJB refs.
          const ref = await store.fetchNextDeliveryRef()
          if (!ref) {
            store.showToast('Could not allocate a delivery reference — check your connection and retry', 'error')
            return false
          }
          const jobId = uid()
          const job: DeliveryJob = {
            id: jobId,
            ref,
            type: 'repair_dropoff',
            status: riderId ? 'assigned' : 'pending',
            repairOrderId: repairId,
            repairOrderRef: repair.ref,
            customerName: repair.contactPersonName || repair.customerName,
            customerPhone: repair.contactPersonPhone || repair.customerPhone || '',
            pickupAddress: `${store.companySettings.name}, ${store.companySettings.address}`,
            deliveryAddress: address || '',
            riderId: riderId || undefined,
            riderName: riderName || undefined,
            assignedAt: riderId ? now() : undefined,
            scheduledDate,
            riderFee: rider?.ratePerDelivery ?? 0,
            billedTo: 'customer',
            notes: `Repair ${repair.ref} — device drop-off to client`,
            createdByUserId: user?.id ?? '',
            createdByName: user?.name ?? 'System',
            createdAt: now(),
          }
          deliveryJobId = jobId
          store.setDeliveryJobs(p => [job, ...p])
          store.addAuditLog('create_delivery_job', job.ref, `repair_dropoff for ${job.customerName}`)
        }
  
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          deliveryMethod: method,
          deliveryScheduledDate: scheduledDate,
          deliveryAddress: address,
          deliveryRiderId: riderId,
          deliveryRiderName: riderName,
          ...(deliveryJobId ? { deliveryJobId } : {}),
        } : r))
  
        const toastMsg = method === 'delivery'
          ? `Delivery job created${riderName ? ` — ${riderName}` : ' — rider TBD'}`
          : `${method === 'courier' ? 'Courier' : 'Pickup'} scheduled for ${scheduledDate}`
        store.addAuditLog('schedule_delivery', repairId, `Scheduled ${method} for ${scheduledDate}${riderName ? ` via ${riderName}` : ''}`)
        store.showToast(toastMsg)
        return true
      },

    deliverRepair: (repairId, recipientName, recipientPhone, isRep = false, repRelationship, repIdNumber, closeAfter = false) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return
        if (store.blockIfOutsourced(repairId, 'deliver this repair')) return
        const reissueHold = reissueBlocker(repair.invoiceReissue)
        if (reissueHold) { store.showToast(reissueHold, 'error'); return }
        const handover = applyRepairHandover(repair, {
          recipientName,
          recipientPhone,
          isRep,
          repRelationship,
          repIdNumber,
          closeAfter,
          now: now(),
        })
        const next = { ...repair, ...handover }
        store.setRepairs(p => p.map(r => r.id === repairId ? next : r))
        const portalMsg = isRep
          ? `Device collected by ${recipientName} (${repRelationship || 'Representative'}) on behalf of client`
          : `Device collected by ${recipientName}`
        store.syncRepairToPortal(
          next,
          handover.status === 'closed' ? `${portalMsg}. Repair job closed` : portalMsg,
        )
        const detail = isRep ? `${recipientName} (Rep — ${repRelationship || 'Representative'})` : recipientName
        store.addAuditLog('deliver_repair', repairId, `Collected by ${detail}`)
        if (handover.status === 'closed') {
          store.addAuditLog('close_repair', repair.ref, 'Repair job closed')
          store.showToast(`${repair.ref} collected and closed`)
        } else if (closeAfter && !canCloseRepairAfterHandover(repair)) {
          store.showToast(`Device handed over to ${recipientName}. Generate invoice before closing.`)
        } else {
          store.showToast(`Device handed over to ${recipientName}`)
        }
      },

    closeRepairJob: async (repairId) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return
        if (store.blockIfOutsourced(repairId, 'close this repair')) return
        
        if (!['delivered', 'collected'].includes(repair.status)) {
          store.showToast('Device must be delivered or collected before closing the repair', 'error')
          return
        }
  
        // Close validates Repair state only and never manufactures a financial
        // document. Chargeable jobs must be linked explicitly from Invoice.
        if (!isRepairNoCharge(repair) && !repairHasInvoiceLink(repair)) {
          store.showToast('Link an invoice from the Invoice module before closing', 'error')
          return
        }
  
        const latest = store.repairsRef.current.find(r => r.id === repairId) ?? repair
        const closedRepair = {
          ...latest,
          status: 'closed' as RepairStatus,
          closedDate: now(),
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? closedRepair : r))
        store.syncRepairToPortal(closedRepair, 'Repair job closed')
        
        store.addAuditLog('close_repair', repair.ref, `Repair job closed`)
        store.showToast(`${repair.ref} closed successfully`)
      },

    createInvoiceFromRepair: async (repairId, applyVat = true) => {
        // One run per repair at a time. The automatic trigger and a button click (or two clicks)
        // used to run side by side, each finding no invoice yet and each raising its own.
        const running = store.repairInvoiceInFlight.get(repairId)
        if (running) return running
        const run = (async (): Promise<Invoice | null> => {
        const repair = store.repairsRef.current.find(r => r.id === repairId) ?? store.repairs.find(r => r.id === repairId)
        if (!repair) return null
        if (store.blockIfOutsourced(repairId, 'invoice this repair')) return null
        const reissueHold = reissueBlocker(repair.invoiceReissue)
        if (reissueHold) { store.showToast(reissueHold, 'error'); return null }
        
        if (isRepairNoCharge(repair)) {
          store.showToast(
            isRepairBillingExempt(repair)
              ? 'No invoice — this job is marked no-charge (company mistake / goodwill)'
              : 'No invoice needed for warranty repairs',
            'info',
          )
          return null
        }
  
        const chargeLines = buildRepairInvoiceCharges(repair, applyVat, store.companySettings.vatRate)
        const chargeTotal = repairInvoiceChargeTotal(chargeLines)
        if (chargeTotal < 1) {
          store.showToast('Invoice total must be at least KES 1 — invoices below KES 1 cannot be created', 'error')
          return null
        }
  
        const toInvoiceLines = (): InvoiceLine[] => chargeLines.map(line => ({
          id: uid(),
          description: line.description,
          qty: line.qty,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          taxCategory: line.taxRate > 0 ? 'standard_16' : 'out_of_scope',
          subtotal: line.subtotal,
          productId: line.productId,
        }))
        const subtotal = chargeLines.reduce((sum, line) => sum + line.subtotal, 0)
        const taxTotal = chargeLines.reduce((sum, line) => sum + Math.round(line.subtotal * line.taxRate / 100), 0)
  
        const resolveExistingInvoice = (row: typeof repair) => {
          // Invoices credited by a reissue are history, never "the" invoice.
          const replaced = new Set(row.previousInvoiceIds ?? [])
          const listed = store.invRef.current.filter(inv => !replaced.has(inv.id))
          return (row.invoiceId ? listed.find(inv => inv.id === row.invoiceId) : undefined)
            ?? ((row as any).linkedInvoiceId ? listed.find(inv => inv.id === (row as any).linkedInvoiceId) : undefined)
            ?? listed.find(inv =>
              inv.repairId === repairId
              || (!!row.saleOrderId && inv.saleOrderId === row.saleOrderId)
              || (!!row.ref && inv.notes?.includes(row.ref)),
            )
        }
  
        let existingInvoice = resolveExistingInvoice(repair)
        if (existingInvoice?.status === 'cancelled') existingInvoice = undefined
  
        /**
         * Attach the invoice and move `ready` on to `invoiced`.
         *
         * The status update used to be guarded by `if (!repair.invoiceId)`, so a
         * repair that was ALREADY linked to its invoice never advanced — the one
         * case where the link exists is exactly the case that needed moving on.
         */
        const linkInvoiceToRepair = (inv: { id: string }) => {
          store.setRepairs(p => p.map(r => r.id === repairId
            ? {
              ...r,
              invoiceId: inv.id,
              invoiceDate: r.invoiceDate ?? now(),
              status: r.status === 'ready' ? 'invoiced' : r.status,
            }
            : r))
        }
  
        // Posted invoices are immutable even when unpaid. Corrections belong to
        // the Invoice module's credit/debit-note workflow.
        //
        // But refusing outright used to strand the job. The device is repaired,
        // an invoice exists and sits on the customer's account, and the only
        // route from `ready` to `invoiced` runs through here — so a repair whose
        // posted invoice had drifted from the quote could never advance, and the
        // workshop was held at "Ready" by an accounting discrepancy it cannot
        // fix. The device would never reach release, collection or close.
        //
        // So the job moves on and the mismatch is reported as what it is: work
        // for Finance, not a wall for the workshop.
        if (existingInvoice && existingInvoice.status !== 'draft' && !invoiceMatchesRepairCharges(existingInvoice, chargeLines)) {
          linkInvoiceToRepair(existingInvoice)
          store.showToast(
            `${existingInvoice.ref} is posted and cannot be edited — issue a credit/debit note in the Invoice module. The repair has been marked invoiced so the device can be released.`,
            'info',
          )
          return existingInvoice
        }
  
        const linkedSaleOrder = findSaleOrderForRepair(store.soRef.current, repair)
        const linkedSalesQuote = findSalesQuoteForRepair(store.quotes, repair)
        const invoiceAlreadyMatches = existingInvoice ? invoiceMatchesRepairCharges(existingInvoice, chargeLines) : false
        const quoteAlreadyAccepted = !linkedSalesQuote || linkedSalesQuote.status === 'accepted'
        const soAlreadySale = !linkedSaleOrder || linkedSaleOrder.status === 'sale'
        if (existingInvoice && invoiceAlreadyMatches && quoteAlreadyAccepted && soAlreadySale) {
          linkInvoiceToRepair(existingInvoice)
          store.showToast(`Invoice ${existingInvoice.ref} already exists for this repair`, 'info')
          return existingInvoice
        }
  
        // A job the customer did not go ahead with bills the diagnosis fee only.
        // The Sales Order the server invoices from must then carry exactly that
        // fee — not the declined quote — and its totals must match.
        const feeOnly = repairBillsFeeOnly(repair)
        const soLines = feeOnly
          ? chargeLines.map(line => ({
              id: uid(),
              ...saleLineFieldsForRepairQuoteLine({
                type: 'service',
                description: line.description,
                qty: line.qty,
                unitPrice: line.unitPrice,
                subtotal: line.subtotal,
              }),
            }))
          : (repair.quote?.lines ?? [])
            .filter(line => line.decision !== 'declined')
            .map(line => ({
              id: uid(),
              ...saleLineFieldsForRepairQuoteLine(line),
            }))
        const soSubtotal = feeOnly ? subtotal : (repair.quote?.subtotal ?? subtotal)
        const soTax = feeOnly ? taxTotal : (repair.quote?.tax ?? taxTotal)
        const soTotal = feeOnly ? chargeTotal : (repair.quote?.total ?? chargeTotal)
        let soId = linkedSaleOrder?.id ?? repair.saleOrderId ?? (repair as any).linkedSaleOrderId
        let soRefValue = linkedSaleOrder?.ref ?? linkedSaleOrder?.orderNumber ?? repair.saleOrderRef ?? (repair as any).linkedSaleOrderRef
        if (!soId) {
          soId = uid()
          soRefValue = await store.storeCtxRef.current!.allocateDocRef('SO')
          const newSo = {
            id: soId, ref: soRefValue, status: 'sale' as const, confirmedAt: new Date().toISOString(),
            customerId: repair.customerId, customerName: repair.customerName,
            date: now(),
            lines: soLines, subtotal: soSubtotal,
            taxAmount: soTax,
            taxTotal: soTax,
            totalAmount: soTotal,
            total: soTotal,
            notes: `Repair order ${repair.ref}`, createdByUserId: repair.createdBy,
          }
          store.setSaleOrders(p => [newSo as SaleOrder, ...p])
          sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSo) })
        } else if (linkedSaleOrder && (
          linkedSaleOrder.status === 'quotation'
          || linkedSaleOrder.status === 'quotation_sent'
          || (linkedSaleOrder.lines?.length ?? 0) < soLines.length
          // Fee only: an order still holding the approved quote must come down
          // to the fee, or the server bills the full quote / refuses the invoice.
          || (feeOnly && !isDiagnosisFeeOnlyLines(linkedSaleOrder.lines, isDiagnosisFeeLine))
        )) {
          const confirmedAt = linkedSaleOrder.confirmedAt ?? new Date().toISOString()
          const soPatch = {
            status: 'sale' as const,
            confirmedAt,
            // Repair billing is post-work invoicing. Do not reserve stock via the
            // Sales confirm path — create-invoice confirms the workshop quotation.
            reserveStock: false,
            lines: soLines.length ? soLines : linkedSaleOrder.lines,
            subtotal: feeOnly ? soSubtotal : (repair.quote?.subtotal ?? linkedSaleOrder.subtotal),
            taxAmount: feeOnly ? soTax : (repair.quote?.tax ?? linkedSaleOrder.taxAmount),
            taxTotal: feeOnly ? soTax : (repair.quote?.tax ?? linkedSaleOrder.taxTotal),
            totalAmount: feeOnly ? soTotal : (repair.quote?.total ?? linkedSaleOrder.totalAmount ?? linkedSaleOrder.total),
            total: feeOnly ? soTotal : (repair.quote?.total ?? linkedSaleOrder.total),
          }
          const patchRes = await fetch(`/api/sale-orders/${soId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(soPatch),
          }).catch(() => null)
          if (!patchRes?.ok) {
            // Carrying on would invoice the order as it stands on the server
            // (for a fee-only job: the full declined / failed quote).
            const reason = await patchRes?.json().then((b: { error?: string }) => b?.error).catch(() => undefined)
            store.showToast(`Could not update ${soRefValue ?? 'the repair sales order'}${reason ? `: ${reason}` : ' — check your connection and try again'}`, 'error')
            return null
          }
          store.setSaleOrders(p => p.map(s => s.id === soId ? { ...s, ...soPatch } : s))
        }
  
        const invoiceNotes = `Repair invoice for ${repair.ref}${
          isDiagnosisFeeSettled(repair) && repair.diagnosisFeeStatus === 'paid'
            ? ` — diagnosis fee KES ${(repair.diagnosisFee ?? 0).toLocaleString('en-KE')} collected early (not credited against this bill)`
            : ''
        }`
        const lines = toInvoiceLines()
        let invoice = existingInvoice
        let createdNew = false
        let rebuilt = false
  
        if (invoice && !invoiceAlreadyMatches) {
          const commitInvoice = (next: Invoice) => {
            store.invRef.current = store.invRef.current.map(inv => inv.id === next.id ? next : inv)
            store.setInvoices(p => p.map(inv => inv.id === next.id ? next : inv))
          }
          if (invoice.status !== 'draft') {
            store.showToast(`${invoice.ref} is immutable — issue a credit/debit note in the Invoice module.`, 'error')
            return invoice
          }
          const patched: Invoice = {
            ...invoice,
            lines,
            subtotal,
            taxTotal,
            total: chargeTotal,
            saleOrderId: soId,
            repairId,
            notes: invoice.notes?.includes(repair.ref) ? invoice.notes : `${invoice.notes ?? ''}\n${invoiceNotes}`.trim(),
          }
          commitInvoice(patched)
          const { res: putRes, data: putBody } = await putInvoiceWithLockRetry(patched.id, patched as unknown as Record<string, unknown>)
          if (!putRes.ok) {
            store.showToast((putBody as { error?: string } | null)?.error || `Could not update ${patched.ref} from the quote`, 'error')
            return patched
          }
          const rewriteLock = readLockVersionFromResponse(putBody)
          invoice = {
            ...patched,
            ...(rewriteLock !== undefined ? { lockVersion: rewriteLock } : {}),
          }
          commitInvoice(invoice)
          // Alignment may update a draft, but confirmation/posting is owned by
          // the Invoice module and must be an explicit Finance action.
          rebuilt = true
        } else if (!invoice) {
          const freshRepair = store.repairsRef.current.find(r => r.id === repairId)
          if (freshRepair?.invoiceId) {
            const raced = resolveExistingInvoice(freshRepair)
            if (raced && raced.status !== 'cancelled') {
              store.showToast('Invoice already exists for this repair', 'info')
              return raced
            }
          }
          if (!soId) {
            store.showToast('Repair Sales Order is missing — align the quote before invoicing', 'error')
            return null
          }
          // The repair can point at a Sales Order that was never saved to the
          // server and is not in this browser either (a dangling id). A fee-only
          // job has nothing in that order worth keeping, so rebuild it from the
          // fee and let the recovery path push it — otherwise every attempt
          // answers "Sale order not found".
          let localOrder: unknown = store.soRef.current.find(s => s.id === soId)
          if (!localOrder && feeOnly) {
            soRefValue = await store.storeCtxRef.current!.allocateDocRef('SO')
            localOrder = {
                  id: soId, ref: soRefValue, status: 'sale' as const,
                  confirmedAt: new Date().toISOString(),
                  customerId: repair.customerId, customerName: repair.customerName,
                  date: now(),
                  lines: soLines, subtotal: soSubtotal,
                  taxAmount: soTax, taxTotal: soTax,
                  totalAmount: soTotal, total: soTotal,
                  notes: `Repair order ${repair.ref}`, createdByUserId: repair.createdBy,
            }
          }
          const attempt = await requestSaleOrderInvoice({
            saleOrderId: soId,
            invoiceBody: { mode: 'regular', source: 'repair' },
            localOrder,
          })
          const res = attempt.res
          if (attempt.saleOrderId !== soId) {
            // The server minted its own id for a legacy local one: follow it.
            const recoveredId = attempt.saleOrderId
            store.setSaleOrders(p => p.map(s => s.id === soId ? { ...s, id: recoveredId } : s))
            soId = recoveredId
          }
          const payload = await res.json().catch(() => null)
          if (!res.ok || !payload?.invoice) {
            store.showToast(payload?.error || 'Could not convert the Repair Sales Order to an invoice', 'error')
            return null
          }
          invoice = payload.invoice as Invoice
          store.invRef.current = [invoice, ...store.invRef.current.filter(inv => inv.id !== invoice!.id)]
          store.setInvoices(p => [invoice!, ...p.filter(inv => inv.id !== invoice!.id)])
          // The server hands back the repair's existing invoice instead of raising a second one.
          createdNew = !payload.existing
        }
  
        if (soId && invoice) {
          store.setSaleOrders(p => p.map(s => s.id === soId ? { ...s, status: 'sale' as const, invoiceId: invoice!.id, confirmedAt: s.confirmedAt ?? new Date().toISOString() } : s))
          sync(`/api/sale-orders/${soId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'sale', invoiceId: invoice.id, confirmedAt: new Date().toISOString() }),
          })
        }
  
        if (linkedSalesQuote && invoice) {
          store.setQuotes(p => {
            const next = p.map(q => q.id === linkedSalesQuote.id ? {
              ...q,
              status: 'accepted' as const,
              saleOrderId: soId ?? q.saleOrderId,
              invoiceId: invoice!.id,
              acceptedDate: q.acceptedDate ?? now(),
              convertedDate: q.convertedDate ?? now(),
            } : q)
            const updated = next.find(q => q.id === linkedSalesQuote.id)
            if (updated) sync(`/api/quotes/${linkedSalesQuote.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return next
          })
        }
  
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          invoiceId: invoice!.id,
          invoiceDate: r.invoiceDate ?? now(),
          // Invoice state is orthogonal to workshop progress.
          status: r.status,
          ...(soId ? { saleOrderId: soId, saleOrderRef: soRefValue } : {}),
          ...(linkedSalesQuote ? { salesQuoteId: linkedSalesQuote.id, salesQuoteRef: linkedSalesQuote.ref ?? linkedSalesQuote.quoteNumber } : {}),
          diagnosisFeeStatus: (() => {
            if (!shouldChargeDiagnosisFee(r) || !(r.diagnosisFee ?? 0)) return r.diagnosisFeeStatus
            if (r.diagnosisFeeStatus === 'paid' || r.diagnosisFeePaidAt) return 'paid'
            if (r.diagnosisFeeStatus !== 'waived' && r.diagnosisFeeStatus !== 'not_applicable') return 'invoiced'
            return r.diagnosisFeeStatus
          })(),
        } : r))
  
        store.addAuditLog('invoice_repair', repair.ref, rebuilt
          ? `Invoice ${invoice!.ref} rebuilt from quote`
          : createdNew
            ? `Invoice ${invoice!.ref} created`
            : `Invoice ${invoice!.ref} linked from quote`)
        store.showToast(rebuilt
          ? `Invoice ${invoice!.ref} updated from the quote`
          : createdNew
            ? `Invoice ${invoice!.ref} generated`
            : `Invoice ${invoice!.ref} linked — quote converted`)
        return invoice
        })()
        store.repairInvoiceInFlight.set(repairId, run)
        try { return await run } finally { store.repairInvoiceInFlight.delete(repairId) }
      },

    consolidateRepairInvoices: async (repairIds) => {
        const actor = store.currentUser()
        // Retiring each repair's own confirmed order is a reversal of a
        // commercial document — the same people who may cancel a Sales Order.
        if (!canReverseConfirmedSale(actor?.role)) {
          store.showToast('Only Finance, Admin Officer, or Director can bill repairs together', 'error')
          return null
        }
        const selected = repairIds.map(id => store.repairsRef.current.find(r => r.id === id)).filter((r): r is RepairOrder => Boolean(r))
        if (selected.length !== repairIds.length) {
          store.showToast('Some of the selected repairs could not be found — refresh and try again', 'error')
          return null
        }
        for (const r of selected) {
          if (store.blockIfOutsourced(r.id, 'invoice this repair')) return null
        }
  
        // A repair whose order already carries an invoice counts as billed even
        // when the repair itself was never stamped with it.
        const withInvoiceLinks = selected.map(r => {
          const listed = store.invRef.current.find(inv => inv.status !== 'cancelled' && (inv.repairId === r.id || inv.id === r.invoiceId))
          return listed ? { ...r, invoiceId: listed.id } : r
        })
        const plan = planRepairConsolidation({ repairs: withInvoiceLinks })
        if (!plan.ok) {
          store.showToast(plan.reason, 'error')
          return null
        }
  
        const supersededOrders = plan.supersededSaleOrderIds
          .map(id => store.soRef.current.find(s => s.id === id))
          .filter((s): s is SaleOrder => Boolean(s))
        const blockers = supersededOrderBlockers({
          orders: supersededOrders,
          invoices: store.invRef.current,
          deliveries: store.delRef.current,
        })
        if (blockers.length > 0) {
          store.showToast(`Cannot bill together: ${blockers.join('; ')}`, 'error')
          return null
        }
  
        const mergedId = uid()
        const mergedRef = await store.storeCtxRef.current!.allocateDocRef('SO')
        const order = mergedSaleOrderFromPlan(plan, {
          id: mergedId,
          ref: mergedRef,
          customerName: selected[0].customerName,
          createdByUserId: actor?.id,
          now: new Date().toISOString(),
          date: now(),
        })
        order.lines = plan.lines.map(line => ({ id: uid(), ...line }))
  
        const outcome = await executeRepairConsolidation<Invoice>(plan, order, {
          createSaleOrder: async body => {
            const res = await fetch('/api/sale-orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }).catch(() => null)
            const data = await res?.json().catch(() => null)
            if (!res?.ok) return { ok: false, error: data?.error }
            return { ok: true, id: String(data?.id ?? data?.item?.id ?? body.id) }
          },
          invoiceSaleOrder: async (saleOrderId, localOrder) => {
            const attempt = await requestSaleOrderInvoice({
              saleOrderId,
              invoiceBody: { mode: 'regular', source: 'repair' },
              localOrder: { ...localOrder, id: saleOrderId },
            })
            const payload = await attempt.res.json().catch(() => null)
            if (!attempt.res.ok || !payload?.invoice) return { ok: false, error: payload?.error }
            return { ok: true, invoice: payload.invoice as Invoice, saleOrderId: attempt.saleOrderId }
          },
          cancelSaleOrder: async saleOrderId => {
            const res = await fetch(`/api/sale-orders/${saleOrderId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'cancelled' }),
            }).catch(() => null)
            return res?.ok ? { ok: true } : { ok: false }
          },
        })
  
        if (!outcome.ok) {
          store.showToast(outcome.strandedSaleOrderId
            ? `${outcome.error}. ${mergedRef} was saved but could not be withdrawn — cancel it in Sales.`
            : outcome.error, 'error')
          return null
        }
  
        const invoice = outcome.invoice
        const soId = outcome.saleOrderId
        const retired = new Set(plan.supersededSaleOrderIds.filter(id => !outcome.stillOpenSaleOrderIds.includes(id)))
        store.invRef.current = [invoice, ...store.invRef.current.filter(inv => inv.id !== invoice.id)]
        store.setInvoices(p => [invoice, ...p.filter(inv => inv.id !== invoice.id)])
        store.setSaleOrders(p => [
          { ...order, id: soId, invoiceId: invoice.id } as SaleOrder,
          ...p
            .filter(s => s.id !== soId)
            .map(s => retired.has(s.id) ? { ...s, status: 'cancelled' as const } : s),
        ])
  
        const covered = new Set(plan.repairIds)
        const quoteIds = new Set(selected.map(r => findSalesQuoteForRepair(store.quotes, r)?.id).filter(Boolean))
        store.setQuotes(p => p.map(q => {
          if (!quoteIds.has(q.id)) return q
          const updated = { ...q, status: 'accepted' as const, saleOrderId: soId, invoiceId: invoice.id }
          sync(`/api/quotes/${q.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
        store.setRepairs(p => p.map(r => covered.has(r.id) ? {
          ...r,
          invoiceId: invoice.id,
          invoiceDate: r.invoiceDate ?? now(),
          saleOrderId: soId,
          saleOrderRef: mergedRef,
          diagnosisFeeStatus: (() => {
            if (!shouldChargeDiagnosisFee(r) || !(r.diagnosisFee ?? 0)) return r.diagnosisFeeStatus
            if (r.diagnosisFeeStatus === 'paid' || r.diagnosisFeePaidAt) return 'paid'
            if (r.diagnosisFeeStatus !== 'waived' && r.diagnosisFeeStatus !== 'not_applicable') return 'invoiced'
            return r.diagnosisFeeStatus
          })(),
        } : r))
  
        for (const ref of plan.repairRefs) {
          store.addAuditLog('invoice_repair', ref, `Billed on ${invoice.ref} with ${plan.repairRefs.filter(x => x !== ref).join(', ')}`)
        }
        if (outcome.stillOpenSaleOrderIds.length > 0) {
          const refs = outcome.stillOpenSaleOrderIds
            .map(id => store.soRef.current.find(s => s.id === id)?.ref ?? id)
            .join(', ')
          store.showToast(`${invoice.ref} created for ${plan.repairRefs.length} repairs. ${refs} could not be cancelled — cancel it in Sales so it does not show as unbilled.`, 'info')
        } else {
          store.showToast(`${invoice.ref} created for ${plan.repairRefs.join(', ')}`)
        }
        return invoice
      },

    reviewPortalPayment: (repairId, approved, notes) => {
        const user = store.currentUser()
        if (!canManageFinance(user)) {
          store.showToast('Only Finance or Admin Officer can review payment confirmations', 'error'); return
        }
        const repair = store.repairsRef.current.find(r => r.id === repairId)
        if (!repair) return
        if (repair.paymentConfirmationStatus !== 'pending_review') {
          store.showToast('No pending payment confirmation to review', 'info'); return
        }
        const reviewedAt = new Date().toISOString()
  
        if (!approved) {
          const rejectedRepair = {
            ...repair,
            paymentConfirmationStatus: 'rejected' as const,
            paymentConfirmationReviewedAt: reviewedAt,
            paymentConfirmationReviewedBy: user!.name,
            paymentConfirmationNotes: notes?.trim() || 'Rejected by finance — confirmation could not be verified against the invoice.',
          }
          store.setRepairs(p => p.map(r => r.id === repairId ? rejectedRepair : r))
          store.syncRepairToPortal(rejectedRepair, 'Payment confirmation could not be verified — please contact us or resubmit')
          store.addAuditLog('reject_portal_payment', repair.ref, `Portal payment confirmation rejected${notes ? `: ${notes}` : ''}`)
          store.showToast('Payment confirmation rejected — customer can resubmit')
          return
        }
  
        // Confirm: register the payment against the linked invoice
        const invoiceId = repair.invoiceId ?? (repair as any).linkedInvoiceId
        const invoice = (invoiceId ? store.invRef.current.find(i => i.id === invoiceId) : undefined)
          ?? store.invRef.current.find(i => i.repairId === repairId)
        if (!invoice) {
          store.showToast('No linked invoice found for this repair — generate the invoice first', 'error'); return
        }
        const balance = invoice.total - invoice.amountPaid
        if (balance > 0) {
          const claimed = Number(repair.paymentConfirmationAmount ?? 0)
          const amount = claimed > 0 ? Math.min(claimed, balance) : balance
          store.storeCtxRef.current!.registerPayment(
            invoice.id, amount, 'mpesa', undefined,
            repair.paymentReceiptNumber ?? 'Portal M-PESA confirmation',
          )
        }
        const confirmedRepair = {
          ...repair,
          paymentConfirmationStatus: 'confirmed' as const,
          paymentConfirmationReviewedAt: reviewedAt,
          paymentConfirmationReviewedBy: user!.name,
          paymentConfirmationNotes: notes?.trim() || `Confirmed by ${user!.name} against ${invoice.ref}.`,
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? confirmedRepair : r))
        store.syncRepairToPortal(confirmedRepair, 'Payment confirmed — thank you')
        store.addAuditLog('confirm_portal_payment', repair.ref, `Portal payment confirmed against ${invoice.ref}${notes ? ` — ${notes}` : ''}`)
        store.showToast(`Payment confirmed and registered against ${invoice.ref}`)
      },

    canViewRepair: (repairId) => {
        const user = store.currentUser()
        if (!user) return false
        
        if (userCan(user, 'repair.view_all')) return true
  
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return false
  
        // Functional Firewall: Technicians (and actsAsTechnician users) only see assigned repairs
        if (isRepairTechActor(user)) {
          return repair.assignedTechnicianId === user.id || repair.createdByUserId === user.id
        }
  
        return true
      },

    getVisibleRepairs: () => {
        const user = store.currentUser()
        if (!user) return []
        const list = ensureArray<RepairOrder>(store.repairs)
  
        // Full visibility: desk + finance + lead techs see every repair, even
        // when the same login also actsAsTechnician for shop-floor assignment.
        if (userCan(user, 'repair.view_all')) return list
  
        // Functional Firewall: technicians and users acting as one see their own jobs + the QC pool (peer QC)
        if (isRepairTechActor(user)) {
          return list.filter(r => r.assignedTechnicianId === user.id || r.createdByUserId === user.id || (r.status === 'qc' && r.assignedTechnicianId !== user.id))
        }
  
        return list
      },

    updateRepairProgress: async (repairId, newStatus, message, notifyCustomer) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return
        }
  
        const user = store.currentUser()
        if (!user) {
          store.showToast('User not authenticated', 'error')
          return
        }
  
        // Check permissions: technicians / actsAsTechnician can only update their assigned repairs
        if (isRepairTechActor(user) && repair.assignedTechnicianId !== user.id) {
          store.showToast('You can only update repairs assigned to you', 'error')
          return
        }
  
        const transition = evaluateRepairTransition(repair.status, newStatus)
        if (!transition.allowed) {
          store.showToast(transition.reason, 'error')
          return
        }
  
        const blockedStatuses: RepairStatus[] = ['in_repair', 'qc', 'ready', 'invoiced', 'verified_released', 'delivered', 'collected', 'closed']
        if (blockedStatuses.includes(newStatus) && store.blockIfOutsourced(repairId, `set status to ${newStatus}`)) {
          return
        }
  
        // If cancelling, free up reserved serials and cancel linked financial documents
        if (newStatus === 'cancelled') {
          store.setSerials(p => p.map(s => s.repairId === repairId ? {
            ...s, status: 'available', repairId: undefined
          } : s))
          if (repair.saleOrderId) {
          store.setSaleOrders(p => p.map(so => {
            if (so.id !== repair.saleOrderId) return so
            const updated = { ...so, status: 'cancelled' as const }
            sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return updated
          }))
          }
        // Linked invoices are immutable here. Finance handles cancellation or
        // credit/debit notes explicitly in the Invoice module.
        }
  
        // Update repair status
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: newStatus,
          ...(newStatus === 'in_repair' && !r.repairStartDate ? { repairStartDate: now() } : {}),
          ...(newStatus === 'qc' && !r.repairCompletedDate ? { repairCompletedDate: now() } : {}),
          ...(newStatus === 'ready' && !r.qcPassedDate ? { qcPassedDate: now(), qcApprovedBy: user.name } : {}),
          ...(newStatus === 'delivered' ? { deliveryActualDate: now() } : {}),
          ...(newStatus === 'closed' ? { closedDate: now() } : {}),
        } : r))
  
        const updatedRepair: RepairOrder = {
          ...repair,
          status: newStatus,
          ...(newStatus === 'in_repair' && !repair.repairStartDate ? { repairStartDate: now() } : {}),
          ...(newStatus === 'qc' && !repair.repairCompletedDate ? { repairCompletedDate: now() } : {}),
          ...(newStatus === 'ready' && !repair.qcPassedDate ? { qcPassedDate: now(), qcApprovedBy: user.name } : {}),
          ...(newStatus === 'delivered' ? { deliveryActualDate: now() } : {}),
          ...(newStatus === 'closed' ? { closedDate: now() } : {}),
        }
        store.syncRepairToPortal(updatedRepair, message || `Status changed to ${newStatus}`)
  
        // Log activity
        store.addAuditLog('update_repair_progress', repairId, `Status changed to ${newStatus} by ${user.name}`)
  
        // Send customer notification if requested
        if (notifyCustomer && repair.customerPhone) {
          try {
            const response = await fetch('/api/notifications/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'repair',
                customerName: repair.customerName,
                customerPhone: repair.customerPhone,
                repairRef: repair.ref,
                deviceName: repair.productName,
                message,
                options: { priority: 'normal' }
              })
            })
  
            const result = await response.json()
  
            if (result.success) {
              store.showToast(`Status updated to ${newStatus} • Customer notified via ${result.channel?.toUpperCase()}`, 'success')
            } else {
              store.showToast(`Status updated to ${newStatus} • Notification failed: ${result.error}`, 'error')
            }
          } catch {
            store.showToast(`Status updated to ${newStatus} • Notification error`, 'error')
          }
        } else {
          store.showToast(`Status updated to ${newStatus}`, 'success')
        }
      },

    moveRepairToPreviousProgress: (repairId) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return
        }
  
        const user = store.currentUser()
        if (!userCan(user, 'repair.lead')) {
          store.showToast('Only the Lead Technician can move repair progress backwards', 'error')
          return
        }
  
        if (store.REPAIR_TERMINAL_STATUSES.includes(repair.status)) {
          store.showToast('Closed, cancelled, returned, or declined repairs cannot be moved backwards', 'error')
          return
        }
  
        if (store.blockIfOutsourced(repairId, 'move repair progress backwards')) return
  
        const previousStatus = getPreviousRepairProgressStatus(repair)
        if (!previousStatus || previousStatus === repair.status) {
          store.showToast('This repair is already at the first progress step', 'info')
          return
        }
  
        const changedAt = now()
        const note = `${user!.name} moved progress back from ${repair.status.replace(/_/g, ' ')} to ${previousStatus.replace(/_/g, ' ')}`
        const updatedRepair: RepairOrder = {
          ...repair,
          status: previousStatus,
          statusHistory: [
            ...(repair.statusHistory ?? []),
            { status: previousStatus, date: changedAt, note, by: user!.name },
          ],
        }
  
        store.setRepairs(prev => prev.map(r => r.id === repairId ? updatedRepair : r))
        store.syncRepairToPortal(updatedRepair, note)
        store.addAuditLog('repair_progress_back', repairId, note)
        store.showToast(`Repair moved back to ${previousStatus.replace(/_/g, ' ')}`, 'success')
      },

    requestProcurement: async (repairId, items, urgency, notes) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return 
        }
  
        const user = store.currentUser()
        if (!user) {
          store.showToast('User not authenticated', 'error')
          return
        }
  
        const newRequest = {
          id: uid(),
          repairId,
          repairRef: repair.ref,
          requestedBy: user.id,
          requestedByName: user.name,
          requestedDate: now(),
          urgency,
          status: 'pending' as const,
          notes,
          items: items.map((i: any) => ({
            type: i.type ?? 'part',
            productId: i.productId ?? '',
            productName: i.productName || i.name || 'Unknown item',
            description: i.description ?? '',
            qty: String(i.qty ?? 1),
            estimatedCost: String(i.estimatedCost ?? 0),
            supplier: i.supplier ?? '',
          })),
        }
  
        // Repair records the request; Procurement/Purchase owns the PO.
        // This avoids creating incomplete vendor-less financial documents as a
        // hidden consequence of a workshop action.
  
        // Update repair status to awaiting parts and save the request
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: 'awaiting_parts',
          procurementRequests: [...(r.procurementRequests ?? []), newRequest],
        } : r))
  
        store.syncRepairToPortal({ ...repair, status: 'awaiting_parts' }, 'Awaiting parts from supplier')
  
        // Build a readable summary grouped by type
        const byType: Record<string, string[]> = {}
        items.forEach((i: any) => {
          const t = i.type ?? 'part'
          ;(byType[t] = byType[t] ?? []).push(i.productName || i.name)
        })
        const typeIcons: Record<string, string> = { part: '🔩', software: '💿', license: '🔑' }
        const summary = Object.entries(byType)
          .map(([t, names]) => `${typeIcons[t] ?? '📦'} ${names.join(', ')}`)
          .join(' · ')
  
        // The part is not on the shelf: inventory corrects any count that says
        // otherwise and buys it; the desk (admin officers) follows up the purchase and the
        // customer. Each request gets its own key — a second request on the same
        // repair used to share the first one's and was dropped as a duplicate.
        store.notifyUsers({
          recipientRoles: ['technical_lead', 'inventory_officer', 'admin_officer'],
          recipients: userIdsWithRoles(store.users, ['technical_lead', 'inventory_officer', 'admin_officer'], user.id),
          type: 'repair',
          title: `${urgency === 'urgent' || urgency === 'high' ? `${urgency.toUpperCase()} · ` : ''}Parts requested for ${repair.ref}`,
          body: `${user.name} needs: ${summary} (${repair.productName}). It is not on the shelf. Next, in Inventory › Parts requests: correct the stock count if the system still shows it, then raise a purchase order.`,
          module: 'repair',
          path: `?id=${repair.id}`,
          icon: '📋',
          entityKey: `repair:${repair.id}:procurement:${newRequest.id}`,
          excludeUserId: user.id,
        })
  
        store.addAuditLog('procurement_request', repairId, `${user.name} requested: ${summary}`)
        
        // Notify procurement team and customer
        try {
          // Notify procurement team
          const procResponse = await fetch('/api/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'procurement',
              repairRef: repair.ref,
              technicianName: user.name,
              items,
              urgency,
              notes
            })
          })
  
          await procResponse.json()
  
          // Notify customer about delay
          if (repair.customerPhone) {
            await fetch('/api/notifications/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'repair',
                customerName: repair.customerName,
                customerPhone: repair.customerPhone,
                repairRef: repair.ref,
                deviceName: repair.productName,
                message: 'We are waiting for required parts to arrive for your repair. We will keep you updated on the progress.',
                options: { priority: 'normal' }
              })
            })
          }
  
          store.showToast(`Procurement request sent • Repair ${repair.ref} set to "Awaiting Parts"`, 'success')
        } catch {
          store.showToast(`Procurement request submitted • Repair ${repair.ref} set to "Awaiting Parts"`, 'success')
        }
      },

    // Parts queue step 1: the technician could not find a part the system says
    // is in the warehouse, so the count is wrong. Correct it down (pending
    // approval like every adjustment) before anything is ordered.
    correctPartsCount: (repairId, requestId, line, kind = 'repair') => {
        const found = store.partsQueueRequest(kind, repairId, requestId)
        if (!found) { store.showToast('Parts request not found', 'error'); return false }
        const systemQty = store.calcStockByLocation(store.prodRef.current.find(p => p.id === line.productId), store.serialRef.current, store.bulkStock, line.productId).warehouse
        const blocker = countCorrectionBlocker(systemQty, line.qtyMissing)
        if (blocker) { store.showToast(blocker, 'error'); return false }
        let adj: StockAdjustment
        try {
          adj = store.storeCtxRef.current!.createAdjustment(line.productId, line.productName, 'subtract', line.qtyMissing, 'count_correction', countCorrectionNote(found.ref, found.request, kind))
        } catch {
          return false
        }
        found.write(req => {
          const items = req.items.map((it, i) => i === line.itemIndex ? { ...it, productId: line.productId, productName: line.productName } : it)
          return requestAfterCountCheck({ ...req, items }, line.productId, adj.ref)
        })
        store.addAuditLog('parts_count_correction', found.ref, `${adj.ref}: ${line.qtyMissing} × ${line.productName} not on the shelf`)
        return true
      },

    // Parts queue step 2: the part is not in stock, so it is bought. The draft
    // order carries the repair; receiving it on a GRN resumes the repair.
    raisePartsPurchaseOrder: async (repairId, requestId, vendorId, vendorName, lines, kind = 'repair') => {
        if (!canManageProcurement(store.currentUser())) { store.showToast('Only Inventory or Admin can create Purchase Orders', 'error'); return null }
        const found = store.partsQueueRequest(kind, repairId, requestId)
        if (!found) { store.showToast('Parts request not found', 'error'); return null }
        const systemQtyFor = (productId: string) =>
          store.calcStockByLocation(store.prodRef.current.find(p => p.id === productId), store.serialRef.current, store.bulkStock, productId).warehouse
        const blocker = purchaseOrderBlocker(found.request, vendorId, lines, systemQtyFor)
        if (blocker) { store.showToast(blocker, 'error'); return null }
        const poLines: POLine[] = lines.map(l => {
          const product = store.prodRef.current.find(p => p.id === l.productId)
          const catCfg = product ? CATEGORY_CONFIG[product.category as CategoryId] ?? { serialRequired: false } : { serialRequired: false }
          const taxRate = Number(product?.taxRate ?? 0) || 0
          return {
            id: uid(), productId: l.productId, productName: l.productName,
            qty: l.qty, qtyReceived: 0, unitPrice: l.unitPrice, taxRate,
            subtotal: l.qty * l.unitPrice, requiresSerial: catCfg.serialRequired,
            accountCode: product ? resolveProductAccounts(product).costAccountCode : undefined,
          }
        })
        // The order carries its job, so receiving it reaches the right record.
        const po = await store.storeCtxRef.current!.createPO(vendorId, vendorName, found.kind === 'refurb'
          ? { lines: poLines, notes: refurbPartsOrderNote(found.job, found.part), refurbJobId: found.job.id, refurbJobRef: found.job.ref, refurbPartId: found.part.id }
          : { lines: poLines, notes: partsOrderNote(found.repair, found.request), repairId: found.repair.id, repairRef: found.repair.ref, procurementRequestId: found.request.id })
        if (!po?.id) return null
        const byIndex = new Map(lines.map(l => [l.itemIndex, l]))
        found.write(req => {
          const items = req.items.map((it, i) => {
            const l = byIndex.get(i)
            return l ? { ...it, productId: l.productId, productName: l.productName } : it
          })
          return requestAfterPurchaseOrder({ ...req, items }, po, now())
        })
        store.addAuditLog('parts_purchase_order', found.ref, `${po.ref} raised to ${vendorName} for parts request`)
        if (found.technicianId) {
          store.notifyUsers({
            recipients: [found.technicianId],
            type: 'repair',
            title: `Parts ordered for ${found.ref}`,
            body: found.kind === 'refurb'
              ? `${found.part.partName} on ${po.ref} to ${vendorName}. You will be told when it is received — carry on with the rest.`
              : `${po.ref} to ${vendorName}. The repair resumes when the order is received.`,
            module: found.kind === 'refurb' ? 'refurbishment' : 'repair',
            path: found.kind === 'refurb' ? '?tab=refurb' : `?id=${found.repair.id}`,
            icon: '🛒',
            entityKey: `${found.kind}:${repairId}:procurement:${requestId}:ordered`,
            excludeUserId: store.currentUserId,
          })
        }
        return po
      },

    appendRepairHistory: (repairId, entry) => {
        store.setRepairs(prev => prev.map(r => {
          if (r.id !== repairId) return r
          const existing = r.statusHistory ?? []
          // Replace any existing entry for same status+note-prefix to avoid duplicates
          const filtered = existing.filter(h => !(h.status === entry.status && h.note === entry.note))
          return { ...r, statusHistory: [...filtered, entry] }
        }))
      },

    declineQuote: async (repairId, reason) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return
        }
        const trimmedReason = String(reason ?? '').trim() || 'Declined by customer'
  
        const resolved = resolveDiagnosisFee(repair, store.systemSettings)
        const feePatch = diagnosisFeeExitPatch(repair, store.systemSettings)
        const feeApplies = !!feePatch.diagnosisFee
  
        // Soft-terminal: stay on `declined` so staff can revise & re-send another
        // quote OR return the device. Diagnosis fee (if due) is stamped for collection
        // on return / invoice — we do not force `ready` here.
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: 'declined',
          // A declined revision leaves the posted invoice standing as it was.
          ...(r.invoiceReissue?.status === 'awaiting_client' ? { invoiceReissue: reissueAfterClientDecision(r.invoiceReissue, false, now()) } : {}),
          notes: `${r.notes || ''}\n\nQuote declined: ${trimmedReason}${feeApplies ? ` (diagnosis fee KES ${resolved.amount} still due)` : ''}`.trim(),
          quote: r.quote
            ? { ...r.quote, rejectedDate: now(), rejectionReason: trimmedReason }
            : r.quote,
          ...feePatch,
        } : r))
  
        store.addAuditLog(
          'decline_quote',
          repairId,
          feeApplies
            ? `Quote declined — diagnosis fee KES ${resolved.amount}${repair.diagnosisFeeStatus === 'paid' || repair.diagnosisFeePaidAt ? ' (already paid)' : ' still due'}: ${trimmedReason}`
            : `Quote declined by customer: ${trimmedReason}`,
        )
  
        // Notify customer
        if (repair.customerPhone) {
          try {
            const response = await fetch('/api/notifications/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'repair',
                customerName: repair.customerName,
                customerPhone: repair.customerPhone,
                repairRef: repair.ref,
                deviceName: repair.productName,
                message: feeApplies
                  ? `We understand you've declined the repair quote for ${repair.productName} (${repair.ref}). A diagnosis fee of KES ${resolved.amount.toLocaleString('en-KE')} still applies. We can send a revised quote, or arrange device return.`
                  : `We understand you've declined the repair quote for ${repair.productName} (${repair.ref}). We can send a revised quote, or arrange device return pickup.`,
                options: { priority: 'normal' },
              }),
            })
  
            const result = await response.json()
  
            if (result.success) {
              store.showToast(
                feeApplies
                  ? `Quote declined — KES ${resolved.amount.toLocaleString('en-KE')} diagnosis fee still due · customer notified`
                  : `Quote declined · customer notified via ${result.channel?.toUpperCase()}`,
                'info',
              )
            } else {
              store.showToast('Quote declined · notification failed', 'error')
            }
          } catch {
            store.showToast('Quote declined · notification error', 'error')
          }
        } else {
          store.showToast(
            feeApplies
              ? `Quote declined — KES ${resolved.amount.toLocaleString('en-KE')} diagnosis fee still due. Revise quote or return device.`
              : 'Quote declined — revise quote or return device',
            'info',
          )
        }
      },

    waiveDiagnosisFee: (repairId, reason) => {
        const user = store.currentUser()
        if (!user) return
        if (!userCan(user, 'repair.fee.waive')) {
          store.showToast('Only a manager can waive the diagnosis fee', 'error')
          return
        }
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) return
        if (!reason.trim()) {
          store.showToast('Enter a reason for waiving the diagnosis fee', 'error')
          return
        }
        store.setRepairs(p => p.map(r => {
          if (r.id !== repairId) return r
          const nextLines = (r.quote?.lines ?? []).filter(l => !isDiagnosisFeeLine(l))
          const nextQuote = r.quote
            ? {
                ...r.quote,
                lines: nextLines,
                subtotal: nextLines.reduce((s, l) => s + l.subtotal, 0),
                tax: r.quote.tax,
                total: nextLines.reduce((s, l) => s + l.subtotal, 0) + (r.quote.tax || 0),
              }
            : r.quote
          return {
            ...r,
            diagnosisFee: 0,
            diagnosisFeeStatus: 'waived' as const,
            diagnosisFeeWaivedBy: user.name,
            diagnosisFeeWaivedReason: reason.trim(),
            quote: nextQuote,
            total: isRepairNoCharge(r)
              ? 0
              : (r.partsUsed?.reduce((a, x) => a + x.qty * x.price, 0) ?? 0) + (r.laborCost || 0),
            notes: `${r.notes || ''}\n[Diagnosis fee waived by ${user.name}] ${reason.trim()}`.trim(),
          }
        }))
        store.addAuditLog('waive_diagnosis_fee', repairId, `Diagnosis fee waived by ${user.name}: ${reason.trim()}`)
        store.showToast('Diagnosis fee waived', 'success')
      },

    markRepairNoCharge: (repairId, opts) => {
        const user = store.currentUser()
        if (!user) return
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return
        }
        if (!canMarkRepairBillingExempt(canonicalRole(user.role), repair)) {
          store.showToast(
            isRepairBillingExempt(repair)
              ? 'This job is already marked no-charge'
              : 'Only a manager can mark a job as no-charge, and only while it is still open',
            'error',
          )
          return
        }
        const reason = normalizeBillingExemptReason(opts?.reason)
        const notes = String(opts?.notes ?? '').trim()
        if (!notes) {
          store.showToast('Enter notes explaining why this job is no-charge', 'error')
          return
        }
        if (reason === 'other' && notes.length < 8) {
          store.showToast('For “Other”, add a clearer explanation in the notes', 'error')
          return
        }
        if (store.blockIfOutsourced(repairId, 'mark this repair no-charge')) return
  
        const markedAt = now()
        const reasonLabel = BILLING_EXEMPT_REASON_LABELS[reason]
        const nextStatus: RepairStatus =
          ['awaiting_approval', 'declined', 'diagnosed'].includes(repair.status)
            ? 'approved'
            : repair.status
  
        const existingInv = repair.invoiceId
          ? store.invRef.current.find(i => i.id === repair.invoiceId)
          : undefined
        // Paid is what has been received, not the status word: posted invoices
        // refreshed from the invoices table carry 'posted' whether paid or not.
        const clearInvoiceLink = !!existingInv
          && !['paid', 'partially_paid'].includes(String(existingInv.status))
          && !((Number(existingInv.amountPaid) || 0) > 0)
  
        // Cancel any unpaid customer invoice — this job must not bill the client
        if (clearInvoiceLink && repair.invoiceId) {
          store.setInvoices(p => p.map(inv => {
            if (inv.id !== repair.invoiceId) return inv
            const updated = { ...inv, status: 'cancelled' as const }
            sync(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoicePersistBody(updated as unknown as Record<string, unknown>)) })
            return updated
          }))
        }
  
        store.setRepairs(p => p.map(r => {
          if (r.id !== repairId) return r
          let nextQuote = r.quote
          if (r.quote) {
            const nextLines = (r.quote.lines ?? []).filter(l => !isDiagnosisFeeLine(l))
            const sub = nextLines.reduce((s, l) => s + l.subtotal, 0)
            nextQuote = {
              ...r.quote,
              lines: nextLines,
              subtotal: sub,
              total: sub + (r.quote.tax || 0),
              approvedDate: r.quote.approvedDate || markedAt,
              approvedBy: r.quote.approvedBy || `No-charge (${reason}) — auto-approved`,
            }
          }
          return {
            ...r,
            billingExempt: true,
            billingExemptReason: reason,
            billingExemptNotes: notes,
            billingExemptBy: user.name,
            billingExemptAt: markedAt,
            diagnosisFee: 0,
            diagnosisFeeStatus: 'not_applicable' as const,
            total: 0,
            quote: nextQuote,
            quoteApprovalDeadline: undefined,
            status: nextStatus,
            ...(clearInvoiceLink ? { invoiceId: undefined, invoiceDate: undefined } : {}),
            notes: `${r.notes || ''}\n[No-charge — ${reasonLabel} by ${user.name}] ${notes}`.trim(),
            statusHistory: [
              ...(r.statusHistory ?? []),
              {
                status: nextStatus,
                date: markedAt,
                note: `Marked no-charge (${reasonLabel}): ${notes}`,
                by: user.name,
              },
            ],
          }
        }))
  
        store.addAuditLog(
          'mark_repair_no_charge',
          repairId,
          `No-charge (${reasonLabel}) by ${user.name}: ${notes}`,
        )
        store.showToast(
          nextStatus === 'approved' && repair.status !== 'approved'
            ? `${repair.ref} marked no-charge — quote skipped, ready to repair`
            : `${repair.ref} marked no-charge — no quote or invoice for the customer`,
          'success',
        )
      },

    markUnrepairable: async (repairId, reason) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return
        }
        if (store.blockIfOutsourced(repairId, 'mark this repair unrepairable')) return
  
        // Free up any reserved serials and cancel linked financial documents
        store.setSerials(p => p.map(s => s.repairId === repairId ? {
          ...s,
          status: 'available',
          repairId: undefined
        } : s))
        if (repair.saleOrderId) {
            store.setSaleOrders(p => p.map(so => {
              if (so.id !== repair.saleOrderId) return so
              const updated = { ...so, status: 'cancelled' as const }
              sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
              return updated
            }))
        }
        // Linked invoices are immutable here. Finance handles cancellation or
        // credit/debit notes explicitly in the Invoice module.
  
        // The fee is stamped here, not just mentioned: the customer is told by
        // SMS below that it applies, and until this was written nothing on the
        // job carried the amount, so it could never be billed.
        const feePatch = diagnosisFeeExitPatch(repair, store.systemSettings)
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: 'unrepairable',
          notes: r.notes + `\n\nUnrepairable: ${reason}`,
          ...feePatch,
        } : r))
  
        // The message used to promise "No charges apply" unconditionally, in the
        // same action that leaves a diagnosis fee owing. Say what is actually
        // true, so the customer is not told one thing and invoiced another.
        const unrepairableFeeDue = feePatch.diagnosisFeeStatus === 'applicable'
          ? (feePatch.diagnosisFee ?? 0)
          : 0
  
        store.addAuditLog(
          'mark_unrepairable',
          repairId,
          `Marked unrepairable: ${reason}${unrepairableFeeDue > 0 ? ` — diagnosis fee KES ${unrepairableFeeDue} still billable` : ''}`,
        )
        
        // Notify customer
        if (repair.customerPhone) {
          try {
            const response = await fetch('/api/notifications/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'repair',
                customerName: repair.customerName,
                customerPhone: repair.customerPhone,
                repairRef: repair.ref,
                deviceName: repair.productName,
                message: `After thorough diagnosis, we regret to inform you that your device cannot be repaired due to: ${reason}\n\nYour device is ready for return.${unrepairableFeeDue > 0 ? ` A diagnosis fee of KES ${unrepairableFeeDue.toLocaleString('en-KE')} applies for the work carried out.` : ' No charges apply.'}`,
                options: { priority: 'high' }
              })
            })
  
            const result = await response.json()
  
            if (result.success) {
              store.showToast(`Marked as unrepairable • Customer notified via ${result.channel?.toUpperCase()}`, 'info')
            } else {
              store.showToast('Marked as unrepairable • Notification failed', 'error')
            }
          } catch {
            store.showToast('Marked as unrepairable • Notification error', 'error')
          }
        } else {
          store.showToast('Marked as unrepairable', 'info')
        }
      },

    returnToCustomer: (repairId, reason) => {
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return
        }
        if (store.blockIfOutsourced(repairId, 'return this device to customer')) return
        if (!returnableStatusesForPath(repair.repairPath).includes(repair.status)) {
          store.showToast('This repair cannot be returned at the current stage', 'error')
          return
        }
        if (!String(reason ?? '').trim()) {
          store.showToast('Enter a reason for returning the device', 'error')
          return
        }
  
        const resolved = resolveDiagnosisFee(repair, store.systemSettings)
        const feeAlreadyPaid = repair.diagnosisFeeStatus === 'paid' || !!repair.diagnosisFeePaidAt
        const feeStillDue =
          shouldChargeDiagnosisFee(repair) &&
          resolved.amount > 0 &&
          !!repair.diagnosis &&
          repair.diagnosisFeeStatus !== 'invoiced' &&
          repair.diagnosisFeeStatus !== 'waived' &&
          !feeAlreadyPaid
  
        const declineNote = isQuoteDeclinedReopenable(repair.status)
          ? ' (after quote decline)'
          : ''
        const feeNote = feeStillDue
          ? `\nDiagnosis fee still due — KES ${resolved.amount.toLocaleString('en-KE')}.`
          : feeAlreadyPaid
            ? `\nDiagnosis fee KES ${resolved.amount.toLocaleString('en-KE')} already paid.`
            : ''
  
        store.setRepairs(p => p.map(r => r.id === repairId ? {
          ...r,
          status: 'returned',
          deliveryActualDate: now(),
          notes: `${r.notes || ''}\n\nReturned to customer${declineNote}: ${reason.trim()}${feeNote}`.trim(),
          closedDate: now(),
          ...(feeStillDue ? {
            diagnosisFee: resolved.amount,
            diagnosisFeeStatus: 'applicable' as const,
            diagnosisStopped: true,
            diagnosisFeeBilling: r.diagnosisFeeBilling ?? resolved.billing,
            customerBillingType: r.customerBillingType ?? resolved.customerType,
          } : feeAlreadyPaid ? {
            diagnosisStopped: true,
          } : {}),
          quote: r.quote && isQuoteDeclinedReopenable(r.status)
            ? { ...r.quote, rejectionReason: r.quote.rejectionReason || reason.trim() }
            : r.quote,
        } : r))
  
        store.addAuditLog(
          'return_device',
          repairId,
          `Device returned${declineNote}: ${reason.trim()}${feeStillDue ? ` · diagnosis fee KES ${resolved.amount} still due` : ''}`,
        )
        store.showToast(
          feeStillDue
            ? `${repair.ref} returned — diagnosis fee KES ${resolved.amount.toLocaleString('en-KE')} still due`
            : `${repair.ref} returned to customer`,
          feeStillDue ? 'info' : 'success',
        )
      },

    leaveDeviceWithDeed: (repairId, opts) => {
        const user = store.currentUser()
        if (!user) return { ok: false, message: 'Not signed in' }
        if (!userCan(user, 'repair.manage')) {
          store.showToast('Only managers can record that a customer left a device with Deed', 'error')
          return { ok: false, message: 'Not authorized' }
        }
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return { ok: false, message: 'Repair not found' }
        }
        if (store.REPAIR_TERMINAL_STATUSES.includes(repair.status)) {
          store.showToast('This repair is already closed', 'error')
          return { ok: false, message: 'Already terminal' }
        }
        if (store.blockIfOutsourced(repairId, 'retain this device')) return { ok: false, message: 'Outsourced' }
  
        const convertToDonation = !!opts?.convertToDonation
        const convertToStock = !!opts?.convertToStock && !convertToDonation
        const extraNotes = String(opts?.notes ?? '').trim()
        const retainedAt = now()
  
        // Free reserved parts / cancel linked financial docs (same as unrepairable)
        store.setSerials(p => p.map(s => s.repairId === repairId ? {
          ...s,
          status: 'available',
          repairId: undefined,
        } : s))
        if (repair.saleOrderId) {
          store.setSaleOrders(p => p.map(so => {
            if (so.id !== repair.saleOrderId) return so
            const updated = { ...so, status: 'cancelled' as const }
            sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return updated
          }))
        }
        // Linked invoices are immutable here. Finance handles cancellation or
        // credit/debit notes explicitly in the Invoice module.
  
        let buyBackId: string | undefined
        let buyBackRef: string | undefined
        let donationId: string | undefined
        let donationRef: string | undefined
        let convertMessage = ''
  
        if (convertToStock || convertToDonation) {
          const converted = store.convertRetainedDeviceIntoInventory({
            repair,
            mode: convertToDonation ? 'donation' : 'buyback',
            notes: extraNotes,
            at: retainedAt,
            byName: user.name,
          })
          if (!converted.ok) {
            convertMessage = ` Retained without convert — ${converted.message}`
          } else if (converted.mode === 'buyback') {
            buyBackId = converted.id
            buyBackRef = converted.ref
            convertMessage = ` Converted to stock via ${converted.ref}.`
          } else {
            donationId = converted.id
            donationRef = converted.ref
            convertMessage = ` Converted to donation ${converted.ref}.`
          }
        }
  
        const linkRef = donationRef || buyBackRef
        const noteLine = `Customer left device with Deed${extraNotes ? `: ${extraNotes}` : ''}${linkRef ? ` → ${linkRef}` : ''}`
        const retainedRepair: RepairOrder = {
          ...repair,
          status: 'retained',
          closedDate: retainedAt,
          retainedDate: retainedAt,
          retainedBy: user.name,
          retainedBuyBackId: buyBackId,
          retainedBuyBackRef: buyBackRef,
          retainedDonationId: donationId,
          retainedDonationRef: donationRef,
          notes: `${repair.notes || ''}\n\n${noteLine}`.trim(),
          statusHistory: [
            ...(repair.statusHistory ?? []),
            { status: 'retained', date: retainedAt, note: noteLine, by: user.name },
          ],
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? retainedRepair : r))
        store.syncRepairToPortal(retainedRepair, noteLine)
        store.addAuditLog('retain_device', repairId, noteLine)
        store.showToast(`${repair.ref} retained by Deed.${convertMessage}`, 'success')
        return { ok: true, message: `Retained.${convertMessage}`, buyBackId, buyBackRef, donationId, donationRef }
      },

    convertRetainedRepairToDonation: (repairId, opts) => {
        const user = store.currentUser()
        if (!user) return { ok: false, message: 'Not signed in' }
        if (!userCan(user, 'repair.retained.donate')) {
          store.showToast('Not authorized to convert retained repairs', 'error')
          return { ok: false, message: 'Not authorized' }
        }
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return { ok: false, message: 'Repair not found' }
        }
        if (!canConvertRetainedRepair(repair)) {
          const msg = repair.status !== 'retained'
            ? 'Only retained repairs can be converted'
            : 'This repair was already converted into stock or a donation'
          store.showToast(msg, 'error')
          return { ok: false, message: msg }
        }
        const at = now()
        const notes = String(opts?.notes ?? '').trim()
        const converted = store.convertRetainedDeviceIntoInventory({
          repair,
          mode: 'donation',
          notes,
          at,
          byName: user.name,
        })
        if (!converted.ok) {
          store.showToast(converted.message, 'error')
          return { ok: false, message: converted.message }
        }
        const noteLine = `Converted retained device to donation ${converted.ref}${notes ? ` — ${notes}` : ''}`
        const updated: RepairOrder = {
          ...repair,
          retainedDonationId: converted.id,
          retainedDonationRef: converted.ref,
          notes: `${repair.notes || ''}\n\n${noteLine}`.trim(),
          statusHistory: [
            ...(repair.statusHistory ?? []),
            { status: 'retained', date: at, note: noteLine, by: user.name },
          ],
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? updated : r))
        store.syncRepairToPortal(updated, noteLine)
        store.addAuditLog('retain_to_donation', repairId, noteLine)
        store.showToast(`${repair.ref} → donation ${converted.ref}`, 'success')
        return { ok: true, message: noteLine, donationId: converted.id, donationRef: converted.ref }
      },

    convertRetainedRepairToBuyBack: (repairId, opts) => {
        const user = store.currentUser()
        if (!user) return { ok: false, message: 'Not signed in' }
        if (!userCan(user, 'repair.retained.donate')) {
          store.showToast('Not authorized to convert retained repairs', 'error')
          return { ok: false, message: 'Not authorized' }
        }
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return { ok: false, message: 'Repair not found' }
        }
        if (!canConvertRetainedRepair(repair)) {
          const msg = repair.status !== 'retained'
            ? 'Only retained repairs can be converted'
            : 'This repair was already converted into stock or a donation'
          store.showToast(msg, 'error')
          return { ok: false, message: msg }
        }
        const at = now()
        const notes = String(opts?.notes ?? '').trim()
        const converted = store.convertRetainedDeviceIntoInventory({
          repair,
          mode: 'buyback',
          notes,
          at,
          byName: user.name,
        })
        if (!converted.ok) {
          store.showToast(converted.message, 'error')
          return { ok: false, message: converted.message }
        }
        const noteLine = `Converted retained device to buy-back ${converted.ref}${notes ? ` — ${notes}` : ''}`
        const updated: RepairOrder = {
          ...repair,
          retainedBuyBackId: converted.id,
          retainedBuyBackRef: converted.ref,
          notes: `${repair.notes || ''}\n\n${noteLine}`.trim(),
          statusHistory: [
            ...(repair.statusHistory ?? []),
            { status: 'retained', date: at, note: noteLine, by: user.name },
          ],
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? updated : r))
        store.syncRepairToPortal(updated, noteLine)
        store.addAuditLog('retain_to_buyback', repairId, noteLine)
        store.showToast(`${repair.ref} → buy-back ${converted.ref}`, 'success')
        return { ok: true, message: noteLine, buyBackId: converted.id, buyBackRef: converted.ref }
      },

    createTradeInFromRepair: (repairId, opts) => {
        const user = store.currentUser()
        if (!user) return { ok: false, message: 'Not signed in' }
        if (!userCan(user, 'repair.manage')) {
          store.showToast('Only managers can create a trade-in from a repair', 'error')
          return { ok: false, message: 'Not authorized' }
        }
        const repair = store.repairs.find(r => r.id === repairId)
        if (!repair) {
          store.showToast('Repair not found', 'error')
          return { ok: false, message: 'Repair not found' }
        }
        if (!canCreateTradeInFromRepair(repair)) {
          const msg = repair.retainedBuyBackId || repair.retainedDonationId
            ? 'This repair is already linked to a buy-back or donation'
            : 'Trade-in is not available for this repair status'
          store.showToast(msg, 'error')
          return { ok: false, message: msg }
        }
        if (store.blockIfOutsourced(repairId, 'create a trade-in for this device')) {
          return { ok: false, message: 'Outsourced' }
        }
  
        const unitPrice = Number(opts.unitPrice)
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          store.showToast('Enter a valid trade-in offer amount', 'error')
          return { ok: false, message: 'Invalid unit price' }
        }
  
        const product = findRepairCatalogProduct(store.prodRef.current, repair)
        if (!product) {
          store.showToast('Link a catalog product on the repair first', 'error')
          return { ok: false, message: 'Missing catalog product' }
        }
  
        const at = now()
        const condition = opts.condition ?? buyBackConditionFromRepair(repair.deviceCondition)
        const extraNotes = String(opts.notes ?? '').trim()
  
        let serialId: string | undefined
        // No serial on the repair: an intake tag, and With Issues to identify it.
        let tagged = false
        if (product.requiresSerial || repair.serialNumber?.trim()) {
          const matched = matchRepairDeviceSerial(store.serialRef.current, product.id, repair)
          if ('error' in matched) {
            store.showToast(matched.error, 'error')
            return { ok: false, message: matched.error }
          }
          tagged = !!matched.tagged
          if (matched.existing) {
            serialId = matched.existing.id
            if (matched.existing.status !== 'sold' && matched.existing.location !== 'customer') {
              store.setSerials(p => p.map(s => s.id === matched.existing!.id
                ? { ...s, status: 'sold' as const, location: 'customer' as LocationId, soldDate: s.soldDate || at }
                : s))
            }
          } else {
            const newSerial: SerialNumber = {
              id: uid(),
              serial: matched.serialText,
              productId: product.id,
              productName: product.name,
              sku: product.sku,
              location: 'customer',
              status: 'sold',
              receivedDate: at,
              soldDate: at,
              barcode: tagged ? matched.serialText : store.buildInventoryBarcodeForProduct(product.id, matched.serialText),
              ...(tagged ? { identityPending: true, intakeTag: matched.serialText } : {}),
            } as SerialNumber
            store.setSerials(p => [...p, newSerial])
            sync('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
            serialId = newSerial.id
          }
        }
        if (product.requiresSerial && !serialId) {
          store.showToast('Serialized product needs a serial number', 'error')
          return { ok: false, message: 'Missing serial' }
        }
  
        // Release reserved parts / cancel linked docs when leaving an open job
        const alreadyTerminal = store.REPAIR_TERMINAL_STATUSES.includes(repair.status)
        if (!alreadyTerminal || repair.status === 'declined' || repair.status === 'unrepairable') {
          store.setSerials(p => p.map(s => s.repairId === repairId ? {
            ...s,
            status: 'available',
            repairId: undefined,
          } : s))
          if (repair.saleOrderId) {
            store.setSaleOrders(p => p.map(so => {
              if (so.id !== repair.saleOrderId) return so
              if (so.status === 'cancelled') return so
              const updated = { ...so, status: 'cancelled' as const }
              sync(`/api/sale-orders/${repair.saleOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
              return updated
            }))
          }
        // Linked invoices are immutable here. Finance handles cancellation or
        // credit/debit notes explicitly in the Invoice module.
        }
  
        const bb: BuyBack = {
          id: uid(),
          ref: store.tradeInRef('BBK'),
          customerId: repair.customerId,
          customerName: repair.customerName,
          repairId: repair.id,
          repairRef: repair.ref,
          status: 'draft',
          date: at,
          lines: [{
            id: uid(),
            productId: product.id,
            productName: product.name,
            qty: 1,
            serialIds: serialId ? [serialId] : [],
            condition,
            unitPrice,
            notes: `Trade-in from repair ${repair.ref}`,
          }],
          total: unitPrice,
          destinationLocation: tagged ? 'shop' : 'warehouse',
          notes: `Trade-in after evaluation from repair ${repair.ref}${extraNotes ? ` — ${extraNotes}` : ''}`,
        }
        store.setBuyBacks(p => [bb, ...p])
  
        const noteLine = `Trade-in after evaluation → draft ${bb.ref} (${store.fmtKes(unitPrice)}, ${condition})${extraNotes ? ` — ${extraNotes}` : ''}`
        const retainedRepair: RepairOrder = {
          ...repair,
          status: 'retained',
          closedDate: repair.closedDate || at,
          retainedDate: repair.retainedDate || at,
          retainedBy: repair.retainedBy || user.name,
          retainedBuyBackId: bb.id,
          retainedBuyBackRef: bb.ref,
          notes: `${repair.notes || ''}\n\n${noteLine}`.trim(),
          statusHistory: [
            ...(repair.statusHistory ?? []),
            { status: 'retained', date: at, note: noteLine, by: user.name },
          ],
        }
        store.setRepairs(p => p.map(r => r.id === repairId ? retainedRepair : r))
        store.syncRepairToPortal(retainedRepair, noteLine)
        store.addAuditLog('repair_tradein', repairId, noteLine)
  
        store.notifyUsers({
          recipientRoles: ['director', 'finance_officer'],
          recipients: userIdsWithRoles(store.users, ['director', 'finance_officer'], user.id),
          type: 'system',
          title: `Trade-in approval needed: ${bb.ref}`,
          body: `${repair.ref} — ${product.name} offered at ${store.fmtKes(unitPrice)}. Approve payout in Trade-in.`,
          module: 'after_sales',
          path: '?tab=tradein',
          icon: '💰',
          entityKey: `buyback:${bb.id}:from_repair`,
          excludeUserId: user.id,
        })
  
        store.showToast(`${repair.ref} → trade-in draft created. Approve, then pay or add as credit in Trade-in.`, 'success')
        return { ok: true, message: noteLine, buyBackId: bb.id, buyBackRef: bb.ref }
      },
  }
}
