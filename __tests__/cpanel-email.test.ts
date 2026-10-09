import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanMailboxName, CpanelError, cpanelConfig, createMailbox, generateMailboxPassword, suggestMailboxName, suspendMailbox } from '@/lib/integrations/cpanel-email'

vi.mock('server-only', () => ({}))

const cfg = { host: 'srv.example.com', port: 2083, user: 'deedacct', token: 'TOKEN123', domain: 'deed.co.ke' }
const ok = (data: unknown) => new Response(JSON.stringify({ status: 1, errors: null, data }), { status: 200 })

afterEach(() => vi.restoreAllMocks())

describe('cpanel config and names', () => {
  it('needs every setting and normalises the host', () => {
    expect(cpanelConfig({ CPANEL_HOST: 'srv.example.com' } as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(cpanelConfig({ CPANEL_HOST: 'https://srv.example.com:2083/', CPANEL_USER: 'u', CPANEL_API_TOKEN: 't', CPANEL_MAIL_DOMAIN: 'Deed.co.ke' } as unknown as NodeJS.ProcessEnv))
      .toMatchObject({ host: 'srv.example.com', port: 2083, domain: 'deed.co.ke' })
  })

  it('builds firstname.lastname and strips unsafe characters', () => {
    expect(suggestMailboxName('Jane Mary', 'Wanjiku Kamau')).toBe('jane.kamau')
    expect(suggestMailboxName('Zoë', "O'Brien")).toBe('zo.o.brien')
    expect(cleanMailboxName('  Jane..Doe!! ')).toBe('jane.doe')
  })

  it('generates strong, varied passwords', () => {
    const a = generateMailboxPassword()
    const b = generateMailboxPassword()
    expect(a).toHaveLength(16)
    expect(a).not.toBe(b)
    expect(a).toMatch(/[A-Z]/); expect(a).toMatch(/[a-z]/); expect(a).toMatch(/[0-9]/); expect(a).toMatch(/[!@#$%*_-]/)
  })
})

describe('cpanel calls', () => {
  it('checks for an existing mailbox, then creates it with the password in the body, not the URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok(null))
    const generated = generateMailboxPassword()
    const email = await createMailbox(cfg, 'Jane.Doe', generated)
    expect(email).toBe('jane.doe@deed.co.ke')
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://srv.example.com:2083/execute/Email/add_pop')
    expect(url).not.toContain(encodeURIComponent(generated))
    expect(new URLSearchParams(String(init.body)).get('password')).toBe(generated)
    expect((init.headers as Record<string, string>).Authorization).toBe('cpanel deedacct:TOKEN123')
  })

  it('refuses a mailbox that already exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([{ email: 'jane.doe@deed.co.ke' }]))
    await expect(createMailbox(cfg, 'jane.doe', generateMailboxPassword())).rejects.toMatchObject({ status: 409 })
  })

  it('surfaces cPanel errors and bad tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok([])).mockResolvedValueOnce(new Response(JSON.stringify({ status: 0, errors: ['Password strength too low'] }), { status: 200 }))
    await expect(createMailbox(cfg, 'a.b', generateMailboxPassword())).rejects.toThrow('Password strength too low')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(suspendMailbox(cfg, 'a.b@deed.co.ke')).rejects.toThrow(/rejected the API token/)
  })

  it('only suspends mailboxes on the configured domain', async () => {
    await expect(suspendMailbox(cfg, 'someone@gmail.com')).rejects.toBeInstanceOf(CpanelError)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok(null))
    await suspendMailbox(cfg, 'Jane.Doe@Deed.co.ke')
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('email=jane.doe%40deed.co.ke')
  })
})
