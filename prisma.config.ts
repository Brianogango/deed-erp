import { defineConfig } from 'prisma/config'
import { config as loadEnv } from 'dotenv'
import { existsSync } from 'fs'

// Prisma 7 runs this config before loading .env files, so we load them manually.
if (existsSync('.env.local')) loadEnv({ path: '.env.local' })
if (existsSync('.env')) loadEnv({ path: '.env' })

const url =
  process.env.deed_erp_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL

// During `prisma generate` (build step) no live DB connection is needed —
// the command only reads the schema file to produce the client.
// Only `prisma db push` / `prisma migrate` require an actual URL, so we
// log a warning instead of throwing and let the build continue.
if (!url) {
  console.warn(
    '[prisma.config] No DATABASE_URL found — skipping datasource URL.\n' +
    'This is fine for `prisma generate`. For `prisma db push` set DATABASE_URL in your environment.'
  )
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  ...(url ? { datasource: { url } } : {}),
})
