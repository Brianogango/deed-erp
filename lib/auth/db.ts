import 'server-only'
import { createPool, type VercelPool } from '@vercel/postgres'

let _pool: VercelPool | null = null

function getPool(): VercelPool {
  if (!_pool) {
    const connectionString =
      process.env.deed_erp_POSTGRES_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL

    if (!connectionString) {
      throw new Error(
        'No database URL found. Add DATABASE_URL to your Vercel project environment variables ' +
        '(Settings → Environment Variables) or to your local .env file.'
      )
    }

    _pool = createPool({ connectionString })
  }
  return _pool
}

// Fully lazy sql tagged-template export — nothing runs at module load time.
// The pool is only created when the first query is actually executed.
export const sql: VercelPool['sql'] = (...args: Parameters<VercelPool['sql']>) =>
  (getPool().sql as VercelPool['sql'])(...args)
