import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

// Revoke a partner API key. Keys are never hard-deleted so the audit trail of
// which partner had access (and when) is preserved.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('admin.partner_keys')
    const existing = await prisma.partnerApiKey.findUnique({ where: { id: resolvedParams.id } })
    if (!existing) return NextResponse.json({ error: 'Key not found' }, { status: 404 })
    if (!existing.isActive) return NextResponse.json({ ok: true })

    await prisma.partnerApiKey.update({
      where: { id: resolvedParams.id },
      data: { isActive: false, revokedAt: new Date() },
    })
    await writeFinancialAudit({
      userId: actor.id,
      action: 'partner_key_revoke',
      entityType: 'partner_api_key',
      entityId: resolvedParams.id,
      oldValues: { name: existing.name, prefix: existing.prefix },
    })
    return NextResponse.json({ ok: true })
  })
}
