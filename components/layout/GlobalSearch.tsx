'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/lib/store'

// ── Types ──────────────────────────────────────────────────────────────────────
interface SearchResult {
  id: string
  type: 'contact' | 'product' | 'invoice' | 'repair' | 'purchase' | 'quote' | 'employee' | 'expense'
  title: string
  subtitle: string
  badge?: string
  badgeColor?: string
  href: string
  module: string
}

const TYPE_CONFIG: Record<SearchResult['type'], { label: string; icon: string; color: string; bg: string }> = {
  contact:  { label: 'Contact',   icon: '👤', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  product:  { label: 'Product',   icon: '📦', color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)' },
  invoice:  { label: 'Invoice',   icon: '🧾', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  repair:   { label: 'Repair',    icon: '🔧', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  purchase: { label: 'Purchase',  icon: '🛒', color: '#EC4899', bg: 'rgba(236,72,153,0.1)' },
  quote:    { label: 'Quote',     icon: '📋', color: '#06B6D4', bg: 'rgba(6,182,212,0.1)'  },
  employee: { label: 'Employee',  icon: '👔', color: '#64748B', bg: 'rgba(100,116,139,0.1)'},
  expense:  { label: 'Expense',   icon: '💸', color: '#F97316', bg: 'rgba(249,115,22,0.1)' },
}

const SHORTCUTS = [
  { label: 'New Repair',   key: 'R', href: '/repairs',   icon: '🔧' },
  { label: 'New Invoice',  key: 'I', href: '/sales',     icon: '🧾' },
  { label: 'POS',          key: 'P', href: '/pos',       icon: '🖥️' },
  { label: 'Inventory',    key: 'V', href: '/operations',icon: '📦' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-inherit rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { contacts, products, invoices, repairs, purchaseOrders, quotes, employees, expenses } = useApp()

  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Build results from all data sources
  const results = useMemo((): SearchResult[] => {
    const q = query.trim().toLowerCase()
    if (!q || q.length < 2) return []

    const out: SearchResult[] = []

    // Contacts
    ;(contacts || []).forEach(c => {
      if (
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
      ) {
        out.push({
          id: c.id, type: 'contact',
          title: c.name,
          subtitle: [c.phone, c.email].filter(Boolean).join(' · '),
          badge: c.isCustomer && c.isVendor ? 'Both' : c.isCustomer ? 'Customer' : 'Vendor',
          badgeColor: c.isCustomer ? '#10B981' : '#F59E0B',
          href: '/contacts', module: 'contacts',
        })
      }
    })

    // Products
    ;(products || []).forEach(p => {
      if (p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)) {
        out.push({
          id: p.id, type: 'product',
          title: p.name,
          subtitle: `${p.category} · SKU: ${p.sku || '—'} · Stock: ${p.stockQty ?? 0}`,
          badge: p.stockQty <= 0 ? 'Out of Stock' : p.stockQty <= (p.minStock ?? 3) ? 'Low Stock' : undefined,
          badgeColor: '#EF4444',
          href: '/operations', module: 'inventory',
        })
      }
    })

    // Invoices
    ;(invoices || []).filter(i => i.type === 'customer_invoice').forEach(inv => {
      if (inv.ref?.toLowerCase().includes(q) || inv.partnerName?.toLowerCase().includes(q)) {
        out.push({
          id: inv.id, type: 'invoice',
          title: inv.ref,
          subtitle: `${inv.partnerName} · KSh ${Math.round(inv.total || 0).toLocaleString()}`,
          badge: inv.status,
          badgeColor: inv.status === 'paid' ? '#10B981' : inv.status === 'overdue' ? '#EF4444' : '#F59E0B',
          href: '/sales', module: 'sales',
        })
      }
    })

    // Repairs
    ;(repairs || []).forEach(r => {
      if (
        r.ref?.toLowerCase().includes(q) ||
        r.customerName?.toLowerCase().includes(q) ||
        r.productName?.toLowerCase().includes(q)
      ) {
        out.push({
          id: r.id, type: 'repair',
          title: r.ref,
          subtitle: `${r.customerName} · ${r.productName}`,
          badge: r.status?.replace(/_/g, ' '),
          badgeColor: '#F59E0B',
          href: '/repairs', module: 'repair',
        })
      }
    })

    // Purchase Orders
    ;(purchaseOrders || []).forEach(po => {
      if (po.ref?.toLowerCase().includes(q) || po.vendorName?.toLowerCase().includes(q)) {
        out.push({
          id: po.id, type: 'purchase',
          title: po.ref,
          subtitle: `${po.vendorName} · KSh ${Math.round(po.total || 0).toLocaleString()}`,
          badge: po.status,
          badgeColor: po.status === 'received' ? '#10B981' : '#3B82F6',
          href: '/purchase', module: 'purchase',
        })
      }
    })

    // Quotes
    ;(quotes || []).forEach(q2 => {
      if (q2.quoteNumber?.toLowerCase().includes(q) || q2.client?.name?.toLowerCase().includes(q)) {
        out.push({
          id: q2.id, type: 'quote',
          title: q2.quoteNumber,
          subtitle: `${q2.client?.name ?? ''} · KSh ${Math.round(q2.totalAmount || 0).toLocaleString()}`,
          badge: q2.status,
          badgeColor: q2.status === 'accepted' ? '#10B981' : '#06B6D4',
          href: '/sales', module: 'sales',
        })
      }
    })

    // Employees
    ;(employees || []).forEach(emp => {
      if (emp.fullName?.toLowerCase().includes(q) || emp.jobTitle?.toLowerCase().includes(q) || emp.departmentId?.toLowerCase().includes(q)) {
        out.push({
          id: emp.id, type: 'employee',
          title: emp.fullName,
          subtitle: `${emp.jobTitle ?? ''} · ${emp.departmentId ?? ''}`,
          href: '/hr', module: 'hr',
        })
      }
    })

    // Expenses
    ;(expenses || []).forEach(exp => {
      if (exp.description?.toLowerCase().includes(q) || exp.submittedByName?.toLowerCase().includes(q)) {
        out.push({
          id: exp.id, type: 'expense',
          title: exp.description || 'Expense',
          subtitle: `${exp.submittedByName} · KSh ${Math.round(exp.amount || 0).toLocaleString()}`,
          badge: exp.status,
          badgeColor: exp.status === 'approved' ? '#10B981' : '#F59E0B',
          href: '/expenses', module: 'expenses',
        })
      }
    })

    return out.slice(0, 30)
  }, [query, contacts, products, invoices, repairs, purchaseOrders, quotes, employees, expenses])

  // Group results by type
  const grouped = useMemo(() => {
    const map: Partial<Record<SearchResult['type'], SearchResult[]>> = {}
    results.forEach(r => {
      if (!map[r.type]) map[r.type] = []
      map[r.type]!.push(r)
    })
    return map
  }, [results])

  const flatResults = useMemo(() => Object.values(grouped).flat(), [grouped])

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, flatResults.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && flatResults[activeIdx]) {
        navigate(flatResults[activeIdx])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, flatResults, activeIdx])

  // Scroll active item into view
  useEffect(() => {
    const el = resultsRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const navigate = useCallback((result: SearchResult) => {
    router.push(result.href)
    onClose()
  }, [router, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh] px-4"
      style={{ animation: 'backdropIn 0.15s ease both' }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-2xl bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border)] overflow-hidden flex flex-col"
        style={{ maxHeight: '75vh', animation: 'modalIn 0.2s cubic-bezier(0.34,1.2,0.64,1) both' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[var(--text-4)] shrink-0">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            placeholder="Search contacts, products, invoices, repairs…"
            className="flex-1 bg-transparent text-[var(--text-1)] placeholder:text-[var(--text-4)] text-sm font-medium outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-[var(--text-4)] hover:text-[var(--text-2)] text-lg leading-none transition-colors">×</button>
          )}
          <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-10 font-bold text-[var(--text-4)]">
            ESC
          </kbd>
        </div>

        <div ref={resultsRef} className="flex-1 overflow-y-auto custom-scrollbar">
          {/* No query — show shortcuts */}
          {!query.trim() && (
            <div className="p-4">
              <p className="text-10 font-black text-[var(--text-4)] uppercase tracking-widest mb-3">Quick Navigate</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SHORTCUTS.map(s => (
                  <button
                    key={s.key}
                    onClick={() => { router.push(s.href); onClose() }}
                    className="flex items-center gap-2.5 px-3 py-3 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)] border border-[var(--border)] text-left transition-all group active:scale-95"
                  >
                    <span className="text-xl">{s.icon}</span>
                    <span className="text-12 font-bold text-[var(--text-2)] group-hover:text-[var(--text-1)]">{s.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-10 font-medium text-[var(--text-4)] mt-4 text-center">
                Type at least 2 characters to search across all modules
              </p>
            </div>
          )}

          {/* Searching, no results */}
          {query.trim().length >= 2 && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center text-2xl">
                🔍
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-[var(--text-2)]">No results for "{query}"</p>
                <p className="text-xs text-[var(--text-4)] mt-1">Try a different keyword</p>
              </div>
            </div>
          )}

          {/* Results grouped by type */}
          {results.length > 0 && (() => {
            let globalIdx = 0
            return Object.entries(grouped).map(([type, items]) => {
              const cfg = TYPE_CONFIG[type as SearchResult['type']]
              return (
                <div key={type}>
                  <div className="px-4 py-2 bg-[var(--bg-surface)]/60 border-b border-[var(--border-lt)] sticky top-0">
                    <span className="text-10 font-black text-[var(--text-4)] uppercase tracking-widest">
                      {cfg.label}s &nbsp;·&nbsp; {items!.length}
                    </span>
                  </div>
                  {items!.map(result => {
                    const idx = globalIdx++
                    const isActive = idx === activeIdx
                    return (
                      <button
                        key={result.id}
                        data-idx={idx}
                        onClick={() => navigate(result)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all border-b border-[var(--border-lt)] last:border-0 ${isActive ? 'bg-blue-500/[0.07]' : 'hover:bg-[var(--bg-surface)]'}`}
                      >
                        {/* Icon */}
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base"
                          style={{ background: cfg.bg }}
                        >
                          {cfg.icon}
                        </div>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-13 font-bold text-[var(--text-1)] truncate">
                            {highlight(result.title, query)}
                          </p>
                          <p className="text-11 text-[var(--text-3)] truncate mt-0.5">
                            {highlight(result.subtitle, query)}
                          </p>
                        </div>

                        {/* Badge */}
                        {result.badge && (
                          <span
                            className="shrink-0 px-2 py-0.5 rounded-full text-9 font-black uppercase tracking-wider"
                            style={{
                              background: `${result.badgeColor}18`,
                              color: result.badgeColor,
                              border: `1px solid ${result.badgeColor}30`,
                            }}
                          >
                            {result.badge}
                          </span>
                        )}

                        {/* Arrow */}
                        {isActive && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[var(--text-4)] shrink-0">
                            <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })
          })()}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg-surface)]/50 flex items-center justify-between">
          <div className="flex items-center gap-3 text-10 text-[var(--text-4)] font-medium">
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-bold">↑↓</kbd> Navigate</span>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-bold">↵</kbd> Open</span>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-bold">Esc</kbd> Close</span>
          </div>
          {results.length > 0 && (
            <span className="text-10 text-[var(--text-4)] font-medium">{results.length} result{results.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  )
}
