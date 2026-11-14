import { describe, it, expect, afterEach } from 'vitest'

describe('getSessionSecret (SEC-001)', () => {
  const original = process.env.AUTH_SECRET

  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = original
  })

  
  
  
  it('does not embed the legacy demo secret string in the module source', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/auth/session.ts'), 'utf8')
    expect(src).not.toContain('deed-erp-demo-secret')
  })
})
