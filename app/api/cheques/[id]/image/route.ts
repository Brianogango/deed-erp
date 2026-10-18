/** GET — the photo kept with a cheque. */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireCan, withApiErrorHandling } from '@/lib/auth/api'
import { getObject } from '@/lib/infra/object-store'
import { CHEQUE_IMAGE_BUCKET } from '@/lib/cheques/cheque-store.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await requireCan('accounting.cheques.view')
    const { id } = await params
    const row = await prisma.cheque.findUnique({ where: { id }, select: { imageKey: true, imageType: true } })
    if (!row?.imageKey) return NextResponse.json({ error: 'No photo is kept for this cheque' }, { status: 404 })
    const bytes = await getObject(CHEQUE_IMAGE_BUCKET, row.imageKey)
    if (!bytes) return NextResponse.json({ error: 'The cheque photo is missing' }, { status: 404 })
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'Content-Type': row.imageType || 'image/jpeg', 'Cache-Control': 'private, max-age=300' },
    })
  })
}
