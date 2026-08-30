#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const envPath = path.resolve(process.argv[2] || '.env')
const apply = process.argv.includes('--apply')
const confirm = process.env.SECURITY_ROTATION_CONFIRM === 'ROTATE_DEED_ERP_SECRETS'

if (!apply || !confirm) {
  console.error('Refusing to rotate secrets without --apply and SECURITY_ROTATION_CONFIRM=ROTATE_DEED_ERP_SECRETS')
  process.exit(2)
}
if (!fs.existsSync(envPath)) {
  console.error(`Environment file not found: ${envPath}`)
  process.exit(2)
}

const stat = fs.statSync(envPath)
if ((stat.mode & 0o077) !== 0) {
  console.error('Refusing to edit environment file with group/world permissions. Run chmod 600 first.')
  process.exit(2)
}

const original = fs.readFileSync(envPath, 'utf8')
const generated = () => crypto.randomBytes(48).toString('base64url')
const auth = generated()
const replacements = {
  AUTH_SECRET: auth,
  NEXTAUTH_SECRET: auth,
  CUSTOMER_PORTAL_SECRET: generated(),
  INTERNAL_API_SECRET: generated(),
  MFA_CHALLENGE_SECRET: generated(),
  CRON_SECRET: generated(),
  NOTIFICATION_WEBHOOK_SECRET: generated(),
  SECURITY_SECRETS_ROTATED_AT: new Date().toISOString(),
}

function setEnv(source, key, value) {
  const line = new RegExp(`^${key}=.*$`, 'm')
  if (line.test(source)) return source.replace(line, `${key}=${value}`)
  return `${source.replace(/\s*$/, '')}\n${key}=${value}\n`
}

let next = original
for (const [key, value] of Object.entries(replacements)) next = setEnv(next, key, value)
next = next.replace(/^SETUP_ADMIN_SECRET=.*$/gm, '# SETUP_ADMIN_SECRET=')

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${envPath}.bak-security-${stamp}`
fs.writeFileSync(backup, original, { mode: 0o600, flag: 'wx' })
fs.writeFileSync(envPath, next, { mode: 0o600 })
fs.chmodSync(envPath, 0o600)

console.log('Security secrets rotated without printing secret values.')
console.log(`Backup created: ${backup}`)
console.log('NEXTAUTH/AUTH rotation invalidates current ERP sessions by design.')
console.log('MFA_ENCRYPTION_KEY was intentionally NOT rotated; rotating it requires controlled MFA re-enrollment.')
console.log('Provider-owned secrets (SMTP, M-PESA, WhatsApp, Twilio, Google, AWS, SendGrid) must be rotated at their providers separately.')
