import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

const ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'sales_rep']

/**
 * Append a history-only ORC audit log (e.g. partial_return) without changing
 * release status. Released certificates stay released.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(ROLES)

    const id = String(params.id || '').trim()
    if (!id) return NextResponse.json({ error: 'Missing release id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as {
      action?: string
      notes?: string
      metadata?: Record<string, unknown>
      fromStatus?: string
      toStatus?: string
      performedById?: string
      performedByName?: string
      performedAt?: string
      logId?: string
    }

    const action = String(body.action || '').trim().slice(0, 50)
    if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 })

    const release = await prisma.outboundRelease.findUnique({
      where: { id },
      select: { id: true, status: true, ref: true },
    })
    if (!release) return NextResponse.json({ error: 'Release not found' }, { status: 404 })

    const performedById = String(body.performedById || user.id || '').trim()
    if (!performedById) return NextResponse.json({ error: 'performedById required' }, { status: 400 })

    const performedAt = body.performedAt ? new Date(body.performedAt) : new Date()
    const logId = body.logId && /^[0-9a-f-]{36}$/i.test(body.logId) ? body.logId : undefined
    const metadata = body.metadata
      ? (JSON.parse(JSON.stringify(body.metadata)) as Prisma.InputJsonValue)
      : undefined
    const log = await prisma.outboundReleaseLog.create({
      data: {
        ...(logId ? { id: logId } : {}),
        releaseId: id,
        action,
        fromStatus: body.fromStatus ? String(body.fromStatus).slice(0, 30) : release.status,
        toStatus: body.toStatus ? String(body.toStatus).slice(0, 30) : release.status,
        performedById,
        performedAt,
        notes: body.notes ? String(body.notes) : null,
        ...(metadata !== undefined ? { metadata } : {}),
      },
    })

    // Keep blob audit trail in sync for clients that still hydrate ORCs from app_state.
    try {
      const state = await loadAppState(['deed_outboundReleases'])
      const releases = Array.isArray(state.deed_outboundReleases) ? state.deed_outboundReleases as any[] : []
      const next = releases.map((r: any) => {
        if (r.id !== id) return r
        const entry = {
          id: log.id,
          releaseId: id,
          action,
          fromStatus: log.fromStatus ?? undefined,
          toStatus: log.toStatus ?? undefined,
          performedById,
          performedByName: body.performedByName,
          performedAt: performedAt.toISOString(),
          notes: body.notes,
          metadata: body.metadata,
        }
        return {
          ...r,
          auditLog: [...(Array.isArray(r.auditLog) ? r.auditLog : []), entry],
          updatedAt: new Date().toISOString(),
        }
      })
      await saveStoreKeys({ deed_outboundReleases: JSON.stringify(next) })
    } catch {
      /* Prisma log is authoritative; blob sync is best-effort */
    }

    return NextResponse.json({ ok: true, logId: log.id, releaseRef: release.ref })
  })
}
