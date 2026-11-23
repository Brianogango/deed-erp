'use client'

import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser'

/** What to call it on this device: Face ID on an iPhone, fingerprint on Android. */
export function passkeyLabel(): string {
  if (typeof navigator === 'undefined') return 'passkey'
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'Face ID'
  if (/Android/i.test(ua)) return 'fingerprint'
  if (/Macintosh/i.test(ua)) return 'Touch ID'
  if (/Windows/i.test(ua)) return 'Windows Hello'
  return 'passkey'
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn()
}

/** The person closed the prompt (or it timed out): not an error worth shouting about. */
export function isPasskeyCancel(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  return name === 'NotAllowedError' || name === 'AbortError'
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'Something went wrong'), { status: res.status })
  return data
}

/** Sign in with Face ID / fingerprint. Resolves with the login reply (user, defaultModule). */
export async function signInWithPasskey(): Promise<{ defaultModule?: string }> {
  WebAuthnAbortService.cancelCeremony()
  const { options } = await post('/api/auth/passkey/login/options')
  const response = await startAuthentication({ optionsJSON: options })
  return post('/api/auth/passkey/login/verify', { response })
}

/** Add Face ID / fingerprint to the signed-in account (asks for the password first). */
export async function addPasskey(password: string): Promise<{ name: string }> {
  const { options } = await post('/api/auth/passkey/register/options', { password })
  const response = await startRegistration({ optionsJSON: options })
  return post('/api/auth/passkey/register/verify', { response })
}
