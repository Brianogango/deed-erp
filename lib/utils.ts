export const uid = () => crypto.randomUUID()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUUID = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
export const now = () => new Date().toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt.toISOString().slice(0, 10)
}

