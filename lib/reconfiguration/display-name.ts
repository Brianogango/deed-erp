/**
 * Generate structured device display names from configuration attributes.
 * Example: Lenovo ThinkPad T14 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD
 */

import type { DeviceConfigFields, RamCompositionEntry } from './types'

export function formatRamComposition(entries: RamCompositionEntry[]): string {
  if (!entries.length) return ''
  const parts = entries.map(e => {
    const tag = e.removable ? '' : ' (onboard)'
    return `${e.capacityGb}GB${tag}`
  })
  return parts.join(' + ')
}

export function buildDisplayName(params: {
  brand?: string | null
  model?: string | null
  productName?: string | null
  config: Pick<
    DeviceConfigFields,
    | 'processor'
    | 'processorGeneration'
    | 'totalRamGb'
    | 'ramComposition'
    | 'primaryStorageGb'
    | 'storageType'
  >
}): string {
  const brandModel = [params.brand, params.model].filter(Boolean).join(' ').trim()
  const base = brandModel || String(params.productName || 'Device').trim()

  const cpuBits: string[] = []
  if (params.config.processorGeneration) cpuBits.push(params.config.processorGeneration)
  if (params.config.processor) cpuBits.push(params.config.processor)
  const cpu = cpuBits.join(' ').trim()

  const ram =
    params.config.totalRamGb > 0
      ? `${params.config.totalRamGb}GB RAM`
      : ''

  const storageType = (params.config.storageType || 'SSD').toUpperCase().includes('HDD')
    ? 'HDD'
    : 'SSD'
  const storage =
    params.config.primaryStorageGb && params.config.primaryStorageGb > 0
      ? `${params.config.primaryStorageGb}GB ${storageType}`
      : ''

  const attrs = [cpu, ram, storage].filter(Boolean).join(', ')
  return attrs ? `${base} - ${attrs}` : base
}

/** Compact free-text specs string for delivery notes / legacy serial.specs field. */
export function buildSpecsString(config: Pick<
  DeviceConfigFields,
  'processor' | 'processorGeneration' | 'totalRamGb' | 'primaryStorageGb' | 'storageType' | 'ramComposition'
>): string {
  const parts: string[] = []
  if (config.processorGeneration || config.processor) {
    parts.push([config.processorGeneration, config.processor].filter(Boolean).join(' '))
  }
  if (config.totalRamGb > 0) {
    const composition = formatRamComposition(config.ramComposition || [])
    parts.push(composition ? `${config.totalRamGb}GB RAM (${composition})` : `${config.totalRamGb}GB RAM`)
  }
  if (config.primaryStorageGb && config.primaryStorageGb > 0) {
    const t = (config.storageType || 'SSD').toUpperCase().includes('HDD') ? 'HDD' : 'SSD'
    parts.push(`${config.primaryStorageGb}GB ${t}`)
  }
  return parts.join(', ')
}

const TYPICAL_RAM_GB = new Set([2, 4, 6, 8, 12, 16, 20, 24, 32, 36, 40, 48, 64, 96, 128])

function toGb(n: number, unit: string): number {
  return /TB/i.test(unit) ? Math.round(n * 1024) : n
}

function storageTypeFrom(text: string): 'HDD' | 'NVMe SSD' | 'SSD' {
  if (/\bhdd\b/i.test(text)) return 'HDD'
  if (/\bnvme\b/i.test(text)) return 'NVMe SSD'
  return 'SSD'
}

/**
 * Best-effort parse of a catalog title or free-text specs into RAM / storage.
 * Accepts the live naming styles (8GB RAM, 256GB SSD; 8G 256GB; 1TB; M.2 NVMe).
 * Does not invent stick/drive count.
 */
export function parseSpecsString(specs: string | null | undefined): Partial<DeviceConfigFields> {
  const raw = String(specs || '').trim()
  if (!raw) return { totalRamGb: 0, ramComposition: [], displayName: '' }

  // Screen size is not capacity ("13\"", "15.6 inch").
  const text = raw.replace(/\b\d+(?:\.\d+)?\s*(?:["”]|inch(?:es)?)\b/gi, ' ')

  const genMatch = text.match(/(\d+(?:st|nd|rd|th)\s*Gen)/i)
  const cpuMatch = text.match(/(Intel\s+Core\s+i[3579]|AMD\s+Ryzen\s+\d+|Apple\s+M\d+)/i)

  let primaryStorageGb: number | null = null
  let storageType: string | null = null

  const storageMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(TB|GB)\s*(?:(?:M\.?2|PCI-?E|PCIe|NVMe|SATA|[\w.-]+)\s+){0,6}(SSD|HDD|NVMe|Storage)\b/i,
  )
  if (storageMatch) {
    primaryStorageGb = toGb(Number(storageMatch[1]), storageMatch[2])
    storageType = storageTypeFrom(storageMatch[0])
  } else {
    const tbMatch = text.match(/(\d+(?:\.\d+)?)\s*TB\b/i)
    if (tbMatch) {
      primaryStorageGb = toGb(Number(tbMatch[1]), 'TB')
      storageType = 'SSD'
    }
  }

  let totalRamGb = 0
  const ramExplicit = text.match(/(\d+)\s*G(?:B)?\s*(?:RAM|DDR\d*|SO-?DIMM)/i)
  if (ramExplicit) {
    totalRamGb = Number(ramExplicit[1])
  } else {
    const pair = text.match(/(\d+)\s*G(?:B)?\s*[/|, ]+\s*(\d+)\s*(TB|GB|G)?/i)
    if (pair) {
      totalRamGb = Number(pair[1])
      if (primaryStorageGb == null) {
        primaryStorageGb = toGb(Number(pair[2]), pair[3] || 'GB')
        storageType = storageType || 'SSD'
      }
    } else {
      const gbValues = [...text.matchAll(/\b(\d+)\s*GB\b/gi)].map(m => Number(m[1]))
      const ramHit = gbValues.find(n => TYPICAL_RAM_GB.has(n) && n !== primaryStorageGb)
      if (ramHit) totalRamGb = ramHit
    }
  }

  return {
    totalRamGb,
    ramComposition: [],
    primaryStorageGb,
    storageType,
    processor: cpuMatch?.[1] || null,
    processorGeneration: genMatch?.[1] || null,
    displayName: raw,
  }
}
