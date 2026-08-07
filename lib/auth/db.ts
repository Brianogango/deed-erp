import 'server-only'
import { Pool, type PoolClient } from 'pg'

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

/**
 * Run `fn` inside a single Postgres transaction on one dedicated connection.
 * Needed for anything that must hold state across statements on the same
 * session — e.g. a transaction-scoped advisory lock (pg_advisory_xact_lock),
 * which only blocks other sessions while THIS transaction is open.
 */
export async function withDbTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
