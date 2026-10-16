/**
 * Compare a physical count (a list of serial numbers) with the serial register.
 *
 * - "missing": serials the system holds as unsold that are NOT on the count.
 * - "notInSystem": counted serials the system does not know (after allowing for look-alike
 *   characters: O/0, I/1, S/5, B/8 typed the wrong way round on a count sheet).
 * - "soldInSystem": counted serials the system says were sold.
 * A look-alike match is reported separately so a person can confirm it, never silently accepted.
 */
type Rec = Record<string, any>

export interface CountMissing { serial: string; productName: string; status: string; location: string }
export interface CountedRow { counted: string; serial?: string; productName?: string; status?: string; location?: string }
export interface SerialCountReport {
  summary: { counted: number; uniqueCounted: number; systemUnsold: number; missing: number; notInSystem: number; soldInSystem: number; lookAlike: number; duplicates: number }
  missing: CountMissing[]
  notInSystem: CountedRow[]
  soldInSystem: CountedRow[]
  lookAlike: CountedRow[]
  duplicates: string[]
}

const normalize = (value: unknown) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
/** Characters that get confused on paper: O/0, I/1/L, S/5, B/8, Z/2. */
const loose = (value: string) => value.replace(/[O]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2')

const isSold = (status: unknown) => String(status ?? '').toLowerCase() === 'sold'

export function compareSerialCount(input: { counted: string[]; serials: Rec[]; products?: Rec[] }): SerialCountReport {
  const productName = new Map((input.products ?? []).map(p => [String(p.id), String(p.name ?? '')]))
  const system = input.serials
    .map(s => ({
      key: normalize(s.serial),
      serial: String(s.serial ?? ''),
      productName: productName.get(String(s.productId)) || String(s.productName ?? ''),
      status: String(s.status ?? ''),
      location: String(s.location ?? ''),
    }))
    .filter(s => s.key)
  const byKey = new Map(system.map(s => [s.key, s]))
  const byLoose = new Map<string, typeof system>()
  for (const s of system) {
    const k = loose(s.key)
    byLoose.set(k, [...(byLoose.get(k) ?? []), s])
  }

  const counted = input.counted.map(normalize).filter(Boolean)
  const seen = new Set<string>()
  const duplicates: string[] = []
  const uniqueCounted: string[] = []
  for (const c of counted) {
    if (seen.has(c)) { if (!duplicates.includes(c)) duplicates.push(c); continue }
    seen.add(c)
    uniqueCounted.push(c)
  }

  const matchedSystemKeys = new Set<string>()
  const notInSystem: CountedRow[] = []
  const soldInSystem: CountedRow[] = []
  const lookAlike: CountedRow[] = []
  for (const c of uniqueCounted) {
    const exact = byKey.get(c)
    if (exact) {
      matchedSystemKeys.add(exact.key)
      if (isSold(exact.status)) soldInSystem.push({ counted: c, serial: exact.serial, productName: exact.productName, status: exact.status, location: exact.location })
      continue
    }
    const near = (byLoose.get(loose(c)) ?? []).filter(s => !seen.has(s.key))
    if (near.length === 1) {
      matchedSystemKeys.add(near[0].key)
      lookAlike.push({ counted: c, serial: near[0].serial, productName: near[0].productName, status: near[0].status, location: near[0].location })
      continue
    }
    notInSystem.push({ counted: c })
  }

  const unsold = system.filter(s => !isSold(s.status))
  const missing = unsold
    .filter(s => !matchedSystemKeys.has(s.key))
    .map(s => ({ serial: s.serial, productName: s.productName, status: s.status, location: s.location }))
    .sort((a, b) => a.productName.localeCompare(b.productName) || a.serial.localeCompare(b.serial))

  return {
    summary: {
      counted: counted.length, uniqueCounted: uniqueCounted.length, systemUnsold: unsold.length,
      missing: missing.length, notInSystem: notInSystem.length, soldInSystem: soldInSystem.length,
      lookAlike: lookAlike.length, duplicates: duplicates.length,
    },
    missing, notInSystem, soldInSystem, lookAlike, duplicates,
  }
}
