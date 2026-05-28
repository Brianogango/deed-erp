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

interface NavItem {
  label: string
  href: string
  id: ModuleId | 'settings'
  icon: any
  badge?: number
}

interface NavGroup {
  title: string
  color: string        // dot/label color
  activeClass: string  // active item bg class
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
      color: '#60A5FA',
      activeClass: 'bg-blue-600',
      items: visibleItems.filter(i => ['dashboard', 'contacts'].includes(i.id))
    },
    {
      title: 'Commerce',
      color: '#34D399',
      activeClass: 'bg-emerald-600',
      items: visibleItems.filter(i => ['sales', 'pos', 'ecommerce', 'kilimall'].includes(i.id))
    },
    {
      title: 'Supply Chain',
      color: '#FCD34D',
      activeClass: 'bg-amber-500',
      items: visibleItems.filter(i => ['inventory', 'purchase', 'delivery'].includes(i.id))
    },
    {
      title: 'Technical',
      color: '#FB923C',
      activeClass: 'bg-orange-500',
      items: visibleItems.filter(i => ['repair', 'refurbishment', 'outsource', 'after_sales', 'holdovers'].includes(i.id))
    },
    {
      title: 'Administration',
      color: '#A78BFA',
      activeClass: 'bg-violet-600',
      items: visibleItems.filter(i => ['accounting', 'deposits', 'expenses', 'hr', 'settings'].includes(i.id))
    }
  ].filter(g => g.items.length > 0)

  return (
    <aside
      className={`
        fixed md:relative inset-y-0 left-0 z-50 flex-shrink-0 flex flex-col
        transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${sidebarOpen
          ? 'w-64 translate-x-0 ml-0 shadow-2xl'
          : 'w-64 -translate-x-full md:w-[78px] md:translate-x-0 md:ml-0'
        }
      `}
      style={{ background: 'linear-gradient(180deg, #111827 0%, #0D1117 100%)', borderRight: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* Brand Header */}
      <div className={`
        flex items-center h-16 flex-shrink-0 transition-all duration-300 overflow-hidden
        ${sidebarOpen ? 'px-5' : 'px-0 justify-center'}
      `} style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #2563EB, #06B6D4)', boxShadow: '0 4px 14px rgba(37,99,235,0.4)' }}>
            <img src="/deed-logo.png" alt="Deed" className="w-6 h-6 object-contain brightness-0 invert" />
          </div>
          <div className={`flex flex-col transition-all duration-500 ${sidebarOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none w-0'}`}>
            <span className="font-black text-[15px] tracking-tight text-white leading-none">
              DEED <span className="text-cyan-400">ERP</span>
            </span>
            <span className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase mt-0.5">Technologies</span>
          </div>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 custom-scrollbar">
        {groups.map((group, idx) => (
          <div key={group.title} className={idx !== 0 ? 'mt-5' : ''}>
            {/* Group Label */}
            {sidebarOpen ? (
              <div className="flex items-center gap-2 px-5 mb-2">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                <h3 className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: group.color, opacity: 0.85 }}>
                  {group.title}
                </h3>
              </div>
            ) : (
              <div className="flex justify-center mb-2 px-3">
                <div className="h-px w-8 rounded-full" style={{ backgroundColor: group.color, opacity: 0.3 }} />
              </div>
            )}

            <div className="px-3 space-y-0.5">
              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.id}
                  item={item}
                  isActive={activeModule === item.id}
                  isExpanded={sidebarOpen}
                  activeClass={group.activeClass}
                  groupColor={group.color}
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

      {/* Collapse Toggle */}
      <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <button
          onClick={toggleSidebar}
          className="hidden md:flex items-center justify-center w-full h-9 rounded-xl transition-all duration-200 text-slate-400 hover:text-white"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <Fa icon={sidebarOpen ? faChevronLeft : faChevronRight} className="text-xs" />
          {sidebarOpen && <span className="ml-2.5 text-[11px] font-bold">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

interface SidebarNavItemProps {
  item: NavItem
  isActive: boolean
  isExpanded: boolean
  activeClass: string
  groupColor: string
  onNavigate: () => void
}

function SidebarNavItem({ item, isActive, isExpanded, activeClass, groupColor, onNavigate }: SidebarNavItemProps) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`
        group relative flex items-center rounded-xl cursor-pointer
        transition-all duration-200 ease-out
        ${isExpanded ? 'px-3.5 py-2.5' : 'h-11 w-11 mx-auto justify-center'}
        ${isActive
          ? `${activeClass} text-white shadow-lg`
          : 'text-slate-400 hover:text-white'
        }
      `}
      style={isActive ? { boxShadow: `0 4px 14px ${groupColor}35` } : undefined}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = '' }}
    >
      {/* Active left bar */}
      {isActive && (
        <div
          className={`absolute left-0 rounded-r-full ${isExpanded ? 'w-[3px] top-[22%] bottom-[22%]' : 'w-[3px] h-6 top-1/2 -translate-y-1/2'}`}
          style={{ backgroundColor: groupColor }}
        />
      )}

      {/* Icon */}
      <div className={`flex items-center justify-center flex-shrink-0 ${isExpanded ? 'w-4 h-4' : 'w-5 h-5'}`}>
        <Fa icon={item.icon} className="w-full h-full" />
      </div>

      {/* Label */}
      <span className={`
        text-[12.5px] font-semibold whitespace-nowrap transition-all duration-500 leading-none
        ${isExpanded ? 'ml-3 opacity-100 translate-x-0' : 'opacity-0 -translate-x-3 pointer-events-none w-0'}
      `}>
        {item.label}
      </span>

      {/* Badge */}
      {item.badge != null && item.badge > 0 && (
        <span className={`
          flex items-center justify-center rounded-full font-black text-white
          ${isExpanded
            ? 'ml-auto h-5 min-w-[20px] px-1.5 text-[9px]'
            : 'absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[8px] border-2 border-[#111827]'
          }
        `} style={{ background: groupColor }}>
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}

      {/* Tooltip when collapsed */}
      {!isExpanded && (
        <div className="
          absolute left-full ml-3 px-3 py-2 text-xs font-bold text-white
          rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible
          transition-all duration-200 shadow-xl whitespace-nowrap z-[100]
          pointer-events-none translate-x-1 group-hover:translate-x-0
        " style={{ background: '#1E2A45', border: '1px solid rgba(255,255,255,0.1)' }}>
          {item.label}
          {item.badge != null && item.badge > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full text-[9px] font-black text-white" style={{ background: groupColor }}>
              {item.badge}
            </span>
          )}
          <div className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-3 rotate-45 -z-10"
            style={{ background: '#1E2A45', borderLeft: '1px solid rgba(255,255,255,0.1)', borderBottom: '1px solid rgba(255,255,255,0.1)' }} />
        </div>
      )}
    </Link>
  )
}
