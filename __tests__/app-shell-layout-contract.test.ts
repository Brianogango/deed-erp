import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('authenticated AppShell layout contract', () => {
  it('keeps AppShell out of the root layout so login/track/portal do not remount it', () => {
    const root = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')
    expect(root).not.toMatch(/from ['"]@\/components\/AppShell['"]/)
    expect(root).not.toMatch(/<AppShell/)
    expect(root).toMatch(/\{children\}/)
  })

  it('mounts AppShell once in the (app) route-group layout', () => {
    const appLayout = readFileSync(join(process.cwd(), 'app/(app)/layout.tsx'), 'utf8')
    expect(appLayout).toMatch(/<AppShell/)
    expect(appLayout).toMatch(/\{children\}/)
  })

  it('shows shell chrome at the root loading boundary and content-only loading inside (app)', () => {
    const rootLoading = readFileSync(join(process.cwd(), 'app/loading.tsx'), 'utf8')
    const appLoading = readFileSync(join(process.cwd(), 'app/(app)/loading.tsx'), 'utf8')
    expect(rootLoading).toMatch(/ShellChromeSkeleton/)
    expect(appLoading).toMatch(/ModuleSkeleton/)
    expect(appLoading).not.toMatch(/ShellChromeSkeleton/)
  })
})
