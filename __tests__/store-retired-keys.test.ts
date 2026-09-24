import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { RETIRED_LOCAL_KEYS, SESSION_AUDIT_LOG_LIMIT, evictRetiredLocalKeys } from '@/lib/store'

/**
 * deed_auditLogs was persisted by every browser and never trimmed, despite
 * being read by no screen and ignored by the server (the durable record comes
 * from /api/audit/commercial). It was the largest key in app_state and pure
 * ballast against the localStorage quota — the failure behind a week of
 * half-written deliveries, payments and orders.
 */

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v) },
    removeItem: (k: string) => { data.delete(k) },
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size },
    data,
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('retired local keys', () => {
  it('names the audit log as retired', () => {
    expect(RETIRED_LOCAL_KEYS).toContain('deed_auditLogs')
  })

  it('reclaims the space an existing browser is still holding', () => {
    const localStorage = makeStorage({
      deed_auditLogs: JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i }))),
      deed_repairs_v2: '[]',
    })
    vi.stubGlobal('window', { localStorage })

    evictRetiredLocalKeys()

    expect(localStorage.getItem('deed_auditLogs')).toBeNull()
    // Everything else is left alone.
    expect(localStorage.getItem('deed_repairs_v2')).toBe('[]')
  })

  it('is a no-op when the key was never written', () => {
    const localStorage = makeStorage({ deed_repairs_v2: '[]' })
    vi.stubGlobal('window', { localStorage })
    expect(() => evictRetiredLocalKeys()).not.toThrow()
    expect(localStorage.data.size).toBe(1)
  })

  it('survives storage that throws (private mode, blocked site data)', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('blocked') },
        removeItem: () => { throw new Error('blocked') },
      },
    })
    expect(() => evictRetiredLocalKeys()).not.toThrow()
  })

  it('caps the session mirror so a long shift cannot grow it without bound', () => {
    expect(SESSION_AUDIT_LOG_LIMIT).toBeGreaterThan(0)
    expect(SESSION_AUDIT_LOG_LIMIT).toBeLessThanOrEqual(1000)

    // The reducer shape addAuditLog uses.
    let logs: { id: number }[] = []
    for (let i = 0; i < SESSION_AUDIT_LOG_LIMIT + 500; i += 1) {
      logs = [{ id: i }, ...logs].slice(0, SESSION_AUDIT_LOG_LIMIT)
    }
    expect(logs).toHaveLength(SESSION_AUDIT_LOG_LIMIT)
    // Newest first.
    expect(logs[0].id).toBe(SESSION_AUDIT_LOG_LIMIT + 499)
  })
})
