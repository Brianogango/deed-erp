/**
 * Pure data mapping for the 100×60mm serialized-device inventory label.
 * RAM / storage MUST come from the unit's current configuration (snapshot or specs),
 * never from product-master defaults alone.
 */

import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import { catalogBaseName } from '@/lib/reconfiguration/unit-selling-name'
import type { DeviceConfigFields } from '@/lib/reconfiguration/types'
import { formatConditionLabel } from '@/lib/product-label-meta'

export type SerialDeviceLabelStatus =
  | 'available'
  | 'assigned'
  | 'sold'
  | 'under_repair'
  | 'returned'
  | 'written_off'
  | 'refurbishment'
  | 'reconfiguration'
  | string

export type SerialDeviceLabelInput = {
  serialId: string
  serial: string
  barcode?: string | null
  productName: string
  productCategory?: string | null
  productDescription?: string | null
  productType?: 'new' | 'refurbished' | string | null
  warrantyMonths?: number | null
  receivedDate?: string | null
  locationLabel?: string | null
  status?: SerialDeviceLabelStatus | null
  /** Blob free-text specs — fallback when structured config missing */
  specsText?: string | null
  /** Preferred: current DeviceConfigurationSnapshot / getDeviceConfiguration().current */
  currentConfig?: Partial<DeviceConfigFields> | null
  /** Absolute or path URL for QR (defaults built by caller) */
  qrUrl: string
  website?: string | null
  phone?: string | null
  subtitle?: string | null
}

export type SerialDeviceLabelView = {
  serialId: string
  serial: string
  barcodeValue: string
  productName: string
  subtitle: string
  statusBadge: string
  cpu: string
  ram: string
  storage: string
  display: string
  condition: string
  warranty: string
  dateIn: string
  location: string
  qrUrl: string
  website: string
  phone: string
}

const STATUS_BADGE: Record<string, string> = {
  available: 'IN STOCK',
  assigned: 'ASSIGNED',
  sold: 'SOLD',
  under_repair: 'REPAIR',
  returned: 'RETURNED',
  written_off: 'WRITE-OFF',
  refurbishment: 'REFURB',
  reconfiguration: 'RECONFIG',
  in_stock: 'IN STOCK',
}

function upper(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase()
}

function formatDateIn(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    // already human text?
    const s = String(iso).trim()
    return s || '—'
  }
  return d.toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

function formatCpu(config: Partial<DeviceConfigFields> | null | undefined, specsText?: string | null): string {
  const gen = String(config?.processorGeneration || '').trim()
  const proc = String(config?.processor || '').trim()
  if (gen || proc) {
    // Prefer short form: "i5 11TH GEN"
    const shortProc = proc
      .replace(/Intel\s+Core\s+/i, '')
      .replace(/AMD\s+/i, '')
      .trim()
    const bits = [shortProc || proc, gen].filter(Boolean)
    return upper(bits.join(' '))
  }
  const parsed = parseSpecsString(specsText)
  if (parsed.processor || parsed.processorGeneration) {
    return formatCpu(parsed, null)
  }
  return '—'
}

function formatRam(config: Partial<DeviceConfigFields> | null | undefined, specsText?: string | null): string {
  const gb = Number(config?.totalRamGb) || 0
  if (gb > 0) {
    const tech = (config?.ramComposition || []).find(e => e.technology)?.technology
    const suffix = tech ? ` ${upper(tech)}` : ''
    return `${gb}GB${suffix}`
  }
  const parsed = parseSpecsString(specsText)
  if (parsed.totalRamGb && parsed.totalRamGb > 0) return `${parsed.totalRamGb}GB`
  return '—'
}

function formatStorage(config: Partial<DeviceConfigFields> | null | undefined, specsText?: string | null): string {
  const gb = Number(config?.primaryStorageGb) || 0
  if (gb > 0) {
    const rawType = String(config?.storageType || 'SSD')
    const type = /nvme/i.test(rawType)
      ? 'NVMe'
      : /hdd/i.test(rawType)
        ? 'HDD'
        : 'SSD'
    return `${gb}GB ${type}`
  }
  const parsed = parseSpecsString(specsText)
  if (parsed.primaryStorageGb && parsed.primaryStorageGb > 0) {
    return formatStorage(parsed, null)
  }
  return '—'
}

