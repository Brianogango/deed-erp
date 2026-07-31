import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'
import { persistStoreJournalEntry } from '@/lib/accounting/journal-service'

const ACCOUNT_HASH_KEY = 'account_mirror_hashes_v1'
const JOURNAL_HASH_KEY = 'journal_mirror_hashes_v1'

function fingerprint(value: unknown): string {
  return createHash('md5').update(JSON.stringify(value)).digest('hex')
}

let _accountsRunning = false
let _journalsRunning = false

/** Mirror deed_accounts → account_codes. Never deletes blob or table rows. */
export async function mirrorAccountsToPrisma(accountsInput: unknown, opts: { force?: boolean } = {}) {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_accountsRunning) return result
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
      } catch {
        result.failed++
      }
    }

    if (dirty) {
      await saveStoreKeys({ [ACCOUNT_HASH_KEY]: JSON.stringify(nextHashes) })
    }
    return result
  } finally {
    _accountsRunning = false
  }
}

/** Mirror deed_journalEntries → journal_entries. Never deletes. */
export async function mirrorJournalEntriesToPrisma(entriesInput: unknown, opts: { force?: boolean } = {}) {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_journalsRunning) return result
  _journalsRunning = true
  try {
    const entries: any[] = typeof entriesInput === 'string' ? JSON.parse(entriesInput) : (entriesInput as any[])
    if (!Array.isArray(entries) || entries.length === 0) return result

    const state = await loadAppState([JOURNAL_HASH_KEY])
    const hashes: Record<string, string> = (!opts.force && state[JOURNAL_HASH_KEY] && typeof state[JOURNAL_HASH_KEY] === 'object')
      ? state[JOURNAL_HASH_KEY] as Record<string, string>
      : {}
    const nextHashes = { ...hashes }
    let dirty = false

    for (const e of entries) {
      const ref = String(e?.ref ?? '').trim()
      if (!ref || !Array.isArray(e.lines) || e.lines.length === 0) continue
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
      } catch {
        result.failed++
      }
    }

    if (dirty) {
      await saveStoreKeys({ [JOURNAL_HASH_KEY]: JSON.stringify(nextHashes) })
    }
    return result
  } finally {
    _journalsRunning = false
  }
}
