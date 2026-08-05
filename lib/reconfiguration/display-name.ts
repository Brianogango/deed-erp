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

/**
 * Best-effort parse of legacy free-text specs into structured fields.
 * Does not invent installed modules — marks composition empty when unknown.
 */
export function parseSpecsString(specs: string | null | undefined): Partial<DeviceConfigFields> {
  const text = String(specs || '').trim()
  if (!text) return { totalRamGb: 0, ramComposition: [], displayName: '' }

  const ramMatch = text.match(/(\d+)\s*GB\s*RAM/i)
  const storageMatch = text.match(/(\d+)\s*GB\s*(NVMe\s*)?(SSD|HDD)/i)
  const genMatch = text.match(/(\d+(?:st|nd|rd|th)\s*Gen)/i)
  const cpuMatch = text.match(/(Intel\s+Core\s+i[3579]|AMD\s+Ryzen\s+\d+|Apple\s+M\d+)/i)

  const totalRamGb = ramMatch ? Number(ramMatch[1]) : 0
  const primaryStorageGb = storageMatch ? Number(storageMatch[1]) : null
  const storageType = storageMatch
    ? (storageMatch[2] ? 'NVMe SSD' : storageMatch[3].toUpperCase())
    : null

  return {
    totalRamGb,
    primaryStorageGb,
    storageType,
    processor: cpuMatch?.[1] || null,
    processorGeneration: genMatch?.[1] || null,
    ramComposition: [],
    displayName: text,
  }
}
