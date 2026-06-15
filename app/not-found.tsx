'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4" style={{ animation: 'fadeIn 0.4s ease both' }}>
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #3B82F6 0%, transparent 70%)' }} />
      </div>

      <div className="relative z-10 text-center max-w-lg mx-auto">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-white font-bold text-lg tracking-tight">
            DEED <span className="text-cyan-400">ERP</span>
          </span>
        </div>

        {/* 404 number */}
        <div className="relative mb-6">
          <p className="text-[120px] sm:text-[160px] font-black leading-none text-transparent bg-clip-text select-none"
            style={{ backgroundImage: 'linear-gradient(135deg, #1E3A5F 0%, #243041 100%)' }}>
            404
          </p>
          <p className="absolute inset-0 flex items-center justify-center text-[120px] sm:text-[160px] font-black leading-none text-transparent bg-clip-text select-none"
            style={{ backgroundImage: 'linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', opacity: 0.15 }}>
            404
          </p>
        </div>

        {/* Message */}
        <h1 className="text-2xl sm:text-3xl font-black text-white mb-3 tracking-tight">
          Page Not Found
        </h1>
        <p className="text-slate-400 text-sm sm:text-base leading-relaxed mb-8 max-w-sm mx-auto">
          The page you're looking for doesn't exist or you may not have permission to view it.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-all active:scale-95 shadow-lg shadow-blue-900/40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="9 22 9 12 15 12 15 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Go to Dashboard
          </Link>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold transition-all active:scale-95 border border-slate-700"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Go Back
          </button>
        </div>

        {/* Quick links */}
        <div className="mt-10 pt-8 border-t border-slate-800">
          <p className="text-11 font-bold text-slate-500 uppercase tracking-widest mb-4">Quick Links</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {[
              { label: 'Sales', href: '/sales' },
              { label: 'Repairs', href: '/repairs' },
              { label: 'Inventory', href: '/operations' },
              { label: 'Finance', href: '/finance' },
              { label: 'HR', href: '/hr' },
              { label: 'Settings', href: '/settings' },
            ].map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 text-xs font-semibold border border-slate-700/50 transition-all"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
