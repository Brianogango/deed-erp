import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canReadInvoiceRow, invoiceReadScope } from '@/lib/auth/authorization'
import prisma from '@/lib/prisma'
import {
  listDocumentEmailSends,
  type DocumentEmailDocumentType,
} from '@/lib/document-email-sends'

/**
 * GET /api/document-email-sends?documentId=&documentType=&limit=
 * Returns recorded quote/invoice email attempts (success and failure).
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get('documentId') || undefined
    const documentType = (searchParams.get('documentType') || undefined) as DocumentEmailDocumentType | undefined

    // The log holds every customer and vendor address and subject line.
    // Outside the full-ledger roles, it is read one document at a time, and
    // an invoice or bill's history only when that document is in the
    // caller's slice.
    if (invoiceReadScope(session.user) !== 'all') {
      if (!documentId) return NextResponse.json({ sends: [] })
      if (!documentType || documentType === 'invoice' || documentType === 'bill') {
        const invoice = await prisma.invoice.findUnique({ where: { id: documentId }, select: { repairId: true, documentType: true } }).catch(() => null)
        if (invoice && !canReadInvoiceRow(session.user, invoice)) return NextResponse.json({ sends: [] })
        if (!invoice && documentType) return NextResponse.json({ sends: [] })
      }
    }
    const limitRaw = Number(searchParams.get('limit') || 100)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100

    const sends = await listDocumentEmailSends({ documentId, documentType, limit })
    return NextResponse.json({ sends })
  })
}
