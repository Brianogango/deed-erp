'use client'

import type { ReactNode } from 'react'
import { ModuleHeader, TabBar } from '@/components/ui'

export type ModuleTab = {
  id: string
  label: string
  icon?: ReactNode
  panelId?: string
}

/**
 * Standard module shell:
 * ModuleHeader → ModuleNavigation (≤6 visible) → body
 */
export function ModuleChrome({
  title,
  subtitle,
  icon,
  count,
  primaryAction,
  overflowActions,
  tabs,
  activeTab,
  onTabChange,
  maxVisibleMobile = 3,
  maxVisibleTablet = 5,
  maxVisibleDesktop = 6,
  showTabIcons = false,
  tabAriaLabel = 'Sections',
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  count?: number
  primaryAction?: ReactNode
  overflowActions?: ReactNode
  tabs?: ModuleTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  maxVisibleMobile?: number
  maxVisibleTablet?: number
  maxVisibleDesktop?: number
  showTabIcons?: boolean
  tabAriaLabel?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`mod-page ${className}`.trim()}>
      <ModuleHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        count={count}
        primaryAction={primaryAction}
        overflowActions={overflowActions}
        subtitleMode="compact"
      />
      {tabs && activeTab && onTabChange && (
        <TabBar
          tabs={tabs}
          active={activeTab}
          onChange={onTabChange}
          maxVisibleMobile={maxVisibleMobile}
          maxVisibleTablet={maxVisibleTablet}
          maxVisibleDesktop={maxVisibleDesktop}
          showIcons={showTabIcons}
          ariaLabel={tabAriaLabel}
        />
      )}
      <div className="mod-body">{children}</div>
    </div>
  )
}