function formatDisplay(config: Partial<DeviceConfigFields> | null | undefined, specsText?: string | null, productDescription?: string | null): string {
  const size = String(config?.screenSize || '').trim()
  const res = String(config?.screenResolution || '').trim()
  if (size || res) {
    const resShort = res.replace(/1920\s*[x×]\s*1080/i, 'FHD').replace(/Full\s*HD/i, 'FHD')
    return upper([size, resShort].filter(Boolean).join(' '))
  }
  const fromDesc = String(productDescription || specsText || '')
  const m = fromDesc.match(/(\d+(?:\.\d+)?)\s*(?:\"|''|inch)?\s*(FHD|HD|UHD|QHD)?/i)
  if (m) {
    const inches = m[1].includes('.') ? `${m[1]}"` : `${m[1]}.0"`
    return upper([inches, m[2] || ''].filter(Boolean).join(' '))
  }
  return '—'
}

function formatCondition(productType?: string | null, grade?: string | null): string {
  const fromType = formatConditionLabel(productType)
  if (fromType === 'NEW') return 'NEW'
  if (fromType === 'REFURB') return 'REFURBISHED'
  if (grade) return upper(String(grade))
  return '—'
}

function formatWarranty(months?: number | null): string {
  const n = Number(months)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n === 1) return '1 MONTH'
  return `${Math.round(n)} MONTHS`
}

function formatWebsite(website?: string | null): string {
  const raw = String(website || '').trim()
  if (!raw) return 'shop.deed.africa'
  return raw.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

function formatPhone(phone?: string | null): string {
  const raw = String(phone || '').trim()
  if (!raw) return '+254 716 964 964'
  // Pretty Kenya mobiles: 0716964964 → +254 716 964 964
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10 && digits.startsWith('0')) {
    return `+254 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  if (digits.length === 12 && digits.startsWith('254')) {
    return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
  }
  return raw
}

function defaultSubtitle(category?: string | null, description?: string | null): string {
  const cat = String(category || '').trim()
  if (cat && /laptop/i.test(cat)) return 'BUSINESS LAPTOP'
  if (cat && /desktop/i.test(cat)) return 'DESKTOP PC'
  if (cat) return upper(cat)
  const desc = String(description || '').trim()
  if (desc) return upper(desc.slice(0, 40))
  return 'SERIALIZED UNIT'
}

/**
 * Build the printable label view-model from live ERP fields.
 * Prefer `currentConfig` (post-reconfiguration snapshot) for RAM/storage.
 */
export function buildSerialDeviceLabelView(input: SerialDeviceLabelInput): SerialDeviceLabelView {
  const config = input.currentConfig || null
  const specsText = input.specsText || config?.displayName || ''
  const serial = String(input.serial || '').trim()
  const statusKey = String(input.status || 'available').toLowerCase()

  return {
    serialId: input.serialId,
    serial,
    barcodeValue: serial || String(input.barcode || '').trim(),
    // Title is brand/model only — RAM/SSD print from currentConfig so a
    // reconfigured unit cannot keep a stale 16GB in the name line.
    productName: upper(catalogBaseName(input.productName) || input.productName || 'DEVICE'),
    subtitle: upper(input.subtitle || defaultSubtitle(input.productCategory, input.productDescription)),
    statusBadge: STATUS_BADGE[statusKey] || upper(statusKey.replace(/_/g, ' ')),
    cpu: formatCpu(config, specsText),
    ram: formatRam(config, specsText),
    storage: formatStorage(config, specsText),
    display: formatDisplay(config, specsText, input.productDescription),
    condition: formatCondition(input.productType, config?.grade),
    warranty: formatWarranty(input.warrantyMonths),
    dateIn: formatDateIn(input.receivedDate),
    location: upper(String(input.locationLabel || '—')),
    qrUrl: input.qrUrl,
    website: formatWebsite(input.website),
    phone: formatPhone(input.phone),
  }
}

/** Absolute QR target for a serialized unit (scanner-friendly). */
export function buildSerialDeviceQrUrl(opts: {
  origin?: string | null
  serialId: string
  serial?: string | null
}): string {
  const origin = String(opts.origin || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')
  const id = encodeURIComponent(opts.serialId || opts.serial || '')
  const path = `/inventory/serial/${id}`
  return origin ? `${origin}${path}` : path
}
