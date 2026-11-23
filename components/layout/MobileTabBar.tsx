'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faHouse, faListCheck, faShoppingCart, faUsers, faDesktop, faGlobe, faAddressBook,
  faBoxesStacked, faCartShopping, faTruck, faScrewdriverWrench, faArrowsRotate, faMicrochip,
  faShieldHalved, faHandHolding, faChair, faBuildingColumns, faMoneyBillWave, faReceipt, faIdCard,
} from '@fortawesome/free-solid-svg-icons'
import { Fa } from '@/components/icons'
import { useShellStore, type ModuleId } from '@/lib/store'
import { MOBILE_TAB_MODULES, mobileTabModules, mobileTabsHiddenFor } from '@/lib/navigation/mobile-tabs'

const ICONS: Partial<Record<ModuleId, IconDefinition>> = {
  sales: faShoppingCart, crm: faUsers, pos: faDesktop, ecommerce: faGlobe, kilimall: faGlobe,
  contacts: faAddressBook, inventory: faBoxesStacked, purchase: faCartShopping, delivery: faTruck,
  repair: faScrewdriverWrench, refurbishment: faArrowsRotate, reconfiguration: faMicrochip,
  outsource: faArrowsRotate, after_sales: faShieldHalved, holdovers: faHandHolding,
  company_property: faChair, accounting: faBuildingColumns, deposits: faMoneyBillWave,
  expenses: faReceipt, hr: faIdCard,
}

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Modules pinned in the side menu (Sidebar keeps them per user). */
function readPinned(userId: string | null | undefined): string[] {
  if (!userId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(`deed_pinned_modules_${userId}`) || '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * Bottom tab bar on phones: Home, the person's three working modules and My
 * work, each with its label; the open one has a pill behind its icon. The
 * full menu is the ☰ at the top left. Hidden from tablet width up, on open records
 * (they carry their own actions along the bottom) and on the POS till.
 */
export default function MobileTabBar() {
  const pathname = usePathname() || '/'
  const search = useSearchParams()
  const { users, currentUserId } = useShellStore()
  const currentUser = users.find(u => u.id === currentUserId)

  const [pinned, setPinned] = useState<string[]>([])
  // Pins change in the side menu; re-read them when the page changes.
  useEffect(() => { setPinned(readPinned(currentUserId)) }, [currentUserId, pathname])

  const modules = useMemo(() => mobileTabModules(currentUser, pinned), [currentUser, pinned])
  if (!currentUser || mobileTabsHiddenFor(pathname, search)) return null

  const tabs: Array<{ key: string; href: string; label: string; icon: IconDefinition }> = [
    { key: 'home', href: '/', label: 'Home', icon: faHouse },
    ...modules.map(id => ({ key: id, href: MOBILE_TAB_MODULES[id]!.href, label: MOBILE_TAB_MODULES[id]!.label, icon: ICONS[id] ?? faListCheck })),
    { key: 'my_work', href: '/my-work', label: 'My work', icon: faListCheck },
  ]

  return (
    <nav className="mobile-tab-bar md:hidden" aria-label="Main sections">
      {tabs.map(tab => {
        const active = isActive(pathname, tab.href)
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`mobile-tab-bar__tab ${active ? 'is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mobile-tab-bar__pill"><Fa icon={tab.icon} className="mobile-tab-bar__icon" aria-hidden="true" /></span>
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
