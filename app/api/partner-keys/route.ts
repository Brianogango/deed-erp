import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { generatePartnerApiKey } from '@/lib/partner-api'

const MANAGE_ROLES = ['director', 'admin_officer']

const toClient = (k: {
  id: string; name: string; prefix: string; isActive: boolean
  createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null
}) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  isActive: k.isActive,
  createdAt: k.createdAt.toISOString(),
  lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
  revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
})

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(MANAGE_ROLES)
    const keys = await prisma.partnerApiKey.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ items: keys.map(toClient) })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(MANAGE_ROLES)
    const body = await request.json().catch(() => ({}))
    const name = String(body?.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'A partner name is required' }, { status: 422 })
    if (name.length > 120) return NextResponse.json({ error: 'Partner name is too long (max 120 characters)' }, { status: 422 })

    const { key, prefix, keyHash } = generatePartnerApiKey()
    const record = await prisma.partnerApiKey.create({
      data: { name, prefix, keyHash, createdById: actor.id },
    })
    await writeFinancialAudit({
      userId: actor.id,
      action: 'partner_key_create',
      entityType: 'partner_api_key',
      entityId: record.id,
      newValues: { name, prefix },
    })
    // The plaintext key is returned exactly once — only its hash is stored.
    return NextResponse.json({ item: toClient(record), key }, { status: 201 })
  })
}
