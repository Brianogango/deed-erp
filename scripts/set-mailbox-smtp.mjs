#!/usr/bin/env node
/**
 * Ops helper: set department SMTP credentials in Contabo .env (no password echo).
 *
 *   node scripts/set-mailbox-smtp.mjs --request ops/set-mailbox-smtp-request.json
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function escapeEnvValue(value) {
  // Always double-quote so special chars (& % @ ( ) etc.) survive dotenv parsers.
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function upsertEnv(content, key, value) {
  const line = `${key}=${escapeEnvValue(value)}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(content)) return content.replace(re, line)
  const trimmed = content.replace(/\s*$/, '')
  return `${trimmed}\n${line}\n`
}

const requestPath = String(arg('--request', '')).trim()
if (!requestPath) fail('--request required')
const abs = resolve(ROOT, requestPath)
if (!existsSync(abs)) fail(`Request not found: ${abs}`)

const parsed = JSON.parse(readFileSync(abs, 'utf8'))
const salesUser = String(parsed.salesUser || 'sales@deed.co.ke').trim()
const salesPass = String(parsed.salesPass || '').trim()
const accountsUser = String(parsed.accountsUser || 'accounts@deed.co.ke').trim()
const accountsPass = String(parsed.accountsPass || '').trim()
const salesEmail = String(parsed.salesEmail || salesUser).trim()
const accountsEmail = String(parsed.accountsEmail || accountsUser).trim()
const restart = parsed.restart !== false
const envPath = String(parsed.envPath || '/var/www/deed-erp/.env').trim()

if (!salesPass) fail('salesPass required')
if (!accountsPass) fail('accountsPass required')
if (!existsSync(envPath)) fail(`.env not found at ${envPath}`)

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
copyFileSync(envPath, `${envPath}.bak-mailbox-${stamp}`)

let content = readFileSync(envPath, 'utf8')
content = upsertEnv(content, 'SALES_EMAIL', salesEmail)
content = upsertEnv(content, 'SALES_SMTP_USER', salesUser)
content = upsertEnv(content, 'SALES_SMTP_PASS', salesPass)
content = upsertEnv(content, 'ACCOUNTS_EMAIL', accountsEmail)
content = upsertEnv(content, 'ACCOUNTS_SMTP_USER', accountsUser)
content = upsertEnv(content, 'ACCOUNTS_SMTP_PASS', accountsPass)
writeFileSync(envPath, content, { mode: 0o600 })

const report = {
  envPath,
  updated: [
    'SALES_EMAIL',
    'SALES_SMTP_USER',
    'SALES_SMTP_PASS',
    'ACCOUNTS_EMAIL',
    'ACCOUNTS_SMTP_USER',
    'ACCOUNTS_SMTP_PASS',
  ],
  salesUser,
  accountsUser,
  salesPassSet: true,
  accountsPassSet: true,
  backup: `${envPath}.bak-mailbox-${stamp}`,
  restarted: false,
}

if (restart) {
  try {
    execSync('bash -lc "cd /var/www/deed-erp && (sudo pm2 restart deed-erp --update-env || pm2 restart deed-erp --update-env)"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    report.restarted = true
  } catch (err) {
    report.restartError = err instanceof Error ? err.message : String(err)
  }
}

console.log(JSON.stringify(report, null, 2))
