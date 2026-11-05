import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { hasModuleAccess } from '@/lib/auth/access'
import { claimPendingAction, releasePendingAction, verifyPendingAction } from '@/lib/jarvis/pending-actions'
import { getTool } from '@/lib/jarvis/tools'
import { checkToolPermission } from '@/lib/jarvis/permissions'
import { writeAiAuditLog } from '@/lib/jarvis/audit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jarvis/actions/confirm  { token }
 * The person clicked Confirm on a DIA card: create the previewed record.
 * Permissions are checked again as they stand now, and a card works once.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const user = session.user
    if (!hasModuleAccess(user, 'jarvis')) {
      return NextResponse.json({ error: 'DIA is not enabled for your account' }, { status: 403 })
    }
    const body = await request.json().catch(() => ({})) as { token?: unknown }
    const verified = verifyPendingAction(body.token, user.id)
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })
    const action = verified.action

    const tool = getTool(action.tool)
    if (!tool?.confirm) return NextResponse.json({ error: 'This action is no longer available' }, { status: 400 })
    const permission = checkToolPermission(user, tool)
    if (!permission.allowed) {
      await writeAiAuditLog({ userId: user.id, conversationId: action.conversationId, toolName: `${tool.name}:confirm`, permissionChecked: 'role_allowlist', allowed: false, errorMessage: permission.reason })
      return NextResponse.json({ error: `You don't have access to do this (${permission.reason}).` }, { status: 403 })
    }

    if (!(await claimPendingAction(action))) {
      return NextResponse.json({ error: 'This card was already confirmed.' }, { status: 409 })
    }

    const started = Date.now()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    let result
    try {
      result = await tool.confirm.execute({ user, conversationId: action.conversationId, ipAddress: ip }, action.input)
    } catch (err) {
      await releasePendingAction(action)
      const message = err instanceof Error ? err.message : 'Could not save'
      await writeAiAuditLog({ userId: user.id, conversationId: action.conversationId, toolName: `${tool.name}:confirm`, permissionChecked: tool.requiredPermission ?? tool.requiredModule ?? 'role_allowlist', allowed: true, errorMessage: message, durationMs: Date.now() - started, ipAddress: ip })
      return NextResponse.json({ error: message }, { status: 500 })
    }
    if (!result.ok) await releasePendingAction(action)

    await writeAiAuditLog({
      userId: user.id,
      conversationId: action.conversationId,
      toolName: `${tool.name}:confirm`,
      permissionChecked: tool.requiredPermission ?? tool.requiredModule ?? 'role_allowlist',
      allowed: true,
      resultMeta: { ok: result.ok, ref: result.ref ?? null, id: result.id ?? null },
      errorMessage: result.ok ? undefined : result.message,
      durationMs: Date.now() - started,
      ipAddress: ip,
    })

    // The chat keeps a record of what was saved, so follow-up questions know.
    if (result.ok && action.conversationId) {
      await prisma.aiMessage.create({
        data: { conversationId: action.conversationId, role: 'assistant', content: `Confirmed and saved: ${result.message}` },
      }).catch(() => undefined)
    }

    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  })
}
