import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/portal/intake/next-ref/route'

describe('GET /api/portal/intake/next-ref', () => {
  it('does not preview or reserve a public ticket number', async () => {
    const res = await GET()
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/assigned when the job is booked/i)
  })
})
