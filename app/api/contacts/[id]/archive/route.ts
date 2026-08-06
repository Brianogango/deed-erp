import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { clientToContact } from '@/lib/contact-prisma'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer']

/** Soft-archive a contact (P1-DEED-006). Never hard-deletes. */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(WRITE_ROLES)
    const client = await prisma.client.findUnique({ where: { id: params.id } })
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updated = await prisma.client.update({
      where: { id: params.id },
      data: { isActive: false },
    })

    try {
      await writeFinancialAudit({
        userId: user.id,
        action: 'contact_archived',
        entityType: 'client',
        entityId: params.id,
        newValues: { name: client.name, isActive: false },
      })
    } catch {
      // audit best-effort
    }

    return NextResponse.json(clientToContact(updated))
  })
}
