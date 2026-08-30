#!/usr/bin/env node

import 'dotenv/config'
import { URL } from 'node:url'

const failures = []
const warnings = []
const env = process.env

function requiredSecret(name, min = 32) {
  const value = String(env[name] || '')
  if (!value) failures.push(`${name} is missing`)
  else if (value.length < min) failures.push(`${name} is shorter than ${min} characters`)
  else if (/REPLACE_WITH|changeme|password|secret/i.test(value)) failures.push(`${name} looks like a placeholder/default`)
  return value
}

const auth = requiredSecret('NEXTAUTH_SECRET', 32)
requiredSecret('CUSTOMER_PORTAL_SECRET', 32)
requiredSecret('INTERNAL_API_SECRET', 32)
const mfaKey = requiredSecret('MFA_ENCRYPTION_KEY', 32)
const mfaChallenge = requiredSecret('MFA_CHALLENGE_SECRET', 32)

if (env.MFA_ENFORCE_PRIVILEGED !== 'true') failures.push('MFA_ENFORCE_PRIVILEGED must be true for security closure')
if (env.SETUP_ADMIN_SECRET) failures.push('SETUP_ADMIN_SECRET must be removed after initial provisioning')

for (const key of ['NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL']) {
  const raw = String(env[key] || '')
  if (!raw) {
    failures.push(`${key} is missing`)
    continue
  }
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') failures.push(`${key} must use https://`)
    if (url.username || url.password) failures.push(`${key} must not contain credentials`)
  } catch {
    failures.push(`${key} is not a valid URL`)
  }
}

const dbRaw = String(env.DATABASE_URL || env.POSTGRES_URL || '')
if (!dbRaw) {
  failures.push('DATABASE_URL/POSTGRES_URL is missing')
} else {
  try {
    const db = new URL(dbRaw)
    if (!['postgres:', 'postgresql:'].includes(db.protocol)) failures.push('Database URL must use PostgreSQL')
    const host = db.hostname.toLowerCase()
    const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
    const privateV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    if (!localHosts.has(host) && !privateV4) warnings.push(`Database host ${host} is not localhost/private; verify firewall and TLS`)
    if (!db.username) failures.push('Database URL has no application username')
    if (!db.password) failures.push('Database URL has no password')
    if (/^(postgres|root)$/i.test(decodeURIComponent(db.username))) failures.push('ERP must not use the PostgreSQL superuser/root account')
  } catch {
    failures.push('DATABASE_URL/POSTGRES_URL is invalid')
  }
}

const distinct = [auth, mfaKey, mfaChallenge].filter(Boolean)
if (new Set(distinct).size !== distinct.length) failures.push('Authentication and MFA secrets must be distinct')
if (String(env.NODE_ENV || '') !== 'production') warnings.push('NODE_ENV is not production')
if (env.SMTP_REQUIRE_TLS !== 'true' && env.EMAIL_PROVIDER === 'smtp') warnings.push('SMTP_REQUIRE_TLS should be true')
if (env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false') failures.push('SMTP_TLS_REJECT_UNAUTHORIZED must not be false')
if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) warnings.push('Distributed Redis rate limiting is not configured')

console.log('Deed ERP production security configuration check')
for (const warning of warnings) console.warn(`WARN: ${warning}`)
for (const failure of failures) console.error(`FAIL: ${failure}`)

if (failures.length) {
  console.error(`Security configuration gate FAILED (${failures.length} blocking issue(s)).`)
  process.exit(1)
}
console.log('Security configuration gate PASSED.')
