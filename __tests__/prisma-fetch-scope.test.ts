import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const store = readFileSync('lib/store.tsx', 'utf8')
const crud = readFileSync('lib/server-store-crud.ts', 'utf8')
const stream = readFileSync('app/api/store/stream/route.ts', 'utf8')
const shell = readFileSync('components/AppShell.tsx', 'utf8')
const boot = readFileSync('lib/boot-apis.ts', 'utf8')

describe('Prisma fetch scope', () => {
  it('boots REST collections with a single page instead of walking every page', () => {
    expect(store).toContain("from '@/lib/api-pagination'")
    expect(store).toContain('fetchCollection(')
    expect(store).not.toContain('fetchAllCollectionPages')
  })

  it('subscribes the live store stream to the current route keys only', () => {
    expect(store).toContain('/api/store/stream?keys=')
    expect(stream).toContain('loadChangedStoreKeysSince')
    expect(stream).toContain("send('store', { state: {}, patch: true, invalidated })")
    expect(stream).not.toContain('loadAppStateChangesSince')
  })

  it('does not wipe route hydration on every window focus', () => {
    expect(shell).not.toContain('hydratedRoutesRef.current.delete')
    expect(shell).toContain('criticalAppStateKeysForRoute(route)')
  })

  it('does not boot HR or catalog lists on every route', () => {
    expect(boot).toMatch(/const ALWAYS_BOOT: BootApiGroup\[\] = \[\]/)
  })

  it('reads CRUD collections by key instead of reconstructing the whole store', () => {
    expect(crud).toContain('loadAppState([key])')
    expect(crud).not.toMatch(/loadAppState\(\)/)
  })

  it('polls leave only while the HR workspace is open', () => {
    expect(store).toContain("nextPath.startsWith('/hr')")
    expect(store).toContain('startLeavePoll')
    expect(store).toContain('stopLeavePoll')
  })

  it('does not poll every awaiting-approval job through the customer portal API', () => {
    expect(store).not.toContain("setInterval(check, 10_000)")
    expect(store).not.toContain('`/api/portal/repair/${encodeURIComponent(repair.ref)}`')
    expect(store).toContain('/api/portal/repair/sync')
  })
})
