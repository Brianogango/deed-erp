import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const acts = await prisma.opportunityActivity.findMany({ orderBy: { createdDate: 'desc' } })
    return NextResponse.json(acts)
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (body.createdDate) body.createdDate = new Date(body.createdDate)
    if (body.scheduledDate) body.scheduledDate = new Date(body.scheduledDate)
    if (body.completedDate) body.completedDate = new Date(body.completedDate)
    const act = await prisma.opportunityActivity.create({ data: body })
    return NextResponse.json(act, { status: 201 })
  } catch (error) {
    console.error('[API_ACTIVITIES_POST]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}