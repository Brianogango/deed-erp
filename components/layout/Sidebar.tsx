'use client'
import { useApp, ModuleId } from '@/lib/store'
import { formatRoleLabel } from '@/lib/auth/access'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faGrip, faBriefcase, faBullseye, faBoxesStacked,
  faAddressBook, faCartShopping, faCashRegister,
  faScrewdriverWrench, faTruck, faGlobe,
  faLandmark, faUserGroup, faCalendarDays, faFolder, faArrowRightArrowLeft, faReceipt,
  faChartLine, faChevronLeft, faChevronRight, faRotate, faShieldHalved, faStore,
} from '@fortawesome/free-solid-svg-icons'
import type { IconProp } from '@fortawesome/fontawesome-svg-core'

const BASE_MODULES: { id: ModuleId; label: string; icon: IconProp }[] = [
  { id: 'dashboard',    label: 'Dashboard',     icon: faGrip },
  { id: 'sales',        label: 'Sales',         icon: faBriefcase },
  { id: 'crm',          label: 'CRM',           icon: faBullseye },
  { id: 'inventory',    label: 'Inventory',     icon: faBoxesStacked },
  { id: 'contacts',     label: 'Contacts',      icon: faAddressBook },
  { id: 'purchase',     label: 'Purchase',      icon: faCartShopping },
  { id: 'pos',          label: 'Point of Sale', icon: faCashRegister },
  { id: 'repair',       label: 'Repairs',       icon: faScrewdriverWrench },
  { id: 'refurbishment', label: 'Refurbishment', icon: faRotate },
  { id: 'delivery',     label: 'Delivery',      icon: faTruck },
  { id: 'ecommerce',    label: 'eCommerce',     icon: faGlobe },
  { id: 'kilimall',     label: 'Kilimall',      icon: faStore },
  { id: 'accounting',   label: 'Accounting',    icon: faLandmark },
  { id: 'outsource',    label: 'Outsource',     icon: faArrowRightArrowLeft },
  { id: 'expenses',     label: 'Expenses',      icon: faReceipt },
  { id: 'after_sales',  label: 'After-Sales',   icon: faShieldHalved },
  { id: 'sops',         label: 'Performance Targets', icon: faChartLine },
  { id: 'hr',           label: 'HR',            icon: faUserGroup },
  { id: 'my_documents', label: 'SOPs',          icon: faFolder },
]

export default function Sidebar() {
  const { activeModule, sidebarOpen, setModule, toggleSidebar, saleOrders, repairs, products, users, currentUserId, hasModuleAccess } = useApp()
  const currentUser = users.find(u => u.id === currentUserId)
  const isAdmin = currentUser?.role === 'admin'

  const modules = BASE_MODULES.map(m =>
    m.id === 'hr' && !isAdmin
      ? { ...m, label: 'Leave', icon: faCalendarDays as IconProp }
      : m
  )

  const pendingQuotes = saleOrders.filter(s => s.status === 'quotation').length
  const openRepairs   = repairs.filter(r => !['closed','cancelled','delivered','invoiced'].includes(r.status)).length
  const lowStock      = products.filter(p => p.stockQty <= p.minStock && p.minStock > 0).length

  const badges: Partial<Record<ModuleId, number>> = {
    sales:    pendingQuotes,
    repair:   openRepairs,
    inventory: lowStock,
  }

  return (
    <aside className={[
      'h-screen flex flex-col flex-shrink-0 overflow-hidden transition-all duration-300',
      'fixed md:relative z-50 md:z-auto inset-y-0 left-0',
      sidebarOpen
        ? 'w-[220px] translate-x-0'
        : 'w-[220px] -translate-x-full md:translate-x-0 md:w-14',
    ].join(' ')}
    style={{ background: '#ffffff', borderRight: '1px solid #E5E7EB', boxShadow: '2px 0 8px rgba(0,0,0,0.04)' }}>

      {/* Logo */}
      <div className="flex items-center gap-3 p-4 cursor-pointer flex-shrink-0 transition-colors"
           style={{ borderBottom: '1px solid #F3F4F6' }}
           onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
           onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
           onClick={toggleSidebar}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-lg shadow-md flex-shrink-0"
             style={{
               background: 'linear-gradient(135deg, #1B2762, #0F1640)',
               letterSpacing: '-1px',
             }}>
          d
        </div>
        {sidebarOpen && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight" style={{ color: '#111827' }}>deed</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#00B0D7' }}>Technologies</p>
          </div>
        )}
        <FontAwesomeIcon
          icon={sidebarOpen ? faChevronLeft : faChevronRight}
          className="text-xs mx-auto transition-transform" style={{ color: '#9CA3AF' }} size="xs"
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-hide">
        {modules.filter(m => hasModuleAccess(m.id)).map(m => {
          const active = activeModule === m.id
          const badge  = badges[m.id]
          return (
            <button
              key={m.id}
              onClick={() => {
                setModule(m.id)
                if (typeof window !== 'undefined' && window.innerWidth < 768 && sidebarOpen) toggleSidebar()
              }}
              className="flex items-center gap-2.5 rounded-xl p-2 mx-2 my-0.5 transition-all duration-150 w-[calc(100%-16px)]"
              style={active
                ? { background: '#EEF2FF', borderLeft: '3px solid #1B2762', color: '#1B2762', fontWeight: 600 }
                : { color: '#6B7280', borderLeft: '3px solid transparent' }
              }
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#F9FAFB'; if (!active) e.currentTarget.style.color = '#111827' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; if (!active) e.currentTarget.style.color = '#6B7280' }}
              title={!sidebarOpen ? m.label : undefined}>
              <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                <FontAwesomeIcon icon={m.icon} fixedWidth className="text-sm" />
              </span>
              {sidebarOpen && (
                <>
                  <span className="flex-1 text-left truncate text-sm">{m.label}</span>
                  {badge && badge > 0 && (
                    <span className="badge badge-red text-[9px] px-1.5 py-0.5 font-bold">{badge}</span>
                  )}
                </>
              )}
            </button>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="p-3" style={{ borderTop: '1px solid #F3F4F6' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm flex-shrink-0"
               style={{ background: 'linear-gradient(135deg, #1B2762, #0F1640)' }}>
            {currentUser?.name?.slice(0, 2).toUpperCase() ?? '??'}
          </div>
          {sidebarOpen && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate" style={{ color: '#111827' }}>{currentUser?.name ?? 'Guest'}</p>
              <p className="text-[10px] truncate" style={{ color: '#9CA3AF' }}>{formatRoleLabel(currentUser?.role)}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
