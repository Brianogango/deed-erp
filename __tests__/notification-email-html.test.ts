import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/integrations/whatsapp', () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock('@/lib/integrations/notifications', () => ({ sendNotification: vi.fn() }))
vi.mock('@/lib/notifications/web-push', () => ({ sendWebPush: vi.fn() }))

const prevUrl = process.env.NEXT_PUBLIC_APP_URL
afterEach(() => {
  if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = prevUrl
})

describe('notification emails', () => {
  it('turns ERP paths into full links a mail app can open', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://erp.deed.co.ke/'
    const { absoluteAppUrl } = await import('@/lib/notifications/providers')
    expect(absoluteAppUrl('/hr?tab=leave&leave=abc')).toBe('https://erp.deed.co.ke/hr?tab=leave&leave=abc')
    expect(absoluteAppUrl('https://other.example/x')).toBe('https://other.example/x')
    expect(absoluteAppUrl('')).toBeNull()
  })

  it('renders Approve / Decline buttons with full links and keeps line breaks', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://erp.deed.co.ke'
    const { genericHtml } = await import('@/lib/notifications/providers')
    const html = genericHtml('Leave approval required — LV/0057', 'Brian — sick\n2026-10-14 to 2026-10-14', null, [
      { label: 'Approve', url: '/hr?tab=leave&leave=1', tone: 'success' },
      { label: 'Decline', url: '/hr?tab=leave&leave=1', tone: 'danger' },
    ])
    expect(html).toContain('href="https://erp.deed.co.ke/hr?tab=leave&amp;leave=1"')
    expect(html).toContain('>Approve</a>')
    expect(html).toContain('>Decline</a>')
    expect(html).toContain('Brian — sick<br>2026-10-14')
  })

  it('falls back to one "Open in Deed ERP" button, and escapes content', async () => {
    const { genericHtml } = await import('@/lib/notifications/providers')
    const html = genericHtml('<b>x</b>', 'a<script>', '/hr?tab=self_service')
    expect(html).toContain('>Open in Deed ERP</a>')
    expect(html).toContain('/hr?tab=self_service"')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>x</b>')
  })
})
