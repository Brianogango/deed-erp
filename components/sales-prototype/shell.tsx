'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { PROTO_NAV } from './demo-data'
import './sales-prototype.css'

export function StatusPill({ label, tone }: { label: string; tone: string }) {
  return <span className={`sp-pill sp-pill-${tone}`}>{label}</span>
}

export function WorkflowBar({
  steps,
}: {
  steps: Array<{ key: string; label: string; state: 'done' | 'current' | 'todo' }>
}) {
  return (
    <div className="sp-workflow" role="list" aria-label="Sales workflow progress">
      {steps.map(step => (
        <div
          key={step.key}
          className="sp-workflow-step"
          role="listitem"
          data-state={step.state}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          {step.label}
        </div>
      ))}
    </div>
  )
}

export function TotalsPanel({
  rows,
  sticky,
}: {
  rows: Array<{ label: string; value: string; grand?: boolean }>
  sticky?: boolean
}) {
  return (
    <div className={`sp-totals${sticky ? ' sticky' : ''}`} aria-label="Document totals">
      {rows.map(row => (
        <div key={row.label} className={`sp-totals-row${row.grand ? ' grand' : ''}`}>
          <span>{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  )
}

export function useProtoToast() {
  const [message, setMessage] = useState<string | null>(null)
  const show = useCallback((msg: string) => {
    setMessage(msg)
  }, [])
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 2800)
    return () => window.clearTimeout(t)
  }, [message])
  const toast = message ? (
    <div className="sp-toast" role="status" aria-live="polite">
      {message}
    </div>
  ) : null
  return { show, toast }
}

export function ProtoAction({
  children,
  primary,
  success,
  ghost,
  onProto,
  message = 'Prototype only — not connected to production data.',
}: {
  children: ReactNode
  primary?: boolean
  success?: boolean
  ghost?: boolean
  onProto?: () => void
  message?: string
}) {
  const { show, toast } = useProtoToast()
  return (
    <>
      <button
        type="button"
        className={`sp-btn${primary ? ' sp-btn-primary' : ''}${success ? ' sp-btn-success' : ''}${ghost ? ' sp-btn-ghost' : ''}`}
        onClick={() => {
          onProto?.()
          show(message)
        }}
      >
        {children}
      </button>
      {toast}
    </>
  )
}

function navActive(pathname: string, href: string) {
  if (pathname === href) return true
  if (href === '/sales-prototype/quotations' && pathname === '/sales-prototype') return true
  return false
}

export function PrototypeShell({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const pathname = usePathname() || ''
  return (
    <div className="sales-proto">
      <a href="#sales-proto-main" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      <aside className="sales-proto-sidebar" aria-label="Prototype navigation">
        <div className="sales-proto-brand">
          <strong>Deed ERP</strong>
          <span>Sales prototype</span>
        </div>
        <div className="sales-proto-banner">
          Demo data only. Actions do not write to production.
        </div>
        <nav className="sales-proto-nav">
          <div className="sales-proto-nav-label">Screens</div>
          {PROTO_NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              data-active={navActive(pathname, item.href) ? 'true' : 'false'}
            >
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <div className="sales-proto-main">
        <header className="sales-proto-topbar">
          <div>
            <div className="sales-proto-topbar-title">{title}</div>
            <div className="sales-proto-topbar-meta">Selling · Prototype · Deed Technologies</div>
          </div>
          <div className="sales-proto-topbar-meta">KES · Brian · Director</div>
        </header>
        <main id="sales-proto-main" className="sales-proto-content">
          {children}
        </main>
      </div>
    </div>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
}) {
  return (
    <div className="sp-tabs" role="tablist" aria-label="Document sections">
      {tabs.map(tab => (
        <button
          key={tab}
          type="button"
          role="tab"
          className="sp-tab"
          aria-selected={active === tab}
          data-active={active === tab ? 'true' : 'false'}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
