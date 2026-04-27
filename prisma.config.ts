import { defineConfig } from 'prisma/config'

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
