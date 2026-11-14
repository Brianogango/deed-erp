'use client'

import { useEffect } from 'react'
import { useRecordPager } from '@/lib/record-pager'

/**
 * "3 / 16 ‹ ›" on a record screen: step through the list it was opened from
 * (wraps around, like Odoo). Alt+← / Alt+→ do the same. Hidden when the record
 * was not opened from a list.
 */
export function RecordPager({ currentId, onOpen }: { currentId: string | null | undefined; onOpen: (id: string) => void }) {
  const pager = useRecordPager(currentId)

  useEffect(() => {
    if (!pager) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); onOpen(pager.prevId) }
      if (e.key === 'ArrowRight') { e.preventDefault(); onOpen(pager.nextId) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pager, onOpen])

  if (!pager) return null
  const btn = 'inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm text-[var(--text-2)] hover:bg-[var(--bg-surface)]'
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-3)]" aria-label="Record pager">
      <span className="tabular-nums">{pager.position} / {pager.total}</span>
      <button type="button" className={btn} style={{ borderColor: 'var(--border-lt)' }} onClick={() => onOpen(pager.prevId)} aria-label="Previous record" title="Previous (Alt+←)">‹</button>
      <button type="button" className={btn} style={{ borderColor: 'var(--border-lt)' }} onClick={() => onOpen(pager.nextId)} aria-label="Next record" title="Next (Alt+→)">›</button>
    </div>
  )
}
