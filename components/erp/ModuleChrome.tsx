'use client'

import { useId, type ReactNode } from 'react'
import { ModuleHeader, TabBar } from '@/components/ui'

export type ModuleTab = {
  id: string
  label: string
  icon?: ReactNode
  panelId?: string
}

/**
 * Standard module shell:
 * ModuleHeader → ModuleNavigation (≤6 visible) → body.
 * The body is exposed as a labelled region so keyboard and screen-reader users
 * can move directly from module navigation into the active workspace.
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
  const regionId = useId().replace(/:/g, '')
  const activeLabel = tabs?.find(tab => tab.id === activeTab)?.label
  const workspaceLabel = activeLabel ? `${title} — ${activeLabel}` : title

  return (
    <div className={`mod-page min-w-0 max-w-full ${className}`.trim()}>
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
      <div
        id={`module-workspace-${regionId}`}
        className="mod-body min-w-0 max-w-full"
        role="region"
        aria-label={workspaceLabel}
      >
        {children}
      </div>
    </div>
  )
}
