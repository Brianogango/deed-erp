'use client'

import type { CSSProperties } from 'react'
import { diagnosisFeeCustomerNotice } from '@/lib/diagnosis-fee'
import type { DiagnosisFeeRepair } from '@/lib/diagnosis-fee'

const ACCENT: Record<'due' | 'paid' | 'invoiced', string> = {
  due: '#F59E0B',
  invoiced: '#F59E0B',
  paid: '#10B981',
}

export function DiagnosisChargeNotice({
  repair,
  style,
}: {
  repair: DiagnosisFeeRepair
  style?: CSSProperties
}) {
  const notice = diagnosisFeeCustomerNotice(repair)
  if (!notice) return null
  const accent = ACCENT[notice.status]
  return (
    <div
      role="status"
      data-testid="diagnosis-charge-notice"
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        background: accent + '14',
        border: `1px solid ${accent}40`,
        ...style,
      }}
    >
      <p style={{ fontSize: 13, color: '#F9FAFB', lineHeight: 1.65, fontWeight: 600, margin: 0 }}>
        {notice.body}
      </p>
    </div>
  )
}
