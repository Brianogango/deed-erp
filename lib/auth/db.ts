import 'server-only'
import { createPool } from '@vercel/postgres'

const connectionString =
  process.env.deed_erp_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('No PostgreSQL connection string found. Set deed_erp_POSTGRES_URL in environment variables.')
}

const pool = createPool({ connectionString })

export const sql = pool.sql.bind(pool)
