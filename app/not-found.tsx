'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Http404Beacon } from '@/components/Http404Beacon'

export default function NotFound() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <Http404Beacon />
      <div className="relative z-10 text-center max-w-lg mx-auto">
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-[var(--navy)] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-t1 font-bold text-lg tracking-tight">
            DEED <span className="text-[var(--primary)]">ERP</span>
          </span>
        </div>

        <p className="text-2xl sm:text-3xl font-black text-t1 mb-3 tracking-tight">404</p>
        <h1 className="text-2xl sm:text-3xl font-black text-t1 mb-3 tracking-tight">
          Page Not Found
        </h1>
        <p className="text-t3 text-sm leading-relaxed mb-8 max-w-sm mx-auto">
          The page you&apos;re looking for doesn&apos;t exist or you may not have permission to view it.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[var(--sales-blue)] hover:bg-[var(--sales-blue-hover,#1D4ED8)] text-white text-sm font-bold transition-all"
          >
            Go to Dashboard
          </Link>
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] text-t2 text-sm font-bold border border-[var(--border)]"
          >
            Go Back
          </button>
        </div>

        <div className="mt-10 pt-8 border-t border-[var(--border)]">
          <p className="text-[11px] font-bold text-t4 uppercase tracking-widest mb-4">Quick Links</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {[
              { label: 'Sales', href: '/sales' },
              { label: 'Repairs', href: '/repairs' },
              { label: 'Inventory', href: '/inventory' },
              { label: 'Finance', href: '/finance' },
              { label: 'HR', href: '/hr' },
              { label: 'Settings', href: '/settings' },
            ].map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-1.5 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] text-t3 hover:text-t2 text-xs font-semibold border border-[var(--border)]"
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
