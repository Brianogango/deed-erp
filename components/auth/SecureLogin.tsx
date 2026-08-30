'use client'

import { FormEvent, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Phase = 'credentials' | 'enroll' | 'verify'

function destination(searchParams: ReturnType<typeof useSearchParams>, defaultModule?: string) {
  const rawReturn = searchParams.get('returnTo')
  if (rawReturn) {
    try {
      const decoded = decodeURIComponent(rawReturn)
      if (decoded.startsWith('/') && !decoded.startsWith('//') && !decoded.includes('://') && !decoded.startsWith('/login')) return decoded
    } catch {}
  }
  if (defaultModule && defaultModule !== 'dashboard') return `/${defaultModule}`
  return '/'
}

export default function SecureLogin() {
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<Phase>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function beginMfa(enroll: boolean) {
    if (!enroll) {
      setPhase('verify')
      setMessage('Enter the six-digit code from your authenticator app.')
      return
    }
    const enrollment = await fetch('/api/auth/mfa/enroll', { method: 'POST' })
    const data = await enrollment.json().catch(() => ({}))
    if (!enrollment.ok) throw new Error(data.message || 'Unable to start authenticator setup.')
    setQrDataUrl(String(data.qrDataUrl || ''))
    setManualKey(String(data.manualKey || ''))
    setPhase('enroll')
    setMessage('Scan the QR code with Microsoft Authenticator, Google Authenticator, 1Password, or another TOTP app, then enter the six-digit code.')
  }

  async function submitCredentials(event: FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password || pending) return
    setPending(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Invalid username or password.')
      if (data.mfaRequired) {
        setPassword('')
        await beginMfa(Boolean(data.mfaEnrollmentRequired))
        return
      }
      window.location.href = destination(searchParams, data.defaultModule)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication service is unavailable.')
    } finally {
      setPending(false)
    }
  }

  async function submitMfa(event: FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code) || pending) return
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Invalid authenticator code.')
      window.location.href = destination(searchParams, data.defaultModule)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
      setCode('')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-5 py-10">
      <div className="absolute inset-0 bg-[url('/login-bg.jpg')] bg-cover bg-center opacity-70" aria-hidden="true" />
      <div className="absolute inset-0 bg-slate-950/45" aria-hidden="true" />
      <section className="relative z-10 w-full max-w-[430px] rounded-3xl border border-white/50 bg-white/95 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
        <img src="/deed-logo.png" alt="Deed Technologies" className="mb-7 h-20 w-auto object-contain" />

        <h1 className="text-2xl font-bold text-slate-900">
          {phase === 'credentials' ? 'Secure sign in' : phase === 'enroll' ? 'Protect your account' : 'Verify your identity'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {phase === 'credentials' ? 'Sign in to your Deed ERP workspace.' : message}
        </p>

        {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {phase === 'credentials' ? (
          <form onSubmit={submitCredentials} className="mt-7 space-y-5">
            <label className="block text-sm font-semibold text-slate-700">
              Username
              <input
                autoFocus
                autoComplete="username"
                maxLength={50}
                placeholder="your.username"
                value={username}
                onChange={event => setUsername(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Password
              <input
                type="password"
                autoComplete="current-password"
                maxLength={128}
                placeholder="••••••••••••"
                value={password}
                onChange={event => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              />
            </label>
            <button disabled={pending || !username.trim() || !password} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {pending ? 'Checking…' : 'Continue'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitMfa} className="mt-7 space-y-5">
            {phase === 'enroll' && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                {qrDataUrl && <img src={qrDataUrl} alt="Authenticator enrollment QR code" className="mx-auto h-56 w-56 rounded-lg bg-white p-2" />}
                {manualKey && (
                  <div className="mt-4 text-left">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual setup key</div>
                    <code className="mt-1 block break-all rounded-lg bg-white px-3 py-2 text-xs text-slate-800">{manualKey}</code>
                  </div>
                )}
              </div>
            )}
            <label className="block text-sm font-semibold text-slate-700">
              Six-digit authenticator code
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-mono text-2xl tracking-[0.35em] outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              />
            </label>
            <button disabled={pending || code.length !== 6} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {pending ? 'Verifying…' : phase === 'enroll' ? 'Enable MFA and sign in' : 'Verify and sign in'}
            </button>
            <button type="button" onClick={() => window.location.reload()} className="w-full px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-900">
              Start over
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
