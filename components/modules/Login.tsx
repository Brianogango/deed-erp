'use client'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthToast } from '@/components/auth/AuthFeedback'

export default function Login() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [touched, setTouched] = useState({ username: false, password: false })

  const logoutReason = searchParams.get('reason')

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched({ username: true, password: true })
    if (!username.trim() || !password) return
    if (pending) return
    setPending(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setToast({ msg: data.message || 'Invalid username or password', type: 'error' })
        return
      }

      const { user } = await res.json()

      setToast({ msg: 'Access granted. Redirecting...', type: 'success' })
      window.location.href = '/'
    } catch {
      setToast({ msg: 'Authentication service is unavailable', type: 'error' })
    } finally {
      setPending(false)
    }
  }

  const usernameInvalid = touched.username && !username.trim()
  const passwordInvalid = touched.password && !password

  return (
    <div className="relative min-h-screen w-full overflow-hidden flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #04080f 0%, #0b1628 40%, #0f2044 70%, #0a1a38 100%)' }}>

      {/* ── Background glows ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full opacity-28"
          style={{ background: 'radial-gradient(circle, #22B8E6 0%, transparent 70%)', filter: 'blur(80px)' }} />
        <div className="absolute -bottom-48 -right-40 h-[480px] w-[480px] rounded-full opacity-22"
          style={{ background: 'radial-gradient(circle, #15193D 0%, transparent 70%)', filter: 'blur(90px)' }} />
        {/* Centered brand watermark */}
        <img src="/deed-logo.svg" alt="" aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{
            left: '50%', top: '50%',
            width: 'min(60vmin, 540px)', height: 'min(60vmin, 540px)',
            transform: 'translate(-50%, -50%)',
            opacity: 0.05, filter: 'brightness(0) invert(1)',
          }} />
        {/* Dot grid */}
        <div className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }} />
      </div>

      {/* ── Centered card ── */}
      <div className="relative z-10 w-full max-w-[420px] px-5 py-10">
        <div className="rounded-[20px] border px-7 py-7 shadow-2xl backdrop-blur-2xl"
          style={{
            background: 'rgba(255,255,255,0.06)',
            borderColor: 'rgba(255,255,255,0.15)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.45)',
          }}>

          {/* Brand mark */}
          <div className="flex items-center gap-2.5 mb-6">
            <img src="/deed-logo.svg" alt="deed" width={34} height={34}
              className="flex-shrink-0 object-contain"
              style={{ filter: 'brightness(0) invert(1)' }}
              onError={(e) => { (e.target as HTMLImageElement).src = '/icon-192.png' }} />
            <div className="text-[15px] font-bold text-white tracking-[-0.005em]">
              deed<span className="font-light opacity-60"> ERP</span>
            </div>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h2 className="text-[22px] font-bold text-white mb-0">Sign in</h2>
          </div>

            {/* Session-ended reason banner */}
            {logoutReason && (
              <div className={`mb-5 flex items-start gap-3 rounded-2xl px-4 py-3 text-[12px] font-medium border ${
                logoutReason === 'network'
                  ? 'border-red-500/30 text-red-300'
                  : 'border-amber-500/30 text-amber-300'
              }`}
                style={{ background: logoutReason === 'network' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)' }}>
                <span className="flex-shrink-0">{logoutReason === 'network' ? '📡' : '⏱'}</span>
                <span>
                  {logoutReason === 'network'
                    ? 'Signed out due to network loss. Please sign in again.'
                    : 'Session expired due to inactivity. Please sign in again.'}
                </span>
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
              {/* Username */}
              <div>
                <label className="mb-2 block text-[12px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  Username
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    onBlur={() => setTouched(t => ({ ...t, username: true }))}
                    maxLength={50}
                    placeholder="your.username"
                    autoFocus
                    autoComplete="username"
                    className="w-full rounded-2xl py-3 pl-11 pr-4 text-[13px] text-white placeholder-white/30 outline-none transition"
                    style={{
                      background: usernameInvalid ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.08)',
                      border: `1px solid ${usernameInvalid ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.12)'}`,
                    }}
                    onFocus={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(0,176,215,0.6)' }}
                    onBlurCapture={e => { e.currentTarget.style.background = usernameInvalid ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = usernameInvalid ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.12)' }}
                  />
                </div>
                {usernameInvalid && <p className="mt-1.5 text-[11px] text-red-400">Username is required</p>}
              </div>

              {/* Password */}
              <div>
                <label className="mb-2 block text-[12px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  Password
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onBlur={() => setTouched(t => ({ ...t, password: true }))}
                    maxLength={128}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    className="w-full rounded-2xl py-3 pl-11 pr-12 text-[13px] text-white placeholder-white/30 outline-none transition"
                    style={{
                      background: passwordInvalid ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.08)',
                      border: `1px solid ${passwordInvalid ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.12)'}`,
                    }}
                    onFocus={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(0,176,215,0.6)' }}
                    onBlurCapture={e => { e.currentTarget.style.background = passwordInvalid ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = passwordInvalid ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.12)' }}
                  />
                  <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                    className="absolute inset-y-0 right-4 flex items-center transition"
                    style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {showPassword ? (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                        <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                        <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                      </svg>
                    )}
                  </button>
                </div>
                {passwordInvalid && <p className="mt-1.5 text-[11px] text-red-400">Password is required</p>}
              </div>

              {/* Sign in button */}
              <button
                type="submit"
                disabled={pending}
                className="mt-2 w-full rounded-2xl py-3.5 text-[13px] font-bold text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #00B0D7 0%, #1B2762 100%)',
                  boxShadow: '0 8px 24px rgba(0,176,215,0.35)',
                }}>
                {pending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in…
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 opacity-80">
                      <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Sign in to workspace
                  </span>
                )}
              </button>
            </form>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-center border-t pt-5" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                Access is restricted to your assigned modules
              </span>
            </div>
          </div>
        </div>

      <AuthToast toast={toast} />
    </div>
  )
}
