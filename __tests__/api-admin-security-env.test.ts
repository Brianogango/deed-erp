import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetSession }))

import { GET, PUT } from '@/app/api/admin/security/env/route'

const tempFiles: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.DEED_ENV_FILE
  process.env.DEED_SKIP_PM2_RELOAD = 'true'
  for (const file of tempFiles.splice(0)) {
    try { fs.unlinkSync(file) } catch { /* already gone */ }
  }
})

function envFile(contents: string) {
  const file = path.join(os.tmpdir(), `deed-env-api-${Date.now()}-${Math.random().toString(16).slice(2)}.env`)
  fs.writeFileSync(file, contents, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  tempFiles.push(file)
  process.env.DEED_ENV_FILE = file
  return file
}

describe('admin environment settings API', () => {
  it('forbids non-directors', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'a1', role: 'admin_officer' } })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('lists fields without returning secret material', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'd1', role: 'director' } })
    envFile('NEXTAUTH_SECRET=leaked-secret-value-please-hide\nSMTP_HOST=mail.deed.co.ke\n')
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(JSON.stringify(data)).not.toContain('leaked-secret-value-please-hide')
    expect(data.fields.find((field: { key: string }) => field.key === 'SMTP_HOST').value).toBe('mail.deed.co.ke')
  })

  it('saves a generated secret after confirmation', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'd1', role: 'director' } })
    const file = envFile('CRON_SECRET=\n')
    const res = await PUT(new NextRequest('http://localhost/api/admin/security/env', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generate: ['CRON_SECRET'], confirm: 'SAVE DEED ERP ENV' }),
    }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.changed).toContain('CRON_SECRET')
    const saved = fs.readFileSync(file, 'utf8')
    expect(saved).toMatch(/^CRON_SECRET=.+$/m)
    expect(JSON.stringify(data)).not.toMatch(/CRON_SECRET=[^\n"]+/)
  })
})
