/**
 * Slim lists: heavy fields of finished records stay on the server.
 *
 * A finished repair's QC checklist, status log and diagnosis log, and a
 * completed release's signature images, are only ever displayed — and only
 * when that one record is opened. Lists leave them out (GET /api/store) and
 * the record view loads the full row on open (GET /api/store/record).
 *
 * The danger is a save: the browser writes whole records back, so a slimmed
 * row must never replace the stored fields. A slimmed row carries a marker
 * naming the fields it lacks, and every save restores them from the stored
 * copy — `keep` takes the stored value outright (no action edits these on a
 * finished record); `append` keeps the stored log and adds entries the
 * browser appended (a status change on a collected job adds to the log).
 *
 * Pure — shared by the API routes and the browser.
 */

export const SLIM_MARK = '__slim'

type Row = Record<string, unknown>
type FieldRule = 'keep' | 'append'
type SlimRule = {
  fields: Record<string, FieldRule>
  /** Only rows in a final state are slimmed; active ones are edited and must stay whole. */
  applies: (row: Row) => boolean
}

const FINISHED_REPAIR = new Set(['delivered', 'collected', 'closed', 'cancelled', 'returned', 'retained', 'unrepairable'])
const FINISHED_RELEASE = new Set(['released', 'voided'])

export const SLIM_RULES: Record<string, SlimRule> = {
  deed_repairs_v2: {
    fields: { qcItems: 'keep', statusHistory: 'append', diagnosisHistory: 'keep' },
    applies: row => FINISHED_REPAIR.has(String(row.status ?? '')),
  },
  deed_outboundReleases: {
    fields: { receiverSigData: 'keep', releaserSigData: 'keep', customerAckSigData: 'keep' },
    applies: row => FINISHED_RELEASE.has(String(row.status ?? '')),
  },
}

const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)

export function isSlimRow(row: unknown): boolean {
  return isRow(row) && Array.isArray(row[SLIM_MARK])
}

/** Value a slimmed field is replaced with: same type, no content (code reads `.length`). */
function emptyLike(value: unknown): unknown {
  return Array.isArray(value) ? [] : undefined
}

function heavy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return typeof value === 'string' ? value.length > 0 : value != null
}

/** The list form of a collection: finished rows without their heavy fields. */
export function slimCollection(key: string, rows: unknown): unknown {
  const rule = SLIM_RULES[key]
  if (!rule || !Array.isArray(rows)) return rows
  return rows.map(row => {
    if (!isRow(row) || isSlimRow(row) || !rule.applies(row)) return row
    const stripped = Object.keys(rule.fields).filter(field => heavy(row[field]))
    if (!stripped.length) return row
    const out: Row = { ...row, [SLIM_MARK]: stripped }
    for (const field of stripped) {
      const empty = emptyLike(row[field])
      if (empty === undefined) delete out[field]
      else out[field] = empty
    }
    return out
  })
}

const sameEntry = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Before a save: put back what slimmed rows left out, from the stored copy.
 * Unmarked rows pass through untouched; the marker never reaches storage.
 */
export function restoreSlimRows(key: string, stored: unknown, incoming: unknown): unknown {
  const rule = SLIM_RULES[key]
  if (!rule || !Array.isArray(incoming) || !incoming.some(isSlimRow)) return incoming
  const storedById = new Map<string, Row>()
  if (Array.isArray(stored)) for (const row of stored) if (isRow(row) && row.id != null) storedById.set(String(row.id), row)

  return incoming.map(row => {
    if (!isSlimRow(row)) return row
    const r = row as Row
    const out: Row = { ...r }
    delete out[SLIM_MARK]
    const prev = r.id != null ? storedById.get(String(r.id)) : undefined
    for (const field of r[SLIM_MARK] as string[]) {
      const mode = rule.fields[field]
      if (!mode) continue
      const storedValue = prev?.[field]
      if (mode === 'keep') {
        if (storedValue === undefined) delete out[field]
        else out[field] = storedValue
        continue
      }
      // append: the stored log plus anything this browser added to it.
      const base = Array.isArray(storedValue) ? storedValue : []
      const added = Array.isArray(r[field]) ? (r[field] as unknown[]).filter(entry => !base.some(s => sameEntry(s, entry))) : []
      out[field] = [...base, ...added]
    }
    return out
  })
}
