/**
 * What to tell someone whose save the server refused for their role.
 *
 * The server drops a list the caller may not write and saves the rest, so the
 * request still succeeds. Before this, the browser read that as "all saved" and
 * the refused change was discarded without a word — which is how an inventory
 * officer's outsource jobs vanished for days. The message names what was lost in
 * plain words, because "deed_outsourceJobs" means nothing at the counter.
 */
export function storeKeyLabel(key: string): string {
  const bare = String(key ?? '').replace(/^deed_/, '').replace(/_v\d+$/, '')
  const words = bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words || String(key ?? '')
}

/**
 * Lists every browser rewrites on its own, not because the person typed
 * anything. Product stock counts are recomputed in each tab whenever serials
 * change anywhere, and the POS session pointer and opening-stock flag are
 * bookkeeping. A role that may not save them is refused many times a day
 * (55 for one admin officer on 28 Sep) and nothing they entered is lost, so a
 * pop-up for these would be noise that teaches people to ignore the real one.
 */
const BACKGROUND_KEYS = new Set([
  'deed_products',
  'deed_posSessionId',
  'deed_posSessionOpen',
  'deed_openingStockPosted',
])

export function isBackgroundStoreKey(key: string): boolean {
  return BACKGROUND_KEYS.has(key)
}

/** A message only for refusals the person would notice as lost work. */
export function deniedSaveMessage(keys: string[]): string | null {
  const labels = Array.from(new Set((keys ?? []).filter(k => k && !isBackgroundStoreKey(k)).map(storeKeyLabel)))
  if (labels.length === 0) return null
  const list = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  return `Not saved: your role is not allowed to save ${list}. Those changes were not kept — ask an admin to grant access, then enter them again.`
}
