import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { clientToContact, deleteContactById, updateContactById, withoutCreditTerms, type ContactInput } from '@/lib/contact-prisma'
import { refreshDocumentBlobsForClientChange } from '@/lib/documents-broadcast.server'

export const dynamic = 'force-dynamic'

async function updateContact(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const user = await requirePermission('sales.contacts.edit')
    const body = withoutCreditTerms(await request.json() as ContactInput, user.role)
    const updated = await updateContactById(prisma, resolvedParams.id, body, user.id)
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (typeof updated === 'string') {
      return NextResponse.json({ error: updated }, { status: 422 })
    }
    // A name/address/contact-detail change must stop showing stale on every
    // quote, sale order, and invoice already referencing this client/vendor.
    void refreshDocumentBlobsForClientChange()
    return NextResponse.json(updated)
  })
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const client = await prisma.client.findUnique({ where: { id: resolvedParams.id } })
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(clientToContact(client))
  })
}

export const PATCH = updateContact
export const PUT = updateContact

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    await requirePermission('sales.contacts.edit')
    const deleted = await deleteContactById(prisma, resolvedParams.id)
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  })
}
