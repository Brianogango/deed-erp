from pathlib import Path
import re

store = Path('lib/store.tsx')
s = store.read_text()

old_state = '''      setRepairs(p => p.map(r => r.id === repairId ? {
        ...r,
        quote,
        laborCost: derivedLaborCost,
        logisticsCost: derivedLogisticsCost,
        total: chargeTotal,
        diagnosisFee: chargeFee ? resolvedFee.amount : (r.diagnosisFeeStatus === 'waived' ? 0 : r.diagnosisFee),
        diagnosisFeeStatus: chargeFee
          ? (r.diagnosisFeeStatus === 'paid' || r.diagnosisFeePaidAt ? 'paid' : 'applicable')
          : (isDirectRepairPath(r.repairPath) || isNoCharge ? 'not_applicable' : r.diagnosisFeeStatus),
        diagnosisFeeBilling: r.diagnosisFeeBilling ?? resolvedFee.billing,
        customerBillingType: r.customerBillingType ?? resolvedFee.customerType,
        deviceTier: resolvedFee.tier ?? r.deviceTier,
        status: quoteStatus,
        quoteApprovalDeadline: (isNoCharge || isDirectRepair) ? undefined : quote.validUntil,
        ...(linkedSaleOrderId ? { saleOrderId: linkedSaleOrderId, saleOrderRef: linkedSaleOrderRef } : {}),
        ...(salesQuoteId ? { salesQuoteId, salesQuoteRef } : {}),
        ...(invoiceIdToUpdate ? { invoiceId: invoiceIdToUpdate } : {}),
        // Clear reserved parts — they were unreserved above (Gap 3)
        ...(isUpdate ? {
          partsUsed: [],
          procurementRequests: (r.procurementRequests ?? []).map(req =>
            ['pending', 'ordered'].includes(req.status) ? { ...req, status: 'cancelled' as const } : req
          ),
        } : {}),
      } : r))'''
new_state = '''      const savedRepair: RepairOrder = {
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
        quoteApprovalDeadline: (isNoCharge || isDirectRepair) ? undefined : quote.validUntil,
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
      repairsRef.current = repairsRef.current.map(r => r.id === repairId ? savedRepair : r)
      setRepairs(p => p.map(r => r.id === repairId ? savedRepair : r))'''
if old_state not in s:
    raise SystemExit('quote state anchor missing')
s = s.replace(old_state, new_state, 1)

start_marker = "        // Create a quotation-status SO if one doesn't exist yet"
end_marker = '''        return
      }
      
      // Reserve parts — transfer bulk into repair_unit + assign serials'''
start = s.index(start_marker)
end = s.index(end_marker, start)
approval = '''        // Approval converts the repair quotation into the existing Sales Order.
        // Do not create an invoice while parts are still being sourced.
        let awaitingSoId = repair.saleOrderId ?? (repair as any).linkedSaleOrderId
        let awaitingSoRef = repair.saleOrderRef ?? (repair as any).linkedSaleOrderRef
        const linkedAwaitingSo = findSaleOrderForRepair(soRef.current, repair)
        awaitingSoId = linkedAwaitingSo?.id ?? awaitingSoId
        awaitingSoRef = linkedAwaitingSo?.ref ?? linkedAwaitingSo?.orderNumber ?? awaitingSoRef
        const approvedSoLines = repair.quote.lines.map(l => ({
          id: uid(),
          ...saleLineFieldsForRepairQuoteLine(l),
        }))
        if (!awaitingSoId) {
          awaitingSoId = uid()
          awaitingSoRef = await storeCtxRef.current!.allocateDocRef('SO')
          const awaitingSo: SaleOrder = {
            id: awaitingSoId, ref: awaitingSoRef, status: 'sale', confirmedAt: new Date().toISOString(),
            customerId: repair.customerId, customerName: repair.customerName,
            date: now(), validUntil: addDays(now(), 30),
            lines: approvedSoLines,
            subtotal: repair.quote.subtotal, taxTotal: repair.quote.tax, total: repair.quote.total,
            notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
            source: 'repair', repairId: repair.id, repairRef: repair.ref,
            createdByUserId: repair.createdBy,
          }
          setSaleOrders(p => [awaitingSo, ...p])
          sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(awaitingSo) })
        } else {
          const soPatch = {
            status: 'sale' as const,
            confirmedAt: linkedAwaitingSo?.confirmedAt ?? new Date().toISOString(),
            lines: approvedSoLines,
            subtotal: repair.quote.subtotal,
            taxAmount: repair.quote.tax,
            taxTotal: repair.quote.tax,
            totalAmount: repair.quote.total,
            total: repair.quote.total,
            notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
            source: 'repair', repairId: repair.id, repairRef: repair.ref,
          }
          setSaleOrders(p => p.map(order => order.id === awaitingSoId ? { ...order, ...soPatch } : order))
          sync(`/api/sale-orders/${awaitingSoId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(soPatch) })
        }

        const approvedRepair = {
          ...repair,
          status: 'awaiting_parts' as const,
          quote: { ...repair.quote, approvedDate: repair.quote.approvedDate ?? now(), approvedBy: repair.quote.approvedBy ?? 'customer' },
          saleOrderId: awaitingSoId,
          saleOrderRef: awaitingSoRef,
        }
        repairsRef.current = repairsRef.current.map(r => r.id === repairId ? approvedRepair : r)
        setRepairs(p => p.map(r => r.id === repairId ? approvedRepair : r))

        const approvedSalesQuote = findSalesQuoteForRepair(quotes, repair)
        if (approvedSalesQuote) {
          setQuotes(p => {
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
      
      // Reserve parts — transfer bulk into repair_unit + assign serials'''
