import 'server-only'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

/**
 * Journals that could not be mirrored into Prisma.
 *
 * Why this file exists: Prisma is the sole reporting source of truth
 * (accountingReportSourceOfTruth() returns 'prisma'), but journals are still
 * posted into the deed_journalEntries blob by the client store and replayed
 * into journal_entries by mirrorJournalEntriesToPrisma.
 *
 * That replay can legitimately refuse an entry — an account missing from the
 * Chart of Accounts, an inactive account, a closed fiscal period, an
 * unbalanced set of lines. Until now the mirror counted those as `failed++`
 * and said nothing: no log, no ref, no reason. A refused journal is a
 * transaction that exists in the blob, is invisible in the Trial Balance,
 * the P&L and the Balance Sheet, and nobody is told.
 *
 * So every refusal is recorded here, keyed by journal ref, and surfaced by
 * the integrity suite's `journal_mirror_backlog` gate. The entry keeps its
 * place in the retry queue either way: the mirror only records a fingerprint
 * on success, so a failed ref is re-attempted on every later pass and clears
 * itself the moment the underlying cause is fixed.
 */

export const JOURNAL_MIRROR_FAILURE_KEY = 'journal_mirror_failures_v1'

export type JournalMirrorFailure = {
  ref: string
  reason: string
  source: string | null
  date: string | null
  amount: number | null
  attempts: number
  firstFailedAt: string
  lastFailedAt: string
}

export type JournalMirrorFailureMap = Record<string, JournalMirrorFailure>

/** The message a caller can act on, without leaking a stack trace into app_state. */
export function describeMirrorError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message.slice(0, 300)
  if (typeof err === 'string' && err.trim()) return err.trim().slice(0, 300)
  return 'Unknown mirror failure'
}

function entryAmount(entry: { lines?: unknown }): number | null {
  const lines = Array.isArray(entry.lines) ? entry.lines : null
  if (!lines) return null
  const total = lines.reduce(
    (sum: number, l: unknown) => sum + (Number((l as { debit?: unknown })?.debit) || 0),
    0,
  )
  return Math.round(total * 100) / 100
}

/**
 * Add or update one failure. Pure: takes the current map, returns the next.
 * `attempts` counts how many passes have refused this ref, which separates a
 * transient collision from a journal that will never post without a fix.
 */
export function recordJournalMirrorFailure(
  map: JournalMirrorFailureMap,
  entry: { ref: string; source?: unknown; date?: unknown; lines?: unknown },
  err: unknown,
  now: string = new Date().toISOString(),
): JournalMirrorFailureMap {
  const ref = String(entry.ref)
  const previous = map[ref]
  return {
    ...map,
    [ref]: {
      ref,
      reason: describeMirrorError(err),
      source: entry.source == null ? null : String(entry.source).slice(0, 40),
      date: entry.date == null ? null : String(entry.date).slice(0, 40),
      amount: entryAmount(entry),
      attempts: (previous?.attempts ?? 0) + 1,
      firstFailedAt: previous?.firstFailedAt ?? now,
      lastFailedAt: now,
    },
  }
}

/** Drop one ref — called when it mirrors successfully, or leaves the blob. */
export function clearJournalMirrorFailure(
  map: JournalMirrorFailureMap,
  ref: string,
): JournalMirrorFailureMap {
  if (!(ref in map)) return map
  const next = { ...map }
  delete next[ref]
  return next
}

/** Drop every ref no longer present in the blob, so the record cannot grow forever. */
export function pruneJournalMirrorFailures(
  map: JournalMirrorFailureMap,
  activeRefs: ReadonlySet<string>,
): JournalMirrorFailureMap {
  const next: JournalMirrorFailureMap = {}
  for (const [ref, failure] of Object.entries(map)) {
    if (activeRefs.has(ref)) next[ref] = failure
  }
  return next
}

export async function loadJournalMirrorFailures(): Promise<JournalMirrorFailureMap> {
  try {
    const state = await loadAppState([JOURNAL_MIRROR_FAILURE_KEY])
    const raw = state[JOURNAL_MIRROR_FAILURE_KEY]
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as JournalMirrorFailureMap
  } catch {
    // Never let the failure record itself break a mirror pass.
    return {}
  }
}

export async function saveJournalMirrorFailures(map: JournalMirrorFailureMap): Promise<void> {
  await saveStoreKeys({ [JOURNAL_MIRROR_FAILURE_KEY]: JSON.stringify(map) })
}

/** Newest first, so a caller showing ten of them shows the ten that matter. */
export function sortJournalMirrorFailures(map: JournalMirrorFailureMap): JournalMirrorFailure[] {
  return Object.values(map).sort((a, b) => b.lastFailedAt.localeCompare(a.lastFailedAt))
}
