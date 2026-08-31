import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
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

    const requiredModule =
      documentType === 'quote'
        ? 'sales'
        : documentType === 'invoice' || documentType === 'bill' || documentType === 'payment_receipt'
          ? 'accounting'
          : documentType === 'rfq'
            ? 'purchase'
            : null
    const modules = Array.isArray(session.user.modules) ? session.user.modules : []
    const privileged = session.user.role === 'director' || session.user.role === 'admin_officer'
    if (requiredModule && !privileged && !modules.includes(requiredModule as any)) {
      return NextResponse.json({ error: 'Forbidden — no access to this document email history' }, { status: 403 })
    }
    if (!documentType && !privileged) {
      return NextResponse.json({ error: 'documentType is required for scoped email-history access' }, { status: 400 })
    }

    const limitRaw = Number(searchParams.get('limit') || 100)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100

    const sends = await listDocumentEmailSends({ documentId, documentType, limit })
    return NextResponse.json({ sends })
  })
}
