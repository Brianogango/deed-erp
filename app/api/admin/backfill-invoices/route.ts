import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { mergePrismaInvoicesIntoBlob } from '@/lib/finance-invoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Heal deed_invoices from the Prisma invoices ledger.
 * Idempotent: existing blob rows are kept (vendor-only fields preserved);
 * missing ids are appended from Prisma. Never deletes app_state.
 *
 * Auth: director session, or x-internal-secret (same as other backfills).
 */
export async function POST(request: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = request.headers.get('x-internal-secret')
  const secretOk = Boolean(internalSecret && providedSecret === internalSecret)

  if (!secretOk) {
    const session = await getServerSession()
    if (!session || session.user.role !== 'director') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const state = await loadAppState(['deed_invoices'])
  const beforeCount = Array.isArray(state.deed_invoices) ? state.deed_invoices.length : 0

  const prismaInvoices = await prisma.invoice.findMany({
    include: { items: true, client: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const { merged, added, refreshedPaid } = mergePrismaInvoicesIntoBlob(state.deed_invoices, prismaInvoices)

  if (added > 0 || refreshedPaid > 0) {
    await saveStoreKeys({ deed_invoices: JSON.stringify(merged) })
  }

  return NextResponse.json({
    ok: true,
    note: 'app_state deed_invoices was not wiped; Prisma rows were merged in by id',
    blobBefore: beforeCount,
    blobAfter: merged.length,
    prismaCount: prismaInvoices.length,
    added,
    refreshedPaid,
    customerInvoices: merged.filter(r => r.type === 'customer_invoice').length,
    vendorBills: merged.filter(r => r.type === 'vendor_bill').length,
  })
}
