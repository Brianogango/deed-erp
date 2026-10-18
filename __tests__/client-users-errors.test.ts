import { describe, expect, it, vi, afterEach } from 'vitest'
import { requestUpdateUser, requestDeleteUser } from '@/lib/auth/client-users'

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

afterEach(() => vi.restoreAllMocks())

describe('why a user change was refused reaches the screen', () => {
  it('turns the API error into the message callers read', async () => {
    respond(409, { error: 'This is the last active Director. Make another user a Director first.' })
    const result = await requestUpdateUser('u1', { role: 'sales_rep' } as any)
    expect(result.ok).toBe(false)
    expect((result.payload as any).message).toContain('last active Director')
  })

  it('leaves a successful response and an existing message alone', async () => {
    respond(200, { user: { id: 'u1' } })
    expect((await requestUpdateUser('u1', {} as any)).payload).toEqual({ user: { id: 'u1' } })
    respond(400, { message: 'Already a message', error: 'ignored' })
    expect(((await requestDeleteUser('u1')).payload as any).message).toBe('Already a message')
  })
})
