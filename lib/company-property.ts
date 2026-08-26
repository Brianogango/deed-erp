/**
 * Company Property register — office furniture, fittings, and non-trading
 * equipment. Separate from HR Assets (staff custody of trading inventory).
 *
 * v1 records the register. Phase 2 posts capitalisation, monthly depreciation
 * (6517 / 175x), and disposal journals (5203 / 6515). Tax WDV is reporting-only.
 */

export const COMPANY_ASSET_CATEGORIES = [
  'furniture',
  'fittings',
  'office_equipment',
  'it_non_trading',
  'other',
] as const
export type CompanyAssetCategory = (typeof COMPANY_ASSET_CATEGORIES)[number]

export const COMPANY_ASSET_CLASSES = ['capital', 'expensed'] as const
export type CompanyAssetClass = (typeof COMPANY_ASSET_CLASSES)[number]

export const COMPANY_ASSET_STATUSES = [
  'draft',
  'in_use',
  'in_storage',
  'under_repair',
  'lost',
  'disposed',
  'written_off',
] as const
export type CompanyAssetStatus = (typeof COMPANY_ASSET_STATUSES)[number]

export const COMPANY_ASSET_CONDITIONS = [
  'new',
  'good',
  'fair',
  'damaged',
  'unserviceable',
] as const
export type CompanyAssetCondition = (typeof COMPANY_ASSET_CONDITIONS)[number]

export const COMPANY_ASSET_ACQUIRED_VIA = [
  'purchase',
  'opening',
  'donation',
  'transfer',
] as const
export type CompanyAssetAcquiredVia = (typeof COMPANY_ASSET_ACQUIRED_VIA)[number]

export const COMPANY_PROPERTY_LOCATIONS = [
  'Reception',
  "Director's office",
  'Admin office',
  'Finance office',
  'Sales floor',
  'Workshop office',
  'Boardroom',
  'Store room',
  'Kitchen',
] as const

/** Default PPE cost accounts — Kenya IFRS chart used in this ERP. */
export const PPE_ACCOUNT_DEFAULTS: Record<CompanyAssetCategory, string | null> = {
  furniture: '1702',
  fittings: '1702',
  office_equipment: '1703',
  it_non_trading: '1701',
  other: null,
}

export const PPE_ACCOUNT_LABELS: Record<string, string> = {
  '1701': '1701 — Computer & Accessories',
  '1702': '1702 — Furniture & Fittings',
  '1703': '1703 — Office Equipment',
  '1704': '1704 — Software',
}

export const CATEGORY_LABELS: Record<CompanyAssetCategory, string> = {
  furniture: 'Furniture',
  fittings: 'Fittings',
  office_equipment: 'Office equipment',
  it_non_trading: 'IT (not for sale)',
  other: 'Other',
}

export const CLASS_LABELS: Record<CompanyAssetClass, string> = {
  capital: 'Capital (PPE)',
  expensed: 'Expensed',
}

export const STATUS_LABELS: Record<CompanyAssetStatus, string> = {
  draft: 'Draft',
  in_use: 'In use',
  in_storage: 'In storage',
  under_repair: 'Under repair',
  lost: 'Lost',
  disposed: 'Disposed',
  written_off: 'Written off',
}

export const CONDITION_LABELS: Record<CompanyAssetCondition, string> = {
  new: 'New',
  good: 'Good',
  fair: 'Fair',
  damaged: 'Damaged',
  unserviceable: 'Unserviceable',
}

export const ACQUIRED_VIA_LABELS: Record<CompanyAssetAcquiredVia, string> = {
  purchase: 'Purchase',
  opening: 'Opening balance',
  donation: 'Donation',
  transfer: 'Transfer',
}

/** Badge tokens understood by the shared StatusBadge / Badge map. */
export const STATUS_BADGE: Record<CompanyAssetStatus, string> = {
  draft: 'draft',
  in_use: 'active',
  in_storage: 'queued',
  under_repair: 'under_repair',
  lost: 'overdue',
  disposed: 'cancelled',
  written_off: 'closed',
}

