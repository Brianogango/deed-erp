export type RecordHistoryOverride = 'auto' | 'push' | 'replace'
export type RecordNavigationDecision = 'back' | 'push' | 'replace'

/**
 * Decide how list/detail navigation should affect browser history.
 * Kept pure so every module using useUrlRecordId shares testable semantics.
 */
export function decideRecordNavigation(args: {
  nextId: string | null
  currentQueryId: string | null
  openedViaPush: boolean
  history?: RecordHistoryOverride
}): RecordNavigationDecision {
  const history = args.history ?? 'auto'

  if (!args.nextId && history !== 'replace' && args.openedViaPush) return 'back'
  if (history === 'push') return 'push'
  if (history === 'replace') return 'replace'
  if (args.nextId && !args.currentQueryId) return 'push'
  return 'replace'
}
