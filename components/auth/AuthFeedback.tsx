'use client'

import type { ReactNode } from 'react'

type ToastState = { msg: string; type: 'success' | 'error' | 'info' } | null

const toastStyles: Record<NonNullable<ToastState>['type'], { label: string; classes: string }> = {
  success: { label: 'Success', classes: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-50' },
  error: { label: 'Error', classes: 'border-red-400/35 bg-red-500/15 text-red-50' },
  info: { label: 'Info', classes: 'border-sky-400/35 bg-sky-500/15 text-sky-50' },
}

export function AuthToast({ toast }: { toast: ToastState }) {
  if (!toast) return null
  const style = toastStyles[toast.type]
  return (
    <div className={['fixed bottom-6 right-4 z-[9999] max-w-sm rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur', style.classes].join(' ')}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">{style.label}</p>
      <p className="mt-1 text-[13px] font-semibold leading-snug">{toast.msg}</p>
    </div>
  )
}

export function PortalPageSkeleton({ label = 'Loading...' }: { label?: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050A13] px-4">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.06] p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="mx-auto mb-5 h-12 w-12 animate-pulse rounded-2xl bg-white/15" />
        <div className="mx-auto mb-3 h-4 w-40 animate-pulse rounded-full bg-white/15" />
        <p className="text-xs font-semibold text-white/70">{label}</p>
      </div>
    </div>
  )
}
