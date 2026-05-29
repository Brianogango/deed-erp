import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const settings = await prisma.companySetting.findFirst()
    return NextResponse.json(settings || {})
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const user = await requireRole(['director', 'finance_officer'])
    const body = await request.json()
    
    const existing = await prisma.companySetting.findFirst()
    
    let settings
    if (existing) {
      settings = await prisma.companySetting.update({
        where: { id: existing.id },
        data: { ...body, updatedById: user.id }
      })
    } else {
      settings = await prisma.companySetting.create({
        data: { ...body, updatedById: user.id }
      })
    }

    // Create Audit Log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'update_settings',
        entityType: 'company_settings',
        entityId: settings.id,
        newValues: body,
        oldValues: existing || {}
      }
    })

    return NextResponse.json(settings)
  })
}
