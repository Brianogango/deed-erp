import { allocateDocNumber } from '@/lib/doc-numbers'
import { isProvisionalDocRef } from '@/lib/doc-number-repair'

/**
 * Document numbers come from the server so two browsers cannot mint the same
 * one. These three are the whole mechanism; each caller supplies the `apply`
 * that writes the number back into its own records.
 */

const finalRef = (prefix: string) => new RegExp(`^${prefix}/\\d+$`)

/** Give each record a real server number, one at a time, best effort. */
export function assignServerNumbers(kind: string, prefix: string, ids: string[], apply: (id: string, ref: string) => void) {
  if (!ids.length || typeof window === 'undefined') return
  const valid = finalRef(prefix)
  void (async () => {
    for (const id of ids) {
      const ref = await allocateDocNumber(kind).catch(() => null)
      if (ref && valid.test(ref)) apply(id, ref)
    }
  })()
}

/** The record with its new number; a real old one is kept as formerRef. */
export function withServerRef<T extends { ref: string; formerRef?: string }>(r: T, ref: string): T {
  return { ...r, ref, ...(!r.formerRef && r.ref && !isProvisionalDocRef(r.ref) ? { formerRef: r.ref } : {}) }
}

/**
 * Before posting stock or value under a record's number: its own number if it
 * is real and no other record has it, else a new server number (applied to the
 * record). Null when the server cannot give one.
 */
export async function ensureUniqueServerRef<T extends { id: string; ref: string }>(
  kind: string, prefix: string, record: T, all: T[], apply: (id: string, ref: string) => void,
): Promise<string | null> {
  if (record.ref && !isProvisionalDocRef(record.ref) && !all.some(o => o.id !== record.id && o.ref === record.ref)) return record.ref
  const ref = await allocateDocNumber(kind).catch(() => null)
  if (!ref || !finalRef(prefix).test(ref)) return null
  apply(record.id, ref)
  return ref
}
