'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Fa } from '@/components/icons'
import {
  faChartLine, faShoppingCart, faBuildingColumns, faUsers, faGear, faBoxesStacked, faScrewdriverWrench,
  faDesktop, faGlobe, faAddressBook, faCartShopping, faTruck, faArrowsRotate, faShieldHalved, faReceipt,
  faChevronRight, faChevronLeft, faChevronDown, faMoneyBillWave, faHandHolding, faBullseye, faFileLines
} from '@fortawesome/free-solid-svg-icons'
import { useShellStore, ModuleId } from '@/lib/store'
import { hasModuleAccess } from '@/lib/auth/access'
import { trackUxEvent } from '@/lib/ux-telemetry'
import { warmRoute } from '@/lib/warm-route'

// Brand colours
const DEED_BLUE  = 'var(--primary)'
const DEED_NAVY  = 'var(--navy)'

function normalizePath(path: string | null | undefined) {
  const clean = (path || '/').split('?')[0].split('#')[0]
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1)
  return clean || '/'
}

function pathMatchesRoute(pathname: string, route: string) {
  const path = normalizePath(pathname)
  const base = normalizePath(route)
  if (base === '/') return path === '/'
  return path === base || path.startsWith(`${base}/`)
}

function isNavItemActive(pathname: string | null, item: NavItem) {
  return pathMatchesRoute(pathname || '/', item.href)
}

interface NavItem {
  label: string
  href: string
  id: ModuleId | 'settings'
  icon: any
  badge?: number
}

interface NavGroup {
  title: string
  items: NavItem[]
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { sidebarOpen, toggleSidebar, getVisibleRepairs, users, currentUserId, activeModule, setModule } = useShellStore()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role || ''
  const visibleRepairsRaw = getVisibleRepairs()
  const pendingRepairs = (Array.isArray(visibleRepairsRaw) ? visibleRepairsRaw : [])
    .filter(r => ['received', 'assigned'].includes(r.status)).length

  const allItems: NavItem[] = [
    { label: 'Dashboard',     href: '/',              id: 'dashboard',     icon: faChartLine },
    { label: 'Sales',         href: '/sales',         id: 'sales',         icon: faShoppingCart },
    { label: 'CRM',           href: '/crm',           id: 'crm',           icon: faUsers },
    { label: 'POS',           href: '/pos',           id: 'pos',           icon: faDesktop },
    { label: 'E-commerce',    href: '/ecommerce',     id: 'ecommerce',     icon: faGlobe },
    { label: 'Kilimall',      href: '/kilimall',      id: 'kilimall',      icon: faGlobe },
    { label: 'Contacts',      href: '/contacts',      id: 'contacts',      icon: faAddressBook },
    { label: role === 'director' ? 'Operations' : 'Inventory', href: '/operations', id: 'inventory', icon: faBoxesStacked },
    { label: 'Purchases',     href: '/purchases',     id: 'purchase',      icon: faCartShopping },
    { label: 'Delivery',      href: '/delivery',      id: 'delivery',      icon: faTruck },
    { label: 'Repairs',       href: '/repairs',       id: 'repair',        icon: faScrewdriverWrench, badge: pendingRepairs },
    { label: 'Refurbishment', href: '/refurbishment', id: 'refurbishment', icon: faArrowsRotate },
    { label: 'Outsource',     href: '/outsource',     id: 'outsource',     icon: faArrowsRotate },
    { label: 'After-Sales',   href: '/aftersales',    id: 'after_sales',   icon: faShieldHalved },
    { label: 'Holdovers',     href: '/holdovers',     id: 'holdovers',     icon: faHandHolding },
    { label: 'Finance',       href: '/finance',       id: 'accounting',    icon: faBuildingColumns },
    { label: 'Deposits',      href: '/deposits',      id: 'deposits',      icon: faMoneyBillWave },
    { label: 'Expenses',      href: '/expenses',      id: 'expenses',      icon: faReceipt },
    { label: role === 'director' ? 'HR' : role === 'finance_officer' ? 'HR & Payroll' : 'HR Self-Service', href: '/hr', id: 'hr', icon: faUsers },
    { label: 'My Documents',         href: '/documents', id: 'my_documents', icon: faFileLines },
    { label: 'KPI Targets',          href: '/sops',      id: 'sops',          icon: faBullseye },
    { label: 'Standards & SOPs',    href: '/sop-documents', id: 'sop_documents', icon: faFileLines },
    { label: 'Settings',      href: '/settings',      id: 'settings',      icon: faGear },
  ]

