'use client'
// Keeps a record action bar down to one primary button plus an overflow menu.
//
// Split out of components/modules/Sales.tsx. Moved verbatim.

import type { MoreAction } from './types'
import { useState } from 'react'
import { faChevronDown, faEllipsisVertical } from '@fortawesome/free-solid-svg-icons'
import { Fa } from '@/components/icons'

export function MoreActionsMenu({ items, label = 'More', className = '' }: { items: MoreAction[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const firstDanger = items.findIndex(i => i.tone === 'danger')
  return (
    <div className={`relative ${className}`.trim()}>
      <button
        type="button"
        className="sp-btn flex items-center gap-2"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span>{label}</span>
        <Fa icon={faChevronDown} className={`sp-more-chevron text-[10px] transition-transform duration-150 ease-out ${open ? 'rotate-180' : ''}`} />
        <Fa icon={faEllipsisVertical} className="sp-more-dots" aria-hidden="true" />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-[8990]" aria-hidden="true" onClick={() => setOpen(false)} />
        <div role="menu" className="sales-more-menu absolute right-0 top-full z-[9000] mt-2 min-w-52 rounded-[6px] border border-[var(--sp-border)] bg-[var(--sp-surface)] p-1.5 shadow-md">
          {items.map((item, idx) => (
            <div key={item.label}>
              {idx === firstDanger && firstDanger > 0 && <div className="my-1 border-t border-[var(--sp-border)]" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                className={`flex w-full items-center gap-2.5 rounded-[4px] px-3 py-2 text-left text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${item.tone === 'danger' ? 'text-[var(--sp-danger)] hover:bg-[var(--sp-danger-bg)]' : 'text-[var(--sp-text-2)] hover:bg-[var(--sp-accent-soft)]'}`}
                onClick={() => { setOpen(false); item.onClick() }}
              >
                {item.icon && <Fa icon={item.icon} className="w-3.5 text-[11px]" />}
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      </>)}
    </div>
  )
}
