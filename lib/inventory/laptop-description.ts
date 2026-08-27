/**
 * Sales-facing laptop descriptions from the catalog title (this unit's CPU / RAM / storage)
 * plus official chassis facts (screen size, ports, GPU when the QuickSpec lists one value).
 *
 * Does not guess optional panels (HD vs FHD, touch, nits) or optional Thunderbolt.
 * Retail SKUs with a product number use the manufacturer datasheet verbatim.
 */

import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import {
  skuOverrideFor,
  verifiedChassisFor,
  type VerifiedChassis,
} from '@/lib/inventory/laptop-verified-chassis'

export type LaptopDisplayFacts = {
  screenSize: string | null
  resolution: string | null
  touch: boolean | null
  form: 'x360 convertible' | '2-in-1' | 'clamshell' | null
  graphics: string | null
  ports: string | null
}

export function shouldSkipLaptopCatalogRow(name: string): boolean {
  const n = String(name || '').trim()
  if (!n) return true
  if (/^\s*battery\b/i.test(n) || /\bbattery\b.{0,40}thinkpad/i.test(n)) return true
  if (/\ball[-\s]?in[-\s]?one\b/i.test(n) || /\bimac\b/i.test(n)) return true
  return false
}

export function isDetailedLaptopDescription(text: string | null | undefined): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (t.length < 90) return false
  if (/configured with/i.test(t) && !/nits|thunderbolt|warranty/i.test(t)) return false
  const hasDisplay = /inch|display|screen|touchscreen|multi-touch/i.test(t)
  const hasRetail = /nits|thunderbolt|warranty|lpddr/i.test(t)
  const hasIo = /usb|hdmi|thunderbolt|magsafe|surface connect/i.test(t)
  return hasDisplay && hasRetail && hasIo
}

