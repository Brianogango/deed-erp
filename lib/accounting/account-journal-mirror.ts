import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'
import { persistStoreJournalEntry } from '@/lib/accounting/journal-service'
import {
  clearJournalMirrorFailure,
  loadJournalMirrorFailures,
  pruneJournalMirrorFailures,
  recordJournalMirrorFailure,
  saveJournalMirrorFailures,
  type JournalMirrorFailureMap,
} from '@/lib/accounting/journal-mirror-failures'

const ACCOUNT_HASH_KEY = 'account_mirror_hashes_v1'
const JOURNAL_HASH_KEY = 'journal_mirror_hashes_v1'

/**
 * Bump when the mapping below changes in a way that must rewrite rows already
 * mirrored. The version is folded into every fingerprint, so raising it
 * invalidates the whole hash record once and forces a full re-mirror pass.
 * Replaying is safe: createJournalEntryWith returns the existing row on a ref
 * collision rather than double-posting.
 */
const MIRROR_FINGERPRINT_VERSION = 1

function fingerprint(value: unknown): string {
  return createHash('md5')
    .update(JSON.stringify({ v: MIRROR_FINGERPRINT_VERSION, payload: value }))
    .digest('hex')
}

let _accountsRunning = false
let _accountsPendingRerun = false
let _journalsRunning = false
// Set when a journal write arrives while a pass is already running. Without
// this the second write returned immediately and its journals waited for some
// later, uncontended save to replay them — and if no such save came, they
// stayed out of journal_entries, which is what every report reads.
let _journalsPendingRerun = false

/** Mirror deed_accounts → account_codes. Never deletes blob or table rows. */
export async function mirrorAccountsToPrisma(accountsInput: unknown, opts: { force?: boolean } = {}) {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_accountsRunning) {
    _accountsPendingRerun = true
    return result
  }
  _accountsRunning = true
  try {
    const accounts: any[] = typeof accountsInput === 'string' ? JSON.parse(accountsInput) : (accountsInput as any[])
    if (!Array.isArray(accounts) || accounts.length === 0) return result

    const state = await loadAppState([ACCOUNT_HASH_KEY])
    const hashes: Record<string, string> = (!opts.force && state[ACCOUNT_HASH_KEY] && typeof state[ACCOUNT_HASH_KEY] === 'object')
      ? state[ACCOUNT_HASH_KEY] as Record<string, string>
      : {}
    const nextHashes = { ...hashes }
    let dirty = false

    for (const a of accounts) {
      const code = String(a?.code ?? '').trim()
      if (!code) continue
      try {
        const mapped = {
          code,
          name: String(a.name ?? code).slice(0, 200),
          accountType: String(a.type ?? 'asset').slice(0, 20),
          accountGroup: a.group ? String(a.group).slice(0, 120) : null,
          subGroup: a.subGroup ? String(a.subGroup).slice(0, 120) : null,
          isActive: a.isActive !== false,
          isDynamic: !!a.isDynamic,
          dynamicKey: a.dynamicKey ? String(a.dynamicKey).slice(0, 40) : null,
          notes: a.notes ? String(a.notes) : null,
        }
        // Seed/static blob balances must NEVER overwrite relational balances —
        // live TB derives from journal_entry_lines.
        const createBalance = Number(a.balance ?? 0)
        const fp = fingerprint({ ...mapped, balance: createBalance })
        if (!opts.force && hashes[code] === fp) { result.skipped++; continue }

        await prisma.accountCode.upsert({
          where: { code },
          create: { id: uuidFromKey('account', code), ...mapped, balance: createBalance },
          update: mapped,
        })
        nextHashes[code] = fp
        dirty = true
        result.mirrored++
      } catch (err) {
        // An account that never reaches account_codes makes every journal
        // touching it unpostable, so say which one and why.
        console.error(`[account-mirror] ${code} failed:`, err)
        result.failed++
      }
    }

    const activeCodes = new Set(accounts.map((a: any) => String(a?.code ?? '').trim()).filter(Boolean))
    for (const code of Object.keys(nextHashes)) {
      if (!activeCodes.has(code)) { delete nextHashes[code]; dirty = true }
    }

    if (dirty) {
      await saveStoreKeys({ [ACCOUNT_HASH_KEY]: JSON.stringify(nextHashes) })
    }
    return result
  } finally {
    _accountsRunning = false
    if (_accountsPendingRerun) {
      _accountsPendingRerun = false
      void rerunFromFreshBlob('deed_accounts', mirrorAccountsToPrisma, '[account-mirror]')
    }
  }
}

