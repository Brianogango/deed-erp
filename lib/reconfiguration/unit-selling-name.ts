/**
 * The name customers and staff see for ONE serialized unit after a RAM/SSD
 * change. Catalog Product.name stays on the SKU (other units may still be
 * 16GB). This helper prefers the unit's live specs / displayName, and rewrites
 * stale RAM/SSD clauses in a catalog-style title when those are all we have.
 */

import { buildDisplayName, parseSpecsString } from './display-name'

const STORAGE_CLAUSE =
  /(\d+(?:\.\d+)?)\s*(TB|GB)\s*(NVMe\s*)?(SSD|HDD|NVMe)\b/gi
const RAM_CLAUSE = /(\d+)\s*GB\s*(DDR\d?\s*)?RAM\b/gi
/** Title style leftover after storage is rewritten: "i7 16GB 512GB SSD". */
const BARE_GB = /\b(\d+)\s*GB\b/i

export function storageTypeLabel(storageType?: string | null): 'SSD' | 'HDD' | 'NVMe' {
  const raw = String(storageType || 'SSD')
  if (/nvme/i.test(raw)) return 'NVMe'
  if (/hdd/i.test(raw)) return 'HDD'
  return 'SSD'
}

export function formatStorageGb(gb: number, storageType?: string | null): string {
  const type = storageTypeLabel(storageType)
  if (gb >= 1024 && gb % 1024 === 0) return `${gb / 1024}TB ${type}`
  return `${gb}GB ${type}`
}

/**
 * Strip RAM/SSD clauses from a catalog title so a label can print those
 * values from the unit config instead of repeating a stale 16GB in the name.
 */
