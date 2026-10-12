import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { NextRequest } from 'next/server'
import { FAILURE_LIMIT, RECORD_FAILURE_LIMIT, cleanPortalText, guardPortalRoute, resetPortalFailures } from '@/lib/portal/portal-guard.server'

const req = (url: string, ip: string, method = 'GET') =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'x-forwarded-for': `9.9.9.9, ${ip}` } })

describe('guardPortalRoute', () => {
  beforeEach(() => resetPortalFailures())

  it('blocks an address that keeps asking for repairs that do not exist', async () => {
    const route = guardPortalRoute('t-view', 1000, async () => new Response(null, { status: 404 }))
    for (let i = 0; i < FAILURE_LIMIT; i++) expect((await route(req(`/api/portal/repair/REP-${i}`, '41.1.1.1'), {})).status).toBe(404)
    expect((await route(req('/api/portal/repair/REP-X', '41.1.1.1'), {})).status).toBe(429)
    expect((await route(req('/api/portal/repair/REP-X', '41.1.1.2'), {})).status).toBe(404)
  })

  it('counts wrong phone numbers, not plain page views', async () => {
    const route = guardPortalRoute('t-docs', 1000, async () => new Response(null, { status: 403 }))
    // Opening a document without a phone is not a guess.
    for (let i = 0; i < FAILURE_LIMIT + 2; i++) expect((await route(req('/api/portal/repair/REP-1/invoice-pdf', '41.2.2.2'), {})).status).toBe(403)
    for (let i = 0; i < FAILURE_LIMIT; i++) expect((await route(req(`/api/portal/repair/REP-1/invoice-pdf?phone=07000000${i}`, '41.2.2.3'), {})).status).toBe(403)
    expect((await route(req('/api/portal/repair/REP-1/invoice-pdf?phone=0700000099', '41.2.2.3'), {})).status).toBe(429)
  })

  it('locks phone tries on one repair however many addresses guess', async () => {
    const route = guardPortalRoute('t-approve', 1000, async () => new Response(null, { status: 403 }))
    for (let i = 0; i < RECORD_FAILURE_LIMIT; i++) await route(req('/api/portal/repair/REP-7/approve', `41.3.${i}.1`, 'POST'), {})
    expect((await route(req('/api/portal/repair/REP-7/approve', '41.3.200.1', 'POST'), {})).status).toBe(429)
    // Another repair is unaffected.
    expect((await route(req('/api/portal/repair/REP-8/approve', '41.3.201.1', 'POST'), {})).status).toBe(403)
  })
})

describe('cleanPortalText', () => {
  it('keeps text, drops HTML brackets and control characters, caps length', () => {
    expect(cleanPortalText('  <b>Hi</b>\u0000 ', 50)).toBe('bHi/b')
    expect(cleanPortalText('a\nb', 50, true)).toBe('a\nb')
    expect(cleanPortalText('a\nb', 50)).toBe('ab')
    expect(cleanPortalText({ evil: 1 }, 50)).toBe('')
    expect(cleanPortalText('x'.repeat(100), 10)).toHaveLength(10)
  })
})
