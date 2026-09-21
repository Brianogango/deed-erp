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
export const PRISMA_SESSION_TIMEZONE = 'UTC'

export function prismaPgConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    options: `-c TimeZone=${PRISMA_SESSION_TIMEZONE}`,
  }
}
