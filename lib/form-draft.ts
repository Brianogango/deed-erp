/**
 * Keep a half-filled form in this browser until it is submitted or
 * discarded. A trade-in form registers the machine's serial at once but the
 * trade-in itself is only saved on submit — leaving the page (to look up a
 * contact, say) used to throw the form away and strand the machine.
 * Browser only; every read and write tolerates blocked storage.
 */

const PREFIX = 'deed_form_draft:'

export function loadFormDraft<T>(name: string, userId: string): T | null {
  if (typeof window === 'undefined' || !userId) return null
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${name}:${userId}`)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

export function saveFormDraft(name: string, userId: string, draft: unknown) {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.localStorage.setItem(`${PREFIX}${name}:${userId}`, JSON.stringify(draft))
  } catch { /* storage full or blocked: the form still works, it just is not kept */ }
}

export function clearFormDraft(name: string, userId: string) {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.localStorage.removeItem(`${PREFIX}${name}:${userId}`)
  } catch { /* nothing to clear */ }
}
