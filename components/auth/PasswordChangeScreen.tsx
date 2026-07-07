'use client'

import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthToast, PortalPageSkeleton } from '@/components/auth/AuthFeedback'

type ToastState = { msg: string; type: 'success' | 'error' | 'info' } | null

type SessionUser = {
  id: string
  name?: string
  username?: string
  email?: string | null
}

interface Props {
  user: SessionUser
}

/**
 * Returns a list of human-readable validation problems for a candidate password.
 * Mirrors the server-side rule (>= 6 chars) but adds basic strength hints.
 */
const evaluatePassword = (pwd: string): string[] => {
  const problems: string[] = []
  if (pwd.length < 8) problems.push('At least 8 characters')
  if (!/[A-Z]/.test(pwd)) problems.push('One uppercase letter')
  if (!/[a-z]/.test(pwd)) problems.push('One lowercase letter')
  if (!/[0-9]/.test(pwd)) problems.push('One number')
  if (!/[^A-Za-z0-9]/.test(pwd)) problems.push('One symbol')
  return problems
}

function PasswordChangeForm({ user }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const forced = searchParams.get('force') === 'true'

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [pending, setPending] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const problems = useMemo(() => evaluatePassword(newPassword), [newPassword])
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword
  const formValid =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    passwordsMatch &&
    newPassword !== currentPassword

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formValid || pending) return
    setPending(true)
    try {
      // Re-verify current password by attempting a login. Avoids exposing a bespoke verify endpoint.
      const verifyRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, password: currentPassword }),
      })
      if (!verifyRes.ok) {
        setToast({ msg: 'Current password is incorrect', type: 'error' })
        setPending(false)
        return
      }

      const updateRes = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword, mustChangePassword: false }),
      })
      if (!updateRes.ok) {
        const data = await updateRes.json().catch(() => ({}))
        setToast({ msg: data?.message || 'Could not update password. Please try again.', type: 'error' })
        setPending(false)
        return
      }

      setToast({ msg: 'Password updated. Redirecting…', type: 'success' })
      window.setTimeout(() => {
        router.replace('/')
        router.refresh()
      }, 800)
    } catch {
      setToast({ msg: 'Network error. Please try again.', type: 'error' })
      setPending(false)
    }
  }

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #04080f 0%, #0b1628 40%, #0f2044 70%, #0a1a38 100%)' }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full opacity-25"
          style={{ background: 'radial-gradient(circle, #22B8E6 0%, transparent 70%)', filter: 'blur(80px)' }}
        />
        <div
          className="absolute -bottom-48 -right-40 h-[480px] w-[480px] rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #15193D 0%, transparent 70%)', filter: 'blur(90px)' }}
        />
        <img
          src="/deed-logo.png"
          alt=""
          aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{
            left: '50%',
            top: '50%',
            width: 'min(60vmin, 540px)',
            height: 'min(60vmin, 540px)',
            transform: 'translate(-50%, -50%)',
            opacity: 0.05,
            filter: 'brightness(0) invert(1)',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="rounded-3xl bg-white/95 shadow-2xl backdrop-blur-md p-8">
          <div className="text-center mb-6">
            <img src="/deed-logo.png" alt="Deed" className="mx-auto h-10 mb-3" />
            <h1 className="text-xl font-bold text-navy-500">
              {forced ? 'Set a new password' : 'Change your password'}
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              {forced
                ? 'Your account uses a temporary password. Please choose a new one to continue.'
                : 'Update your password. Use a strong, unique secret you do not reuse elsewhere.'}
            </p>
            {user.name ? (
              <p className="text-[11px] text-gray-400 mt-3">
                Signed in as <span className="font-medium text-gray-600">{user.name}</span>
                {user.username ? <> ({user.username})</> : null}
              </p>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                {forced ? 'Temporary password' : 'Current password'}
              </label>
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 outline-none focus:border-navy-500 focus:ring-2 focus:ring-[#1B2762]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-gray-500 hover:text-navy-500"
                >
                  {showCurrent ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">New password</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 outline-none focus:border-navy-500 focus:ring-2 focus:ring-[#1B2762]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-gray-500 hover:text-navy-500"
                >
                  {showNew ? 'HIDE' : 'SHOW'}
                </button>
              </div>
              {newPassword.length > 0 && problems.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {problems.map((p) => (
                    <li key={p} className="text-[10px] text-amber-600">
                      • {p}
                    </li>
                  ))}
                </ul>
              ) : null}
              {newPassword.length > 0 && problems.length === 0 ? (
                <p className="mt-2 text-[10px] text-emerald-600">Strong password</p>
              ) : null}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Confirm new password</label>
              <input
                type={showNew ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-navy-500 focus:ring-2 focus:ring-[#1B2762]/20"
              />
              {confirmPassword.length > 0 && !passwordsMatch ? (
                <p className="mt-1 text-[10px] text-red-600">Passwords do not match</p>
              ) : null}
              {newPassword.length > 0 && newPassword === currentPassword ? (
                <p className="mt-1 text-[10px] text-red-600">
                  New password cannot be the same as your current password
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={!formValid || pending}
              className="w-full rounded-lg bg-navy-500 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-600 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {pending ? 'Updating…' : forced ? 'Set password and continue' : 'Update password'}
            </button>

            {!forced ? (
              <button
                type="button"
                onClick={() => router.back()}
                className="w-full rounded-lg border border-gray-200 bg-white py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
            ) : null}
          </form>

          <p className="mt-6 text-center text-[10px] text-gray-400">
            For security, you will be asked to sign in again if your session expires.
          </p>
        </div>
      </div>

      <AuthToast toast={toast} />
    </div>
  )
}

export default function PasswordChangeScreen({ user }: Props) {
  return (
    <Suspense fallback={<PortalPageSkeleton label="Loading password form…" />}>
      <PasswordChangeForm user={user} />
    </Suspense>
  )
}
