import { describe, expect, it, vi } from 'vitest'

const { sqlCalls } = vi.hoisted(() => ({ sqlCalls: [] as string[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/db', () => ({
  sql: vi.fn(async (strings: TemplateStringsArray) => {
    sqlCalls.push(strings.join('?').replace(/\s+/g, ' ').trim())
    return { rows: [] }
  }),
}))
vi.mock('@/lib/auth/session-validity', () => ({ invalidateUserSessions: vi.fn() }))

import { findAuthUserById } from '@/lib/auth/users-repository'

describe('users table set-up', () => {
  it('runs its ALTER / UPDATE set-up once per process, not on every lookup', async () => {
    await findAuthUserById('u1')
    const setup = sqlCalls.filter(q => /^(ALTER|UPDATE|CREATE)/.test(q)).length
    expect(setup).toBeGreaterThan(5)
    sqlCalls.length = 0
    await findAuthUserById('u1')
    await findAuthUserById('u2')
    expect(sqlCalls.filter(q => /^(ALTER|UPDATE|CREATE)/.test(q))).toEqual([])
    expect(sqlCalls.filter(q => q.startsWith('SELECT id, username'))).toHaveLength(2)
  })
})
