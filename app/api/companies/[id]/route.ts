import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const id = params.id
    const body = await request.json()
    
    if (body.createdDate) body.createdDate = new Date(body.createdDate)
    if (body.lastContactDate) body.lastContactDate = new Date(body.lastContactDate)
    
    const contactPerson = await prisma.contactPerson.update({ where: { id }, data: body })
    return NextResponse.json(contactPerson)
  })
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    await prisma.contactPerson.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  })
}