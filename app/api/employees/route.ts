import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

const WRITE_ROLES = ['admin']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const employees = await prisma.employee.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json(employees)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    if (body.startDate) body.startDate = new Date(body.startDate)
    if (body.createdAt) body.createdAt = new Date(body.createdAt)
    const employee = await prisma.employee.create({ data: body })
    return NextResponse.json(employee, { status: 201 })
  })
}
