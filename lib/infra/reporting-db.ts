import 'server-only'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import operationalPrisma from '@/lib/prisma'
import { prismaPgConfig } from '@/lib/prisma-pg-config'

declare global {
  var reportingPrismaGlobal: PrismaClient | undefined
}

/**
 * Read-optimised Prisma client.
 *
 * Set REPORTING_DATABASE_URL to a replica or reporting database. Writes
 * (snapshots, jobs) always use the operational client. When the env var is
 * unset, reads use the same primary as the rest of the app.
 */
export function reportingDatabaseUrl(): string | null {
  const url = String(process.env.REPORTING_DATABASE_URL || '').trim()
  return url || null
}

function getReplicaClient(): PrismaClient {
  if (!globalThis.reportingPrismaGlobal) {
    const connectionString = reportingDatabaseUrl()
    if (!connectionString) {
      throw new Error('REPORTING_DATABASE_URL is required to initialize the reporting replica client')
    }
    globalThis.reportingPrismaGlobal = new PrismaClient({
      adapter: new PrismaPg(prismaPgConfig(connectionString)),
    })
  }
  return globalThis.reportingPrismaGlobal
}

export function getReportingPrisma(): PrismaClient {
  return reportingDatabaseUrl() ? getReplicaClient() : operationalPrisma
}

export function getOperationalPrisma(): PrismaClient {
  return operationalPrisma
}
