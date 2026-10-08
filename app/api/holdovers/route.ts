import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { holdoverData, nextHoldoverRef, requireHoldoverEditor, toScreenHoldover } from '@/lib/holdover-read-model.server'

export const dynamic = 'force-dynamic'

/** Issue a holdover (loaner). The body is the screen record. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireHoldoverEditor()
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const screenId = String(body?.id ?? '').trim().slice(0, 80)
    if (!body || !screenId || !String(body.clientName ?? '').trim() || !String(body.serialId ?? '').trim()) {
      return NextResponse.json({ error: 'A holdover needs a client and a device' }, { status: 422 })
    }
    const existing = await prisma.holdover.findFirst({ where: { blobId: screenId } })
    if (existing) return NextResponse.json(toScreenHoldover(existing))

    const wanted = String(body.ref ?? '').trim().slice(0, 40)
    const taken = !wanted || await prisma.holdover.findUnique({ where: { ref: wanted }, select: { id: true } })
    const ref = taken ? await nextHoldoverRef() : wanted
    const { screenExtras, ...columns } = holdoverData(body)
    const created = await prisma.holdover.create({
      data: { ...(columns as any), blobId: screenId, ref, screenExtras: screenExtras as any },
    })
    await notifyStoreKeysChanged(['deed_holdovers'])
    return NextResponse.json(toScreenHoldover(created), { status: 201 })
  })
}
