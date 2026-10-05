/**
 * GET — Deed Express agents (id + name) for the "Brought by agent" picker on
 * sale orders and the till. Any signed-in user; no amounts or contact details.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { AGENT_TAG } from '@/lib/agents/agent-commissions'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const agents = await prisma.client.findMany({
      where: { tags: { array_contains: [AGENT_TAG] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ agents }, { headers: { 'Cache-Control': 'private, no-store' } })
  })
}
