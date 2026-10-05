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

/**
 * A full record replaced its slimmed row in the store (lib/store-slim.ts):
 * the server holds exactly that row, so the baseline does too — otherwise the
 * next save would see the swap as an edit.
 */
export function patchServerBaseline(key: string, rows: Array<{ id?: unknown }>) {
  const current = baseline[key]
  if (!current || !rows.length) return
  try {
    const byId = new Map(rows.map(row => [String(row.id), row]))
    const parsed = JSON.parse(current) as Array<{ id?: unknown }>
    if (!Array.isArray(parsed)) return
    baseline[key] = JSON.stringify(parsed.map(row => byId.get(String(row?.id)) ?? row))
  } catch { /* the next save just sends the whole collection */ }
}