export interface CompanyAssetHistoryEntry {
  id: string
  at: string
  action: string
  fromStatus?: CompanyAssetStatus
  toStatus?: CompanyAssetStatus
  fromLocation?: string
  toLocation?: string
  userId: string
  userName: string
  note?: string
}

export interface CompanyAsset {
  id: string
  ref: string
  name: string
  description?: string
  category: CompanyAssetCategory
  assetClass: CompanyAssetClass
  ppeAccountCode?: string
  qty: number
  unit: string
  assetTag?: string
  serialNumber?: string
  locationName: string
  custodianEmployeeId?: string
  custodianName?: string
  status: CompanyAssetStatus
  condition: CompanyAssetCondition
  acquiredDate: string
  acquiredVia: CompanyAssetAcquiredVia
  supplierName?: string
  purchaseOrderRef?: string
  billRef?: string
  expenseRef?: string
  costKes: number
  usefulLifeMonths?: number
  residualKes?: number
  depreciationMethod?: 'straight_line' | 'reducing_balance'
  accumDeprKes?: number
  lastDepreciatedPeriod?: string
  taxWdvKes?: number
  taxLastAllowanceYear?: number
  capitaliseJournalRef?: string
  disposalJournalRef?: string
  serialId?: string
  repairId?: string
  repairRef?: string
  notes?: string
  disposedDate?: string
  disposedQty?: number
  disposalReason?: string
  disposalProceedsKes?: number
  history: CompanyAssetHistoryEntry[]
  createdByUserId: string
  createdByName: string
  createdAt: string
  updatedAt: string
}

export type CompanyAssetInput = {
  name: string
  description?: string
  category: CompanyAssetCategory
  assetClass: CompanyAssetClass
  ppeAccountCode?: string
  qty: number
  unit?: string
  assetTag?: string
  serialNumber?: string
  locationName: string
  custodianEmployeeId?: string
  custodianName?: string
  status?: CompanyAssetStatus
  condition: CompanyAssetCondition
  acquiredDate: string
  acquiredVia: CompanyAssetAcquiredVia
  supplierName?: string
  purchaseOrderRef?: string
  billRef?: string
  expenseRef?: string
  costKes: number
  usefulLifeMonths?: number
  residualKes?: number
  depreciationMethod?: 'straight_line' | 'reducing_balance'
  accumDeprKes?: number
  serialId?: string
  notes?: string
}

const TERMINAL: ReadonlySet<CompanyAssetStatus> = new Set(['disposed', 'written_off'])

const TRANSITIONS: Record<CompanyAssetStatus, readonly CompanyAssetStatus[]> = {
  draft: ['in_use', 'in_storage'],
  in_use: ['in_storage', 'under_repair', 'lost', 'disposed', 'written_off'],
  in_storage: ['in_use', 'under_repair', 'lost', 'disposed', 'written_off'],
  under_repair: ['in_use', 'in_storage', 'lost', 'disposed', 'written_off'],
  lost: ['in_use', 'in_storage', 'disposed', 'written_off'],
  disposed: [],
  written_off: [],
}

export function defaultPpeAccountCode(category: CompanyAssetCategory): string | undefined {
  return PPE_ACCOUNT_DEFAULTS[category] ?? undefined
}

