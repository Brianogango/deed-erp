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

if (!url) {
  throw new Error(
    'No database URL found. Set DATABASE_URL (or POSTGRES_URL) in your .env.local file.\n' +
    'Get the value from your Vercel project → Settings → Environment Variables.'
  )
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: { url },
})
