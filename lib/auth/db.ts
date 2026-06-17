import 'server-only'
import { Pool } from 'pg'

let _pool: Pool | null = null

function sslConfig(connectionString: string) {
  const sslMode = process.env.PGSSLMODE ?? process.env.DATABASE_SSL
  if (sslMode === 'disable' || sslMode === 'false') return false
  if (sslMode === 'require' || sslMode === 'true') return { rejectUnauthorized: false }

  // Local development databases usually do not have TLS enabled.
  if (/localhost|127\.0\.0\.1|host\.docker\.internal/.test(connectionString)) return false
  return { rejectUnauthorized: false }
}

function getPool(): Pool {
  if (!_pool) {
    const connectionString =
      process.env.deed_erp_POSTGRES_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL

    if (!connectionString) {
      throw new Error(
        'No database URL found. Set DATABASE_URL in your .env file.'
      )
    }
    _pool = new Pool({ connectionString, ssl: sslConfig(connectionString) })
  }
  return _pool
}

// Tagged template literal compatible with the existing sql`` usage across the codebase
export const sql = async (
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<{ rows: Record<string, unknown>[] }> => {
  const query = strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? `$${i + 1}` : ''),
    ''
  )
  const pool = getPool()
  const started = Date.now()
  const result = await pool.query(query, values as unknown[])
  const elapsed = Date.now() - started
  const threshold = Number(process.env.SLOW_QUERY_MS ?? 250)
  if (elapsed > threshold) {
    console.warn('[slow-query]', JSON.stringify({
      elapsedMs: elapsed,
      rows: result.rowCount,
      query: query.replace(/\s+/g, ' ').trim().slice(0, 500),
    }))
  }
  return { rows: result.rows }
}
