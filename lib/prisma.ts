import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

declare global {
  var prismaGlobal: PrismaClient | undefined
}

function getPrismaClient(): PrismaClient {
  if (!globalThis.prismaGlobal) {
    const connectionString = process.env.DATABASE_URL

    if (!connectionString) {
      throw new Error('DATABASE_URL is required to initialize Prisma')
    }

    const adapter = new PrismaPg({ connectionString })
    globalThis.prismaGlobal = new PrismaClient({ adapter })
  }
  return globalThis.prismaGlobal
}

// Lazy proxy — defers PrismaClient construction until first method call,
// preventing initialization errors during Next.js build-time module analysis.
const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return (getPrismaClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

export default prisma
