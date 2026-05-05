import 'server-only'
import { createPool, type VercelPool } from '@vercel/postgres'

// Lazy pool — created on first use, NOT at module-load time.
// This prevents `next build` from throwing when env vars aren't available
// during the static-analysis phase (page-data collection).
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

// Use a Proxy so that `pool.sql`, `pool.query`, etc. are all lazily resolved.
const pool = new Proxy({} as VercelPool, {
  get(_target, prop: string | symbol) {
    const p = getPool() as unknown as Record<string | symbol, unknown>
    const val = p[prop]
    return typeof val === 'function' ? val.bind(getPool()) : val
  },
})

export const sql = pool.sql.bind(pool)
