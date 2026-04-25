'use client'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { requestLogin } from '@/lib/auth/client'
import { formatRoleLabel } from '@/lib/auth/access'
import { Toast } from '@/components/ui'

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  admin:      { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
  finance:    { bg: '#EDE9FE', text: '#4C1D95', border: '#DDD6FE' },
  lead_tech:  { bg: '#ECFDF5', text: '#064E3B', border: '#A7F3D0' },
  repair_tech: { bg: '#F0FDF4', text: '#14532D', border: '#BBF7D0' },
  sales_rep:  { bg: '#DBEAFE', text: '#1E40AF', border: '#BFDBFE' },
}


function RolePill({ role }: { role: string }) {
  const c = ROLE_COLORS[role] ?? { bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' }
  return (
    <span
      style={{ background: c.bg, color: c.text, borderColor: c.border }}
      className="inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide"
    >
      {formatRoleLabel(role)}
    </span>
  )
}

export default function Login() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [touched, setTouched] = useState({ username: false, password: false })

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
      const { ok, payload } = await requestLogin(username.trim(), password)
      if (!ok) {
        setToast({ msg: payload?.message ?? 'Invalid username or password', type: 'error' })
        return
      }
      setToast({ msg: 'Access granted. Redirecting...', type: 'success' })
      router.replace('/')
      router.refresh()
    } catch {
      setToast({ msg: 'Authentication service is unavailable', type: 'error' })
    } finally {
      setPending(false)
    }
  }

  const usernameInvalid = touched.username && !username.trim()
  const passwordInvalid = touched.password && !password

  return (
    <div className="relative flex min-h-screen items-stretch overflow-hidden bg-[#0A0C14]">
      {/* ── Left hero panel ── */}
      <div className="relative hidden w-[48%] flex-col justify-between overflow-hidden lg:flex">
        {/* gradient mesh */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-[36rem] w-[36rem] rounded-full bg-[#00B0D7]/20 blur-[80px]" />
          <div className="absolute -bottom-32 -right-16 h-[30rem] w-[30rem] rounded-full bg-[#1B2762]/40 blur-[90px]" />
          <div className="absolute left-1/3 top-1/2 h-[20rem] w-[20rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00B0D7]/12 blur-[70px]" />
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
              backgroundSize: '36px 36px',
            }}
          />
        </div>

        <div className="relative z-10 flex flex-col justify-between h-full p-10 xl:p-14">
          {/* Logo / brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-lg"
              style={{ background: 'linear-gradient(135deg, #00B0D7, #0090B0)', boxShadow: '0 4px 14px rgba(0,176,215,0.4)' }}>
              <span className="text-white font-black text-xl" style={{ letterSpacing: '-1px' }}>d</span>
            </div>
            <div>
              <p className="text-sm font-bold text-white">deed <span className="font-normal opacity-70">Technologies</span></p>
              <p className="text-[10px] tracking-widest uppercase" style={{ color: '#00B0D7' }}>Enterprise ERP</p>
            </div>
          </div>

          {/* Main copy */}
          <div className="mt-12">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#00B0D7]/40 bg-[#00B0D7]/10 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00B0D7] animate-pulse" />
              <span className="text-[11px] font-medium text-[#7DD9F0]">Live system · All modules ready</span>
            </div>
            <h1 className="text-4xl xl:text-5xl font-bold leading-[1.15] text-white tracking-tight">
              One platform,<br />
              <span className="bg-gradient-to-r from-[#00B0D7] to-[#7DD9F0] bg-clip-text text-transparent">
                every department.
              </span>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-[#94A3B8]">
              Deed ERP unifies inventory, repairs, procurement, HR, finance, and sales into a
              single authenticated workspace — each user landing exactly where they belong.
            </p>

            {/* Feature grid */}
            <div className="mt-8 grid grid-cols-2 gap-3">
              {[
                { icon: '🔐', title: 'Role-scoped access', desc: 'Users see only the modules assigned to their role.' },
                { icon: '🍪', title: 'Signed sessions', desc: 'HTTP-only cookies prevent token hijacking.' },
                { icon: '🛡️', title: 'Server-side guards', desc: 'Middleware rejects unauthorised page loads.' },
                { icon: '⚡', title: 'Instant routing', desc: 'First allowed module loads immediately after sign-in.' },
              ].map(f => (
                <div key={f.title} className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <p className="text-lg mb-1">{f.icon}</p>
                  <p className="text-xs font-semibold text-white">{f.title}</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#64748B]">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom trust bar */}
          <div className="mt-10 flex items-center gap-4 border-t border-white/8 pt-6">
            <div className="flex -space-x-2">
              {['#1B2762', '#00B0D7', '#243580', '#0090B0'].map((c, i) => (
                <div
                  key={i}
                  style={{ background: c }}
                  className="h-7 w-7 rounded-full border-2 border-[#0A0C14] ring-1 ring-white/10"
                />
              ))}
            </div>
            <p className="text-[11px] text-[#64748B]">
              <span className="text-white font-semibold">9 user roles</span> · 11 modules · Deed Technologies
            </p>
          </div>
        </div>
      </div>

      {/* ── Right sign-in panel ── */}
      <div className="relative flex flex-1 flex-col items-center justify-center bg-[#F4F6FA] px-5 py-10 sm:px-8 lg:px-12">
        {/* Mobile brand */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, #1B2762, #00B0D7)' }}>
            <span className="text-white font-black text-lg" style={{ letterSpacing: '-1px' }}>d</span>
          </div>
          <p className="font-bold tracking-widest text-[#111827]">DEED TECHNOLOGIES</p>
        </div>

        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-7">
            <h2 className="text-2xl font-bold text-[#111827] sm:text-3xl">Sign in to your workspace</h2>
            <p className="mt-1.5 text-sm text-[#6B7280]">Enter your credentials to access your assigned modules.</p>
          </div>

          {/* Form card */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm sm:p-8">
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              {/* Username */}
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#374151]">
                  Username <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#9CA3AF]">
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
                    pattern="^[a-zA-Z0-9_\-\.]+$"
                    placeholder="e.g. superadmin"
                    autoFocus
                    autoComplete="username"
                    className={`w-full rounded-xl border py-2.5 pl-9 pr-4 text-sm text-[#111827] placeholder-[#9CA3AF] outline-none transition focus:ring-2 ${
                      usernameInvalid
                        ? 'border-red-400 focus:ring-red-100'
                        : 'border-[#D1D5DB] focus:border-[#1B2762] focus:ring-[#E8F3FA]'
                    }`}
                  />
                </div>
                {usernameInvalid && (
                  <p className="mt-1 text-xs text-red-500">Username is required</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#374151]">
                  Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#9CA3AF]">
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
                    placeholder="Your password"
                    autoComplete="current-password"
                    className={`w-full rounded-xl border py-2.5 pl-9 pr-10 text-sm text-[#111827] placeholder-[#9CA3AF] outline-none transition focus:ring-2 ${
                      passwordInvalid
                        ? 'border-red-400 focus:ring-red-100'
                        : 'border-[#D1D5DB] focus:border-[#1B2762] focus:ring-[#E8F3FA]'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute inset-y-0 right-3 flex items-center text-[#9CA3AF] hover:text-[#6B7280]"
                    tabIndex={-1}
                  >
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
                {passwordInvalid && (
                  <p className="mt-1 text-xs text-red-500">Password is required</p>
                )}
              </div>

              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-xl bg-[#1B2762] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#14204F] active:bg-[#0D1A4A] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in…
                  </span>
                ) : (
                  'Sign in to workspace'
                )}
              </button>
            </form>
          </div>

          {/* Access note */}
          <p className="mt-4 text-center text-[11px] text-[#9CA3AF]">
            Access is restricted to your assigned modules. Contact your system administrator to request changes.
          </p>
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  )
}
