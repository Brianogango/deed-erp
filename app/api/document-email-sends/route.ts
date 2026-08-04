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
    await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get('documentId') || undefined
    const documentType = (searchParams.get('documentType') || undefined) as DocumentEmailDocumentType | undefined
    const limitRaw = Number(searchParams.get('limit') || 100)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100

    const sends = await listDocumentEmailSends({ documentId, documentType, limit })
    return NextResponse.json({ sends })
  })
}