export function nextCompanyAssetRef(
  existingRefs: Array<string | undefined>,
  year = new Date().getFullYear(),
): string {
  const re = new RegExp(`^AST/${year}/(\\d+)$`)
  let max = 0
  for (const ref of existingRefs) {
    const m = ref ? re.exec(ref) : null
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `AST/${year}/${String(max + 1).padStart(4, '0')}`
}

export function allowedCompanyAssetTransitions(from: CompanyAssetStatus): CompanyAssetStatus[] {
  return [...(TRANSITIONS[from] ?? [])]
}

export function canTransitionCompanyAsset(from: CompanyAssetStatus, to: CompanyAssetStatus): boolean {
  if (from === to) return true
  return (TRANSITIONS[from] ?? []).includes(to)
}

export function canDeleteCompanyAsset(status: CompanyAssetStatus): boolean {
  return status === 'draft'
}

export function isTerminalCompanyAssetStatus(status: CompanyAssetStatus): boolean {
  return TERMINAL.has(status)
}

export function isLiveCompanyAsset(asset: Pick<CompanyAsset, 'status'>): boolean {
  return asset.status === 'in_use'
    || asset.status === 'in_storage'
    || asset.status === 'under_repair'
    || asset.status === 'lost'
}

export function isCapitalOnRegister(asset: Pick<CompanyAsset, 'assetClass' | 'status'>): boolean {
  return asset.assetClass === 'capital' && !TERMINAL.has(asset.status) && asset.status !== 'draft'
}

function optionalText(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed : undefined
}

export function findDuplicateAssetTag(
  assets: Array<Pick<CompanyAsset, 'id' | 'assetTag'>>,
  tag: string | undefined,
  excludeId?: string,
): Pick<CompanyAsset, 'id' | 'assetTag'> | undefined {
  const normalised = (tag ?? '').trim().toLowerCase()
  if (!normalised) return undefined
  return assets.find(asset =>
    asset.id !== excludeId
    && (asset.assetTag ?? '').trim().toLowerCase() === normalised,
  )
}

export function validateCompanyAssetInput(
  input: CompanyAssetInput,
  existing: Array<Pick<CompanyAsset, 'id' | 'assetTag'>> = [],
  excludeId?: string,
): string | null {
  if (!input.name.trim()) return 'Enter an item name'
  const qty = Number(input.qty)
  if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) return 'Quantity must be a whole number of at least 1'
  if (!input.locationName.trim()) return 'Enter a location (office room — not a warehouse or shop)'
  if (!input.acquiredDate) return 'Enter the acquired date'
  const cost = Number(input.costKes)
  if (!Number.isFinite(cost) || cost < 0) return 'Enter a cost of zero or more'
  if (input.assetClass === 'capital' && !optionalText(input.ppeAccountCode) && !defaultPpeAccountCode(input.category)) {
    return 'Capital items need a PPE account (1701, 1702, 1703, or 1704)'
  }
  if (input.usefulLifeMonths != null) {
    const life = Number(input.usefulLifeMonths)
    if (!Number.isFinite(life) || life < 1 || !Number.isInteger(life)) {
      return 'Useful life must be a whole number of months'
    }
  }
  if (input.residualKes != null) {
    const residual = Number(input.residualKes)
    if (!Number.isFinite(residual) || residual < 0) return 'Residual value cannot be negative'
    if (residual > cost) return 'Residual value cannot exceed cost'
  }
  if (findDuplicateAssetTag(existing, input.assetTag, excludeId)) {
    return `Asset tag ${input.assetTag!.trim()} is already in use`
  }
  const status = input.status ?? 'draft'
  if (status !== 'draft' && !['in_use', 'in_storage'].includes(status)) {
    return 'New records can only start as draft, in use, or in storage'
  }
  return null
}

export function resolvedPpeAccountCode(input: Pick<CompanyAssetInput, 'assetClass' | 'category' | 'ppeAccountCode'>): string | undefined {
  if (input.assetClass !== 'capital') return undefined
  return optionalText(input.ppeAccountCode) ?? defaultPpeAccountCode(input.category)
}

