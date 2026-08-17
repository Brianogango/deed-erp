'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/lib/store'
import { invoiceDocState, invoicePaymentStatus, isInvoiceOverdue, displayDocRef, PAYMENT_STATUS_LABELS } from '@/lib/odoo-sales-flow'
import { useHrStore } from '@/hooks/useHrStore'
import { trackUxEvent } from '@/lib/ux-telemetry'
import {
  Fa, faUser, faBoxesStacked, faFileInvoiceDollar, faScrewdriverWrench,
  faCartShopping, faClipboardList, faUserTie, faMoneyBillWave,
  faArrowRight, faCashRegister, faMagnifyingGlass,
} from '@/components/icons'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { useOverlayDismiss } from '@/lib/overlay-dismiss'

// ── Types ──────────────────────────────────────────────────────────────────────
interface SearchResult {
  id: string
  type: 'contact' | 'product' | 'invoice' | 'repair' | 'purchase' | 'quote' | 'employee' | 'expense' | 'command' | 'module'
  title: string
  subtitle: string
  badge?: string
  badgeColor?: string
  href: string
  module: string
}

const TYPE_CONFIG: Record<SearchResult['type'], { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  contact:  { label: 'Contact',   icon: <Fa icon={faUser} />,               color: 'var(--primary)', bg: 'rgba(59,130,246,0.1)' },
  product:  { label: 'Product',   icon: <Fa icon={faBoxesStacked} />,       color: '#8B5CF6',        bg: 'rgba(139,92,246,0.1)' },
  invoice:  { label: 'Invoice',   icon: <Fa icon={faFileInvoiceDollar} />,  color: 'var(--success)', bg: 'rgba(16,185,129,0.1)' },
  repair:   { label: 'Repair',    icon: <Fa icon={faScrewdriverWrench} />,  color: 'var(--warning)', bg: 'rgba(245,158,11,0.1)' },
  purchase: { label: 'Purchase',  icon: <Fa icon={faCartShopping} />,       color: '#EC4899',        bg: 'rgba(236,72,153,0.1)' },
  quote:    { label: 'Quote',     icon: <Fa icon={faClipboardList} />,      color: '#06B6D4',        bg: 'rgba(6,182,212,0.1)'  },
  employee: { label: 'Employee',  icon: <Fa icon={faUserTie} />,            color: 'var(--text-4)',  bg: 'rgba(100,116,139,0.1)'},
  expense:  { label: 'Expense',   icon: <Fa icon={faMoneyBillWave} />,      color: '#F97316',        bg: 'rgba(249,115,22,0.1)' },
  command:  { label: 'Command',   icon: '⌘',                                color: 'var(--primary-dark)', bg: 'rgba(29,78,216,0.12)' },
  module:   { label: 'Module',    icon: <Fa icon={faArrowRight} />,         color: '#334155',        bg: 'rgba(51,65,85,0.1)' },
}

const SHORTCUTS: Array<{ label: string; key: string; href: string; module: string; icon: IconProp }> = [
  { label: 'New Repair',   key: 'R', href: '/repairs',    module: 'repair', icon: faScrewdriverWrench },
  { label: 'New Invoice',  key: 'I', href: '/sales',      module: 'sales', icon: faFileInvoiceDollar },
  { label: 'POS',          key: 'P', href: '/pos',        module: 'pos', icon: faCashRegister },
  { label: 'Inventory',    key: 'V', href: '/operations', module: 'inventory', icon: faBoxesStacked },
]

const COMMAND_ACTIONS: Array<Pick<SearchResult, 'id' | 'title' | 'subtitle' | 'href' | 'module'> & { aliases: string[] }> = [
  {
    id: 'cmd-create-invoice',
    title: 'Create invoice',
    subtitle: 'Jump to Sales invoices workspace',
    href: '/sales?tab=invoices&quick=create',
    module: 'sales',
    aliases: ['invoice', 'create invoice', 'new invoice', 'bill customer'],
  },
  {
    id: 'cmd-create-repair',
    title: 'Create repair ticket',
    subtitle: 'Open Repair intake flow',
    href: '/repairs?quick=new',
    module: 'repair',
    aliases: ['repair', 'new repair', 'repair intake'],
  },
  {
    id: 'cmd-open-finance',
    title: 'Open finance dashboard',
    subtitle: 'Invoices, bills, payments, and ledgers',
    href: '/finance',
    module: 'accounting',
    aliases: ['finance', 'accounting', 'cashbook'],
  },
  {
    id: 'cmd-open-hr',
    title: 'Open HR workspace',
    subtitle: 'Leave, payroll, and employee records',
    href: '/hr',
    module: 'hr',
    aliases: ['hr', 'payroll', 'leave'],
  },
]

