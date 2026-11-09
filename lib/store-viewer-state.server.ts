/**
 * Store collections exactly as one signed-in user receives them from
 * GET /api/store: keys they may not read removed, financial ledgers cut to
 * their slice, private fields redacted, finished records slimmed. Server
 * calculations that replace browser ones (the dashboard figures) read through
 * this, so they see the same rows the browser used to.
 */
import { withSharedReadModels } from '@/lib/read-model-cache'
import {
  canReadStoreKey, CONTENT_FILTERED_STORE_KEYS, filterStoreValueForRole, redactStoreValueForUser,
} from '@/lib/auth/authorization'
import { loadAppState } from '@/lib/server-store'
import { SLIM_RULES, slimCollection } from '@/lib/store-slim'

type Viewer = Parameters<typeof canReadStoreKey>[0]
type State = Record<string, unknown>

/** The per-user filtering GET /api/store applies, in place. */
export function filterStateForViewer<T extends State>(user: Viewer, state: T): T {
  const s = state as State
  for (const key of Object.keys(s)) {
    if (!canReadStoreKey(user, key)) delete s[key]
  }
  for (const key of Object.keys(s)) {
    if (CONTENT_FILTERED_STORE_KEYS.has(key)) s[key] = filterStoreValueForRole(user, key, s[key] as never)
    s[key] = redactStoreValueForUser(user, key, s[key] as never)
  }
  for (const key of Object.keys(s)) {
    if (SLIM_RULES[key]) s[key] = slimCollection(key, s[key])
  }
  return state
}

/** Loads the keys and filters them for the user, as GET /api/store does. */
export async function loadViewerState(user: Viewer, keys: string[]): Promise<State> {
  const wantsJournals = keys.includes('deed_journalEntries')
  const tableKeys = keys.filter(key => key !== 'deed_journalEntries')
  const [state, journals] = await Promise.all([
    tableKeys.length ? withSharedReadModels(() => loadAppState(tableKeys)) : Promise.resolve({}),
    wantsJournals ? import('@/lib/journal-read-model.server').then(m => m.loadBrowserJournals()) : Promise.resolve(null),
  ])
  // A shallow copy: the cached lists themselves are never changed.
  const copy: State = { ...(state as State) }
  if (journals) copy.deed_journalEntries = journals
  return filterStateForViewer(user, copy)
}