export function catalogBaseName(productName?: string | null): string {
  return String(productName || '')
    .replace(STORAGE_CLAUSE, ' ')
    .replace(RAM_CLAUSE, ' ')
    // Title-style leftover after the clauses above: "i7 16GB"
    .replace(/\b\d+\s*GB\b/gi, ' ')
    .replace(/\s*[-,/|]+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Rewrite RAM and/or storage figures inside a free-text name without touching
 * brand, model, or CPU. Used when the catalog title itself embeds capacities.
 */
export function rewriteUnitCapacitiesInText(
  text: string,
  ramGb?: number | null,
  storageGb?: number | null,
  storageType?: string | null,
): string {
  let out = String(text || '').replace(/\s+/g, ' ').trim()
  if (!out) return out

  if (storageGb != null && storageGb > 0) {
    const label = formatStorageGb(storageGb, storageType)
    if (STORAGE_CLAUSE.test(out)) {
      STORAGE_CLAUSE.lastIndex = 0
      out = out.replace(STORAGE_CLAUSE, label)
    }
    STORAGE_CLAUSE.lastIndex = 0
  }

  if (ramGb != null && ramGb > 0) {
    if (RAM_CLAUSE.test(out)) {
      RAM_CLAUSE.lastIndex = 0
      out = out.replace(RAM_CLAUSE, `${ramGb}GB RAM`)
    } else if (BARE_GB.test(out)) {
      out = out.replace(BARE_GB, `${ramGb}GB`)
    } else {
      out = `${out} ${ramGb}GB RAM`.trim()
    }
    RAM_CLAUSE.lastIndex = 0
  }

  return out.replace(/\s{2,}/g, ' ').trim()
}

/** True when a title was concatenated (old 16GB clause plus the new 8GB clause). */
export function looksLikeConcatenatedSpecs(text: string): boolean {
  const ram = [...String(text || '').matchAll(new RegExp(RAM_CLAUSE.source, 'gi'))].length
  const storage = [...String(text || '').matchAll(new RegExp(STORAGE_CLAUSE.source, 'gi'))].length
  return ram > 1 || storage > 1
}

/**
 * One clean customer-facing unit title after RAM/SSD change.
 * Prefers rewriting the catalog title in place so we do not append
 * "8GB RAM, 256GB SSD" onto a name that still says 16GB.
 */
export function cleanUnitDisplayName(opts: {
  productName?: string | null
  displayName?: string | null
  totalRamGb?: number | null
  primaryStorageGb?: number | null
  storageType?: string | null
  processor?: string | null
  processorGeneration?: string | null
  brand?: string | null
  model?: string | null
}): string {
  const ramGb = Number(opts.totalRamGb) || 0
  const storageGb = Number(opts.primaryStorageGb) || 0
  const catalog = String(opts.productName || '').trim()

  if (catalog) {
    const rewritten = rewriteUnitCapacitiesInText(
      catalog,
      ramGb || null,
      storageGb || null,
      opts.storageType,
    )
    if (!looksLikeConcatenatedSpecs(rewritten) && (ramGb <= 0 || rewritten.includes(`${ramGb}GB`))) {
      return rewritten
    }
  }

  const fromLive = rewriteUnitCapacitiesInText(
    String(opts.displayName || '').trim(),
    ramGb || null,
    storageGb || null,
    opts.storageType,
  )
  if (fromLive && !looksLikeConcatenatedSpecs(fromLive) && (ramGb <= 0 || fromLive.includes(`${ramGb}GB`))) {
    return fromLive
  }

  return buildDisplayName({
    brand: opts.brand,
    model: opts.model,
    productName: catalogBaseName(catalog) || catalog || 'Device',
    config: {
      processor: opts.processor || null,
      processorGeneration: opts.processorGeneration || null,
      totalRamGb: ramGb,
      ramComposition: [],
      primaryStorageGb: storageGb || null,
      storageType: opts.storageType || 'SSD',
    },
  })
}

/** Keep invoice "Name ×1" suffixes when rewriting a line description. */
export function applyUnitNameToLineDescription(
  existing: string | null | undefined,
  unitName: string,
): string {
  const prev = String(existing || '').trim()
  const qty = prev.match(/×\s*(\d+)\s*$/)
  return qty ? `${unitName} ×${qty[1]}` : unitName
}

export function unitSellingName(opts: {
  productName?: string | null
  specs?: string | null
  displayName?: string | null
  totalRamGb?: number | null
  primaryStorageGb?: number | null
  storageType?: string | null
  processor?: string | null
  processorGeneration?: string | null
}): string {
  const ramGb = Number(opts.totalRamGb) || 0
  const storageGb = Number(opts.primaryStorageGb) || 0
  const parsed = parseSpecsString(opts.specs || opts.displayName || '')
  const liveRam = ramGb || parsed.totalRamGb || 0
  const liveStorage = storageGb || parsed.primaryStorageGb || 0
  const liveType = opts.storageType || parsed.storageType || 'SSD'

  const structured = String(opts.displayName || '').trim()
  if (structured && looksLikeConcatenatedSpecs(structured)) {
    return cleanUnitDisplayName({
      ...opts,
      totalRamGb: liveRam,
      primaryStorageGb: liveStorage,
      storageType: liveType,
    })
  }
  if (structured) {
    return rewriteUnitCapacitiesInText(structured, liveRam || null, liveStorage || null, liveType)
  }

  const catalog = String(opts.productName || '').trim()
  if (catalog && (liveRam || liveStorage)) {
    STORAGE_CLAUSE.lastIndex = 0
    RAM_CLAUSE.lastIndex = 0
    const hasCapacity =
      STORAGE_CLAUSE.test(catalog) || RAM_CLAUSE.test(catalog) || BARE_GB.test(catalog)
    STORAGE_CLAUSE.lastIndex = 0
    RAM_CLAUSE.lastIndex = 0
    if (hasCapacity) {
      return rewriteUnitCapacitiesInText(catalog, liveRam || null, liveStorage || null, liveType)
    }
    return buildDisplayName({
      productName: catalogBaseName(catalog) || catalog,
      config: {
        processor: opts.processor || parsed.processor,
        processorGeneration: opts.processorGeneration || parsed.processorGeneration,
        totalRamGb: liveRam,
        ramComposition: [],
        primaryStorageGb: liveStorage || null,
        storageType: liveType,
      },
    })
  }

  const specs = String(opts.specs || '').trim()
  if (specs) {
    return rewriteUnitCapacitiesInText(specs, liveRam || null, liveStorage || null, liveType)
  }

  return catalog || 'Device'
}