export function historyEntry(partial: Omit<CompanyAssetHistoryEntry, 'id'> & { id?: string }): CompanyAssetHistoryEntry {
  return {
    id: partial.id ?? `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: partial.at,
    action: partial.action,
    fromStatus: partial.fromStatus,
    toStatus: partial.toStatus,
    fromLocation: partial.fromLocation,
    toLocation: partial.toLocation,
    userId: partial.userId,
    userName: partial.userName,
    note: partial.note,
  }
}

export type CoaLine = { code: string; balance: number }

export type RegisterVsCoaRow = {
  code: string
  label: string
  register: number
  coa: number
  delta: number
}

/**
 * Compare capital items still on the register with COA cost balances.
 * Informational only — opening balances must not be double-posted.
 */
export function capitalRegisterVsCoa(
  assets: Array<Pick<CompanyAsset, 'assetClass' | 'status' | 'ppeAccountCode' | 'costKes'>>,
  accounts: CoaLine[],
  codes: readonly string[] = ['1701', '1702', '1703', '1704'],
): RegisterVsCoaRow[] {
  const registerByCode: Record<string, number> = {}
  for (const asset of assets) {
    if (!isCapitalOnRegister(asset)) continue
    const code = (asset.ppeAccountCode ?? '').trim()
    if (!code) continue
    registerByCode[code] = (registerByCode[code] ?? 0) + (Number(asset.costKes) || 0)
  }
  return codes.map(code => {
    const register = registerByCode[code] ?? 0
    const coa = Number(accounts.find(account => account.code === code)?.balance ?? 0)
    return {
      code,
      label: PPE_ACCOUNT_LABELS[code] ?? code,
      register,
      coa,
      delta: register - coa,
    }
  })
}

export function applyMove(
  asset: CompanyAsset,
  locationName: string,
  actor: { userId: string; userName: string; at: string },
  note?: string,
): { ok: true; asset: CompanyAsset } | { ok: false; error: string } {
  if (isTerminalCompanyAssetStatus(asset.status) || asset.status === 'draft') {
    return { ok: false, error: 'Only live items can be moved' }
  }
  const nextLocation = locationName.trim()
  if (!nextLocation) return { ok: false, error: 'Enter a location' }
  if (nextLocation === asset.locationName) return { ok: false, error: 'Choose a different location' }
  return {
    ok: true,
    asset: {
      ...asset,
      locationName: nextLocation,
      updatedAt: actor.at,
      history: [
        ...asset.history,
        historyEntry({
          at: actor.at,
          action: 'move',
          fromLocation: asset.locationName,
          toLocation: nextLocation,
          userId: actor.userId,
          userName: actor.userName,
          note,
        }),
      ],
    },
  }
}

export function applyCustodian(
  asset: CompanyAsset,
  custodian: { employeeId?: string; name?: string },
  actor: { userId: string; userName: string; at: string },
  note?: string,
): { ok: true; asset: CompanyAsset } | { ok: false; error: string } {
  if (isTerminalCompanyAssetStatus(asset.status) || asset.status === 'draft') {
    return { ok: false, error: 'Only live items can change custodian' }
  }
  const nextId = optionalText(custodian.employeeId)
  const nextName = optionalText(custodian.name)
  return {
    ok: true,
    asset: {
      ...asset,
      custodianEmployeeId: nextId,
      custodianName: nextName,
      updatedAt: actor.at,
      history: [
        ...asset.history,
        historyEntry({
          at: actor.at,
          action: 'custodian',
          userId: actor.userId,
          userName: actor.userName,
          note: note || (nextName ? `Custodian set to ${nextName}` : 'Custodian cleared'),
        }),
      ],
    },
  }
}

export function applyStatusChange(
  asset: CompanyAsset,
  toStatus: CompanyAssetStatus,
  actor: { userId: string; userName: string; at: string },
  note?: string,
): { ok: true; asset: CompanyAsset } | { ok: false; error: string } {
  if (!canTransitionCompanyAsset(asset.status, toStatus)) {
    return { ok: false, error: `Cannot change ${STATUS_LABELS[asset.status]} to ${STATUS_LABELS[toStatus]}` }
  }
  if (asset.status === toStatus) return { ok: false, error: 'Status is already set' }
  return {
    ok: true,
    asset: {
      ...asset,
      status: toStatus,
      updatedAt: actor.at,
      history: [
        ...asset.history,
        historyEntry({
          at: actor.at,
          action: toStatus === 'under_repair' ? 'repair' : 'status',
          fromStatus: asset.status,
          toStatus,
          userId: actor.userId,
          userName: actor.userName,
          note,
        }),
      ],
    },
  }
}

export function applyDispose(
  asset: CompanyAsset,
  qty: number,
  actor: { userId: string; userName: string; at: string },
  opts?: { reason?: string; proceedsKes?: number },
): { ok: true; asset: CompanyAsset } | { ok: false; error: string } {
  if (isTerminalCompanyAssetStatus(asset.status) || asset.status === 'draft') {
    return { ok: false, error: 'Only live items can be disposed' }
  }
  if (!canTransitionCompanyAsset(asset.status, 'disposed') && qty >= asset.qty) {
    return { ok: false, error: `Cannot dispose a ${STATUS_LABELS[asset.status]} item` }
  }
  const n = Number(qty)
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    return { ok: false, error: 'Disposal quantity must be a whole number of at least 1' }
  }
  if (n > asset.qty) return { ok: false, error: `Only ${asset.qty} ${asset.unit || 'each'} remain on this row` }

  const reason = optionalText(opts?.reason)
  const proceeds = Number(opts?.proceedsKes)
  const proceedsKes = Number.isFinite(proceeds) && proceeds > 0 ? proceeds : undefined

  if (n < asset.qty) {
    const remaining = asset.qty - n
    const fraction = remaining / asset.qty
    const remainingCost = Math.round(asset.costKes * fraction)
    const remainingAccum = Math.round((asset.accumDeprKes ?? 0) * fraction)
    const remainingTax = asset.taxWdvKes != null ? Math.round(asset.taxWdvKes * fraction) : undefined
    return {
      ok: true,
      asset: {
        ...asset,
        qty: remaining,
        costKes: remainingCost,
        accumDeprKes: remainingAccum,
        taxWdvKes: remainingTax,
        disposedQty: (asset.disposedQty ?? 0) + n,
        disposalReason: reason ?? asset.disposalReason,
        disposalProceedsKes: proceedsKes ?? asset.disposalProceedsKes,
        updatedAt: actor.at,
        history: [
          ...asset.history,
          historyEntry({
            at: actor.at,
            action: 'dispose_partial',
            userId: actor.userId,
            userName: actor.userName,
            note: reason || `Disposed ${n} of ${asset.qty} ${asset.unit || 'each'}`,
          }),
        ],
      },
    }
  }

  return {
    ok: true,
    asset: {
      ...asset,
      status: 'disposed',
      disposedDate: actor.at.slice(0, 10),
      disposedQty: (asset.disposedQty ?? 0) + n,
      disposalReason: reason,
      disposalProceedsKes: proceedsKes,
      updatedAt: actor.at,
      history: [
        ...asset.history,
        historyEntry({
          at: actor.at,
          action: 'dispose',
          fromStatus: asset.status,
          toStatus: 'disposed',
          userId: actor.userId,
          userName: actor.userName,
          note: reason,
        }),
      ],
    },
  }
}

export function applyWriteOff(
  asset: CompanyAsset,
  actor: { userId: string; userName: string; at: string },
  reason?: string,
): { ok: true; asset: CompanyAsset } | { ok: false; error: string } {
  if (!canTransitionCompanyAsset(asset.status, 'written_off')) {
    return { ok: false, error: `Cannot write off a ${STATUS_LABELS[asset.status]} item` }
  }
  return {
    ok: true,
    asset: {
      ...asset,
      status: 'written_off',
      disposedDate: actor.at.slice(0, 10),
      disposalReason: optionalText(reason),
      updatedAt: actor.at,
      history: [
        ...asset.history,
        historyEntry({
          at: actor.at,
          action: 'write_off',
          fromStatus: asset.status,
          toStatus: 'written_off',
          userId: actor.userId,
          userName: actor.userName,
          note: optionalText(reason),
        }),
      ],
    },
  }
}
