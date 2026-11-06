import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'
import { updateDeliveryJob } from '@/lib/delivery/rider-portal.server'
import { applyCustomerPaidRider, settlePaidToRider } from '@/lib/delivery/rider-direct-pay.server'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }

const ROLES = ['director', 'admin_officer', 'finance_officer']

/**
 * The customer paid the rider the delivery charge directly (office side; the
 * rider records the same thing from their link).
 *   POST { amount, method: 'cash'|'mpesa', reference? } — record it and settle the invoice
 *   POST { action: 'settle' } — settle a record whose invoice was not ready before
 */
export async function POST(req: NextRequest, { params }: Params) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const by = String((actor as any).name || (actor as any).username || 'Office')
    const { id } = await params
    const body = await req.json().catch(() => ({})) as Record<string, any>

    const withInvoice = async (job: Record<string, any>, extra: Record<string, unknown> = {}) => {
      const invoiceId = job.customerPaidRider?.invoiceId
      const inv = invoiceId ? await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { amountPaid: true } }).catch(() => null) : null
      return NextResponse.json({ job, invoiceAmountPaid: inv ? Number(inv.amountPaid) : undefined, ...extra })
    }

    if (body.action === 'settle') {
      const state = await loadAppState(['deed_deliveryJobs'])
      const job = (Array.isArray(state.deed_deliveryJobs) ? state.deed_deliveryJobs as Array<Record<string, any>> : []).find(j => j.id === id)
      if (!job?.customerPaidRider) return NextResponse.json({ error: 'Nothing recorded for this trip' }, { status: 404 })
      if (Number(job.customerPaidRider.settled) > 0) return NextResponse.json({ error: 'Already settled on the invoice' }, { status: 409 })
      const settle = await settlePaidToRider(job, Number(job.customerPaidRider.amount) || 0)
      if (!(settle.settled > 0)) return NextResponse.json({ error: `Not settled: ${'pending' in settle ? settle.pending : ''}` }, { status: 409 })
      const patched = await updateDeliveryJob(id, j => ({ ok: true, job: { ...j, customerPaidRider: { ...(j as any).customerPaidRider, invoiceId: settle.invoiceId, invoiceRef: settle.invoiceRef, settled: settle.settled, pending: undefined } } as typeof j }))
      if (!patched.ok) return NextResponse.json({ error: patched.error }, { status: patched.status })
      return withInvoice(patched.job as Record<string, any>, { settle })
    }

    const amount = Number(body.amount)
    if (!(amount > 0)) return NextResponse.json({ error: 'Enter the amount the customer paid the rider' }, { status: 400 })
    const result = await applyCustomerPaidRider(id, { amount, method: body.method === 'mpesa' ? 'mpesa' : 'cash', reference: String(body.reference ?? '').slice(0, 60) }, { by, maxSettle: amount })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return withInvoice(result.job, { settle: result.settle })
  })
}
