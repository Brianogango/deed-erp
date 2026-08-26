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
        padding: '0',
        borderRadius: 0,
        background: 'transparent',
        border: '0',
        ...style,
      }}
    >
      <p style={{ fontSize: 14, color: '#07164c', lineHeight: 1.55, fontWeight: 700, margin: 0 }}>
        {notice.body}
      </p>
    </div>
  )
}
