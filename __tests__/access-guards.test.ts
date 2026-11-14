/**
 * Build-failing guards for how access is granted.
 *
 * 1. Every API route checks a permission (directly, through a helper, or by
 *    delegating to a route that does) — or is listed below with the reason
 *    it is open.
 * 2. Role names do not appear outside lib/auth, except the kinds that are
 *    not access decisions: who is notified, approval routing, who counts as
 *    a technician or salesperson, and presentation.
 *
 * Adding a route or a role name? Check a permission instead (userCan /
 * requirePermission / useCan). Only list it here when it truly is one of
 * the reasons below.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'

const ROOT = process.cwd()
const API = join(ROOT, 'app/api')

function walk(dir: string, pick: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path, pick) : pick(name) ? [path] : []
  })
}

// ── 1. Routes ────────────────────────────────────────────────────────────────

/** Calls that decide access (permission checks, save/read rules, row scoping). */
const ACCESS_CHECK = new RegExp(String.raw`\b(requirePermission|userCan|assertPermission|hasPermission|canWriteStoreKey|canReadStoreKey|filterReadableStoreKeys|isDirector|allowedOnlyAsTechnician|canAccessRecord|invoiceReadScope|canReadInvoiceRow|loadViewerState|filterStoreValueForRole|salesVisibleToViewer|leadRole|canSeeLead|canEditLead|saleTransitionError|assertUserAccessChange|auditAreasFor|requireCreditUser|require[A-Z]\w*Editor|assertRepairAttachment\w*)\(|writePermission:`)
const DELEGATES = /from '(@\/app\/api\/[^']+\/route|\.\.?\/route)'/g

/** Open by design, by path prefix. */
const OPEN_PREFIXES: Array<[string, string]> = [
  ['auth/', 'signing in and out'],
  ['portal/', 'customer and rider links, checked by their token or job reference'],
  ['public/v1/', 'partner API, checked by the partner key'],
  ['webhooks/', 'provider callbacks, checked by their signature'],
  ['chat/', 'a person’s own conversations'],
  ['jarvis/', 'a person’s own assistant conversations (tools check permissions)'],
  ['notifications', 'a person’s own notifications and preferences'],
]

/** Open by design, one by one. */
const OPEN_ROUTES: Record<string, string> = {
  'agents/list': 'agent names for pickers',
  chatter: 'comments shown with a record the person already has open',
  'contact-persons': 'contact people for pickers (writes are retired)',
  'contact-persons/[id]': 'contact person lookup (writes are retired)',
  'doc-numbers': 'hands out the next document number',
  'hr-documents/mine': 'a person’s own HR documents',
  'integrations/calendar': 'a person’s own calendar',
  'mpesa/callback': 'Safaricom callback',
  'mpesa/status': 'whether M-Pesa is set up',
  'mpesa/stk-query': 'status of a payment request the person started',
  'repair-diagnosis-reports/[repairRef]': 'customer report link by job reference',
  'repair-photos/[repairRef]': 'customer photo link by job reference',
  'repair-qc-reports/[repairRef]': 'customer QC report link by job reference',
  'repairs/next-ref': 'hands out the next repair number',
  'sale-order-attachments/[soId]': 'attachments, checked against the uploader',
  staff: 'colleagues’ names for pickers (no account details)',
  'scan-purchase-document': 'reads a document image; saves nothing',
  'scan-receipt': 'reads a receipt image; saves nothing',
  'setup-admin': 'first-run only: needs SETUP_ADMIN_SECRET and refuses once a user exists',
  version: 'build version',
  'warranties/for-document': 'warranties of a document the person already has open',
  'warranties/link': 'warranty link lookup',
  'warranties/repairs': 'warranty lookup for a repair',
  'warranties/staff': 'warranty lookup by serial',
  'warranties/sync': 'issues missing warranties for paid sales (idempotent, runs for everyone)',
}

const routeName = (file: string) => relative(API, file).replace(/\/route\.ts$/, '')

function checksAccess(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  if (ACCESS_CHECK.test(src)) return true
  for (const m of src.matchAll(DELEGATES)) {
    const target = m[1].startsWith('@/') ? join(ROOT, `${m[1].slice(2)}.ts`) : normalize(join(dirname(file), `${m[1]}.ts`))
    if (existsSync(target) && checksAccess(target, seen)) return true
  }
  return false
}

