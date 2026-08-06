import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'

/** Full lineage (all versions) for a quotation, oldest first, with a computed isLatest flag. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()

    const source = await prisma.saleOrder.findUnique({
      where: { id: params.id },
      select: { id: true, versionGroupId: true },
    })
    if (!source) return NextResponse.json({ error: 'Sale order not found' }, { status: 404 })

    const rootId = source.versionGroupId ?? source.id
    const rows = await prisma.saleOrder.findMany({
      where: { OR: [{ id: rootId }, { versionGroupId: rootId }] },
      orderBy: { versionNumber: 'asc' },
      select: {
        id: true,
        orderNumber: true,
        versionNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        createdBy: { select: { username: true } },
      },
    })
    const maxVersion = Math.max(1, ...rows.map(r => r.versionNumber))

    return NextResponse.json({
      versions: rows.map(r => ({
        id: r.id,
        ref: r.orderNumber,
        versionNumber: r.versionNumber,
        status: normalizeSaleStatus(r.status),
        total: Number(r.totalAmount ?? 0),
        createdAt: r.createdAt.toISOString(),
        createdByName: r.createdBy?.username ?? undefined,
        isLatest: r.versionNumber === maxVersion,
      })),
    })
  })
}
