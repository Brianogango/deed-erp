import type { Rider, DeliveryJob, RiderWeeklyPay, Delivery } from '../delivery'
import { uid, now } from '../ids'
import { invoiceDocState, isOpenDeliveryStatus, remainingUndeliveredByProduct } from '@/lib/odoo-sales-flow'
import { buildDeliveryChargeInvoiceLine, appendDeliveryChargeToInvoice } from '@/lib/invoice-delivery-charge'
import { sync } from '../sync'
import { resolveAssignedRiderFee } from '@/lib/delivery-job-fee'
import type { RepairStatus } from '@/lib/repair-types'
import { riderPayForJob, riderFeeAccount } from '@/lib/delivery/rider-direct-pay'
import type { Invoice } from '../finance'
import { isDeliveryNoteLine, isNonStockSaleLine } from '@/lib/sales/non-stock-line'
import type { LocationId } from '../core'
import { isSerialTracking, inferTrackingMethod } from '@/lib/inventory-identifiers'
import { resolveBulkDeliverySourceLocation } from '@/lib/inventory/delivery-source'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** delivery actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createDeliveryActions(store: StoreDeps): Pick<AppState, 'addRider' | 'updateRider' | 'createDeliveryJob' | 'updateDeliveryJob' | 'deleteDeliveryJob' | 'scheduleInvoiceDelivery' | 'assignRiderToJob' | 'advanceJobStatus' | 'generateWeeklyPay' | 'markWeeklyPayPaid' | 'recordCustomerPaidRider' | 'createDeliveryFromSO' | 'createInvoiceFromDelivery'> {
  return {
    addRider: (r) => {
        const rider: Rider = { ...r, id: uid(), createdAt: now() }
        store.setRiders(p => [...p, rider])
        store.showToast(`Rider ${rider.name} added`)
        return rider
      },

    updateRider: (id, p) => {
        store.setRiders(prev => prev.map(r => r.id === id ? { ...r, ...p } : r))
      },

    createDeliveryJob: async (j) => {
        const user = store.currentUser()
        // Server-allocated atomic ref — the per-browser localStorage counter
        // (seq 'djb') restarted on every client and produced dozens of jobs
        // sharing DJB/0004 in production.
        const ref = await store.fetchNextDeliveryRef()
        if (!ref) {
          store.showToast('Could not allocate a delivery reference — check your connection and retry', 'error')
          return null
        }
        const job: DeliveryJob = {
          ...j, id: uid(), ref, status: 'pending',
          createdByUserId: user?.id ?? '', createdByName: user?.name ?? 'System',
          createdAt: new Date().toISOString(),
        }
        store.setDeliveryJobs(p => [job, ...p])
        store.addAuditLog('create_delivery_job', job.ref, `${job.type} for ${job.customerName}`)
        store.showToast(`Delivery job ${job.ref} created`)
        return job
      },

    updateDeliveryJob: (id, p) => {
        store.setDeliveryJobs(prev => prev.map(j => j.id === id ? { ...j, ...p } : j))
      },

    deleteDeliveryJob: (id) => {
        const job = store.deliveryJobs.find(j => j.id === id)
        // A trip in a rider's weekly pay (or delivered and payable) is part of
        // what the rider is owed: deleting it would leave the pay pointing at
        // nothing. Cancel or fail it instead.
        const inPay = store.riderWeeklyPays.find(p => (p.jobIds ?? []).includes(id))
        if (inPay) { store.showToast(`${job?.ref ?? 'This job'} is in rider pay ${inPay.ref} — it cannot be deleted`, 'error'); return }
        if (job?.status === 'delivered') { store.showToast(`${job.ref} was delivered — mark it failed or cancelled instead of deleting it`, 'error'); return }
        store.setDeliveryJobs(prev => prev.filter(j => j.id !== id))
        store.showToast('Delivery job deleted')
      },

    scheduleInvoiceDelivery: async (invoiceId, opts) => {
        const inv = store.invRef.current.find(i => i.id === invoiceId)
        if (!inv) { store.showToast('Invoice not found', 'error'); return null }
        if (inv.type !== 'customer_invoice') {
          store.showToast('Rider delivery can only be scheduled from a customer invoice', 'error')
          return null
        }
        if (inv.status === 'cancelled') {
          store.showToast('Cannot schedule delivery on a cancelled invoice', 'error')
          return null
        }
        const address = (opts.deliveryAddress || '').trim()
        if (!address) { store.showToast('Enter a delivery address', 'error'); return null }
        if (!opts.scheduledDate) { store.showToast('Enter a scheduled date', 'error'); return null }
        const riderFee = Number(opts.riderFee)
        if (!Number.isFinite(riderFee) || riderFee < 0) {
          store.showToast('Enter a valid rider fee for this trip', 'error')
          return null
        }
        const deliveryFee = Math.max(0, Number(opts.deliveryFee) || 0)
        const activeJob = store.deliveryJobs.find(j =>
          j.invoiceId === invoiceId && !['cancelled', 'failed'].includes(j.status)
        )
        if (activeJob) {
          store.showToast(`Delivery job ${activeJob.ref} already exists for this invoice`, 'info')
          return null
        }
  
        const contact = store.contacts.find(c => c.id === inv.partnerId)
        const so = inv.saleOrderId ? store.soRef.current.find(s => s.id === inv.saleOrderId) : undefined
        const pickup = [store.companySettings.name, store.companySettings.address, store.companySettings.city]
          .filter(Boolean).join(', ') || 'Deed Technologies'
        const phone = contact?.phone || contact?.mobile || ''
        const addCharge = opts.addChargeToInvoice !== false && deliveryFee > 0
  
        const job = await store.storeCtxRef.current!.createDeliveryJob({
          type: 'sales_delivery',
          invoiceId: inv.id,
          invoiceRef: inv.ref,
          saleOrderId: so?.id || inv.saleOrderId,
          saleOrderRef: so?.ref,
          customerName: inv.partnerName,
          customerPhone: phone,
          pickupAddress: pickup,
          deliveryAddress: address,
          scheduledDate: opts.scheduledDate,
          riderFee,
          deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
          billedTo: deliveryFee > 0 ? 'customer' : 'company',
          notes: opts.notes?.trim()
            || `Invoice ${inv.ref}${so ? ` · ${so.ref}` : ''}${deliveryFee > 0 ? ` · customer delivery charge ${deliveryFee}` : ''}`,
        })
        if (!job) return null
  
        if (opts.riderId) {
          store.storeCtxRef.current!.assignRiderToJob(job.id, opts.riderId, riderFee)
        }
  
        // A posted invoice cannot take another line (the server refuses: posted
        // invoices are immutable), so its delivery charge is billed on a new
        // draft invoice for the same customer. Writing the line onto the posted
        // invoice used to show on screen, be refused by the server, and — when
        // the status read exactly 'posted' — still book the charge to the
        // ledger, so accounts and the invoice disagreed.
        const invoicePosted = invoiceDocState(inv.status) === 'posted'
        if (addCharge && !invoicePosted) {
          const vatRate = Number(store.companySettings.vatRate) || 0
          const chargeLine = buildDeliveryChargeInvoiceLine({
            id: uid(),
            amount: deliveryFee,
            taxRate: vatRate,
          })
          const { lines, subtotal, taxTotal, total } = appendDeliveryChargeToInvoice(inv, chargeLine)
          store.setInvoices(prev => {
            const next = prev.map(i => i.id !== inv.id ? i : {
              ...i,
              lines,
              subtotal,
              taxTotal,
              total,
              deliveryAddress: address,
              deliveryJobId: job.id,
            })
            const updated = next.find(i => i.id === inv.id)
            if (updated) {
              store.invRef.current = next
              sync(`/api/invoices/${inv.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
              })
            }
            return next
          })
        } else {
          store.storeCtxRef.current!.updateInvoice(inv.id, {
            deliveryAddress: address,
            deliveryJobId: job.id,
          })
          if (addCharge) {
            const vatRate = Number(store.companySettings.vatRate) || 0
            const chargeInvoice = store.storeCtxRef.current!.createManualInvoice(
              'customer_invoice',
              inv.partnerId,
              inv.partnerName,
              inv.dueDate || store.addDays(now(), 7),
              [{ desc: `Delivery charge — ${inv.ref} (${job.ref})`, qty: '1', price: String(deliveryFee), tax: String(vatRate) }],
              vatRate,
              `Delivery charge for ${inv.ref}, delivery job ${job.ref}. ${inv.ref} was already posted, so the charge is billed here.`,
            )
            if (chargeInvoice) {
              store.storeCtxRef.current!.updateDeliveryJob(job.id, { notes: `${job.notes ?? ''}\nDelivery charge billed on ${chargeInvoice.ref} (draft — Finance confirms it)`.trim() })
              store.showToast(`${inv.ref} is already posted — delivery charge put on a new draft invoice for Finance to confirm`, 'info')
            }
          }
        }
  
        store.addAuditLog('schedule_invoice_delivery', inv.ref, `Created ${job.ref} (rider fee ${riderFee}${deliveryFee > 0 ? `, customer charge ${deliveryFee}` : ''})`)
        return job
      },

    assignRiderToJob: (jobId, riderId, riderFee) => {
        const rider = store.riders.find(r => r.id === riderId)
        if (!rider) { store.showToast('Rider not found', 'error'); return }
        store.setDeliveryJobs(prev => prev.map(j => {
          if (j.id !== jobId) return j
          const fee = resolveAssignedRiderFee({
            existingFee: j.riderFee,
            overrideFee: riderFee,
            riderDefaultRate: rider.ratePerDelivery,
          })
          return {
            ...j,
            riderId,
            riderName: rider.name,
            riderFee: fee,
            status: 'assigned',
            assignedAt: new Date().toISOString(),
          }
        }))
        store.showToast(`${rider.name} assigned`)
      },

    advanceJobStatus: (jobId, newStatus, failureReason) => {
        // Read job synchronously before state updates so we can trigger side effects
        const job = store.deliveryJobs.find(j => j.id === jobId)
  
        store.setDeliveryJobs(prev => prev.map(j => {
          if (j.id !== jobId) return j
          const updates: Partial<DeliveryJob> = { status: newStatus }
          if (newStatus === 'in_transit') updates.pickedUpAt = now()
          if (newStatus === 'delivered')  updates.deliveredAt = now()
          if (newStatus === 'failed' && failureReason) updates.failureReason = failureReason
          return { ...j, ...updates }
        }))
  
        // When a repair drop-off job completes, mark the linked repair as delivered
        if (newStatus === 'delivered' && job?.type === 'repair_dropoff' && job.repairOrderId) {
          const repair = store.repairs.find(r => r.id === job.repairOrderId)
          store.setRepairs(prev => prev.map(r => r.id === job.repairOrderId ? {
            ...r,
            status: 'delivered' as RepairStatus,
            deliveryActualDate: now(),
            deliveryRecipient: r.contactPersonName || r.customerName,
            deliveryRecipientPhone: r.contactPersonPhone || r.customerPhone,
          } : r))
          if (repair) {
            store.syncRepairToPortal(
              { ...repair, status: 'delivered' },
              `Device delivered by rider ${job.riderName || 'rider'}`
            )
          }
          store.addAuditLog('deliver_repair', job.repairOrderId, `Delivered by rider ${job.riderName || 'rider'} via job ${job.ref}`)
          store.showToast(`${job.repairOrderRef} marked as delivered`)
        }
  
        store.addAuditLog('update_delivery_job', jobId, `Status → ${newStatus}`)
      },

    generateWeeklyPay: (riderId, weekStart) => {
        const rider = store.riders.find(r => r.id === riderId)
        if (!rider) return null
        // weekStart is a Monday (YYYY-MM-DD); compute Sunday
        const start = new Date(weekStart)
        const end   = new Date(start); end.setDate(end.getDate() + 6)
        const weekEnd = end.toISOString().slice(0, 10)
        // A trip already counted in another weekly pay is never counted again.
        const alreadyPaid = new Set(store.riderWeeklyPays.flatMap(p => p.jobIds ?? []))
        const weekJobs = store.deliveryJobs.filter(j =>
          !alreadyPaid.has(j.id) &&
          j.riderId === riderId &&
          j.status === 'delivered' &&
          j.deliveredAt &&
          j.deliveredAt.slice(0, 10) >= weekStart &&
          j.deliveredAt.slice(0, 10) <= weekEnd
        )
        if (weekJobs.length === 0) { store.showToast('No delivered jobs for this rider in that week', 'info'); return null }
        // Check for duplicate
        const existing = store.riderWeeklyPays.find(p => p.riderId === riderId && p.weekStart === weekStart)
        if (existing) { store.showToast('Weekly pay already generated for this period', 'info'); return null }
        // A trip the customer paid the rider for directly counts at the fee less
        // that, never below zero (an extra is the rider's to keep).
        const gross = weekJobs.reduce((s, j) => s + j.riderFee, 0)
        const total = Math.round(weekJobs.reduce((s, j) => s + riderPayForJob(j), 0) * 100) / 100
        const paidByCustomers = Math.round((gross - total) * 100) / 100
        const pay: RiderWeeklyPay = {
          id: uid(), ref: store.riderPayRef(), riderId, riderName: rider.name,
          weekStart, weekEnd, jobIds: weekJobs.map(j => j.id),
          deliveryCount: weekJobs.length, ratePerDelivery: rider.ratePerDelivery,
          totalAmount: total, status: 'pending',
          notes: paidByCustomers > 0 ? `Fees KES ${gross.toLocaleString('en-KE')} less KES ${paidByCustomers.toLocaleString('en-KE')} customers paid the rider directly` : '',
          createdAt: new Date().toISOString(),
        }
        store.setRiderWeeklyPays(p => [pay, ...p])
        store.showToast(`Pay of ${total.toLocaleString('en-KE', { style: 'currency', currency: 'KES' })} generated for ${rider.name}`)
        return pay
      },

    markWeeklyPayPaid: (id) => {
        const user = store.currentUser()
        const pay = store.riderWeeklyPays.find(p => p.id === id)
        if (!pay) return
  
        // The rider's bill is a draft like every other bill: Finance confirms it
        // (official BILL number, journal) and pays it. It used to take a number
        // from this browser's own counter and claim to be posted.
        const riderContactId = store.contacts.find(c => c.name.trim().toLowerCase() === pay.riderName.trim().toLowerCase())?.id ?? pay.riderId
        const bill: Invoice = {
          id: uid(), ref: store.draftInvoiceRef('vendor_bill'), type: 'vendor_bill', status: 'draft',
          partnerId: riderContactId, partnerName: pay.riderName,
          date: now(), dueDate: now(),
          lines: [{
            id: uid(),
            // One line for the week's actual fees: trips can carry their own fee,
            // so count × standard rate need not equal the total.
            description: `Rider delivery fees — week of ${pay.weekStart} (${pay.deliveryCount} deliver${pay.deliveryCount === 1 ? 'y' : 'ies'})${pay.notes ? ` — ${pay.notes}` : ''}`,
            // Rider fees are a delivery expense, not stock purchases (a bill line
            // with no account used to land in 6101 Purchases).
            accountCode: riderFeeAccount(store.accounts.map(a => a.code)).code,
            qty: 1,
            unitPrice: pay.totalAmount,
            taxRate: 0,
            subtotal: pay.totalAmount,
          }],
          subtotal: pay.totalAmount, taxTotal: 0, total: pay.totalAmount,
          amountPaid: 0,
          notes: `From rider weekly pay ${pay.ref} · raised by ${user?.name ?? 'staff'}`,
        }
        store.invRef.current = [bill, ...store.invRef.current]
        store.setInvoices(p => [bill, ...p])
        void store.saveInvoiceToServer(bill, msg => store.showToast(msg, 'error'))
        store.addAuditLog('create_bill', bill.ref, `Rider bill ${pay.ref} confirmed — vendor bill ${bill.ref} created`)
  
        store.setRiderWeeklyPays(prev => prev.map(p =>
          p.id === id
            ? { ...p, status: 'paid', paidDate: now(), paidByUserId: user?.id, paidByName: user?.name, invoiceId: bill.id, invoiceRef: bill.ref }
            : p
        ))
        store.showToast(`Draft bill raised for ${pay.riderName} — Finance confirms and pays it`)
      },

    recordCustomerPaidRider: async (jobId, input) => {
        const job = store.deliveryJobs.find(j => j.id === jobId)
        if (!job) return false
        const amount = Math.round((Number(input.amount) || 0) * 100) / 100
        const settleOnly = Boolean(job.customerPaidRider?.pending)
        if (!settleOnly && !(amount > 0)) { store.showToast('Enter the amount the customer paid the rider', 'error'); return false }
        if (!job.riderId) { store.showToast('Assign the rider first', 'error'); return false }
        if (job.customerPaidRider && !settleOnly) { store.showToast(`Already recorded: the customer paid ${job.riderName ?? 'the rider'} ${store.fmtKes(job.customerPaidRider.amount)}`, 'info'); return false }
        // Done on the server — the same path as the rider's own link: the charge
        // comes off the invoice (credit note once posted) and off the rider's pay.
        const res = await fetch(`/api/delivery-jobs/${encodeURIComponent(jobId)}/paid-to-rider`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settleOnly ? { action: 'settle' } : { amount, method: input.method, reference: input.reference?.trim() || undefined }),
        }).catch(() => null)
        const out = res ? await res.json().catch(() => ({})) : {}
        if (!res?.ok || !out.job) { store.showToast(out.error || 'Could not save. Try again.', 'error'); return false }
        const record = (out.job as DeliveryJob).customerPaidRider
        store.setDeliveryJobs(p => p.map(j => j.id !== jobId ? j : { ...j, customerPaidRider: record }))
        store.addAuditLog('delivery_customer_paid_rider', job.ref, `Customer paid ${job.riderName ?? 'rider'} ${store.fmtKes(record?.amount ?? amount)} directly — ${out.message ?? ''}; rider pay for this trip now ${store.fmtKes(riderPayForJob({ ...job, customerPaidRider: record }))}`)
        store.showToast(`${out.message ?? 'Recorded'} — rider pay for ${job.ref}: ${store.fmtKes(riderPayForJob({ ...job, customerPaidRider: record }))}`, record?.pending ? 'info' : 'success')
        return true
      },

    // ── Delivery & Fulfillment ───────────────────────────────────────────────
    createDeliveryFromSO: async (salesOrderId, forcedRef) => {
        const so = store.soRef.current.find(s => s.id === salesOrderId) ?? store.saleOrders.find(s => s.id === salesOrderId)
        if (!so) {
          store.showToast('Sales order not found', 'error')
          return null
        }
        if (so.status !== 'sale') {
          store.showToast('Only a confirmed Sales Order can create a delivery', 'error')
          return null
        }
        const open = store.delRef.current.filter(d => d.saleOrderId === so.id && isOpenDeliveryStatus(d.status))
        if (open.length > 0) {
          store.showToast(`${so.ref} already has open delivery ${open[0].ref}`, 'info')
          return open[0]
        }
        const remaining = remainingUndeliveredByProduct(so.lines)
        const lines = (so.lines ?? [])
          .filter(line =>
            isDeliveryNoteLine(line)
            && remaining[line.productId] > 0
          )
          .map(line => {
            const prod = store.prodRef.current.find(p => p.id === line.productId)
            const qty = remaining[line.productId]
            const selectedSource = (line as { sourceLocation?: LocationId }).sourceLocation
            let sourceLocation: LocationId | undefined
            if (isNonStockSaleLine(line, prod ?? null)) {
              sourceLocation = undefined
            } else if (selectedSource) {
              sourceLocation = selectedSource
            } else if (prod && isSerialTracking(inferTrackingMethod(prod))) {
              // Only Ready for Sale ships; a shortfall is reported, never filled
              // from With Issues (lib/inventory/sellable-stock.ts).
              sourceLocation = 'warehouse'
            } else {
              sourceLocation = resolveBulkDeliverySourceLocation({
                product: prod,
                productId: line.productId,
                qty,
                preferred: 'warehouse',
                serials: store.serialRef.current,
                bulkStock: store.bulkStock,
                reservations: store.stockReservations,
                excludeReferenceId: so.id,
              }).location
            }
            return {
              productId: line.productId,
              productName: line.productName,
              qty,
              qtyDone: 0,
              serialIds: [] as string[],
              sourceLocation,
            }
          })
        if (lines.length === 0) {
          const hasFulfillmentLines = (so.lines ?? []).some((line: any) => isDeliveryNoteLine(line))
          store.showToast(
            hasFulfillmentLines
              ? `${so.ref} is fully delivered — no new delivery needed`
              : `${so.ref} has no stockable lines — create an invoice from ordered quantities`,
            'info',
          )
          return null
        }
  
        const delivery: Delivery = {
          id: uid(),
          ref: forcedRef ?? await store.storeCtxRef.current!.allocateDocRef('DN'),
          saleOrderId: so.id,
          saleOrderRef: so.ref ?? '',
          customerId: so.customerId,
          customerName: so.customerName,
          date: now(),
          status: 'ready',
          warrantyCreated: false,
          lines,
        }
        
        store.setDeliveries(prev => [delivery, ...prev])
        sync('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(delivery) })
        store.addAuditLog('create_delivery', delivery.ref, `Created from ${so.ref}`)
        store.showToast(`Delivery note ${delivery.ref} created`)
        
        return delivery
      },

    createInvoiceFromDelivery: async (deliveryId) => {
        const delivery = store.deliveries.find(d => d.id === deliveryId)
        if (!delivery) return null
  
        const so = store.saleOrders.find(s => s.id === delivery.saleOrderId)
        if (!so) return null
  
        // Check if invoice already exists
        const existing = store.invoices.find(i => i.notes?.includes(delivery.ref))
        if (existing) {
          store.showToast('Invoice already created for this delivery', 'info')
          return existing
        }
  
        if (Number(so.total ?? 0) < 1) {
          store.showToast('Invoice total must be at least KES 1 — invoices below KES 1 cannot be created', 'error')
          return null
        }
  
        // Build lines from SO lines, matching by productId in insertion order to handle duplicates
        const soLinesPool = [...so.lines]
        const vatRate = store.companySettings.vatRate
  
        const invoice: Invoice = {
          id: uid(),
          ref: await store.storeCtxRef.current!.allocateDocRef('INV'),
          type: 'customer_invoice',
          status: 'posted',
          partnerId: delivery.customerId,
          partnerName: delivery.customerName,
          date: now(),
          dueDate: store.addDays(now(), 0),
          lines: delivery.lines.map(line => {
            const idx = soLinesPool.findIndex(l => l.productId === line.productId)
            const soLine = idx >= 0 ? soLinesPool.splice(idx, 1)[0] : null
            return {
              id: uid(),
              description: line.productName,
              qty: line.qty,
              unitPrice: soLine?.unitPrice ?? 0,
              taxRate: vatRate,
              subtotal: (soLine?.unitPrice ?? 0) * line.qty,
            }
          }),
          subtotal: so.subtotal,
          taxTotal: so.taxTotal,
          total: so.total,
          amountPaid: 0,
          notes: `Invoice for ${so.ref} via ${delivery.ref}`,
        }
  
        store.setInvoices(prev => [invoice, ...prev])
        store.postInvoiceJournalOnce(invoice)
        store.syncOrWarn('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invoice),
        }, message => store.showToast(message, 'error'), `${invoice.ref} was not saved — please retry`)
  
        store.setSaleOrders(prev => {
          const next = prev.map(s => {
            if (s.id !== so.id) return s
            const invoicedByProduct: Record<string, number> = {}
            delivery.lines.forEach(l => { invoicedByProduct[l.productId] = (invoicedByProduct[l.productId] ?? 0) + l.qty })
            const lines = s.lines.map((l: any) => invoicedByProduct[l.productId]
              ? { ...l, qtyInvoiced: (Number(l.qtyInvoiced) || 0) + invoicedByProduct[l.productId] }
              : l)
            return { ...s, lines, invoiceId: invoice.id }
          })
          const updatedSo = next.find(s => s.id === so.id)
          if (updatedSo) sync(`/api/sale-orders/${so.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedSo) })
          return next
        })
  
        store.addAuditLog('auto_invoice', invoice.ref, `Auto-generated from ${delivery.ref}`)
        store.showToast(`Invoice ${invoice.ref} generated`, 'success')
  
        return invoice
      },
  }
}
