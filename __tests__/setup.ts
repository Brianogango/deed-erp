// Set env vars before any module is imported so module-level constants pick them up.
process.env.NEXTAUTH_SECRET = 'test-secret-for-vitest-needs-32-chars!!'

// Mock Next.js server-only marker — it has no runtime effect, only prevents
// server modules from being imported in client bundles.
vi.mock('server-only', () => ({}))
