/**
 * Newest document first, the way Odoo lists them: by date, then by number,
 * highest first (INV/2026/0429 before INV/2026/0428). Numbers compare as
 * numbers within a series; different series on one day (INV and POS) keep
 * their series together, as Odoo's "name desc" does.
 */
type Doc = { date?: string | null; ref?: string | null }

const day = (d: Doc) => String(d.date ?? '').slice(0, 10)
const parts = (ref: string) => {
  const m = ref.match(/^(.*?)(\d+)\s*$/)
  return m ? { series: m[1], n: Number(m[2]) } : { series: ref, n: -1 }
}

export function newestDocumentFirst(a: Doc, b: Doc): number {
  const byDay = day(b).localeCompare(day(a))
  if (byDay) return byDay
  const pa = parts(String(a.ref ?? ''))
  const pb = parts(String(b.ref ?? ''))
  return pb.series.localeCompare(pa.series) || pb.n - pa.n
}
