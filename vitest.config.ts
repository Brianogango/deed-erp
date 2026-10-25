import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['__tests__/setup.ts'],
    // Skill folders ship their own node:test files; they are not part of this app's suite.
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '.agents/**', '.claude/**'],
    env: {
      NEXTAUTH_SECRET: 'test-secret-for-vitest-32-chars-long!!',
      AUTH_SECRET: 'test-secret-for-vitest-32-chars-long!!',
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'app/api/**'],
      exclude: ['lib/store.tsx', 'node_modules/**'],
    },
  },
})
