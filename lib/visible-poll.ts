/**
 * Run `fn` immediately, on focus / tab-visible, and on a short interval while
 * the document is visible. Hidden tabs do not tick.
 */
export const VISIBLE_POLL_MS = 10_000

export function startVisiblePoll(fn: () => void, intervalMs = VISIBLE_POLL_MS): () => void {
  if (typeof window === 'undefined') return () => {}

  const tick = () => {
    if (document.visibilityState === 'hidden') return
    fn()
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') fn()
  }

  tick()
  const id = window.setInterval(tick, intervalMs)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  return () => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
  }
}