const MODULE_SHORTCUTS: Array<{ id: string; title: string; subtitle: string; href: string; module: string; aliases: string[] }> = [
  { id: 'mod-dashboard', title: 'Dashboard', subtitle: 'Today’s work overview', href: '/', module: 'dashboard', aliases: ['home', 'dashboard'] },
  { id: 'mod-sales', title: 'Sales', subtitle: 'Quotes, orders, invoices', href: '/sales', module: 'sales', aliases: ['sales', 'quotes', 'invoices'] },
  { id: 'mod-crm', title: 'CRM', subtitle: 'Customers, opportunities, and pipeline', href: '/crm', module: 'crm', aliases: ['crm', 'pipeline', 'opportunities'] },
  { id: 'mod-pos', title: 'Point of Sale', subtitle: 'Retail till and transactions', href: '/pos', module: 'pos', aliases: ['pos', 'till', 'retail'] },
  { id: 'mod-ecommerce', title: 'E-commerce', subtitle: 'Online store management', href: '/ecommerce', module: 'ecommerce', aliases: ['ecommerce', 'online store'] },
  { id: 'mod-kilimall', title: 'Kilimall', subtitle: 'Marketplace orders and settlements', href: '/kilimall', module: 'kilimall', aliases: ['kilimall', 'marketplace'] },
  { id: 'mod-contacts', title: 'Contacts', subtitle: 'Customers, vendors, and staff', href: '/contacts', module: 'contacts', aliases: ['contacts', 'customers', 'vendors'] },
  { id: 'mod-repairs', title: 'Repairs', subtitle: 'Workshop and service tickets', href: '/repairs', module: 'repair', aliases: ['repair', 'workshop'] },
  { id: 'mod-operations', title: 'Inventory', subtitle: 'Stock control and transfers', href: '/operations', module: 'inventory', aliases: ['inventory', 'stock', 'operations'] },
  { id: 'mod-purchases', title: 'Purchases', subtitle: 'Purchase orders and bills', href: '/purchases', module: 'purchase', aliases: ['purchases', 'procurement', 'vendors'] },
  { id: 'mod-delivery', title: 'Delivery', subtitle: 'Riders and delivery tracking', href: '/delivery', module: 'delivery', aliases: ['delivery', 'riders', 'dispatch'] },
  { id: 'mod-refurbishment', title: 'Refurbishment', subtitle: 'Internal device refurbishment', href: '/refurbishment', module: 'refurbishment', aliases: ['refurbishment', 'refurbish'] },
  { id: 'mod-reconfiguration', title: 'Device Reconfiguration', subtitle: 'Upgrade and downgrade serialized machines', href: '/reconfiguration', module: 'reconfiguration', aliases: ['reconfiguration', 'reconfigure', 'upgrade', 'downgrade', 'rcf'] },
  { id: 'mod-outsource', title: 'Outsource', subtitle: 'External repair vendors', href: '/outsource', module: 'outsource', aliases: ['outsource', 'external repair'] },
  { id: 'mod-aftersales', title: 'After-Sales', subtitle: 'Warranties and RMAs', href: '/aftersales', module: 'after_sales', aliases: ['after sales', 'warranty', 'rma'] },
  { id: 'mod-holdovers', title: 'Holdovers', subtitle: 'Device loans and temporary issues', href: '/holdovers', module: 'holdovers', aliases: ['holdovers', 'device loans'] },
  { id: 'mod-finance', title: 'Finance', subtitle: 'Accounting and settlements', href: '/finance', module: 'accounting', aliases: ['finance', 'accounting', 'bills'] },
  { id: 'mod-deposits', title: 'Deposits', subtitle: 'Customer deposits and layby', href: '/deposits', module: 'deposits', aliases: ['deposits', 'layby'] },
  { id: 'mod-expenses', title: 'Expenses', subtitle: 'Staff expense claims', href: '/expenses', module: 'expenses', aliases: ['expenses', 'claims'] },
  { id: 'mod-hr', title: 'HR', subtitle: 'People operations and payroll', href: '/hr', module: 'hr', aliases: ['hr', 'leave', 'payroll'] },
  { id: 'mod-documents', title: 'My Documents', subtitle: 'Policies and personal documents', href: '/documents', module: 'my_documents', aliases: ['documents', 'policies'] },
  { id: 'mod-targets', title: 'KPI Targets', subtitle: 'Performance goals and scorecards', href: '/sops', module: 'sops', aliases: ['kpi', 'targets', 'performance'] },
  { id: 'mod-sops', title: 'Standards & SOPs', subtitle: 'Company standards and procedures', href: '/sop-documents', module: 'sop_documents', aliases: ['sop', 'standards', 'procedures'] },
  { id: 'mod-settings', title: 'Settings', subtitle: 'System configuration and users', href: '/settings', module: 'settings', aliases: ['settings', 'configuration', 'users'] },
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
  const { contacts, products, invoices, repairs, purchaseOrders, quotes, expenses, currentUser } = useApp()
  const { employees } = useHrStore()

  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const overlayDismiss = useOverlayDismiss(onClose)

  // Treat the command palette as a modal: trap focus, close on Escape, and
  // restore focus to the control that launched it.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      ).filter(element => element.offsetParent !== null || element === document.activeElement)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handler)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  // Build results from all data sources
  const results = useMemo((): SearchResult[] => {
    const q = query.trim().toLowerCase()
    if (!q) return []

    const out: SearchResult[] = []
    const canSearchRecords = q.length >= 2

    const allowedModules = new Set<string>(['dashboard', ...(currentUser?.modules ?? [])])
    if (currentUser?.role === 'director') allowedModules.add('settings')

    const commandHits = COMMAND_ACTIONS
      .filter(cmd => allowedModules.has(cmd.module))
      .filter(cmd =>
      [cmd.title, cmd.subtitle, ...cmd.aliases].join(' ').toLowerCase().includes(q)
    )
    commandHits.forEach(cmd => {
      out.push({
        id: cmd.id,
        type: 'command',
        title: cmd.title,
        subtitle: cmd.subtitle,
        href: cmd.href,
        module: cmd.module,
      })
    })

    for (const mod of MODULE_SHORTCUTS) {
      if (
        allowedModules.has(mod.module) &&
        [mod.title, mod.subtitle, ...mod.aliases].join(' ').toLowerCase().includes(q)
      ) {
        out.push({
          id: mod.id,
          type: 'module',
          title: mod.title,
          subtitle: mod.subtitle,
          href: mod.href,
          module: mod.module,
        })
      }
    }

    if (/^open\s+repair\s+|^repair\s+rep-|^rep-/.test(q)) {
      const targetRepair = repairs.find(r => r.ref?.toLowerCase().includes(q.replace(/^open\s+repair\s+/, '').trim()))
      if (targetRepair) {
        out.unshift({
          id: `cmd-open-${targetRepair.id}`,
          type: 'command',
          title: `Open repair ${targetRepair.ref}`,
          subtitle: `${targetRepair.customerName} · ${targetRepair.productName}`,
          href: `/repairs?id=${targetRepair.id}`,
          module: 'repair',
        })
      }
    }

    if (!canSearchRecords) return out.slice(0, 30)

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
        const payState = invoicePaymentStatus(inv)
        out.push({
          id: inv.id, type: 'invoice',
          title: displayDocRef(inv.ref),
          subtitle: `${inv.partnerName} · KSh ${Math.round(inv.total || 0).toLocaleString()}`,
          badge: invoiceDocState(inv.status) === 'posted' ? PAYMENT_STATUS_LABELS[payState] : invoiceDocState(inv.status),
          badgeColor: payState === 'paid' ? '#10B981' : isInvoiceOverdue(inv) ? '#EF4444' : '#F59E0B',
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
          href: `/repairs?id=${r.id}`, module: 'repair',
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
          href: '/purchases', module: 'purchase',
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
  }, [query, contacts, products, invoices, repairs, purchaseOrders, quotes, employees, expenses, currentUser?.modules, currentUser?.role])

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
        if (flatResults.length === 0) return
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, flatResults.length - 1))
      } else if (e.key === 'ArrowUp') {
        if (flatResults.length === 0) return
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
    trackUxEvent('search_navigate', {
      resultType: result.type,
      module: result.module,
      href: result.href,
    })
    router.push(result.href)
    onClose()
  }, [router, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9800] flex items-start justify-center overflow-y-auto px-4 py-4 sm:pt-[10vh]"
      style={{ animation: 'backdropIn 0.15s ease both' }}
      {...overlayDismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
        aria-describedby="global-search-description"
        tabIndex={-1}
        className="relative w-full max-w-2xl bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border)] overflow-hidden flex flex-col"
        style={{ maxHeight: '75vh', animation: 'modalIn 0.2s cubic-bezier(0.34,1.2,0.64,1) both' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="global-search-title" className="sr-only">Search and navigate</h2>
        <p id="global-search-description" className="sr-only">Search records, run commands, or jump to an ERP module.</p>
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[var(--text-4)] shrink-0">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            aria-label="Search records, commands, and modules"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="global-search-results"
            aria-expanded={results.length > 0}
            aria-activedescendant={flatResults[activeIdx] ? `global-search-result-${activeIdx}` : undefined}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            placeholder="Search records, run commands, or jump to modules…"
            className="flex-1 bg-transparent text-[var(--text-1)] placeholder:text-[var(--text-4)] text-sm font-medium outline-none"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-[var(--text-4)] hover:text-[var(--text-2)] text-lg leading-none transition-colors">×</button>
          )}
          <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[10px] font-bold text-[var(--text-4)]">
            ESC
          </kbd>
        </div>

        <div
          id="global-search-results"
          ref={resultsRef}
          role={results.length > 0 ? 'listbox' : undefined}
          aria-label={results.length > 0 ? 'Search results' : undefined}
          className="flex-1 overflow-y-auto custom-scrollbar"
        >
          {/* No query — show shortcuts */}
          {!query.trim() && (
            <div className="p-4">
              <p className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest mb-3">Quick Navigate</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SHORTCUTS.filter(shortcut => currentUser?.modules?.some(module => module === shortcut.module)).map(s => (
                  <button
                    type="button"
                    key={s.key}
                    onClick={() => { router.push(s.href); onClose() }}
                    className="flex items-center gap-2.5 px-3 py-3 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)] border border-[var(--border)] text-left transition-colors group active:scale-95"
                  >
                    <span className="text-xl" style={{ color: 'var(--primary)' }} aria-hidden="true"><Fa icon={s.icon} /></span>
                    <span className="text-[12px] font-bold text-[var(--text-2)] group-hover:text-[var(--text-1)]">{s.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] font-medium text-[var(--text-4)] mt-4 text-center">
                Start typing to run commands, jump modules, or search records
              </p>
            </div>
          )}

          {/* Searching, no results */}
          {query.trim().length >= 2 && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center text-2xl" style={{ color: 'var(--text-4)' }} aria-hidden="true">
                <Fa icon={faMagnifyingGlass} />
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
                <div key={type} role="group" aria-label={`${cfg.label} results`}>
                  <div className="px-4 py-2 bg-[var(--bg-surface)]/60 border-b border-[var(--border-lt)] sticky top-0">
                    <span className="text-[10px] font-black text-[var(--text-4)] uppercase tracking-widest">
                      {cfg.label}s &nbsp;·&nbsp; {items!.length}
                    </span>
                  </div>
                  {items!.map(result => {
                    const idx = globalIdx++
                    const isActive = idx === activeIdx
                    return (
                      <button
                        type="button"
                        key={result.id}
                        id={`global-search-result-${idx}`}
                        role="option"
                        aria-selected={isActive}
                        data-idx={idx}
                        onClick={() => navigate(result)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all border-b border-[var(--border-lt)] last:border-0 ${isActive ? 'bg-blue-500/[0.07]' : 'hover:bg-[var(--bg-surface)]'}`}
                      >
                        {/* Icon */}
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base"
                          style={{ background: cfg.bg, color: cfg.color }}
                          aria-hidden="true"
                        >
                          {cfg.icon}
                        </div>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-[var(--text-1)] truncate">
                            {highlight(result.title, query)}
                          </p>
                          <p className="text-[11px] text-[var(--text-3)] truncate mt-0.5">
                            {highlight(result.subtitle, query)}
                          </p>
                        </div>

                        {/* Badge */}
                        {result.badge && (
                          <span
                            className="shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider"
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
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-4)] font-medium">
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-bold">↑↓</kbd> Navigate</span>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-bold">↵</kbd> Open</span>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-bold">Esc</kbd> Close</span>
          </div>
          {results.length > 0 && (
            <span className="text-[10px] text-[var(--text-4)] font-medium">{results.length} result{results.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  )
}
