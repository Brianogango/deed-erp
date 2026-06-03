'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fa } from '@/components/icons'
import {
  faChartLine, faShoppingCart, faBuildingColumns, faUsers, faGear, faBoxesStacked, faScrewdriverWrench,
  faDesktop, faGlobe, faAddressBook, faCartShopping, faTruck, faArrowsRotate, faShieldHalved, faReceipt,
  faChevronRight, faChevronLeft, faMoneyBillWave, faHandHolding
} from '@fortawesome/free-solid-svg-icons'
import { useApp, ModuleId } from '@/lib/store'
import { hasModuleAccess } from '@/lib/auth/access'

// Brand colours
const DEED_BLUE  = '#00AEEF'
const DEED_NAVY  = '#1A1F5E'

const ROUTE_ALIASES: Partial<Record<ModuleId | 'settings', string[]>> = {
  purchase: ['/purchases', '/purchase'],
  after_sales: ['/aftersales', '/after_sales'],
  accounting: ['/finance', '/accounting', '/cashbook'],
  inventory: ['/operations', '/inventory'],
  documents: ['/documents', '/hr/documents'],
}

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
  const routes = [item.href, ...(ROUTE_ALIASES[item.id] ?? [])]
  return routes.some(route => pathMatchesRoute(pathname || '/', route))
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
  const { sidebarOpen, toggleSidebar, getVisibleRepairs, users, currentUserId, activeModule, setModule } = useApp()

  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role || ''
  const pendingRepairs = getVisibleRepairs().filter(r => ['received', 'assigned'].includes(r.status)).length

  const allItems: NavItem[] = [
    { label: 'Dashboard',     href: '/',              id: 'dashboard',     icon: faChartLine },
    { label: 'Sales & CRM',   href: '/sales',         id: 'sales',         icon: faShoppingCart },
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
    { label: role === 'director' ? 'HR' : role === 'finance_officer' ? 'HR & Payroll' : 'Leave & Performance', href: '/hr', id: 'hr', icon: faUsers },
    { label: 'Settings',      href: '/settings',      id: 'settings',      icon: faGear },
  ]

  const canSeeSettings = role === 'director'
  const visibleItems = allItems.filter(item =>
    item.id === 'settings' ? canSeeSettings : hasModuleAccess(currentUser, item.id as ModuleId)
  )

  const groups: NavGroup[] = [
    {
      title: 'General',
      items: visibleItems.filter(i => ['dashboard', 'contacts'].includes(i.id)),
    },
    {
      title: 'Commerce',
      items: visibleItems.filter(i => ['sales', 'pos', 'ecommerce', 'kilimall'].includes(i.id)),
    },
    {
      title: 'Supply Chain',
      items: visibleItems.filter(i => ['inventory', 'purchase', 'delivery'].includes(i.id)),
    },
    {
      title: 'Technical',
      items: visibleItems.filter(i => ['repair', 'refurbishment', 'outsource', 'after_sales', 'holdovers'].includes(i.id)),
    },
    {
      title: 'Administration',
      items: visibleItems.filter(i => ['accounting', 'deposits', 'expenses', 'hr', 'settings'].includes(i.id)),
    },
  ].filter(g => g.items.length > 0)

  return (
    <aside
      className={`
        fixed md:relative inset-y-0 left-0 z-50 flex-shrink-0 flex flex-col
        transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${sidebarOpen
          ? 'w-64 translate-x-0 shadow-2xl'
          : 'w-64 -translate-x-full md:w-[72px] md:translate-x-0'
        }
      `}
      style={{
        background: `linear-gradient(180deg, ${DEED_NAVY} 0%, #141850 100%)`,
        borderRight: '1px solid rgba(255,255,255,0.10)',
      }}
    >
      {/* ── Brand Header ── */}
      <div
        className={`flex items-center h-16 flex-shrink-0 transition-all duration-300 overflow-hidden ${sidebarOpen ? 'px-5' : 'justify-center px-0'}`}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.10)' }}
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
        {groups.map((group, idx) => (
          <div key={group.title} className={idx !== 0 ? 'mt-5' : ''}>
            {/* Group label */}
            {sidebarOpen ? (
              <div className="flex items-center gap-2 px-5 mb-1.5">
                <div className="h-px flex-1 rounded-full" style={{ background: 'rgba(31,160,208,0.20)' }} />
                <span className="text-[9px] font-black uppercase tracking-[0.20em] whitespace-nowrap" style={{ color: 'rgba(31,160,208,0.65)' }}>
                  {group.title}
                </span>
                <div className="h-px flex-1 rounded-full" style={{ background: 'rgba(31,160,208,0.20)' }} />
              </div>
            ) : (
              <div className="flex justify-center mb-2">
                <div className="h-px w-7 rounded-full" style={{ background: 'rgba(31,160,208,0.25)' }} />
              </div>
            )}

            <div className="px-3 space-y-0.5">
              {group.items.map(item => (
                <SidebarNavItem
                  key={item.id}
                  item={item}
                  isActive={isNavItemActive(pathname, item)}
                  isExpanded={sidebarOpen}
                  onNavigate={() => {
                    if (item.id !== 'settings') setModule(item.id)
                    if (window.innerWidth < 768 && sidebarOpen) toggleSidebar()
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Collapse Toggle ── */}
      <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}>
        <button
          onClick={toggleSidebar}
          className="hidden md:flex items-center justify-center w-full h-9 rounded-xl transition-all duration-200"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.50)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(31,160,208,0.15)'; e.currentTarget.style.color = '#FFFFFF' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.50)' }}
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
  onNavigate: () => void
}

function SidebarNavItem({ item, isActive, isExpanded, onNavigate }: NavItemProps) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`group relative flex items-center rounded-xl transition-all duration-200 cursor-pointer ${isExpanded ? 'px-3.5 py-2.5' : 'h-11 w-11 mx-auto justify-center'}`}
      style={
        isActive
          ? {
              background: `linear-gradient(135deg, ${DEED_BLUE}, #0095CC)`,
              boxShadow: `0 4px 16px rgba(31,160,208,0.40)`,
              color: '#FFFFFF',
            }
          : { color: 'rgba(255,255,255,0.55)' }
      }
      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#FFFFFF' } }}
      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'rgba(255,255,255,0.55)' } }}
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
          className="absolute left-full ml-3 px-3 py-2 text-xs font-bold text-white rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-[100] pointer-events-none translate-x-1 group-hover:translate-x-0"
          style={{ background: DEED_NAVY, border: '1px solid rgba(31,160,208,0.30)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
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
  )
}
