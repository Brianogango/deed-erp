from pathlib import Path

p = Path('lib/store.tsx')
s = p.read_text()
start_marker = '''      // Confirm SO + create Invoice
      const soLines = repair.quote.lines.map(l => ({'''
end_marker = '''      showToast(invoiceRef ? `Quote approved — ${soRef} & ${invoiceRef} ${existingInvoice ? 'updated' : 'created'}` : `Quote approved — ${soRef} created (no invoice for zero total)`)
    },'''
start = s.index(start_marker)
end = s.index(end_marker, start) + len(end_marker)
replacement = '''      // Confirm the existing commercial lineage only. Approval must never
      // create an invoice; the invoice is created from this SO after QC/Ready.
      const soLines = repair.quote.lines.map(l => ({
        id: uid(),
        ...saleLineFieldsForRepairQuoteLine(l),
      }))

      let soId: string
      let soRef: string
      const linkedApprovedSo = findSaleOrderForRepair(soRef.current, repair)
      const presetSoId = linkedApprovedSo?.id ?? repair.saleOrderId ?? (repair as any).linkedSaleOrderId
      const presetSoRef = linkedApprovedSo?.ref ?? linkedApprovedSo?.orderNumber ?? repair.saleOrderRef ?? (repair as any).linkedSaleOrderRef
      if (presetSoId) {
        soId = presetSoId
        soRef = presetSoRef ?? repair.ref
        const soPatch = {
          status: 'sale' as const,
          confirmedAt: linkedApprovedSo?.confirmedAt ?? new Date().toISOString(),
          lines: soLines,
          subtotal: repair.quote.subtotal,
          taxAmount: repair.quote.tax,
          taxTotal: repair.quote.tax,
          totalAmount: repair.quote.total,
          total: repair.quote.total,
          notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
          source: 'repair',
          repairId: repair.id,
          repairRef: repair.ref,
        }
        setSaleOrders(p => p.map(order => order.id === soId ? { ...order, ...soPatch } : order))
        sync(`/api/sale-orders/${soId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(soPatch) })
      } else {
        soId = uid()
        soRef = await storeCtxRef.current!.allocateDocRef('SO')
        const newSo: SaleOrder = {
          id: soId, ref: soRef, status: 'sale', confirmedAt: new Date().toISOString(),
          customerId: repair.customerId, customerName: repair.customerName,
          date: now(), validUntil: addDays(now(), 30),
          lines: soLines, subtotal: repair.quote.subtotal, taxTotal: repair.quote.tax, total: repair.quote.total,
          notes: `Repair quote — ${repair.ref} — ${repair.productName}`,
          source: 'repair', repairId: repair.id, repairRef: repair.ref,
          createdByUserId: repair.createdBy,
        }
        setSaleOrders(p => [newSo, ...p])
        sync('/api/sale-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSo) })
      }

      const approvedRepair = {
        ...repair,
        quote: {
          ...repair.quote,
          approvedDate: repair.quote.approvedDate ?? now(),
          approvedBy: repair.quote.approvedBy ?? 'customer',
          lines: updatedLines,
        },
        status: 'approved' as const,
        partsUsed: partsUsedNow,
        saleOrderId: soId,
        saleOrderRef: soRef,
      }
      repairsRef.current = repairsRef.current.map(row => row.id === repairId ? approvedRepair : row)
      setRepairs(p => p.map(row => row.id === repairId ? approvedRepair : row))

      const approvedSalesQuote = findSalesQuoteForRepair(quotes, repair)
      if (approvedSalesQuote) {
        setQuotes(p => {
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

      addAuditLog('approve_quote', repairId, `Quote approved → ${soRef}; invoice deferred until repair is Ready`)
      showToast(`Quote approved — ${soRef} confirmed. Invoice will be created after QC when the repair is Ready.`)
    },'''
s = s[:start] + replacement + s[end:]
p.write_text(s)

Path('.github/workflows/apply-repair-approval-invoice-deferral.yml').unlink(missing_ok=True)
Path('scripts/apply_repair_approval_invoice_deferral.py').unlink(missing_ok=True)
