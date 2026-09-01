'use client'

import { useMemo } from 'react'
import { EmptyState } from '@/components/erp'
import { useCrmStore } from '@/lib/store'

export default function SalesHeatmap() {
  const { saleOrders } = useCrmStore()

  const data = useMemo(() => {
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0))

    saleOrders.forEach(order => {
      const date = new Date(order.orderDate)
      if (Number.isNaN(date.getTime())) return
      const day = (date.getDay() + 6) % 7
      const hour = date.getHours()
      heatmap[day][hour] += 1
    })

    return heatmap
  }, [saleOrders])

  const maxVal = Math.max(...data.flat(), 1)
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const getColor = (val: number) => {
    if (val === 0) return 'rgba(243, 244, 246, 0.5)'
    const opacity = 0.1 + (val / maxVal) * 0.9
    return `rgba(27, 39, 98, ${opacity})`
  }

  return (
    <div className="card p-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-1)]">Sales Activity Heatmap</h3>
          <p className="text-[10px] text-[var(--text-3)]">Frequency of orders by day and hour</p>
        </div>
        {saleOrders.length > 0 && (
          <div className="flex items-center gap-2" aria-label="Sales activity intensity legend">
            <span className="text-[10px] text-[var(--text-4)]">Less</span>
            <div className="flex gap-0.5" aria-hidden="true">
              {[0.2, 0.4, 0.6, 0.8, 1].map(o => (
                <div key={o} className="w-2.5 h-2.5 rounded-sm" style={{ background: `rgba(27, 39, 98, ${o})` }} />
              ))}
            </div>
            <span className="text-[10px] text-[var(--text-4)]">More</span>
          </div>
        )}
      </div>

      {saleOrders.length === 0 ? (
        <EmptyState
          title="No sales activity yet"
          description="Order timing patterns will appear here once sale orders are recorded. Use the pipeline and quotations to move active opportunities toward an order."
          className="min-h-[180px]"
        />
      ) : (
        <div className="dt-scroll min-w-0 max-w-full" tabIndex={0} aria-label="Scrollable sales activity heatmap">
          <div className="min-w-[600px]">
            <div className="flex">
              <div className="w-10 flex-shrink-0" />
              <div className="flex-1 flex justify-between px-2 mb-2">
                {['12am', '4am', '8am', '12pm', '4pm', '8pm'].map(h => (
                  <span key={h} className="text-[9px] text-[var(--text-4)] font-medium uppercase">{h}</span>
                ))}
              </div>
            </div>

            {data.map((dayData, dayIdx) => (
              <div key={days[dayIdx]} className="flex items-center mb-1">
                <div className="w-10 text-[10px] font-bold text-[var(--text-3)] flex-shrink-0">{days[dayIdx]}</div>
                <div className="flex-1 flex gap-1">
                  {dayData.map((val, hourIdx) => (
                    <div
                      key={hourIdx}
                      className="flex-1 h-6 rounded-sm transition-all hover:ring-2 hover:ring-primary-300 cursor-help relative group"
                      style={{ background: getColor(val) }}
                      aria-label={`${days[dayIdx]} ${hourIdx}:00 — ${val} order${val === 1 ? '' : 's'}`}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10" aria-hidden="true">
                        <div className="bg-gray-800 text-white text-[9px] px-2 py-1 rounded shadow-lg whitespace-nowrap">
                          {val} orders at {hourIdx}:00
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
