/**
 * Optimistic concurrency control helpers for PATCH APIs.
 */

export function readExpectedVersion(body: Record<string, unknown>): number | undefined {
  const raw = body.lockVersion ?? body.expectedVersion
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export function lockVersionMismatch(
  current: number | null | undefined,
  expected: number | undefined,
): boolean {
  if (expected === undefined) return false
  return Number(current ?? 0) !== expected
}

export function nextLockVersion(current: number | null | undefined): number {
  return Number(current ?? 0) + 1
}

/** Read `lockVersion` from an invoice PUT JSON body (success or 409). */
export function readLockVersionFromResponse(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined
  const raw = (body as { lockVersion?: unknown }).lockVersion
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/** Drop a stale client lockVersion so the server can claim the live row. */
export function omitLockVersion<T extends { lockVersion?: unknown }>(row: T): Omit<T, 'lockVersion'> {
  const { lockVersion: _ignored, ...rest } = row
  return rest
}