describe('every API route checks a permission', () => {
  const routes = walk(API, n => n === 'route.ts')

  it('or is open on purpose, with the reason listed', () => {
    const unchecked = routes
      .filter(f => !checksAccess(f))
      .map(routeName)
      .filter(r => !OPEN_ROUTES[r] && !OPEN_PREFIXES.some(([p]) => r.startsWith(p)))
    expect(unchecked, `Routes with no permission check — add one (requirePermission / userCan), or list the reason above:\n${unchecked.join('\n')}`).toEqual([])
  })

  it('the open list names only routes that exist and still need it', () => {
    const names = new Set(routes.map(routeName))
    const stale = Object.keys(OPEN_ROUTES).filter(r => !names.has(r) || checksAccess(join(API, r, 'route.ts')))
    expect(stale, 'Remove these from OPEN_ROUTES').toEqual([])
  })
})

// ── 2. Role names ────────────────────────────────────────────────────────────

// Old names that are also module or mailbox names (sales, finance, inventory,
// admin, kilimall) are left out: they would match too much else.
const ROLE_NAME = /['"](director|admin_officer|finance_officer|inventory_officer|technical_lead|kilimall_officer|sales_rep|technician|super_admin|lead_tech|repair_tech)['"]\s*(?:[,\])}|&?:]|===|!==|\.includes)/

/** Lines that name a role without deciding access. */
const LINE_OK = /recipientRoles|userIdsWithRoles|\broles:\s*\[|escalationRoles|approverRole|key:\s*'technician'|id:\s*'technician'|level\b|role:\s*'director'/

/** Files that name roles for a reason other than access. */
const FILE_OK: Record<string, string> = {
  'lib/notifications/registry.ts': 'who is notified',
  'lib/expense-approval-chain.ts': 'approval routing (who approves at each level)',
  'lib/sales-approval-rules.ts': 'approval routing',
  'lib/sales-approval-rules.server.ts': 'approval routing',
  'lib/sales-approval-enforcement.server.ts': 'approval routing (roles that can approve a sales exception)',
  'lib/sales-flow-types.ts': 'approval routing (approval level types)',
  'lib/credit/credit-facility-rules.ts': 'credit approval levels',
  'lib/repair/assignable-technicians.ts': 'who counts as a technician',
  'lib/crm/lead-assignees.ts': 'who can be given a lead',
  'lib/sales/commission-closer.ts': 'who counts as a salesperson for commission',
  'lib/sales/rep-sales.ts': 'who counts as a salesperson',
  'lib/sales/repair-quote-revision.ts': 'the assigned technician',
  'lib/jarvis/tools/summarize-repairs.ts': 'a technician’s own jobs',
  'lib/my-work.ts': 'presentation: which work queues a role sees',
  'lib/dashboard-priority.ts': 'presentation: dashboard sections per role',
  'components/modules/Dashboard.tsx': 'presentation: dashboard sections per role',
  'components/layout/Sidebar.tsx': 'presentation: menu label',
  'components/layout/Topbar.tsx': 'presentation: page title',
  'components/modules/Settings.tsx': 'presentation: role badges and descriptions',
  'components/settings/AccessRoles.tsx': 'the role editor itself',
}

describe('role names stay in lib/auth', () => {
  it('outside it, only for notifications, approval routing, identity and presentation', () => {
    const files = ['app', 'components', 'hooks', 'lib']
      .flatMap(dir => walk(join(ROOT, dir), n => /\.(ts|tsx)$/.test(n)))
      .map(f => relative(ROOT, f))
      .filter(f => !f.startsWith('lib/auth/') && !FILE_OK[f])
    const hits = files.flatMap(f => readFileSync(join(ROOT, f), 'utf8').split('\n')
      .map((line, i) => ({ f, i: i + 1, line }))
      .filter(({ line }) => ROLE_NAME.test(line) && !LINE_OK.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)))
      .map(({ f, i, line }) => `${f}:${i}  ${line.trim().slice(0, 100)}`)
    expect(hits, `Role names used to decide access — use a permission (userCan / useCan) instead:\n${hits.join('\n')}`).toEqual([])
  })

  it('the file list names only files that exist', () => {
    expect(Object.keys(FILE_OK).filter(f => !existsSync(join(ROOT, f)))).toEqual([])
  })
})
