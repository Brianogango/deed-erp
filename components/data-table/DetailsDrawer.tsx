'use client'

import { useState, type ReactNode } from 'react'
import { SlidePanel, TabBar, TabContent } from '@/components/ui'

export type DrawerTabId =
  | 'overview' | 'timeline' | 'notes' | 'attachments'
  | 'history' | 'activity' | 'related' | 'audit'

export interface DrawerTab {
  id: DrawerTabId
  label: string
  content: ReactNode
}

interface DetailsDrawerProps {
  title: string
  subtitle?: string
  tabs: DrawerTab[]
  defaultTabId?: DrawerTabId
  onClose: () => void
  actions?: ReactNode
}

// Standard drawer used by every Type B/C table instead of immediate
// navigation on row click (docs/DATATABLE_REDESIGN_ARCHITECTURE.md
// "Details Drawer"). Callers only ever supply the tabs that apply to that
// entity — a Brands lookup table, for instance, never gets a drawer at all.
export default function DetailsDrawer({ title, subtitle, tabs, defaultTabId, onClose, actions }: DetailsDrawerProps) {
  const [active, setActive] = useState<DrawerTabId>(defaultTabId ?? tabs[0]?.id ?? 'overview')

  return (
    <SlidePanel title={title} subtitle={subtitle} onClose={onClose} actions={actions}>
      {tabs.length > 1 && (
        <TabBar
          tabs={tabs.map(t => ({ id: t.id, label: t.label }))}
          active={active}
          onChange={id => setActive(id as DrawerTabId)}
        />
      )}
      <div className="p-4">
        {tabs.map(tab => (
          <TabContent key={tab.id} active={active === tab.id}>
            {tab.content}
          </TabContent>
        ))}
      </div>
    </SlidePanel>
  )
}
