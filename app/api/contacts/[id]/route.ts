import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { clientToContact, deleteContactById, updateContactById, type ContactInput } from '@/lib/contact-prisma'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']

async function updateContact(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json() as ContactInput
    const updated = await updateContactById(prisma, params.id, body)
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (typeof updated === 'string') {
      return NextResponse.json({ error: updated }, { status: 422 })
    }
    return NextResponse.json(updated)
  })
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const client = await prisma.client.findUnique({ where: { id: params.id } })
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(clientToContact(client))
  })
}

export const PATCH = updateContact
export const PUT = updateContact

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const deleted = await deleteContactById(prisma, params.id)
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  })
}
