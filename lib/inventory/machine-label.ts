/**
 * What goes on a machine's 58 × 38 mm sticker (Code 128). The barcode is
 * always the asset ID, so the same sticker number scans for the machine's
 * whole life.
 *
 * - With Issues (internal, not for customers): band, model, asset ID, date
 *   in. No serial, no specs, no issue text.
 * - For sale: category, REFURBISHED (outlined) or BRAND NEW (solid), model,
 *   specs when known, S/N when known, asset ID. No warranty line.
 *
 * Pure.
 */
import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import { catalogBaseName } from '@/lib/reconfiguration/unit-selling-name'

export type MachineLabelVariant = 'with_issues' | 'refurbished' | 'new'

export type MachineLabelInput = {
  productName: string
  category?: string | null
  productType?: string | null
  specsText?: string | null
  serial?: string | null
  identityPending?: boolean
  assetId?: string | null
  barcode?: string | null
  location?: string | null
  status?: string | null
  receivedDate?: string | null
  /** A finished refurb is still on the bench but gets the customer sticker. */
  forSale?: boolean
  currentConfig?: { processor?: string | null; processorGeneration?: string | null; totalRamGb?: number | null; primaryStorageGb?: number | null } | null
}

export type MachineLabelView = {
  variant: MachineLabelVariant
  category: string
  condition: string
  model: string
  specs: string
  serial: string
  code: string
  dateIn: string
}

/** Not ready for a customer: With Issues, on the bench, or not identified yet. */
export function machineLabelVariant(input: Pick<MachineLabelInput, 'location' | 'status' | 'identityPending' | 'productType' | 'forSale'>): MachineLabelVariant {
  // Never a sale sticker for a machine we have not identified.
  if (input.forSale && input.identityPending !== true) return String(input.productType ?? '').toLowerCase() === 'new' ? 'new' : 'refurbished'
  const internal = input.location === 'shop' || input.location === 'repair_unit' || input.status === 'refurbishment' || input.identityPending === true
  if (internal) return 'with_issues'
  return String(input.productType ?? '').toLowerCase() === 'new' ? 'new' : 'refurbished'
}

/** "LAPTOP" from "Laptops"; "DESKTOP" from "Complete Desktops". */
export function categoryLabel(category: string | null | undefined): string {
  const c = String(category ?? '').trim()
  if (/laptop/i.test(c)) return 'LAPTOP'
  if (/desktop/i.test(c)) return 'DESKTOP'
  if (!c) return 'DEVICE'
  return c.toUpperCase().replace(/S$/, '').replace(/&/g, '&')
}

const gb = (n: number | null | undefined) => (n && n > 0 ? (n >= 1024 && n % 1024 === 0 ? `${n / 1024}TB` : `${n}GB`) : '')

/** "8th i5 8GB 256GB" — empty when nothing is known. */
export function compactLabelSpecs(specsText: string | null | undefined, config?: MachineLabelInput['currentConfig']): string {
  const parsed = parseSpecsString(String(specsText ?? '').replace(/\b(RAM|DDR\d*|Gen)\b\s+(?=\d)/gi, '$1, '))
  const gen = String(config?.processorGeneration || parsed.processorGeneration || '').match(/\d+(?:st|nd|rd|th)/i)?.[0]?.toLowerCase() ?? ''
  // A bare "i5" is not a processor to the parser; the text itself still says it.
  const cpuRaw = String(config?.processor || parsed.processor || specsText || '')
  const cpu = cpuRaw.match(/\bi[3579]\b/i)?.[0]?.toLowerCase()
    ?? cpuRaw.match(/Ryzen\s*\d/i)?.[0]
    ?? cpuRaw.match(/\bM\d\b/)?.[0]
    ?? ''
  const ram = gb(Number(config?.totalRamGb) || Number(parsed.totalRamGb) || 0)
  const storage = gb(Number(config?.primaryStorageGb) || Number(parsed.primaryStorageGb) || 0)
  return [gen, cpu, ram, storage].filter(Boolean).join(' ')
}

function dateIn(value: string | null | undefined): string {
  const d = new Date(String(value ?? ''))
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Africa/Nairobi' })
}

export function buildMachineLabelView(input: MachineLabelInput): MachineLabelView {
  const variant = machineLabelVariant(input)
  const internal = variant === 'with_issues'
  const code = String(input.assetId || input.barcode || input.serial || '').trim().toUpperCase()
  const serial = input.identityPending ? '' : String(input.serial ?? '').trim()
  return {
    variant,
    category: categoryLabel(input.category),
    condition: variant === 'new' ? 'BRAND NEW' : variant === 'refurbished' ? 'REFURBISHED' : 'WITH ISSUES · INTERNAL',
    model: catalogBaseName(input.productName) || input.productName || 'Device',
    specs: internal ? '' : compactLabelSpecs(input.specsText, input.currentConfig),
    serial: internal || serial === code ? '' : serial,
    code,
    dateIn: internal ? dateIn(input.receivedDate) : '',
  }
}
