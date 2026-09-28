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

export function deniedSaveMessage(keys: string[]): string | null {
  const labels = Array.from(new Set((keys ?? []).filter(Boolean).map(storeKeyLabel)))
  if (labels.length === 0) return null
  const list = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  return `Not saved: your role is not allowed to save ${list}. Those changes were not kept — ask an admin to grant access, then enter them again.`
}
