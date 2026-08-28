import 'server-only'

import crypto from 'crypto'
import type { ProviderSendResult } from './types'

export type WebPushSubscriptionRecord = {
  endpoint: string
  p256dh: string
  authSecret: string
}

const b64url = (value: Buffer) =>
  value.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

const fromB64url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(normalized + padding, 'base64')
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return crypto.createHmac('sha256', salt).update(ikm).digest()
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  let previous = Buffer.alloc(0)
  const output: Buffer[] = []
  let counter = 1
  while (Buffer.concat(output).length < length) {
    previous = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest()
    output.push(previous)
    counter += 1
  }
  return Buffer.concat(output).subarray(0, length)
}

function buildVapidJwt(endpoint: string, publicKey: Buffer, privateKey: Buffer): string {
  if (publicKey.length !== 65 || publicKey[0] !== 4) {
    throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 public key')
  }
  if (privateKey.length !== 32) {
    throw new Error('VAPID_PRIVATE_KEY must be a 32-byte P-256 private key')
  }

  const origin = new URL(endpoint).origin
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64url(Buffer.from(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: process.env.VAPID_SUBJECT || 'mailto:info@deed.co.ke',
  })))
  const signingInput = `${header}.${payload}`

  const key = crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(publicKey.subarray(1, 33)),
      y: b64url(publicKey.subarray(33, 65)),
      d: b64url(privateKey),
    },
    format: 'jwk',
  })

  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${b64url(signature)}`
}

function encryptPayload(
  userPublicKey: Buffer,
  authSecret: Buffer,
  plaintext: Buffer,
): { body: Buffer; serverPublicKey: Buffer } {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  const serverPublicKey = ecdh.getPublicKey()
  const sharedSecret = ecdh.computeSecret(userPublicKey)

  const authPrk = hkdfExtract(authSecret, sharedSecret)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userPublicKey,
    serverPublicKey,
  ])
  const ikm = hkdfExpand(authPrk, keyInfo, 32)

  const salt = crypto.randomBytes(16)
  const prk = hkdfExtract(salt, ikm)
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12)

  const recordPlaintext = Buffer.concat([plaintext, Buffer.from([2])])
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const ciphertext = Buffer.concat([cipher.update(recordPlaintext), cipher.final(), cipher.getAuthTag()])

  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096, 0)
  const idLength = Buffer.from([serverPublicKey.length])

  return {
    body: Buffer.concat([salt, recordSize, idLength, serverPublicKey, ciphertext]),
    serverPublicKey,
  }
}

export async function sendWebPush(
  subscription: WebPushSubscriptionRecord,
  payload: Record<string, unknown>,
): Promise<ProviderSendResult> {
  const publicRaw = String(process.env.VAPID_PUBLIC_KEY || '').trim()
  const privateRaw = String(process.env.VAPID_PRIVATE_KEY || '').trim()
  if (!publicRaw || !privateRaw) {
    return { success: false, provider: 'web_push', error: 'Web Push VAPID keys are not configured', errorCode: 'not_configured' }
  }

  try {
    const publicKey = fromB64url(publicRaw)
    const privateKey = fromB64url(privateRaw)
    const userPublic = fromB64url(subscription.p256dh)
    const authSecret = fromB64url(subscription.authSecret)
    const jwt = buildVapidJwt(subscription.endpoint, publicKey, privateKey)
    const encrypted = encryptPayload(userPublic, authSecret, Buffer.from(JSON.stringify(payload)))

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    let response: Response
    try {
      response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `vapid t=${jwt}, k=${b64url(publicKey)}`,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          'TTL': '86400',
          'Urgency': 'normal',
        },
        body: encrypted.body,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 500)
      return {
        success: false,
        provider: 'web_push',
        error: `Push service returned HTTP ${response.status}${body ? `: ${body}` : ''}`,
        errorCode: String(response.status),
        response: { status: response.status },
      }
    }

    return {
      success: true,
      provider: 'web_push',
      messageId: response.headers.get('location') || undefined,
      response: { status: response.status },
    }
  } catch (error) {
    return {
      success: false,
      provider: 'web_push',
      error: error instanceof Error ? error.message : 'Web Push failed',
      errorCode: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'send_failed',
    }
  }
}
