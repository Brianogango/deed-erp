import { describe, it, expect } from 'vitest'
import { GET, OPTIONS } from '@/app/api/public/v1/guide/route'

describe('GET /api/public/v1/guide', () => {
  it('allows CORS preflight', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('downloads the Markdown integration guide without an API key', async () => {
    const res = await GET(new Request('http://localhost/api/public/v1/guide'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    expect(res.headers.get('Content-Disposition')).toContain('Deed-Partner-API-Guide.md')

    const body = await res.text()
    expect(body).toContain('Deed ERP Partner API')
    expect(body).toContain('Authorization: Bearer')
    expect(body).toContain('DEED_PARTNER_API_KEY')
    expect(body).toContain('GET /api/public/v1/products')
  })

  it('can serve the guide inline for preview', async () => {
    const res = await GET(new Request('http://localhost/api/public/v1/guide?inline=1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain('inline')
  })
})