  const canSeeSettings = role === 'director'
  const visibleItems = allItems.filter(item =>
    item.id === 'settings' ? canSeeSettings : hasModuleAccess(currentUser, item.id as ModuleId)
  )

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const pinStorageKey = currentUserId ? `deed_pinned_modules_${currentUserId}` : null

  useEffect(() => {
    if (!pinStorageKey) return
    try {
      const raw = localStorage.getItem(pinStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setPinnedIds(new Set(parsed))
      }
    } catch {
      // ignore bad storage
    }
  }, [pinStorageKey])

  useEffect(() => {
    if (!pinStorageKey) return
    try {
      localStorage.setItem(pinStorageKey, JSON.stringify(Array.from(pinnedIds)))
    } catch {
      // ignore storage failures
    }
  }, [pinStorageKey, pinnedIds])

  const pinnedItems = useMemo(
    () => visibleItems.filter(item => pinnedIds.has(item.id)),
    [visibleItems, pinnedIds],
  )

  useEffect(() => {
    if (pinnedItems.length === 0) return
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey) return
      const n = Number(event.key)
      if (!Number.isInteger(n) || n <= 0) return
      const target = pinnedItems[n - 1]
      if (!target) return
      event.preventDefault()
      if (target.id !== 'settings') {
        setModule(target.id)
      }
      // Soft nav — full page reload made pinned shortcuts feel much slower.
      router.push(target.href)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pinnedItems, setModule, router])

  const togglePinned = (id: ModuleId | 'settings') => {
    setPinnedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      trackUxEvent('module_pin_toggle', { module: id, pinned: next.has(id) })
      return next
    })
  }

  // Collapsible navigation groups: each section can be opened or closed and
  // the choice is remembered per user. The group holding the current page is
  // always kept open so users never lose the active module.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const groupStorageKey = currentUserId ? `deed_sidebar_collapsed_groups_${currentUserId}` : null

  useEffect(() => {
    if (!groupStorageKey) return
    try {
      const raw = localStorage.getItem(groupStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) setCollapsedGroups(new Set(parsed))
    } catch {
      // ignore bad storage
    }
  }, [groupStorageKey])

  const toggleGroup = (title: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      if (groupStorageKey) {
        try {
          localStorage.setItem(groupStorageKey, JSON.stringify(Array.from(next)))
        } catch {
          // ignore storage failures
        }
      }
      trackUxEvent('sidebar_group_toggle', { group: title, collapsed: next.has(title) })
      return next
    })
  }

  const groups: NavGroup[] = [
    ...(pinnedItems.length > 0 ? [{
      title: 'Pinned',
      items: pinnedItems,
    }] : []),
    {
      title: 'Overview',
      items: visibleItems.filter(i => ['dashboard', 'contacts'].includes(i.id) && !pinnedIds.has(i.id)),
    },
    {
      title: 'Sales channels',
      items: visibleItems.filter(i => ['sales', 'crm', 'pos', 'ecommerce', 'kilimall'].includes(i.id) && !pinnedIds.has(i.id)),
    },
    {
      title: 'Stock & fulfillment',
      items: visibleItems.filter(i => ['inventory', 'purchase', 'delivery'].includes(i.id) && !pinnedIds.has(i.id)),
    },
    {
      title: 'Service operations',
      items: visibleItems.filter(i => ['repair', 'refurbishment', 'outsource', 'after_sales', 'holdovers'].includes(i.id) && !pinnedIds.has(i.id)),
    },
    {
      title: 'Finance & people',
      items: visibleItems.filter(i => ['accounting', 'deposits', 'expenses', 'hr', 'my_documents', 'sops', 'sop_documents', 'settings'].includes(i.id) && !pinnedIds.has(i.id)),
    },
  ].filter(g => g.items.length > 0)

  return (
    <aside
      id="primary-navigation"
      aria-label="Primary navigation"
      aria-hidden={isMobile && !sidebarOpen ? true : undefined}
      {...(isMobile && !sidebarOpen ? { inert: true } : {})}
      className={`
        sidebar-shell fixed md:relative inset-y-0 left-0 z-50 flex-shrink-0 flex flex-col
        transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${sidebarOpen
          ? 'w-64 translate-x-0 shadow-2xl'
          : 'w-64 -translate-x-full md:w-[72px] md:translate-x-0'
        }
      `}
    >
      {/* ── Brand Header ── */}
      <div
        className={`sidebar-section-border flex items-center h-16 flex-shrink-0 border-b transition-all duration-300 overflow-hidden ${sidebarOpen ? 'px-5' : 'justify-center px-0'}`}
      >
        <div className="flex items-center gap-3">
          {/* Logo mark — Deed Blue gradient */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${DEED_BLUE}, #0090C8)`,
              boxShadow: `0 4px 16px rgba(31,160,208,0.45)`,
            }}
          >
            <img src="/deed-logo.png" alt="Deed" className="w-6 h-6 object-contain brightness-0 invert" />
          </div>

          {/* Brand text */}
          <div className={`flex flex-col transition-all duration-500 overflow-hidden ${sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0 pointer-events-none'}`}>
            <span className="font-black text-[15px] tracking-tight leading-none whitespace-nowrap">
              <span style={{ color: DEED_BLUE }}>DEED</span>{' '}<span style={{ color: '#FFFFFF' }}>ERP</span>
            </span>
            <span className="text-[9px] font-semibold tracking-[0.2em] uppercase mt-0.5 whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Technologies
            </span>
          </div>
        </div>
      </div>

      {/* ── Navigation ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 custom-scrollbar">
        {groups.map((group, idx) => {
          const hasActiveItem = group.items.some(item => isNavItemActive(pathname, item))
          // The active module's group cannot be hidden; everything else honours
          // the stored preference. The icon rail always shows every module.
          const isOpen = !sidebarOpen || hasActiveItem || !collapsedGroups.has(group.title)
          const groupPanelId = `sidebar-group-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
          return (
            <div key={group.title} className={idx !== 0 ? 'mt-4' : ''}>
              {/* Group label */}
              {sidebarOpen ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={isOpen}
                  aria-controls={groupPanelId}
                  className="sidebar-group-toggle"
                >
                  <span className="sidebar-group-label text-[9px] font-black uppercase tracking-[0.20em] whitespace-nowrap">
                    {group.title}
                  </span>
                  <span className="sidebar-group-count">{group.items.length}</span>
                  <div className="sidebar-group-rule h-px flex-1 rounded-full" />
                  <Fa
                    icon={faChevronDown}
                    className={`sidebar-group-chevron text-[8px] ${isOpen ? '' : '-rotate-90'}`}
                  />
                </button>
              ) : (
                <div className="flex justify-center mb-2">
                  <div className="sidebar-group-rule h-px w-7 rounded-full" />
                </div>
              )}

              {isOpen && (
                <div id={groupPanelId} className="px-3 space-y-0.5">
                  {group.items.map(item => (
                    <SidebarNavItem
                      key={item.id}
                      item={item}
                      isActive={isNavItemActive(pathname, item)}
                      isExpanded={sidebarOpen}
                      isPinned={pinnedIds.has(item.id)}
                      currentUserId={currentUserId}
                      onTogglePin={() => togglePinned(item.id)}
                      onNavigate={() => {
                        if (item.id !== 'settings') setModule(item.id)
                        if (window.innerWidth < 768 && sidebarOpen) toggleSidebar()
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Collapse Toggle ── */}
      <div className="sidebar-section-border p-3 flex-shrink-0 border-t">
        <button
          onClick={toggleSidebar}
          className="sidebar-collapse-btn hidden md:flex items-center justify-center w-full h-9 rounded-xl cursor-pointer"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <Fa icon={sidebarOpen ? faChevronLeft : faChevronRight} className="text-xs" />
          {sidebarOpen && <span className="ml-2.5 text-[11px] font-bold">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

// ── Nav Item ─────────────────────────────────────────────────────────────────

interface NavItemProps {
  item: NavItem
  isActive: boolean
  isExpanded: boolean
  isPinned: boolean
  currentUserId?: string | null
  onNavigate: () => void
  onTogglePin: () => void
}

function SidebarNavItem({ item, isActive, isExpanded, isPinned, currentUserId, onNavigate, onTogglePin }: NavItemProps) {
  const warm = () => warmRoute(item.href, currentUserId)
  return (
    <div className={`flex items-center ${isExpanded ? 'gap-1' : 'justify-center'}`}>
      <Link
        href={item.href}
        onClick={onNavigate}
        onMouseEnter={warm}
        onFocus={warm}
        aria-current={isActive ? 'page' : undefined}
        className={`sidebar-nav-item group relative flex items-center rounded-xl cursor-pointer ${isActive ? 'active' : ''} ${isExpanded ? 'min-w-0 flex-1 px-3.5 py-2.5' : 'h-11 w-11 mx-auto justify-center'}`}
      >
      {/* Active left-bar indicator */}
      {isActive && (
        <div
          className={`absolute left-0 rounded-r-full bg-white ${isExpanded ? 'w-[3px] top-[22%] bottom-[22%]' : 'w-[3px] h-6 top-1/2 -translate-y-1/2'}`}
          style={{ opacity: 0.8 }}
        />
      )}

      {/* Icon */}
      <div className={`flex items-center justify-center flex-shrink-0 transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'} ${isExpanded ? 'w-4 h-4' : 'w-[18px] h-[18px]'}`}>
        <Fa icon={item.icon} className="w-full h-full" />
      </div>

      {/* Label */}
      <span className={`text-[12.5px] font-semibold whitespace-nowrap transition-all duration-500 ${isExpanded ? 'ml-3 opacity-100 translate-x-0' : 'opacity-0 -translate-x-3 pointer-events-none w-0'}`}>
        {item.label}
      </span>
      {/* Badge */}
      {item.badge != null && item.badge > 0 && (
        <span
          className={`flex items-center justify-center rounded-full font-black text-white ${isExpanded ? 'ml-auto h-5 min-w-[20px] px-1.5 text-[9px]' : 'absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 text-[8px]'}`}
          style={{ background: isActive ? 'rgba(255,255,255,0.30)' : DEED_BLUE, boxShadow: isActive ? 'none' : `0 2px 8px rgba(31,160,208,0.5)` }}
        >
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}

      {/* Tooltip (collapsed only) */}
      {!isExpanded && (
        <div
          className="sidebar-tooltip absolute left-full ml-3 px-3 py-2 text-xs font-bold text-white rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-[100] pointer-events-none translate-x-1 group-hover:translate-x-0"
        >
          <span>{item.label}</span>
          {item.badge != null && item.badge > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full text-[9px] font-black text-white" style={{ background: DEED_BLUE }}>
              {item.badge}
            </span>
          )}
          {/* Arrow */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-3 rotate-45 -z-10"
            style={{ background: DEED_NAVY, borderLeft: '1px solid rgba(31,160,208,0.30)', borderBottom: '1px solid rgba(31,160,208,0.30)' }}
          />
        </div>
      )}
      </Link>
      {isExpanded && (
        <button
          type="button"
          className="sidebar-pin-btn flex-shrink-0"
          title={isPinned ? 'Unpin module' : 'Pin module'}
          aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
          aria-pressed={isPinned}
          onClick={onTogglePin}
        >
          {isPinned ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}
