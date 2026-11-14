// @ts-nocheck -- moved unchanged from the provider, which is not type-checked yet
import { userCan } from '@/lib/auth/can'
import type { KilimallOrder, KilimallDispatch, KilimallSettlement, KilimallSettlementLine, Company, ContactPerson, Contact, Opportunity, OpportunityActivity, CustomerContract, Quote, QuoteLineItem, SaleOrder, POSSession, POSOrder } from '../sales'
import { uid, now } from '../ids'
import { noteStoreChanges } from '@/lib/store-freshness'
import { fetchAndApplyStoreKeys } from '@/lib/client-store-hydrate'
import { formatCustomerAddress } from '@/lib/sync-customer-documents'
import { sync, rememberSaleOrdersSnapshot, _pendingSync, addDirtyKey, flushServerSync } from '../sync'
import { contactFromPersonInput } from '@/lib/contact-person-derive'
import { allocateDocNumberSync } from '@/lib/doc-numbers'
import { normalizeOpportunityForClient } from '@/lib/opportunity-normalization'
import { documentMoneySnapshot, FUNCTIONAL_CURRENCY } from '@/lib/currency'
import { resolveListPrice } from '@/lib/pricing/pricelist'
import { createApprovalRequest, approvalRecipientIds, computeConfirmBackorderLines, APPROVAL_RULES, approvalDocumentPath, processApproval, getPendingApprovals } from '@/lib/sales-approvals'
import type { InvoiceLine, Invoice, JournalEntryLine, JournalEntry, CustomerCredit } from '../finance'
import { customerPaymentTermsDays } from '@/lib/due-date'
import { normalizeSaleOrdersForClient, saleOrderLooksConfirmed, isOpenDeliveryStatus, normalizeDeliveryStatus, splitDeliveryForBackorder, remainingUndeliveredByProduct, openDeliveryDemandByProduct, initialDeliveryState, hasValidatedDeliveryForInvoice, saleOrderCancelBlockers, canReverseConfirmedSale, isQuotationStage, isOpenInvoice, invoiceResidual, invoiceDocState } from '@/lib/odoo-sales-flow'
import { isSaleOrderDraftEditing, saleOrderLinesFingerprint, markSaleOrderDraftEdit, stampSaleOrderPersisted } from '@/lib/sale-order-draft-edits'
import { scheduleDraftSaleOrderLinePersist, isSaleOrderHardSaving, beginHardSaleOrderPersist, waitForDraftSaleOrderPersistIdle, endHardSaleOrderPersist } from '@/lib/sale-order-draft-persist'
import { persistClientStoreValue } from '@/lib/client-store-cache'
import { resolveAddSaleOrderLineTaxRate } from '@/lib/sale-order-line-tax'
import { resolveProductAccounts, aggregateLinesByAccount } from '@/lib/product-accounts'
import { saleOrderPersistBody } from '@/lib/sale-order-persist'
import { pairOrderLinesWithDeliveryLines, sumQtyByProductId, planPrepareDeliveryLines, assertSerialUsableForDeliveryPrepare, allocateDeliveredQtyToOrderLines } from '@/lib/delivery-prepare'
import { applyConfirmLineSelection, confirmSelectionHasProduct } from '@/lib/sales/confirm-quotation'
import { calcSaleOrderTotals } from '@/lib/sales/line-calc'
import { canOverrideCustomerCredit, evaluateCustomerCreditGate, isPayOnReceipt } from '@/lib/customer-credit-gate'
import { isRepairLinkedSaleOrder } from '@/lib/sales/commission-closer'
import { computeSaleOrderApprovalTriggers } from '@/lib/sales/margin-approval'
import { isSalesConfirmGatingApproval, actorSatisfiesApprovalRoles } from '@/lib/sales-approval-rules'
import type { ApprovalRequest, StockReservation } from '@/lib/sales-flow-types'
import { isDirector } from '@/lib/auth/roles'
import { isDeliveryNoteLine, isNonStockSaleLine } from '@/lib/sales/non-stock-line'
import type { LocationId } from '../core'
import { isSerialTracking, inferTrackingMethod, isStockTracked } from '@/lib/inventory-identifiers'
import { resolveBulkDeliverySourceLocation, formatStockByLocation } from '@/lib/inventory/delivery-source'
import type { Delivery, DeliveryLine } from '../delivery'
import { canApproveInventoryAction, canCreateCustomerInvoiceFromSOAction, canManageFullFinanceAction } from '../permissions'
import type { Warranty } from '../repairs'
import { resolveWarrantyMonths, addWarrantyMonths } from '@/lib/warranty-period'
import { trimSaleOrderLinesToDelivered } from '@/lib/sales/fulfillment-trim'
import { fulfillmentSaleOrderPatch } from '@/lib/sales/fulfillment-sale-order-patch'
import { normalizeCreateInvoiceMode, isDownPaymentMode } from '@/lib/sales/down-payment'
import { resolveInvoicePolicy } from '@/lib/sales/invoice-policy'
import { hasActivePosSession, resolveOpenPosSessionId, posOrdersForSession, isPosBankPayment } from '@/lib/pos-session'
import { accountLine, bankAccountIdForMethod, bankAccountLabel, buildCustomerCreditJournal } from '../journals'
import { isProvisionalDocRef } from '@/lib/doc-number-repair'
import { canApplyCustomerCredit } from '@/lib/finance-controls'
import { customerCreditBalance } from '@/lib/customer-credit-view'
import { loyaltyPointsEarned } from '@/lib/loyalty'
import { nextPosTicketRef } from '@/lib/pos-orders-merge'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** sales actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createSalesActions(store: StoreDeps): Pick<AppState, 'createKilimallOrder' | 'updateKilimallOrder' | 'returnKilimallOrder' | 'confirmKilimallDispatch' | 'createKilimallSettlement' | 'updateKilimallSettlement' | 'reconcileKilimallSettlement' | 'matchKilimallSettlementLine' | 'addContact' | 'updateContact' | 'deleteContact' | 'createCompany' | 'updateCompany' | 'deleteCompany' | 'createContactPerson' | 'updateContactPerson' | 'deleteContactPerson' | 'createOpportunity' | 'ingestOpportunity' | 'updateOpportunity' | 'moveOpportunityStage' | 'markOpportunityWon' | 'markOpportunityLost' | 'deleteOpportunity' | 'logActivity' | 'completeActivity' | 'createCustomerContract' | 'updateCustomerContract' | 'renewCustomerContract' | 'terminateCustomerContract' | 'createQuote' | 'updateQuote' | 'addQuoteLine' | 'removeQuoteLine' | 'sendQuote' | 'acceptQuote' | 'rejectQuote' | 'convertQuoteToSaleOrder' | 'convertRepairQuoteToSOAndInvoice' | 'reviseQuote' | 'deleteQuote' | 'createSaleOrder' | 'updateSaleOrder' | 'addSOLine' | 'assignSerialToSOLine' | 'assignSerialsToSOLine' | 'unassignSerialFromSOLine' | 'removeSOLine' | 'moveSOLine' | 'addSOSection' | 'confirmSO' | 'ensureWaitingDeliveryForSO' | 'markQuotationSent' | 'setSaleOrderLock' | 'prepareDelivery' | 'reverseDelivery' | 'validateDelivery' | 'markDeliveryNoteGenerated' | 'updateDelivery' | 'createInvoiceFromSO' | 'deleteSaleOrder' | 'resetSOToDraft' | 'cancelSO' | 'createNewSOVersion' | 'openPOSSession' | 'closePOSSession' | 'createPOSOrder' | 'checkDiscountApproval' | 'requestApproval' | 'checkCreditLimit' | 'getCustomerCreditStatus' | 'issueCreditNoteFromSaleOrder' | 'approveRequest' | 'getPendingApprovalsForUser'> {
  return {
    createKilimallOrder: async (p) => {
        const user = store.currentUser()
        if (!userCan(user, 'sales.kilimall.orders')) {
          store.showToast('Unauthorized to create Kilimall orders', 'error')
          return null
        }
  
        const kilimallRef = p.kilimallRef.trim()
        const qty = Number(p.qty)
        const unitPrice = Number(p.unitPrice)
        if (!kilimallRef || !p.productId || !p.productName.trim()) {
          store.showToast('Kilimall reference and product are required', 'error')
          return null
        }
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
          store.showToast('Quantity and unit price must be greater than zero', 'error')
          return null
        }
        if (store.kilimallOrdersRef.current.some(order => order.kilimallRef.trim().toLowerCase() === kilimallRef.toLowerCase())) {
          store.showToast(`Kilimall order ${kilimallRef} already exists`, 'error')
          return null
        }
  
        const ref = await store.fetchNextKilimallRef('kilimall_order')
        if (!ref) { store.showToast('Could not get an order number from the server. Check your connection and try again.', 'error'); return null }
        if (store.kilimallOrdersRef.current.some(order => order.kilimallRef.trim().toLowerCase() === kilimallRef.toLowerCase())) {
          store.showToast(`Kilimall order ${kilimallRef} already exists`, 'error')
          return null
        }
        const order: KilimallOrder = {
          ...p,
          kilimallRef,
          qty,
          unitPrice,
          total: Math.round(qty * unitPrice * 100) / 100,
          id: uid(),
          ref,
          status: 'pending',
          createdDate: now(),
          createdBy: store.currentUserId ?? 'system',
        }
        store.setKilimallOrders(prev => [order, ...prev])
        store.addAuditLog('kilimall_order_create', order.id, `Order ${order.ref} — ${order.kilimallRef}`)
        return order
      },

    updateKilimallOrder: (id, p) => store.setKilimallOrders(prev => prev.map(o => o.id === id ? { ...o, ...p } : o)),

    returnKilimallOrder: async (id, input) => {
        try {
          const res = await fetch(`/api/kilimall/orders/${encodeURIComponent(id)}/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          })
          const data = await res.json().catch(() => null) as { error?: string; order?: KilimallOrder } | null
          if (!res.ok || !data?.order) {
            store.showToast(data?.error || 'Could not record the return', 'error')
            return false
          }
          // The server changed the order and the stock: take its copies.
          const keys = ['deed_kilimallOrders', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_products']
          noteStoreChanges(Object.fromEntries(keys.map(k => [k, new Date().toISOString()])))
          void fetchAndApplyStoreKeys({ keys, etagStorageKey: 'deed_kilimall_return' })
          const o = data.order
          store.showToast(input.outcome === 'exchange'
            ? `${o.ref} returned — back in Pending Dispatch to ship a replacement`
            : `${o.ref} returned — device is in the warehouse awaiting inspection`)
          store.addAuditLog('kilimall_return', o.ref, `Kilimall return (${input.outcome}, ${input.condition}): ${input.reason}`)
          return true
        } catch {
          store.showToast('Could not record the return. Check your connection and try again.', 'error')
          return false
        }
      },

    confirmKilimallDispatch: async (orderId, serialId, serialNumber, opts) => {
        const user = store.currentUser()
        if (!userCan(user, 'sales.kilimall.dispatch')) {
          store.showToast('Unauthorized to dispatch orders', 'error'); return null;
        }
        const order = store.kilimallOrdersRef.current.find(o => o.id === orderId)
        if (!order) { store.showToast('Order not found', 'error'); return null }
        if (order.status !== 'pending') { store.showToast('Order already dispatched', 'error'); return null }
        const serial = store.serialRef.current.find(s => s.id === serialId)
        if (!serial) { store.showToast('Serial not found in inventory', 'error'); return null }
        if (serial.status !== 'available') { store.showToast('Serial is not available', 'error'); return null }
  
        const shipProductId = opts?.fulfilledProductId || order.productId
        if (serial.productId !== shipProductId) {
          store.showToast('Serial does not belong to the product being shipped', 'error'); return null
        }
  
        const shipProduct = store.prodRef.current.find(p => p.id === shipProductId)
        const shipProductName = shipProduct?.name || serial.productName || order.productName
        const isSubstitution = shipProductId !== order.productId
        if (isSubstitution && !opts?.fulfilledProductId) {
          store.showToast('Select the product being shipped for a substitution', 'error'); return null
        }
  
        // The dispatch number comes from the server's counter (a number lost to a failed
        // dispatch is harmless; a duplicate is not), before any stock moves.
        const dispatchRef = await store.fetchNextKilimallRef('kilimall_dispatch')
        if (!dispatchRef) { store.showToast('Could not get a dispatch number from the server. Check your connection and try again.', 'error'); return null }
  
        // Authoritative stock out on the server first (serial -> sold, product on-hand,
        // stock move, COGS), exactly as a till sale does. Without this the serial was only
        // flagged locally and the product's stock never fell.
        try {
          const res = await fetch('/api/inventory/apply-pos-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderRef: order.ref,
              reasonLabel: 'Kilimall',
              lines: [{
                productId: shipProductId,
                productName: shipProductName,
                qty: 1,
                serialId,
                serialNumber,
                sourceLocation: 'warehouse',
              }],
            }),
          })
          if (!res.ok) {
            const payload = await res.json().catch(() => null) as { error?: string } | null
            store.showToast(payload?.error || 'Kilimall stock update failed', 'error')
            return null
          }
        } catch {
          store.showToast('Could not apply Kilimall stock on server', 'error')
          return null
        }
        // A second click while the request was in flight must not dispatch twice.
        const stillPending = store.kilimallOrdersRef.current.find(o => o.id === orderId)
        if (stillPending && stillPending.status !== 'pending') { store.showToast('Order already dispatched', 'error'); return null }
  
        const dispatch: KilimallDispatch = {
          id: uid(), ref: dispatchRef, date: opts?.dispatchDate || now(),
          orderId: order.id, orderRef: order.ref, kilimallRef: order.kilimallRef,
          productId: shipProductId, productName: shipProductName,
          orderedProductId: isSubstitution ? order.productId : undefined,
          orderedProductName: isSubstitution ? order.productName : undefined,
          isSubstitution: isSubstitution || undefined,
          serialId, serialNumber, status: 'dispatched',
          courier: opts?.courier?.trim() || undefined,
          dispatchDate: opts?.dispatchDate || undefined,
          trackingReference: opts?.trackingReference?.trim() || undefined,
          notes: [
            isSubstitution
              ? (opts?.substitutionReason?.trim() || `Substituted for ordered ${order.productName}`)
              : '',
            opts?.dispatchNotes?.trim() || '',
          ].filter(Boolean).join(' · ') || undefined,
          createdBy: store.currentUserId ?? 'system', createdDate: now(),
        }
        store.setKilimallDispatches(prev => [dispatch, ...prev])
        store.setKilimallOrders(prev => prev.map(o => o.id === orderId
          ? {
              ...o,
              status: 'dispatched' as const,
              dispatchId: dispatch.id,
              serialId,
              serialNumber,
              fulfilledProductId: isSubstitution ? shipProductId : undefined,
              fulfilledProductName: isSubstitution ? shipProductName : undefined,
              substitutionReason: isSubstitution
                ? (opts?.substitutionReason?.trim() || undefined)
                : undefined,
            }
          : o))
        store.setSerials(prev => prev.map(s => s.id === serialId ? { ...s, status: 'sold', location: 'customer', soldDate: now() } : s))
        store.setProducts(prev => prev.map(x => x.id === shipProductId ? { ...x, stockQty: Math.max(0, x.stockQty - 1) } : x))
        const toastMsg = isSubstitution
          ? `Dispatched ${order.ref} — shipped ${shipProductName} (ordered ${order.productName})`
          : `Dispatched ${order.ref} — serial ${serialNumber}`
        store.showToast(toastMsg)
        store.requestWarrantySync()
        store.addAuditLog(
          'kilimall_dispatch',
          dispatch.id,
          isSubstitution
            ? `Dispatch ${dispatch.ref} for ${order.ref}: substituted ${order.productName} → ${shipProductName}`
            : `Dispatch ${dispatch.ref} for ${order.ref}`,
        )
        return dispatch
      },

    createKilimallSettlement: async (p) => {
        const user = store.currentUser()
        if (!userCan(user, 'sales.kilimall.settlements')) {
          store.showToast('Unauthorized to manage settlements', 'error')
          return null
        }
  
        const grossAmount = Number(p.grossAmount)
        const deductions = Number(p.deductions)
        const netPaid = Number(p.netPaid)
        const normalizedRefs = p.lines.map(line => line.kilimallRef.trim().toLowerCase())
        if (!p.weekPeriod.trim() || !p.weekStart || !p.weekEnd || p.weekEnd < p.weekStart) {
          store.showToast('Enter a valid settlement period and date range', 'error')
          return null
        }
        if (![grossAmount, deductions, netPaid].every(Number.isFinite) || grossAmount <= 0 || deductions < 0 || netPaid < 0) {
          store.showToast('Settlement amounts cannot be negative and gross must be greater than zero', 'error')
          return null
        }
        if (Math.abs(grossAmount - deductions - netPaid) > 1) {
          store.showToast('Net paid must equal gross amount less deductions', 'error')
          return null
        }
        if (
          p.lines.length === 0 ||
          p.lines.some(line => !line.kilimallRef.trim() || !Number.isFinite(Number(line.amount)) || Number(line.amount) <= 0)
        ) {
          store.showToast('Every settlement line needs an order reference and a positive amount', 'error')
          return null
        }
        if (new Set(normalizedRefs).size !== normalizedRefs.length) {
          store.showToast('A Kilimall order can appear only once in a settlement', 'error')
          return null
        }
        if (store.kilimallSettlementsRef.current.some(existing =>
          p.paymentRef && existing.paymentRef?.trim().toLowerCase() === p.paymentRef.trim().toLowerCase()
        )) {
          store.showToast('This settlement payment reference already exists', 'error')
          return null
        }
  
        const settlementRef = await store.fetchNextKilimallRef('kilimall_settlement')
        if (!settlementRef) { store.showToast('Could not get a settlement number from the server. Check your connection and try again.', 'error'); return null }
        const settlement: KilimallSettlement = {
          ...p,
          grossAmount,
          deductions,
          netPaid,
          lines: p.lines.map(line => ({
            ...line,
            kilimallRef: line.kilimallRef.trim(),
            amount: Number(line.amount),
          })),
          id: uid(),
          ref: settlementRef,
          status: 'draft',
          createdDate: now(),
          createdBy: store.currentUserId ?? 'system',
        }
        store.setKilimallSettlements(prev => [settlement, ...prev])
        return settlement
      },

    updateKilimallSettlement: (id, p) => store.setKilimallSettlements(prev => prev.map(settlement =>
        settlement.id === id ? { ...settlement, ...p } : settlement
      )),

    reconcileKilimallSettlement: (settlementId) => {
        const user = store.currentUser()
        if (!userCan(user, 'sales.kilimall.settlements')) {
          store.showToast('Unauthorized to reconcile settlements', 'error')
          return
        }
        const settlement = store.kilimallSettlementsRef.current.find(item => item.id === settlementId)
        if (!settlement) return
  
        const orders = store.kilimallOrdersRef.current
        const updatedLines: KilimallSettlementLine[] = settlement.lines.map(line => {
          const normalizedRef = line.kilimallRef.trim().toLowerCase()
          const match = orders.find(order => order.kilimallRef.trim().toLowerCase() === normalizedRef)
          if (!match) return { ...line, status: 'unmatched', orderId: undefined, erpAmount: undefined }
          if (match.settlementId && match.settlementId !== settlement.id) {
            return {
              ...line,
              status: 'unmatched',
              orderId: match.id,
              erpAmount: match.total,
              notes: `Already linked to ${match.settlementRef || 'another settlement'}`,
            }
          }
          if (match.status === 'returned') {
            return { ...line, status: 'returned', orderId: match.id, erpAmount: match.total }
          }
          const difference = Math.abs(Number(line.amount) - Number(match.total))
          if (difference > 1) {
            return { ...line, status: 'mismatch', orderId: match.id, erpAmount: match.total }
          }
          return { ...line, status: 'matched', orderId: match.id, erpAmount: match.total }
        })
  
        const matchedOrderIds = new Set(
          updatedLines.filter(line => line.status === 'matched' && line.orderId).map(line => line.orderId as string),
        )
        store.setKilimallOrders(prev => prev.map(order => {
          if (matchedOrderIds.has(order.id)) {
            return { ...order, settlementId: settlement.id, settlementRef: settlement.ref }
          }
          if (order.settlementId === settlement.id) {
            const { settlementId: _settlementId, settlementRef: _settlementRef, ...unlinked } = order
            return unlinked
          }
          return order
        }))
  
        const allMatched = updatedLines.length > 0 && updatedLines.every(line => line.status === 'matched')
        const nextStatus: KilimallSettlement['status'] = allMatched ? 'reconciled' : 'partially_matched'
        store.setKilimallSettlements(prev => prev.map(item =>
          item.id === settlementId ? { ...item, lines: updatedLines, status: nextStatus } : item
        ))
  
        const matched = updatedLines.filter(line => line.status === 'matched').length
        const unresolved = updatedLines.length - matched
        store.showToast(
          allMatched
            ? `Reconciliation complete — ${matched}/${updatedLines.length} matched`
            : `Partially matched — ${matched} matched, ${unresolved} need review`,
          allMatched ? 'success' : 'info',
        )
        store.addAuditLog(
          'kilimall_reconcile',
          settlementId,
          `Settlement ${settlement.ref}: ${matched}/${updatedLines.length} matched`,
        )
      },

    matchKilimallSettlementLine: (settlementId, lineId, orderId, note) => {
        const user = store.currentUser()
        if (!userCan(user, 'sales.kilimall.settlements')) {
          store.showToast('Unauthorized to match settlement lines', 'error')
          return false
        }
        const settlement = store.kilimallSettlementsRef.current.find(item => item.id === settlementId)
        const line = settlement?.lines.find(item => item.id === lineId)
        const order = store.kilimallOrdersRef.current.find(item => item.id === orderId)
        if (!settlement || !line || !order) {
          store.showToast('Settlement line or order was not found', 'error')
          return false
        }
        if (order.settlementId && order.settlementId !== settlement.id) {
          store.showToast(`Order is already linked to ${order.settlementRef || 'another settlement'}`, 'error')
          return false
        }
        if (Math.abs(line.amount - order.total) > 1 && !note.trim()) {
          store.showToast('Add a note explaining the amount difference', 'error')
          return false
        }
  
        const updatedLines = settlement.lines.map(item => item.id === lineId ? {
          ...item,
          status: 'matched' as const,
          orderId: order.id,
          erpAmount: order.total,
          notes: note.trim() || undefined,
          manuallyMatched: true,
        } : item)
        const allMatched = updatedLines.every(item => item.status === 'matched')
        store.setKilimallSettlements(prev => prev.map(item => item.id === settlementId ? {
          ...item,
          lines: updatedLines,
          status: allMatched ? 'reconciled' : 'partially_matched',
        } : item))
        store.setKilimallOrders(prev => prev.map(item =>
          item.id === order.id
            ? { ...item, settlementId: settlement.id, settlementRef: settlement.ref }
            : item
        ))
        store.addAuditLog(
          'kilimall_manual_match',
          settlementId,
          `Settlement ${settlement.ref}: ${line.kilimallRef} matched to ${order.ref}`,
        )
        store.showToast('Settlement line matched', 'success')
        return true
      },

    // ── Contacts ─────────────────────────────────────────────────────────────
    // ── Legacy Contacts ────────────────────────────────────────────────────────
    addContact: async (c) => {
        const res = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c),
        })
        if (!res.ok) {
          store.showToast('Failed to create contact', 'error')
          throw new Error('Failed to create contact')
        }
        const contact = await res.json()
        store.setContacts(prev => prev.some(item => item.id === contact.id)
          ? prev.map(item => item.id === contact.id ? contact : item)
          : [contact, ...prev])
        store.showToast(`${contact.name} ${res.status === 201 ? 'added' : 'updated'}`, 'success')
        return contact
      },

    updateContact: async (id, p) => {
        const res = await fetch(`/api/contacts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        })
        if (!res.ok) {
          store.showToast('Failed to update contact', 'error')
          throw new Error('Failed to update contact')
        }
        const updated = await res.json()
        store.setContacts(prev => prev.map(c => c.id === id ? updated : c))
        const phone = String(updated.phone || updated.mobile || '').trim()
        const email = String(updated.email || '').trim()
        store.syncCustomerIdentityToDocuments({
          contactId: id,
          identity: {
            name: String(updated.name || '').trim(),
            email: email || undefined,
            phone: phone || undefined,
            address: formatCustomerAddress(updated),
            customerId: id,
          },
        })
        store.showToast('Contact updated', 'success')
        return updated
      },

    deleteContact: async (id) => {
        const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
        if (res.ok) {
          store.setContacts(p => p.filter(c => c.id !== id))
          store.showToast('Contact deleted', 'success')
        }
      },

    // ── CRM - Companies ────────────────────────────────────────────────────────
    createCompany: (c) => {
        const user = store.currentUser()
        const company: Company = {
          ...c,
          id: uid(),
          creditUsed: 0,
          createdDate: now(),
          createdBy: user?.username ?? 'system',
        }
        store.setCompanies(p => [company, ...p])
        sync('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(company) })
        store.addAuditLog('create_company', company.name, `Company ${company.name} added to CRM`)
        store.showToast(`Company ${company.name} created`)
        return company
      },

    updateCompany: (id, p) => {
        store.setCompanies(prev => {
          const next = prev.map(c => c.id === id ? { ...c, ...p } : c)
          const updated = next.find(c => c.id === id)
          if (updated) sync(`/api/companies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        store.addAuditLog('update_company', id, `Company updated`)
        store.showToast('Company updated')
      },

    deleteCompany: (id) => {
        const company = store.companies.find(c => c.id === id)
        store.setCompanies(p => p.filter(c => c.id !== id))
        sync(`/api/companies/${id}`, { method: 'DELETE' })
        store.addAuditLog('delete_company', id, `Company ${company?.name} deleted`)
        store.showToast('Company deleted')
      },

    // ── CRM - Contact Persons ──────────────────────────────────────────────────
    //
    // A contact person is an individual contact with an employer, so all three
    // actions write to the contacts directory. They used to write a separate
    // contact_persons table that no other screen read, which is why a person
    // added on the company form never appeared on that company's detail panel.
    createContactPerson: (c) => {
        const companyId = c.clientId || c.companyId || ''
        const fullName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()
        if (!companyId) {
          store.showToast('Pick a company before adding a contact person', 'error')
          return null as unknown as ContactPerson
        }
        if (!fullName) {
          store.showToast('A contact person needs a name', 'error')
          return null as unknown as ContactPerson
        }
  
        const existing = store.contactPersons.find(person =>
          person.clientId === companyId &&
          (
            (c.email && person.email?.trim().toLowerCase() === c.email.trim().toLowerCase()) ||
            (c.phone && person.phone?.replace(/\D/g, '').slice(-9) === c.phone.replace(/\D/g, '').slice(-9)) ||
            person.fullName.trim().toLowerCase() === fullName.toLowerCase()
          )
        )
  
        const id = existing?.id ?? uid()
        const payload = contactFromPersonInput({
          id,
          companyId,
          fullName,
          jobTitle: c.jobTitle,
          email: c.email,
          phone: c.phone,
          mobile: c.mobile,
          notes: c.notes,
        })
  
        // The directory write is the record. It is fire-and-forget only in the
        // sense that the caller is not awaited — failures are surfaced, never
        // swallowed the way the old contact-person sync did.
        void (existing
          ? store.storeCtxRef.current!.updateContact(id, payload as Partial<Contact>)
          : store.storeCtxRef.current!.addContact(payload as Omit<Contact, 'id' | 'createdAt'>)
        ).catch(() => {
          store.showToast(`${fullName} could not be saved — reopen the company and try again`, 'error')
        })
  
        if (!existing) {
          store.addAuditLog('create_contact_person', fullName, `Contact person added for ${c.companyName ?? companyId}`)
        }
        store.showToast(`${fullName} ${existing ? 'updated' : 'added'}`)
  
        return {
          ...c,
          id,
          clientId: companyId,
          companyId,
          fullName,
          createdDate: existing?.createdDate ?? now(),
        } as ContactPerson
      },

    updateContactPerson: (id, p) => {
        const person = store.contactPersons.find(c => c.id === id)
        if (!person) return
        const fullName = (p.firstName !== undefined || p.lastName !== undefined)
          ? `${p.firstName ?? person.firstName} ${p.lastName ?? person.lastName}`.trim()
          : person.fullName
        const patch: Partial<Contact> = {
          ...(fullName !== person.fullName ? { name: fullName } : {}),
          ...(p.jobTitle !== undefined ? { jobTitle: p.jobTitle } : {}),
          ...(p.email !== undefined ? { email: p.email } : {}),
          ...(p.phone !== undefined ? { phone: p.phone } : {}),
          ...(p.mobile !== undefined ? { mobile: p.mobile } : {}),
          ...(p.notes !== undefined ? { notes: p.notes } : {}),
          ...(p.clientId || p.companyId ? { companyId: p.clientId || p.companyId } : {}),
        }
        void store.storeCtxRef.current!.updateContact(id, patch).catch(() => {
          store.showToast('Contact person could not be saved — reopen the contact and try again', 'error')
        })
        store.showToast('Contact person updated')
      },

    deleteContactPerson: (id) => {
        void store.storeCtxRef.current!.deleteContact(id).catch(() => {
          store.showToast('Contact person could not be removed — it will reappear on refresh', 'error')
        })
        store.showToast('Contact person deleted')
      },

    // ── CRM - Opportunities ────────────────────────────────────────────────────
    createOpportunity: (opp) => {
        const user = store.currentUser()
        const company = store.companies.find(c => c.id === opp.companyId)
        const contact = store.contactPersons.find(cp => cp.id === opp.contactPersonId)
        
        // Lead scoring
        let leadScore = 0
        if (company?.segment === 'enterprise') leadScore += 30
        else if (company?.segment === 'sme') leadScore += 20
        else if (company?.segment === 'startup') leadScore += 10
        else if (company?.segment === 'government') leadScore += 25
        
        if (contact?.isDecisionMaker) leadScore += 25
        if (contact?.isTechnicalContact) leadScore += 10
        if (contact?.isPrimary) leadScore += 10
        
        if (opp.leadSource === 'referral') leadScore += 15
        if (opp.leadSource === 'existing_customer') leadScore += 20
        if (opp.leadSource === 'trade_show') leadScore += 10
        
        leadScore = Math.min(leadScore, 100)
        
        const opportunity: Opportunity = {
          ...opp,
          id: uid(),
          // Provisional: the server issues OPP/NNNN and the answer replaces it.
          // It used to come from this browser's own counter (duplicates).
          ref: allocateDocNumberSync('OPP'),
          createdDate: now(),
          quoteIds: [],
          actualValue: 0,
          leadScore,
          contactEmail: contact?.email,
          contactPhone: contact?.phone || contact?.mobile,
          ownerId: opp.ownerId ?? user?.id,
          assignedToId: opp.assignedToId ?? opp.ownerId ?? user?.id,
        }
        store.setOpportunities(p => [opportunity, ...p])
        store.addAuditLog('create_opportunity', opportunity.name, `Opportunity ${opportunity.name} created`)
        store.showToast('Opportunity created')
        void sync('/api/opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opportunity) })
          .then(async res => {
            if (!res || !res.ok) return
            const saved = await res.json().catch(() => null)
            if (saved?.id) store.storeCtxRef.current?.ingestOpportunity(saved)
          })
        return opportunity
      },

    ingestOpportunity: (raw) => {
        const normalized = normalizeOpportunityForClient(raw) as Opportunity
        if (!normalized?.id) return
        store.setOpportunities(prev => {
          const idx = prev.findIndex(o => o.id === normalized.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = { ...prev[idx], ...normalized }
            return next
          }
          return [normalized, ...prev]
        })
      },

    updateOpportunity: (id, p) => store.setOpportunities(prev => {
        const next = prev.map(o => o.id === id ? { ...o, ...p, lastActivityDate: now() } : o)
        const updated = next.find(o => o.id === id)
        if (updated) sync(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        store.addAuditLog('update_opportunity', id, `Opportunity updated`)
        store.showToast('Opportunity updated')
        return next
      }),

    moveOpportunityStage: (id, stage) => store.setOpportunities(prev => {
        const next = prev.map(o => {
          if (o.id !== id) return o
          const probability = {
            prospecting: 10,
            qualification: 25,
            proposal: 50,
            negotiation: 75,
            closed_won: 100,
            closed_lost: 0,
            on_hold: o.probability,
          }[stage]
          return { ...o, stage, probability, lastActivityDate: now() }
        })
        const updated = next.find(o => o.id === id)
        if (updated) sync(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        store.addAuditLog('move_opportunity_stage', id, `Opportunity moved to ${stage}`)
        store.showToast(`Opportunity moved to ${stage.replace('_', ' ')}`)
        return next
      }),

    markOpportunityWon: (id, actualValue) => store.setOpportunities(prev => {
        const next = prev.map(o => o.id === id ? {
          ...o,
          stage: 'closed_won',
          probability: 100,
          actualValue,
          actualCloseDate: now(),
          lastActivityDate: now(),
        } : o)
        const updated = next.find(o => o.id === id)
        if (updated) sync(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        store.addAuditLog('win_opportunity', id, `Opportunity won - Value: ${actualValue}`)
        store.showToast('Opportunity marked as WON! 🎉', 'success')
        return next
      }),

    markOpportunityLost: (id, reason, competitor) => store.setOpportunities(prev => {
        const next = prev.map(o => o.id === id ? {
          ...o,
          stage: 'closed_lost',
          probability: 0,
          actualCloseDate: now(),
          lostReason: reason,
          lostToCompetitor: competitor,
          lastActivityDate: now(),
        } : o)
        const updated = next.find(o => o.id === id)
        if (updated) sync(`/api/opportunities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        store.addAuditLog('lose_opportunity', id, `Opportunity lost - Reason: ${reason}`)
        store.showToast('Opportunity marked as lost')
        return next
      }),

    deleteOpportunity: (id) => {
        store.setOpportunities(p => p.filter(o => o.id !== id))
        sync(`/api/opportunities/${id}`, { method: 'DELETE' })
        store.addAuditLog('delete_opportunity', id, `Opportunity deleted`)
        store.showToast('Opportunity deleted')
      },

    // ── CRM - Opportunity Activities ───────────────────────────────────────────
    logActivity: (activity) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return null }
        
        const act: OpportunityActivity = {
          ...activity,
          id: uid(),
          createdBy: user.id,
          createdByName: user.name,
          createdDate: now(),
        }
        store.setOpportunityActivities(p => [act, ...p])
        sync('/api/opportunity-activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(act) })
        store.setOpportunities(prev => {
          const next = prev.map(o => o.id === activity.opportunityId ? { ...o, lastActivityDate: now() } : o)
          const updated = next.find(o => o.id === activity.opportunityId)
          if (updated) sync(`/api/opportunities/${activity.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        store.addAuditLog('log_activity', act.opportunityId, `Activity: ${act.subject}`)
        store.showToast('Activity logged')
        return act
      },

    completeActivity: (id, outcome) => store.setOpportunityActivities(prev => {
        const next = prev.map(a => a.id === id ? {
          ...a,
          status: 'completed',
          completedDate: now(),
          outcome: outcome ?? a.outcome,
        } : a)
        const updated = next.find(a => a.id === id)
        if (updated) sync(`/api/opportunity-activities/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        store.showToast('Activity completed')
        return next
      }),

    // ── Customer Contracts ─────────────────────────────────────────────────────
    createCustomerContract: (contractInput) => {
        const contract: CustomerContract = {
          ...contractInput,
          id: uid(),
          ref: store.contractRef(),
        }
        store.setCustomerContracts(prev => [contract, ...prev])
        store.addAuditLog('create_contract', contract.companyName, `Contract for ${contract.companyName} created`)
        store.showToast('Contract created')
        return contract
      },

    updateCustomerContract: (id, patch) => {
        store.setCustomerContracts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
        store.addAuditLog('update_contract', id, 'Customer contract updated')
        store.showToast('Contract updated')
      },

    renewCustomerContract: (id) => {
        const current = store.customerContracts.find(c => c.id === id)
        if (!current) throw new Error('Contract not found')
        const renewed: CustomerContract = {
          ...current,
          id: uid(),
          ref: store.contractRef(),
          startDate: current.endDate,
          endDate: store.addDays(current.endDate, 365),
          renewalDate: store.addDays(current.endDate, 335),
          status: 'renewed',
        }
        store.setCustomerContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'renewed' } : c))
        store.setCustomerContracts(prev => [renewed, ...prev])
        store.addAuditLog('renew_contract', current.ref, `Renewed ${current.ref} for another year`)
        store.showToast(`Contract ${current.ref} renewed`)
        return renewed
      },

    terminateCustomerContract: (id, reason) => {
        store.setCustomerContracts(prev => prev.map(c => c.id === id ? { ...c, status: 'terminated', notes: `${c.notes ?? ''} | Terminated: ${reason}` } : c))
        store.addAuditLog('terminate_contract', id, `Contract terminated: ${reason}`)
        store.showToast('Contract terminated')
      },

    // ── Sales - Quotes ─────────────────────────────────────────────────────────
    createQuote: async (quoteInput) => {
        const user = store.currentUser()
        if (!user) { store.showToast('Please log in to continue', 'error'); return null }
        if (Number(quoteInput.total ?? 0) < 1) {
          store.showToast('Quote total must be at least KES 1 — quotes below KES 1 cannot be created', 'error')
          return null
        }
  
        const quoteRef = await store.storeCtxRef.current!.allocateDocRef('QUO')
        const createdAt = now()
        const money = documentMoneySnapshot({
          currencyCode: quoteInput.currencyCode || store.companySettings.currency || FUNCTIONAL_CURRENCY,
          exchangeRateToBase: quoteInput.exchangeRateToBase,
        })
        const quote: Quote = {
          ...quoteInput,
          ...money,
          id: uid(),
          ref: quoteRef,
          quoteNumber: quoteRef,
          version: 1,
          issueDate: createdAt,
          quoteDate: createdAt,
          viewCount: 0,
          totalAmount: quoteInput.total,
          approvalStatus: 'not_required',
          approvalRequestIds: [],
          createdById: user.id,
          createdBy: user.id,
          createdByName: user.name,
          createdAt,
          updatedAt: createdAt,
        }
        store.setQuotes(p => [quote, ...p])
        sync('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quote) })
        store.setOpportunities(prev => {
          const next = prev.map(o => o.id === quote.opportunityId ? { ...o, quoteIds: [...o.quoteIds, quote.id] } : o)
          const updated = next.find(o => o.id === quote.opportunityId)
          if (updated) sync(`/api/opportunities/${quote.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        store.addAuditLog('create_quote', quote.ref, `Quote created for ${quote.companyName}`)
        store.showToast(`Quote ${quote.ref} created`)
        return quote
      },

    updateQuote: (id, p) => store.setQuotes(prev => {
        const next = prev.map(q => q.id === id ? { ...q, ...p } : q)
        const updated = next.find(q => q.id === id)
        if (updated) sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        store.showToast('Quote updated')
        return next
      }),

    addQuoteLine: (quoteId, product, qty, discount = 0, customPrice) => {
        const quote = store.quotes.find(q => q.id === quoteId)
        if (!quote) return
  
        const priced = resolveListPrice({
          product,
          pricelist: quote.pricelist,
          qty,
          customPrice,
        })
        const unitPrice = priced.unitPrice
        const disc = Math.min(Math.max(discount, 0), 100)
        const discountAmount = Math.round(unitPrice * qty * disc / 100)
        const subtotal = unitPrice * qty - discountAmount
        const taxAmount = Math.round(subtotal * product.taxRate / 100)
        const lineTotal = subtotal + taxAmount
        
        const line: QuoteLineItem = {
          id: uid(),
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          description: product.description,
          qty,
          unit: product.unit,
          listPrice: priced.listPrice,
          unitPrice,
          discount: disc,
          discountAmount,
          taxRate: product.taxRate,
          taxAmount,
          subtotal,
          lineTotal,
        }
        
        const updatedLines = [...quote.lines, line]
        const newSubtotal = updatedLines.reduce((sum, l) => sum + l.subtotal, 0)
        const newTaxTotal = updatedLines.reduce((sum, l) => sum + l.taxAmount, 0)
        const newTotal = newSubtotal + newTaxTotal
        const totalDiscount = updatedLines.reduce((sum, l) => sum + l.discountAmount, 0)
        
        store.setQuotes(prev => {
          const next = prev.map(q => q.id === quoteId ? {
            ...q,
            lines: updatedLines,
            subtotal: newSubtotal, taxTotal: newTaxTotal, total: newTotal,
            discountAmount: totalDiscount,
            discountPercent: newSubtotal > 0 ? Math.round((totalDiscount / (newSubtotal + totalDiscount)) * 100 * 100) / 100 : 0,
          } : q)
          const updated = next.find(q => q.id === quoteId)
          if (updated) sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        
        store.showToast('Line item added to quote')
      },

    removeQuoteLine: (quoteId, lineId) => {
        const quote = store.quotes.find(q => q.id === quoteId)
        if (!quote) return
        
        const updatedLines = quote.lines.filter(l => l.id !== lineId)
        const newSubtotal = updatedLines.reduce((sum, l) => sum + l.subtotal, 0)
        const newTaxTotal = updatedLines.reduce((sum, l) => sum + l.taxAmount, 0)
        const newTotal = newSubtotal + newTaxTotal
        const totalDiscount = updatedLines.reduce((sum, l) => sum + l.discountAmount, 0)
        
        store.setQuotes(prev => {
          const next = prev.map(q => q.id === quoteId ? {
            ...q,
            lines: updatedLines,
            subtotal: newSubtotal, taxTotal: newTaxTotal, total: newTotal,
            discountAmount: totalDiscount,
            discountPercent: newSubtotal > 0 ? Math.round((totalDiscount / (newSubtotal + totalDiscount)) * 100 * 100) / 100 : 0,
          } : q)
          const updated = next.find(q => q.id === quoteId)
          if (updated) sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        
        store.showToast('Line item removed')
      },

    sendQuote: (id) => {
        const existing = store.quotes.find(q => q.id === id) as any
        if (!existing) return
        const quoteApprovalRequests = store.approvalRequests.filter(r => r.documentType === 'quote' && r.documentId === id && r.type === 'discount')
        if (quoteApprovalRequests.some(r => r.status === 'rejected')) {
          store.showToast(`${existing.ref ?? existing.quoteNumber} has a rejected discount approval. Revise before sending.`, 'error')
          return
        }
        if (quoteApprovalRequests.some(r => r.status === 'pending')) {
          store.showToast(`${existing.ref ?? existing.quoteNumber} is awaiting discount approval`, 'info')
          return
        }
        const maxDiscount = (existing.lines ?? existing.items ?? []).reduce((max: number, line: any) => Math.max(max, Number(line.discount ?? line.discountPct) || 0), 0)
        if (maxDiscount > 10 && quoteApprovalRequests.length === 0) {
          const user = store.currentUser()
          if (!user) return
          const request = createApprovalRequest('discount', 'quote', id, existing.ref ?? existing.quoteNumber ?? id, user.id, user.name, {
            reason: `Quote ${existing.ref ?? existing.quoteNumber ?? id} includes discount above 10%`,
            discountPercent: maxDiscount,
            discountAmount: Number(existing.discountAmount ?? 0),
            currentValue: Number(existing.total ?? existing.totalAmount ?? 0),
            proposedValue: Number(existing.total ?? existing.totalAmount ?? 0),
          }, store.users.map(u => ({ id: u.id, name: u.name, role: u.role })))
          store.setApprovalRequests(prev => [request, ...prev])
          const updatedQuote = { ...existing, approvalStatus: 'pending', approvalRequestIds: [...(existing.approvalRequestIds ?? []), request.id], approvalRequiredReason: request.details.reason }
          store.setQuotes(prev => prev.map(q => q.id === id ? updatedQuote : q))
          sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedQuote) })
          store.notifyUsers({
            recipients: approvalRecipientIds(request, store.users),
            type: 'system',
            title: `Quote approval needed: ${existing.ref ?? existing.quoteNumber}`,
            body: request.details.reason,
            module: 'sales',
            path: `/sales?id=${id}`,
            icon: '⚠️',
            entityKey: `quote:${id}:approval:${request.id}`,
            excludeUserId: store.currentUserId,
          })
          store.addAuditLog('quote_approval_requested', existing.ref ?? id, request.details.reason)
          store.showToast('Quote sent for approval before customer delivery', 'info')
          return
        }
        const sentDate = now()
        const updatedQuote = { ...existing, status: 'sent', sentDate, approvalStatus: quoteApprovalRequests.length ? 'approved' : (existing.approvalStatus ?? 'not_required') }
        store.setQuotes(prev => prev.map(q => q.id === id ? updatedQuote : q))
        sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedQuote) })
  
        const contact = store.contacts.find(c => c.id === existing.companyId || c.id === existing.clientId || c.companyId === existing.companyId || c.name === existing.companyName)
        const contactEmail = existing.contactEmail || existing.contactPersonEmail || contact?.email || ''
        const contactPhone = existing.contactPhone || existing.contactPersonPhone || contact?.phone || ''
        const channels = [
          ...(contactEmail ? ['email' as const] : []),
          ...(contactPhone ? ['whatsapp' as const] : []),
        ]
  
        if (channels.length === 0) {
          store.addAuditLog('send_quote', existing.ref ?? id, `Quote marked sent but no email/phone is available for ${existing.contactPersonName ?? existing.companyName ?? 'customer'}`)
          store.showToast('Quote marked sent, but no email or phone is available for delivery', 'info')
          return
        }
  
        fetch('/api/integrations/send-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteId: id,
            channels,
            quote: {
              ref: existing.ref ?? existing.quoteNumber ?? id,
              companyName: existing.companyName ?? contact?.name ?? 'Customer',
              contactPersonName: existing.contactPersonName ?? contact?.name ?? 'Customer',
              contactEmail,
              contactPhone,
              total: Number(existing.total ?? existing.totalAmount ?? 0),
              validUntil: existing.validUntil ?? store.addDays(sentDate, 7),
              ownerName: existing.createdByName ?? store.currentUser()?.name ?? 'Sales',
              lines: (existing.lines ?? existing.items ?? []).map((line: any) => ({
                productName: line.productName ?? line.description ?? 'Item',
                qty: Number(line.qty ?? 1),
                lineTotal: Number(line.lineTotal ?? line.subtotal ?? 0),
              })),
            },
          }),
        })
          .then(async res => {
            if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Quote delivery failed')
            store.addAuditLog('send_quote', existing.ref ?? id, `Quote sent to ${existing.contactPersonName ?? existing.companyName ?? 'customer'} via ${channels.join(', ')}`)
            store.showToast('Quote sent to customer')
          })
          .catch(err => {
            store.addAuditLog('send_quote_failed', existing.ref ?? id, err instanceof Error ? err.message : 'Quote delivery failed')
            store.showToast('Quote marked sent, but delivery failed', 'error')
          })
      },

    acceptQuote: (id) => store.setQuotes(prev => {
        const next = prev.map(q => q.id === id ? { ...q, status: 'accepted', acceptedDate: now() } : q)
        const updated = next.find(q => q.id === id)
        if (updated) sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        const quote = store.quotes.find(q => q.id === id)
        store.setOpportunities(p => {
          const n = p.map(o => o.id === quote?.opportunityId ? { ...o, stage: 'closed_won', probability: 100, lastActivityDate: now() } : o)
          const up = n.find(o => o.id === quote?.opportunityId)
          if (up) sync(`/api/opportunities/${quote?.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(up) })
          return n
        })
        store.addAuditLog('accept_quote', quote?.ref ?? id, `Quote accepted by customer`)
        store.showToast('Quote accepted — create sale order to proceed')
        return next
      }),

    rejectQuote: (id, reason) => store.setQuotes(prev => {
        const next = prev.map(q => q.id === id ? {
          ...q, status: 'rejected', rejectedDate: now(), rejectionReason: reason,
        } : q)
        const updated = next.find(q => q.id === id)
        if (updated) sync(`/api/quotes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        const quote = store.quotes.find(q => q.id === id)
        store.addAuditLog('reject_quote', quote?.ref ?? id, `Quote rejected: ${reason}`)
        store.showToast('Quote rejected by customer')
        return next
      }),

    convertQuoteToSaleOrder: async (quoteId) => {
        const quote = store.quotes.find(q => q.id === quoteId)
        if (!quote) return null
        if (!['accepted', 'sent', 'viewed'].includes(quote.status)) {
          store.showToast('Only accepted or sent quotes can be converted to a sale order', 'error'); return null
        }
        // Prevent duplicate SOs — if a SO already references this quote, return it
        const existing = store.saleOrders.find(s => s.quoteId === quoteId)
        if (existing) {
          store.showToast(`Sale Order ${existing.ref} already exists for this quote`, 'info'); return existing
        }
        
        // Find or create legacy contact for company
        let contact = store.contacts.find(c => c.companyId === quote.companyId || c.name === quote.companyName)
        if (!contact) {
          const company = store.companies.find(comp => comp.id === quote.companyId)
          if (company) {
            // Saved to the clients table (the deed_contacts screen copy is frozen).
            const res = await fetch('/api/contacts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'company',
                name: company.name,
                email: company.email,
                phone: company.phone,
                address: company.physicalAddress,
                vatNumber: company.taxId,
                companyId: company.id,
                isCustomer: true,
                isVendor: false,
                tags: company.tags,
                creditLimit: company.creditLimit,
                paymentTerms: `${company.paymentTerms} days`,
              }),
            }).catch(() => null)
            const saved = res?.ok ? await res.json().catch(() => null) as Contact | null : null
            if (saved?.id) {
              contact = saved
              store.setContacts(p => p.some(c => c.id === saved.id) ? p : [saved, ...p])
            }
          }
        }
        
        const so: SaleOrder = {
          id: uid(),
          ref: await store.storeCtxRef.current!.allocateDocRef('QUO'),
          status: 'quotation',
          customerId: contact?.id ?? quote.companyId,
          customerName: quote.companyName,
          date: now(),
          validUntil: store.addDays(now(), 30),
          lines: quote.lines.map(ql => ({
            id: uid(),
            productId: ql.productId,
            productName: ql.productName,
            qty: ql.qty,
            unitPrice: ql.unitPrice,
            discount: ql.discount,
            taxRate: ql.taxRate,
            subtotal: ql.subtotal,
            serialIds: [],
          })),
          subtotal: quote.subtotal,
          taxTotal: quote.taxTotal,
          total: quote.total,
          notes: quote.notes ?? '',
        }
        
        store.setSaleOrders(p => [so, ...p])
        sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })
        store.setQuotes(prev => {
          const next = prev.map(q => q.id === quoteId ? {
            ...q, status: 'accepted', saleOrderId: so.id, convertedDate: now(),
          } : q)
          const updated = next.find(q => q.id === quoteId)
          if (updated) sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
  
        // Do not reserve at quotation conversion — same as createSaleOrder.
        // Reservation happens during delivery preparation after Confirm.
        // Reserving here made confirmSO treat the order's own reservation as a
        // shortage and falsely raise Backorder approval.
  
        // Close linked opportunity as won
        if (quote.opportunityId) {
          store.setOpportunities(prev => {
            const next = prev.map(opp => opp.id === quote.opportunityId ? {
              ...opp, stage: 'closed_won', actualValue: quote.total, closedDate: now(), wonReason: 'Quote accepted and converted to sales order'
            } : opp)
            const updated = next.find(o => o.id === quote.opportunityId)
            if (updated) sync(`/api/opportunities/${quote.opportunityId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return next
          })
          store.addAuditLog('close_opportunity_won', quote.opportunityId, `Opportunity won via ${so.ref}`)
        }
        
        store.addAuditLog('convert_quote', quote.ref, `Quote converted to ${so.ref} • Stock reserved`)
        store.showToast(`Sale order ${so.ref} created • Stock reserved`)
        return so
      },

    convertRepairQuoteToSOAndInvoice: async (quoteId) => {
        const quote = store.quotes.find(q => q.id === quoteId)
        if (!quote || quote.source !== 'repair') return null
  
        const soId = uid()
        const soRef = await store.storeCtxRef.current!.allocateDocRef('SO')
        const soLines = quote.lines.map(ql => ({
          id: uid(),
          productId: ql.productId,
          productName: ql.productName,
          qty: ql.qty,
          unitPrice: ql.unitPrice,
          discount: ql.discount,
          taxRate: ql.taxRate,
          subtotal: ql.subtotal,
          serialIds: [] as string[],
        }))
        const so: SaleOrder = {
          id: soId,
          ref: soRef,
          status: 'sale',
          confirmedAt: new Date().toISOString(),
          customerId: quote.companyId,
          customerName: quote.companyName,
          date: now(),
          validUntil: store.addDays(now(), 30),
          lines: soLines,
          subtotal: quote.subtotal,
          taxTotal: quote.taxTotal,
          total: quote.total,
          notes: quote.notes ?? '',
        }
        store.setSaleOrders(p => [so, ...p])
        sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(so) })
  
        const invLines: InvoiceLine[] = quote.lines.map(ql => ({
          id: uid(),
          description: ql.description ?? ql.productName,
          qty: ql.qty,
          unitPrice: ql.unitPrice,
          taxRate: (quote.taxTotal ?? quote.taxAmount ?? 0) > 0 ? store.companySettings.vatRate : 0,
          subtotal: ql.subtotal,
        }))
        const invoice: Invoice = {
          id: uid(),
          ref: await store.storeCtxRef.current!.allocateDocRef('INV'),
          type: 'customer_invoice',
          status: 'posted',
          partnerId: quote.companyId,
          partnerName: quote.companyName,
          date: now(),
          dueDate: store.addDays(now(), customerPaymentTermsDays(store.contacts.find(c => c.id === quote.companyId), 14, store.systemSettings.accCreditPayOnReceiptEnforced)),
          lines: invLines,
          subtotal: quote.subtotal,
          taxTotal: quote.taxTotal,
          total: quote.total,
          amountPaid: 0,
          saleOrderId: soId,
          notes: quote.notes ?? '',
        }
        store.setInvoices(p => [invoice, ...p])
        store.postInvoiceJournalOnce(invoice)
        void store.saveInvoiceToServer(invoice, msg => store.showToast(msg, 'error'))
  
        store.setQuotes(p => {
          const next = p.map(q => q.id === quoteId ? {
            ...q, status: 'accepted', saleOrderId: soId, invoiceId: invoice.id, acceptedDate: now(), convertedDate: now(),
          } : q)
          const updated = next.find(q => q.id === quoteId)
          if (updated) sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
  
        // Link back to repair
        if (quote.repairId) {
          store.setRepairs(p => p.map(r => r.id === quote.repairId ? {
            ...r, saleOrderId: soId, saleOrderRef: soRef, invoiceId: invoice.id, invoiceDate: now(), status: 'approved',
            quote: r.quote ? { ...r.quote, approvedDate: now(), approvedBy: 'customer' } : r.quote,
          } : r))
        }
  
        store.addAuditLog('convert_repair_quote', quote.ref, `Repair quote → ${soRef} + ${invoice.ref}`)
        store.showToast(`${soRef} & ${invoice.ref} created`)
        return { so, invoice }
      },

    reviseQuote: async (quoteId, changes) => {
        const originalQuote = store.quotes.find(q => q.id === quoteId)
        if (!originalQuote) return {} as Quote
        
        // Mark original as revised
        store.setQuotes(prev => {
          const next = prev.map(q => q.id === quoteId ? { ...q, status: 'revised' } : q)
          sync(`/api/quotes/${quoteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next.find(q => q.id === quoteId)) })
          return next
        })
        
        // Create new version
        const user = store.currentUser()
        const newQuote: Quote = {
          ...originalQuote,
          id: uid(),
          ref: await store.storeCtxRef.current!.allocateDocRef('QUO'),
          version: originalQuote.version + 1,
          status: 'draft',
          issueDate: now(),
          validUntil: store.addDays(now(), 14),
          parentQuoteId: quoteId,
          revisionNotes: changes,
          sentDate: undefined,
          viewedDate: undefined,
          viewCount: 0,
          acceptedDate: undefined,
          rejectedDate: undefined,
          saleOrderId: undefined,
          convertedDate: undefined,
          lines: originalQuote.lines.map(line => ({ ...line, id: uid() })),
        }
        
        store.setQuotes(p => [newQuote, ...p])
        sync('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newQuote) })
        store.addAuditLog('revise_quote', newQuote.ref, `Quote revised from ${originalQuote.ref} - v${newQuote.version}`)
        store.showToast(`Revised quote ${newQuote.ref} (v${newQuote.version}) created`)
        return newQuote
      },

    deleteQuote: (id) => {
        const quote = store.quotes.find(q => q.id === id)
        store.setQuotes(p => p.filter(q => q.id !== id))
        sync(`/api/quotes/${id}`, { method: 'DELETE' })
        store.addAuditLog('delete_quote', quote?.ref ?? id, `Quote deleted`)
        store.showToast('Quote deleted')
      },

    // ── Sale Orders ───────────────────────────────────────────────────────────
    createSaleOrder: async (customerId, customerName, initial = {}) => {
        const user = store.currentUser()
        const initialLines = initial.lines ?? []
        const totals = store.calcSO(initialLines)
        const money = documentMoneySnapshot({
          currencyCode: (initial as any).currencyCode || store.companySettings.currency || FUNCTIONAL_CURRENCY,
          exchangeRateToBase: (initial as any).exchangeRateToBase,
        })
        const soRef = await store.storeCtxRef.current!.allocateDocRef('QUO')
        const headerDiscount = Math.max(0, Number(initial.discountAmount) || 0)
        const so: SaleOrder = {
          id: uid(), ref: soRef, status: 'quotation', customerId, customerName,
          date: now(), validUntil: initial.validUntil ?? store.addDays(now(), 30), lines: initialLines, ...totals,
          approvalStatus: 'not_required', approvalRequestIds: [], stockReservationIds: [],
          deliveryDate: initial.deliveryDate,
          paymentTerms: initial.paymentTerms,
          notes: initial.notes ?? '',
          termsAndConditions: initial.termsAndConditions,
          optionalProducts: initial.optionalProducts ?? [],
          customerRef: initial.customerRef,
          opportunityId: initial.opportunityId,
          invoiceAddress: initial.invoiceAddress,
          deliveryAddress: initial.deliveryAddress,
          pricelist: initial.pricelist || 'RETAIL',
          pricelistId: (initial as any).pricelistId,
          discountAmount: headerDiscount,
          total: Math.max(0, (totals.total ?? 0) - headerDiscount),
          totalAmount: Math.max(0, (totals.totalAmount ?? totals.total ?? 0) - headerDiscount),
          ...money,
          // Odoo defaults the salesperson to the creating user; the form may override.
          salespersonId: initial.salespersonId ?? user?.id,
          salespersonName: initial.salespersonName ?? user?.name,
          salesTeam: initial.salesTeam,
          createdByUserId: user?.id, createdByName: user?.name,
        }
        store.setSaleOrders(p => [so, ...p])
        try {
          const res = await fetch('/api/sale-orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(so),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            store.setSaleOrders(p => p.filter(x => x.id !== so.id))
            store.showToast(String(data?.error || `Could not save ${so.ref}`), 'error')
            throw new Error(String(data?.error || `Could not save ${so.ref}`))
          }
          // Prefer server row when returned (stable refs / resolved product links).
          if (data && typeof data === 'object' && data.id) {
            const normalized = normalizeSaleOrdersForClient([data])[0] as SaleOrder
            store.setSaleOrders(p => p.map(x => x.id === so.id || x.id === normalized.id ? { ...so, ...normalized } : x))
            store.showToast(`${normalized.ref || so.ref} created`)
            return { ...so, ...normalized }
          }
        } catch (err) {
          if (err instanceof Error && /Could not save/.test(err.message)) throw err
          store.setSaleOrders(p => p.filter(x => x.id !== so.id))
          store.showToast(`Could not save ${so.ref} — check connection and try again`, 'error')
          throw err instanceof Error ? err : new Error(`Could not save ${so.ref}`)
        }
        store.showToast(`${so.ref} created`)
        return so
      },

    updateSaleOrder: async (id, p, opts) => {
        const existing = store.soRef.current.find(s => s.id === id)
        if (!existing) return false
        // Sent / confirmed documents are locked for content edits. Allow narrow
        // metadata (e.g. proformaRef) so PDF helpers still work without a reset.
        const keys = Object.keys(p)
        const metadataOnly = keys.length > 0 && keys.every(k =>
          k === 'proformaRef' || k === 'notes' || k === 'validUntil'
          || k === 'acceptedAt' || k === 'acceptedById' || k === 'acceptedByName'
          || k === 'salespersonId' || k === 'salespersonName',
        )
        if (existing.status !== 'quotation' && !metadataOnly) {
          store.showToast(
            existing.status === 'quotation_sent'
              ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
              : 'Only draft quotations can be edited. Reset to quotation first.',
            'error',
          )
          return false
        }
        if (existing.locked && !metadataOnly) {
          store.showToast('Unlock this quotation before editing', 'error')
          return false
        }
        const syncLines = Object.prototype.hasOwnProperty.call(p, 'lines')
        // Line changes stay local until Save ({ persist: true }). Immediate Prisma
        // PATCH + blob SSE was restoring deleted products before the user saved.
        const persistLines = syncLines && opts?.persist === true
        const softPersist = opts?.soft === true
  
        // Draft deletes/adds live on soRef. Never let a stale React `activeOrder.lines`
        // (passed from Save) or a stale soft-flush payload resurrect removals.
        let linesForUpdate = syncLines && Array.isArray(p.lines) ? p.lines as SaleOrderLine[] : existing.lines
        if (syncLines && Array.isArray(p.lines) && isSaleOrderDraftEditing(id)) {
          // Prefer the live draft order (add/remove already applied). Overlay only
          // refreshes field edits for ids still present.
          const draft = store.soRef.current.find(s => s.id === id) ?? existing
          const overlay = new Map((p.lines as SaleOrderLine[]).map(l => [l.id, l]))
          const draftIds = new Set(draft.lines.map(l => l.id))
          linesForUpdate = draft.lines.map(l => overlay.get(l.id) ?? l)
          // Explicit Save may carry a brand-new inline-editor line not yet on soRef.
          // Never re-append ids that already existed on the pre-edit row — those are
          // deletes. Soft auto-persist must never append payload-only ids at all.
          if (persistLines && !softPersist) {
            const preexistingIds = new Set(existing.lines.map(l => l.id))
            linesForUpdate = [
              ...linesForUpdate,
              ...(p.lines as SaleOrderLine[]).filter(
                l => l?.id && !draftIds.has(l.id) && !preexistingIds.has(l.id),
              ),
            ]
          }
        }
        const updated = syncLines
          ? { ...existing, ...p, lines: linesForUpdate, ...store.calcSO(linesForUpdate) }
          : { ...existing, ...p }
  
        if (syncLines && !persistLines) {
          store.applyLocalDraftSaleOrder(store.soRef, store.setSaleOrders, id, updated)
          scheduleDraftSaleOrderLinePersist(id)
          return true
        }
  
        if (persistLines) {
          store.applyLocalDraftSaleOrder(store.soRef, store.setSaleOrders, id, updated)
        } else {
          store.soRef.current = store.soRef.current.map(s => s.id === id ? updated : s)
          store.setSaleOrders(prev => prev.map(s => s.id === id ? updated : s))
        }
  
        const persist = async (retry = 0) => {
          // Re-read draft at persist time so a delete that landed after click still wins.
          const live = store.soRef.current.find(s => s.id === id) ?? updated
          const persistPayload = persistLines
            ? { ...live, lines: live.lines, ...store.calcSO(live.lines as SaleOrderLine[]) }
            : p
          const sentFingerprint = persistLines
            ? saleOrderLinesFingerprint((persistPayload as SaleOrder).lines)
            : ''
          // Metadata: send only the patch so a notes keystroke cannot rewrite lines.
          // Save: send the full draft row (minus lockVersion).
          const body = persistLines
            ? (persistPayload as unknown as Record<string, unknown>)
            : (p as unknown as Record<string, unknown>)
          // Soft auto-persist must not rewrite the shared blob mid-edit.
          if (softPersist) {
            ;(body as Record<string, unknown>).skipBroadcast = true
          }
          // Soft flushes are generation-gated: if Save or a newer edit superseded
          // this snapshot, skip the HTTP write so a stale A+B cannot land after A.
          if (softPersist && isSaleOrderHardSaving(id)) {
            return false
          }
          if (softPersist && persistLines && sentFingerprint) {
            const liveNow = store.soRef.current.find(s => s.id === id)
            if (
              liveNow
              && saleOrderLinesFingerprint(liveNow.lines) !== sentFingerprint
            ) {
              // Local draft moved since this soft snapshot was built — never write
              // the stale line set. A newer soft flush (or Save) owns persistence.
              if (!isSaleOrderHardSaving(id)) scheduleDraftSaleOrderLinePersist(id)
              return false
            }
          }
          const result = await store.patchSaleOrderPersist(id, body)
          if (!result.ok) {
            if (persistLines) {
              // Soft auto-persist must never erase the user's draft. Keep the mark
              // and retry quietly — explicit Save can still surface an error.
              if (softPersist) {
                if (!isSaleOrderHardSaving(id)) {
                  markSaleOrderDraftEdit(id)
                  scheduleDraftSaleOrderLinePersist(id)
                }
                return false
              }
              const latest = store.soRef.current.find(s => s.id === id)
              const stillOurs = latest && latest.lines === updated.lines
              if (stillOurs) {
                store.soRef.current = store.soRef.current.map(s => s.id === id ? existing : s)
                store.setSaleOrders(prev => prev.map(s => s.id === id ? existing : s))
              }
            }
            if (!softPersist) store.showToast(result.error, 'error')
            return false
          }
          const latestAfter = store.soRef.current.find(s => s.id === id)
          const localMoved = persistLines
            && !!latestAfter
            && saleOrderLinesFingerprint(latestAfter.lines) !== sentFingerprint
          // Soft response after Save/hard gate: keep local draft, never re-arm from stale.
          if (softPersist && isSaleOrderHardSaving(id)) {
            store.applySaleOrderPersistResult(store.setSaleOrders, store.soRef, id, result.data, { syncLines: false })
            return true
          }
          if (persistLines && (softPersist || localMoved)) {
            // Background sync / slower response: keep local lines, refresh lock only.
            store.applySaleOrderPersistResult(store.setSaleOrders, store.soRef, id, result.data, { syncLines: false })
            markSaleOrderDraftEdit(id)
            try {
              const serialized = JSON.stringify(store.soRef.current)
              rememberSaleOrdersSnapshot(serialized)
              _pendingSync['deed_saleOrders'] = serialized
              addDirtyKey('deed_saleOrders')
              persistClientStoreValue('deed_saleOrders', serialized)
            } catch { /* ignore */ }
            if (softPersist) {
              // Soft sync stays silent. If Save started, do not re-arm draft soft flushes.
              if (!isSaleOrderHardSaving(id) && localMoved) scheduleDraftSaleOrderLinePersist(id)
              return true
            }
            // Explicit Save while the user kept editing — persist the newer draft.
            if (retry < 2) return persist(retry + 1)
            scheduleDraftSaleOrderLinePersist(id)
            return true
          }
          store.applySaleOrderPersistResult(store.setSaleOrders, store.soRef, id, result.data, {
            syncLines: persistLines,
            expectedLinesFingerprint: sentFingerprint || undefined,
          })
          if (persistLines) {
            // Prefer the lines we just saved when pinning — never reopen the door
            // for a stale blob SSE to restore deleted products after Save.
            const savedLines = Array.isArray((persistPayload as SaleOrder).lines)
              ? (persistPayload as SaleOrder).lines
              : store.soRef.current.find(s => s.id === id)?.lines
            // If Prisma echoed more commercial lines than we sent, keep the draft
            // (stale server / race) — never let Save put deleted products back.
            const serverLines = Array.isArray(result.data?.lines) ? result.data.lines : null
            const savedCommercial = (savedLines ?? []).filter((l: any) => l?.lineType !== 'section')
            const serverCommercial = (serverLines ?? []).filter((l: any) => l?.lineType !== 'section')
            if (serverLines && savedCommercial.length < serverCommercial.length) {
              const pinnedOrder = {
                ...(store.soRef.current.find(s => s.id === id) ?? updated),
                lines: savedLines ?? [],
                ...store.calcSO((savedLines ?? []) as SaleOrderLine[]),
              }
              store.soRef.current = store.soRef.current.map(s => s.id === id ? pinnedOrder : s)
              store.setSaleOrders(prev => prev.map(s => s.id === id ? pinnedOrder : s))
              stampSaleOrderPersisted(id, pinnedOrder.lines)
            } else {
              stampSaleOrderPersisted(id, serverLines ?? savedLines ?? [])
            }
            try {
              const serialized = JSON.stringify(store.soRef.current)
              rememberSaleOrdersSnapshot(serialized)
              _pendingSync['deed_saleOrders'] = serialized
              addDirtyKey('deed_saleOrders')
              persistClientStoreValue('deed_saleOrders', serialized)
            } catch { /* ignore */ }
            // Push the saved snapshot to the blob before dropping the draft lock
            // window; stampSaleOrderPersisted still guards SSE for ~20s.
            void flushServerSync()
          }
          return true
        }
  
        if (existing && ('customerId' in p || 'customerName' in p || 'invoiceAddress' in p)) {
          const contact = store.contacts.find(c => c.id === (p.customerId ?? existing.customerId))
          const name = String(p.customerName ?? existing.customerName ?? contact?.name ?? '').trim()
          const address = 'invoiceAddress' in p
            ? (p.invoiceAddress || undefined)
            : (existing.invoiceAddress || (contact ? formatCustomerAddress(contact) : undefined))
          store.syncCustomerIdentityToDocuments({
            contactId: p.customerId ?? existing.customerId,
            saleOrderId: id,
            identity: {
              name,
              email: contact?.email || undefined,
              phone: contact?.phone || contact?.mobile || undefined,
              address,
              customerId: p.customerId ?? existing.customerId,
            },
          })
        }
  
        if (persistLines) {
          if (softPersist) return persist()
          // Explicit Save: cancel soft work, wait for any in-flight soft PATCH,
          // then write the latest soRef lines so a slower soft cannot win.
          beginHardSaleOrderPersist(id)
          await waitForDraftSaleOrderPersistIdle(id)
          try {
            return await persist()
          } finally {
            endHardSaleOrderPersist(id)
          }
        }
        void persist()
        return true
      },

    addSOLine: (orderId, product, qty, discount = 0, defaultTaxRate = 0) => {
        if (qty <= 0) {
          store.showToast('Quantity must be greater than zero', 'error')
          return false
        }
        const so = store.soRef.current.find(s => s.id === orderId)
        if (!so) return false
        if (so.status !== 'quotation') {
          store.showToast(
            so.status === 'quotation_sent'
              ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
              : 'Only draft quotations can add lines',
            'error',
          )
          return false
        }
        if (so.locked) {
          store.showToast('Unlock this quotation before adding lines', 'error')
          return false
        }
        // Quotation lines may exceed current availability. Reservation and
        // serial allocation happen only after confirmation in delivery prep.
        const priced = resolveListPrice({
          product,
          pricelist: so.pricelist,
          qty,
        })
        const unitPrice = priced.unitPrice
        const ex = so.lines.find(l => l.productId === product.id)
        // Add Product VAT checkbox is authoritative (see resolveAddSaleOrderLineTaxRate).
        const taxRate = resolveAddSaleOrderLineTaxRate({
          explicitTaxRate: defaultTaxRate,
          existingTaxRate: ex?.taxRate,
          merging: Boolean(ex),
        })
        let lines: SaleOrderLine[]
        if (ex) {
          const nextQty = ex.qty + qty
          const nextPriced = resolveListPrice({ product, pricelist: so.pricelist, qty: nextQty })
          lines = so.lines.map(l => l.productId === product.id ? {
            ...l,
            qty: nextQty,
            unitPrice: nextPriced.unitPrice,
            listPrice: nextPriced.listPrice,
            taxRate,
            subtotal: Math.round(nextPriced.unitPrice * nextQty * (1 - l.discount / 100)),
          } : l)
        } else {
          const sub = Math.round(unitPrice * qty * (1 - discount / 100))
          lines = [...so.lines, {
            id: uid(),
            productId: product.id,
            productName: product.name,
            qty,
            unitPrice,
            listPrice: priced.listPrice,
            discount,
            taxRate,
            subtotal: sub,
            serialIds: [],
            accountCode: resolveProductAccounts(product).saleAccountCode,
          }]
        }
        const updated = { ...so, lines, ...store.calcSO(lines) }
        store.applyLocalDraftSaleOrder(store.soRef, store.setSaleOrders, orderId, updated)
        scheduleDraftSaleOrderLinePersist(orderId)
        return true
      },

    assignSerialToSOLine: (orderId, lineId, serialId) => {
        store.setSaleOrders(p => p.map(so => {
          if (so.id !== orderId) return so
          const lines = so.lines.map(l => {
            if (l.id !== lineId) return l
            if (l.serialIds.includes(serialId)) return l
            if (l.serialIds.length >= l.qty) { store.showToast('All serials assigned for this line', 'error'); return l }
            return { ...l, serialIds: [...l.serialIds, serialId] }
          })
          const updated = { ...so, lines }
          sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleOrderPersistBody(updated as unknown as Record<string, unknown>)) })
          return updated
        }))
        store.setSerials(p => p.map(s => s.id === serialId ? { ...s, status: 'assigned' } : s))
      },

    assignSerialsToSOLine: (orderId, lineId, serialIds) => {
        if (!serialIds.length) return
        const so = store.soRef.current.find(s => s.id === orderId)
        const line = so?.lines.find((l: any) => l.id === lineId)
        if (!so || !line) return
        const current: string[] = line.serialIds || []
        const room = Math.max(0, Number(line.qty) - current.length)
        const toAdd = serialIds.filter(id => !current.includes(id)).slice(0, room)
        if (!toAdd.length) { store.showToast('All serials assigned for this line', 'error'); return }
        if (toAdd.length < serialIds.length) {
          store.showToast(`Only ${toAdd.length} of ${serialIds.length} serials assigned — line quantity reached`, 'info')
        }
        store.setSaleOrders(p => p.map(order => {
          if (order.id !== orderId) return order
          const lines = order.lines.map((l: any) => l.id === lineId ? { ...l, serialIds: [...(l.serialIds || []), ...toAdd] } : l)
          const updated = { ...order, lines }
          sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleOrderPersistBody(updated as unknown as Record<string, unknown>)) })
          return updated
        }))
        const nextSerialIds = [...current, ...toAdd]
        const pendingDelivery = store.delRef.current.find(d =>
          d.saleOrderId === orderId && ['draft', 'waiting', 'ready'].includes(d.status),
        )
        if (pendingDelivery) {
          // Pair SO lines → DN lines so duplicate products update only this row.
          const pairs = pairOrderLinesWithDeliveryLines(so.lines, pendingDelivery.lines)
          const targetPair = pairs.find(p => (p.orderLine as any).id === lineId)
          const targetDn = targetPair?.deliveryLine
          const lines = pendingDelivery.lines.map(deliveryLine =>
            targetDn && deliveryLine === targetDn
              ? { ...deliveryLine, serialIds: nextSerialIds }
              : deliveryLine,
          )
          store.setDeliveries(prev => prev.map(d => d.id === pendingDelivery.id ? { ...d, lines, status: 'waiting' as const, preparedAt: undefined } : d))
          sync(`/api/deliveries/${pendingDelivery.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines, status: 'waiting', preparedAt: null }),
          })
        }
        store.setSerials(p => p.map(s => {
          if (!toAdd.includes(s.id)) return s
          const updated = { ...s, status: 'assigned' as const, saleOrderId: orderId }
          sync(`/api/serials/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
      },

    unassignSerialFromSOLine: (orderId, lineId, serialId) => {
        store.setSaleOrders(p => p.map(so => {
          if (so.id !== orderId) return so
          const lines = so.lines.map(l => {
            if (l.id !== lineId) return l
            return { ...l, serialIds: (l.serialIds || []).filter(id => id !== serialId) }
          })
          const updated = { ...so, lines }
          sync(`/api/sale-orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saleOrderPersistBody(updated as unknown as Record<string, unknown>)) })
          return updated
        }))
        const so = store.soRef.current.find(order => order.id === orderId)
        const line = so?.lines.find(item => item.id === lineId)
        const nextSerialIds = (line?.serialIds || []).filter(id => id !== serialId)
        const pendingDelivery = store.delRef.current.find(d =>
          d.saleOrderId === orderId && ['draft', 'waiting', 'ready'].includes(d.status),
        )
        if (pendingDelivery && line) {
          const pairs = pairOrderLinesWithDeliveryLines(so?.lines ?? [], pendingDelivery.lines)
          const targetDn = pairs.find(p => (p.orderLine as any).id === lineId)?.deliveryLine
          const lines = pendingDelivery.lines.map(deliveryLine =>
            targetDn && deliveryLine === targetDn
              ? { ...deliveryLine, serialIds: nextSerialIds }
              : deliveryLine,
          )
          store.setDeliveries(prev => prev.map(d => d.id === pendingDelivery.id ? { ...d, lines, status: 'waiting' as const, preparedAt: undefined } : d))
          sync(`/api/deliveries/${pendingDelivery.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines, status: 'waiting', preparedAt: null }),
          })
        }
        store.setSerials(p => p.map(s => {
          if (s.id !== serialId) return s
          const updated = { ...s, status: 'available' as const, saleOrderId: undefined }
          sync(`/api/serials/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
      },

    removeSOLine: (orderId, lineId) => {
        const so = store.soRef.current.find(s => s.id === orderId)
        if (!so) return false
        if (so.status !== 'quotation') {
          store.showToast(
            so.status === 'quotation_sent'
              ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
              : 'Only draft quotations can remove lines',
            'error',
          )
          return false
        }
        if (so.locked) {
          store.showToast('Unlock this quotation before removing lines', 'error')
          return false
        }
        const line = so.lines.find(l => l.id === lineId)
        if (line?.serialIds?.length) {
          store.setSerials(p => p.map(s => line.serialIds.includes(s.id) ? { ...s, status: 'available' } : s))
        }
        const lines = so.lines.filter(l => l.id !== lineId)
        const updated = { ...so, lines, ...store.calcSO(lines) }
        store.applyLocalDraftSaleOrder(store.soRef, store.setSaleOrders, orderId, updated)
        scheduleDraftSaleOrderLinePersist(orderId)
        return true
      },

    moveSOLine: (orderId, lineId, direction) => {
        const so = store.soRef.current.find(s => s.id === orderId)
        if (!so) return false
        if (so.status !== 'quotation') {
          store.showToast(
            so.status === 'quotation_sent'
              ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
              : 'Only draft quotations can reorder lines',
            'error',
          )
          return false
        }
        if (so.locked) {
          store.showToast('Unlock this quotation before reordering lines', 'error')
          return false
        }
        const index = so.lines.findIndex((l: any) => l.id === lineId)
        const target = index + direction
        if (index < 0 || target < 0 || target >= so.lines.length) return false
        const lines = [...so.lines]
        ;[lines[index], lines[target]] = [lines[target], lines[index]]
        const updated = { ...so, lines }
        store.applyLocalDraftSaleOrder(store.soRef, store.setSaleOrders, orderId, updated)
        scheduleDraftSaleOrderLinePersist(orderId)
        return true
      },

    addSOSection: (orderId, title) => {
        const so = store.soRef.current.find(s => s.id === orderId)
        if (!so) return false
        if (so.status !== 'quotation') {
          store.showToast(
            so.status === 'quotation_sent'
              ? 'Sent quotations are locked. Reset to draft first, then edit and save.'
              : 'Only draft quotations can add sections',
            'error',
          )
          return false
        }
        if (so.locked) {
          store.showToast('Unlock this quotation before adding sections', 'error')
          return false
        }
        const sectionTitle = String(title ?? '').trim() || 'Section'
        const lines = [...so.lines, {
          id: uid(),
          lineType: 'section' as const,
          productId: '',
          productName: sectionTitle,
          description: sectionTitle,
          qty: 0,
          unitPrice: 0,
          discount: 0,
          taxRate: 0,
          subtotal: 0,
          serialIds: [],
        }]
        const updated = { ...so, lines, ...store.calcSO(lines) }
        store.applyLocalDraftSaleOrder(store.soRef, store.setSaleOrders, orderId, updated)
        scheduleDraftSaleOrderLinePersist(orderId)
        return true
      },

    confirmSO: async (id, opts) => {
        const user = store.currentUser()
        if (!userCan(user, 'sales.orders.confirm')) {
          store.showToast('Unauthorized to confirm Sales Orders', 'error'); return;
        }
        const reserveStock = opts?.reserveStock !== false
        let so = store.soRef.current.find(s => s.id === id)
        if (!so) return
  
        // Flush unsaved draft line edits before confirm (add/remove stay local until Save).
        if (isSaleOrderDraftEditing(id)) {
          const flushed = await store.storeCtxRef.current!.updateSaleOrder(id, {
            lines: so.lines,
            subtotal: so.subtotal,
            taxTotal: so.taxTotal,
            total: so.total,
          }, { persist: true })
          if (flushed === false) return
          so = store.soRef.current.find(s => s.id === id)
          if (!so) return
        }
  
        // Already a durable Sales Order — never re-confirm / duplicate DNs.
        if (so.status === 'sale' || (saleOrderLooksConfirmed(so) && so.status !== 'cancelled')) {
          const openDn = store.delRef.current.filter(d => d.saleOrderId === id && isOpenDeliveryStatus(d.status))
          if (openDn.length === 0 && so.status === 'sale') {
            await store.storeCtxRef.current!.ensureWaitingDeliveryForSO(id)
          }
          if (so.status !== 'sale') {
            // Status drifted locally; heal Prisma + local without allocating a new SO number.
            try {
              const healRes = await fetch(`/api/sale-orders/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  status: 'sale',
                  confirmedAt: so.confirmedAt ?? new Date().toISOString(),
                  orderNumber: so.orderNumber ?? so.ref,
                  quotationRef: so.quotationRef,
                  confirmedById: so.confirmedById ?? user.id,
                  confirmedByName: so.confirmedByName ?? user.name,
                }),
              })
              if (healRes.ok) {
                const healed = await healRes.json().catch(() => null)
                store.setSaleOrders(p => p.map(s => s.id !== id ? s : {
                  ...s,
                  status: 'sale' as const,
                  lockVersion: healed?.lockVersion ?? s.lockVersion,
                  confirmedAt: healed?.confirmedAt ?? s.confirmedAt,
                  orderNumber: healed?.orderNumber ?? s.orderNumber,
                  ref: healed?.ref ?? healed?.orderNumber ?? s.ref,
                }))
              }
            } catch { /* heal best-effort */ }
          }
          store.showToast(`${so.ref} is already a Sales Order`, 'info')
          return
        }
  
        if (so.status !== 'quotation' && so.status !== 'quotation_sent') {
          store.showToast(`${so.ref} is already ${so.status === 'cancelled' ? 'cancelled' : so.status}`, 'info')
          return
        }
        if (store.confirmingSaleOrderIds.has(id)) {
          store.showToast('Confirmation already in progress', 'info')
          return
        }
  
        const existingOpen = store.delRef.current.filter(d => d.saleOrderId === id && isOpenDeliveryStatus(d.status))
        // Open DN already exists while SO is still quotation → confirm SO onto that DN (no second DN).
        const reuseDelivery = existingOpen[0] ?? null
  
        store.confirmingSaleOrderIds.add(id)
        const snapshot = { ...so }
        try {
          const selection = applyConfirmLineSelection(so.lines ?? [], opts?.qtyByLineId)
          if (!confirmSelectionHasProduct(selection.lines)) {
            store.showToast('Keep at least one product to confirm', 'error')
            return
          }
          const orderLines = selection.lines.filter((line: any) => line.lineType !== 'section')
          const confirmTotals = calcSaleOrderTotals(selection.lines, {
            headerDiscount: Number(so.discountAmount) || 0,
          })
          if (selection.releasedSerialIds.length > 0) {
            store.setSerials(p => p.map(s =>
              selection.releasedSerialIds.includes(s.id) ? { ...s, status: 'available' } : s,
            ))
          }
  
          const creditStatus = store.storeCtxRef.current!.getCustomerCreditStatus(so.customerId, confirmTotals.totalAmount)
          const canCreditOverride = canOverrideCustomerCredit(user.role)
          if (!creditStatus.ok && !canCreditOverride) {
            store.showToast(creditStatus.message || 'Customer credit check failed — cannot confirm', 'error')
            return
          }
          if (!creditStatus.ok) store.showToast(`Overriding: ${creditStatus.message}`, 'info')
          if (so.validUntil && !isRepairLinkedSaleOrder(so)) {
            const until = new Date(so.validUntil)
            until.setHours(23, 59, 59, 999)
            if (!Number.isNaN(until.getTime()) && until.getTime() < Date.now()) {
              store.showToast('This quotation has expired. Extend Valid until before confirming.', 'error')
              return
            }
          }
  
          // Margin / floor / discount / backorder / credit approval automation.
          const backorderLines = computeConfirmBackorderLines(
            orderLines as any,
            store.prodRef.current as any,
            store.stockReservations as any,
            { excludeReferenceId: id },
          )
          const backorderQty = backorderLines.reduce((s, l) => s + l.qtyBackordered, 0)
          const listPriceByProductId: Record<string, number> = {}
          for (const line of orderLines) {
            if (!line.productId) continue
            const product = store.prodRef.current.find(p => p.id === line.productId)
            if (!product) continue
            const resolved = resolveListPrice({
              product,
              pricelist: (so as any).pricelist || (so as any).pricelistCode || 'RETAIL',
              qty: Number(line.qty) || 1,
            })
            listPriceByProductId[line.productId] = resolved.listPrice
          }
          const approvalTriggers = computeSaleOrderApprovalTriggers({
            lines: orderLines as any,
            products: store.prodRef.current as any,
            headerDiscountAmount: confirmTotals.discountAmount,
            orderTotal: confirmTotals.totalAmount,
            minMarginPercent: Number(store.systemSettings.salesMinMarginPercent ?? store.systemSettings.reconfigurationMinMarginPct ?? 10),
            pricingMarginPolicy: store.systemSettings.pricingMarginPolicy,
            listPriceByProductId,
            creditRequested: !creditStatus.ok ? confirmTotals.totalAmount : undefined,
            creditAvailable: !creditStatus.ok ? Number((creditStatus as any).creditAvailable) || 0 : undefined,
            backorderQty,
          })
          // Detection stays; special_pricing / credit_override do not gate confirm while on hold.
          const gatingTriggers = approvalTriggers.filter(t =>
            isSalesConfirmGatingApproval(t.type, store.systemSettings),
          )
          const pricingTrigger = approvalTriggers.find(t => t.type === 'special_pricing')
          const discountTrigger = approvalTriggers.find(t => t.type === 'discount')
  
          // Auto-create missing pending approval requests when the confirmer
          // cannot satisfy the required roles (Director/Finance may self-approve).
          const existingForDoc = store.approvalRequests.filter(r => r.documentId === id)
          const createdRequests: ApprovalRequest[] = []
          const unmetTriggers = gatingTriggers.filter(trigger => {
            const roles = APPROVAL_RULES[trigger.type](trigger.details)
            if (roles.length === 0) return false
            // Price: Director OR Finance may self-satisfy. Other types still need every role.
            if (actorSatisfiesApprovalRoles(trigger.type, roles, user.role)) return false
            const already = existingForDoc.some(r =>
              r.type === trigger.type && (r.status === 'pending' || r.status === 'approved'),
            )
            return !already
          })
          for (const trigger of unmetTriggers) {
            const request = createApprovalRequest(
              trigger.type,
              'sales_order',
              id,
              so.ref,
              user.id,
              user.name,
              { ...trigger.details, reason: trigger.reason },
              store.users.map(u => ({ id: u.id, name: u.name, role: u.role })),
            )
            createdRequests.push(request)
          }
          if (createdRequests.length > 0) {
            store.setApprovalRequests(prev => [...createdRequests, ...prev])
            store.setSaleOrders(prev => prev.map(s => s.id !== id ? s : { ...s, approvalStatus: 'pending' }))
            for (const request of createdRequests) {
              store.notifyUsers({
                recipients: approvalRecipientIds(request, store.users),
                type: 'system',
                title: `Approval needed: ${request.type.replace(/_/g, ' ')}`,
                body: `${so.ref} — ${String(request.details?.reason ?? 'Special pricing / discount / credit approval required')}`,
                module: 'sales',
                path: approvalDocumentPath(request),
                icon: '⚠️',
                entityKey: `approval:${request.id}`,
                excludeUserId: user.id,
              })
            }
            store.showToast(
              `Approval required: ${createdRequests.map(r => r.type.replace(/_/g, ' ')).join(', ')}`,
              'error',
            )
            return
          }
  
          const leftoverSalesApprovals = store.approvalRequests.filter(r =>
            r.documentId === id &&
            isSalesConfirmGatingApproval(r.type, store.systemSettings) &&
            r.status === 'pending' &&
            gatingTriggers.some(t => t.type === r.type),
          )
          // The Director can override: confirming approves the pending requests
          // in their name, so the decision is still on record. Everyone else
          // waits for the approver.
          if (leftoverSalesApprovals.length > 0 && isDirector(user.role)) {
            const decided = leftoverSalesApprovals.map(r => processApproval(r, user.id, user.name, 'approved', 'Director override at confirm', user.role))
            const byId = new Map(decided.map(r => [r.id, r]))
            store.setApprovalRequests(prev => prev.map(r => byId.get(r.id) ?? r))
            store.addAuditLog('approval_override', so.ref, `Director approved ${decided.map(r => r.type.replace(/_/g, ' ')).join(', ')} at confirm`)
          } else if (leftoverSalesApprovals.length > 0) {
            store.showToast(
              `Resolve ${leftoverSalesApprovals.length} pending approval${leftoverSalesApprovals.length === 1 ? '' : 's'} before confirming`,
              'error',
            )
            return
          }
  
          const orderRef = await store.storeCtxRef.current!.allocateDocRef('SO')
          const confirmedAt = new Date().toISOString()
          // so was just re-fetched above (post-flush), so its lockVersion is
          // fresh for THIS request — sending it lets the server catch a genuine
          // lost-update (someone else changed this order between page load and
          // this click) instead of silently overwriting their change. A single
          // retry-after-refetch below absorbs the harmless case where our own
          // flush step raced the version forward without the caller knowing.
          const buildConfirmBody = (lockVersion: number | undefined) => ({
            ref: orderRef,
            orderNumber: orderRef,
            quotationRef: so.quotationRef ?? so.ref,
            status: 'sale' as const,
            confirmedAt,
            confirmedById: user.id,
            confirmedByName: user.name,
            approvedBy: user.id,
            // Do not force not_required — server enforces + role satisfaction.
            approvalStatus: gatingTriggers.length > 0 ? 'approved' as const : 'not_required' as const,
            locked: store.systemSettings.salesLockConfirmed || undefined,
            // Odoo At Confirmation vs Manual reservation
            reserveStock,
            lockVersion,
            belowPricelist: pricingTrigger?.details?.belowPricelist === true,
            belowCost: pricingTrigger?.details?.belowCost === true,
            belowMinimumMargin: pricingTrigger?.details?.belowMargin === true,
            specialPricing: Boolean(pricingTrigger),
            minMarginPercent: Number(store.systemSettings.salesMinMarginPercent ?? 10),
            worstMargin: pricingTrigger?.details?.worstMargin,
            pricingExceptionProducts: pricingTrigger?.details?.products,
            backorderQty: backorderQty > 0 ? backorderQty : undefined,
            discountPercent: discountTrigger?.details?.discountPercent,
            discountAmount: confirmTotals.discountAmount,
            creditRequested: !creditStatus.ok ? confirmTotals.totalAmount : undefined,
            creditAvailable: !creditStatus.ok ? Number((creditStatus as any).creditAvailable) || 0 : undefined,
            lines: selection.lines,
            total: confirmTotals.totalAmount,
            subtotal: confirmTotals.subtotal,
            taxTotal: confirmTotals.taxAmount,
          })
  
          let confirmRes = await fetch(`/api/sale-orders/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildConfirmBody(so.lockVersion)),
          })
          let confirmPayload = await confirmRes.json().catch(() => null)
          if (confirmRes.status === 409) {
            const fresh = await fetch(`/api/sale-orders/${id}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
            if (fresh && fresh.status !== 'sale' && fresh.status !== 'cancelled') {
              confirmRes = await fetch(`/api/sale-orders/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildConfirmBody(fresh.lockVersion)),
              })
              confirmPayload = await confirmRes.json().catch(() => null)
            }
          }
          if (!confirmRes.ok) {
            store.showToast(
              confirmRes.status === 409
                ? `${so.ref} was changed elsewhere — refresh and try confirming again`
                : confirmPayload?.error ?? `Could not confirm ${so.ref} — try again`,
              'error',
            )
            return
          }
  
          const serverRef = String(confirmPayload?.orderNumber ?? confirmPayload?.ref ?? orderRef)
          const serverLock = confirmPayload?.lockVersion
  
          const deliveryNoteLines = orderLines.filter(l => isDeliveryNoteLine(l))
  
          let del = reuseDelivery
          if (!del && deliveryNoteLines.length > 0) {
            const dnRef = await store.storeCtxRef.current!.allocateDocRef('DN')
            del = {
              id: uid(), ref: dnRef, saleOrderId: id, saleOrderRef: serverRef,
              customerId: so.customerId, customerName: so.customerName,
              status: 'waiting', date: now(),
              lines: deliveryNoteLines.map(l => {
                const prod = store.prodRef.current.find(p => p.id === l.productId)
                const selectedSource = (so.lines.find(line => line.id === l.id) as (SaleOrderLine & { sourceLocation?: LocationId }) | undefined)?.sourceLocation
                let sourceLocation
                if (isNonStockSaleLine(l, prod ?? null)) {
                  sourceLocation = undefined
                } else if (selectedSource) {
                  sourceLocation = selectedSource
                } else if (prod && isSerialTracking(inferTrackingMethod(prod))) {
                  // Only Ready for Sale ships; a shortfall is reported, never filled
                  // from With Issues (lib/inventory/sellable-stock.ts).
                  sourceLocation = 'warehouse'
                } else {
                  const qty = Math.max(0, Math.floor(Number(l.qty) || 0))
                  sourceLocation = resolveBulkDeliverySourceLocation({
                    product: prod,
                    productId: l.productId,
                    qty,
                    preferred: 'warehouse',
                    serials: store.serialRef.current,
                    bulkStock: store.bulkStock,
                    reservations: store.stockReservations,
                    excludeReferenceId: id,
                  }).location
                }
                return { productId: l.productId, productName: l.productName, qty: l.qty, qtyDone: 0, serialIds: [], sourceLocation }
              }),
              warrantyCreated: false,
            }
  
            const dnRes = await fetch('/api/deliveries', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(del),
            })
            if (!dnRes.ok) {
              const dnErr = await dnRes.json().catch(() => null)
              store.setSaleOrders(p => p.map(s => {
                if (s.id !== id) return s
                return {
                  ...s,
                  ref: serverRef,
                  orderNumber: serverRef,
                  quotationRef: s.quotationRef ?? snapshot.ref,
                  status: 'sale',
                  confirmedAt,
                  confirmedById: user.id,
                  confirmedByName: user.name,
                  approvedBy: user.id,
                  approvalStatus: 'not_required',
                  locked: store.systemSettings.salesLockConfirmed || undefined,
                  lockVersion: serverLock ?? s.lockVersion,
                }
              }))
              store.showToast(dnErr?.error ?? `Confirmed as ${serverRef}, but delivery note failed to save — open Delivery to retry`, 'error')
              return
            }
            store.setDeliveries(p => [del, ...p.filter(d => d.id !== del.id)])
          } else if (del) {
            const patched = { ...del, saleOrderRef: serverRef }
            store.setDeliveries(p => p.map(d => d.id === del.id ? patched : d))
            sync(`/api/deliveries/${del.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ saleOrderRef: serverRef }),
            })
            del = patched
          }
  
          store.setSaleOrders(p => p.map(s => {
            if (s.id !== id) return s
            return {
              ...s,
              lines: selection.lines,
              subtotal: confirmTotals.subtotal,
              taxTotal: confirmTotals.taxAmount,
              taxAmount: confirmTotals.taxAmount,
              discountAmount: confirmTotals.discountAmount,
              total: confirmTotals.totalAmount,
              totalAmount: confirmTotals.totalAmount,
              ref: serverRef,
              orderNumber: serverRef,
              quotationRef: s.quotationRef ?? snapshot.ref,
              status: 'sale',
              confirmedAt,
              confirmedById: user.id,
              confirmedByName: user.name,
              approvedBy: user.id,
              approvalStatus: 'not_required',
              approvalRequiredReason: undefined,
              approvalRequestIds: [],
              discountApprovalId: undefined,
              creditOverrideApprovalId: undefined,
              backorderApprovalId: undefined,
              backorderLines: undefined,
              locked: store.systemSettings.salesLockConfirmed || undefined,
              stockReservationIds: s.stockReservationIds ?? [],
              deliveryId: del?.id,
              lockVersion: serverLock ?? s.lockVersion,
            }
          }))
  
          store.addAuditLog(
            'confirm_sale_order',
            serverRef,
            `Same document: quotation ${snapshot.ref} renamed to sales order ${serverRef} by ${user.name}${store.systemSettings.salesLockConfirmed ? ' · order locked' : ''}${selection.changed ? ` · ${selection.droppedIds.length} line(s) dropped at confirm` : ''}`,
          )
          store.showToast(
            del
              ? `Confirmed — this document is now ${serverRef} (was ${snapshot.ref}). Prepare delivery ${del.ref} to allocate stock.`
              : `Confirmed — this document is now ${serverRef} (was ${snapshot.ref}). Service lines do not reserve stock — create an invoice from ordered quantities.`,
          )
        } catch (error) {
          console.error('[confirmSO] failed:', error)
          store.showToast(
            error instanceof Error ? error.message : `Could not confirm ${snapshot.ref} — try again`,
            'error',
          )
        } finally {
          store.confirmingSaleOrderIds.delete(id)
        }
      },

    ensureWaitingDeliveryForSO: async (id) => {
        const so = store.soRef.current.find(s => s.id === id)
        if (!so || so.status === 'cancelled') return null
        if (!saleOrderLooksConfirmed(so) && so.status !== 'sale') return null
        const existingOpen = store.delRef.current.filter(d => d.saleOrderId === id && isOpenDeliveryStatus(d.status))
        if (existingOpen[0]) return existingOpen[0]
        const anyActive = store.delRef.current.find(d => d.saleOrderId === id && d.status !== 'cancelled')
        if (anyActive) return anyActive
  
        const orderLines = so.lines.filter((line: any) => isDeliveryNoteLine(line))
        if (!orderLines.length) {
          return null
        }
        const dnRef = await store.storeCtxRef.current!.allocateDocRef('DN')
        const del: Delivery = {
          id: uid(),
          ref: dnRef,
          saleOrderId: id,
          saleOrderRef: so.orderNumber ?? so.ref,
          customerId: so.customerId,
          customerName: so.customerName,
          status: 'waiting',
          date: now(),
          lines: orderLines.map(l => {
            const prod = store.prodRef.current.find(p => p.id === l.productId)
            let sourceLocation: LocationId | undefined
            if (isNonStockSaleLine(l, prod ?? null)) {
              sourceLocation = undefined
            } else if (prod && isSerialTracking(inferTrackingMethod(prod))) {
              // Only Ready for Sale ships; a shortfall is reported, never filled
              // from With Issues (lib/inventory/sellable-stock.ts).
              sourceLocation = 'warehouse'
            } else {
              const qty = Math.max(0, Math.floor(Number(l.qty) || 0))
              sourceLocation = resolveBulkDeliverySourceLocation({
                product: prod,
                productId: l.productId,
                qty,
                preferred: 'warehouse',
                serials: store.serialRef.current,
                bulkStock: store.bulkStock,
                reservations: store.stockReservations,
                excludeReferenceId: id,
              }).location
            }
            return { productId: l.productId, productName: l.productName, qty: l.qty, qtyDone: 0, serialIds: [], sourceLocation }
          }),
          warrantyCreated: false,
        }
        const dnRes = await fetch('/api/deliveries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(del),
        })
        if (!dnRes.ok) {
          const err = await dnRes.json().catch(() => null) as { error?: string } | null
          store.showToast(err?.error ?? 'Could not create delivery note', 'error')
          return null
        }
        store.setDeliveries(p => [del, ...p])
        store.setSaleOrders(p => p.map(s => s.id === id ? { ...s, deliveryId: del.id } : s))
        store.showToast(`Created delivery ${del.ref} for ${so.ref}`, 'info')
        return del
      },

    markQuotationSent: async (id, recipient, message) => {
        const user = store.currentUser()
        let so = store.soRef.current.find(s => s.id === id)
        if (!so || !user) return
        if (so.status !== 'quotation' && so.status !== 'quotation_sent') return
        if (isSaleOrderDraftEditing(id)) {
          const flushed = await store.storeCtxRef.current!.updateSaleOrder(id, {
            lines: so.lines,
            subtotal: so.subtotal,
            taxTotal: so.taxTotal,
            total: so.total,
          }, { persist: true })
          if (flushed === false) return
          so = store.soRef.current.find(s => s.id === id)
          if (!so) return
        }
        store.setSaleOrders(p => p.map(s => {
          if (s.id !== id) return s
          const updated = {
            ...s,
            status: 'quotation_sent' as const,
            sentAt: new Date().toISOString(),
            sentById: user.id,
            sentByName: user.name,
            sentTo: recipient ?? s.sentTo,
            sentMessage: message ?? s.sentMessage,
          }
          sync(`/api/sale-orders/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(saleOrderPersistBody(updated as unknown as Record<string, unknown>)),
          })
          return updated
        }))
        store.addAuditLog('quotation_sent', so.ref, `Quotation emailed to ${recipient ?? so.customerName} by ${user.name}${message ? ` — ${message}` : ''}`)
      },

    setSaleOrderLock: (id, locked) => {
        const user = store.currentUser()
        if (!user || !isDirector(user.role)) {
          store.showToast('Only a director can lock or unlock a confirmed order', 'error'); return
        }
        const so = store.soRef.current.find(s => s.id === id)
        if (!so) return
        store.setSaleOrders(p => p.map(s => {
          if (s.id !== id) return s
          const updated = { ...s, locked }
          sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
        store.addAuditLog(locked ? 'lock_sale_order' : 'unlock_sale_order', so.ref, `${locked ? 'Locked' : 'Unlocked'} by ${user.name}`)
        store.showToast(`${so.ref} ${locked ? 'locked' : 'unlocked'}`)
      },

    prepareDelivery: (deliveryId, qtysDone) => {
        const user = store.currentUser()
        if (!canApproveInventoryAction(user)) {
          store.showToast('Only Inventory or Admin can prepare deliveries', 'error')
          return false
        }
        const del = store.delRef.current.find(d => d.id === deliveryId)
        if (!del || !['draft', 'waiting', 'ready'].includes(normalizeDeliveryStatus(del.status))) {
          store.showToast('No pending delivery available to prepare', 'error')
          return false
        }
        const so = store.soRef.current.find(s => s.id === del.saleOrderId)
        if (!so) {
          store.showToast('Sales Order not found', 'error')
          return false
        }
  
        // Sum by product — Object.fromEntries would keep only the last duplicate line.
        const requested = qtysDone ?? sumQtyByProductId(del.lines)
        // SO line serialIds are often wiped (Prisma stores only one serialNumberId).
        // Prefer DN stamps + serial inventory already reserved for this order.
        const assignedSerials = store.serialRef.current.filter(s =>
          s.saleOrderId === so.id &&
          ['assigned', 'reserved', 'sold'].includes(String(s.status)),
        )
        const plan = planPrepareDeliveryLines({
          deliveryLines: del.lines,
          soLines: so.lines,
          requestedByProduct: requested,
          assignedSerials,
          isSerialTracked: (productId) => {
            const product = store.prodRef.current.find(p => p.id === productId)
            return !!product && isSerialTracking(inferTrackingMethod(product))
          },
        })
        if (!plan.ok) {
          store.showToast(plan.error, 'error')
          return false
        }
  
        const reservations: StockReservation[] = []
        const preparedLines: DeliveryLine[] = []
        let totalPrepared = 0
        let stockPrepared = 0
        const serialIdsToHeal = new Set<string>()
        const hasStockableDeliveryLine = del.lines.some(line =>
          !isNonStockSaleLine(line, store.prodRef.current.find(p => p.id === line.productId) ?? null),
        )
  
        for (let i = 0; i < del.lines.length; i++) {
          const deliveryLine = del.lines[i]
          const planned = plan.lines[i]
          const product = store.prodRef.current.find(p => p.id === deliveryLine.productId)
          if (isNonStockSaleLine(deliveryLine, product ?? null)) {
            const qty = Math.max(0, Number(deliveryLine.qty) || 0)
            preparedLines.push({ ...deliveryLine, qtyDone: qty, serialIds: [], sourceLocation: undefined })
            totalPrepared += qty
            continue
          }
          const serialTracked = !!product && isSerialTracking(inferTrackingMethod(product))
          const stockTracked = !!product && isStockTracked(inferTrackingMethod(product))
          const qty = planned?.qty ?? 0
          const serialIds = planned?.serialIds ?? []
          let sourceLocation = (deliveryLine.sourceLocation ?? 'warehouse') as LocationId
  
          if (serialTracked && qty > 0) {
            for (const id of serialIds) {
              const serial = store.serialRef.current.find(item => item.id === id)
              const check = assertSerialUsableForDeliveryPrepare(serial, {
                saleOrderId: so.id,
                productId: deliveryLine.productId,
                productName: deliveryLine.productName,
              })
              if (!check.ok) {
                store.showToast(check.error, 'error')
                return false
              }
              if (check.heal) serialIdsToHeal.add(id)
            }
          } else if (stockTracked && qty > 0) {
            const resolved = resolveBulkDeliverySourceLocation({
              product,
              productId: deliveryLine.productId,
              qty,
              preferred: deliveryLine.sourceLocation as LocationId | undefined,
              serials: store.serialRef.current,
              bulkStock: store.bulkStock,
              reservations: store.stockReservations,
              excludeDeliveryId: deliveryId,
              // Quote→SO often leaves a reservation on the order with no deliveryId;
              // that must not count as "elsewhere" or Prepare falsely fails.
              excludeReferenceId: so.id,
            })
            sourceLocation = resolved.location
            if (resolved.available < qty) {
              const breakdown = formatStockByLocation(resolved.byLocation, {
                warehouse: store.LOCATIONS.warehouse.name,
                shop: store.LOCATIONS.shop.name,
                repair_unit: store.LOCATIONS.repair_unit.name,
              })
              store.showToast(
                `Only ${resolved.available} ${deliveryLine.productName} free to ship (need ${qty}). Stock free by location — ${breakdown}`,
                'error',
              )
              return false
            }
          }
  
          preparedLines.push({ ...deliveryLine, qtyDone: qty, serialIds, sourceLocation: stockTracked ? sourceLocation : deliveryLine.sourceLocation })
          totalPrepared += qty
          stockPrepared += qty
          if (stockTracked && qty > 0) {
            reservations.push({
              id: uid(),
              productId: deliveryLine.productId,
              productName: deliveryLine.productName,
              qty,
              reservedFor: 'sales_order',
              referenceId: so.id,
              referenceRef: del.ref,
              referenceType: 'delivery',
              deliveryId,
              location: sourceLocation,
              reservedBy: user!.id,
              reservedDate: now(),
              expiresDate: store.addDays(now(), 7),
              status: 'reserved',
              fulfilledQty: 0,
              serialNumbers: serialIds.map(id => store.serialRef.current.find(item => item.id === id)?.serial ?? id),
              notes: `Reserved while preparing delivery ${del.ref}`,
            })
          }
        }
  
        if (serialIdsToHeal.size > 0) {
          // Claim SO/DN-stamped serials that inventory still shows as available/in_stock.
          const healIds = Array.from(serialIdsToHeal)
          store.setSerials(prev => prev.map(s => {
            if (!healIds.includes(s.id)) return s
            const updated = { ...s, status: 'assigned' as const, saleOrderId: so.id }
            sync(`/api/serials/${s.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updated),
            })
            return updated
          }))
        }
  
        if (hasStockableDeliveryLine && stockPrepared <= 0) {
          store.showToast('Enter at least one delivery quantity before preparing', 'error')
          return false
        }
        if (totalPrepared <= 0) {
          store.showToast('Enter at least one delivery quantity before preparing', 'error')
          return false
        }
  
        store.setStockReservations(prev => [
          ...reservations,
          ...prev.map(reservation => {
            if (reservation.status !== 'reserved') return reservation
            const sameDelivery = reservation.deliveryId === deliveryId
            // Replace quote/SO-era orphans so prepare does not double-book stock.
            const orphanForThisOrder = reservation.referenceId === so.id && !reservation.deliveryId
            if (!sameDelivery && !orphanForThisOrder) return reservation
            return {
              ...reservation,
              status: 'cancelled' as const,
              notes: `${reservation.notes ?? ''} · replaced during re-preparation`.trim(),
            }
          }),
        ])
        const preparedAt = new Date().toISOString()
        store.setDeliveries(prev => prev.map(item => item.id === deliveryId ? {
          ...item,
          status: 'ready' as const,
          lines: preparedLines,
          preparedAt,
          preparedByUserId: user!.id,
          deliveryNoteGeneratedAt: undefined,
          deliveryNoteGeneratedByUserId: undefined,
        } : item))
        sync(`/api/deliveries/${deliveryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'ready',
            lines: preparedLines,
            preparedAt,
            preparedByUserId: user!.id,
            deliveryNoteGeneratedAt: null,
            deliveryNoteGeneratedByUserId: null,
          }),
        })
        store.setSaleOrders(prev => prev.map(order => {
          if (order.id !== so.id) return order
          const updated = {
            ...order,
            stockReservationIds: Array.from(new Set([...(order.stockReservationIds ?? []), ...reservations.map(r => r.id)])),
          }
          sync(`/api/sale-orders/${order.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
        store.addAuditLog('prepare_delivery', del.ref, `Reserved ${totalPrepared} item(s) for delivery ${del.ref}`)
        store.showToast(`${del.ref} prepared — stock reserved and ready to validate`)
        return true
      },

    reverseDelivery: async (deliveryId, reason) => {
        if (!canApproveInventoryAction(store.currentUser())) {
          store.showToast('Only Inventory, Admin or a Director can reverse a delivery', 'error'); return false
        }
        const del = store.delRef.current.find(d => d.id === deliveryId)
        if (!del) { store.showToast('This delivery is no longer loaded — refresh and try again', 'error'); return false }
        try {
          const res = await fetch(`/api/deliveries/${deliveryId}/reverse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason ?? '' }),
          })
          const payload = await res.json().catch(() => null) as { error?: string; reversedStock?: boolean } | null
          if (!res.ok) {
            store.showToast(payload?.error || `Could not reverse delivery (${res.status})`, 'error')
            return false
          }
          // The server rewrote stock, serials and reservations; the store stream
          // brings those back. Reflect the delivery itself immediately.
          store.setDeliveries(prev => prev.map(d => d.id === deliveryId ? { ...d, status: 'cancelled' as const } : d))
          // Same as the server: this delivery's reservations are released, so a
          // later save from this screen cannot put them back.
          store.setStockReservations(prev => prev.map(r =>
            r.deliveryId === deliveryId && (r.status === 'reserved' || r.status === 'fulfilled')
              ? { ...r, status: 'cancelled' as const }
              : r,
          ))
          store.addAuditLog('reverse_delivery', del.ref, `Delivery reversed${reason ? ` — ${reason}` : ''}`)
          store.showToast(payload?.reversedStock
            ? `${del.ref} reversed — stock and serials returned`
            : `${del.ref} cancelled — reserved stock released`)
          return true
        } catch (err) {
          store.showToast(`Could not reverse delivery — ${err instanceof Error ? err.message : 'unexpected error'}`, 'error')
          return false
        }
      },

    validateDelivery: async (deliveryId, qtysDone, opts) => {
        if (!canApproveInventoryAction(store.currentUser())) {
          store.showToast('Only Inventory or Admin can validate deliveries', 'error'); return;
        }
        const cancelRemaining = opts?.cancelRemaining === true
        const del = store.delRef.current.find(d => d.id === deliveryId)
        if (!del) {
          store.showToast('This delivery is no longer loaded — refresh the page and try again', 'error'); return
        }
        const so = store.soRef.current.find(s => s.id === del.saleOrderId)
        if (!so) {
          // Previously a non-null assertion: a delivery whose sale order had not
          // loaded threw a TypeError that surfaced as "Network error".
          store.showToast('The sale order for this delivery could not be loaded — refresh and try again', 'error'); return
        }
        if (del.status !== 'ready' || !del.preparedAt) {
          store.showToast('Prepare and reserve this delivery before validation', 'error')
          return
        }
  
        // Odoo-style partial validation: quantities actually done are shipped
        // now; the remainder moves to a backorder delivery. Stock is deducted
        // ONLY for the quantities validated as Done.
        // Prefer line-local qtyDone/serials (stamped at prepare). Optional
        // qtysDone is a per-product pool — never collapse duplicate product
        // rows with Object.fromEntries (SO/2026/0029 ThinkPad 1+2+1 bug).
        const requestedPool: Record<string, number> = {}
        if (qtysDone) {
          for (const [productId, raw] of Object.entries(qtysDone)) {
            requestedPool[productId] = Math.max(0, Number(raw) || 0)
          }
        } else {
          for (const line of del.lines) {
            const local = Math.max(Number(line.qtyDone) || 0, (line.serialIds ?? []).length)
            if (local <= 0) continue
            requestedPool[line.productId] = (requestedPool[line.productId] ?? 0) + local
          }
        }
        const { doneLines, backorderLines, lineDone } = splitDeliveryForBackorder(del.lines, requestedPool)
        if (doneLines.length === 0) {
          store.showToast('Enter the quantities delivered before validating', 'error'); return
        }
        // Serial-tracked lines cannot be split implicitly — check EACH delivery
        // line against its own done qty (never .find(productId), which breaks
        // when duplicate product rows have different quantities).
        for (let i = 0; i < del.lines.length; i++) {
          const l = del.lines[i]
          const prod = store.prodRef.current.find(x => x.id === l.productId)
          const done = lineDone[i] ?? 0
          if (prod && isSerialTracking(inferTrackingMethod(prod)) && done > 0 && done < l.qty) {
            store.showToast(`${l.productName} is serial-tracked — deliver all ${l.qty} units or remove serials to split`, 'error')
            return
          }
        }
  
        // Stock deduction is server-authoritative via /api/deliveries/:id/validate
        // (applyDeliveryStockMutation + COGS). Client only updates warranties,
        // reservations, backorders, and delivery/SO status — never re-decrements qty.
        const completedLines = del.lines.map((l, i) => ({
          ...l,
          qtyDone: lineDone[i] ?? 0,
        }))
  
        try {
          const res = await fetch(`/api/deliveries/${deliveryId}/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'done',
              lines: completedLines,
              warrantyCreated: false,
              autoInvoice: false,
            }),
          })
          if (!res.ok) {
            const payload = await res.json().catch(() => null) as { error?: string } | null
            store.showToast(payload?.error || 'Delivery validation failed', 'error')
            return
          }
        } catch {
          store.showToast('Could not validate delivery on server', 'error')
          return
        }
  
        const newWarranties: Warranty[] = []
        doneLines.forEach(l => {
          const prod = store.prodRef.current.find(x => x.id === l.productId)
          l.serialIds.forEach(sid => {
            store.setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'sold', location: 'customer', soldDate: now(), saleOrderId: del.saleOrderId } : s))
            if (prod && resolveWarrantyMonths(prod.warrantyMonths, store.systemSettings.invDefaultWarrantyMonths) > 0) {
              const serial = store.serialRef.current.find(s => s.id === sid)
              const months = resolveWarrantyMonths(prod.warrantyMonths, store.systemSettings.invDefaultWarrantyMonths)
              const war: Warranty = {
                id: uid(), ref: '',
                customerId: del.customerId, customerName: del.customerName,
                productId: l.productId, productName: l.productName,
                serialId: sid, serialNumber: serial?.serial ?? '',
                deliveryId: del.id, saleOrderRef: so.ref,
                startDate: now(), endDate: addWarrantyMonths(now(), months),
                status: 'active', months,
              }
              newWarranties.push(war)
            }
          })
        })
        // Issued on the server from what was sold (lib/warranty/e-warranty.ts), with their e-warranty links.
        if (newWarranties.length > 0) store.requestWarrantySync()
        store.setStockReservations(prev => prev.map(r => {
          if ((r.deliveryId ? r.deliveryId !== deliveryId : r.referenceId !== so.id) || r.status !== 'reserved') return r
          const deliveredLine = doneLines.find(line => line.productId === r.productId)
          if (!deliveredLine) return r
          const fulfilledQty = Math.min(r.qty, r.fulfilledQty + deliveredLine.qty)
          return {
            ...r,
            fulfilledQty,
            status: fulfilledQty >= r.qty ? 'fulfilled' as const : 'reserved' as const,
            fulfilledDate: fulfilledQty >= r.qty ? now() : r.fulfilledDate,
          }
        }))
  
        // Backorder for the undelivered remainder (linked to the same SO).
        let backorder: Delivery | null = null
        const shippedByProduct: Record<string, number> = {}
        doneLines.forEach(l => {
          shippedByProduct[l.productId] = (shippedByProduct[l.productId] ?? 0) + l.qty
        })
        const remainingAfterShip = remainingUndeliveredByProduct(
          allocateDeliveredQtyToOrderLines(so.lines ?? [], shippedByProduct, 'add'),
        )
        const otherOpenDemand = openDeliveryDemandByProduct(
          store.delRef.current.filter(d => d.id !== deliveryId),
          del.saleOrderId,
        )
        const clampedBackorder = backorderLines
          .map(line => {
            const soRemain = remainingAfterShip[line.productId] ?? 0
            const alreadyOpen = otherOpenDemand[line.productId] ?? 0
            const need = Math.max(0, Math.min(line.qty, soRemain - alreadyOpen))
            return need > 0 ? { ...line, qty: need, qtyDone: 0, serialIds: [] as string[] } : null
          })
          .filter(Boolean) as typeof backorderLines
        if (clampedBackorder.length > 0 && !cancelRemaining) {
          const backorderShort = clampedBackorder.some(l => {
            const prod = store.prodRef.current.find(p => p.id === l.productId)
            if (isNonStockSaleLine(l, prod ?? null)) return false
            return (Number(prod.stockQty) || 0) < l.qty
          })
          backorder = {
            id: uid(), ref: await store.storeCtxRef.current!.allocateDocRef('DN'), saleOrderId: del.saleOrderId, saleOrderRef: del.saleOrderRef,
            customerId: del.customerId, customerName: del.customerName,
            status: initialDeliveryState(backorderShort), date: now(),
            lines: clampedBackorder,
            warrantyCreated: false,
            backorderOfId: del.id,
            backorderOfRef: del.ref,
          }
          sync('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backorder) })
        }
        store.setDeliveries(p => {
          const next = p.map(d => d.id === deliveryId ? {
            ...d,
            status: 'done' as const,
            warrantyCreated: newWarranties.length > 0,
            lines: completedLines,
          } : d)
          return backorder ? [backorder, ...next] : next
        })
  
        store.setSaleOrders(p => p.map(s => {
          if (s.id !== del.saleOrderId) return s;
          const doneByProduct: Record<string, number> = {}
          doneLines.forEach(l => { doneByProduct[l.productId] = (doneByProduct[l.productId] ?? 0) + l.qty })
          const allocated = allocateDeliveredQtyToOrderLines(s.lines, doneByProduct, 'add')
          const trimmed = cancelRemaining
            ? trimSaleOrderLinesToDelivered(allocated)
            : { lines: allocated, changed: false, releasedSerialIds: [] }
          if (trimmed.releasedSerialIds.length > 0) {
            store.setSerials(prev => prev.map(serial =>
              trimmed.releasedSerialIds.includes(serial.id) ? { ...serial, status: 'available' } : serial,
            ))
          }
          const money = calcSaleOrderTotals(trimmed.lines, { headerDiscount: Number(s.discountAmount) || 0 })
          const updated = {
            ...s,
            lines: trimmed.lines,
            subtotal: money.subtotal,
            taxTotal: money.taxAmount,
            taxAmount: money.taxAmount,
            discountAmount: money.discountAmount,
            total: money.totalAmount,
            totalAmount: money.totalAmount,
          }
          sync(`/api/sale-orders/${s.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fulfillmentSaleOrderPatch(
              updated as unknown as Record<string, unknown>,
              { cancelRemaining, trimmedChanged: trimmed.changed },
            )),
          })
          return updated
        }))
        store.addAuditLog(
          'validate_delivery',
          del.ref,
          `Delivery validated${backorder ? ` · backorder ${backorder.ref} created` : cancelRemaining ? ' · remaining lines dropped' : ''}`,
        )
        store.showToast(
          `Delivery done · stock updated${
            backorder
              ? ` · backorder ${backorder.ref} created`
              : cancelRemaining
                ? ' · remaining lines dropped'
                : ''
          }${newWarranties.length > 0 ? ` · ${newWarranties.length} warranty(ies) created` : ''}`,
        )
      },

    markDeliveryNoteGenerated: async (deliveryId) => {
        const delivery = store.delRef.current.find(item => item.id === deliveryId)
        const user = store.currentUser()
        if (!delivery || delivery.status !== 'done') {
          store.showToast('Only a validated delivery can generate the final Delivery Note', 'error')
          return false
        }
        // Heal qtyDone from serials when the Done delivery was saved with Delivered=0
        // (legacy bug). Never stamp a DN that unlocks invoicing with zero delivered.
        const healedLines = delivery.lines.map(line => {
          const qtyDone = Math.max(
            Number(line.qtyDone) || 0,
            Array.isArray(line.serialIds) ? line.serialIds.length : 0,
          )
          return { ...line, qtyDone: Math.min(line.qty, qtyDone) }
        })
        const deliveredTotal = healedLines.reduce((sum, line) => sum + (Number(line.qtyDone) || 0), 0)
        if (deliveredTotal <= 0) {
          store.showToast('Cannot generate Delivery Note — delivered quantity is 0. Prepare/validate with quantities (or serials) first.', 'error')
          return false
        }
        const so = store.soRef.current.find(s => s.id === delivery.saleOrderId)
        if (so) {
          // Persist SO qtyDelivered so Create Invoice (delivery policy) can proceed.
          // FIFO allocation — duplicate product rows must not each receive the full total.
          const doneByProduct: Record<string, number> = {}
          healedLines.forEach(line => {
            if ((line.qtyDone || 0) > 0) {
              doneByProduct[line.productId] = (doneByProduct[line.productId] ?? 0) + (line.qtyDone || 0)
            }
          })
          const healedSoLines = allocateDeliveredQtyToOrderLines(so.lines, doneByProduct, 'max')
          const prevById = new Map(so.lines.map(l => [l.id, Number(l.qtyDelivered) || 0]))
          const lineUpdates = healedSoLines
            .map(line => {
              if (!line.id) return null
              const next = Number(line.qtyDelivered) || 0
              const prev = prevById.get(line.id) ?? 0
              if (next <= prev) return null
              return { id: line.id, qtyDelivered: next }
            })
            .filter(Boolean) as Array<{ id: string; qtyDelivered: number }>
          if (lineUpdates.length > 0) {
            try {
              await fetch(`/api/sale-orders/${so.id}/deliver-lines`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines: lineUpdates }),
              })
            } catch { /* local heal below still applies */ }
            store.setSaleOrders(prev => prev.map(order => {
              if (order.id !== so.id) return order
              return {
                ...order,
                lines: order.lines.map(line => {
                  const upd = lineUpdates.find(u => u.id === line.id)
                  return upd ? { ...line, qtyDelivered: upd.qtyDelivered } : line
                }),
              }
            }))
          }
        }
        const patch = {
          deliveryNoteGeneratedAt: new Date().toISOString(),
          deliveryNoteGeneratedByUserId: user?.id,
          lines: healedLines,
        }
        try {
          const response = await fetch(`/api/deliveries/${deliveryId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          })
          if (!response.ok) {
            store.showToast('Delivery Note opened, but its generated status could not be saved', 'error')
            return false
          }
          store.setDeliveries(prev => prev.map(item => item.id === deliveryId ? { ...item, ...patch } : item))
          store.addAuditLog('generate_delivery_note', delivery.ref, `Final Delivery Note generated by ${user?.name ?? 'user'} (${deliveredTotal} unit(s))`)
          return true
        } catch {
          store.showToast('Delivery Note opened, but the server could not be reached', 'error')
          return false
        }
      },

    updateDelivery: (deliveryId, p) => {
        store.setDeliveries(prev => prev.map(d => d.id === deliveryId ? { ...d, ...p } : d))
        sync(`/api/deliveries/${deliveryId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      },

    createInvoiceFromSO: async (orderId, lineOverridesOrOpts) => {
        if (!canCreateCustomerInvoiceFromSOAction(store.currentUser())) {
          store.showToast('Only Finance or Admin Officer can create invoices from a sale order', 'error'); return {} as Invoice;
        }
        const so = store.soRef.current.find(s => s.id === orderId)
        if (!so) { store.showToast('Sale order not found', 'error'); return {} as Invoice }
        if (so.status !== 'sale') {
          store.showToast('Only a confirmed Sales Order can be invoiced', 'error'); return {} as Invoice;
        }
        const invoiceOpts = Array.isArray(lineOverridesOrOpts)
          ? { mode: 'regular' as const, lines: lineOverridesOrOpts }
          : {
              mode: normalizeCreateInvoiceMode(lineOverridesOrOpts?.mode),
              percent: lineOverridesOrOpts?.percent,
              amount: lineOverridesOrOpts?.amount,
              lines: lineOverridesOrOpts?.lines,
            }
        const lineOverrides = invoiceOpts.lines
        // Down payments are commercial deposits — no delivery gate.
        // Regular/final still defer to the server for ordered vs delivered policy.
        if (!isDownPaymentMode(invoiceOpts.mode) && invoiceOpts.mode !== 'final') {
          // Soft client hint only for classic regular invoices when nothing
          // looks invoiceable yet; server is authoritative for mixed policies.
          if (!hasValidatedDeliveryForInvoice(store.delRef.current, orderId)) {
            const anyOrderPolicy = (so.lines ?? []).some((l: any) => {
              if (l.lineType === 'section') return false
              const product = store.prodRef.current.find(p => p.id === l.productId)
              return resolveInvoicePolicy({
                linePolicy: l.invoicePolicy,
                productPolicy: product?.invoicePolicy,
                productUnit: product?.unit,
                productKind: product?.productKind,
                productCategory: product?.category,
                trackingMethod: product?.trackingMethod,
                trackStock: product?.trackStock,
                productId: l.productId,
                lineType: l.lineType,
                lineUnit: l.unit,
              }) === 'order'
            })
            if (!anyOrderPolicy) {
              store.showToast('Validate the delivery before creating an invoice', 'error')
              return {} as Invoice
            }
          }
        }
  
        // Prefer server-atomic path (qtyInvoiced bump + invoice create in one transaction).
        try {
          const payloadBody: Record<string, unknown> = { mode: invoiceOpts.mode }
          if (invoiceOpts.percent != null) payloadBody.percent = invoiceOpts.percent
          if (invoiceOpts.amount != null) payloadBody.amount = invoiceOpts.amount
          if (lineOverrides?.length) payloadBody.lines = lineOverrides
          const response = await fetch(`/api/sale-orders/${orderId}/create-invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadBody),
          })
          const payload = await response.json().catch(() => null) as {
            ok?: boolean
            error?: string
            invoice?: Invoice & { taxTotal?: number }
          } | null
          if (response.ok && payload?.ok && payload.invoice?.id) {
            const remote = payload.invoice
            let remoteLines = Array.isArray(remote.lines) ? remote.lines : []
            let subtotal = Number(remote.subtotal) || 0
            let taxTotal = Number(remote.taxTotal) || 0
            let total = Number(remote.total) || 0
  
            // Defensive hydrate: never fall through to client re-invoice (qtyInvoiced already locked).
            if (remoteLines.length === 0) {
              try {
                const detailRes = await fetch(`/api/invoices/${remote.id}`)
                if (detailRes.ok) {
                  const detail = await detailRes.json() as {
                    items?: Array<{
                      id?: string; description?: string | null; qty?: number; unitPrice?: number
                      taxRate?: number; lineSubtotal?: number; productId?: string | null
                    }>
                    subtotal?: number; taxAmount?: number; totalAmount?: number
                  }
                  remoteLines = (detail.items ?? []).map((item, idx) => ({
                    id: item.id ?? `line-${idx}`,
                    description: item.description ?? '',
                    qty: Number(item.qty) || 0,
                    unitPrice: Number(item.unitPrice) || 0,
                    taxRate: Number(item.taxRate) || 0,
                    subtotal: Number(item.lineSubtotal) || Math.round((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)),
                    ...(item.productId ? { productId: item.productId } : {}),
                  }))
                  if (Number(detail.subtotal)) subtotal = Number(detail.subtotal)
                  if (detail.taxAmount != null) taxTotal = Number(detail.taxAmount) || 0
                  if (Number(detail.totalAmount)) total = Number(detail.totalAmount)
                }
              } catch { /* InvoiceDetail will hydrate if needed */ }
            }
  
            if (remoteLines.length === 0) {
              store.showToast('Invoice was created but line items could not be loaded — open the invoice to refresh', 'error')
            }
  
            const local: Invoice = {
              id: remote.id,
              ref: remote.ref,
              type: 'customer_invoice',
              status: 'draft',
              partnerId: remote.partnerId || so.customerId,
              partnerName: remote.partnerName || so.customerName,
              date: remote.date || now(),
              dueDate: remote.dueDate || store.addDays(now(), parseInt(so.paymentTerms ?? '', 10) || 0),
              lines: remoteLines,
              subtotal: subtotal || remoteLines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0),
              taxTotal,
              total: total || subtotal + taxTotal,
              amountPaid: Number(remote.amountPaid) || 0,
              saleOrderId: remote.saleOrderId || so.id,
              ...(remote.repairId ? { repairId: remote.repairId } : {}),
              notes: remote.notes || `Created from ${so.ref}`,
              invoiceAddress: so.invoiceAddress,
              deliveryAddress: so.deliveryAddress,
              ...(so.customerRef ? { customerPoNumber: so.customerRef } : {}),
              ...documentMoneySnapshot({
                currencyCode: (remote as any).currencyCode || so.currencyCode || store.companySettings.currency,
                exchangeRateToBase: (remote as any).exchangeRateToBase ?? so.exchangeRateToBase,
              }),
            }
            // Only push into local store when we have lines — empty shells overwrite the mirror.
            if (remoteLines.length > 0) {
              store.setInvoices(p => [local, ...p.filter(i => i.id !== local.id)])
            }
            if (remote.repairId) {
              store.setRepairs(p => p.map(r => {
                if (r.id !== remote.repairId || r.invoiceId) return r
                return {
                  ...r,
                  invoiceId: local.id,
                  invoiceDate: local.date,
                }
              }))
            }
            // Pull the server-authoritative SO back immediately so qtyInvoiced
            // and the Sales Order invoice status cannot stay on "To Invoice"
            // until SSE/localStorage catches up.
            try {
              const soResponse = await fetch(`/api/sale-orders/${orderId}`, { cache: 'no-store' })
              if (soResponse.ok) {
                const refreshedOrder = await soResponse.json()
                store.applySaleOrderPersistResult(store.setSaleOrders, store.soRef, orderId, refreshedOrder, { syncLines: true })
              }
            } catch { /* SSE remains the fallback */ }
  
            store.addAuditLog('create_invoice_from_so', local.ref, `Draft invoice created from ${so.ref} (server atomic)`)
            store.showToast(`Draft invoice ${local.ref} created — post it to finalize`)
            return local
          }
          store.showToast(payload?.error || 'Could not create the invoice — try again', 'error')
          return {} as Invoice
        } catch {
          // Do NOT fall back to a client-side invoice-creation path here. The
          // server's create-invoice endpoint atomically bumps qtyInvoiced and
          // creates the invoice inside one transaction with a guarded update —
          // if this request actually reached the server and committed before
          // the network dropped, a client-side fallback would create a SECOND
          // invoice for the same delivered quantity. Retrying this same
          // endpoint is safe (the guard makes it idempotent): if the first
          // attempt already invoiced everything, the retry finds nothing left
          // to invoice instead of duplicating it.
          store.showToast(
            lineOverrides
              ? 'Could not reach the server to create the partial invoice — check your connection and retry'
              : 'Could not reach the server to create the invoice — check your connection and retry',
            'error',
          )
          return {} as Invoice
        }
      },

    deleteSaleOrder: (id) => {
        const actor = store.currentUser()
        const so = store.soRef.current.find(s => s.id === id)
        if (!so) return
        const isQuotation = ['draft', 'sent', 'quotation', 'quotation_sent'].includes(so.status)
        if (!isQuotation && !isDirector(actor?.role)) {
          store.showToast('Only a director can delete confirmed sale orders — cancel or reset instead', 'error')
          return
        }
        if (!isQuotation) {
          const blockers = saleOrderCancelBlockers({
            status: so.status,
            deliveries: store.delRef.current.filter(d => d.saleOrderId === id),
            invoices: store.invRef.current.filter(i => i.saleOrderId === id),
          })
          if (blockers.length > 0) {
            store.showToast(`Cannot delete ${so.ref}: ${blockers.join('; ')}`, 'error')
            return
          }
        }
        store.setSaleOrders(p => p.filter(s => s.id !== id))
        sync(`/api/sale-orders/${id}`, { method: 'DELETE' })
        store.addAuditLog('delete_sale_order', so.ref, `Deleted by ${actor?.name || 'user'}`)
        store.showToast('Order deleted')
      },

    resetSOToDraft: async (id) => {
        // Odoo "Set to Quotation": back to the quotation stage. Pending
        // deliveries are cancelled and reservations released so the quotation
        // carries no fulfilment side effects.
        const actor = store.currentUser()
        const so = store.soRef.current.find(s => s.id === id)
        if (!so) return false
        // Sent → draft: sales staff may unlock for edits. Confirmed SO → quotation
        // still requires Finance / Admin Officer / Director.
        const salesCanResetSent = userCan(actor, 'sales.quotes.create')
        const financeCanResetConfirmed = canReverseConfirmedSale(actor?.role)
        if (so.status === 'quotation_sent' || so.status === 'cancelled') {
          if (!actor || !salesCanResetSent) {
            store.showToast('You do not have permission to reset this quotation to draft', 'error')
            return false
          }
        } else if (!actor || !financeCanResetConfirmed) {
          store.showToast('Only Finance, Admin Officer, or Director can reset a sale order to quotation', 'error')
          return false
        }
        const blockers = saleOrderCancelBlockers({
          status: so.status === 'sale' ? 'sale' : so.status,
          deliveries: store.delRef.current.filter(d => d.saleOrderId === id),
          invoices: store.invRef.current.filter(i => i.saleOrderId === id),
        })
        // Always block reset when fulfilment/AR exists (same as cancel for confirmed).
        if (so.status === 'sale' && blockers.length > 0) {
          store.showToast(`Cannot reset ${so.ref}: ${blockers.join('; ')}`, 'error')
          return false
        }
        const pendingDeliveries = store.delRef.current.filter(d => d.saleOrderId === id && ['draft', 'waiting', 'ready'].includes(d.status))
        // Persist the status change first so a failed PATCH cannot leave the UI
        // editable while the server still has quotation_sent / sale.
        const updated = {
          ...so,
          status: 'quotation' as const,
          savedAt: undefined,
          deliveryId: undefined,
          locked: undefined,
          confirmedAt: undefined,
          confirmedById: undefined,
          confirmedByName: undefined,
          // Clear send/accept stamps so "Send" is treated as initial again after reset.
          sentAt: undefined,
          sentTo: undefined,
          sentById: undefined,
          sentByName: undefined,
          sentMessage: undefined,
          acceptedAt: undefined,
          acceptedById: undefined,
          acceptedByName: undefined,
          lines: so.lines.map((l: any) => ({ ...l, serialIds: [] })),
        }
        const result = await store.patchSaleOrderPersist(id, {
          ...updated,
          locked: false,
          confirmedAt: null,
          sentAt: null,
          sentTo: null,
          sentById: null,
          sentMessage: null,
          acceptedAt: null,
          acceptedById: null,
        })
        if (!result.ok) {
          store.showToast(result.error || 'Could not reset to quotation — try again', 'error')
          return false
        }
        pendingDeliveries.forEach(d => {
          store.setDeliveries(prev => prev.map(x => x.id === d.id ? { ...x, status: 'cancelled' as const } : x))
          sync(`/api/deliveries/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) })
        })
        store.setStockReservations(prev => prev.map(r =>
          r.referenceId === id && r.status === 'reserved' ? { ...r, status: 'cancelled' as const } : r
        ))
        // Release SO-picked serials back to available (same as cancel) so Available stock recovers:
        // those on the order lines, on the deliveries just cancelled, and any linked to the order.
        const allSerialIds = new Set<string>([
          ...so.lines.flatMap((l: any) => l.serialIds ?? []),
          ...pendingDeliveries.flatMap(d => d.lines.flatMap(l => l.serialIds ?? [])),
        ])
        store.setSerials(p => p.map(s =>
          (allSerialIds.has(s.id) || s.saleOrderId === id) && !['sold', 'delivered'].includes(String(s.status))
            ? { ...s, status: 'available', saleOrderId: undefined }
            : s))
        const [normalized] = normalizeSaleOrdersForClient([
          { ...updated, ...(result.data && typeof result.data === 'object' ? result.data : {}), status: 'quotation' },
        ]) as SaleOrder[]
        const nextRow = normalized ?? updated
        store.soRef.current = store.soRef.current.map(s => s.id === id ? nextRow : s)
        store.setSaleOrders(p => p.map(s => s.id === id ? nextRow : s))
        store.addAuditLog('reset_to_quotation', so.ref, `Order set back to Quotation by ${actor.name}`)
        store.showToast(so.status === 'quotation_sent' ? 'Quotation reset to draft — you can edit and save' : 'Order set back to Quotation')
        return true
      },

    cancelSO: (id) => {
        const actor = store.currentUser()
        const so = store.soRef.current.find(s => s.id === id)
        if (!so) return
        // Cancelling a confirmed Sales Order reverses a commercial document,
        // same as "Set to Quotation" — requires Finance / Admin Officer /
        // Director (matches the server-side gate in saleTransitionError).
        if (so.status === 'sale' && !canReverseConfirmedSale(actor?.role)) {
          store.showToast('Only Finance, Admin Officer, or Director can cancel a confirmed Sales Order', 'error')
          return
        }
        // Dependent records are never silently cancelled: completed deliveries,
        // posted invoices and registered payments must be reversed first.
        const blockers = saleOrderCancelBlockers({
          status: so.status,
          deliveries: store.delRef.current.filter(d => d.saleOrderId === id),
          invoices: store.invRef.current.filter(i => i.saleOrderId === id),
        })
        if (blockers.length > 0) {
          store.showToast(`Cannot cancel ${so.ref}: ${blockers.join('; ')}`, 'error')
          return
        }
        // Release serials, pending deliveries and reservations. A serial claimed when the delivery was
        // prepared sits on the delivery lines and is linked to the order (saleOrderId), not always on
        // the order lines, so all three sources are released; sold units are never touched.
        const allSerialIds = new Set<string>([
          ...so.lines.flatMap((l: any) => l.serialIds ?? []),
          ...store.delRef.current
            .filter(d => d.saleOrderId === id && ['draft', 'waiting', 'ready'].includes(d.status))
            .flatMap(d => d.lines.flatMap(l => l.serialIds ?? [])),
        ])
        store.setSerials(p => p.map(s =>
          (allSerialIds.has(s.id) || s.saleOrderId === id) && !['sold', 'delivered'].includes(String(s.status))
            ? { ...s, status: 'available', saleOrderId: undefined }
            : s))
        store.delRef.current.filter(d => d.saleOrderId === id && ['draft', 'waiting', 'ready'].includes(d.status)).forEach(d => {
          store.setDeliveries(prev => prev.map(x => x.id === d.id ? { ...x, status: 'cancelled' as const } : x))
          sync(`/api/deliveries/${d.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) })
        })
        store.setStockReservations(prev => prev.map(r =>
          r.referenceId === id && r.status === 'reserved' ? { ...r, status: 'cancelled' as const } : r
        ))
        store.setSaleOrders(p => p.map(s => {
          if (s.id !== id) return s;
          const updated = { ...s, status: 'cancelled' as const }
          sync(`/api/sale-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
        store.addAuditLog('cancel_sale_order', so.ref, 'Order cancelled')
        store.showToast('Order cancelled')
      },

    createNewSOVersion: async (orderId) => {
        const so = store.soRef.current.find(s => s.id === orderId)
        if (!so) { store.showToast('Quotation not found', 'error'); return null }
        if (!isQuotationStage(so.status)) {
          store.showToast('Only quotations can be revised — confirmed Sales Orders require an amendment', 'error')
          return null
        }
        try {
          const res = await fetch(`/api/sale-orders/${orderId}/new-version`, { method: 'POST' })
          const payload = await res.json().catch(() => null)
          if (!res.ok || !payload?.id) {
            store.showToast(payload?.error || 'Could not revise this quotation', 'error')
            return null
          }
          const created = payload as SaleOrder
          store.setSaleOrders(p => [created, ...p])
          store.addAuditLog('sale_order_new_version', created.ref, `Revision ${created.versionNumber} created from ${so.ref}`)
          store.showToast(`Revision ${created.versionNumber ?? 1} created — edit and resend ${created.ref}`)
          return created
        } catch {
          store.showToast('Could not reach the server to revise this quotation', 'error')
          return null
        }
      },

    // ── POS ───────────────────────────────────────────────────────────────────
    openPOSSession: (openingCash) => {
        if (hasActivePosSession({ posSessionOpen: store.posSessionOpen, posSessionId: store.posSessionId, posSessions: store.posSessions })) {
          store.showToast('A POS session is already open', 'error')
          return
        }
        const user = store.currentUser()
        const session: POSSession = {
          id: uid(),
          ref: allocateDocNumberSync('POSSESS'), // the server's number follows (numberPosSessions)
          status: 'open',
          openedAt: new Date().toISOString(),
          openingCash: Math.max(0, Number(openingCash) || 0),
          totalSales: 0,
          totalCash: 0,
          totalMpesa: 0,
          totalCard: 0,
          orderCount: 0,
          openedBy: user?.name || user?.username,
        }
        store.setPosSessions(p => [session, ...p.map(s => (
          s.status === 'open' ? { ...s, status: 'closed' as const, closedAt: new Date().toISOString() } : s
        ))])
        store.numberPosSessions([session.id])
        store.setPosSessionId(session.id)
        store.setPosSessionOpen(true)
        store.setPosSessionOpeningCash(session.openingCash)
        store.addAuditLog('open_pos_session', session.ref, `Opening cash ${store.fmtKes(session.openingCash)}`)
        store.showToast(`POS session ${session.ref} opened`)
      },

    closePOSSession: (closingCash) => {
        const user = store.currentUser()
        const sessionId = resolveOpenPosSessionId({ posSessionOpen: store.posSessionOpen, posSessionId: store.posSessionId, posSessions: store.posSessions })
        // Orphaned open flag (no id / no open history): clear the till so cashiers can reopen.
        if (!sessionId) {
          if (store.posSessionOpen || store.posSessionId) {
            store.setPosSessionOpen(false)
            store.setPosSessionId(null)
            store.setPosSessionOpeningCash(0)
            store.showToast('Cleared stuck POS session — open a new session to continue', 'info')
            return null
          }
          store.showToast('No open POS session', 'error')
          return null
        }
        if (!store.posSessionId || store.posSessionId !== sessionId) {
          store.setPosSessionId(sessionId)
          store.setPosSessionOpen(true)
        }
        const openSession = store.posSessions.find(s => s.id === sessionId)
        const orders = posOrdersForSession(store.posOrders, sessionId, openSession?.openedAt)
        const tenderAmount = (order: POSOrder) => Math.max(0, order.total - (order.customerCreditAmount || 0))
        const totalCash = orders.filter(o => o.payment === 'cash').reduce((a, o) => a + tenderAmount(o), 0)
        const totalMpesa = orders.filter(o => o.payment === 'mpesa').reduce((a, o) => a + tenderAmount(o), 0)
        const totalBank = orders.filter(o => isPosBankPayment(o.payment)).reduce((a, o) => a + tenderAmount(o), 0)
        const totalCard = totalBank // legacy field: bank + historical card
        const totalSales = orders.reduce((a, o) => a + o.total, 0)
        const counted = Math.max(0, Number(closingCash) || 0)
        const expectedCash = store.posSessionOpeningCash + totalCash
        const cashDifference = counted - expectedCash
  
        let journalId: string | undefined
        // Session settlement journal: tender totals (memo lines via balanced cash control).
        // Per-sale journals already recognized revenue; here we post cash over/short + a
        // zero-impact control entry summarizing tender mix for the GL/audit trail.
        const controlLines: JournalEntryLine[] = []
        if (Math.abs(cashDifference) >= 1) {
          if (cashDifference > 0) {
            controlLines.push(accountLine('2211 - Petty Cash', 'Cash over on session close', cashDifference, 0))
            controlLines.push(accountLine('6595 - Cash Over/Short', 'Cash over on session close', 0, cashDifference))
          } else {
            const short = Math.abs(cashDifference)
            controlLines.push(accountLine('6595 - Cash Over/Short', 'Cash short on session close', short, 0))
            controlLines.push(accountLine('2211 - Petty Cash', 'Cash short on session close', 0, short))
          }
        }
        // Balanced tender summary (Dr tender / Cr same tender) so method totals appear in journals.
        if (totalCash > 0) {
          controlLines.push(accountLine('2211 - Petty Cash', `Session cash sales ${store.fmtKes(totalCash)}`, totalCash, 0))
          controlLines.push(accountLine('2211 - Petty Cash', `Session cash sales cleared`, 0, totalCash))
        }
        if (totalMpesa > 0) {
          controlLines.push(accountLine('2210 - M-Pesa Paybill', `Session M-Pesa sales ${store.fmtKes(totalMpesa)}`, totalMpesa, 0))
          controlLines.push(accountLine('2210 - M-Pesa Paybill', `Session M-Pesa sales cleared`, 0, totalMpesa))
        }
        const bankByAccount = new Map<string, number>()
        for (const o of orders) {
          if (!isPosBankPayment(o.payment)) continue
          const id = o.bankAccountId || bankAccountIdForMethod(o.payment)
          bankByAccount.set(id, (bankByAccount.get(id) || 0) + tenderAmount(o))
        }
        for (const [bankId, amt] of bankByAccount) {
          if (amt <= 0) continue
          const label = bankAccountLabel(bankId)
          controlLines.push(accountLine(label, `Session bank sales ${store.fmtKes(amt)}`, amt, 0))
          controlLines.push(accountLine(label, `Session bank sales cleared`, 0, amt))
        }
  
        const sessionRef = openSession?.ref || allocateDocNumberSync('POSSESS')
        // The ledger keeps one journal per number and skips a repeat: a session
        // whose number is not yet the server's, or that another session shares,
        // closes under a journal number that also names the session.
        const claimedIds = new Set(
          orders.filter(o => o.sessionId === 'active').map(o => o.id).filter(Boolean),
        )
        if (claimedIds.size > 0) {
          store.setPosOrders(prev => prev.map(o => claimedIds.has(o.id) ? { ...o, sessionId } : o))
        }
        if (controlLines.length > 0) {
          const debit = controlLines.reduce((a, l) => a + l.debit, 0)
          const credit = controlLines.reduce((a, l) => a + l.credit, 0)
          const journal: JournalEntry = {
            id: uid(),
            ref: !isProvisionalDocRef(sessionRef) && !store.posSessions.some(s => s.id !== sessionId && s.ref === sessionRef) ? `JRN/${sessionRef}` : `JRN/${sessionRef}/${sessionId}`,
            date: now(),
            source: 'pos_session',
            description: `POS session close ${sessionRef} · sales ${store.fmtKes(totalSales)} · cash ${store.fmtKes(totalCash)} · mpesa ${store.fmtKes(totalMpesa)} · bank ${store.fmtKes(totalBank)} · variance ${store.fmtKes(cashDifference)}`,
            status: 'posted',
            bankAccountId: 'cash',
            lines: controlLines,
            totalDebit: debit,
            totalCredit: credit,
          }
          journalId = journal.id
          store.setJournalEntries(p => [journal, ...p])
          // No POS-session endpoint existed, so the tender control journal
          // reached the ledger only if the blob mirror replayed it.
          store.postSystemJournal('pos_session', journal, message => store.showToast(message, 'error'))
          store.addAuditLog('close_pos_session', sessionRef, journal.description)
        }
  
        const closed: POSSession = {
          id: sessionId,
          ref: sessionRef,
          status: 'closed',
          openedAt: openSession?.openedAt || new Date().toISOString(),
          closedAt: new Date().toISOString(),
          openingCash: store.posSessionOpeningCash,
          closingCash: counted,
          expectedCash,
          cashDifference,
          totalSales,
          totalCash,
          totalMpesa,
          totalCard,
          totalBank,
          orderCount: orders.length,
          openedBy: openSession?.openedBy,
          closedBy: user?.name || user?.username,
          journalId,
        }
        store.setPosSessions(p => {
          const exists = p.some(s => s.id === sessionId)
          return exists ? p.map(s => s.id === sessionId ? closed : s) : [closed, ...p]
        })
        store.setPosSessionOpen(false)
        store.setPosSessionId(null)
        store.setPosSessionOpeningCash(0)
        store.showToast(
          cashDifference === 0
            ? `Session closed · ${orders.length} sales · ${store.fmtKes(totalSales)}`
            : `Session closed · cash variance ${store.fmtKes(cashDifference)}`,
          cashDifference === 0 ? 'success' : 'info',
        )
        return closed
      },

    createPOSOrder: async (lines, payment, customerId, customerName, pointsRedeemed = 0, applyVat = false, paymentMeta) => {
        let sessionId = resolveOpenPosSessionId({ posSessionOpen: store.posSessionOpen, posSessionId: store.posSessionId, posSessions: store.posSessions })
        if (!sessionId && store.posSessionOpen) {
          // Till is open but the id drifted — attach a real session and keep charging.
          const user = store.currentUser()
          const repaired: POSSession = {
            id: uid(),
            ref: allocateDocNumberSync('POSSESS'),
            status: 'open',
            openedAt: new Date().toISOString(),
            openingCash: store.posSessionOpeningCash,
            totalSales: 0,
            totalCash: 0,
            totalMpesa: 0,
            totalCard: 0,
            orderCount: 0,
            openedBy: user?.name || user?.username,
          }
          store.setPosSessions(p => [repaired, ...p])
          store.numberPosSessions([repaired.id])
          store.setPosSessionId(repaired.id)
          sessionId = repaired.id
        }
        if (!sessionId) {
          store.showToast('Open a POS session before charging', 'error')
          return null
        }
        const normalizedLines = lines.map(l => ({ ...l, subtotal: Number(l.price || 0) * Number(l.qty || 0) }))
        const sub = normalizedLines.reduce((a, l) => a + l.subtotal, 0)
        const vatRate = Number(store.companySettings.vatRate ?? 16)
        const tax = applyVat ? Math.round(sub * vatRate / 100) : 0
        const total = Math.max(0, sub + tax - pointsRedeemed)
        const requestedCustomerCredit = Math.max(0, Number(paymentMeta?.customerCreditAmount) || 0)
        const user = store.currentUser()
        if (requestedCustomerCredit > 0 && !customerId) {
          store.showToast('Select a customer before applying client credit', 'error')
          return null
        }
        if (requestedCustomerCredit > 0 && !canApplyCustomerCredit(user?.role)) {
          store.showToast('Only Finance, Admin Officer, or Director can apply client credit', 'error')
          return null
        }
        const availableCustomerCredit = customerId
          ? customerCreditBalance(store.customerCreditsRef.current, customerId)
          : 0
        if (requestedCustomerCredit > Math.min(availableCustomerCredit, total) + 0.01) {
          store.showToast('Client credit balance changed — review the available balance and try again', 'error')
          return null
        }
        const customerCreditAmount = Math.min(requestedCustomerCredit, availableCustomerCredit, total)
        const tenderTotal = Math.max(0, total - customerCreditAmount)
        const pointsEarned = customerId
          ? loyaltyPointsEarned(total, store.systemSettings.posLoyaltyKesPerPoint)
          : 0
        const resolvedBankId = tenderTotal > 0 && isPosBankPayment(payment)
          ? (paymentMeta?.bankAccountId || bankAccountIdForMethod(payment))
          : undefined
        const paymentReference = tenderTotal > 0
          ? ((paymentMeta?.paymentReference || '').trim() || undefined)
          : undefined
        const cartKey = [sessionId, ...normalizedLines
          .map(l => `${l.productId}:${l.serialId ?? ''}:${l.qty}`)
          .sort()].join('|')
        let orderRef = store.posPendingRefs.current.get(cartKey) ?? ''
        if (!orderRef) {
          try {
            orderRef = await store.storeCtxRef.current!.allocateDocRef('POS')
          } catch {
            orderRef = nextPosTicketRef(store.posOrders.map(o => o.ref))
          }
          if (!/^POS\/\d+$/.test(orderRef)) {
            orderRef = nextPosTicketRef(store.posOrders.map(o => o.ref))
          }
        }
        const invoiceId = uid()
        const creditAppliedAt = now()
        const creditAppliedBy = user?.name || user?.username || 'POS'
        let creditRemaining = customerCreditAmount
        const creditRefs: string[] = []
        const nextCustomerCredits = customerCreditAmount > 0
          ? store.customerCreditsRef.current.map(credit => {
              if (
                creditRemaining <= 0
                || credit.customerId !== customerId
                || !['available', 'partially_used'].includes(credit.status)
                || credit.balance <= 0
              ) return credit
              const amount = Math.min(creditRemaining, credit.balance)
              creditRemaining -= amount
              const nextBalance = Math.max(0, credit.balance - amount)
              creditRefs.push(credit.ref)
              return {
                ...credit,
                balance: nextBalance,
                status: nextBalance <= 0 ? 'used' as const : 'partially_used' as const,
                applications: [
                  ...(credit.applications ?? []),
                  {
                    invoiceId,
                    invoiceRef: orderRef,
                    amount,
                    date: creditAppliedAt,
                    appliedBy: creditAppliedBy,
                  },
                ],
              }
            })
          : store.customerCreditsRef.current
        if (creditRemaining > 0.01) {
          store.showToast('Client credit could not be fully allocated — refresh the customer balance and try again', 'error')
          return null
        }
  
        const order: POSOrder = {
          id: uid(), ref: orderRef, sessionId,
          lines: normalizedLines, subtotal: sub, taxTotal: tax, total, payment,
          bankAccountId: resolvedBankId,
          paymentReference,
          customerId, customerName, date: now(), createdAt: new Date().toISOString(),
          createdByUserId: user?.id, createdByName: user?.name, pointsEarned, pointsRedeemed,
          customerCreditAmount: customerCreditAmount || undefined,
          customerCreditRefs: creditRefs.length ? creditRefs : undefined,
          salespersonId: paymentMeta?.salespersonId || user?.id,
          salespersonName: paymentMeta?.salespersonName || user?.name,
          ...(paymentMeta?.agentId ? {
            agentId: paymentMeta.agentId,
            agentName: paymentMeta.agentName,
            agentCommission: Math.max(0, Number(paymentMeta.agentCommission) || 0),
          } : {}),
          invoiceId,
        }
        // Authoritative stock deduction on the server before local UI mirror.
        const stockLines = normalizedLines.map(l => ({
          productId: l.productId,
          productName: l.productName,
          qty: l.qty,
          serialId: l.serialId,
          serialNumber: l.serialNumber,
          // POS always sells from warehouse (shop is "With Issues").
          sourceLocation: 'warehouse',
        }))
        try {
          const res = await fetch('/api/inventory/apply-pos-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderRef: order.ref,
              lines: stockLines,
              ...(customerId && (pointsEarned || pointsRedeemed) ? { loyalty: { customerId, earned: pointsEarned, redeemed: pointsRedeemed } } : {}),
            }),
          })
          if (!res.ok) {
            const payload = await res.json().catch(() => null) as { error?: string } | null
            // Refused outright (no stock, serial gone): nothing was taken, the
            // number can go. Otherwise the server may have taken the stock.
            if (res.status >= 400 && res.status < 500) store.posPendingRefs.current.delete(cartKey)
            else store.posPendingRefs.current.set(cartKey, orderRef)
            store.showToast(payload?.error || 'POS stock update failed', 'error')
            return null
          }
        } catch {
          store.posPendingRefs.current.set(cartKey, orderRef)
          store.showToast('Could not reach the server — the sale was not completed. Charge again to retry; stock will not be taken twice.', 'error')
          return null
        }
        store.posPendingRefs.current.delete(cartKey)
        // The server has taken the stock and tells every screen; quantities come
        // back from it. Subtracting here as well took a unit off twice whenever
        // the server's new figure reached this tab first — and the browser then
        // saved that figure. Only the serial is marked (setting it is harmless twice).
        normalizedLines.forEach(l => {
          if (l.serialId) store.setSerials(p => p.map(s => s.id === l.serialId ? { ...s, status: 'sold', location: 'customer', soldDate: now() } : s))
        })
        if (customerId) {
          store.setContacts(prev => prev.map(contact =>
            contact.id === customerId
              ? { ...contact, loyaltyPoints: Math.max(0, (contact.loyaltyPoints || 0) - pointsRedeemed) + pointsEarned }
              : contact,
          ))
        }
        if (customerCreditAmount > 0) {
          store.setCustomerCredits(nextCustomerCredits)
          store.addAuditLog(
            'apply_pos_customer_credit',
            order.ref,
            `Applied ${store.fmtKes(customerCreditAmount)} client credit (${creditRefs.join(', ')})`,
          )
        }
  
        // Persist the till ticket before the invoice so a later crash still leaves
        // Transaction History intact. Server union-merge is the source of truth.
        store.setPosOrders(p => [order, ...p])
        if (order.lines.some(l => l.serialId)) store.requestWarrantySync()
        try {
          const recorded = await fetch('/api/pos/record-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order }),
          })
          if (!recorded.ok) throw new Error(`HTTP ${recorded.status}`)
        } catch {
          // The browser copy still syncs it later; say so instead of staying silent.
          store.showToast(`${order.ref}: the till ticket is saved on this device only for now — keep this tab open until it syncs`, 'info')
          store.addAuditLog('pos_record_order_failed', order.ref, 'Till ticket not confirmed by the server')
        }
        // POS sales carry the till-ticket number (POS/NNNN) as their document
        // ref — the invoice record IS the sale receipt, so it shows as POS/0069
        // everywhere instead of consuming an INV/2026/NNNN invoice number.
        const invRefAllocated = orderRef
        const posInv: Invoice = {
          // Posted document, fully settled by the selected tender plus any client credit.
          id: invoiceId, ref: invRefAllocated, type: 'customer_invoice', status: 'posted',
          partnerId: customerId ?? 'walk-in', partnerName: customerName ?? 'Walk-in Customer',
          date: now(), dueDate: now(),
          lines: normalizedLines.map(l => {
            const product = store.prodRef.current.find(x => x.id === l.productId)
            return {
              id: uid(),
              description: l.serialNumber
                ? `${l.productName} ×${l.qty} · SN ${l.serialNumber}`
                : `${l.productName} ×${l.qty}`,
              qty: l.qty,
              unitPrice: l.price,
              taxRate: applyVat ? vatRate : 0,
              subtotal: l.subtotal,
              productId: l.productId,
              serialNumberId: l.serialId,
              accountCode: product ? resolveProductAccounts(product).saleAccountCode : undefined,
            }
          }),
          subtotal: sub, taxTotal: tax, total, amountPaid: total,
          notes: [
            `POS ${order.ref}`,
            paymentReference ? `Ref ${paymentReference}` : '',
            creditRefs.length ? `Client credit ${creditRefs.join(', ')} (${store.fmtKes(customerCreditAmount)})` : '',
          ].filter(Boolean).join(' · '),
          isPosInvoice: true,
          // An agent's sale earns the agent's commission, not the closer's.
          salespersonId: order.agentId ? undefined : order.salespersonId,
          salespersonName: order.agentId ? undefined : order.salespersonName,
        }
        store.setPosOrders(p => p.map(o => o.id === order.id ? { ...o, invoiceRef: posInv.ref } : o))
        store.setInvoices(p => [posInv, ...p])
        await store.saveInvoiceToServer(posInv, msg => store.showToast(msg, 'error'))
        const revenueBuckets = aggregateLinesByAccount({
          lines: posInv.lines,
          resolveProduct: (productId) => store.prodRef.current.find(p => p.id === productId),
          side: 'revenue',
          accounts: store.accountRef.current.map(a => ({ code: a.code, name: a.name })),
        })
        const revenueLines = revenueBuckets.length
          ? revenueBuckets.map(b => accountLine(b.account, `POS revenue ${order.ref}`, 0, b.amount))
          : [accountLine('5000 - Sales Revenue', `POS revenue ${order.ref}`, 0, sub)]
        const posJournal: JournalEntry = {
          id: uid(),
          ref: `JRN/${order.ref}`,
          date: now(),
          source: 'pos',
          description: `POS sale ${order.ref}${order.customerName ? ` — ${order.customerName}` : ''}`,
          status: 'posted',
          invoiceId: posInv.id,
          posOrderId: order.id,
          bankAccountId: bankAccountIdForMethod(payment, resolvedBankId),
          lines: [
            ...(tenderTotal > 0 ? [accountLine(
              bankAccountLabel(bankAccountIdForMethod(payment, resolvedBankId), payment),
              paymentReference ? `POS receipt ${order.ref} · ${paymentReference}` : `POS receipt ${order.ref}`,
              tenderTotal,
              0,
            )] : []),
            ...(customerCreditAmount > 0 ? [accountLine(
              '3313 - Customer Credits',
              `Client credit applied ${creditRefs.join(', ') || order.ref}`,
              customerCreditAmount,
              0,
            )] : []),
            ...(pointsRedeemed > 0 ? [accountLine('5200 - Sales Discounts', `Loyalty redemption ${order.ref}`, pointsRedeemed, 0)] : []),
            ...revenueLines,
            ...(tax > 0 ? [accountLine('3301 - Output VAT Payable', `VAT on ${order.ref}`, 0, tax)] : []),
          ],
          totalDebit: tenderTotal + customerCreditAmount + pointsRedeemed,
          totalCredit: sub + tax,
        }
        // A KES 0 sale has nothing to post; a one-line zero journal can never
        // balance and was retried by the journal mirror forever.
        const posJournalHasValue = posJournal.lines.some(l => Number(l.debit) > 0 || Number(l.credit) > 0)
        if (posJournalHasValue) {
          store.setJournalEntries(p => [posJournal, ...p])
          store.addAuditLog('post_pos', order.ref, `POS sale posted to journal ${posJournal.ref}`)
        }
        // A price typed in below the catalogue price is a discount someone gave:
        // leave a trail of who, what and how much.
        const discounted = normalizedLines.filter(l => Number((l as { listPrice?: number }).listPrice) > Number(l.price))
        if (discounted.length) {
          store.addAuditLog('pos_price_override', order.ref, discounted.map(l =>
            `${l.productName}${l.serialNumber ? ` (${l.serialNumber})` : ''}: ${store.fmtKes(Number((l as { listPrice?: number }).listPrice))} → ${store.fmtKes(l.price)}`,
          ).join('; '))
        }
        let accountingPostError: string | null = null
        try {
          const journalRes = await fetch('/api/pos/post-sale-journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: order.id,
              orderRef: order.ref,
              invoiceId: posInv.id,
              total: posInv.total,
              customerCreditAmount,
              subtotal: sub,
              tax,
              pointsRedeemed,
              paymentMethod: payment,
              bankAccountId: posJournal.bankAccountId,
              customerName: order.customerName,
              revenueLines: revenueBuckets.length
                ? revenueBuckets.map(b => ({ account: b.account, amount: b.amount }))
                : undefined,
              date: posJournal.date,
            }),
          })
          if (!journalRes.ok) {
            const payload = await journalRes.json().catch(() => null) as { error?: string } | null
            accountingPostError = payload?.error || `Accounting journal failed (HTTP ${journalRes.status})`
          }
        } catch {
          accountingPostError = 'Could not reach the accounting posting service'
        }
        if (accountingPostError) {
          store.addAuditLog('pos_accounting_post_failed', order.ref, accountingPostError)
        }
        const bankLabel = resolvedBankId
          ? (store.bankAccounts.find(b => b.id === resolvedBankId)?.name || resolvedBankId)
          : undefined
        const payLabel = isPosBankPayment(payment) ? 'BANK' : payment.toUpperCase()
        const creditLabel = customerCreditAmount > 0 && tenderTotal > 0 ? ` + ${store.fmtKes(customerCreditAmount)} client credit` : ''
        if (accountingPostError) {
          store.showToast(
            `${order.ref} sale recorded, but accounting needs attention: ${accountingPostError}`,
            'error',
          )
        } else {
          store.showToast(
            `${order.ref} · ${store.fmtKes(order.total)} via ${tenderTotal > 0 ? payLabel : 'CLIENT CREDIT'}`
              + (tenderTotal > 0 && bankLabel ? ` (${bankLabel})` : '')
              + creditLabel
              + (paymentReference ? ` · ${paymentReference}` : ''),
          )
        }
        return order
      },

    checkDiscountApproval: (discountPercent) => {
        const roles = APPROVAL_RULES.discount({ discountPercent })
        return { requiresApproval: roles.length > 0, roles }
      },

    requestApproval: (type, details) => {
        const user = store.currentUser()
        if (!user) return null
        const request = createApprovalRequest(
          type,
          details.documentType ?? 'sales_order',
          details.documentId ?? details.referenceId ?? '',
          details.documentRef ?? details.referenceRef ?? 'Approval',
          user.id,
          user.name,
          { reason: details.reason ?? `${type} approval requested`, ...details },
          store.users.map(u => ({ id: u.id, name: u.name, role: u.role }))
        )
        
        store.setApprovalRequests(prev => [...prev, request])
        store.notifyUsers({
          recipients: approvalRecipientIds(request, store.users),
          type: 'system',
          title: `Approval needed: ${type.replace(/_/g, ' ')}`,
          body: String(request.details?.reason ?? `${type} approval requested`),
          module: request.documentType === 'purchase_order' ? 'purchase' : 'sales',
          path: approvalDocumentPath(request),
          icon: '⚠️',
          entityKey: `approval:${request.id}`,
          excludeUserId: user.id,
        })
        store.addAuditLog('approval_request', request.ref, `${type} approval by ${user.name}`)
        store.showToast('Approval request created', 'info')
        
        return request
      },

    checkCreditLimit: (customerId, orderTotal) => {
        const customer = store.companies.find(c => c.id === customerId)
        if (!customer) return { ok: true }
        const availableCredits = customerCreditBalance(store.customerCreditsRef.current, customerId)
  
        const outstanding = store.invoices
          .filter(inv => inv.partnerId === customerId && isOpenInvoice(inv))
          .reduce((sum, inv) => sum + invoiceResidual(inv), 0)
        const netOutstanding = Math.max(0, outstanding - availableCredits)
  
        const creditUsed = netOutstanding + orderTotal
        const creditAvailable = customer.creditLimit - netOutstanding
  
        if (creditUsed > customer.creditLimit) {
          return { ok: false, message: `Credit limit exceeded. Limit: ${store.fmtKes(customer.creditLimit)}, Used: ${store.fmtKes(netOutstanding)}, Available: ${store.fmtKes(creditAvailable)}`, requiresApproval: true }
        }
        return { ok: true, creditAvailable }
      },

    getCustomerCreditStatus: (customerId, newOrderTotal = 0, opts) => {
        const contact = store.contacts.find(c => c.id === customerId)
        const today = now()
  
        const unpaidInvoices = store.invoices.filter(inv =>
          inv.partnerId === customerId &&
          inv.type === 'customer_invoice' &&
          isOpenInvoice(inv)
        )
  
        const grossOutstandingBalance = unpaidInvoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.amountPaid), 0)
        const availableCredits = customerCreditBalance(store.customerCreditsRef.current, customerId)
        const outstandingBalance = Math.max(0, grossOutstandingBalance - availableCredits)
  
        const overdueInvoices = unpaidInvoices.filter(inv => inv.dueDate < today)
        const overdueBalance = Math.max(0, overdueInvoices.reduce((s, inv) => s + Math.max(0, inv.total - inv.amountPaid), 0) - availableCredits)
        const overdueCount = overdueInvoices.length
        const creditLimit = contact?.creditLimit ?? 0
        const gate = evaluateCustomerCreditGate({
          overdueBalance,
          overdueCount,
          creditLimit,
          outstandingBalance,
          newOrderTotal,
          document: opts?.document ?? 'order',
          formatMoney: store.fmtKes,
          payOnReceipt: Boolean(store.systemSettings.accCreditPayOnReceiptEnforced) && isPayOnReceipt(contact),
        })
  
        return {
          ok: gate.ok,
          isLocked: gate.isLocked,
          creditLimitExceeded: gate.creditLimitExceeded,
          outstandingBalance,
          overdueBalance,
          overdueCount,
          creditLimit,
          creditAvailable: gate.creditAvailable,
          message: gate.message,
        }
      },

    issueCreditNoteFromSaleOrder: async (saleOrderId, amount, reason) => {
        const actor = store.currentUser()
        if (!canManageFullFinanceAction(actor)) {
          store.showToast('Only Finance or Director can issue credit notes', 'error')
          return null
        }
        if (!store.systemSettings.accCreditNotes) {
          store.showToast('Credit notes are disabled in Settings', 'error')
          return null
        }
        const so = store.soRef.current.find(s => s.id === saleOrderId)
        if (!so) return null
        const creditAmount = Math.max(0, Number(amount) || 0)
        if (creditAmount <= 0) {
          store.showToast('Enter a credit amount greater than zero', 'error')
          return null
        }
        const candidateInvoices = store.invRef.current.filter(i =>
          i.saleOrderId === saleOrderId && i.type === 'customer_invoice' && invoiceDocState(i.status) === 'posted',
        )
        if (candidateInvoices.length === 0) {
          store.showToast(`No posted invoice for ${so.ref} — cannot issue a credit note`, 'error')
          return null
        }
        if (candidateInvoices.length > 1) {
          store.showToast(`${so.ref} has multiple posted invoices — issue the credit note from Finance`, 'error')
          return null
        }
        const sourceInvoice = candidateInvoices[0]
        const maxCredit = Math.max(0, Number(sourceInvoice.amountPaid) || Number(sourceInvoice.total) || 0)
        if (creditAmount > maxCredit) {
          store.showToast(`Credit cannot exceed ${store.fmtKes(maxCredit)} for ${sourceInvoice.ref}`, 'error')
          return null
        }
        const ref = await store.storeCtxRef.current!.allocateDocRef('CN')
        const credit: CustomerCredit = {
          id: uid(),
          ref,
          customerId: so.customerId,
          customerName: so.customerName,
          sourceInvoiceId: sourceInvoice.id,
          sourceInvoiceRef: sourceInvoice.ref,
          amount: creditAmount,
          balance: creditAmount,
          status: 'available',
          createdAt: now(),
          createdBy: actor?.name ?? 'Finance',
          notes: reason?.trim() || `Credit note from sales order ${so.ref}`,
          applications: [],
        }
        store.setCustomerCredits(prev => [credit, ...prev])
        // No endpoint backs this flow, so the blob mirror was the only thing
        // putting the credit note in the ledger.
        const creditJournal = buildCustomerCreditJournal(sourceInvoice, ref, creditAmount)
        store.setJournalEntries(prev => [creditJournal, ...prev])
        store.postSystemJournal('sale_order_credit_note', creditJournal, message => store.showToast(message, 'error'))
        store.addAuditLog('sales_credit_note', so.ref, `Credit note ${ref} issued for ${store.fmtKes(creditAmount)}`)
        store.showToast(`Credit note ${ref} issued for ${store.fmtKes(creditAmount)}`, 'success')
        return ref
      },

    approveRequest: (requestId, decision, comments) => {
        const user = store.currentUser()
        if (!user) return
        const request = store.approvalRequests.find(r => r.id === requestId)
        if (!request) return
        let updatedRequest: ApprovalRequest
        try {
          updatedRequest = processApproval(request, user.id, user.name, decision, comments, user.role)
        } catch (err) {
          store.showToast(err instanceof Error ? err.message : 'Unable to process approval', 'error')
          return
        }
        const nextRequests = store.approvalRequests.map(r => r.id === requestId ? updatedRequest : r)
        store.setApprovalRequests(nextRequests)
        if (request) {
          const docRequests = nextRequests.filter(r => r.documentId === request.documentId)
          const docStatus = docRequests.some(r => r.status === 'rejected') ? 'rejected'
            : docRequests.some(r => r.status === 'pending') ? 'pending'
            : 'approved'
          if (request.documentType === 'sales_order') {
            store.setSaleOrders(prev => prev.map(so => {
              if (so.id !== request.documentId) return so
              // The approval gate never changes the Odoo stage — the record
              // stays a Quotation until someone clicks Confirm.
              const updated = { ...so, approvalStatus: docStatus }
              sync(`/api/sale-orders/${so.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
              return updated
            }))
          }
          if (request.documentType === 'quote') {
            store.setQuotes(prev => prev.map(q => {
              if (q.id !== request.documentId) return q
              const updated = { ...q, approvalStatus: docStatus }
              sync(`/api/quotes/${q.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
              return updated
            }))
          }
          if (request.documentType === 'purchase_order') {
            store.setPurchaseOrders(prev => prev.map(po => {
              if (po.id !== request.documentId) return po
              const updated = { ...po, approvalStatus: docStatus }
              sync(`/api/purchase-orders/${po.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
              return updated
            }))
          }
          if (request.requestedBy && request.requestedBy !== user.id) {
            store.notifyUsers({
              recipients: [request.requestedBy],
              type: 'system',
              title: `Approval ${decision}: ${request.documentRef}`,
              body: `${request.type.replace(/_/g, ' ')} ${decision} by ${user.name}${comments ? ` — ${comments}` : ''}`,
              module: request.documentType === 'purchase_order' ? 'purchase' : 'sales',
              path: approvalDocumentPath(request),
              icon: decision === 'approved' ? '✅' : '❌',
              entityKey: `approval:${request.id}:decision`,
              excludeUserId: user.id,
            })
          }
          // If multi-level and still pending, notify the next level.
          if (updatedRequest.status === 'pending' && updatedRequest.currentLevel !== request.currentLevel) {
            store.notifyUsers({
              recipients: approvalRecipientIds(updatedRequest, store.users),
              type: 'system',
              title: `Approval needed: ${updatedRequest.type.replace(/_/g, ' ')}`,
              body: `${updatedRequest.documentRef} — next level after ${user.name}`,
              module: updatedRequest.documentType === 'purchase_order' ? 'purchase' : 'sales',
              path: approvalDocumentPath(updatedRequest),
              icon: '⚠️',
              entityKey: `approval:${updatedRequest.id}:level:${updatedRequest.currentLevel}`,
              excludeUserId: user.id,
            })
          }
          store.addAuditLog(`approval_${decision}`, request.ref, `${decision} by ${user.name}`)
          store.showToast(`Request ${decision}`, decision === 'approved' ? 'success' : 'error')
        }
      },

    getPendingApprovalsForUser: () => {
        const user = store.currentUser()
        if (!user) return []
        return getPendingApprovals(store.approvalRequests, user.id, user.role)
      },
  }
}
