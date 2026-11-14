import type { ReturnOrder, BuyBackLine, BuyBack, Donation, ExchangeLine, ClientExchange } from '../after-sales'
import { uid, now } from '../ids'
import { allocateDocNumberSync } from '@/lib/doc-numbers'
import { invoiceDocState } from '@/lib/odoo-sales-flow'
import { liveQtyInvoicedBySoLine, allocateSalesReturn } from '@/lib/sales/return-allocation'
import { pickPostedInvoiceForReturn, stampDeliveryReturnQtys, findReleasedOrcsForReturn, resolveReturnCreditAmount } from '@/lib/sales/return-orchestration'
import type { DeliveryLine } from '../delivery'
import type { LocationId } from '../core'
import { sync } from '../sync'
import type { OrcLogEntry, SerialNumber } from '../inventory'
import type { Invoice, CustomerCredit, JournalEntry, RefundPayment, InvoiceLine } from '../finance'
import { bankAccountIdForMethod, bankAccountLabel, accountLine } from '../journals'
import { userCan } from '@/lib/auth/can'
import { canPayBuyBackCash, buildBuyBackPayoutBillLines, canCreditBuyBack, buyBackStoreCreditAmount, buildBuyBackStoreCreditJournalLines, BUYBACK_STORE_CREDIT_METHOD, resolveBuyBackProduct } from '@/lib/buyback-credit'
import { canManageFinance } from '../permissions'
import { awaitingIdentification } from '@/lib/refurbishment/unidentified'
import { EXCHANGE_RETURN_LOCATION } from '@/lib/aftersales/exchange-stock'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** after-sales actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createAfterSalesActions(store: StoreDeps): Pick<AppState, 'createReturnOrder' | 'approveReturn' | 'receiveReturn' | 'processReturn' | 'cancelWarranty' | 'rejectReturn' | 'registerCustomerReturnSerial' | 'createBuyBack' | 'approveBuyBack' | 'payBuyBack' | 'creditBuyBack' | 'stockBuyBack' | 'deleteBuyBack' | 'createDonation' | 'confirmDonation' | 'deleteDonation' | 'createExchange' | 'approveExchange' | 'completeExchange' | 'cancelExchange'> {
  return {
    createReturnOrder: (saleOrderId, saleOrderRef, customerId, customerName, reason, lines) => {
        for (const line of lines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid return product') }
          if (line.qty <= 0) { store.showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid return quantity') }
          if (product.requiresSerial && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} returned serial number(s) for ${product.name}`, 'error')
            throw new Error('Missing return serials')
          }
        }
        const order: ReturnOrder = {
          id: uid(), ref: allocateDocNumberSync('RMA'),
          saleOrderId, saleOrderRef, customerId, customerName,
          status: 'requested', requestDate: now(), reason,
          lines: lines.map(l => ({ ...l, id: uid() })),
        }
        store.setReturnOrders(p => [order, ...p])
        store.numberReturns([order.id])
        store.showToast(`Return ${order.ref} submitted`)
        return order
      },

    approveReturn: (id) => {
        const user = store.currentUser(); if (!user) return
        store.setReturnOrders(p => p.map(r => r.id === id
          ? { ...r, status: 'approved', approvedByName: user.name, approvedDate: now() }
          : r
        ))
        store.showToast('Return approved — customer may send back the item(s)')
      },

    receiveReturn: async (id) => {
        let ro = store.returnOrders.find(r => r.id === id)
        if (!ro) return
        if (ro.status !== 'approved') { store.showToast('Approve the return before receiving items', 'error'); return }
        for (const line of ro.lines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName}`, 'error'); return }
          if (product.requiresSerial && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} returned serial number(s) for ${line.productName}`, 'error'); return
          }
          for (const sid of line.serialIds) {
            if (!store.serialRef.current.find(s => s.id === sid)) {
              store.showToast(`Serial missing for ${line.productName} — re-select returned serials`, 'error'); return
            }
          }
        }
        // Its stock value posts under its number, and the valuation skips a
        // number + product it has seen: it needs its own server number first.
        const rmaRef = await store.ensureUniqueServerRef('return_order', 'RMA', ro, store.returnOrders, store.applyReturnNumber)
        if (!rmaRef) { store.showToast('Could not get a number for this return from the server — try again', 'error'); return }
        ro = { ...ro, ref: rmaRef }
  
        try {
          const res = await fetch('/api/inventory/apply-customer-return-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              returnRef: ro.ref,
              lines: ro.lines.map(l => ({
                productId: l.productId,
                productName: l.productName,
                qty: l.qty,
                serialIds: l.serialIds,
              })),
            }),
          })
          if (!res.ok) {
            const payload = await res.json().catch(() => null) as { error?: string } | null
            store.showToast(payload?.error || 'Could not apply return stock on server', 'error')
            return
          }
        } catch {
          store.showToast('Could not reach server to apply return stock', 'error')
          return
        }
  
        // Reverse-transfer allocation: wind back SO qtyDelivered (and draft invoice
        // qtys). Posted-invoice qty becomes a credit-note obligation on process.
        const so = store.soRef.current.find(s => s.id === ro.saleOrderId)
        const draftInvoices = store.invRef.current
          .filter(i => i.saleOrderId === ro.saleOrderId && i.type === 'customer_invoice' && invoiceDocState(i.status) === 'draft' && !i.isDownPayment)
          .map(i => ({
            id: i.id,
            lines: (i.lines ?? []).map(l => ({ id: l.id, productId: l.productId, qty: Number(l.qty) || 0 })),
          }))
        // Invoiced means invoiced on an invoice still in force: a cancelled
        // invoice must not turn the return into a credit note obligation.
        const liveInvoiced = so && store.seesCustomerInvoices(store.currentUser())
          ? liveQtyInvoicedBySoLine(ro.saleOrderId, (so.lines ?? []).filter((l: any) => l.lineType !== 'section').map((l: any) => ({ ...l, id: String(l.id) })), store.invRef.current)
          // Roles that are not sent customer invoices keep the stored count.
          : new Map<string, number>()
        const allocation = so
          ? allocateSalesReturn({
              soLines: (so.lines ?? [])
                .filter((l: any) => l.lineType !== 'section')
                .map((l: any) => ({
                  id: String(l.id),
                  productId: String(l.productId ?? ''),
                  productName: l.productName,
                  qty: Number(l.qty) || 0,
                  qtyDelivered: Number(l.qtyDelivered) || 0,
                  qtyInvoiced: liveInvoiced.get(String(l.id)) ?? (Number(l.qtyInvoiced) || 0),
                  unitPrice: Number(l.unitPrice) || 0,
                  taxRate: Number(l.taxRate) || 0,
                })),
              returnLines: ro.lines.map(l => ({
                productId: l.productId,
                productName: l.productName,
                qty: Number(l.qty) || 0,
              })),
              draftInvoices,
            })
          : null
  
        const postedCandidates = store.invRef.current
          .filter(i => i.saleOrderId === ro.saleOrderId && i.type === 'customer_invoice' && !i.isDownPayment && invoiceDocState(i.status) === 'posted')
          .map(i => ({
            id: i.id,
            ref: i.ref,
            lines: (i.lines ?? []).map(l => ({ productId: l.productId, qty: Number(l.qty) || 0 })),
          }))
        const invoicePick = pickPostedInvoiceForReturn({
          invoices: postedCandidates,
          returnLines: ro.lines.map(l => ({ productId: l.productId, qty: Number(l.qty) || 0 })),
          preferredInvoiceId: ro.sourceInvoiceId,
        })
  
        // Stamp DN qtyReturned (historical DN stays done; ORC stays released).
        const dnStamps = stampDeliveryReturnQtys({
          deliveries: store.delRef.current.map(d => ({
            id: d.id,
            saleOrderId: d.saleOrderId,
            status: d.status,
            lines: (d.lines ?? []).map(l => ({
              productId: l.productId,
              productName: l.productName,
              qty: Number(l.qty) || 0,
              qtyDone: Number(l.qtyDone) || 0,
              qtyReturned: Number(l.qtyReturned) || 0,
              serialIds: l.serialIds ?? [],
              sourceLocation: l.sourceLocation,
            })),
          })),
          saleOrderId: ro.saleOrderId,
          returnLines: ro.lines.map(l => ({
            productId: l.productId,
            qty: Number(l.qty) || 0,
            serialIds: l.serialIds,
          })),
        })
        if (dnStamps.length > 0) {
          const stampById = new Map(dnStamps.map(s => [s.deliveryId, s.lines]))
          store.setDeliveries(prev => prev.map(d => {
            const stamped = stampById.get(d.id)
            if (!stamped) return d
            const lines: DeliveryLine[] = stamped.map(l => ({
              productId: l.productId,
              productName: l.productName || d.lines.find(x => x.productId === l.productId)?.productName || '',
              qty: l.qty,
              qtyDone: l.qtyDone,
              qtyReturned: l.qtyReturned,
              serialIds: l.serialIds ?? [],
              sourceLocation: (l.sourceLocation as LocationId | undefined)
                ?? d.lines.find(x => x.productId === l.productId)?.sourceLocation,
            }))
            const updated = { ...d, lines }
            sync(`/api/deliveries/${d.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updated),
            })
            return updated
          }))
        }
  
        const user = store.currentUser()
        const orcTargets = findReleasedOrcsForReturn({
          releases: store.orcRef.current.map(r => ({
            id: r.id,
            ref: r.ref,
            status: r.status,
            invoiceId: r.invoiceId,
            deliveryNoteId: r.deliveryNoteId,
          })),
          deliveryIds: dnStamps.map(s => s.deliveryId),
          invoiceIds: invoicePick.ok ? [invoicePick.invoice.id] : [],
        })
        if (orcTargets.length > 0) {
          const stampedAt = now()
          store.setOutboundReleases(prev => prev.map(r => {
            const hit = orcTargets.find(t => t.releaseId === r.id)
            if (!hit) return r
            const log: OrcLogEntry = {
              id: uid(),
              releaseId: r.id,
              action: 'partial_return',
              fromStatus: r.status,
              toStatus: r.status,
              performedById: user?.id ?? '',
              performedByName: user?.name ?? '',
              performedAt: stampedAt,
              notes: `Customer return ${ro.ref} received — certificate remains released`,
              metadata: {
                returnRef: ro.ref,
                returnId: ro.id,
                deliveryIds: dnStamps.map(s => s.deliveryId),
              },
            }
            sync(`/api/outbound-releases/${r.id}/audit-log`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                logId: log.id,
                action: log.action,
                fromStatus: log.fromStatus,
                toStatus: log.toStatus,
                performedById: log.performedById,
                performedByName: log.performedByName,
                performedAt: log.performedAt,
                notes: log.notes,
                metadata: log.metadata,
              }),
            })
            return { ...r, auditLog: [...(r.auditLog ?? []), log], updatedAt: stampedAt }
          }))
        }
  
        store.setReturnOrders(p => p.map(r => r.id === id ? {
          ...r,
          status: 'received',
          receivedDate: now(),
          creditTotalHint: allocation?.requiresCreditNote ? allocation.creditTotal : 0,
          requiresCreditNote: Boolean(allocation?.requiresCreditNote),
          sourceInvoiceId: invoicePick.ok ? invoicePick.invoice.id : r.sourceInvoiceId,
          sourceInvoiceRef: invoicePick.ok ? invoicePick.invoice.ref : r.sourceInvoiceRef,
          notes: allocation?.requiresCreditNote
            ? `${r.notes || ''}\n[Return after invoice — credit note required: KES ${allocation.creditTotal}${invoicePick.ok ? ` · ${invoicePick.invoice.ref}` : ''}]`.trim()
            : r.notes,
        } : r))
        // Serial status UI only — qty already written by server.
        ro.lines.forEach(line => {
          line.serialIds.forEach(sid => {
            store.setSerials(p => p.map(s => s.id === sid
              ? { ...s, status: 'returned', location: 'warehouse' as LocationId }
              : s
            ))
          })
        })
  
        if (so && allocation && allocation.soLineAdjustments.length > 0) {
          const adjById = new Map(allocation.soLineAdjustments.map(a => [a.soLineId, a]))
          const lines = so.lines.map((l: any) => {
            const adj = adjById.get(String(l.id))
            if (!adj) return l
            // On receive: reverse delivered qty. qtyInvoiced for posted goods is
            // reduced when the credit note is processed.
            return { ...l, qtyDelivered: adj.qtyDelivered }
          })
          store.setSaleOrders(prev => prev.map(s => s.id !== so.id ? s : { ...s, lines }))
          sync(`/api/sale-orders/${so.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines }),
          })
        }
        if (allocation && allocation.draftInvoiceDeductions.length > 0) {
          const reduceDraft = (inv: Invoice): Invoice => {
            const deductions = allocation.draftInvoiceDeductions.filter(d => d.invoiceId === inv.id)
            if (deductions.length === 0) return inv
            const deductByLine = new Map(deductions.map(d => [d.lineId, d.deductQty]))
            const lines = (inv.lines ?? []).map(l => {
              const deduct = deductByLine.get(l.id) || 0
              if (deduct <= 0) return l
              const qty = Math.max(0, (Number(l.qty) || 0) - deduct)
              const unit = Number(l.unitPrice) || 0
              return { ...l, qty, subtotal: Math.round(unit * qty) }
            }).filter(l => (Number(l.qty) || 0) > 0)
            const subtotal = lines.reduce((s, l) => s + (Number(l.subtotal) || 0), 0)
            const taxTotal = lines.reduce((s, l) => s + Math.round((Number(l.subtotal) || 0) * (Number(l.taxRate) || 0) / 100), 0)
            return { ...inv, lines, subtotal, taxTotal, total: subtotal + taxTotal }
          }
          // Saved to the invoices table — the screen copy is no longer written.
          for (const inv of store.invRef.current) {
            if (!allocation.draftInvoiceDeductions.some(d => d.invoiceId === inv.id)) continue
            const next = reduceDraft(inv)
            store.syncOrWarn(`/api/invoices/${inv.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lines: next.lines }),
            }, message => store.showToast(message, 'error'), `Draft invoice ${inv.ref} could not be reduced for the return — adjust it by hand`)
          }
          store.setInvoices(prev => prev.map(reduceDraft))
        }
  
        store.addAuditLog('rma_receive', ro.ref, `Received return ${ro.ref} for ${ro.customerName}${allocation?.requiresCreditNote ? ' · credit note required' : ' · reverse transfer only'}${orcTargets.length ? ` · ORC stamped (${orcTargets.length})` : ''}`)
        store.showToast(
          allocation?.requiresCreditNote
            ? `Return received — reverse transfer done; issue credit note for KES ${store.fmtKes(allocation.creditTotal)}`
            : 'Return received — reverse transfer done (not yet invoiced)',
        )
      },

    processReturn: async (id, resolution, refundAmount, processNotes, refundPaymentMethod) => {
        const user = store.currentUser(); if (!user) return
        const rma = store.returnOrders.find(r => r.id === id); if (!rma) return
  
        // Resolution 'credit_note' previously showed a "Credit note issued" toast without
        // creating anything — no CustomerCredit, journal or audit entry. Wire it up using
        // the same mechanism cancelInvoice() uses for a cancelled paid invoice.
        let creditNoteRef: string | null = null
        if (resolution === 'credit_note') {
          const so = store.soRef.current.find(s => s.id === rma.saleOrderId)
          const liveInvoiced = so && store.seesCustomerInvoices(user)
            ? liveQtyInvoicedBySoLine(rma.saleOrderId, (so.lines ?? []).filter((l: any) => l.lineType !== 'section').map((l: any) => ({ ...l, id: String(l.id) })), store.invRef.current)
            : new Map<string, number>()
          const allocation = so
            ? allocateSalesReturn({
                soLines: (so.lines ?? [])
                  .filter((l: any) => l.lineType !== 'section')
                  .map((l: any) => ({
                    id: String(l.id),
                    productId: String(l.productId ?? ''),
                    productName: l.productName,
                    qty: Number(l.qty) || 0,
                    // Delivered already reversed on receive — reconstruct
                    // pre-receive delivered as current + return qty for credit calc.
                    qtyDelivered: (Number(l.qtyDelivered) || 0) + (rma.lines
                      .filter(rl => rl.productId === l.productId)
                      .reduce((s, rl) => s + (Number(rl.qty) || 0), 0)),
                    qtyInvoiced: liveInvoiced.get(String(l.id)) ?? (Number(l.qtyInvoiced) || 0),
                    unitPrice: Number(l.unitPrice) || 0,
                    taxRate: Number(l.taxRate) || 0,
                  })),
                returnLines: rma.lines.map(l => ({
                  productId: l.productId,
                  productName: l.productName,
                  qty: Number(l.qty) || 0,
                })),
              })
            : null
          const amount = resolveReturnCreditAmount({
            explicitAmount: refundAmount,
            creditTotalHint: rma.creditTotalHint,
            allocationCreditTotal: allocation?.creditTotal,
          })
          if (amount <= 0) {
            store.showToast('No posted invoice quantity to credit for this return', 'error')
            return
          }
          // Prefer RMA source invoice (stamped on receive) or uniquely covering invoice.
          const candidateInvoices = store.invRef.current.filter(i =>
            i.saleOrderId === rma.saleOrderId && i.type === 'customer_invoice' && !i.isDownPayment && invoiceDocState(i.status) === 'posted',
          )
          const invoicePick = pickPostedInvoiceForReturn({
            invoices: candidateInvoices.map(i => ({
              id: i.id,
              ref: i.ref,
              lines: (i.lines ?? []).map(l => ({ productId: l.productId, qty: Number(l.qty) || 0 })),
            })),
            returnLines: rma.lines.map(l => ({ productId: l.productId, qty: Number(l.qty) || 0 })),
            preferredInvoiceId: rma.sourceInvoiceId,
          })
          if (!invoicePick.ok && invoicePick.reason === 'none') {
            store.showToast(`No posted invoice found for sale order ${rma.saleOrderRef} — cannot issue a credit note`, 'error')
            return
          }
          if (!invoicePick.ok) {
            store.showToast(`${rma.saleOrderRef} has ${invoicePick.count} posted invoices that both cover this return — issue the credit note manually from Finance so the right one is credited`, 'error')
            return
          }
          const sourceInvoice = candidateInvoices.find(i => i.id === invoicePick.invoice.id) ?? candidateInvoices[0]
          const ref = await store.storeCtxRef.current!.allocateDocRef('CN')
          const credit: CustomerCredit = {
            id: uid(), ref,
            customerId: rma.customerId, customerName: rma.customerName,
            sourceInvoiceId: sourceInvoice.id, sourceInvoiceRef: sourceInvoice.ref,
            amount, balance: amount, status: 'available',
            createdAt: now(), createdBy: user.name,
            notes: `Credit note issued from return ${rma.ref}`,
            applications: [],
          }
          store.setCustomerCredits(prev => [credit, ...prev])
          // No journal is built here. createCustomerCreditNote posts this credit
          // note as JRN/CN/<ref> while the local copy used JRN/<ref> — different
          // refs, so the mirror could not dedupe them and the revenue reversal
          // and customer credit were both booked twice.
          //
          // The call used to be wrapped in try/catch with no res.ok check, so a
          // refusal was invisible; this route is director/finance only, and an
          // admin officer processing a return got a silent 403. Now the failure
          // is shown instead of leaving a credit with no entry behind it.
          store.syncOrWarn(`/api/sale-orders/${rma.saleOrderId}/credit-note`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invoiceId: sourceInvoice.id,
              amount,
              reason: `Return ${rma.ref}`,
              creditNoteNumber: ref,
              lines: allocation?.creditLines ?? [],
            }),
          }, message => store.showToast(message, 'error'), `Credit note ${ref} was not posted — please retry from Finance`)
          if (so && allocation) {
            const adjById = new Map(allocation.soLineAdjustments.map(a => [a.soLineId, a]))
            const lines = so.lines.map((l: any) => {
              const adj = adjById.get(String(l.id))
              if (!adj) return l
              return { ...l, qtyInvoiced: adj.qtyInvoiced }
            })
            store.setSaleOrders(prev => prev.map(s => s.id !== so.id ? s : { ...s, lines }))
            sync(`/api/sale-orders/${so.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lines }),
            })
          }
          store.addAuditLog('rma_credit_note', rma.ref, `Credit note ${ref} issued for ${store.fmtKes(amount)} against return ${rma.ref} · ${sourceInvoice.ref}`)
          creditNoteRef = ref
          refundAmount = amount
        }
  
        // Only reached once any credit note (if requested) actually succeeded —
        // a return must never show as "processed" while its resolution failed.
        store.setReturnOrders(p => p.map(r => r.id === id
          ? { ...r, status: 'processed', resolution, refundAmount, notes: processNotes, processedDate: now(), processedByName: user.name }
          : r
        ))
  
        if (resolution === 'refund' && refundAmount && refundAmount > 0) {
          const method = refundPaymentMethod ?? 'cash'
          const refundBankAccountId = bankAccountIdForMethod(method)
          const creditAccount = bankAccountLabel(refundBankAccountId, method)
          // The ledger keeps one journal per number and skips a repeat, so the
          // refund journal's number is tied to this payment (it was a per-browser
          // count, and a repeated one dropped the refund from the books).
          const refundPaymentId = uid()
          const journal: JournalEntry = {
            id: uid(),
            ref: `JRN/RFD/${refundPaymentId}`,
            date: now(),
            source: 'refund',
            description: `Customer refund — ${rma.ref} (${rma.customerName})`,
            status: 'posted',
            rmaId: id,
            bankAccountId: refundBankAccountId,
            lines: [
              { id: uid(), account: '5099 — Sales Returns & Refunds', description: `Refund for ${rma.ref}`, debit: refundAmount, credit: 0 },
              { id: uid(), account: creditAccount, description: `Refund paid via ${method}`, debit: 0, credit: refundAmount },
            ],
            totalDebit: refundAmount,
            totalCredit: refundAmount,
          }
          store.setJournalEntries(p => [journal, ...p])
          // The refund payout had no endpoint — ledger entry came from the
          // blob mirror alone.
          store.postSystemJournal('rma_refund', journal, message => store.showToast(message, 'error'))
  
          const payment: RefundPayment = {
            id: refundPaymentId,
            ref: allocateDocNumberSync('RFD'),
            rmaId: id,
            rmaRef: rma.ref,
            customerName: rma.customerName,
            amount: refundAmount,
            paymentMethod: method,
            bankAccountId: refundBankAccountId,
            paymentDate: now(),
            notes: processNotes,
            journalEntryId: journal.id,
            createdBy: user.id,
            createdDate: now(),
          }
          store.setRefundPayments(p => [payment, ...p])
          store.numberRefundPayments([payment.id])
        }
  
        const label = resolution === 'refund' ? 'Refund recorded'
          : resolution === 'replacement' ? 'Replacement issued'
          : resolution === 'credit_note' ? `Credit note ${creditNoteRef} issued` : 'Repair initiated'
        store.showToast(`Return processed — ${label}`)
      },

    cancelWarranty: (id, reason) => {
        const user = store.currentUser(); if (!user) return
        if (!userCan(user, 'repair.warranty.cancel')) {
          store.showToast('Only a manager or Finance can cancel a warranty', 'error'); return
        }
        const why = reason.trim()
        if (!why) { store.showToast('Give a reason for cancelling the warranty', 'error'); return }
        const w = store.warranties.find(x => x.id === id)
        if (!w) return
        if (w.status === 'cancelled') { store.showToast(`${w.ref} is already cancelled`, 'info'); return }
        store.setWarranties(p => p.map(x => x.id === id
          ? { ...x, status: 'cancelled' as const, cancelledAt: now(), cancelledReason: `${why} (by ${user.name})` }
          : x))
        store.addAuditLog('warranty_cancel', w.ref, `Cancelled ${w.ref} for ${w.customerName} (${w.serialNumber}) — ${why}`)
        store.showToast(`${w.ref} cancelled`)
      },

    rejectReturn: (id, reason) => {
        store.setReturnOrders(p => p.map(r => r.id === id ? { ...r, status: 'rejected', notes: reason } : r))
        store.showToast('Return rejected')
      },

    registerCustomerReturnSerial: (productId, serialText, opts) => {
        const product = store.prodRef.current.find(p => p.id === productId)
        if (!product) { store.showToast('Product not found', 'error'); return null }
        const serial = String(serialText ?? '').trim()
        if (!serial) { store.showToast('Enter a serial number', 'error'); return null }
        const key = serial.toLowerCase()
        const existing = store.serialRef.current.find(s => s.productId === productId && s.serial.toLowerCase() === key)
        if (existing) {
          if (existing.status === 'sold' || existing.location === 'customer') {
            store.showToast(`Serial ${existing.serial} is already on file — select it from sold stock`, 'info')
            return existing
          }
          store.showToast(`Serial ${existing.serial} already exists (${existing.status})`, 'error')
          return null
        }
        const newSerial: SerialNumber = {
          id: uid(),
          serial,
          productId,
          productName: product.name,
          sku: product.sku,
          location: 'customer',
          status: 'sold',
          saleOrderId: opts?.saleOrderId,
          receivedDate: now(),
          soldDate: now(),
          barcode: store.buildInventoryBarcodeForProduct(productId, serial),
          // Which screen registered it and who: a trade-in left unsaved is
          // then found (My work → trade-in machines with no trade-in).
          intakeSource: opts?.source ?? 'trade-in',
          intakeByName: store.currentUser()?.name,
          // Serial unknown: the text is an intake tag until the bench finds it.
          ...(opts?.identityPending ? { identityPending: true, intakeTag: serial, barcode: serial } : {}),
        }
        store.setSerials(p => [...p, newSerial])
        sync('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
        store.addAuditLog(
          'serial_return_intake',
          newSerial.serial,
          `Registered return serial for ${product.name} via ${opts?.source ?? 'trade-in'}`,
        )
        store.showToast(`Serial ${serial} registered for return`, 'success')
        return newSerial
      },

    createBuyBack: (customerId, customerName, lines, destination, notes, originalSOId, originalSORef) => {
        for (const line of lines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid buy-back product') }
          if (line.qty <= 0) { store.showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid buy-back quantity') }
          if (product.requiresSerial && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} serial number(s) for ${product.name}`, 'error')
            throw new Error('Missing buy-back serials')
          }
        }
        const bbLines: BuyBackLine[] = lines.map(l => ({ ...l, id: uid() }))
        const total = bbLines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
        const bb: BuyBack = {
          id: uid(), ref: store.tradeInRef('BBK'),
          customerId, customerName, originalSOId, originalSORef,
          status: 'draft', date: now(),
          lines: bbLines, total, destinationLocation: destination, notes,
        }
        store.setBuyBacks(p => [bb, ...p])
        store.showToast(`Buy-back created for ${customerName}`)
        return bb
      },

    approveBuyBack: (id) => {
        const user = store.currentUser(); if (!user) return
        if (!userCan(user, 'sales.buyback.approve')) { store.showToast('Only Director or Finance can approve buy-backs', 'error'); return }
        const bb = store.buyBacks.find(b => b.id === id)
        if (!bb || bb.status !== 'draft') { store.showToast('Only draft buy-backs can be approved', 'error'); return }
        store.setBuyBacks(p => p.map(b => b.id === id
          ? { ...b, status: 'approved', approvedByName: user.name, approvedDate: now() }
          : b
        ))
        store.showToast('Buy-back approved')
      },

    // Pay path: a vendor bill to the customer (Trade-in Purchases 6114),
    // posted and paid from the till / M-Pesa / bank. It used to record only a
    // refund-list row, so the payout never reached the books. A second click
    // (e.g. by another Finance user, when separation of duties stops the
    // poster paying) reuses the same bill.
    payBuyBack: async (id, paymentMethod) => {
        const user = store.currentUser(); if (!user) return
        const bb = store.buyBacks.find(b => b.id === id)
        const allowed = canPayBuyBackCash(bb, paymentMethod)
        if (!allowed.ok || !bb) { store.showToast(allowed.error || 'Cannot record buy-back payment', 'error'); return }
        if (!canManageFinance(user)) {
          store.showToast('Paying out a buy-back posts and pays a bill — ask Finance, an Admin Officer or the Director', 'error'); return
        }
        const method = paymentMethod ?? 'cash'
        let bill = bb.billId ? store.invRef.current.find(i => i.id === bb.billId && i.status !== 'cancelled') : undefined
        if (!bill) {
          const lines: InvoiceLine[] = buildBuyBackPayoutBillLines(bb, sid => store.serialRef.current.find(x => x.id === sid)?.serial ?? sid)
            .map(l => ({ id: uid(), ...l }))
          const total = lines.reduce((sum, l) => sum + l.subtotal, 0)
          const draft: Invoice = {
            id: uid(),
            ref: store.draftInvoiceRef('vendor_bill'),
            type: 'vendor_bill',
            status: 'draft',
            partnerId: bb.customerId,
            partnerName: bb.customerName,
            date: now(),
            dueDate: now(),
            lines,
            subtotal: total,
            taxTotal: 0,
            total,
            amountPaid: 0,
            notes: `Buy-back ${bb.ref} — payout to ${bb.customerName}`,
          }
          store.invRef.current = [draft, ...store.invRef.current]
          store.setInvoices(prev => [draft, ...prev])
          if (!(await store.saveInvoiceToServer(draft, msg => store.showToast(msg, 'error')))) return
          bill = draft
          store.setBuyBacks(p => p.map(b => b.id === id ? { ...b, billId: draft.id } : b))
        }
        if (invoiceDocState(bill.status) !== 'posted') {
          await store.storeCtxRef.current!.postInvoice(bill.id)
          bill = store.invRef.current.find(i => i.id === bill!.id)
          if (!bill || invoiceDocState(bill.status) !== 'posted') {
            store.showToast(`The payout bill for ${bb.ref} was saved but not posted — post it in Purchases › Bills, then press Pay again`, 'error'); return
          }
        }
        const posted = bill
        store.setBuyBacks(p => p.map(b => b.id === id ? { ...b, billId: posted.id, billRef: posted.ref } : b))
        const balance = posted.total - posted.amountPaid
        if (balance > 0) {
          const paid = await store.storeCtxRef.current!.registerPayment(posted.id, balance, method, bankAccountIdForMethod(method), bb.ref, now())
          if (!paid) {
            store.showToast(`${posted.ref} is posted but not paid yet. Pay it here again (another Finance user, if asked) or in Purchases › Bills`, 'error'); return
          }
        }
        store.setBuyBacks(p => p.map(b => b.id === id ? { ...b, status: 'paid', paymentMethod, paidDate: now(), billId: posted.id, billRef: posted.ref } : b))
        store.addAuditLog('buyback_payout', bb.ref, `Paid out via bill ${posted.ref} (${method}) — ${bb.customerName}`)
        store.showToast(`Payment recorded — bill ${posted.ref} posted and paid`)
      },

    // Credit path: same KES onto 3102. No RefundPayment, no petty cash. Status stays `paid` so Add to stock still works.
    creditBuyBack: async (id) => {
        const user = store.currentUser(); if (!user) return
        const bb = store.buyBacks.find(b => b.id === id)
        const allowed = canCreditBuyBack(bb)
        if (!allowed.ok || !bb) { store.showToast(allowed.error || 'Cannot add buy-back as credit', 'error'); return }
        const amount = buyBackStoreCreditAmount(bb)
        const at = now()
        let creditRef: string
        try {
          creditRef = await store.storeCtxRef.current!.allocateDocRef('CN')
        } catch {
          creditRef = allocateDocNumberSync('CN')
        }
        const credit: CustomerCredit = {
          id: uid(),
          ref: creditRef,
          customerId: bb.customerId,
          customerName: bb.customerName,
          sourceType: 'buyback',
          sourceBuyBackId: bb.id,
          sourceBuyBackRef: bb.ref,
          amount,
          balance: amount,
          status: 'available',
          createdAt: at,
          createdBy: user.name,
          notes: `Store credit from buy-back ${bb.ref}`,
          applications: [],
        }
        const journalLines = buildBuyBackStoreCreditJournalLines({
          buyBackRef: bb.ref,
          creditRef,
          customerName: bb.customerName,
          amount,
        }).map(line => accountLine(line.account, line.description, line.debit, line.credit))
        const debit = journalLines.reduce((s, l) => s + l.debit, 0)
        const creditTotal = journalLines.reduce((s, l) => s + l.credit, 0)
        const journal: JournalEntry = {
          id: uid(),
          ref: `JRN/${creditRef}`,
          date: at,
          source: 'manual',
          description: `Buy-back ${bb.ref} settled as store credit ${creditRef}`,
          status: 'posted',
          lines: journalLines,
          totalDebit: debit,
          totalCredit: creditTotal,
        }
        store.setCustomerCredits(prev => [credit, ...prev])
        store.setJournalEntries(prev => [journal, ...prev])
        // Buy-back settlement writes blob state only, so this journal reached
        // the ledger solely through the mirror.
        store.postSystemJournal('buyback_credit', journal, message => store.showToast(message, 'error'))
        store.setBuyBacks(p => p.map(b => b.id === id
          ? { ...b, status: 'paid', paymentMethod: BUYBACK_STORE_CREDIT_METHOD, paidDate: at, creditId: credit.id, creditRef }
          : b))
        store.addAuditLog('buyback_credit', bb.ref, `Store credit ${creditRef} for ${store.fmtKes(amount)} — ${bb.customerName}`)
        store.showToast(`${bb.ref} added as store credit ${creditRef} (${store.fmtKes(amount)})`)
      },

    stockBuyBack: (id) => {
        const user = store.currentUser(); if (!user) return
        const bb = store.buyBacks.find(b => b.id === id)
        if (!bb) return
        if (bb.status !== 'paid') { store.showToast('Settle the buy-back (pay or add as credit) before stocking items', 'error'); return }
        // A line whose product id is gone (never saved to the products table, or
        // merged away) is relinked to the one active product of that name.
        const lines = bb.lines.map(line => {
          const product = resolveBuyBackProduct(line, store.prodRef.current)
          return product && product.id !== line.productId ? { ...line, productId: product.id, productName: product.name } : line
        })
        for (const line of lines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) {
            store.showToast(`"${line.productName}" is not in Inventory (it may not have saved, or was merged or deleted). Create or find it in Inventory › Products, then try again.`, 'error'); return
          }
          if (product.requiresSerial && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} serial number(s) for ${line.productName}`, 'error'); return
          }
          for (const sid of line.serialIds) {
            if (!store.serialRef.current.find(s => s.id === sid)) {
              store.showToast(`Serial missing for ${line.productName} — re-select or register returned serials`, 'error'); return
            }
          }
        }
        lines.forEach(line => {
          // Restore serials — good/fair → available, poor → refurbishment
          // A serial still on a product that no longer exists (the line was
          // relinked above) moves with the line, or it would sit in stock
          // under a product nobody can see.
          const productExists = (pid: string) => store.prodRef.current.some(x => x.id === pid)
          line.serialIds.forEach(sid => {
            store.setSerials(p => p.map(s => s.id === sid
              ? {
                  ...s,
                  ...(productExists(s.productId) ? {} : { productId: line.productId, productName: line.productName }),
                  status: line.condition === 'poor' ? 'refurbishment' : 'available', location: bb.destinationLocation, soldDate: undefined, saleOrderId: undefined,
                }
              : s
            ))
          })
          // Non-serialized: increase stock
          if (line.serialIds.length === 0) {
            store.setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
            store.setBulkStock(prev => store.upsertBulkStock(prev, line.productId, bb.destinationLocation, line.qty))
          } else {
            store.setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
          }
          store.addMove(line.productId, line.productName, line.qty, 'in', `Buy-back ${bb.ref}`, bb.ref, 'customer', bb.destinationLocation, line.serialIds.map(id => store.serialRef.current.find(s => s.id === id)?.serial ?? id))
        })
        const toRefurb = store.openTradeInRefurbJobs(lines.flatMap(line => line.serialIds
          .filter(sid => line.condition === 'poor' || awaitingIdentification(store.serialRef.current.find(s => s.id === sid)))
          .map(sid => ({
            serialId: sid,
            cost: line.unitPrice,
            sourceRef: bb.ref,
            issue: awaitingIdentification(store.serialRef.current.find(s => s.id === sid))
              ? `Trade-in ${bb.ref} (${bb.customerName}) — serial unknown, not yet identified${line.notes ? `: ${line.notes}` : ''}`
              : `Trade-in ${bb.ref} (${bb.customerName}) in poor condition${line.notes ? `: ${line.notes}` : ''}`,
          }))))
        store.setBuyBacks(p => p.map(b => b.id === id ? { ...b, lines, status: 'stocked', stockedDate: now(), stockedByName: user.name } : b))
        // The machines take their trade-in cost into inventory (Dr Inventory,
        // Cr Trade-in Purchases); they used to come in at no value.
        void fetch('/api/inventory/trade-in-valuation', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ buyBackId: bb.id }),
        }).then(res => { if (!res.ok) store.showToast(`${bb.ref} is stocked, but its stock value was not posted — tell Finance`, 'error') })
          .catch(() => store.showToast(`${bb.ref} is stocked, but its stock value was not posted — tell Finance`, 'error'))
        store.addAuditLog('buyback_stock', bb.ref, `Stocked buy-back ${bb.ref} for ${bb.customerName}${toRefurb ? ` — ${toRefurb} to refurbishment` : ''}`)
        store.cancelWarrantiesForTradeIn(lines.flatMap(l => l.serialIds), bb.ref, `Bought back from ${bb.customerName} (${bb.ref})`)
        store.showToast(`${bb.ref} stocked — inventory updated${toRefurb ? `; ${toRefurb} machine${toRefurb === 1 ? '' : 's'} sent to Refurbishment` : ''}`)
      },

    deleteBuyBack: (id) => {
        const bb = store.buyBacks.find(b => b.id === id)
        store.setBuyBacks(p => p.filter(b => b.id !== id))
        // Deleting used to leave no trace; the whole record goes to the audit log.
        if (bb) store.addAuditLog('buyback_delete', bb.ref, `Deleted buy-back ${bb.ref} for ${bb.customerName} (${bb.status}): ${bb.lines.map(l => `${l.qty}× ${l.productName} @ ${l.unitPrice}`).join('; ')} — ${JSON.stringify(bb).slice(0, 1500)}`)
        if (bb?.repairId) {
          store.setRepairs(p => p.map(r => r.id === bb.repairId && r.retainedBuyBackId === id
            ? {
                ...r,
                retainedBuyBackId: undefined,
                retainedBuyBackRef: undefined,
                notes: `${r.notes || ''}\n\nDraft trade-in ${bb.ref} deleted — repair unlinked`.trim(),
              }
            : r))
        }
        store.showToast('Buy-back deleted')
      },

    createDonation: (type, party, location, lines, notes) => {
        for (const line of lines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid donation product') }
          if (line.qty <= 0) { store.showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid donation quantity') }
          if (product.requiresSerial && type === 'in' && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} serial number(s) for donation-in of ${product.name}`, 'error')
            throw new Error('Missing donation-in serials')
          }
          if (product.requiresSerial && type === 'out' && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} serial number(s) for ${product.name}`, 'error')
            throw new Error('Missing donation serials')
          }
        }
        const don: Donation = {
          id: uid(), ref: allocateDocNumberSync('DON'),
          type, party, date: now(),
          lines: lines.map(l => ({ ...l, id: uid() })),
          status: 'draft', location, notes,
        }
        store.setDonations(p => [don, ...p]); store.numberDonations([don.id])
        store.showToast(`Donation ${don.ref} created`)
        return don
      },

    confirmDonation: (id) => {
        const user = store.currentUser(); if (!user) return
        const don = store.donations.find(d => d.id === id)
        if (!don) return
        if (don.status !== 'draft') { store.showToast('Donation already confirmed', 'info'); return }
        for (const line of don.lines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName}`, 'error'); return }
          if (line.qty <= 0) { store.showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); return }
          if (product.requiresSerial && don.type === 'in' && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} serial number(s) for donation-in of ${product.name}`, 'error'); return
          }
          if (product.requiresSerial && don.type === 'out' && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} serial number(s) for ${product.name}`, 'error'); return
          }
          if (!product.requiresSerial && don.type === 'out') {
            const available = store.calcStockByLocation(product, store.serialRef.current, store.bulkStock, line.productId)[don.location] ?? 0
            if (available < line.qty) { store.showToast(`Only ${available} ${product.name} available at ${store.LOCATIONS[don.location].name}`, 'error'); return }
          }
        }
        don.lines.forEach(line => {
          if (don.type === 'in') {
            // Receive donated items into stock
            line.serialIds.forEach(sid => {
              store.setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'available', location: don.location, soldDate: undefined, saleOrderId: undefined } : s))
            })
            store.setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
            if (line.serialIds.length === 0) store.setBulkStock(prev => store.upsertBulkStock(prev, line.productId, don.location, line.qty))
            store.addMove(
              line.productId,
              line.productName,
              line.qty,
              'in',
              `Donation in ${don.ref}`,
              don.ref,
              'customer',
              don.location,
              line.serialIds.map(sid => store.serialRef.current.find(s => s.id === sid)?.serial ?? sid),
            )
          } else {
            // Donate items out of stock
            line.serialIds.forEach(sid => {
              store.setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'written_off', location: 'customer' as LocationId } : s))
            })
            store.setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: Math.max(0, x.stockQty - line.qty) } : x))
            if (line.serialIds.length === 0) store.setBulkStock(prev => store.upsertBulkStock(prev, line.productId, don.location, -line.qty))
            store.addMove(line.productId, line.productName, line.qty, 'out', `Donation out ${don.ref}`, don.ref, don.location, 'customer', line.serialIds.map(id => store.serialRef.current.find(s => s.id === id)?.serial ?? id))
          }
        })
        // Donated machines with no readable serial go to Refurbishment to be identified.
        const toRefurb = don.type === 'in'
          ? store.openTradeInRefurbJobs(don.lines.flatMap(line => line.serialIds
            .filter(sid => awaitingIdentification(store.serialRef.current.find(s => s.id === sid)))
            .map(sid => ({ serialId: sid, cost: 0, sourceRef: don.ref, issue: `Donated in ${don.ref} (${don.party}) — serial unknown, not yet identified` }))))
          : 0
        store.setDonations(p => p.map(d => d.id === id ? { ...d, status: 'confirmed', confirmedByName: user.name, confirmedDate: now() } : d))
        store.showToast(`Donation ${don.ref} confirmed — stock updated${toRefurb ? `; ${toRefurb} sent to Refurbishment` : ''}`)
      },

    deleteDonation: (id) => {
        store.setDonations(p => p.filter(d => d.id !== id))
        store.showToast('Donation deleted')
      },

    createExchange: (customerId, customerName, returnLines, newLines, notes, originalSOId, originalSORef) => {
        for (const line of returnLines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid exchange return product') }
          if (line.qty <= 0) { store.showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid exchange return quantity') }
          if (product.requiresSerial && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} returned serial number(s) for ${product.name}`, 'error')
            throw new Error('Missing exchange return serials')
          }
        }
        for (const line of newLines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName || line.productId}`, 'error'); throw new Error('Invalid exchange issue product') }
          if (line.qty <= 0) { store.showToast(`Quantity must be greater than zero for ${product.name}`, 'error'); throw new Error('Invalid exchange issue quantity') }
          if (product.requiresSerial && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} outgoing serial number(s) for ${product.name}`, 'error')
            throw new Error('Missing exchange issue serials')
          }
        }
        const rLines: ExchangeLine[] = returnLines.map(l => ({ ...l, id: uid() }))
        const nLines: ExchangeLine[] = newLines.map(l => ({ ...l, id: uid() }))
        const returnTotal = rLines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
        const newTotal    = nLines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
        const exc: ClientExchange = {
          id: uid(), ref: store.tradeInRef('EXC'),
          customerId, customerName, originalSOId, originalSORef,
          status: 'draft', date: now(),
          returnLines: rLines, newLines: nLines,
          returnTotal, newTotal, priceDiff: newTotal - returnTotal, notes,
        }
        store.setClientExchanges(p => [exc, ...p])
        store.showToast(`Exchange created for ${customerName}`)
        return exc
      },

    approveExchange: (id) => {
        const user = store.currentUser(); if (!user) return
        if (!userCan(user, 'sales.exchange.approve')) { store.showToast('Only Director or Finance can approve exchanges', 'error'); return }
        const exchange = store.clientExchanges.find(e => e.id === id)
        if (!exchange || exchange.status !== 'draft') { store.showToast('Only draft exchanges can be approved', 'error'); return }
        store.setClientExchanges(p => p.map(e => e.id === id
          ? { ...e, status: 'approved', approvedByName: user.name, approvedDate: now() }
          : e
        ))
        store.showToast('Exchange approved')
      },

    completeExchange: (id) => {
        const user = store.currentUser(); if (!user) return
        const exc = store.clientExchanges.find(e => e.id === id)
        if (!exc) return
        if (exc.status !== 'approved') { store.showToast('Approve the exchange before completing it', 'error'); return }
        for (const line of exc.returnLines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName}`, 'error'); return }
          if (product.requiresSerial && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} returned serial number(s) for ${product.name}`, 'error'); return
          }
        }
        for (const line of exc.newLines) {
          const product = store.prodRef.current.find(p => p.id === line.productId)
          if (!product) { store.showToast(`Product not found: ${line.productName}`, 'error'); return }
          if (product.requiresSerial && line.serialIds.length !== line.qty) {
            store.showToast(`Select ${line.qty} outgoing serial number(s) for ${product.name}`, 'error'); return
          }
          if (!product.requiresSerial) {
            const available = store.calcStockByLocation(product, store.serialRef.current, store.bulkStock, line.productId).warehouse ?? 0
            if (available < line.qty) { store.showToast(`Only ${available} ${product.name} available in warehouse`, 'error'); return }
          }
        }
  
        // Return items → With Issues (shop). Exchanged units are assumed faulty /
        // customer-issue and must not land in Ready for Sale / warehouse.
        const returnLocation: LocationId = EXCHANGE_RETURN_LOCATION
        exc.returnLines.forEach(line => {
          line.serialIds.forEach(sid => {
            store.setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'available', location: returnLocation, soldDate: undefined, saleOrderId: undefined } : s))
          })
          if (line.serialIds.length === 0) {
            store.setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
            store.setBulkStock(prev => store.upsertBulkStock(prev, line.productId, returnLocation, line.qty))
          } else {
            store.setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: x.stockQty + line.qty } : x))
          }
          store.addMove(line.productId, line.productName, line.qty, 'in', `Exchange return ${exc.ref}`, exc.ref, 'customer', returnLocation, line.serialIds.map(id => store.serialRef.current.find(s => s.id === id)?.serial ?? id))
        })
  
        // Machines handed in with no readable serial go to Refurbishment to be identified.
        const excToRefurb = store.openTradeInRefurbJobs(exc.returnLines.flatMap(line => line.serialIds
          .filter(sid => awaitingIdentification(store.serialRef.current.find(s => s.id === sid)))
          .map(sid => ({ serialId: sid, cost: line.unitPrice, sourceRef: exc.ref, issue: `Exchange ${exc.ref} (${exc.customerName}) — serial unknown, not yet identified` }))))
        if (excToRefurb) store.addAuditLog('exchange_refurb', exc.ref, `${excToRefurb} machine(s) without serial sent to Refurbishment`)
  
        // New items → out to customer
        exc.newLines.forEach(line => {
          line.serialIds.forEach(sid => {
            store.setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'sold', location: 'customer' as LocationId, soldDate: now(), saleOrderId: exc.id } : s))
          })
          store.setProducts(p => p.map(x => x.id === line.productId ? { ...x, stockQty: Math.max(0, x.stockQty - line.qty) } : x))
          if (line.serialIds.length === 0) store.setBulkStock(prev => store.upsertBulkStock(prev, line.productId, 'warehouse', -line.qty))
          store.addMove(line.productId, line.productName, line.qty, 'out', `Exchange issue ${exc.ref}`, exc.ref, 'warehouse', 'customer', line.serialIds.map(id => store.serialRef.current.find(s => s.id === id)?.serial ?? id))
        })
  
        store.setClientExchanges(p => p.map(e => e.id === id ? { ...e, status: 'completed', completedDate: now(), completedByName: user.name } : e))
        store.addAuditLog('exchange_complete', exc.ref, `Completed exchange ${exc.ref} for ${exc.customerName} — returns to ${store.LOCATIONS[returnLocation].name}`)
        store.cancelWarrantiesForTradeIn(exc.returnLines.flatMap(l => l.serialIds), exc.ref, `Handed back by ${exc.customerName} on exchange ${exc.ref}`)
        store.showToast(`Exchange ${exc.ref} completed — returned items moved to ${store.LOCATIONS[returnLocation].name}`)
      },

    cancelExchange: (id) => {
        store.setClientExchanges(p => p.map(e => e.id === id ? { ...e, status: 'cancelled' } : e))
        store.showToast('Exchange cancelled')
      },
  }
}
