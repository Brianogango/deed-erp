'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type SecondaryAction = {
  id: string
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hidden?: boolean
}

/**
 * Overflow menu for low-frequency / administrative actions.
 * Keeps the page header to one primary action.
 */
export function SecondaryActionMenu({
  actions,
  label = 'More',
  ariaLabel = 'More actions',
  mobilePresentation = 'sheet',
}: {
  actions: SecondaryAction[]
  label?: string
  ariaLabel?: string
  mobilePresentation?: 'sheet' | 'anchored'
}) {
  const visible = actions.filter(a => !a.hidden)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top?: number; right: number; bottom?: number; mobile?: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const update = () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (!rect) return
      if (window.innerWidth <= 767 && mobilePresentation === 'sheet') {
        setPos({ right: 12, bottom: 12, mobile: true })
        return
      }
      const right = Math.max(8, window.innerWidth - rect.right)
      const estimatedMenuHeight = Math.min(320, visible.length * 40 + 12)
      const roomBelow = window.innerHeight - rect.bottom

      setPos(
        roomBelow >= estimatedMenuHeight + 14
          ? { top: rect.bottom + 6, right }
          : { bottom: Math.max(8, window.innerHeight - rect.top + 6), right },
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [mobilePresentation, open, visible.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (visible.length === 0) return null

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className="btn-secondary erp-action-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={() => setOpen(v => !v)}
      >
        {label}
        <span className={`ml-1 text-[10px] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          className={`tab-overflow-menu${pos.mobile ? ' tab-overflow-menu--mobile' : ''}${mobilePresentation === 'anchored' ? ' tab-overflow-menu--anchored' : ''}`}
          style={{
            position: pos.mobile ? 'fixed' : undefined,
            top: pos.mobile ? undefined : pos.top,
            right: pos.right,
            bottom: pos.bottom,
            left: pos.mobile ? 12 : undefined,
            width: pos.mobile ? 'auto' : undefined,
            maxHeight: 'min(20rem, calc(100dvh - 1rem))',
            overflowY: 'auto',
          }}
        >
          {visible.map(action => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={`tab-overflow-item ${action.danger ? 'text-[var(--danger-text)]' : ''}`}
              onClick={() => {
                action.onClick()
                setOpen(false)
              }}
            >
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
