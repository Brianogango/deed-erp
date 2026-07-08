import { NextRequest, NextResponse } from 'next/server'
import { approvalDecisions } from '@/lib/portal-repairs'
import { lookupRepair } from '@/lib/portal-repair-server'
import { saveStoreKeys, loadAppState } from '@/lib/server-store'
import { checkRateLimit } from '@/lib/rate-limit'
import { phoneMatches } from '@/lib/portal-verify'
import prisma from '@/lib/prisma'
import { getNextDocNumber } from '@/lib/doc-ref-counter'

type ItemDecision = { lineId: string; decision: 'approved' | 'declined' | 'deferred' }

function lineKey(line: any, index: number) {
  return String(line?.id ?? index)
}

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } }
) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  const rl = await checkRateLimit(`portal-approve:${ip}`, 10, 3600)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    )
  }

  const ref = decodeURIComponent(params.ref)
  const repair = await lookupRepair(ref)
  if (!repair) return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  if (repair.status !== 'awaiting_approval') {
    return NextResponse.json({ error: `Quote cannot be actioned — current status is "${repair.status}".` }, { status: 409 })
  }

  const body = await req.json().catch(() => ({})) as { approved?: boolean; reason?: string; itemDecisions?: ItemDecision[]; verifyPhone?: string }

  const date = new Date().toISOString().slice(0, 10)
  const appState = await loadAppState()

  // Ownership proof (optional): when secPortalRequirePhoneVerification is on, the
  // caller must supply the customer phone on file. This prevents a guessed
  // reference alone from approving a quote. Off by default to avoid friction.
  const settings = appState['deed_systemSettings'] as { secPortalRequirePhoneVerification?: boolean } | undefined
  if (settings?.secPortalRequirePhoneVerification === true && !phoneMatches(body.verifyPhone, repair.customerPhone)) {
    return NextResponse.json({ error: 'Verification failed. Enter the phone number on this repair to confirm.' }, { status: 403 })
  }
  const repairs = (appState['deed_repairs_v2'] as any[]) || []
  const repairIndex = repairs.findIndex((r: any) => r.ref.toUpperCase() === ref.toUpperCase())
  if (repairIndex === -1) return NextResponse.json({ error: 'Repair could not be synchronized.' }, { status: 404 })

  const targetRepair = repairs[repairIndex]
  if (targetRepair.status !== 'awaiting_approval') {
    return NextResponse.json({ error: `Quote cannot be actioned — current status is "${targetRepair.status}".` }, { status: 409 })
  }

  const originalLines = Array.isArray(targetRepair.quote?.lines) ? targetRepair.quote.lines : []
  if (originalLines.length === 0) return NextResponse.json({ error: 'No quote lines found for this repair.' }, { status: 400 })

  const decisionMap = new Map<string, 'approved' | 'declined' | 'deferred'>()
  if (Array.isArray(body.itemDecisions) && body.itemDecisions.length > 0) {
    for (const d of body.itemDecisions) {
      if (!d?.lineId || !['approved', 'declined', 'deferred'].includes(d.decision)) continue
      decisionMap.set(String(d.lineId), d.decision)
    }
  } else if (typeof body.approved === 'boolean') {
    originalLines.forEach((line: any, i: number) => decisionMap.set(lineKey(line, i), body.approved ? 'approved' : 'declined'))
  }

  if (decisionMap.size === 0) return NextResponse.json({ error: 'Select at least one quote line decision.' }, { status: 400 })

  const linesWithDecisions = originalLines.map((line: any, i: number) => {
    const decision = decisionMap.get(lineKey(line, i)) ?? 'declined'
    return { ...line, decision }
  })
  const approvedLines = linesWithDecisions.filter((line: any) => line.decision === 'approved')
  const approved = approvedLines.length > 0
  const approvedSubtotal = roundMoney(approvedLines.reduce((sum: number, line: any) => sum + Number(line.subtotal ?? 0), 0))
  const taxRate = Number(targetRepair.quote?.subtotal ?? 0) > 0 ? Number(targetRepair.quote?.tax ?? 0) / Number(targetRepair.quote?.subtotal ?? 0) : 0
  const approvedTax = roundMoney(approvedSubtotal * taxRate)
  const approvedTotal = roundMoney(approvedSubtotal + approvedTax)
  const partiallyApproved = approved && approvedLines.length < originalLines.length
  const reason = body.reason?.trim() || undefined
  const decision = { approved, reason, date, itemDecisions: linesWithDecisions.map((line: any, i: number) => ({ lineId: lineKey(line, i), decision: line.decision })), approvedTotal }

  approvalDecisions.set(ref.toUpperCase(), decision)
  await saveStoreKeys({ [`portal_approval_${ref.toUpperCase()}`]: JSON.stringify(decision) })

  targetRepair.status = approved ? 'approved' : 'declined'
  targetRepair.quote = {
    ...targetRepair.quote,
    lines: linesWithDecisions,
    partiallyApproved,
    approvedTotal: approved ? approvedTotal : 0,
    approvedDate: approved ? date : undefined,
    approvedBy: approved ? 'customer' : undefined,
    rejectedDate: approved ? undefined : date,
    rejectionReason: approved ? undefined : reason,
  }

  if (approved) {
    targetRepair.total = approvedTotal
    targetRepair.laborCost = approvedLines.filter((line: any) => line.type === 'labor').reduce((sum: number, line: any) => sum + Number(line.subtotal ?? 0), 0)
    targetRepair.logisticsCost = approvedLines.filter((line: any) => line.type === 'logistics').reduce((sum: number, line: any) => sum + Number(line.subtotal ?? 0), 0)

    try {
      const customerPhone = (targetRepair.customerPhone ?? '').replace(/\s+/g, '')
      const customerName = targetRepair.customerName ?? 'Unknown Customer'
      const customerEmail = targetRepair.customerEmail ?? null
      let prismaClient = customerPhone ? await prisma.client.findFirst({
        where: { OR: [{ phone: customerPhone }, { phone: customerPhone.replace(/^0/, '+254') }, { phone: customerPhone.replace(/^\+254/, '0') }] }
      }) : null
      if (!prismaClient) {
        prismaClient = await prisma.client.create({ data: { clientNumber: await getNextDocNumber('client'), name: customerName, phone: customerPhone || null, email: customerEmail, clientType: 'individual' } })
      }
      const systemUser = await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
      // Do not create billing documents below 1 — zero/near-zero approvals
      // (e.g. warranty-covered items) must not generate quotes or invoices.
      if (systemUser && approvedTotal >= 1) {
        const soItems = approvedLines.map((line: any) => ({ description: line.description ?? 'Repair Service', qty: Number(line.qty ?? 1), unitPrice: Number(line.unitPrice ?? 0), taxRate: 0, lineTotal: Number(line.subtotal ?? line.unitPrice ?? 0) }))
        // Reuse the SO from a previous approval (quote revisions re-run this
        // flow) instead of creating a duplicate each time.
        const existingSoId = targetRepair.linkedSaleOrderId ?? targetRepair.saleOrderId
        let saleOrder = existingSoId ? await prisma.saleOrder.findUnique({ where: { id: existingSoId } }) : null
        if (saleOrder) {
          saleOrder = await prisma.saleOrder.update({
            where: { id: saleOrder.id },
            data: {
              status: 'confirmed',
              subtotal: approvedSubtotal, taxAmount: approvedTax, totalAmount: approvedTotal,
              notes: `Updated from repair quote approval: ${ref}${partiallyApproved ? ' (partial approval)' : ''}`,
              items: { deleteMany: {}, create: soItems },
            },
          })
        } else {
          const orderNumber = await getNextDocNumber('sale_order')
          saleOrder = await prisma.saleOrder.create({
            data: {
              orderNumber, clientId: prismaClient.id, createdById: systemUser.id, status: 'confirmed', orderDate: new Date(date),
              subtotal: approvedSubtotal, taxAmount: approvedTax, discountAmount: 0, totalAmount: approvedTotal, amountPaid: 0,
              notes: `Auto-created from repair quote approval: ${ref}${partiallyApproved ? ' (partial approval)' : ''}`,
              items: { create: soItems }
            }
          })
        }

        const invoiceItems = approvedLines.map((line: any) => ({ description: line.description ?? 'Repair Service', qty: Number(line.qty ?? 1), unitPrice: Number(line.unitPrice ?? 0), taxRate: 0, lineSubtotal: Number(line.subtotal ?? line.unitPrice ?? 0), lineTax: 0, lineTotal: Number(line.subtotal ?? line.unitPrice ?? 0) }))
        // Reuse the invoice from a previous approval instead of duplicating it.
        const existingInvoiceId = targetRepair.linkedInvoiceId ?? targetRepair.invoiceId
        let invoice = existingInvoiceId ? await prisma.invoice.findUnique({ where: { id: existingInvoiceId } }) : null
        if (invoice) {
          invoice = await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              saleOrderId: saleOrder.id, status: 'approved' as any,
              subtotal: approvedSubtotal, taxAmount: approvedTax, totalAmount: approvedTotal,
              notes: `Updated from repair quote approval: ${ref}${partiallyApproved ? ' (approved items only)' : ''}`,
              items: { deleteMany: {}, create: invoiceItems },
            },
          })
        } else {
          const invoiceNumber = await getNextDocNumber('invoice')
          invoice = await prisma.invoice.create({
            data: {
              invoiceNumber, clientId: prismaClient.id, createdById: systemUser.id, saleOrderId: saleOrder.id, status: 'approved', invoiceDate: new Date(date), dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), subject: `Repair Invoice — ${ref}`,
              subtotal: approvedSubtotal, taxAmount: approvedTax, discountAmount: 0, totalAmount: approvedTotal, amountPaid: 0,
              notes: `Auto-created from repair quote approval: ${ref}${partiallyApproved ? ' (approved items only)' : ''}`,
              items: { create: invoiceItems }
            }
          })
        }
        targetRepair.invoiceId = invoice.id
        targetRepair.invoiceDate = date
        targetRepair.linkedSaleOrderId = saleOrder.id
        targetRepair.linkedSaleOrderRef = saleOrder.orderNumber
        targetRepair.linkedInvoiceId = invoice.id
        targetRepair.linkedInvoiceRef = invoice.invoiceNumber

        const existingInvoices = (appState['deed_invoices'] as any[]) || []
        const invoiceForAppState = {
          id: invoice.id, ref: invoice.invoiceNumber, type: 'customer_invoice', status: 'posted', partnerId: prismaClient.id, partnerName: customerName, date,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          lines: approvedLines.map((line: any) => ({ id: crypto.randomUUID(), description: line.description ?? 'Repair Service', qty: Number(line.qty ?? 1), unitPrice: Number(line.unitPrice ?? 0), taxRate: 0, subtotal: Number(line.subtotal ?? line.unitPrice ?? 0) })),
          subtotal: approvedSubtotal, taxTotal: approvedTax, total: approvedTotal, amountPaid: 0, saleOrderId: saleOrder.id, repairId: targetRepair.id,
          notes: `Auto-created from approved repair quote lines: ${ref}`,
        }
        // Replace an existing app-state copy in place — never append a duplicate.
        const invoiceIdx = existingInvoices.findIndex((inv: any) => inv.id === invoice!.id)
        const nextInvoices = invoiceIdx >= 0
          ? existingInvoices.map((inv: any, i: number) => i === invoiceIdx ? { ...inv, ...invoiceForAppState, amountPaid: Number(inv.amountPaid ?? 0) } : inv)
          : [invoiceForAppState, ...existingInvoices]
        await saveStoreKeys({ 'deed_invoices': JSON.stringify(nextInvoices) })
        console.log(`[APPROVE] Upserted SO: ${saleOrder.orderNumber}, Invoice: ${invoice.invoiceNumber}, approved total: ${approvedTotal}`)
      }
    } catch (err) {
      console.error('[APPROVE] Error creating Prisma SO/Invoice:', err)
    }

    const procurementLines = approvedLines.filter((line: any) => ['part', 'software', 'license'].includes(line.type) && !line.reserved)
    if (procurementLines.length > 0) {
      const request = {
        id: `pr_${Date.now()}`, repairId: targetRepair.id, repairRef: targetRepair.ref, requestedBy: 'customer_approval', requestedByName: 'Customer approval automation', requestedDate: date,
        urgency: targetRepair.priority === 'urgent' ? 'urgent' : 'normal', status: 'pending', notes: `Automatically created for customer-approved quote items ${targetRepair.quote?.id ?? ''}`.trim(),
        items: procurementLines.map((line: any) => ({ type: line.type, productId: line.productId ?? '', productName: line.productName ?? line.description ?? 'Quoted item', description: line.description ?? '', qty: String(line.qty ?? 1), estimatedCost: String(line.unitPrice ?? 0), supplier: '' })),
      }
      targetRepair.status = 'awaiting_parts'
      targetRepair.procurementRequests = [...(targetRepair.procurementRequests ?? []), request]
    }
  }

  await saveStoreKeys({ 'deed_repairs_v2': JSON.stringify(repairs) })

  if (repair.customerPhone) {
    const message = approved
      ? `Hi ${repair.customerName}, your approval for ${approvedLines.length} repair quote item(s) on ${repair.productName} (${repair.ref}) has been received. Approved total: KES ${approvedTotal.toLocaleString('en-KE')}.`
      : `Hi ${repair.customerName}, we have received your decision to decline the repair quote for ${repair.productName} (${repair.ref}). We will contact you regarding next steps.`
    fetch(`${req.nextUrl.origin}/api/notifications/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' }, body: JSON.stringify({ type: 'general', to: repair.customerPhone, message, priority: 'high' }) }).catch(() => {})
  }

  const updated = await lookupRepair(ref)
  return NextResponse.json({ repair: updated, approved, approvedTotal }, { status: 200 })
}
