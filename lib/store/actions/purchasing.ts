import { canManageProcurement, canValidatePurchaseReceiptAction, canManageFinance } from '../permissions'
import type { PurchaseOrder, POLine, Receipt, PurchaseReturn } from '../purchasing'
import { uid, now } from '../ids'
import { sync } from '../sync'
import { CATEGORY_CONFIG, type CategoryId } from '@/lib/product-categories'
import { resolveProductAccounts } from '@/lib/product-accounts'
import { allocateReceiptToPoLines, billedQtyByPoLine } from '@/lib/purchase/receipt-allocation'
import type { SerialNumber, RefurbishmentJob } from '../inventory'
import { seedSerialSpecs } from '@/lib/reconfiguration/unit-config'
import { allocateDocNumberSync } from '@/lib/doc-numbers'
import { planRepairPartReserve } from '@/lib/inventory/repair-parts-stock'
import type { LocationId } from '../core'
import { poHasReceivedGoods, billableQty, assertBillableQty } from '@/lib/purchase/three-way-match'
import { contactPaymentTermsDays } from '@/lib/due-date'
import type { Invoice, InvoicePayment } from '../finance'
import { resolveBillProductId } from '@/lib/purchase/bill-product-id'
import { invoiceErrorMessage, createdInvoiceId } from '@/lib/invoice-persist'
import { invoiceDocState, invoiceResidual } from '@/lib/odoo-sales-flow'
import { liveQtyBilledByPoLine, allocatePurchaseReturn } from '@/lib/purchase/return-allocation'
import { buildVendorCreditJournal } from '../journals'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** purchasing actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createPurchasingActions(store: StoreDeps): Pick<AppState, 'createPO' | 'updatePO' | 'addPOLine' | 'removePOLine' | 'updatePOLine' | 'bulkAddPOLines' | 'sendPO' | 'revertPOToDraft' | 'confirmPO' | 'createReceiptFromPO' | 'validateReceipt' | 'deletePO' | 'createBillFromPO' | 'createPurchaseReturn' | 'addReturnLine' | 'confirmPurchaseReturn' | 'logReturnPickup'> {
  return {
    // ── Purchase Orders ───────────────────────────────────────────────────────
    createPO: async (vendorId, vendorName, initial = {}, forcedRef) => {
        if (!canManageProcurement(store.currentUser())) {
          store.showToast('Only Inventory or Admin can create Purchase Orders', 'error'); return {} as PurchaseOrder;
        }
        const initialLines = initial.lines ?? []
        const poRefAllocated = forcedRef ?? await store.storeCtxRef.current!.allocateDocRef('PO')
        const po: PurchaseOrder = {
          id: uid(), ref: poRefAllocated, status: 'draft', vendorId, vendorName,
          date: now(), expectedDate: initial.expectedDate ?? store.addDays(now(), 7),
          approvalStatus: 'not_required', approvalRequestIds: [],
          lines: initialLines, ...store.calcPO(initialLines), notes: initial.notes ?? '', receiptIds: [],
          // Repair link: receiving the order on a GRN resumes the repair.
          ...(initial.repairId ? { repairId: initial.repairId, repairRef: initial.repairRef, procurementRequestId: initial.procurementRequestId } : {}),
          ...(initial.refurbJobId ? { refurbJobId: initial.refurbJobId, refurbJobRef: initial.refurbJobRef, refurbPartId: initial.refurbPartId } : {}),
        }
        store.setPurchaseOrders(p => [po, ...p]); store.addAuditLog('create_po', po.ref, `Draft purchase order created for vendor ${vendorName}`)
        store.showToast(`${po.ref} created`);
        sync('/api/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(po) })
        return po
      },

    updatePO: (id, p) => store.setPurchaseOrders(prev => {
        const next = prev.map(po => po.id === id ? { ...po, ...p } : po)
        const updated = next.find(po => po.id === id)
        if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
        return next
      }),

    addPOLine: (poId, product, qty, unitPrice, taxRate) => {
        const catCfg = CATEGORY_CONFIG[product.category as CategoryId] ?? { serialRequired: false }
        const effectiveTaxRate = taxRate !== undefined ? taxRate : product.taxRate
        store.setPurchaseOrders(p => {
          const next = p.map(po => {
            if (po.id !== poId) return po
            const line: POLine = { id: uid(), productId: product.id, productName: product.name, qty, qtyReceived: 0, unitPrice, taxRate: effectiveTaxRate, subtotal: qty * unitPrice, requiresSerial: catCfg.serialRequired, accountCode: resolveProductAccounts(product).costAccountCode }
            const lines = [...po.lines, line]
            return { ...po, lines, ...store.calcPO(lines) }
          })
          const updated = next.find(po => po.id === poId)
          if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      },

    removePOLine: (poId, lineId) => {
        store.setPurchaseOrders(p => {
          const next = p.map(po => { if (po.id !== poId) return po; const lines = po.lines.filter(l => l.id !== lineId); return { ...po, lines, ...store.calcPO(lines) } })
          const updated = next.find(po => po.id === poId)
          if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      },

    updatePOLine: (poId, lineId, updates) => {
        store.setPurchaseOrders(p => {
          const next = p.map(po => {
            if (po.id !== poId) return po
            const lines = po.lines.map(l => {
              if (l.id !== lineId) return l
              const qty       = updates.qty       !== undefined ? updates.qty       : l.qty
              const unitPrice = updates.unitPrice !== undefined ? updates.unitPrice : l.unitPrice
              const taxRate   = updates.taxRate   !== undefined ? updates.taxRate   : l.taxRate
              return { ...l, ...updates, qty, unitPrice, taxRate, subtotal: qty * unitPrice }
            })
            return { ...po, lines, ...store.calcPO(lines) }
          })
          const updated = next.find(po => po.id === poId)
          if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      },

    bulkAddPOLines: (poId, rows) => {
        store.setPurchaseOrders(p => {
          const next = p.map(po => {
            if (po.id !== poId) return po
            const newLines: POLine[] = rows.map(r => ({
              id: uid(), productId: r.productId, productName: r.productName,
              qty: r.qty, qtyReceived: 0, unitPrice: r.unitPrice, taxRate: r.taxRate,
              subtotal: r.qty * r.unitPrice, requiresSerial: r.requiresSerial,
              importedSerials: r.importedSerials?.length ? r.importedSerials : undefined,
              specs: r.specs || undefined,
              accountCode: r.accountCode,
            }))
            const lines = [...po.lines, ...newLines]
            return { ...po, lines, ...store.calcPO(lines) }
          })
          const updated = next.find(po => po.id === poId)
          if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
      },

    sendPO: (id) => {
        const po = store.poRef.current.find(p => p.id === id)
        if (!po) return
        
        store.setPurchaseOrders(p => {
          const next = p.map(po => po.id === id ? { ...po, status: 'sent' as const } : po)
          const updated = next.find(po => po.id === id)
          if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        store.addAuditLog('send_po', po.ref, `PO sent to vendor ${po.vendorName}`)
        store.showToast('PO sent to vendor')
      },

    revertPOToDraft: (id) => {
        const po = store.poRef.current.find(p => p.id === id)
        if (!po || !['draft', 'sent'].includes(po.status)) return
        store.setPurchaseOrders(p => {
          const next = p.map(po => po.id === id ? { ...po, status: 'draft' as const } : po)
          const updated = next.find(po => po.id === id)
          if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        store.showToast('PO reverted to draft')
      },

    confirmPO: async (id) => {
        const user = store.currentUser()
        if (!canManageProcurement(user)) {
          store.showToast('Only Inventory or Admin can confirm Purchase Orders', 'error'); return;
        }
        const po = store.poRef.current.find(p => p.id === id)
        if (!po) return
        // A double click (or a second tab) confirmed twice and opened a second
        // goods receipt for the same order.
        if (!['draft', 'sent'].includes(po.status)) {
          store.showToast(`${po.ref} is already confirmed`, 'info'); return
        }
        if (store.confirmingPoRef.current.has(id)) return
        if (!po.lines.length) { store.showToast('Add at least one line before confirming', 'error'); return }
        store.confirmingPoRef.current.add(id)
        try {
        if (store.recRef.current.some(r => r.poId === id && r.status === 'draft')) {
          store.setPurchaseOrders(p => {
            const next = p.map(row => row.id === id ? { ...row, status: 'confirmed' as const, approvalStatus: 'not_required' as const } : row)
            const updated = next.find(row => row.id === id)
            if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return next
          })
          store.showToast('Order confirmed · its goods receipt is ready')
          return
        }
  
        // Auto-create incoming shipment (receipt) when PO is confirmed — Odoo behaviour
        const receiptRef = await store.storeCtxRef.current!.allocateDocRef('REC')
        const receipt: Receipt = {
          id: uid(), ref: receiptRef, poId: id, poRef: po.ref,
          vendorId: po.vendorId, vendorName: po.vendorName,
          status: 'draft', date: now(),
          lines: po.lines.filter(l => l.qty - l.qtyReceived > 0).map(l => ({
            productId: l.productId, productName: l.productName, poLineId: l.id,
            qtyExpected: l.qty - l.qtyReceived, qtyReceived: 0, serials: [],
            requiresSerial: l.requiresSerial,
            importedSerials: l.importedSerials,
            specs: l.specs,
          })),
          destinationLocation: 'warehouse',
        }
        store.setReceipts(p => [receipt, ...p])
        sync('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) })
        store.setPurchaseOrders(p => {
          const next = p.map(row => row.id === id
            ? { ...row, status: 'confirmed' as const, approvalStatus: 'not_required' as const }
            : row)
          const updated = next.find(row => row.id === id)
          if (updated) sync(`/api/purchase-orders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        store.addAuditLog('confirm_po', po.ref, `PO confirmed — receipt ${receipt.ref} created automatically`)
        store.showToast(`Order confirmed · Receipt ${receipt.ref} ready for goods receiving`)
        } finally {
          store.confirmingPoRef.current.delete(id)
        }
      },

    createReceiptFromPO: async (poId, forcedRef) => {
        const po = store.poRef.current.find(p => p.id === poId)!
        const outstandingLines = po.lines.filter(l => l.qtyReceived < l.qty)
        if (outstandingLines.length === 0) {
          store.showToast('All ordered quantities have already been received', 'info')
          return store.recRef.current.find(r => r.poId === poId && r.status === 'draft') ?? null
        }
        const receipt: Receipt = {
          id: uid(),
          ref: forcedRef ?? await store.storeCtxRef.current!.allocateDocRef('REC'),
          poId, poRef: po.ref,
          vendorId: po.vendorId, vendorName: po.vendorName,
          status: 'draft', date: now(),
          lines: outstandingLines.map(l => ({
            productId: l.productId, productName: l.productName, poLineId: l.id,
            qtyExpected: l.qty - l.qtyReceived, qtyReceived: 0, serials: [],
            requiresSerial: l.requiresSerial,
            importedSerials: l.importedSerials,
            specs: l.specs,
          })),
          destinationLocation: 'warehouse',
        }
        store.setReceipts(p => [receipt, ...p])
        sync('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) })
        store.showToast(`Receipt ${receipt.ref} created`); 
        return receipt
      },

    validateReceipt: async (receiptId, lines, destination, serialAccessories, serialAccessoryNotes, serialSpecs, serialIssues) => {
        if (!canValidatePurchaseReceiptAction(store.currentUser())) {
          store.showToast('Only Director, Admin Officer, or Inventory Officer can validate GRNs', 'error'); return false
        }
        const receipt = store.recRef.current.find(r => r.id === receiptId)
        if (!receipt) {
          store.showToast('Receipt no longer exists. Refresh the list and try again.', 'error')
          return false
        }
        if (receipt.status !== 'draft') {
          store.showToast(`${receipt.ref} has already been validated`, 'info')
          return false
        }
        const po = store.poRef.current.find(p => p.id === receipt.poId)
        if (!po) {
          store.showToast('Linked purchase order was not found. Refresh and try again.', 'error')
          return false
        }
        // Validate: serialized products need all serial numbers
        for (const line of lines) {
          if (line.requiresSerial && line.serials.length < line.qtyReceived) {
            store.showToast(`Enter all serial numbers for ${line.productName} (${line.serials.length}/${line.qtyReceived})`, 'error'); return false
          }
          for (const s of line.serials) {
            if (store.serialRef.current.find(x => x.serial === s)) {
              store.showToast(`Serial ${s} already exists in system`, 'error'); return false
            }
          }
        }
        // The same serial typed twice on this receipt would become two machines.
        const typed = lines.flatMap(l => l.serials.map(sn => sn.trim().toUpperCase())).filter(Boolean)
        const twice = typed.find((sn, i) => typed.indexOf(sn) !== i)
        if (twice) { store.showToast(`Serial ${twice} is entered twice on this receipt`, 'error'); return false }
  
        // Received units fill the PO lines in order (the same product can be on
        // several lines); more than the order still has open is refused.
        const allocation = allocateReceiptToPoLines(po.lines, lines)
        if (allocation.overReceived.length) {
          const extra = allocation.overReceived
            .map(o => `${lines.find(l => l.productId === o.productId)?.productName ?? 'item'} (+${o.qty})`).join(', ')
          store.showToast(`More received than ${po.ref} still has open: ${extra}. Add the extra to the purchase order first.`, 'error')
          return false
        }
        const updatedPoLines = allocation.lines
        const allReceived = updatedPoLines.every(line => line.qtyReceived >= line.qty)
        const anyReceived = updatedPoLines.some(line => line.qtyReceived > 0)
        const hasOtherDraftReceipt = store.recRef.current.some(r => r.poId === receipt.poId && r.status === 'draft' && r.id !== receiptId)
        const followUpLines = updatedPoLines
          .filter(line => line.qtyReceived < line.qty)
          .map(line => ({
            productId: line.productId,
            productName: line.productName,
            poLineId: line.id,
            qtyExpected: line.qty - line.qtyReceived,
            qtyReceived: 0,
            serials: [] as string[],
            requiresSerial: line.requiresSerial,
            importedSerials: line.importedSerials?.slice(line.qtyReceived),
            specs: line.specs,
          }))
        const followUpRef = (!allReceived && anyReceived && !hasOtherDraftReceipt && followUpLines.length > 0)
          ? await store.storeCtxRef.current!.allocateDocRef('REC')
          : null
        const followUpReceipt: Receipt | null = followUpRef
          ? {
              id: uid(), ref: followUpRef, poId: receipt.poId, poRef: receipt.poRef,
              vendorId: receipt.vendorId, vendorName: receipt.vendorName,
              status: 'draft', date: now(),
              lines: followUpLines,
              destinationLocation: destination,
            }
          : null
  
        // Build rich serial rows, then apply authoritative server stock+serial mutation.
        const newSerials: SerialNumber[] = []
        const newRefurbJobs: RefurbishmentJob[] = []
        for (const line of lines) {
          if (!line.requiresSerial) continue
          for (const s of line.serials) {
            const issueDesc = serialIssues?.[s]?.trim() ?? ''
            const hasIssue = issueDesc.length > 0
            const newSerial: SerialNumber = {
              id: uid(), serial: s, productId: line.productId, productName: line.productName,
              // A device flagged on arrival goes to Refurbishment with its job —
              // the same place createRefurbishmentJob puts one. It used to stay in
              // 'warehouse' with status 'refurbishment', which no Warehouse tab
              // shows, so it vanished until a technician picked the job up.
              location: hasIssue ? 'repair_unit' : destination,
              status: hasIssue ? 'refurbishment' : 'available',
              purchaseOrderId: po.id,
              receiptId: receiptId,
              receivedDate: now(),
              barcode: store.buildInventoryBarcodeForProduct(line.productId, s),
              accessories: serialAccessories?.[s] ?? [],
              accessoryNotes: serialAccessoryNotes?.[s],
              specs: seedSerialSpecs({
                typedSpecs: serialSpecs?.[s],
                productName: line.productName,
                deviceConfig: store.prodRef.current.find(p => p.id === line.productId)?.deviceConfig,
              }),
            }
            newSerials.push(newSerial)
            if (hasIssue) {
              const intakeSpecs = seedSerialSpecs({
                typedSpecs: serialSpecs?.[s],
                productName: line.productName,
                deviceConfig: store.prodRef.current.find(p => p.id === line.productId)?.deviceConfig,
              })
              newRefurbJobs.push({
                id: uid(), ref: allocateDocNumberSync('REF'),
                status: 'queued',
                serialId: newSerial.id, serialNumber: s,
                productId: line.productId, productName: line.productName,
                specs: intakeSpecs,
                specsAtIntake: intakeSpecs || '',
                receiptId, receiptRef: receipt.ref,
                intakeDate: new Date().toISOString(),
                intakeIssueDescription: issueDesc,
                partsNeeded: [],
              })
            }
          }
        }
  
        try {
          const response = await fetch('/api/inventory/validate-receipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              applyStock: true,
              destination,
              receiptId,
              receiptRef: receipt.ref,
              purchaseOrderId: po.id,
              lines: lines.map(line => ({
                productId: line.productId,
                poLineId: line.poLineId,
                productName: line.productName,
                qtyReceived: Number(line.qtyReceived ?? 0),
                requiresSerial: Boolean(line.requiresSerial),
                serials: line.serials ?? [],
                serialRecords: newSerials.filter(s => s.productId === line.productId),
              })),
            }),
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null) as { errors?: string[]; error?: string } | null
            const message = payload?.errors?.[0] || payload?.error || 'Receipt validation failed'
            store.showToast(message, 'error')
            return false
          }
        } catch {
          store.showToast('Could not validate receipt on server', 'error')
          return false
        }
  
        // Server already wrote products/bulkStock/serials blobs — do not re-increment
        // local qty (that caused double stock on sync). Only append serial rows we
        // built for UI until the next store hydrate.
        if (newSerials.length > 0) store.setSerials(p => {
          // The server mutation already persisted these serial ids — after a
          // re-hydrate they are present locally too, and a blind append would
          // store the same serial twice.
          const have = new Set(p.map(s => s.id))
          const fresh = newSerials.filter(s => !have.has(s.id))
          return fresh.length ? [...p, ...fresh] : p
        })
        if (newRefurbJobs.length > 0) {
          store.setRefurbishmentJobs(p => [...p, ...newRefurbJobs])
          store.numberRefurbJobs(newRefurbJobs.map(j => j.id))
        }
  
        // Update receipt status
        store.setReceipts(p => {
          const next = p.map(r => r.id === receiptId ? { ...r, status: 'validated' as const, lines, destinationLocation: destination } : r)
          if (followUpReceipt) next.unshift(followUpReceipt)
          const updated = next.find(r => r.id === receiptId)
          if (updated) sync(`/api/receipts/${receiptId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          if (followUpReceipt) sync('/api/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(followUpReceipt) })
          return next
        })
  
        // Update PO quantities and status (receiptId already added in confirmPO)
        store.setPurchaseOrders(p => {
          const next = p.map(po => {
            if (po.id !== receipt.poId) return po
            const receiptIds = po.receiptIds.includes(receiptId) ? po.receiptIds : [...po.receiptIds, receiptId]
            const newReceiptIds = followUpReceipt && !receiptIds.includes(followUpReceipt.id) ? [...receiptIds, followUpReceipt.id] : receiptIds
            return { ...po, lines: updatedPoLines, status: allReceived ? 'received' as const : anyReceived ? 'partial' as const : po.status, receiptIds: newReceiptIds }
          })
          const updated = next.find(po => po.id === receipt.poId)
          if (updated) sync(`/api/purchase-orders/${receipt.poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        // Auto-resume repair if this PO was created from a procurement request
        if (po.repairId) {
          const linkedRepair = store.repairs.find(r => r.id === po.repairId)
          if (linkedRepair && linkedRepair.status === 'awaiting_parts') {
            // Mark procurement request as received
            store.setRepairs(prev => prev.map(r => r.id === po.repairId ? {
              ...r,
              procurementRequests: (r.procurementRequests ?? []).map(req =>
                req.id === po.procurementRequestId ? { ...req, status: 'received' as const } : req
              ),
            } : r))
            // Reserve parts into repair_unit and move repair back to approved
            const partLines = (linkedRepair.quote?.lines ?? []).filter(l => l.type === 'part' && l.productId)
            const grnReserve = planRepairPartReserve({
              repairRef: linkedRepair.ref,
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
            for (const step of grnReserve.steps) {
              if (step.kind === 'assign_serial') {
                store.setSerials(p => p.map(s => s.id === step.serialId
                  ? { ...s, status: 'assigned' as const, repairId: po.repairId, location: 'repair_unit' as LocationId }
                  : s))
                store.addMove(step.productId, step.productName, 1, 'transfer', step.reason, linkedRepair.ref, step.from, 'repair_unit', [step.serialNumber])
              } else {
                store.setBulkStock(prev => {
                  let next = store.upsertBulkStock(prev, step.productId, step.from, -step.qty)
                  next = store.upsertBulkStock(next, step.productId, step.to, step.qty)
                  return next
                })
                store.addMove(step.productId, step.productName, step.qty, 'transfer', step.reason, linkedRepair.ref, step.from, step.to, [])
              }
            }
            const updatedQuoteLines = (linkedRepair.quote?.lines ?? []).map(l => ({
              ...l, reserved: l.type === 'part' ? true : l.reserved,
            }))
            const partsUsedNow = partLines.map(line => ({
              productId: line.productId ?? '', productName: line.productName ?? line.description,
              qty: line.qty, price: line.unitPrice, reservedDate: now(),
            }))
            store.setRepairs(prev => prev.map(r => r.id === po.repairId ? {
              ...r,
              status: 'approved',
              quote: r.quote ? { ...r.quote, lines: updatedQuoteLines } : r.quote,
              partsUsed: partsUsedNow,
              procurementRequests: (r.procurementRequests ?? []).map(req =>
                req.status === 'pending' || req.status === 'ordered' ? { ...req, status: 'received' as const } : req
              ),
            } : r))
            if (linkedRepair.assignedTechnicianId) {
              store.notifyUsers({
                recipients: [linkedRepair.assignedTechnicianId],
                type: 'repair',
                title: `Parts arrived — ${linkedRepair.ref} ready to start`,
                body: `${linkedRepair.productName} · Parts received via ${receipt.ref}`,
                module: 'repair', path: `?id=${linkedRepair.id}`, icon: '📦',
                entityKey: `repair:${linkedRepair.id}:parts_arrived`,
                excludeUserId: store.currentUserId,
              })
            }
            store.syncRepairToPortal({ ...linkedRepair, status: 'approved' }, 'Parts arrived — repair resuming')
            store.addAuditLog('parts_arrived', po.repairId, `Auto-resumed via GRN ${receipt.ref} (PO ${po.ref})`)
            store.showToast(`Stock received · Repair ${linkedRepair.ref} auto-resumed — technician notified`)
          } else {
            store.showToast(`Stock received · use "Create Bill" to generate the vendor invoice`)
          }
        } else if (po.refurbPartId) {
          // A refurbishment part: the server marks it received and tells the
          // technician (this screen does not load refurbishment jobs).
          store.showToast(`Stock received · ${po.refurbJobRef ?? 'refurbishment job'} — technician told the part is in`)
          void fetch('/api/refurbishment/parts-received', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poId: po.id, receiptRef: receipt.ref }),
          }).then(res => res.ok ? res.json() : null).then((data: { job?: RefurbishmentJob } | null) => {
            const job = data?.job
            // Where jobs are loaded, show the change at once.
            if (job) store.setRefurbishmentJobs(prev => prev.some(j => j.id === job.id) ? prev.map(j => j.id === job.id ? job : j) : prev)
          }).catch(() => {})
        } else {
          store.showToast(followUpReceipt ? `Stock received · ${followUpReceipt.ref} created for remaining items` : `Stock received · use "Create Bill" to generate the vendor invoice`)
        }
        store.addAuditLog('validate_receipt', receipt.ref, `Stock received from ${receipt.vendorName}`)
        return true
      },

    deletePO: (id) => {
        const po = store.poRef.current.find(p => p.id === id)
        if (!po) return
        // The server refuses these; the list used to drop them anyway and say
        // "PO deleted", until the next reload brought them back.
        if (['partial', 'received'].includes(po.status) || po.lines.some(l => (l.qtyReceived ?? 0) > 0 || (l.qtyBilled ?? 0) > 0)) {
          store.showToast(`${po.ref} has received or billed goods — it cannot be deleted`, 'error'); return
        }
        store.setPurchaseOrders(p => p.filter(row => row.id !== id))
        sync(`/api/purchase-orders/${id}`, { method: 'DELETE' })
        store.showToast('PO deleted')
      },

    createBillFromPO: async (poId, lineOverrides) => {
        if (!canManageFinance(store.currentUser())) {
          store.showToast('Only Finance or Admin Officer can create vendor bills', 'error'); return null;
        }
        const po = store.poRef.current.find(p => p.id === poId)
        if (!po) return null
        // Three-way match keys off PO qtyReceived. A missing blob GRN with
        // status === 'validated' used to block Create Bill even when the modal
        // already showed "Up to N billable now" from Prisma-hydrated receipts.
        if (!poHasReceivedGoods(po.lines)) {
          store.showToast('Receive goods before creating a vendor bill', 'error'); return null
        }
  
        const overrideMap = lineOverrides
          ? new Map(lineOverrides.map(o => [o.lineId, Math.max(0, Math.floor(Number(o.qty) || 0))]))
          : null
  
        // Treat live vendor bills as the source of truth. The PO list is loaded
        // from Prisma without the legacy billId, and old deleted draft bills can
        // leave qtyBilled behind. Using active invoices here restores the correct
        // Create Bill action while still preventing duplicate billing.
        const liveBillsForPO = store.invRef.current.filter(inv => {
          const belongsToPO = inv.purchaseOrderId === po.id || inv.id === po.billId
          const isLive = !['cancelled', 'voided', 'void'].includes(String(inv.status))
          return inv.type === 'vendor_bill' && belongsToPO && isLive
        })
        const billedByLine = billedQtyByPoLine(po.lines, liveBillsForPO.flatMap(bill => bill.lines))
        const activeBilledQty = (line: POLine) => billedByLine.get(line.id) ?? 0
  
        let billableLines: Array<POLine & { billQty: number }>
        try {
          billableLines = po.lines
            .map(l => {
              const reconciledLine = { ...l, qtyBilled: activeBilledQty(l) }
              const maxBillable = billableQty(reconciledLine)
              const billQty = overrideMap ? Math.min(maxBillable, overrideMap.get(l.id) ?? 0) : maxBillable
              assertBillableQty(reconciledLine, billQty)
              return { ...reconciledLine, billQty }
            })
            .filter(l => l.billQty > 0)
        } catch (err) {
          store.showToast(err instanceof Error ? err.message : 'Three-way match failed', 'error')
          return null
        }
  
        if (billableLines.length === 0) {
          store.showToast('No received quantity left to bill on this purchase order', 'error')
          return null
        }
  
        const sub = billableLines.reduce((a, l) => a + l.billQty * l.unitPrice, 0)
        const tax = billableLines.reduce((a, l) => a + Math.round(l.billQty * l.unitPrice * l.taxRate / 100), 0)
        // Vendor's own payment terms govern the bill due date — previously
        // hardcoded to 30 days for every vendor regardless of what was agreed.
        const vendor = store.contacts.find(c => c.id === po.vendorId)
        const termsDays = contactPaymentTermsDays(vendor, store.systemSettings.purDefaultPaymentTermsDays ?? 30)
        const bill: Invoice = {
          id: uid(), ref: store.draftInvoiceRef('vendor_bill'), type: 'vendor_bill', status: 'draft',
          partnerId: po.vendorId, partnerName: po.vendorName,
          date: now(), dueDate: store.addDays(now(), termsDays),
          lines: billableLines.map(l => ({
            id: uid(), description: `${l.productName} ×${l.billQty}`, qty: l.billQty,
            unitPrice: l.unitPrice, taxRate: l.taxRate, subtotal: l.billQty * l.unitPrice,
            productId: resolveBillProductId(l, store.prodRef.current),
            purchaseOrderItemId: l.id,
            taxCategory: Number(l.taxRate) > 0 ? 'standard_16' : 'out_of_scope',
          })),
          subtotal: sub, taxTotal: tax, total: sub + tax, amountPaid: 0,
          purchaseOrderId: po.id, notes: '',
        }
        // Await Prisma create. A fire-and-forget POST left a "Linked" draft in
        // the UI whose Confirm then 404ed "Not found".
        try {
          const res = await fetch('/api/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bill),
          })
          const payload = await res.json().catch(() => null)
          if (!res.ok) {
            store.showToast(invoiceErrorMessage(payload, 'Could not create vendor bill'), 'error')
            return null
          }
          bill.id = createdInvoiceId(payload, bill.id)
        } catch {
          store.showToast('Could not create vendor bill', 'error')
          return null
        }
        store.setInvoices(p => [bill, ...p])
        store.setPurchaseOrders(p => {
          const next = p.map(x => {
            if (x.id !== poId) return x
            const lines = x.lines.map(line => {
              const match = billableLines.find(b => b.id === line.id)
              if (!match) return line
              return { ...line, qtyBilled: (match.qtyBilled ?? 0) + match.billQty }
            })
            // Keep billId as latest bill for UI deep-link; further bills allowed via billable qty.
            return { ...x, billId: bill.id, lines }
          })
          const updated = next.find(x => x.id === poId)
          if (updated) sync(`/api/purchase-orders/${poId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return next
        })
        store.addAuditLog('create_bill', bill.ref, `Vendor bill created from PO ${po.ref} (3-way match)`)
        store.showToast(`Bill draft created · confirm to post liability`)
        return bill
      },

    // ── Purchase Returns ───────────────────────────────────────────────────────
    // Return-to-Vendor deducts stock and (usually) generates a real credit note
    // against a posted bill — same class of action as confirming a PO, so it
    // needs the same role gate. Previously unrestricted: any logged-in user
    // could trigger it.
    createPurchaseReturn: (receiptId, reason) => {
        if (!canManageProcurement(store.currentUser())) {
          store.showToast('Only Inventory or Admin can create a Return to Vendor', 'error'); return null
        }
        const receipt = store.recRef.current.find(r => r.id === receiptId)!
        const po = store.poRef.current.find(p => p.id === receipt.poId)!
        const ret: PurchaseReturn = {
          // Provisional; the server's RET/NNNN replaces it a moment later. It
          // used to come from this browser's own counter (duplicates).
          id: uid(), ref: allocateDocNumberSync('RET'), poId: po.id, poRef: po.ref,
          receiptId, receiptRef: receipt.ref, vendorId: po.vendorId, vendorName: po.vendorName,
          status: 'draft', date: now(), reason, lines: [],
        }
        store.purchaseReturnsRef.current = [ret, ...store.purchaseReturnsRef.current]
        store.setPurchaseReturns(p => [ret, ...p])
        const provisional = ret.ref
        void store.storeCtxRef.current?.allocateDocRef('RET').then(finalRef => {
          if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
          store.purchaseReturnsRef.current = store.purchaseReturnsRef.current.map(r => (r.ref === provisional ? { ...r, ref: finalRef } : r))
          store.setPurchaseReturns(p => p.map(r => (r.ref === provisional ? { ...r, ref: finalRef } : r)))
        }).catch(() => { /* the temporary number stays; it is unique */ })
        store.showToast('Return to vendor created'); return ret
      },

    addReturnLine: (returnId, productId, productName, qty, serialIds, requiresSerial) => {
        if (!canManageProcurement(store.currentUser())) {
          store.showToast('Only Inventory or Admin can edit a Return to Vendor', 'error'); return
        }
        const line = { productId, productName, qty, serialIds, requiresSerial }
        store.purchaseReturnsRef.current = store.purchaseReturnsRef.current.map(r => r.id !== returnId ? r : { ...r, lines: [...r.lines, line] })
        store.setPurchaseReturns(p => p.map(r => r.id !== returnId ? r : { ...r, lines: [...r.lines, line] }))
      },

    confirmPurchaseReturn: async (returnId) => {
        if (!canManageProcurement(store.currentUser())) {
          store.showToast('Only Inventory or Admin can confirm a Return to Vendor', 'error'); return false
        }
        const ret = store.purchaseReturnsRef.current.find(r => r.id === returnId)
        if (!ret) { store.showToast('Return not found', 'error'); return false }
        if (ret.status === 'confirmed') { store.showToast(`${ret.ref} is already confirmed`, 'info'); return false }
        if (ret.lines.length === 0) { store.showToast('Add at least one return line before confirming', 'error'); return false }
        const po = store.poRef.current.find(p => p.id === ret.poId)
        if (!po) { store.showToast('Linked purchase order not found', 'error'); return false }
  
        // Decide what each returned unit does to the money trail: wind back
        // unbilled received qty, shrink draft bills, and only credit quantities
        // that were billed on a POSTED bill. VAT mirrors each PO line's tax rate
        // (zero unless the line was bought with VAT).
        const draftBills = store.invRef.current.filter(i =>
          i.type === 'vendor_bill' && i.purchaseOrderId === po.id && invoiceDocState(i.status) === 'draft' && i.total > 0,
        )
        // Billed means billed on a bill still in force: a cancelled bill must
        // not turn the return into a supplier credit.
        const liveBilled = liveQtyBilledByPoLine(po, store.invRef.current)
        const allocation = allocatePurchaseReturn({
          poLines: po.lines.map(l => ({
            id: l.id, productId: l.productId, productName: l.productName,
            qtyReceived: l.qtyReceived, qtyBilled: liveBilled.get(l.id) ?? 0,
            unitPrice: l.unitPrice, taxRate: l.taxRate, accountCode: l.accountCode,
          })),
          returnLines: ret.lines.map(l => ({ productId: l.productId, productName: l.productName, qty: l.qty })),
          draftBills: draftBills.map(b => ({ id: b.id, lines: b.lines.map(x => ({ id: x.id, productId: x.productId, qty: x.qty })) })),
        })
        // Authoritative stock + valuation (GRNI restore) on the server.
        try {
          const stockRes = await fetch('/api/inventory/apply-vendor-return-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              returnRef: ret.ref,
              reason: ret.reason,
              lines: ret.lines.map(l => ({
                productId: l.productId,
                productName: l.productName,
                qty: l.qty,
                serialIds: l.serialIds,
                requiresSerial: l.requiresSerial,
              })),
              po: { id: po.id, lines: allocation.poLineAdjustments },
            }),
          })
          if (!stockRes.ok) {
            const payload = await stockRes.json().catch(() => null) as { error?: string } | null
            store.showToast(payload?.error || 'Could not apply return stock on server', 'error')
            return false
          }
        } catch {
          store.showToast('Could not reach server to apply return stock', 'error')
          return false
        }
        // Optimistic serial status for UI until hydrate.
        ret.lines.forEach(l => {
          if (l.requiresSerial) {
            l.serialIds.forEach(sid => store.setSerials(p => p.map(s => s.id === sid ? { ...s, status: 'returned', location: 'vendor' } : s)))
          }
        })
  
        // Wind back the PO's received/billed counters so three-way match stays true.
        if (allocation.poLineAdjustments.length > 0) {
          store.setPurchaseOrders(p => {
            const next = p.map(x => {
              if (x.id !== po.id) return x
              const lines = x.lines.map(line => {
                const adj = allocation.poLineAdjustments.find(a => a.poLineId === line.id)
                if (!adj) return line
                return { ...line, qtyReceived: adj.qtyReceived, qtyBilled: adj.qtyBilled }
              })
              // Returned goods reopen the receiving step (vendor may re-supply).
              const nothingLeft = lines.every(l => (Number(l.qtyReceived) || 0) <= 0)
              const status = (x.status === 'received' || x.status === 'partial')
                ? (nothingLeft ? 'confirmed' as const : lines.some(l => l.qtyReceived < l.qty) ? 'partial' as const : x.status)
                : x.status
              return { ...x, lines, status }
            })
            const updated = next.find(x => x.id === po.id)
            if (updated) sync(`/api/purchase-orders/${po.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
            return next
          })
        }
        // Vendor credit note for the posted-billed portion only.
        // A number from the server: two browsers' own counters issued the same
        // VCN, and the second credit note was then refused after the goods had
        // already gone back.
        const creditRef = allocation.creditTotal > 0 ? await store.storeCtxRef.current!.allocateDocRef('VCN') : ''
        const creditNote: Invoice | null = allocation.creditTotal > 0 ? {
          id: uid(), ref: creditRef, type: 'vendor_bill', status: 'posted',
          partnerId: ret.vendorId, partnerName: ret.vendorName,
          date: now(), dueDate: now(), postedAt: now(),
          lines: allocation.creditLines.map(l => ({
            id: uid(), description: `RETURN: ${l.productName} ×${l.qty}`, qty: l.qty,
            unitPrice: -l.unitPrice, taxRate: l.taxRate, subtotal: -l.subtotal,
            productId: l.productId, accountCode: l.accountCode,
          })),
          subtotal: -allocation.creditSubtotal, taxTotal: -allocation.creditTaxTotal, total: -allocation.creditTotal,
          amountPaid: 0,
          purchaseOrderId: ret.poId, notes: `Purchase return ${ret.ref}`,
        } : null
        // Apply the credit against the PO's open posted bills, oldest first, so
        // the outstanding balance actually drops.
        const applications: Array<{ billId: string; billRef: string; amount: number }> = []
        if (creditNote) {
          let remaining = allocation.creditTotal
          const openBills = store.invRef.current
            .filter(i => i.type === 'vendor_bill' && i.purchaseOrderId === po.id && invoiceDocState(i.status) === 'posted' && i.total > 0 && invoiceResidual(i) > 0)
            .sort((a, b) => a.date.localeCompare(b.date))
          for (const bill of openBills) {
            if (remaining <= 0) break
            const applied = Math.min(remaining, invoiceResidual(bill))
            if (applied <= 0) continue
            applications.push({ billId: bill.id, billRef: bill.ref, amount: applied })
            remaining -= applied
          }
        }
        const appliedTotal = applications.reduce((s, a) => s + a.amount, 0)
  
        // The credit note is a negative-total document — POST it (isCreditNote
        // opts it out of the standard non-negative money clamps server-side,
        // see app/api/invoices/route.ts) and actually check the response before
        // telling the user it was created. Stock/serials/PO counters above are
        // already committed (the physical return happened); a failed credit
        // note here means the paperwork needs Finance's attention, but must
        // never be reported as done when it silently wasn't.
        if (creditNote) {
          // Created unused; each use on a bill is then recorded by the server
          // (supplier-credit apply), which updates the bill and the credit
          // together. Setting the bill's paid amount from here never reached
          // the server: the invoice update route ignores paid amounts.
          const finalCreditPreview: Invoice = { ...creditNote, amountPaid: 0 }
          try {
            const res = await fetch('/api/invoices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...finalCreditPreview, isCreditNote: true }),
            })
            if (res.ok) {
              const created = await res.json().catch(() => null) as { id?: string } | null
              const serverCreditId = created?.id || creditNote.id
              const failed: string[] = []
              for (const a of applications) {
                const applied = await fetch(`/api/invoices/${serverCreditId}/supplier-credit`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'apply', billId: a.billId, amount: a.amount }),
                }).then(r => r.ok).catch(() => false)
                if (!applied) failed.push(a.billRef)
              }
              if (failed.length) {
                store.showToast(`Credit ${creditNote.ref} was created but could not be used on ${failed.join(', ')} — use it from Finance → Supplier credits`, 'error')
              }
            }
            if (!res.ok) {
              const payload = await res.json().catch(() => null)
              store.showToast(
                `Return items were processed, but the credit note failed to save (${payload?.error ?? res.status}) — ${ret.ref} needs Finance to record it manually`,
                'error',
              )
              return false
            }
          } catch {
            store.showToast(
              `Return items were processed, but could not reach the server to save the credit note — ${ret.ref} needs Finance to record it manually`,
              'error',
            )
            return false
          }
        }
        const draftDeductionsByBill = new Map<string, typeof allocation.draftBillDeductions>()
        allocation.draftBillDeductions.forEach(d => {
          draftDeductionsByBill.set(d.billId, [...(draftDeductionsByBill.get(d.billId) ?? []), d])
        })
        const actor = store.currentUser()
        store.setInvoices(p => {
          let next = p.map(i => {
            const deductions = draftDeductionsByBill.get(i.id)
            const application = applications.find(a => a.billId === i.id)
            if (!deductions && !application) return i
            let inv = i
            if (deductions) {
              const lines = inv.lines
                .map(line => {
                  const deduct = deductions.filter(x => x.lineId === line.id).reduce((s, x) => s + x.deductQty, 0)
                  if (deduct <= 0) return line
                  const qty = Math.max(0, line.qty - deduct)
                  return { ...line, qty, subtotal: qty * line.unitPrice, description: line.description.replace(/×\d+$/, `×${qty}`) }
                })
                .filter(line => line.lineType === 'section' || line.qty > 0)
              const subtotal = lines.reduce((s, l) => s + (l.lineType === 'section' ? 0 : l.subtotal), 0)
              const taxTotal = lines.reduce((s, l) => s + (l.lineType === 'section' ? 0 : Math.round(l.subtotal * l.taxRate / 100)), 0)
              // A draft bill whose every unit was returned has nothing left to post.
              const emptied = !lines.some(l => l.lineType !== 'section' && l.qty > 0)
              inv = {
                ...inv, lines, subtotal, taxTotal, total: subtotal + taxTotal,
                status: emptied ? 'cancelled' : inv.status,
                notes: `${inv.notes || ''}\n${emptied ? `Cancelled — all quantities returned via ${ret.ref}` : `Reduced by purchase return ${ret.ref}`}`.trim(),
              }
            }
            if (application) {
              const payment: InvoicePayment = {
                id: uid(), date: new Date().toISOString(), amount: application.amount,
                method: 'vendor_credit', reference: creditNote!.ref,
                recordedBy: actor?.name ?? 'System',
              }
              inv = {
                ...inv,
                amountPaid: inv.amountPaid + application.amount,
                payments: [...(inv.payments || []), payment],
                notes: `${inv.notes || ''}\nCredit ${creditNote!.ref} applied: ${store.fmtKes(application.amount)} (return ${ret.ref})`.trim(),
              }
            }
            // Draft bills changed by the return are saved here; a credit's use on
            // a confirmed bill was already recorded by the server above.
            if (deductions) sync(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv) })
            return inv
          })
          if (creditNote) {
            // Already POSTed and confirmed successful above — negative
            // amountPaid mirrors the applied portion so the credit note's own
            // residual nets to the unapplied remainder.
            const finalCredit: Invoice = {
              ...creditNote,
              amountPaid: -appliedTotal,
              notes: applications.length
                ? `${creditNote.notes}\nApplied to ${applications.map(a => a.billRef).join(', ')}`
                : creditNote.notes,
            }
            next = [finalCredit, ...next]
          }
          return next
        })
        if (creditNote) {
          const journal = buildVendorCreditJournal(
            creditNote,
            (productId) => store.prodRef.current.find(x => x.id === productId),
            store.accountRef.current.map(a => ({ code: a.code, name: a.name })),
            {
              perpetual: store.systemSettings.invAutomatedValuation !== false,
              poLines: po.lines.map(l => ({ productId: l.productId, unitPrice: l.unitPrice })),
            },
          )
          store.setJournalEntries(prev => (prev.some(j => j.ref === journal.ref) ? prev : [journal, ...prev]))
        }
        store.purchaseReturnsRef.current = store.purchaseReturnsRef.current.map(r => r.id === returnId ? { ...r, status: 'confirmed', creditNoteId: creditNote?.id } : r)
        store.setPurchaseReturns(p => p.map(r => r.id === returnId ? { ...r, status: 'confirmed', creditNoteId: creditNote?.id } : r))
        store.addAuditLog('confirm_purchase_return', ret.ref, creditNote
          ? `Return confirmed · credit ${creditNote.ref} for ${store.fmtKes(allocation.creditTotal)}${applications.length ? ` applied to ${applications.map(a => a.billRef).join(', ')}` : ''}`
          : 'Return confirmed · unbilled/draft quantities wound back, no credit needed')
        store.showToast(creditNote
          ? (applications.length
              ? `Return confirmed · credit ${creditNote.ref} applied to ${applications.map(a => a.billRef).join(', ')}`
              : `Return confirmed · credit note ${creditNote.ref} created`)
          : 'Return confirmed · billable quantities reduced, no credit note needed')
        return true
      },

    logReturnPickup: (returnId, collectedByUserId, collectedByName, collectedDate, pickupNotes) => {
        if (!canManageProcurement(store.currentUser())) {
          store.showToast('Only Inventory or Admin can log a return pickup', 'error'); return
        }
        store.setPurchaseReturns(p => p.map(r => r.id !== returnId ? r : { ...r, collectedByUserId, collectedByName, collectedDate, pickupNotes }))
        store.showToast('Pickup details saved')
      },
  }
}
