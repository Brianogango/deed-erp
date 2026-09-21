'use client'

import { useMemo, useState } from 'react'

export type CalendarItem = {
  id: string
  date: string
  title: string
  color?: string
  onClick?: () => void
}

type Props = {
  items: CalendarItem[]
  /** ISO date (YYYY-MM-DD) to open on; defaults to today */
  initialMonth?: string
  className?: string
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toMonthKey(year: number, month: number) {
  return `${year}-${pad(month + 1)}`
}

function parseMonthKey(key: string) {
  const [y, m] = key.split('-').map(Number)
  return { year: y, month: (m || 1) - 1 }
}

export function CalendarView({ items, initialMonth, className }: Props) {
  const today = new Date()
  const defaultKey = initialMonth?.slice(0, 7) ?? toMonthKey(today.getFullYear(), today.getMonth())
  const [monthKey, setMonthKey] = useState(defaultKey)

  const { year, month } = parseMonthKey(monthKey)

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const item of items) {
      const day = item.date.slice(0, 10)
      const list = map.get(day) ?? []
      list.push(item)
      map.set(day, list)
    }
    return map
  }, [items])

  const grid = useMemo(() => {
    const first = new Date(year, month, 1)
    const startOffset = (first.getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: Array<{ date: string | null; day: number | null }> = []
    for (let i = 0; i < startOffset; i++) cells.push({ date: null, day: null })
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: `${year}-${pad(month + 1)}-${pad(d)}`, day: d })
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null })
    return cells
  }, [year, month])

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', month: 'long', year: 'numeric' })

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1)
    setMonthKey(toMonthKey(d.getFullYear(), d.getMonth()))
  }

  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          type="button"
          className="text-[11px] px-2.5 py-1 rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] cursor-pointer"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          ← Prev
        </button>
        <p className="text-sm font-bold text-[var(--text-1)]">{monthLabel}</p>
        <button
          type="button"
          className="text-[11px] px-2.5 py-1 rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] cursor-pointer"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          Next →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-lg overflow-hidden border border-[var(--border-lt)] bg-[var(--border-lt)]">
        {WEEKDAYS.map(w => (
          <div key={w} className="bg-[var(--bg-muted)] text-[10px] font-semibold text-center py-1.5 text-[var(--text-3)]">
            {w}
          </div>
        ))}
        {grid.map((cell, idx) => {
          if (!cell.date) {
            return <div key={`empty-${idx}`} className="bg-[var(--bg-surface)] min-h-[72px]" />
          }
          const dayItems = itemsByDate.get(cell.date) ?? []
          const isToday = cell.date === todayStr
          return (
            <div
              key={cell.date}
              className="bg-[var(--bg-surface)] min-h-[72px] p-1 flex flex-col"
              style={isToday ? { boxShadow: 'inset 0 0 0 2px var(--navy)' } : undefined}
            >
              <span className={`text-[10px] font-mono mb-0.5 ${isToday ? 'font-bold text-[var(--navy)]' : 'text-[var(--text-4)]'}`}>
                {cell.day}
              </span>
              <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                {dayItems.slice(0, 3).map(item => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title}
                    onClick={item.onClick}
                    className="text-left text-[9px] leading-tight px-1 py-0.5 rounded truncate cursor-pointer border-none w-full"
                    style={{
                      background: item.color ? `${item.color}22` : 'var(--info-bg)',
                      color: item.color ?? 'var(--navy)',
                    }}
                  >
                    {item.title}
                  </button>
                ))}
                {dayItems.length > 3 && (
                  <span className="text-[8px] text-[var(--text-4)] px-1">+{dayItems.length - 3} more</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default CalendarView
