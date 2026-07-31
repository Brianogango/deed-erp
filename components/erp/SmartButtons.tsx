'use client'

import type { ReactNode } from 'react'

export type SmartButtonTone = 'success' | 'primary' | 'violet' | 'teal' | 'warning' | 'neutral'

export type SmartButton = {
  id: string
  label: string
  count?: number
  onClick: () => void
  tone?: SmartButtonTone
  icon?: ReactNode
}

const toneClass: Record<SmartButtonTone, string> = {
  success: 'erp-smart-btn-success',
  primary: 'erp-smart-btn-primary',
  violet: 'erp-smart-btn-violet',
  teal: 'erp-smart-btn-teal',
  warning: 'erp-smart-btn-warning',
  neutral: 'erp-smart-btn-neutral',
}

export function SmartButtons({ buttons }: { buttons: SmartButton[] }) {
  if (!buttons.length) return null

  return (
    <div className="erp-smart-buttons">
      {buttons.map(btn => (
        <button
          key={btn.id}
          type="button"
          className={`erp-smart-btn ${toneClass[btn.tone ?? 'neutral']}`}
          onClick={btn.onClick}
        >
          {btn.icon}
          <span>
            {btn.label}
            {typeof btn.count === 'number' ? `: ${btn.count}` : ''}
          </span>
        </button>
      ))}
    </div>
  )
}
