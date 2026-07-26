'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface AnchoredMenuPosition {
  top: number
  right: number
}

/**
 * Shared positioning logic for dropdown menus that must escape
 * `overflow-hidden` cards and scrolling containers. The menu is rendered
 * through a portal to <body> with fixed coordinates anchored to its trigger —
 * the same fix the TabBar "More" menu uses, extracted so the DataTable
 * toolbar menus (and future dropdowns) never get clipped again.
 */
export function useAnchoredMenu<TriggerEl extends HTMLElement>() {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<AnchoredMenuPosition | null>(null)
  const triggerRef = useRef<TriggerEl | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }, [])

  const toggle = useCallback(() => {
    setOpen(prev => {
      if (!prev) reposition()
      return !prev
    })
  }, [reposition])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, reposition])

  return { open, position, triggerRef, menuRef, toggle, close }
}
