import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['__tests__/setup.ts'],
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
