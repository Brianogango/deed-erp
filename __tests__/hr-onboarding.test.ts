import { describe, expect, it } from 'vitest'
import { buildWelcomeEmail } from '@/lib/hr/welcome-email'
import { buildChecklist, dueState, ONBOARDING_TEMPLATES, EXIT_TEMPLATES } from '@/lib/hr/checklists'

describe('welcome email', () => {
  const base = { companyName: 'Deed Technologies', employeeName: 'Jane Wanjiku', startDate: '2026-10-19', jobTitle: 'Technician', department: 'Repairs' }

  it('addresses the first name, states the start date and lists what to bring', () => {
    const m = buildWelcomeEmail({ ...base, workEmail: 'jane@deed.co.ke', hrEmail: 'hr@deed.co.ke' })
    expect(m.subject).toContain('Monday, 19 October 2026')
    expect(m.text).toContain('Hi Jane,')
    expect(m.text).toContain('jane@deed.co.ke')
    expect(m.text).toContain('KRA PIN certificate')
    expect(m.text).toContain('hr@deed.co.ke')
    expect(m.html).toContain('<strong>Technician in Repairs</strong>')
  })

  it('never includes a password and escapes HR notes', () => {
    const m = buildWelcomeEmail({ ...base, note: 'Arrive at 8am <b>sharp</b>' })
    expect(m.html).toContain('Arrive at 8am &lt;b&gt;sharp&lt;/b&gt;')
    expect(m.html).not.toContain('<b>sharp</b>')
    expect(m.text.toLowerCase()).not.toMatch(/temporary password:|password is/)
  })
})

describe('checklist templates', () => {
  let n = 0
  const id = () => `id${++n}`

  it('builds due dates from the start date, including tasks due before day one', () => {
    const list = buildChecklist(ONBOARDING_TEMPLATES, '2026-10-19', id)
    const by = Object.fromEntries(list.map(i => [i.key, i]))
    expect(by.welcome_email.dueDate).toBe('2026-10-16')
    expect(by.erp_login.dueDate).toBe('2026-10-19')
    expect(by.first_week.dueDate).toBe('2026-10-26')
    expect(list.every(i => i.instructions && i.owner && !i.done)).toBe(true)
    expect(list.find(i => i.key === 'erp_login')?.link).toBe('create_login')
  })

  it('anchors the exit checklist on the last working day', () => {
    const list = buildChecklist(EXIT_TEMPLATES, '2026-11-30', id)
    expect(list.find(i => i.key === 'letter')?.dueDate).toBe('2026-11-16')
    expect(list.find(i => i.key === 'certificate')?.dueDate).toBe('2026-12-07')
  })

  it('classifies due state', () => {
    const today = new Date(2026, 9, 19)
    expect(dueState({ done: true, dueDate: '2026-01-01' }, today)).toBe('done')
    expect(dueState({ done: false, dueDate: '2026-10-18' }, today)).toBe('overdue')
    expect(dueState({ done: false, dueDate: '2026-10-19' }, today)).toBe('due_soon')
    expect(dueState({ done: false, dueDate: '2026-10-22' }, today)).toBe('due_soon')
    expect(dueState({ done: false, dueDate: '2026-10-23' }, today)).toBe('upcoming')
    expect(dueState({ done: false }, today)).toBe('none')
  })
})
