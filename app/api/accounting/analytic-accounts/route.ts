import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
const input = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
}).strict()

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const analyticAccounts = await prisma.analyticAccount.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] })
    return NextResponse.json({ analyticAccounts })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const parsed = input.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid analytic account', issues: parsed.error.issues }, { status: 422 })
    const analyticAccount = await prisma.analyticAccount.create({
      data: { ...parsed.data, code: parsed.data.code.toUpperCase(), description: parsed.data.description || null },
    })
    return NextResponse.json({ analyticAccount }, { status: 201 })
  })
}
