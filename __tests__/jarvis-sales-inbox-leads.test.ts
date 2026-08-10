import { describe, expect, it } from 'vitest'
import { allTools } from '@/lib/jarvis/tools'
import { isToolAllowedForRole } from '@/lib/jarvis/permissions'
import { buildSystemPrompt } from '@/lib/jarvis/system-prompt'

describe('JARVIS sales inbox lead tools', () => {
  it('registers summarize + import tools', () => {
    const names = allTools().map(t => t.name)
    expect(names).toContain('summarize_sales_leads')
    expect(names).toContain('import_sales_inbox_leads')
    expect(allTools().find(t => t.name === 'import_sales_inbox_leads')?.mutates).toBe(true)
  })

  it('allows director and sales_rep; not technician', () => {
    expect(isToolAllowedForRole('import_sales_inbox_leads', 'director')).toBe(true)
    expect(isToolAllowedForRole('summarize_sales_leads', 'sales_rep')).toBe(true)
    expect(isToolAllowedForRole('import_sales_inbox_leads', 'technician')).toBe(false)
  })

  it('prompt mentions sales inbox lead tools', () => {
    const prompt = buildSystemPrompt({
      id: 'u1',
      username: 'brian',
      name: 'Brian',
      role: 'director',
      modules: ['jarvis', 'crm'],
      active: true,
      createdAt: new Date().toISOString(),
    })
    expect(prompt).toContain('import_sales_inbox_leads')
    expect(prompt).toContain('summarize_sales_leads')
  })
})
