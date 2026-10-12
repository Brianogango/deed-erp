import { NextRequest, NextResponse } from 'next/server'
import { portalRemoveDocument, toPortalView } from '@/lib/credit/credit-facility.server'
import { noStore, portalHandler } from '@/lib/credit/portal-guard.server'

export const dynamic = 'force-dynamic'

/** DELETE — the client removes a file they uploaded (before submitting). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string; docId: string }> }) {
  const { token, docId } = await params
  return portalHandler(req, 'save', 200, async () =>
    NextResponse.json({ application: await toPortalView(await portalRemoveDocument(token, docId)) }, { headers: noStore }), token)
}
