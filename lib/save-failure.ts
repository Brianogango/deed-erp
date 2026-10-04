/**
 * Saves the server refused, told to the person who made them.
 *
 * Most writes in the store go out in the background through `sync`, which
 * used to discard the response entirely — a 403, 409 or 500 looked exactly
 * like success, the screen kept the change, and it vanished on the next
 * refresh. Every one of them now reports here; the top bar turns it into a
 * toast naming what was not saved and why.
 */

export const SAVE_FAILED_EVENT = 'deed:save-failed'

export type SaveFailure = { message: string; url: string; status: number | null }

const DOCUMENT_NAMES: Array<[RegExp, string]> = [
  [/^\/api\/sale-orders/, 'sale order'],
  [/^\/api\/quotes/, 'quotation'],
  [/^\/api\/purchase-orders/, 'purchase order'],
  [/^\/api\/invoices/, 'invoice'],
  [/^\/api\/opportunities/, 'opportunity'],
  [/^\/api\/deliveries/, 'delivery'],
  [/^\/api\/serials/, 'serial number'],
  [/^\/api\/outbound-releases/, 'release'],
  [/^\/api\/salary-advances/, 'salary advance'],
  [/^\/api\/companies/, 'company'],
  [/^\/api\/receipts/, 'goods receipt'],
  [/^\/api\/payroll/, 'payroll'],
  [/^\/api\/payments/, 'payment'],
  [/^\/api\/activities/, 'activity'],
]

export function documentNameForUrl(url: string): string {
  const path = String(url || '').split('?')[0]
  return DOCUMENT_NAMES.find(([re]) => re.test(path))?.[1] ?? 'change'
}

const ACTION_BY_METHOD: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }

export function describeSaveFailure(url: string, method: string | undefined, status: number | null, serverError?: string | null): string {
  const what = documentNameForUrl(url)
  const action = ACTION_BY_METHOD[String(method || 'POST').toUpperCase()] ?? 'save'
  const reason = serverError?.trim()
    || (status === null ? 'the server could not be reached'
      : status === 403 ? 'you are not allowed to do this'
      : status === 404 ? 'it no longer exists on the server'
      : status === 409 ? 'it was changed or locked by someone else'
      : `the server answered ${status}`)
  return `Could not ${action} the ${what}: ${reason}. Your screen may show it saved — refresh before relying on it.`
}

// Several background writes can fail for the same cause at once; one toast
// per distinct message is enough.
const recent = new Map<string, number>()

export function reportSaveFailure(url: string, method: string | undefined, status: number | null, serverError?: string | null): void {
  if (typeof window === 'undefined') return
  const message = describeSaveFailure(url, method, status, serverError)
  const now = Date.now()
  const last = recent.get(message)
  if (last && now - last < 8000) return
  recent.set(message, now)
  window.dispatchEvent(new CustomEvent<SaveFailure>(SAVE_FAILED_EVENT, { detail: { message, url, status } }))
}

/** A fire-and-forget write that reports a refusal instead of hiding it. */
export function reportingFetch(url: string, opts: RequestInit): Promise<Response | void> {
  return fetch(url, opts)
    .then(async res => {
      if (!res.ok) {
        const payload = await res.clone().json().catch(() => null) as { error?: string; message?: string } | null
        reportSaveFailure(url, opts.method, res.status, payload?.error ?? payload?.message ?? null)
      }
      return res
    })
    .catch(() => { reportSaveFailure(url, opts.method, null) })
}
