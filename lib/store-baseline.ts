/**
 * Each collection exactly as the server last gave it or accepted it — what
 * changed-records saves (lib/store-delta.ts) are diffed against. Browser only.
 */

const baseline: Record<string, string> = {}
const disabled = new Set<string>()

export function rememberServerBaseline(key: string, serialized: string) {
  if (typeof serialized === 'string' && serialized.startsWith('[')) baseline[key] = serialized
}

/** After a refused changed-records save: send these keys whole from now on. */
export function forgetServerBaseline(keys: string[]) {
  keys.forEach(k => { delete baseline[k]; disabled.add(k) })
}

export function serverBaselineFor(key: string): string | undefined {
  return disabled.has(key) ? undefined : baseline[key]
}
