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
