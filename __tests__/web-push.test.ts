import { afterEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import { sendWebPush } from '@/lib/notifications/web-push'

const b64url = (value: Buffer) =>
  value.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

function vapidPair() {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  }
}

function browserSubscription() {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription',
    p256dh: b64url(ecdh.getPublicKey()),
    authSecret: b64url(crypto.randomBytes(16)),
  }
}

describe('sendWebPush', () => {
  const previousPublic = process.env.VAPID_PUBLIC_KEY
  const previousPrivate = process.env.VAPID_PRIVATE_KEY

  afterEach(() => {
    if (previousPublic === undefined) delete process.env.VAPID_PUBLIC_KEY
    else process.env.VAPID_PUBLIC_KEY = previousPublic
    if (previousPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY
    else process.env.VAPID_PRIVATE_KEY = previousPrivate
    vi.unstubAllGlobals()
  })

  it('returns not_configured when VAPID keys are missing', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    const result = await sendWebPush(browserSubscription(), { title: 'Deed ERP' })
    expect(result).toMatchObject({ success: false, provider: 'web_push', errorCode: 'not_configured' })
  })

  it('POSTs an encrypted payload to the push endpoint', async () => {
    const keys = vapidPair()
    process.env.VAPID_PUBLIC_KEY = keys.publicKey
    process.env.VAPID_PRIVATE_KEY = keys.privateKey
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201, headers: { location: 'urn:uuid:test' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendWebPush(browserSubscription(), { title: 'Deed ERP', body: 'Hello' })
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('urn:uuid:test')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('fcm.googleapis.com')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=.+/)
    expect(init.headers['Content-Encoding']).toBe('aes128gcm')
    expect(init.body).toBeInstanceOf(Uint8Array)
  })

  it('surfaces gone subscriptions as HTTP 410', async () => {
    const keys = vapidPair()
    process.env.VAPID_PUBLIC_KEY = keys.publicKey
    process.env.VAPID_PRIVATE_KEY = keys.privateKey
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 410 })))

    const result = await sendWebPush(browserSubscription(), { title: 'Deed ERP' })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('410')
  })
})
