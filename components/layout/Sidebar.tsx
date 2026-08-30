'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Fa } from '@/components/icons'
import {
  faChartLine, faShoppingCart, faBuildingColumns, faUsers, faGear, faBoxesStacked, faScrewdriverWrench,
  faDesktop, faGlobe, faAddressBook, faCartShopping, faTruck, faArrowsRotate, faShieldHalved, faReceipt,
  faChevronRight, faChevronLeft, faChevronDown, faMoneyBillWave, faHandHolding, faBullseye, faFileLines,
  faMicrochip, faChair,
} from '@fortawesome/free-solid-svg-icons'
import { useShellStore, ModuleId } from '@/lib/store'
import { hasModuleAccess } from '@/lib/auth/access'
import { trackUxEvent } from '@/lib/ux-telemetry'
import { warmRoute } from '@/lib/warm-route'

const DEED_SIDEBAR_WHITE_LOGO = 'data:image/webp;base64,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'

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
  const { sidebarOpen, toggleSidebar, getVisibleRepairs, users, currentUserId, activeModule, setModule, profileImages } = useShellStore()
  const [isOverlay, setIsOverlay] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsOverlay(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role || ''
  const avatar = currentUserId ? (profileImages[currentUserId] ?? null) : null
  const initials = (currentUser?.name || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U'
  const roleLabel = role.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
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
    { label: 'Reconfiguration', href: '/reconfiguration', id: 'reconfiguration', icon: faMicrochip },
    { label: 'Outsource',     href: '/outsource',     id: 'outsource',     icon: faArrowsRotate },
    { label: 'After-Sales',   href: '/aftersales',    id: 'after_sales',   icon: faShieldHalved },
    { label: 'Holdovers',     href: '/holdovers',     id: 'holdovers',     icon: faHandHolding },
    { label: 'Property',      href: '/property',      id: 'company_property', icon: faChair },
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
      items: visibleItems.filter(i => ['repair', 'refurbishment', 'reconfiguration', 'outsource', 'after_sales', 'holdovers'].includes(i.id) && !pinnedIds.has(i.id)),
    },
    {
      title: 'Finance & people',
      items: visibleItems.filter(i => ['accounting', 'deposits', 'expenses', 'company_property', 'hr', 'my_documents', 'sops', 'sop_documents', 'settings'].includes(i.id) && !pinnedIds.has(i.id)),
    },
  ].filter(g => g.items.length > 0)

  return (
    <aside
      id="primary-navigation"
      aria-label="Primary navigation"
      aria-hidden={isOverlay && !sidebarOpen ? true : undefined}
      {...(isOverlay && !sidebarOpen ? { inert: true } : {})}
      className={`
        sidebar-shell fixed lg:relative inset-y-0 left-0 z-50 flex-shrink-0 flex flex-col
        transition-[width,transform,box-shadow] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${sidebarOpen
          ? 'w-[296px] translate-x-0 shadow-2xl lg:w-[252px] lg:shadow-none'
          : 'w-[296px] -translate-x-full lg:w-[72px] lg:translate-x-0'
        }
      `}
    >
      {/* ── Brand Header ── */}
      <div className={`sidebar-brand-header sidebar-section-border flex h-[76px] flex-shrink-0 items-center border-b ${sidebarOpen ? 'gap-1.5 px-5 lg:px-3' : 'justify-center px-0'}`}>
        {!sidebarOpen ? (
          <img src="/deed-icon-transparent.png" alt="Deed Technologies" className="sidebar-brand-mark h-9 w-9 object-contain" />
        ) : (
          <div className="flex min-w-0 flex-1 items-center overflow-hidden">
            <img src={DEED_SIDEBAR_WHITE_LOGO} alt="Deed Technologies" className="sidebar-logo-inverted sidebar-logo-white-user" />
            <img src="/deed-logo.png" alt="Deed Technologies" className="sidebar-logo-standard hidden h-9 w-auto max-w-[155px] object-contain" />
          </div>
        )}

        {sidebarOpen && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="sidebar-header-collapse-btn hidden lg:inline-flex"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <Fa icon={faChevronLeft} />
          </button>
        )}

        {sidebarOpen && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="sidebar-overlay-close lg:hidden"
            aria-label="Close navigation menu"
          >
            ×
          </button>
        )}
      </div>

      {/* ── Navigation ── */}
      <div className="sidebar-nav-scroll flex-1 overflow-y-auto overflow-x-hidden py-4 custom-scrollbar">
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
                        if (window.innerWidth < 1024 && sidebarOpen) toggleSidebar()
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── User / Collapse Footer ── */}
      <div className="sidebar-footer sidebar-section-border flex-shrink-0 border-t p-3">
        <button
          type="button"
          className={`sidebar-user-card ${sidebarOpen ? 'expanded' : 'collapsed'}`}
          onClick={() => window.dispatchEvent(new CustomEvent('deed:account-open'))}
          aria-label="Open account settings"
        >
          <span className="sidebar-user-avatar">
            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : initials}
            <span className="sidebar-online-dot" aria-hidden="true" />
          </span>
          {sidebarOpen && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="sidebar-user-name block truncate">{currentUser?.name || 'User'}</span>
                <span className="sidebar-user-role block truncate">{roleLabel || 'User'}</span>
              </span>
              <Fa icon={faChevronDown} className="sidebar-user-chevron text-[9px]" />
            </>
          )}
        </button>

        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            className="sidebar-collapse-btn mt-2 hidden lg:flex h-9 w-full items-center justify-center rounded-xl cursor-pointer"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <Fa icon={faChevronRight} className="text-xs" />
          </button>
        )}
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
          style={{ background: isActive ? 'rgba(255,255,255,0.30)' : DEED_BLUE, boxShadow: isActive ? 'none' : `0 2px 8px rgba(0,174,239,0.5)` }}
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
            style={{ background: DEED_NAVY, borderLeft: '1px solid rgba(0,174,239,0.30)', borderBottom: '1px solid rgba(0,174,239,0.30)' }}
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
