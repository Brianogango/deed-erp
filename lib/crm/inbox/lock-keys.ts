/** Stable lock identifiers for sales@ inbox concurrency (safe for unit tests). */

/** Stable int4 key for sales@ inbox processor (arbitrary, unique in this app). */
export const SALES_INBOX_LOCK_KEY = 872_014_355

/** Per-message lock key material. */
export function salesInboxMessageLockKey(provider: string, mailbox: string, messageId: string): string {
  return `sales-inbox:${provider}:${mailbox}:${messageId}`.slice(0, 200)
}
