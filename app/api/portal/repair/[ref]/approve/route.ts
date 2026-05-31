import { NextRequest, NextResponse } from 'next/server'
import { approvalDecisions } from '@/lib/portal-repairs'
import { lookupRepair } from '@/lib/portal-repair-server'
import { saveStoreKeys, loadAppState } from '@/lib/server-store'
import prisma from '@/lib/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } }
) {
  const ref = decodeURIComponent(params.ref)
  const repair = await lookupRepair(ref)

  if (!repair) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }

  if (repair.status !== 'awaiting_approval') {
    return NextResponse.json(
      { error: `Quote cannot be actioned — current status is "${repair.status}".` },
      { status: 409 }
    )
  }

  const body = await req.json() as { approved: boolean; reason?: string }
  const { approved, reason } = body
  const date = new Date().toISOString().slice(0, 10)

  const decision = { approved, reason: reason ?? undefined, date }

  // Store in-memory for fast lookup during this server process lifetime
  approvalDecisions.set(ref.toUpperCase(), decision)

  // Persist to database so approvals survive server restarts
  await saveStoreKeys({
    [`portal_approval_${ref.toUpperCase()}`]: JSON.stringify(decision),
  })

  // Real-time synchronization: Update ERP state immediately
  const appState = await loadAppState()
  const repairs = (appState['deed_repairs_v2'] as any[]) || []
  const repairIndex = repairs.findIndex((r: any) => r.ref.toUpperCase() === ref.toUpperCase())
  
  if (repairIndex !== -1) {
    const targetRepair = repairs[repairIndex]
    // Only update if it's still awaiting approval to prevent double-processing
    if (targetRepair.status === 'awaiting_approval') {
      // Note: In a real production environment, we would call the store action.
      // Since this is a server-side API route and the store is client-side (useLS),
      // we simulate the update by mutating the persisted state directly.
      targetRepair.status = approved ? 'approved' : 'declined'
      if (approved) {
        targetRepair.quote = {
          ...targetRepair.quote,
          approvedDate: date,
          approvedBy: 'customer'
        }

        // ── Create Prisma SaleOrder & Invoice ──────────────────────────────
        try {
          const customerPhone = (targetRepair.customerPhone ?? '').replace(/\s+/g, '')
          const customerName = targetRepair.customerName ?? 'Unknown Customer'
          const customerEmail = targetRepair.customerEmail ?? null

          // Find client by phone (try multiple formats)
          let prismaClient = customerPhone ? await prisma.client.findFirst({
            where: {
              OR: [
                { phone: customerPhone },
                { phone: customerPhone.replace(/^0/, '+254') },
                { phone: customerPhone.replace(/^\+254/, '0') },
              ]
            }
          }) : null

          // Create client if not found
          if (!prismaClient) {
            const clientCount = await prisma.client.count()
            prismaClient = await prisma.client.create({
              data: {
                clientNumber: `CLT-${String(clientCount + 1).padStart(5, '0')}`,
                name: customerName,
                phone: customerPhone || null,
                email: customerEmail,
                clientType: 'individual',
              }
            })
          }

          // Get a system user for createdById
          const systemUser = await prisma.user.findFirst({
            where: { isActive: true },
            orderBy: { createdAt: 'asc' }
          })

          if (systemUser) {
            const quoteLines = Array.isArray(targetRepair.quote?.lines) ? targetRepair.quote.lines : []
            const subtotal = Number(targetRepair.quote?.subtotal ?? 0)
            const taxAmount = Number(targetRepair.quote?.tax ?? 0)
            const totalAmount = Number(targetRepair.quote?.total ?? 0)

            // Generate unique order number
            const soCount = await prisma.saleOrder.count()
            const orderNumber = `SO-${String(soCount + 1).padStart(5, '0')}`

            // Create SaleOrder
            const saleOrder = await prisma.saleOrder.create({
              data: {
                orderNumber,
                clientId: prismaClient.id,
                createdById: systemUser.id,
                status: 'confirmed',
                orderDate: new Date(date),
                subtotal,
                taxAmount,
                discountAmount: 0,
                totalAmount,
                amountPaid: 0,
                notes: `Auto-created from repair quote approval: ${ref}`,
                items: {
                  create: quoteLines.map((line: any) => ({
                    description: line.description ?? 'Repair Service',
                    qty: Number(line.qty ?? 1),
                    unitPrice: Number(line.unitPrice ?? 0),
                    taxRate: 0,
                    lineTotal: Number(line.subtotal ?? line.unitPrice ?? 0),
                  }))
                }
              }
            })

            // Generate unique invoice number
            const invCount = await prisma.invoice.count()
            const invoiceNumber = `INV-${String(invCount + 1).padStart(5, '0')}`

            // Create Invoice
            const invoice = await prisma.invoice.create({
              data: {
                invoiceNumber,
                clientId: prismaClient.id,
                createdById: systemUser.id,
                saleOrderId: saleOrder.id,
                status: 'posted',
                invoiceDate: new Date(date),
                dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                subject: `Repair Invoice — ${ref}`,
                subtotal,
                taxAmount,
                discountAmount: 0,
                totalAmount,
                amountPaid: 0,
                notes: `Auto-created from repair quote approval: ${ref}`,
                items: {
                  create: quoteLines.map((line: any) => ({
                    description: line.description ?? 'Repair Service',
                    qty: Number(line.qty ?? 1),
                    unitPrice: Number(line.unitPrice ?? 0),
                    taxRate: 0,
                    lineSubtotal: Number(line.subtotal ?? line.unitPrice ?? 0),
                    lineTax: 0,
                    lineTotal: Number(line.subtotal ?? line.unitPrice ?? 0),
                  }))
                }
              }
            })

            // Link IDs back to repair in app state
            targetRepair.linkedSaleOrderId = saleOrder.id
            targetRepair.linkedSaleOrderRef = saleOrder.orderNumber
            targetRepair.linkedInvoiceId = invoice.id
            targetRepair.linkedInvoiceRef = invoice.invoiceNumber

            // Also add invoice to deed_invoices in app_state so the frontend picks it up via SSE
            const existingInvoices = (appState['deed_invoices'] as any[]) || []
            const invoiceForAppState = {
              id: invoice.id,
              ref: invoice.invoiceNumber,
              type: 'customer_invoice',
              status: 'posted',
              partnerId: targetRepair.customerId ?? prismaClient.id,
              partnerName: customerName,
              date,
              dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
              lines: quoteLines.map((line: any) => ({
                id: `il_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                description: line.description ?? 'Repair Service',
                qty: Number(line.qty ?? 1),
                unitPrice: Number(line.unitPrice ?? 0),
                taxRate: 0,
                subtotal: Number(line.subtotal ?? line.unitPrice ?? 0),
              })),
              subtotal,
              taxTotal: taxAmount,
              total: totalAmount,
              amountPaid: 0,
              saleOrderId: saleOrder.id,
              repairId: targetRepair.id,
              notes: `Auto-created from repair quote approval: ${ref}`,
            }
            const updatedInvoices = [invoiceForAppState, ...existingInvoices]
            await saveStoreKeys({ 'deed_invoices': JSON.stringify(updatedInvoices) })

            console.log(`[APPROVE] Created SO: ${saleOrder.orderNumber}, Invoice: ${invoice.invoiceNumber}`)
          }
        } catch (err) {
          console.error('[APPROVE] Error creating Prisma SO/Invoice:', err)
        }
        // ── End Prisma SO/Invoice creation ────────────────────────────────

        const procurementLines = Array.isArray(targetRepair.quote?.lines)
          ? targetRepair.quote.lines.filter((line: any) => ['part', 'software', 'license'].includes(line.type) && !line.reserved)
          : []

        if (procurementLines.length > 0) {
          const request = {
            id: `pr_${Date.now()}`,
            repairId: targetRepair.id,
            repairRef: targetRepair.ref,
            requestedBy: 'customer_approval',
            requestedByName: 'Customer approval automation',
            requestedDate: date,
            urgency: targetRepair.priority === 'urgent' ? 'urgent' : 'normal',
            status: 'pending',
            notes: `Automatically created after customer approved quote ${targetRepair.quote?.id ?? ''}`.trim(),
            items: procurementLines.map((line: any) => ({
              type: line.type,
              productId: line.productId ?? '',
              productName: line.productName ?? line.description ?? 'Quoted item',
              description: line.description ?? '',
              qty: String(line.qty ?? 1),
              estimatedCost: String(line.unitPrice ?? 0),
              supplier: '',
            })),
          }
          targetRepair.status = 'awaiting_parts'
          targetRepair.procurementRequests = [...(targetRepair.procurementRequests ?? []), request]
        }
      } else {
        targetRepair.quote = {
          ...targetRepair.quote,
          rejectedDate: date,
          rejectionReason: reason
        }
      }
      
      await saveStoreKeys({
        'deed_repairs_v2': JSON.stringify(repairs)
      })
    }
  }

  if (repair.customerPhone) {
    const message = approved
      ? `Hi ${repair.customerName}, you have approved the repair quote for your ${repair.productName} (${repair.ref}). Our team will begin work shortly.`
      : `Hi ${repair.customerName}, we have received your decision to decline the repair quote for ${repair.productName} (${repair.ref}). We will contact you regarding next steps.`
    fetch(`${req.nextUrl.origin}/api/notifications/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
      },
      body: JSON.stringify({ type: 'general', to: repair.customerPhone, message, priority: 'high' }),
    }).catch(() => {})
  }

  const updated = await lookupRepair(ref)
  return NextResponse.json({ repair: updated, approved }, { status: 200 })
}
