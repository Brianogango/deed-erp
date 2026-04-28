import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const companies = await prisma.company.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json(companies)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const body = await request.json()
    
    if (body.createdDate) body.createdDate = new Date(body.createdDate)
    if (body.lastContactDate) body.lastContactDate = new Date(body.lastContactDate)
    
    const company = await prisma.company.create({ data: body })
    return NextResponse.json(company, { status: 201 })
  })
}