/**
 * Replay the freshest blob after a pass that ran while another write was
 * arriving. The queued write carried a newer array than the pass just
 * mirrored, so re-reading is the point — replaying the same input would not
 * pick it up.
 */
async function rerunFromFreshBlob(
  key: string,
  mirror: (input: unknown) => Promise<unknown>,
  tag: string,
): Promise<void> {
  try {
    const fresh = await loadAppState([key])
    const raw = fresh[key]
    const rows = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(rows) && rows.length > 0) await mirror(rows)
  } catch (err) {
    console.error(`${tag} trailing rerun failed:`, err)
  }
}

/**
 * Mirror deed_journalEntries → journal_entries. Never deletes.
 *
 * Every refusal is recorded against its ref (see journal-mirror-failures) and
 * retried on the next pass, because journal_entries is what the Trial Balance,
 * the P&L and the Balance Sheet read: a journal that does not arrive here is
 * a transaction missing from the accounts.
 */
export async function mirrorJournalEntriesToPrisma(entriesInput: unknown, opts: { force?: boolean } = {}) {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_journalsRunning) {
    _journalsPendingRerun = true
    return result
  }
  _journalsRunning = true
  try {
    const entries: any[] = typeof entriesInput === 'string' ? JSON.parse(entriesInput) : (entriesInput as any[])
    if (!Array.isArray(entries) || entries.length === 0) return result

    const state = await loadAppState([JOURNAL_HASH_KEY])
    const hashes: Record<string, string> = (!opts.force && state[JOURNAL_HASH_KEY] && typeof state[JOURNAL_HASH_KEY] === 'object')
      ? state[JOURNAL_HASH_KEY] as Record<string, string>
      : {}
    const nextHashes = { ...hashes }
    const priorFailures = await loadJournalMirrorFailures()
    let failures: JournalMirrorFailureMap = priorFailures
    let dirty = false

    for (const e of entries) {
      const ref = String(e?.ref ?? '').trim()
      if (!ref || !Array.isArray(e.lines) || e.lines.length === 0) continue
      // Blob payroll journals are a display-side summary; the statutory GL
      // journal is created by the payroll posting transaction with the same
      // business document. Mirroring the blob copy would double-post payroll.
      if (String(e?.source ?? '') === 'payroll') { result.skipped++; continue }
      try {
        const fp = fingerprint({
          ref,
          date: e.date,
          source: e.source,
          description: e.description,
          lines: e.lines,
          invoiceId: e.invoiceId,
          paymentId: e.paymentId,
        })
        if (!opts.force && hashes[ref] === fp) { result.skipped++; continue }

        await persistStoreJournalEntry({
          id: e.id,
          ref,
          date: e.date,
          source: e.source,
          description: e.description,
          invoiceId: e.invoiceId,
          paymentId: e.paymentId,
          lines: e.lines,
        })
        nextHashes[ref] = fp
        dirty = true
        result.mirrored++
        failures = clearJournalMirrorFailure(failures, ref)
      } catch (err) {
        // No fingerprint is written, so this ref is retried on every later
        // pass and clears itself once the cause is fixed. What changes here
        // is that it stops being silent.
        failures = recordJournalMirrorFailure(failures, { ...e, ref }, err)
        console.error(`[journal-mirror] ${ref} refused:`, err)
        result.failed++
      }
    }

    const activeRefs = new Set(entries.map((e: any) => String(e?.ref ?? '').trim()).filter(Boolean))
    for (const ref of Object.keys(nextHashes)) {
      if (!activeRefs.has(ref)) { delete nextHashes[ref]; dirty = true }
    }
    failures = pruneJournalMirrorFailures(failures, activeRefs)

    if (dirty) {
      await saveStoreKeys({ [JOURNAL_HASH_KEY]: JSON.stringify(nextHashes) })
    }
    if (JSON.stringify(failures) !== JSON.stringify(priorFailures)) {
      await saveJournalMirrorFailures(failures)
    }
    if (result.failed > 0) {
      console.error(
        `[journal-mirror] ${result.failed} journal(s) did not reach journal_entries and are missing from the reports`,
      )
    }
    return result
  } finally {
    _journalsRunning = false
    if (_journalsPendingRerun) {
      _journalsPendingRerun = false
      void rerunFromFreshBlob('deed_journalEntries', mirrorJournalEntriesToPrisma, '[journal-mirror]')
    }
  }
}
