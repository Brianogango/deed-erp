import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

const MANAGE_ROLES = ['director', 'admin_officer']

// Revoke a partner API key. Keys are never hard-deleted so the audit trail of
// which partner had access (and when) is preserved.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(MANAGE_ROLES)
    const existing = await prisma.partnerApiKey.findUnique({ where: { id: params.id } })
    if (!existing) return NextResponse.json({ error: 'Key not found' }, { status: 404 })
    if (!existing.isActive) return NextResponse.json({ ok: true })

    await prisma.partnerApiKey.update({
      where: { id: params.id },
      data: { isActive: false, revokedAt: new Date() },
    })
    await writeFinancialAudit({
      userId: actor.id,
      action: 'partner_key_revoke',
      entityType: 'partner_api_key',
      entityId: params.id,
      oldValues: { name: existing.name, prefix: existing.prefix },
    })
    return NextResponse.json({ ok: true })
  })
}
