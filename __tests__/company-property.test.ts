import { describe, it, expect } from 'vitest'
import { ROLE_DEFAULT_MODULES } from '@/lib/auth/types'
import { canManageCompanyPropertyRole, canRunCompanyAssetDepreciationRole, hasModuleAccess } from '@/lib/auth/access'
import {
  nextCompanyAssetRef,
  defaultPpeAccountCode,
  canTransitionCompanyAsset,
  canDeleteCompanyAsset,
  allowedCompanyAssetTransitions,
  validateCompanyAssetInput,
  findDuplicateAssetTag,
  capitalRegisterVsCoa,
  applyMove,
  applyDispose,
  applyWriteOff,
  applyStatusChange,
  isCapitalOnRegister,
  resolvedPpeAccountCode,
  type CompanyAsset,
} from '@/lib/company-property'

function asset(partial: Partial<CompanyAsset> = {}): CompanyAsset {
  return {
    id: 'a1',
    ref: 'AST/2026/0001',
    name: 'Visitor chairs',
    category: 'furniture',
    assetClass: 'capital',
    ppeAccountCode: '1702',
    qty: 12,
    unit: 'each',
    locationName: 'Reception',
    status: 'in_use',
    condition: 'good',
    acquiredDate: '2026-01-15',
    acquiredVia: 'opening',
    costKes: 48000,
    history: [],
    createdByUserId: 'u1',
    createdByName: 'Admin',
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...partial,
  }
}

describe('nextCompanyAssetRef', () => {
  it('starts at AST/year/0001 when the register is empty', () => {
    expect(nextCompanyAssetRef([], 2026)).toBe('AST/2026/0001')
  })

  it('continues the year sequence and ignores other years', () => {
    expect(nextCompanyAssetRef(['AST/2025/0099', 'AST/2026/0003', 'HOLD/0001'], 2026)).toBe('AST/2026/0004')
  })
})

describe('default PPE accounts', () => {
  it('maps furniture and fittings to 1702, office equipment to 1703, IT to 1701', () => {
    expect(defaultPpeAccountCode('furniture')).toBe('1702')
    expect(defaultPpeAccountCode('fittings')).toBe('1702')
    expect(defaultPpeAccountCode('office_equipment')).toBe('1703')
    expect(defaultPpeAccountCode('it_non_trading')).toBe('1701')
    expect(defaultPpeAccountCode('other')).toBeUndefined()
  })

  it('clears PPE account for expensed items', () => {
    expect(resolvedPpeAccountCode({ assetClass: 'expensed', category: 'furniture', ppeAccountCode: '1702' })).toBeUndefined()
  })
})

describe('lifecycle', () => {
  it('allows draft → in_use / in_storage only', () => {
    expect(allowedCompanyAssetTransitions('draft')).toEqual(['in_use', 'in_storage'])
    expect(canTransitionCompanyAsset('draft', 'disposed')).toBe(false)
  })

  it('allows live items to move through repair, lost, dispose, and write-off', () => {
    expect(canTransitionCompanyAsset('in_use', 'under_repair')).toBe(true)
    expect(canTransitionCompanyAsset('in_storage', 'disposed')).toBe(true)
    expect(canTransitionCompanyAsset('under_repair', 'in_use')).toBe(true)
    expect(canTransitionCompanyAsset('lost', 'in_use')).toBe(true)
  })

  it('locks disposed and written-off rows', () => {
    expect(allowedCompanyAssetTransitions('disposed')).toEqual([])
    expect(allowedCompanyAssetTransitions('written_off')).toEqual([])
    expect(canDeleteCompanyAsset('in_use')).toBe(false)
    expect(canDeleteCompanyAsset('draft')).toBe(true)
  })
})

describe('validateCompanyAssetInput', () => {
  const valid = {
    name: 'Office desk',
    category: 'furniture' as const,
    assetClass: 'capital' as const,
    qty: 1,
    locationName: 'Admin office',
    condition: 'good' as const,
    acquiredDate: '2026-04-01',
    acquiredVia: 'purchase' as const,
    costKes: 18500,
  }

  it('rejects empty name, zero qty, and missing location', () => {
    expect(validateCompanyAssetInput({ ...valid, name: '  ' })).toMatch(/name/i)
    expect(validateCompanyAssetInput({ ...valid, qty: 0 })).toMatch(/quantity/i)
    expect(validateCompanyAssetInput({ ...valid, locationName: '' })).toMatch(/location/i)
  })

  it('rejects duplicate asset tags', () => {
    expect(validateCompanyAssetInput(
      { ...valid, assetTag: 'DESK-1' },
      [{ id: 'other', assetTag: 'desk-1' }],
    )).toMatch(/already in use/i)
  })

  it('accepts a complete capital furniture row', () => {
    expect(validateCompanyAssetInput(valid)).toBeNull()
  })
})

describe('findDuplicateAssetTag', () => {
  it('ignores blank tags and the row being edited', () => {
    expect(findDuplicateAssetTag([{ id: 'a', assetTag: 'X' }], '', 'a')).toBeUndefined()
    expect(findDuplicateAssetTag([{ id: 'a', assetTag: 'X' }], 'X', 'a')).toBeUndefined()
    expect(findDuplicateAssetTag([{ id: 'a', assetTag: 'X' }], 'X', 'b')?.id).toBe('a')
  })
})

