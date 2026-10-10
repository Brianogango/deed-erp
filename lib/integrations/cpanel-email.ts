import 'server-only'
import { randomInt } from 'node:crypto'

/**
 * Mailbox management through the cPanel UAPI (Email::add_pop, suspend_login, list_pops).
 *
 * Configure on the server, never in code:
 *   CPANEL_HOST         hostname of the cPanel server, e.g. server1.example.com
 *   CPANEL_PORT         optional, defaults to 2083
 *   CPANEL_USER         the cPanel account username
 *   CPANEL_API_TOKEN    token from cPanel > Security > Manage API Tokens
 *   CPANEL_MAIL_DOMAIN  the domain the mailboxes belong to, e.g. deed.co.ke
 */

export interface CpanelConfig { host: string; port: number; user: string; token: string; domain: string }

export function cpanelConfig(env: NodeJS.ProcessEnv = process.env): CpanelConfig | null {
  const rawHost = String(env.CPANEL_HOST ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const portInHost = /:(\d+)$/.exec(rawHost)?.[1]
  const host = rawHost.replace(/:\d+$/, '')
  const user = String(env.CPANEL_USER ?? '').trim()
  const token = String(env.CPANEL_API_TOKEN ?? '').trim()
  const domain = String(env.CPANEL_MAIL_DOMAIN ?? '').trim().toLowerCase()
  if (!host || !user || !token || !domain) return null
  return { host, port: Number(env.CPANEL_PORT) || Number(portInHost) || 2083, user, token, domain }
}

export class CpanelError extends Error {
  status: number
  constructor(message: string, status = 502) { super(message); this.status = status }
}

async function uapi(cfg: CpanelConfig, fn: string, params: Record<string, string | number>): Promise<{ data: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(`https://${cfg.host}:${cfg.port}/execute/Email/${fn}`, {
      method: 'POST',
      headers: {
        Authorization: `cpanel ${cfg.user}:${cfg.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // Parameters go in the body so a password never lands in a URL or access log.
      body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
      signal: controller.signal,
    })
    const body = await res.json().catch(() => null) as { status?: number; errors?: string[] | null; data?: unknown } | null
    if (res.status === 401 || res.status === 403) throw new CpanelError('cPanel rejected the API token. Check CPANEL_USER and CPANEL_API_TOKEN.', 502)
    if (!res.ok || !body) throw new CpanelError(`cPanel returned HTTP ${res.status}`, 502)
    if (body.status !== 1) throw new CpanelError((body.errors && body.errors.join('; ')) || 'cPanel refused the request', 409)
    return { data: body.data }
  } catch (e) {
    if (e instanceof CpanelError) throw e
    const aborted = e instanceof Error && e.name === 'AbortError'
    throw new CpanelError(aborted ? 'cPanel did not respond in time' : 'Could not reach cPanel', 502)
  } finally {
    clearTimeout(timer)
  }
}

/** Letters, digits, dot, dash and underscore only; a mailbox name cPanel will accept. */
export function cleanMailboxName(raw: string): string {
  return String(raw ?? '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '.').replace(/^[.-]+|[.-]+$/g, '').replace(/\.{2,}/g, '.').slice(0, 60)
}

/** firstname.lastname, the common convention. */
export function suggestMailboxName(firstName: string, lastName: string): string {
  const first = cleanMailboxName(firstName.split(/\s+/)[0] ?? '')
  const last = cleanMailboxName(lastName.split(/\s+/).slice(-1)[0] ?? '')
  return [first, last].filter(Boolean).join('.') || 'user'
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%*-_'

/** Strong random password with every character class, avoiding look-alike characters. */
export function generateMailboxPassword(length = 16): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS
  const pick = (set: string) => set[randomInt(set.length)]
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < length) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export async function mailboxExists(cfg: CpanelConfig, local: string): Promise<boolean> {
  const { data } = await uapi(cfg, 'list_pops', { regex: `^${local.replace(/[.]/g, '\\.')}@`, domain: cfg.domain })
  const rows = Array.isArray(data) ? data as Array<{ email?: string; login?: string }> : []
  const want = `${local}@${cfg.domain}`
  return rows.some(r => String(r.email ?? r.login ?? '').toLowerCase() === want)
}

export async function createMailbox(cfg: CpanelConfig, local: string, password: string, quotaMb = 2048): Promise<string> {
  const name = cleanMailboxName(local)
  if (!name) throw new CpanelError('Enter a valid mailbox name', 400)
  if (await mailboxExists(cfg, name)) throw new CpanelError(`${name}@${cfg.domain} already exists`, 409)
  await uapi(cfg, 'add_pop', { email: name, domain: cfg.domain, password, quota: quotaMb, skip_update_db: 1 })
  return `${name}@${cfg.domain}`
}

/** Blocks sign-in and keeps the mailbox and its mail, so nothing is lost on exit. */
export async function suspendMailbox(cfg: CpanelConfig, email: string): Promise<void> {
  const [local, domain] = String(email).toLowerCase().split('@')
  if (!local || domain !== cfg.domain) throw new CpanelError(`Only ${cfg.domain} mailboxes can be managed here`, 400)
  await uapi(cfg, 'suspend_login', { email: `${local}@${domain}` })
}
