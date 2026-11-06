/**
 * Machines that come into Refurbishment without a known serial or specs
 * (dead, or too broken to read). They get an internal tag, e.g.
 * UNK-261106-003, printed on a sticker; it is the unit's serial until the
 * technician finds the real one. Pure helpers, shared by screens and server.
 */

type SerialLike = { id?: string; serial?: string; status?: string; location?: string; identityPending?: boolean; intakeTag?: string }

const TAG_RE = /^UNK-(\d{6})-(\d{3,})$/

/** The next tags for today, never reusing one already on a serial. */
export function nextIntakeTags(existing: SerialLike[], count: number, at: Date = new Date()): string[] {
  // Kenya date, so a day's tags share a prefix.
  const d = new Date(at.getTime() + 3 * 3600_000)
  const day = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  let max = 0
  for (const s of existing) {
    for (const value of [s.serial, s.intakeTag]) {
      const m = TAG_RE.exec(String(value ?? ''))
      if (m && m[1] === day) max = Math.max(max, Number(m[2]))
    }
  }
  return Array.from({ length: Math.max(0, count) }, (_, i) => `UNK-${day}-${String(max + i + 1).padStart(3, '0')}`)
}

export const isIntakeTag = (value: unknown) => TAG_RE.test(String(value ?? '').trim())

/** Still waiting for its real serial and model. */
export const awaitingIdentification = (s: Pick<SerialLike, 'identityPending' | 'serial'> | null | undefined) =>
  !!s && (s.identityPending === true || isIntakeTag(s.serial))

const OUT_OF_STOCK = new Set(['sold', 'written_off', 'returned'])

/**
 * What a real serial typed at identification matches. A machine we sold or
 * wrote off before and that came back is the same unit: its old record is
 * taken over, so its history stays with it. One still in stock cannot be in
 * two places.
 */
export function classifySerialMatch(
  existing: SerialLike[],
  serial: string,
  selfId: string,
): { kind: 'new' } | { kind: 'returning'; match: SerialLike } | { kind: 'in_stock'; match: SerialLike } {
  const key = serial.trim().toLowerCase()
  const match = existing.find(s => s.id !== selfId && String(s.serial ?? '').trim().toLowerCase() === key)
  if (!match) return { kind: 'new' }
  if (OUT_OF_STOCK.has(String(match.status)) || match.location === 'customer') return { kind: 'returning', match }
  return { kind: 'in_stock', match }
}

/** Unit costs for a batch: given ones kept, the rest share what is left of the total. */
export function splitUnitCosts(total: number, given: Array<number | null | undefined>): number[] {
  const fixed = given.reduce<number>((s, v) => s + (Number.isFinite(Number(v)) && v != null && v !== ('' as unknown) ? Math.max(0, Number(v)) : 0), 0)
  const open = given.filter(v => !(Number.isFinite(Number(v)) && v != null && v !== ('' as unknown))).length
  const each = open ? Math.max(0, total - fixed) / open : 0
  return given.map(v => Math.round(((Number.isFinite(Number(v)) && v != null && v !== ('' as unknown)) ? Math.max(0, Number(v)) : each) * 100) / 100)
}

/**
 * Parts kept from a machine that cannot be repaired. Together they can carry
 * at most what the machine cost; above that the values are scaled down (stock
 * is never valued above cost). Returns each part's value per unit.
 */
export function harvestValues(machineCost: number, parts: Array<{ qty: number; unitValue: number }>): number[] {
  const asked = parts.reduce((s, p) => s + Math.max(0, p.qty) * Math.max(0, p.unitValue), 0)
  const cap = Math.max(0, machineCost)
  const scale = asked > cap ? (asked ? cap / asked : 0) : 1
  return parts.map(p => Math.floor(Math.max(0, p.unitValue) * scale * 100) / 100)
}

/** Products unknown machines are filed under until identified. */
export const PLACEHOLDER_KINDS = [
  { id: 'laptop', label: 'Laptop', category: 'Laptops' },
  { id: 'desktop', label: 'Desktop', category: 'Desktops' },
  { id: 'all_in_one', label: 'All-in-one', category: 'All-in-One' },
  { id: 'monitor', label: 'Monitor', category: 'Monitors' },
  { id: 'other', label: 'Other device', category: 'Other' },
] as const
export type PlaceholderKind = (typeof PLACEHOLDER_KINDS)[number]['id']

export const placeholderProductName = (kind: PlaceholderKind) =>
  `${PLACEHOLDER_KINDS.find(k => k.id === kind)?.label ?? 'Device'} — unidentified`

export const isPlaceholderProductName = (name: unknown) => / — unidentified$/.test(String(name ?? ''))
