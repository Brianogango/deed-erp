/**
 * Sanitize localStorage / remote JSON that backs ERP list state.
 *
 * A corrupted non-array value for a list key (e.g. `deed_repairs_v2`) causes
 * `.filter is not a function` in the authenticated shell (Sidebar / Topbar /
 * Dashboard) and surfaces as a blank white page after login.
 *
 * Object seeds (system/company settings) are shallow-merged with defaults so
 * missing fields like `crmPipelineStages` cannot crash module screens.
 */

export function parseStoredState<T>(raw: string | null, seed: T): { value: T; corrupted: boolean } {
  if (raw === null) return { value: seed, corrupted: false }
  try {
    const parsed = JSON.parse(raw) as T
    if (Array.isArray(seed)) {
      if (!Array.isArray(parsed)) return { value: seed, corrupted: true }
      return { value: parsed, corrupted: false }
    }
    if (
      seed !== null &&
      typeof seed === 'object' &&
      !Array.isArray(seed) &&
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return {
        value: { ...(seed as Record<string, unknown>), ...(parsed as Record<string, unknown>) } as T,
        corrupted: false,
      }
    }
    return { value: parsed, corrupted: false }
  } catch {
    return { value: seed, corrupted: true }
  }
}

export function ensureArray<T>(value: unknown, fallback: readonly T[] | T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : [...fallback]
}

/**
 * Keep last-known rows when a fetch returns empty. Prevents KPI cards flashing
 * 0 while a boot GET 404s, unwraps badly, or races a navigation.
 */
export function preferExistingArray<T>(prev: T[], incoming: T[] | null | undefined): T[] {
  if (!Array.isArray(incoming)) return prev
  if (incoming.length === 0 && Array.isArray(prev) && prev.length > 0) return prev
  return incoming
}
