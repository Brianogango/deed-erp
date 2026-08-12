import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Delivery print button (hooks order)', () => {
  const src = readFileSync(join(process.cwd(), 'components/modules/Delivery.tsx'), 'utf8')

  it('does not early-return for print before later useState hooks in JobsTab', () => {
    const jobsTab = src.slice(src.indexOf('function JobsTab'), src.indexOf('function RidersTab'))
    const showCreate = jobsTab.indexOf('const [showCreateModal')
    const printGate = jobsTab.indexOf('if (printJob)')
    expect(showCreate).toBeGreaterThan(-1)
    expect(printGate).toBeGreaterThan(-1)
    expect(printGate).toBeGreaterThan(showCreate)
  })

  it('does not early-return for print before later useState hooks in WeeklyPayTab', () => {
    const payTab = src.slice(src.indexOf('function WeeklyPayTab'), src.indexOf('export default function Delivery'))
    const weekStart = payTab.indexOf('const [weekStart')
    const printGate = payTab.indexOf('if (printPay)')
    expect(weekStart).toBeGreaterThan(-1)
    expect(printGate).toBeGreaterThan(-1)
    expect(printGate).toBeGreaterThan(weekStart)
  })
})
