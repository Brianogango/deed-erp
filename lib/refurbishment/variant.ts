/**
 * When a machine's specs differ from the product it is linked to: what
 * differs, and the name of the variant to create ("Model - specs").
 *
 * Pure.
 */
import { parseSpecsString } from '@/lib/reconfiguration/display-name'

export type SpecDifference = { label: string; machine: string; product: string }

/** "8GB RAM 256GB SSD" reads as one storage size to the parser; split the parts. */
const separate = (text: string) => text.replace(/\b(RAM|DDR\d*|Gen)\b\s+(?=\d)/gi, '$1, ')

const gb = (n: number | null | undefined) => (n && n > 0 ? (n >= 1024 && n % 1024 === 0 ? `${n / 1024}TB` : `${n}GB`) : '')

/** RAM, storage, processor and generation that are known on both sides and differ. */
export function specDifferences(machineSpecs: string, productText: string): SpecDifference[] {
  if (!machineSpecs.trim() || !productText.trim()) return []
  const m = parseSpecsString(separate(machineSpecs))
  const p = parseSpecsString(separate(productText))
  const out: SpecDifference[] = []
  const cmp = (label: string, a: string, b: string) => {
    if (a && b && a.toLowerCase() !== b.toLowerCase()) out.push({ label, machine: a, product: b })
  }
  cmp('RAM', gb(m.totalRamGb), gb(p.totalRamGb))
  cmp('Storage', gb(m.primaryStorageGb), gb(p.primaryStorageGb))
  cmp('Processor', String(m.processor ?? ''), String(p.processor ?? ''))
  cmp('Generation', String(m.processorGeneration ?? '').replace(/\s+/g, ' '), String(p.processorGeneration ?? '').replace(/\s+/g, ' '))
  return out
}

const SPEC_WORD = /^(?:i[3579](?:-\w+)?|intel|amd|ryzen|core|celeron|pentium|xeon|apple|m[1-4]|\d+(?:\.\d+)?\s*(?:gb|tb|ghz)\b.*|\d+(?:st|nd|rd|th)|\d+gb\/.*|#\d+|\(.*)$/i

/**
 * The model part of a product name: what comes before its specs.
 * "HP EliteBook 840 G5 - i5…" and "HP EliteBook 840 G6 i5 16GB/512GB #15"
 * both give the model alone.
 */
export function modelOfProductName(name: string): string {
  const s = String(name ?? '').trim()
  const head = (s.split(/\s+[-–—|,]\s+/)[0] || s).trim()
  const words = head.split(/\s+/)
  const cut = words.findIndex((w, i) => i > 0 && SPEC_WORD.test(w))
  return (cut > 0 ? words.slice(0, cut) : words).join(' ').trim() || s
}

/** "Model - specs": the variant's name. */
export function variantName(baseName: string, specs: string): string {
  const model = modelOfProductName(baseName)
  const tidy = String(specs ?? '').replace(/\s+/g, ' ').replace(/^[-–—,\s]+|[-–—,\s]+$/g, '').trim()
  return tidy ? `${model} - ${tidy}` : model
}