function parseDisplayFromText(text: string): Partial<LaptopDisplayFacts> {
  const raw = String(text || '')
  const screenMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:-inch|inch(?:es)?|["”'″])/i)
  const resMatch = raw.match(/\b(\d{3,4}\s*[x×*]\s*\d{3,4})\b/i)
    || raw.match(/\b(fhd|2k|3k|4k|uhd|hd\+|oled|liquid retina)\b/i)
  const namedGpu = raw.match(
    /nvidia[^,]*|quadro[^,]*|geforce[^,]*|rtx\s*\d+[^,]*|gtx\s*\d+[^,]*|(?:intel\s+)?iris\s*xe[^,]*|(?:intel\s+)?uhd\s+graphics[^,]*|(?:intel\s+)?arc(?:\s+\d+\w*)?(?:\s+gpu)?(?:\s*\(\d+\s*GB\))?|radeon[^,]*|apple\s+\d+[-\s]?core\s+gpu/i,
  )
  const nonTouch = /non[-\s]?touch/i.test(raw)
  const touch = nonTouch ? false : /touchscreen|multi-touch|(?:\btouch\b(?!\s*id))/i.test(raw)
  let form: LaptopDisplayFacts['form'] | null = null
  if (/x360/i.test(raw)) form = 'x360 convertible'
  else if (/2\s*-?\s*in\s*-?\s*1|flip|yoga|convertible/i.test(raw)) form = '2-in-1'
  let resolution: string | null = null
  if (resMatch) {
    const token = resMatch[1].replace(/\*/g, ' x ').replace(/×/g, ' x ')
    if (/^\d/.test(token)) resolution = token.replace(/\s+/g, ' ')
    else if (/fhd/i.test(token)) resolution = 'FHD (1920 x 1080)'
    else if (/2k/i.test(token)) resolution = '2K (1920 x 1200)'
    else if (/3k/i.test(token)) resolution = '3K (2880 x 1800)'
    else if (/oled/i.test(token)) resolution = 'OLED'
    else if (/liquid retina/i.test(token)) resolution = 'Liquid Retina (2560 x 1664)'
    else resolution = token
  }
  return {
    screenSize: screenMatch ? String(Number(screenMatch[1])) : null,
    resolution,
    touch: nonTouch ? false : touch ? true : null,
    form,
    graphics: namedGpu ? namedGpu[0].replace(/\s+/g, ' ').trim() : null,
  }
}

export function inferLaptopDisplay(name: string): LaptopDisplayFacts {
  const chassis = verifiedChassisFor(name)
  const parsed = parseDisplayFromText(name)
  const skuGpu = parsed.graphics
  const officialGpuWins = /16-am0073dx|am0073dx/i.test(name)
  return {
    screenSize: chassis?.screenSize || (parsed.screenSize && Number(parsed.screenSize) >= 10 ? parsed.screenSize : null),
    resolution: parsed.resolution || chassis?.resolution || null,
    touch: parsed.touch != null ? parsed.touch : (chassis?.touch ?? null),
    form: parsed.form || chassis?.form || null,
    graphics: officialGpuWins
      ? (chassis?.graphics || skuGpu || null)
      : (skuGpu || chassis?.graphics || null),
    ports: chassis?.ports ?? null,
  }
}

function extraCpu(name: string): string | null {
  const m = name.match(
    /intel\s+core\s+ultra\s+[3579]\s*\d*|core\s+ultra\s+[3579]\s*\d*|intel\s+core\s+[357]\s*[- ]?\d+u|intel\s+celeron(?:\s+n?\d+)?|intel\s+pentium(?:\s+silver)?|intel\s+xeon|intel\s+atom|amd\s+ryzen(?:\s+\d)?(?:\s+pro)?(?:\s+\d+\w*)?/i,
  )
  return m ? m[0].replace(/\s+/g, ' ').trim() : null
}

function ramStorageFromName(name: string): { ram: string; storage: string } {
  const ramMatch = name.match(/(\d+)\s*GB\s*(?:LPDDR\d+x?(?:-\d+)?|DDR\d+)?\s*(?:onboard\s*)?(?:RAM|memory)\b/i)
    || name.match(/\b(\d+)\s*G\s+256GB/i)
  const storageMatch = name.match(
    /(\d+(?:\.\d+)?)\s*(TB|GB)\s*(?:M\.2\s+)?(?:PCIe[^\s,]*\s*)?(?:Gen\d+\s+)?(?:NVMe\s+)?(SSD|HDD|Storage)\b/i,
  )
  const ram = ramMatch ? `${ramMatch[1]}GB RAM` : ''
  let storage = ''
  if (storageMatch) {
    const n = Number(storageMatch[1])
    const unit = storageMatch[2].toUpperCase()
    const kind = /hdd/i.test(storageMatch[3]) ? 'HDD' : /nvme/i.test(storageMatch[0]) ? 'NVMe SSD' : storageMatch[3]
    storage = unit === 'TB' ? `${n}TB ${kind}` : `${n}GB ${kind}`
  }
  return { ram, storage }
}

function configBits(name: string): string[] {
  const parsed = parseSpecsString(name)
  const explicit = ramStorageFromName(name)
  const cpu = [parsed.processorGeneration, parsed.processor].filter(Boolean).join(' ').trim()
    || extraCpu(name)
    || ''
  const ram = explicit.ram || (parsed.totalRamGb && parsed.totalRamGb > 0 ? `${parsed.totalRamGb}GB RAM` : '')
  let storage = explicit.storage
  if (!storage && parsed.primaryStorageGb && parsed.primaryStorageGb > 0) {
    const gb = parsed.primaryStorageGb
    const size = gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`
    const kind = String(parsed.storageType || 'SSD').replace(/nvme ssd/i, 'NVMe SSD')
    storage = `${size} ${kind}`
  }
  return [cpu, ram, storage].filter(Boolean)
}

function displayClause(facts: LaptopDisplayFacts): string | null {
  if (!facts.screenSize) return null
  const bits = [`${facts.screenSize}-inch`]
  if (facts.resolution) bits.push(facts.resolution)
  if (facts.touch === true) bits.push('multi-touch')
  else if (facts.touch === false) bits.push('non-touch')
  if (facts.form === 'x360 convertible') bits.push('x360 convertible')
  else if (facts.form === '2-in-1') bits.push('2-in-1')
  bits.push('display')
  return bits.join(' ')
}

function chassisForTitle(name: string): VerifiedChassis | null {
  return verifiedChassisFor(name)
}

export function buildLaptopSalesDescription(name: string): string | null {
  const title = String(name || '').replace(/\s+/g, ' ').trim()
  if (!title || shouldSkipLaptopCatalogRow(title)) return null
  const sku = skuOverrideFor(title)
  if (sku) return sku.slice(0, 1000)
  const facts = inferLaptopDisplay(title)
  const chassis = chassisForTitle(title)
  if (chassis?.ports && !facts.ports) facts.ports = chassis.ports
  const display = displayClause(facts)
  const parts = [...configBits(title)]
  if (display) parts.push(display)
  if (facts.graphics) parts.push(facts.graphics)
  if (facts.ports) parts.push(facts.ports)
  if (parts.length < 2) return null
  let text = parts.join(', ')
  if (!/[.!?]$/.test(text)) text += '.'
  return text.slice(0, 1000)
}

export function planLaptopDescriptionUpdate(opts: {
  name: string
  description?: string | null
}): { action: 'skip-detailed' | 'skip-not-laptop' | 'skip-unchanged' | 'skip-insufficient' | 'update'; next: string | null } {
  if (shouldSkipLaptopCatalogRow(opts.name)) {
    return { action: 'skip-not-laptop', next: null }
  }
  if (skuOverrideFor(opts.name)) {
    const next = buildLaptopSalesDescription(opts.name)
    const current = String(opts.description || '').replace(/\s+/g, ' ').trim()
    if (next && current && current.toLowerCase() === next.toLowerCase()) {
      return { action: 'skip-unchanged', next }
    }
    return { action: 'update', next }
  }
  if (isDetailedLaptopDescription(opts.description)) {
    return { action: 'skip-detailed', next: String(opts.description).trim() }
  }
  const next = buildLaptopSalesDescription(opts.name)
  const current = String(opts.description || '').replace(/\s+/g, ' ').trim()
  if (!next) {
    if (current && !isDetailedLaptopDescription(current)) {
      return { action: 'update', next: '' }
    }
    return { action: 'skip-insufficient', next: null }
  }
  if (current && current.toLowerCase() === next.toLowerCase()) {
    return { action: 'skip-unchanged', next }
  }
  return { action: 'update', next }
}
