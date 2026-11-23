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
function categoryLabel(category: string | null | undefined): string {
  const c = String(category ?? '').trim()
  if (/laptop/i.test(c)) return 'LAPTOP'
  if (/desktop/i.test(c)) return 'DESKTOP'
  if (!c) return 'DEVICE'
  return c.toUpperCase().replace(/S$/, '').replace(/&/g, '&')
}

const gb = (n: number | null | undefined) => (n && n > 0 ? (n >= 1024 && n % 1024 === 0 ? `${n / 1024}TB` : `${n}GB`) : '')

/** "8th i5 8GB 256GB" — empty when nothing is known. */
export function compactLabelSpecs(
  specsText: string | null | undefined,
  config?: MachineLabelInput['currentConfig'],
  /** The product's name ("HP 820 G3 - i5 6th Gen - 8GB RAM 256GB SSD"): a last source for the drive. */
  productName?: string | null,
): string {
  const tidy = (t: string | null | undefined) => String(t ?? '').replace(/\b(RAM|DDR\d*|Gen)\b\s+(?=\d)/gi, '$1, ')
  const parsed = parseSpecsString(tidy(specsText))
  const fromName = parseSpecsString(tidy(productName))
  // The unit's own specs come first: they are what was last recorded for
  // this machine (a bench job writes them too; Edit serial or Set model &
  // specs changes only them). The reconfiguration record came first before,
  // so a machine changed to 8GB still printed its old 16GB.
  const gen = String(parsed.processorGeneration || config?.processorGeneration || fromName.processorGeneration || '').match(/\d+(?:st|nd|rd|th)/i)?.[0]?.toLowerCase() ?? ''
  // A bare "i5" is not a processor to the parser; the text itself still says it.
  const cpuRaw = String(parsed.processor || specsText || config?.processor || fromName.processor || '')
  const cpu = cpuRaw.match(/\bi[3579]\b/i)?.[0]?.toLowerCase()
    ?? cpuRaw.match(/Ryzen\s*\d/i)?.[0]
    ?? cpuRaw.match(/\bM\d\b/)?.[0]
    ?? ''
  const ramGb = Number(parsed.totalRamGb) || Number(config?.totalRamGb) || Number(fromName.totalRamGb) || 0
  // The drive: the unit's specs, then the saved configuration, then the
  // product's name. A drive the same size as the RAM is the old parser's
  // mistake ("8GB RAM 256GB SSD" saved as an 8GB drive — the label read
  // "8GB 8GB"), so it is skipped; with no believable size the label leaves
  // the drive out rather than print the RAM twice.
  const believable = (n: number) => n > 0 && !(n === ramGb && n <= 64)
  const storageGb = [parsed.primaryStorageGb, config?.primaryStorageGb, fromName.primaryStorageGb]
    .map(n => Number(n) || 0)
    .find(believable) ?? 0
  const ram = gb(ramGb)
  const storage = gb(storageGb)
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
    specs: internal ? '' : compactLabelSpecs(input.specsText, input.currentConfig, input.productName),
    serial: internal || serial === code ? '' : serial,
    code,
    dateIn: internal ? dateIn(input.receivedDate) : '',
  }
}
