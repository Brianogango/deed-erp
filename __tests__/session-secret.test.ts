import { describe, it, expect, afterEach } from 'vitest'

describe('getSessionSecret (SEC-001)', () => {
  const original = process.env.AUTH_SECRET

  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = original
  })

  it('throws when AUTH_SECRET is empty', async () => {
    process.env.AUTH_SECRET = ''
    // Re-import so the module reads the current env (function reads env at call time).
    const { getSessionSecret } = await import('@/lib/auth/session')
    expect(() => getSessionSecret()).toThrow(/AUTH_SECRET/)
  })

  it('throws when AUTH_SECRET is missing', async () => {
    delete process.env.AUTH_SECRET
    const { getSessionSecret } = await import('@/lib/auth/session')
    expect(() => getSessionSecret()).toThrow(/AUTH_SECRET/)
  })

  it('returns the configured secret', async () => {
    process.env.AUTH_SECRET = 'configured-secret-for-tests-32chars!!'
    const { getSessionSecret } = await import('@/lib/auth/session')
    expect(getSessionSecret()).toBe('configured-secret-for-tests-32chars!!')
  })

  it('does not embed the legacy demo secret string in the module source', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/auth/session.ts'), 'utf8')
    expect(src).not.toContain('deed-erp-demo-secret')
  })
})
