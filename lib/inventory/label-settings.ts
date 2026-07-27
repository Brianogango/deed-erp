export type LabelTemplateId = 'product_standard' | 'serial_asset' | 'compact'

export type LabelSizeId = 'a4_3x7' | '50x30' | '40x25'

export interface LabelSettings {
  template: LabelTemplateId
  size: LabelSizeId
  copies: number
  includeProductName: boolean
  includeSku: boolean
  includeSerial: boolean
  includeBarcode: boolean
  includeQr: boolean
  includePrice: boolean
  includeCompanyName: boolean
  printOrder: 'selection' | 'name' | 'sku'
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  template: 'product_standard',
  size: 'a4_3x7',
  copies: 1,
  includeProductName: true,
  includeSku: true,
  includeSerial: true,
  includeBarcode: true,
  includeQr: true,
  includePrice: true,
  includeCompanyName: true,
  printOrder: 'selection',
}

export const LABEL_TEMPLATE_OPTIONS: Array<{ id: LabelTemplateId; label: string }> = [
  { id: 'product_standard', label: 'Product standard' },
  { id: 'serial_asset', label: 'Serial / asset' },
  { id: 'compact', label: 'Compact' },
]

export const LABEL_SIZE_OPTIONS: Array<{ id: LabelSizeId; label: string }> = [
  { id: 'a4_3x7', label: 'A4 sheet (3 × 7)' },
  { id: '50x30', label: '50 × 30 mm' },
  { id: '40x25', label: '40 × 25 mm' },
]

export function normalizeLabelSettings(input?: Partial<LabelSettings> | null): LabelSettings {
  return {
    ...DEFAULT_LABEL_SETTINGS,
    ...(input || {}),
    copies: Math.max(1, Math.min(50, Number(input?.copies ?? DEFAULT_LABEL_SETTINGS.copies) || 1)),
  }
}
