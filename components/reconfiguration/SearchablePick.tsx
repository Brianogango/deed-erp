'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Fa, faChevronDown } from '@/components/icons'
import { onVisibleViewportChange, visibleViewportBand } from '@/lib/visible-viewport'

type SearchablePickOption = {
  id: string
  label: string
}

/**
 * Search-then-pick combobox for long operational lists (serials, RAM, SSD).
 * The menu is portalled so overflow on the bench form cannot clip it.
 */
export default function SearchablePick({
  label,
  value,
  options,
  onChange,
  placeholder = 'Search…',
  emptyText = 'No matches',
  disabled = false,
}: {
  label: string
  value: string
  options: SearchablePickOption[]
  onChange: (id: string) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
}) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  const selected = options.find(option => option.id === value)
  const display = open ? query : (selected?.label || '')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(option => option.label.toLowerCase().includes(q))
  }, [options, query])
  const activeOptionId = open && filtered[activeIndex] ? `${listId}-option-${activeIndex}` : undefined

  const placeMenu = () => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return
    const band = visibleViewportBand()
    const spaceBelow = band.bottom - rect.bottom - 12
    const spaceAbove = rect.top - band.top - 12
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
    const maxHeight = Math.max(160, Math.min(320, openUp ? spaceAbove : spaceBelow))
    setMenuPos({
      top: openUp ? rect.top - maxHeight - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      maxHeight,
    })
  }

  const openMenu = () => {
    if (disabled) return
    setQuery('')
    setActiveIndex(0)
    placeMenu()
    setOpen(true)
  }

  const closeMenu = () => {
    setOpen(false)
    setQuery('')
  }

  const pick = (id: string) => {
    onChange(id)
    closeMenu()
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (wrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      closeMenu()
    }
    // Follow the input instead of closing. Closing on resize/scroll meant that on
    // phones the keyboard opening (resize + scroll-into-view) shut the menu the
    // moment the field was focused, so nothing could be searched.
    const follow = () => placeMenu()
    const onScroll = (event: Event) => {
      const target = event.target
      // Scrolling the options themselves needs no re-measure.
      if (target instanceof Node && menuRef.current?.contains(target)) return
      const rect = inputRef.current?.getBoundingClientRect()
      // The field scrolled fully out of view: nothing left to anchor to.
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) { closeMenu(); return }
      placeMenu()
    }
    document.addEventListener('mousedown', onPointerDown)
    const stopFollowingViewport = onVisibleViewportChange(follow)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      stopFollowingViewport()
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0)
  }, [filtered.length, activeIndex])

  useEffect(() => {
    if (!open || filtered.length === 0) return
    const active = menuRef.current?.querySelector<HTMLElement>(
      `[data-reconfig-option-index="${activeIndex}"]`,
    )
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, filtered.length])

  return (
    <div ref={wrapRef} className="reconfig-pick">
      <span className="reconfig-pick-label">{label}</span>
      <div className="reconfig-pick-control">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          className={`form-input reconfig-pick-input ${value ? 'has-clear' : ''}`}
          placeholder={placeholder}
          value={display}
          onChange={e => {
            if (!open) openMenu()
            setQuery(e.target.value)
            setActiveIndex(0)
            if (value) onChange('')
          }}
          onFocus={openMenu}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (!open) openMenu()
              setActiveIndex(i => filtered.length ? Math.min(filtered.length - 1, i + 1) : 0)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex(i => Math.max(0, i - 1))
            } else if (e.key === 'Home' && open) {
              e.preventDefault()
              setActiveIndex(0)
            } else if (e.key === 'End' && open) {
              e.preventDefault()
              setActiveIndex(Math.max(0, filtered.length - 1))
            } else if (e.key === 'Enter' && open) {
              e.preventDefault()
              const option = filtered[activeIndex]
              if (option) pick(option.id)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              closeMenu()
            }
          }}
        />
        {value && !disabled && (
          <button
            type="button"
            className="reconfig-pick-clear"
            onClick={() => {
              onChange('')
              setQuery('')
              inputRef.current?.focus()
              openMenu()
            }}
          >
            Clear
          </button>
        )}
        <span className={`reconfig-pick-chevron ${open ? 'is-open' : ''}`} aria-hidden="true">
          <Fa icon={faChevronDown} />
        </span>
      </div>
      {open && menuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="reconfig-pick-menu"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: menuPos.maxHeight,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {filtered.length === 0 ? (
            <p className="reconfig-pick-empty">{emptyText}</p>
          ) : filtered.map((option, index) => {
            const active = index === activeIndex
            const chosen = option.id === value
            return (
              <button
                key={option.id}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={chosen}
                data-reconfig-option-index={index}
                className={`reconfig-pick-option${active ? ' is-active' : ''}${chosen ? ' is-chosen' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(option.id)}
              >
                {option.label}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
