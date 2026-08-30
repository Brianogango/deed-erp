import { NextResponse } from 'next/server'

import { getServerSession } from '@/lib/auth/server'
import { listAuthUsers } from '@/lib/auth/users-repository'
import { sql } from '@/lib/auth/db'
import { readEnvFile } from '@/lib/security/production-env'
import { SESSION_TTL_SECONDS } from '@/lib/auth/session-policy'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password-policy'

type DbRow = Record<string, unknown>

async function safeRows(strings: TemplateStringsArray, ...values: unknown[]): Promise<DbRow[]> {
  try {
    const result = await sql(strings, ...values)
    return result.rows
  } catch {
    return []
  }
}

function iso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function splitCsv(value: string | undefined): string[] {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 50)
}

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!['director', 'admin_officer', 'finance_officer'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await listAuthUsers()
  const failedLoginAttempts = users.reduce((sum, user) => sum + Math.max(0, Number(user.failedLoginAttempts || 0)), 0)

  const sessionRows = await safeRows`
    SELECT
      s.id,
      s.user_id,
      s.ip_address,
      s.user_agent,
      s.expires_at,
      s.created_at,
      u.name,
      u.username
    FROM user_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > NOW()
    ORDER BY s.created_at DESC
    LIMIT 12
  `

  const auditRows = await safeRows`
    SELECT
      a.id,
      a.user_id,
      a.action,
      a.entity_type,
      a.entity_key,
      a.ip_address,
      a.created_at,
      u.name,
      u.username
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT 8
  `

  const mfaRows = await safeRows`
    SELECT
      COUNT(*) FILTER (WHERE enabled = true) AS enabled_count,
      COUNT(*) AS enrolled_count
    FROM user_mfa
  `

  const apiRows = await safeRows`
    SELECT COUNT(*) AS active_count
    FROM partner_api_keys
    WHERE is_active = true AND revoked_at IS NULL
  `

  let envValues: Record<string, string> = {}
  try {
    envValues = readEnvFile().values
  } catch {
    envValues = {}
  }

  const mfaEnforced = String(envValues.MFA_ENFORCE_PRIVILEGED ?? process.env.MFA_ENFORCE_PRIVILEGED ?? '') === 'true'
  const rotatedAt = envValues.SECURITY_SECRETS_ROTATED_AT || process.env.SECURITY_SECRETS_ROTATED_AT || null
  const ipAllowlist = splitCsv(envValues.SECURITY_IP_ALLOWLIST || process.env.SECURITY_IP_ALLOWLIST)
  const privilegedUsers = users.filter(user => ['director', 'admin_officer', 'finance_officer'].includes(user.role) && user.active).length
  const activeMfaUsers = Number(mfaRows[0]?.enabled_count || 0)
  const enrolledMfaUsers = Number(mfaRows[0]?.enrolled_count || 0)
  const activeApiKeys = Number(apiRows[0]?.active_count || 0)

  const sessions = sessionRows.map(row => ({
    id: asString(row.id),
    userId: asString(row.user_id),
    name: asString(row.name) || asString(row.username) || 'ERP user',
    username: asString(row.username),
    ipAddress: asString(row.ip_address) || '—',
    userAgent: asString(row.user_agent) || 'Unknown browser',
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  }))

  const audits = auditRows.map(row => ({
    id: asString(row.id),
    name: asString(row.name) || asString(row.username) || 'System',
    username: asString(row.username),
    action: asString(row.action) || 'Security event',
    entityType: asString(row.entity_type),
    entityKey: asString(row.entity_key),
    ipAddress: asString(row.ip_address) || '—',
    createdAt: iso(row.created_at),
  }))

  const lastSecurityEventAt = audits[0]?.createdAt || null

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      mfaEnforced,
      activeSessions: Math.max(sessions.length, 1),
      failedLogins24h: failedLoginAttempts,
      lastSecurityEventAt,
      privilegedUsers,
      activeMfaUsers,
      enrolledMfaUsers,
      activeApiKeys,
      rotatedAt,
      ipAllowlist,
    },
    passwordPolicy: {
      minimumLength: MIN_PASSWORD_LENGTH,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: false,
      requireSpecial: false,
      rotationDays: 0,
      preventReuseCount: 5,
    },
    sessionPolicy: {
      jwtHours: Math.round(SESSION_TTL_SECONDS / 3600),
      inactivityMinutes: 30,
    },
    securityControls: {
      defaultDenyStore: true,
      sameOriginWrites: true,
      csp: true,
      hsts: true,
      uploadGuards: true,
      auditLogging: true,
      rowLevelAuthorization: true,
    },
    sessions,
    audits,
    api: {
      activeKeys: activeApiKeys,
      readRateLimitPerMinute: 1200,
      writeRateLimitPerMinute: 240,
      partnerRateLimitPerMinute: 120,
    },
  }, {
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
