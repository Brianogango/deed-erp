#!/usr/bin/env node
/**
 * Ops helper: diagnose outbound email config on Contabo (no secrets printed).
 *
 *   node scripts/diagnose-email.mjs
 *   node scripts/diagnose-email.mjs --request ops/diagnose-email-request.json
 *   node scripts/diagnose-email.mjs --logs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const out = {}
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const requestPath = String(arg('--request', '')).trim()
let wantLogs = process.argv.includes('--logs')
if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (existsSync(abs)) {
    const parsed = JSON.parse(readFileSync(abs, 'utf8'))
    wantLogs = Boolean(parsed.logs ?? wantLogs)
  }
}

const envPaths = [
  resolve(ROOT, '.env'),
  resolve(ROOT, '.env.local'),
  resolve(ROOT, '.env.production'),
  '/var/www/deed-erp/.env',
  '/root/deed-erp/.env',
]

const merged = { ...process.env }
const loadedFrom = []
for (const p of envPaths) {
  if (!existsSync(p)) continue
  const parsed = loadEnvFile(p)
  Object.assign(merged, parsed)
  loadedFrom.push(p)
}

function present(key) {
  const v = merged[key]
  return Boolean(v && String(v).trim())
}

function value(key) {
  return present(key) ? String(merged[key]).trim() : null
}

const provider = (value('EMAIL_PROVIDER') || (present('SMTP_HOST') ? 'smtp' : 'sendgrid')).toLowerCase()
const smtpUser = value('SMTP_USER')
const salesEmail = value('SALES_EMAIL') || 'sales@deed.co.ke'
const accountsEmail = value('ACCOUNTS_EMAIL') || 'accounts@deed.co.ke'
const emailFrom = value('EMAIL_FROM') || smtpUser
const salesSmtpUser = value('SALES_SMTP_USER')
const accountsSmtpUser = value('ACCOUNTS_SMTP_USER')

const issues = []
if (provider === 'smtp') {
  if (!present('SMTP_HOST')) issues.push('SMTP_HOST missing')
  if (!present('SMTP_USER')) issues.push('SMTP_USER missing')
  if (!present('SMTP_PASS')) issues.push('SMTP_PASS missing')
  // Contabo/cPanel often rejects From addresses that are not the authenticated
  // mailbox (or an allowed alias). Quotes force From=SALES_EMAIL; invoices
  // force From=ACCOUNTS_EMAIL — mismatch with SMTP_USER is a common failure.
  if (smtpUser && salesEmail && salesEmail.toLowerCase() !== smtpUser.toLowerCase() && !salesSmtpUser) {
    issues.push(
      `Quote emails send From=${salesEmail} but SMTP auth is ${smtpUser} (no SALES_SMTP_USER). ` +
      `Mail server may reject sender unless ${salesEmail} is an alias of ${smtpUser}.`,
    )
  }
  if (smtpUser && accountsEmail && accountsEmail.toLowerCase() !== smtpUser.toLowerCase() && !accountsSmtpUser) {
    issues.push(
      `Invoice emails send From=${accountsEmail} but SMTP auth is ${smtpUser} (no ACCOUNTS_SMTP_USER). ` +
      `Mail server may reject sender unless ${accountsEmail} is an alias of ${smtpUser}.`,
    )
  }
} else if (provider === 'sendgrid') {
  if (!present('SENDGRID_API_KEY')) issues.push('SENDGRID_API_KEY missing')
}

const report = {
  loadedFrom,
  nodeEnv: value('NODE_ENV'),
  provider,
  smtp: {
    host: value('SMTP_HOST'),
    port: value('SMTP_PORT') || '587',
    secure: value('SMTP_SECURE') || 'false',
    userSet: present('SMTP_USER'),
    passSet: present('SMTP_PASS'),
    user: smtpUser,
  },
  fromAddresses: {
    EMAIL_FROM: emailFrom,
    SALES_EMAIL: salesEmail,
    ACCOUNTS_EMAIL: accountsEmail,
    HR_EMAIL: value('HR_EMAIL'),
  },
  dedicatedSmtpUsers: {
    SALES_SMTP_USER: salesSmtpUser,
    ACCOUNTS_SMTP_USER: accountsSmtpUser,
    HR_SMTP_USER: value('HR_SMTP_USER'),
  },
  issues,
}

console.log(JSON.stringify(report, null, 2))

if (wantLogs) {
  console.log('\n--- recent email-related process logs ---')
  try {
    const out = execSync(
      "bash -lc 'pm2 logs deed-erp --lines 200 --nostream 2>/dev/null || journalctl -u deed-erp -n 200 --no-pager 2>/dev/null || true'",
      { encoding: 'utf8', maxBuffer: 2_000_000 },
    )
    const lines = out.split('\n').filter(l =>
      /\[email\]|send-quote|invoices\] Send|SMTP|Quote email|Invoice email|messaging\]/i.test(l),
    )
    console.log(lines.slice(-80).join('\n') || '(no matching log lines)')
  } catch (err) {
    console.log(`(could not read logs: ${err instanceof Error ? err.message : err})`)
  }
}
