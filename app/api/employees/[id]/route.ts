import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

const WRITE_ROLES = ['admin', 'finance']

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const id = params.id
    const body = await request.json()

    if (body.startDate) body.startDate = new Date(body.startDate)
    if (body.createdAt) body.createdAt = new Date(body.createdAt)
    
    const employee = await prisma.employee.update({ where: { id }, data: body })
    return NextResponse.json(employee)
  })
}
