import type { Product } from '@/lib/store'
import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import { catalogBaseName } from '@/lib/reconfiguration/unit-selling-name'
import { printThermalLabelBatch, type ThermalLabelSpec } from '@/lib/inventory/thermal-label-template'
import {
  categoryConditionLine,
  resolveProductSpecs,
  truncateLabelText,
  type SerialLabelItem,
} from '@/lib/product-label-meta'

export type { SerialLabelItem, ProductLabelCondition } from '@/lib/product-label-meta'
export { formatConditionLabel, categoryConditionLine } from '@/lib/product-label-meta'

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function labelTitle(value: string): string {
  const base = catalogBaseName(value) || value || 'PRODUCT'
  return clean(base).toUpperCase()
}

function formatProcessor(config: ReturnType<typeof parseSpecsString>): string {
  const processor = clean(config.processor)
  const generation = clean(config.processorGeneration)
  if (!processor && !generation) return '—'
  if (processor && generation && processor.toLowerCase().includes(generation.toLowerCase())) {
    return processor
  }
  return clean([processor, generation].filter(Boolean).join(' ')) || '—'
}

function formatRam(config: ReturnType<typeof parseSpecsString>): string {
  const gb = Number(config.totalRamGb) || 0
  return gb > 0 ? `${gb}GB` : '—'
}

function formatStorage(config: ReturnType<typeof parseSpecsString>): string {
  const gb = Number(config.primaryStorageGb) || 0
  if (gb <= 0) return '—'

  const capacity = gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`
  const rawType = clean(config.storageType)
  const storageType = /nvme/i.test(rawType)
    ? 'NVMe'
    : /hdd/i.test(rawType)
      ? 'HDD'
      : 'SSD'
  return `${capacity} ${storageType}`
}

function isComputerLike(name: string, category?: string | null): boolean {
  return /\b(laptop|notebook|desktop|workstation|computer|all[ -]?in[ -]?one|aio|macbook|thinkpad|elitebook|probook|latitude|optiplex)\b/i.test(
    `${name} ${category || ''}`,
  )
}

/**
 * One label information model for every inventory print path.
 * Computer items use Processor / RAM / Storage. Other products use one large
 * Specification field so accessories remain readable on 80×40mm thermal stock.
 */
export function productThermalSpecs(opts: {
  name: string
  category?: string | null
  specsText?: string | null
}): ThermalLabelSpec[] {
  const source = clean(`${opts.name} ${opts.specsText || ''}`)
  const parsed = parseSpecsString(source)
  const computer = isComputerLike(opts.name, opts.category)
  const hasDeviceFacts = Boolean(
    clean(parsed.processor)
      || clean(parsed.processorGeneration)
      || (Number(parsed.totalRamGb) || 0) > 0
      || (Number(parsed.primaryStorageGb) || 0) > 0,
  )

  if (computer || hasDeviceFacts) {
    return [
      { label: 'Processor', value: formatProcessor(parsed) },
      { label: 'RAM', value: formatRam(parsed) },
      { label: 'Storage', value: formatStorage(parsed) },
    ]
  }

  const detail = truncateLabelText(clean(opts.specsText) || clean(opts.category) || '—', 78)
  return [{ label: 'Specification', value: detail || '—' }]
}

export async function printSerialLabels(items: SerialLabelItem[]): Promise<void> {
  if (!items.length) return

  const labels = items.map(item => {
    const barcodeValue = clean(item.serial) || clean(item.barcode) || clean(item.sku)
    return {
      title: labelTitle(item.productName),
      barcodeValue,
      caption: clean(item.serial) || barcodeValue,
      specs: productThermalSpecs({
        name: item.productName,
        category: item.category,
        specsText: item.specs,
      }),
    }
  })

  printThermalLabelBatch(labels, 'Serial Labels')
}

export function printProductLabels(product: Product, qty: number): void {
  const barcodeValue = clean(product.barcode) || clean(product.sku)
  if (!barcodeValue) return

  const specsText = resolveProductSpecs(product as Product & { specs?: string | null })
  const label = {
    title: labelTitle(product.name),
    barcodeValue,
    caption: clean(product.sku) || barcodeValue,
    specs: productThermalSpecs({
      name: product.name,
      category: product.category,
      specsText,
    }),
  }

  const count = Math.max(0, Math.floor(Number(qty) || 0))
  if (!count) return
  printThermalLabelBatch(Array.from({ length: count }, () => label), `Product Label — ${product.name}`)
}

export type AssetTagItem = {
  ref: string
  name: string
  assetTag?: string
  category?: string
  locationName?: string
}

export function assetTagBarcodeValue(item: Pick<AssetTagItem, 'assetTag' | 'ref'>): string {
  return clean(item.assetTag || item.ref)
}

export function printAssetTags(items: AssetTagItem[]): void {
  if (!items.length) return

  const labels = items.map(item => {
    const barcodeValue = assetTagBarcodeValue(item)
    const specs: ThermalLabelSpec[] = []
    if (clean(item.category)) specs.push({ label: 'Category', value: clean(item.category) })
    if (clean(item.locationName)) specs.push({ label: 'Location', value: clean(item.locationName) })
    if (!specs.length) specs.push({ label: 'Specification', value: 'Company Asset' })

    return {
      title: labelTitle(item.name),
      barcodeValue,
      caption: barcodeValue,
      specs,
    }
  }).filter(label => label.barcodeValue)

  printThermalLabelBatch(labels, 'Asset Tags')
}
