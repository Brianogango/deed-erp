#!/usr/bin/env node
/**
 * Ops helper: send a real SMTP test for sales + accounts mailboxes.
 * Uses Contabo-safe From (EMAIL_FROM / SMTP_USER) and department Reply-To.
 *
 *   node scripts/test-mailbox-email.mjs --request ops/test-mailbox-email-request.json
 *   node scripts/test-mailbox-email.mjs --to hello@deed.co.ke --mailboxes sales,accounts
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const require = createRequire(import.meta.url)

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
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
    if (!(key in process.env)) process.env[key] = value
  }
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

for (const p of [
  resolve(ROOT, '.env'),
  resolve(ROOT, '.env.local'),
  resolve(ROOT, '.env.production'),
  '/var/www/deed-erp/.env',
]) {
  loadEnvFile(p)
}

const requestPath = String(arg('--request', '')).trim()
let cfg = {
  to: String(arg('--to', '')).trim(),
  mailboxes: String(arg('--mailboxes', 'sales,accounts')).split(',').map(s => s.trim()).filter(Boolean),
  dryRun: process.argv.includes('--dry-run'),
}
if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  cfg = {
    to: String(parsed.to ?? cfg.to).trim(),
    mailboxes: Array.isArray(parsed.mailboxes)
      ? parsed.mailboxes.map(s => String(s).trim()).filter(Boolean)
      : cfg.mailboxes,
    dryRun: Boolean(parsed.dryRun ?? cfg.dryRun),
  }
}

if (!cfg.to || !cfg.to.includes('@')) {
  // Default to the SMTP login itself so we never spam an external inbox.
  cfg.to = String(process.env.SMTP_USER || process.env.EMAIL_FROM || '').trim()
}
if (!cfg.to || !cfg.to.includes('@')) fail('Provide --to / to, or set SMTP_USER')

const host = process.env.SMTP_HOST
const port = Number(process.env.SMTP_PORT) || 587
const secure = process.env.SMTP_SECURE === 'true'
const smtpUser = process.env.SMTP_USER || ''
const smtpPass = process.env.SMTP_PASS || ''
const emailFrom = process.env.EMAIL_FROM || smtpUser

if (!host) fail('SMTP_HOST missing')
if (!smtpUser || !smtpPass) fail('SMTP_USER / SMTP_PASS missing')

function identityFor(mailbox) {
  const dedicated = {
    sales: { user: process.env.SALES_SMTP_USER, pass: process.env.SALES_SMTP_PASS, replyTo: process.env.SALES_EMAIL || 'sales@deed.co.ke' },
    accounts: { user: process.env.ACCOUNTS_SMTP_USER, pass: process.env.ACCOUNTS_SMTP_PASS, replyTo: process.env.ACCOUNTS_EMAIL || 'accounts@deed.co.ke' },
    hr: { user: process.env.HR_SMTP_USER, pass: process.env.HR_SMTP_PASS, replyTo: process.env.HR_EMAIL || 'hr@deed.co.ke' },
    default: { user: smtpUser, pass: smtpPass, replyTo: emailFrom },
  }[mailbox] || { user: smtpUser, pass: smtpPass, replyTo: emailFrom }

  const hasDedicated = !!(dedicated.user && dedicated.pass)
  return {
    mailbox,
    authUser: hasDedicated ? dedicated.user : smtpUser,
    authPass: hasDedicated ? dedicated.pass : smtpPass,
    from: hasDedicated ? (dedicated.replyTo || dedicated.user) : emailFrom,
    replyTo: dedicated.replyTo || emailFrom,
    dedicatedAuth: hasDedicated,
  }
}

let nodemailer
try {
  nodemailer = require('/var/www/deed-erp/node_modules/nodemailer')
} catch {
  try {
    nodemailer = require(resolve(ROOT, 'node_modules/nodemailer'))
  } catch {
    fail('nodemailer not found — run from /var/www/deed-erp after npm/pnpm install')
  }
}

const results = []
for (const mailbox of cfg.mailboxes) {
  const id = identityFor(mailbox)
  const payload = {
    mailbox,
    to: cfg.to,
    from: id.from,
    replyTo: id.replyTo,
    authUser: id.authUser,
    dedicatedAuth: id.dedicatedAuth,
  }
  if (cfg.dryRun) {
    results.push({ ...payload, success: true, dryRun: true })
    continue
  }
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: id.authUser, pass: id.authPass },
      tls: { rejectUnauthorized: false },
    })
    const info = await transporter.sendMail({
      from: id.from,
      to: cfg.to,
      replyTo: id.replyTo,
      subject: `Deed ERP mailbox test — ${mailbox}`,
      text: `Live SMTP test for mailbox "${mailbox}".\nFrom: ${id.from}\nReply-To: ${id.replyTo}\nAuth: ${id.authUser}\nTime: ${new Date().toISOString()}`,
      html: `<p>Live SMTP test for mailbox <strong>${mailbox}</strong>.</p>
             <p>From: ${id.from}<br/>Reply-To: ${id.replyTo}<br/>Auth: ${id.authUser}</p>
             <p>${new Date().toISOString()}</p>`,
    })
    results.push({
      ...payload,
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    })
  } catch (err) {
    results.push({
      ...payload,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      code: err?.code,
      responseCode: err?.responseCode,
      response: err?.response,
    })
  }
}

const summary = {
  to: cfg.to,
  host,
  emailFrom,
  dryRun: cfg.dryRun,
  results,
  allOk: results.every(r => r.success),
}
console.log(JSON.stringify(summary, null, 2))
if (!summary.allOk) process.exit(2)
