import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { broadcastCompanies, mapCompanyToClient } from '@/lib/api-shared/companies'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    if (!canWriteStoreKey(user, 'deed_companies')) throw Object.assign(new Error('You cannot change companies'), { status: 403 })
    const body = await request.json()
    const client = await prisma.client.update({
      where: { id: resolvedParams.id },
      data: mapCompanyToClient(body),
    })
    void broadcastCompanies()
    return NextResponse.json(client)
  })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    if (!canWriteStoreKey(user, 'deed_companies')) throw Object.assign(new Error('You cannot change companies'), { status: 403 })
    await prisma.client.delete({ where: { id: resolvedParams.id } })
    void broadcastCompanies()
    return NextResponse.json({ success: true })
  })
}
