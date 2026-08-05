/**
 * Device Reconfiguration — shared types (client + server safe).
 * Mirrors Prisma enums / domain shapes without importing server-only modules.
 */

export const RECONFIG_TRANSACTION_TYPES = [
  'downgrade_for_sale',
  'upgrade_for_sale',
  'customer_paid_upgrade',
  'internal_refurbishment',
  'component_replacement',
  'warranty_replacement',
  'repair_related',
  'configuration_correction',
  'stock_standardisation',
] as const

export type ReconfigTransactionType = (typeof RECONFIG_TRANSACTION_TYPES)[number]

export const RECONFIG_STATUSES = [
  'draft',
  'pending_stock_check',
  'components_reserved',
  'pending_approval',
  'approved',
  'in_progress',
  'pending_qa',
  'completed',
  'cancelled',
  'reversed',
] as const

export type ReconfigStatus = (typeof RECONFIG_STATUSES)[number]

export const COMPONENT_SLOT_TYPES = [
  'ram_slot',
  'm2_slot',
  'sata_bay',
  'battery',
  'keyboard',
  'wifi_card',
  'charger',
  'other',
] as const

export type ComponentSlotType = (typeof COMPONENT_SLOT_TYPES)[number]

export const COMPONENT_DISPOSITIONS = [
  'quarantine',
  'pending_testing',
  'ready_for_sale',
  'repair_required',
  'parts_harvesting',
  'damaged',
  'write_off',
  'supplier_return',
] as const

export type ComponentDisposition = (typeof COMPONENT_DISPOSITIONS)[number]

export const DATA_STATUSES = [
  'unknown',
  'none',
  'company',
  'client',
  'test',
  'awaiting_backup',
  'awaiting_sanitisation',
  'sanitised',
  'sanitisation_failed',
  'physical_destruction_required',
] as const

export type DataStatus = (typeof DATA_STATUSES)[number]

export const INSTALLATION_STATUSES = ['installed', 'removed', 'quarantined'] as const
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number]

export const PRICE_METHODS = [
  'manual',
  'pricelist',
  'cost_plus',
  'fixed_diff',
  'customer',
  'promotion',
] as const

export type PriceMethod = (typeof PRICE_METHODS)[number]

export const QA_CHECKLIST: Array<{ key: string; label: string; required: boolean }> = [
  { key: 'powers_on', label: 'Device powers on', required: true },
  { key: 'bios_ram', label: 'BIOS detects installed RAM', required: true },
  { key: 'bios_storage', label: 'BIOS detects installed storage', required: true },
  { key: 'ram_matches_target', label: 'Total RAM matches target', required: true },
  { key: 'storage_matches_target', label: 'Storage capacity matches target', required: true },
  { key: 'memory_test', label: 'Memory test passed', required: true },
  { key: 'ssd_health', label: 'SSD health passed', required: true },
  { key: 'os_boots', label: 'Operating system boots', required: true },
  { key: 'drivers', label: 'Drivers working', required: false },
  { key: 'battery', label: 'Battery status checked', required: false },
  { key: 'wifi', label: 'Wi-Fi working', required: false },
  { key: 'audio', label: 'Audio working', required: false },
  { key: 'camera', label: 'Camera working', required: false },
  { key: 'keyboard', label: 'Keyboard working', required: false },
  { key: 'ports', label: 'Ports tested', required: false },
  { key: 'device_serial_confirmed', label: 'Device serial confirmed', required: true },
  { key: 'component_serials_confirmed', label: 'Component serials confirmed', required: true },
  { key: 'data_sanitisation', label: 'Data sanitisation completed where required', required: false },
  { key: 'final_config_confirmed', label: 'Final configuration confirmed', required: true },
  { key: 'cosmetic', label: 'Cosmetic condition confirmed', required: false },
  { key: 'technician_signoff', label: 'Technician sign-off', required: true },
  { key: 'qa_officer_signoff', label: 'QA officer sign-off', required: true },
]

export interface RamCompositionEntry {
  slotType: ComponentSlotType
  slotNumber: number
  capacityGb: number
  technology?: string
  removable: boolean
  productId?: string
  installationId?: string
  componentSerialText?: string
}

export interface DeviceConfigFields {
  processor?: string | null
  processorGeneration?: string | null
  totalRamGb: number
  ramComposition: RamCompositionEntry[]
  primaryStorageGb?: number | null
  secondaryStorageGb?: number | null
  storageType?: string | null
  screenSize?: string | null
  screenResolution?: string | null
  touchscreen?: boolean | null
  graphics?: string | null
  operatingSystem?: string | null
  keyboardLayout?: string | null
  colour?: string | null
  includedAccessories?: string[]
  batteryCondition?: string | null
  grade?: string | null
  displayName: string
}

export interface InstalledComponentView {
  id: string
  componentProductId: string
  componentProductName?: string
  componentSerialId?: string | null
  componentSerialText?: string | null
  category: string
  slotType: ComponentSlotType
  slotNumber: number
  capacityGb?: number | null
  technology?: string | null
  quantity: number
  removable: boolean
  status: InstallationStatus
  costAtInstallation: number
  condition?: string | null
}

export interface TargetConfigInput {
  /**
   * Which components this work order may change.
   * - `ram` — leave storage unchanged
   * - `storage` — leave RAM unchanged
   * - `both` — allow either or both (default)
   */
  changeScope?: 'ram' | 'storage' | 'both'
  totalRamGb: number
  primaryStorageGb: number
  secondaryStorageGb?: number | null
  storageType?: string | null
  processor?: string | null
  processorGeneration?: string | null
  /** Preferred install products for RAM / storage */
  ramProductId?: string
  storageProductId?: string
  secondaryStorageProductId?: string
  /** When additive upgrade: keep existing and add */
  additiveRam?: boolean
}

export interface CompatibilityIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
  overridable: boolean
}

export interface DiffResult {
  removals: Array<{
    installationId: string
    componentProductId: string
    slotType: ComponentSlotType
    slotNumber: number
    capacityGb?: number | null
    existingCost: number
    componentSerialText?: string | null
    category: string
    removable: boolean
  }>
  installations: Array<{
    componentProductId?: string
    requiredCapacityGb: number
    category: 'ram' | 'storage'
    targetSlotType: ComponentSlotType
    targetSlotNumber: number
    technology?: string
  }>
  proposed: DeviceConfigFields
  issues: CompatibilityIssue[]
}

export const ACTIVE_RECONFIG_STATUSES: ReconfigStatus[] = [
  'draft',
  'pending_stock_check',
  'components_reserved',
  'pending_approval',
  'approved',
  'in_progress',
  'pending_qa',
]

export const TRANSACTION_TYPE_LABELS: Record<ReconfigTransactionType, string> = {
  downgrade_for_sale: 'Downgrade for sale',
  upgrade_for_sale: 'Upgrade for sale',
  customer_paid_upgrade: 'Customer-paid upgrade',
  internal_refurbishment: 'Internal refurbishment',
  component_replacement: 'Component replacement',
  warranty_replacement: 'Warranty replacement',
  repair_related: 'Repair-related reconfiguration',
  configuration_correction: 'Configuration correction',
  stock_standardisation: 'Stock standardisation',
}

export const STATUS_LABELS: Record<ReconfigStatus, string> = {
  draft: 'Draft',
  pending_stock_check: 'Pending Stock Check',
  components_reserved: 'Components Reserved',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  in_progress: 'In Progress',
  pending_qa: 'Pending QA',
  completed: 'Completed',
  cancelled: 'Cancelled',
  reversed: 'Reversed',
}
