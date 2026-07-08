import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import { existsSync } from 'fs'

// Next.js loads .env files itself, but Playwright's own process (global
// setup, webServer spawn) does not — load them here for parity.
if (existsSync('.env.local')) loadEnv({ path: '.env.local' })
if (existsSync('.env')) loadEnv({ path: '.env' })

/**
 * End-to-end smoke tests for the critical money paths.
 *
 * Requirements:
 *  - DATABASE_URL pointing at a PostgreSQL database with the Prisma schema
 *    pushed (`npx prisma db push`)
 *  - NEXTAUTH_SECRET set (any value for local runs)
 *  - a production build (`pnpm build`) — the webServer below runs `next start`
 *
 * Run with: pnpm test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx next start -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
