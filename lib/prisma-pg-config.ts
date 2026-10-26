import type { PoolConfig } from 'pg'

/**
 * Postgres connection settings for every Prisma client.
 *
 * Prisma's pg adapter sends DateTime values as UTC wall-clock text WITHOUT an
 * offset ("2026-09-21 16:18:46.993") and, when reading TIMESTAMPTZ, replaces
 * whatever offset Postgres returns with "+00:00". Both are only correct when
 * the session TimeZone is UTC.
 *
 * The Contabo server's Postgres defaults to Europe/Berlin, so until this fix:
 * - Prisma-written TIMESTAMPTZ values were stored 2h early (1h in winter) —
 *   invisible inside the app because Prisma's read shifted them back, but
 *   wrong for psql, SQL reports, backups and raw `sql` readers;
 * - values stamped by the database clock (NOW(), column defaults) read
 *   through Prisma came back 2h in the future.
 *
 * Pinning Prisma sessions to UTC makes both directions correct. Existing
 * Prisma-written rows must be corrected ONCE when this ships:
 * scripts/fix-prisma-timestamptz-offset.mjs (see docs/PRISMA_UTC_SESSION_FIX.md).
 */
const PRISMA_SESSION_TIMEZONE = 'UTC'

/**
 * Connections per app process. pg's default of 10 was too few: a full store
 * load reads about a dozen lists side by side, each with several queries, so
 * requests from a few open tabs queued for a connection and every list looked
 * slow. Two PM2 processes at 20 each (plus the small raw-SQL pool) stay well
 * under Postgres' default limit of 100. PRISMA_POOL_MAX overrides it.
 */
export function prismaPoolMax(env: string | undefined = process.env.PRISMA_POOL_MAX): number {
  const n = Number(env)
  return Number.isInteger(n) && n >= 2 && n <= 80 ? n : 20
}

export function prismaPgConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    options: `-c TimeZone=${PRISMA_SESSION_TIMEZONE}`,
    max: prismaPoolMax(),
  }
}
