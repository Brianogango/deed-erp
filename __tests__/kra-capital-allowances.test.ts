import { describe, expect, it } from 'vitest'
import {
  applyKraAnnualAllowance,
  kraAnnualAllowance,
  kraClassForPpe,
  kraClassLabel,
} from '@/lib/tax/kra-capital-allowances'

describe('KRA capital allowances', () => {
  it('maps computers and software to Class II 30%, furniture and office to Class IV 12.5%', () => {
    expect(kraClassForPpe('1701')).toBe('II')
    expect(kraClassForPpe('1704')).toBe('II')
    expect(kraClassForPpe('1702')).toBe('IV')
    expect(kraClassForPpe('1703')).toBe('IV')
    expect(kraClassLabel('1701')).toMatch(/Class II/)
    expect(kraClassLabel('1702')).toMatch(/Class IV/)
  })

  it('charges annual reducing-balance on tax WDV, not book NBV', () => {
    expect(kraAnnualAllowance(100000, '1701')).toBe(30000)
    expect(kraAnnualAllowance(100000, '1702')).toBe(12500)
  })

  it('applies once per calendar year and never posts a journal amount into the return', () => {
    const first = applyKraAnnualAllowance({ costKes: 80000, taxWdvKes: 80000, ppeAccountCode: '1701' }, 2026)
    expect(first.allowance).toBe(24000)
    expect(first.asset.taxWdvKes).toBe(56000)
    expect(first.asset.taxLastAllowanceYear).toBe(2026)
    const again = applyKraAnnualAllowance(first.asset, 2026)
    expect(again.allowance).toBe(0)
    expect(again.asset.taxWdvKes).toBe(56000)
    const nextYear = applyKraAnnualAllowance(first.asset, 2027)
    expect(nextYear.allowance).toBe(16800)
    expect(nextYear.asset.taxWdvKes).toBe(39200)
  })
})
