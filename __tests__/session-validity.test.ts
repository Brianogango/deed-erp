import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetSessionStatusCacheForTests,
  evaluateSessionAccess,
  getCachedSessionStatus,
  invalidateUserSessions,
  publishSessionStatus,
  SESSION_STATUS_TTL_MS,
  setCachedSessionStatus,
} from '@/lib/auth/session-validity'

describe('session-validity cache (AGENT-SEC-002)', () => {
  beforeEach(() => {
    __resetSessionStatusCacheForTests()
  })

  afterEach(() => {
    __resetSessionStatusCacheForTests()
    vi.useRealTimers()
  })

  it('cache miss allows access (fail-open)', async () => {
    const access = await evaluateSessionAccess('missing-user', 'director')
    expect(access.allowed).toBe(true)
    expect(access.status).toBeNull()
    expect(access.roleChanged).toBe(false)
  })

  it('denies access when cached status is inactive', async () => {
    await invalidateUserSessions('user-1', { isActive: false, role: 'sales_rep' })
    const access = await evaluateSessionAccess('user-1', 'sales_rep')
    expect(access.allowed).toBe(false)
    expect(access.status?.isActive).toBe(false)
  })

  it('flags role changes when cached role differs from JWT', async () => {
    await publishSessionStatus('user-2', {
      isActive: true,
      role: 'finance_officer',
      invalidatedAt: Date.now(),
    })
    const access = await evaluateSessionAccess('user-2', 'sales_rep')
    expect(access.allowed).toBe(true)
    expect(access.roleChanged).toBe(true)
    expect(access.effectiveRole).toBe('finance_officer')
  })

  it('expires active cache entries after TTL', () => {
    vi.useFakeTimers()
    setCachedSessionStatus('user-3', {
      isActive: true,
      role: 'director',
      invalidatedAt: Date.now(),
    }, SESSION_STATUS_TTL_MS)
    expect(getCachedSessionStatus('user-3')?.role).toBe('director')
    vi.advanceTimersByTime(SESSION_STATUS_TTL_MS + 1)
    expect(getCachedSessionStatus('user-3')).toBeNull()
  })

  it('cache lookup completes in under 5ms', async () => {
    await publishSessionStatus('perf-user', {
      isActive: true,
      role: 'director',
      invalidatedAt: Date.now(),
    })
    const start = performance.now()
    for (let i = 0; i < 100; i += 1) {
      await evaluateSessionAccess('perf-user', 'director')
    }
    const elapsed = performance.now() - start
    expect(elapsed / 100).toBeLessThan(5)
  })
})
