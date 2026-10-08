import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { findHoldoverByScreenId, holdoverData, requireHoldoverEditor, toScreenHoldover } from '@/lib/holdover-read-model.server'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** Extend or return a holdover. The body is the changed screen fields. */
export async function PATCH(request: Request, { params }: Ctx) {
  return withApiErrorHandling(async () => {
    await requireHoldoverEditor()
    const { id } = await params
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid holdover update' }, { status: 422 })
    const existing = await findHoldoverByScreenId(id)
    if (!existing) return NextResponse.json({ error: 'Holdover not found' }, { status: 404 })
    const { id: _id, ref: _ref, ...patch } = body
    const updated = await prisma.holdover.update({
      where: { id: existing.id },
      data: holdoverData(patch, existing.screenExtras),
    })
    await notifyStoreKeysChanged(['deed_holdovers'])
    return NextResponse.json(toScreenHoldover(updated))
  })
}