describe('applyMove / dispose / write-off', () => {
  it('moves a live item and records history', () => {
    const result = applyMove(asset(), 'Boardroom', { userId: 'u1', userName: 'Admin', at: '2026-08-26T08:00:00.000Z' }, 'Rearrange')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.locationName).toBe('Boardroom')
    expect(result.asset.history[0].action).toBe('move')
  })

  it('refuses to move a draft', () => {
    const result = applyMove(asset({ status: 'draft' }), 'Boardroom', { userId: 'u1', userName: 'Admin', at: '2026-08-26T08:00:00.000Z' })
    expect(result.ok).toBe(false)
  })

  it('partial dispose reduces qty, cost, and accum. depr. proportionally', () => {
    const result = applyDispose(
      asset({ accumDeprKes: 12000 }),
      4,
      { userId: 'u1', userName: 'Admin', at: '2026-08-26T08:00:00.000Z' },
      { reason: 'Broken frames' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.qty).toBe(8)
    expect(result.asset.status).toBe('in_use')
    expect(result.asset.disposedQty).toBe(4)
    expect(result.asset.costKes).toBe(32000)
    expect(result.asset.accumDeprKes).toBe(8000)
  })

  it('full dispose marks the row disposed', () => {
    const result = applyDispose(asset({ qty: 3, costKes: 9000 }), 3, { userId: 'u1', userName: 'Admin', at: '2026-08-26T08:00:00.000Z' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.status).toBe('disposed')
    expect(result.asset.disposedDate).toBe('2026-08-26')
  })

  it('write-off is terminal', () => {
    const result = applyWriteOff(asset({ status: 'lost' }), { userId: 'u1', userName: 'Admin', at: '2026-08-26T08:00:00.000Z' }, 'Theft')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.asset.status).toBe('written_off')
    expect(applyStatusChange(result.asset, 'in_use', { userId: 'u1', userName: 'Admin', at: '2026-08-26T09:00:00.000Z' }).ok).toBe(false)
  })
})

describe('capitalRegisterVsCoa', () => {
  it('sums live capital cost by PPE account and diffs COA balances', () => {
    const rows = capitalRegisterVsCoa(
      [
        asset({ costKes: 48000, ppeAccountCode: '1702' }),
        asset({ id: 'a2', costKes: 18000, ppeAccountCode: '1702', status: 'draft' }),
        asset({ id: 'a3', costKes: 22000, ppeAccountCode: '1703', category: 'office_equipment' }),
        asset({ id: 'a4', costKes: 5000, ppeAccountCode: '1702', status: 'disposed' }),
      ],
      [
        { code: '1702', balance: 180000 },
        { code: '1703', balance: 2400000 },
      ],
    )
    const furniture = rows.find(r => r.code === '1702')
    const equipment = rows.find(r => r.code === '1703')
    expect(furniture?.register).toBe(48000)
    expect(furniture?.coa).toBe(180000)
    expect(furniture?.delta).toBe(48000 - 180000)
    expect(equipment?.register).toBe(22000)
  })

  it('treats draft and terminal capital rows as off-register', () => {
    expect(isCapitalOnRegister(asset({ status: 'draft' }))).toBe(false)
    expect(isCapitalOnRegister(asset({ status: 'disposed' }))).toBe(false)
    expect(isCapitalOnRegister(asset({ assetClass: 'expensed' }))).toBe(false)
    expect(isCapitalOnRegister(asset())).toBe(true)
  })
})

describe('role defaults', () => {
  it('grants Property to director, admin officer, and finance officer — not inventory or tech', () => {
    expect(ROLE_DEFAULT_MODULES.director).toContain('company_property')
    expect(ROLE_DEFAULT_MODULES.admin_officer).toContain('company_property')
    expect(ROLE_DEFAULT_MODULES.finance_officer).toContain('company_property')
    expect(ROLE_DEFAULT_MODULES.inventory_officer).not.toContain('company_property')
    expect(ROLE_DEFAULT_MODULES.technician).not.toContain('company_property')
    expect(ROLE_DEFAULT_MODULES.sales_rep).not.toContain('company_property')
  })

  it('lets finance run depreciation even though they cannot record items', () => {
    expect(canManageCompanyPropertyRole('finance_officer')).toBe(false)
    expect(canRunCompanyAssetDepreciationRole('finance_officer')).toBe(true)
    expect(canRunCompanyAssetDepreciationRole('director')).toBe(true)
    expect(canRunCompanyAssetDepreciationRole('technician')).toBe(false)
  })

  it('lets admin and finance open Property even without an explicit module chip', () => {
    expect(hasModuleAccess({ role: 'admin_officer', modules: [] }, 'company_property')).toBe(true)
    expect(hasModuleAccess({ role: 'finance_officer', modules: [] }, 'company_property')).toBe(true)
    expect(hasModuleAccess({ role: 'technician', modules: [] }, 'company_property')).toBe(false)
    expect(hasModuleAccess({ role: 'sales_rep', modules: ['sales'] }, 'company_property')).toBe(false)
  })
})