s = s[:start] + approval + s[end + len(end_marker):]

pattern = re.compile(r'''      \} else if \(!invoice\) \{\n        const freshRepair = repairsRef\.current\.find\(r => r\.id === repairId\).*?        createdNew = true\n      \}''', re.S)
invoice_new = '''      } else if (!invoice) {
        const freshRepair = repairsRef.current.find(r => r.id === repairId)
        if (freshRepair?.invoiceId) {
          const raced = resolveExistingInvoice(freshRepair)
          if (raced && raced.status !== 'cancelled') {
            showToast('Invoice already exists for this repair', 'info')
            return raced
          }
        }
        if (!soId) {
          showToast('Repair Sales Order is missing — align the quote before invoicing', 'error')
          return null
        }
        const res = await fetch(`/api/sale-orders/${soId}/create-invoice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'regular', source: 'repair' }),
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload?.invoice) {
          showToast(payload?.error || 'Could not convert the Repair Sales Order to an invoice', 'error')
          return null
        }
        invoice = payload.invoice as Invoice
        invRef.current = [invoice, ...invRef.current.filter(inv => inv.id !== invoice!.id)]
        setInvoices(p => [invoice!, ...p.filter(inv => inv.id !== invoice!.id)])
        createdNew = true
      }'''
s, count = pattern.subn(invoice_new, s, count=1)
if count != 1:
    raise SystemExit(f'invoice creation anchor missing: {count}')
store.write_text(s)

route = Path('app/api/sale-orders/[id]/create-invoice/route.ts')
r = route.read_text()
old = '''    const blobRepairId = linkedRepair?.id ? String(linkedRepair.id) : undefined
    const priorDownPayments = sumUnappliedDownPayments('''
new = '''    const blobRepairId = linkedRepair?.id ? String(linkedRepair.id) : undefined
    const repairFulfillmentReady = !!linkedRepair && [
      'ready', 'invoiced', 'verified_released', 'delivered', 'collected', 'closed',
    ].includes(String((linkedRepair as any).status ?? '').toLowerCase())
    const priorDownPayments = sumUnappliedDownPayments('''
if old not in r:
    raise SystemExit('repair fulfillment anchor missing')
r = r.replace(old, new, 1)
old = '''    const policyForItem = (item: { productId?: string | null }): InvoicePolicy => {
      const product = item.productId ? productById.get(item.productId) : undefined'''
new = '''    const policyForItem = (item: { productId?: string | null }): InvoicePolicy => {
      // Repair fulfillment is workshop QC/Ready. Ordinary Sales still requires a validated delivery.
      if (repairFulfillmentReady) return 'order'
      const product = item.productId ? productById.get(item.productId) : undefined'''
if old not in r:
    raise SystemExit('policy anchor missing')
r = r.replace(old, new, 1)
old = '''    if (!hasValidatedDelivery || !fullyDelivered) {
      return NextResponse.json({
        error: 'Complete and validate the Sales Order delivery before creating an invoice',
      }, { status: 409 })
    }'''
new = '''    if ((!hasValidatedDelivery || !fullyDelivered) && !repairFulfillmentReady) {
      return NextResponse.json({
        error: 'Complete and validate the Sales Order delivery before creating an invoice',
      }, { status: 409 })
    }'''
if old not in r:
    raise SystemExit('delivery gate anchor missing')
r = r.replace(old, new, 1)
route.write_text(r)

Path('.github/workflows/apply-repair-quote-lineage-fix.yml').unlink(missing_ok=True)
Path('scripts/apply_repair_quote_lineage_fix.py').unlink(missing_ok=True)
