import 'server-only'

import type { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/auth/db'
import { shouldUseSecureCookie } from '@/lib/auth/session-issuer'
import { writeFinancialAudit } from '@/lib/finance-audit'
import {
  PASSKEY_CHALLENGE_COOKIE, PASSKEY_CHALLENGE_TTL_SECONDS,
  openPasskeyChallenge, sealPasskeyChallenge,
  type PasskeyChallenge,
} from './passkey-core'

/**
 * Stored passkeys. Only the public key is kept: the face or fingerprint never
 * leaves the phone, and the private key never leaves its secure chip.
 * The table is created the first time it is needed (no deploy step).
 */
export type PasskeyRow = {
  id: string
  userId: string
  publicKey: Uint8Array<ArrayBuffer>
  counter: number
  transports: string[]
  name: string
  createdAt: string
  lastUsedAt: string | null
}

let ready: Promise<void> | null = null
export function ensurePasskeyTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS user_passkeys (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          public_key TEXT NOT NULL,
          counter BIGINT NOT NULL DEFAULT 0,
          transports TEXT,
          device_type TEXT,
          backed_up BOOLEAN,
          name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_used_at TIMESTAMPTZ
        )
      `
      await sql`CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys (user_id)`
    })().catch(error => { ready = null; throw error })
  }
  return ready
}

const toRow = (r: Record<string, unknown>): PasskeyRow => ({
  id: String(r.id),
  userId: String(r.user_id),
  publicKey: Uint8Array.from(Buffer.from(String(r.public_key), 'base64url')),
  counter: Number(r.counter) || 0,
  transports: String(r.transports || '').split(',').filter(Boolean),
  name: String(r.name || 'Passkey'),
  createdAt: new Date(String(r.created_at)).toISOString(),
  lastUsedAt: r.last_used_at ? new Date(String(r.last_used_at)).toISOString() : null,
})

export async function listPasskeys(userId: string): Promise<PasskeyRow[]> {
  await ensurePasskeyTable()
  const { rows } = await sql`SELECT * FROM user_passkeys WHERE user_id = ${userId} ORDER BY created_at DESC`
  return rows.map(r => toRow(r as Record<string, unknown>))
}

export async function findPasskey(id: string): Promise<PasskeyRow | null> {
  await ensurePasskeyTable()
  const { rows } = await sql`SELECT * FROM user_passkeys WHERE id = ${id} LIMIT 1`
  return rows.length ? toRow(rows[0] as Record<string, unknown>) : null
}

export async function savePasskey(input: {
  id: string; userId: string; publicKey: Uint8Array; counter: number; transports?: string[]
  deviceType?: string; backedUp?: boolean; name: string
}): Promise<void> {
  await ensurePasskeyTable()
  await sql`
    INSERT INTO user_passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name)
    VALUES (${input.id}, ${input.userId}, ${Buffer.from(input.publicKey).toString('base64url')}, ${input.counter},
            ${(input.transports ?? []).join(',')}, ${input.deviceType ?? null}, ${input.backedUp ?? null}, ${input.name.slice(0, 60)})
  `
}

export async function markPasskeyUsed(id: string, counter: number): Promise<void> {
  await sql`UPDATE user_passkeys SET counter = ${counter}, last_used_at = now() WHERE id = ${id}`
}

/** Remove one passkey (of this user), or all of a user's passkeys. */
export async function deletePasskeys(userId: string, id?: string): Promise<number> {
  await ensurePasskeyTable()
  const res = id
    ? await sql`DELETE FROM user_passkeys WHERE user_id = ${userId} AND id = ${id} RETURNING id`
    : await sql`DELETE FROM user_passkeys WHERE user_id = ${userId} RETURNING id`
  return res.rows.length
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ''
}

export function setPasskeyChallenge(response: NextResponse, request: NextRequest, challenge: Omit<PasskeyChallenge, 'exp'>, path = '/api/auth/passkey') {
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, sealPasskeyChallenge(challenge, secret()), {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureCookie(request),
    path,
    maxAge: PASSKEY_CHALLENGE_TTL_SECONDS,
  })
}

export function readPasskeyChallenge(request: NextRequest, mode: PasskeyChallenge['m']): PasskeyChallenge | null {
  const parsed = openPasskeyChallenge(request.cookies.get(PASSKEY_CHALLENGE_COOKIE)?.value, secret())
  return parsed && parsed.m === mode ? parsed : null
}

/** Each challenge answers one attempt: cleared on every reply that used it. */
export function clearPasskeyChallenge<T extends NextResponse>(response: T, request: NextRequest, path = '/api/auth/passkey'): T {
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, '', { httpOnly: true, sameSite: 'strict', secure: shouldUseSecureCookie(request), path, maxAge: 0 })
  return response
}

export async function auditPasskey(action: 'passkey.added' | 'passkey.removed' | 'passkey.signin', actorId: string, targetId: string, details: Record<string, unknown>) {
  await writeFinancialAudit({
    userId: actorId,
    action,
    entityType: 'user',
    entityId: targetId,
    newValues: details,
  }).catch(error => console.error('[passkeys] audit entry not written:', error instanceof Error ? error.message : error))
}
