import 'server-only'
import { Pool } from 'pg'

let _pool: Pool | null = null

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

    _pool = new Pool({ connectionString, ssl: false })
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
  const result = await pool.query(query, values as unknown[])
  return { rows: result.rows }
}
