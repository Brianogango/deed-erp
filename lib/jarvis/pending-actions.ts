import 'server-only'

import crypto from 'node:crypto'
import prisma from '@/lib/prisma'

/**
 * A DIA write the user still has to confirm. The tool's preview runs in the
 * chat; the record is only created when the person clicks Confirm on the
 * card, which sends this signed token to /api/jarvis/actions/confirm. The
 * model never sees the token, so it cannot confirm on the user's behalf.
 */
export type PendingAction = {
  tool: string
  input: unknown
  userId: string
  conversationId: string | null
  nonce: string
  expiresAt: number
}

/** A confirmation card is good for 30 minutes. */
export const PENDING_ACTION_TTL_MS = 30 * 60_000

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || ''
  if (!value && process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not configured')
  return `dia-pending-action:${value || 'dev-only'}`
}

function sign(encoded: string): string {
  return crypto.createHmac('sha256', secret()).update(encoded).digest('base64url')
}

export function signPendingAction(action: Omit<PendingAction, 'nonce' | 'expiresAt'>, now = Date.now()): string {
  const payload: PendingAction = { ...action, nonce: crypto.randomUUID(), expiresAt: now + PENDING_ACTION_TTL_MS }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

export function verifyPendingAction(
  token: unknown,
  userId: string,
  now = Date.now(),
): { ok: true; action: PendingAction } | { ok: false; error: string } {
  if (typeof token !== 'string' || !token.includes('.') || token.length > 60_000) return { ok: false, error: 'Invalid confirmation' }
  const [encoded, signature] = token.split('.', 2)
  const expected = sign(encoded)
  if (!signature || signature.length !== expected.length
    || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { ok: false, error: 'Invalid confirmation' }
  }
  let action: PendingAction
  try {
    action = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PendingAction
  } catch {
    return { ok: false, error: 'Invalid confirmation' }
  }
  if (action.userId !== userId) return { ok: false, error: 'This confirmation belongs to another user' }
  if (!(action.expiresAt > now)) return { ok: false, error: 'This confirmation has expired — ask DIA again' }
  return { ok: true, action }
}

const CLAIM_TOOL = 'confirm_action'

/**
 * Mark a confirmation as used, once. Two clicks (or two tabs) on the same
 * card race on an advisory lock; only the first gets true.
 */
export async function claimPendingAction(action: PendingAction): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `dia-confirm:${action.nonce}`)
    const used = await tx.aiAuditLog.findFirst({
      where: { toolName: CLAIM_TOOL, resultMeta: { path: ['nonce'], equals: action.nonce } },
      select: { id: true },
    })
    if (used) return false
    await tx.aiAuditLog.create({
      data: {
        userId: action.userId,
        conversationId: action.conversationId,
        toolName: CLAIM_TOOL,
        permissionChecked: action.tool,
        allowed: true,
        resultMeta: { nonce: action.nonce, tool: action.tool },
      },
    })
    return true
  })
}

/** Let the card be clicked again when the write itself failed. */
export async function releasePendingAction(action: PendingAction): Promise<void> {
  await prisma.aiAuditLog.deleteMany({
    where: { toolName: CLAIM_TOOL, resultMeta: { path: ['nonce'], equals: action.nonce } },
  }).catch(() => undefined)
}
