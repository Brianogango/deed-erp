import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { INTERNAL_SECRET_API_PATHS } from '@/middleware'

/**
 * The middleware decides whether a request carrying x-internal-secret is even
 * allowed to reach its route. A route that reads that header but is missing
 * from INTERNAL_SECRET_API_PATHS is answered with 401 before its handler runs,
 * so its secret branch is dead code — and the failure looks like a wrong URL
 * or a stale secret rather than a routing gap, which is how two such routes
 * shipped unnoticed.
 *
 * This walks the real route files rather than restating a list, so a new route
 * that grows a secret branch fails here instead of in production.
 */

const API_ROOT = join(process.cwd(), 'app', 'api')

function routeFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...routeFiles(full))
    else if (/^route\.tsx?$/.test(entry)) found.push(full)
  }
  return found
}

/** app/api/foo/bar/route.ts → /api/foo/bar */
function pathnameFor(file: string): string {
  const rel = relative(join(process.cwd(), 'app'), file)
  return '/' + rel.split(sep).slice(0, -1).join('/')
}

/**
 * Reading the header, not merely mentioning it. Routes that SEND the secret to
 * another route — the portal's repair-approval handler posts to
 * /api/notifications/send with it — are callers, and a caller does not need to
 * be on the allow-list. The callee does.
 */
const READS_THE_HEADER = /headers\s*\.\s*get\(\s*['"]x-internal-secret['"]\s*\)/

const routesReadingTheSecret = routeFiles(API_ROOT).filter(file =>
  READS_THE_HEADER.test(readFileSync(file, 'utf8')),
)

describe('routes that accept x-internal-secret', () => {
  it('finds the routes at all, so a silent glob failure cannot pass this suite', () => {
    expect(routesReadingTheSecret.length).toBeGreaterThan(0)
  })

  it('are all allowed past the middleware', () => {
    const unreachable = routesReadingTheSecret
      .map(pathnameFor)
      .filter(pathname => !INTERNAL_SECRET_API_PATHS.has(pathname))
    expect(unreachable, 'add these to INTERNAL_SECRET_API_PATHS in middleware.ts').toEqual([])
  })
})

describe('INTERNAL_SECRET_API_PATHS', () => {
  it('lists no route that does not check the secret itself', () => {
    // The middleware waving a request through is not authorisation. Every
    // listed path must re-validate the header, or the entry hands out access
    // the route never agreed to grant.
    const byPathname = new Map(routesReadingTheSecret.map(f => [pathnameFor(f), f]))
    const unchecked = Array.from(INTERNAL_SECRET_API_PATHS).filter(p => !byPathname.has(p))
    expect(unchecked, 'these are waved through but never verify the header').toEqual([])
  })

  it('names only paths that exist', () => {
    const all = new Set(routeFiles(API_ROOT).map(pathnameFor))
    expect(Array.from(INTERNAL_SECRET_API_PATHS).filter(p => !all.has(p))).toEqual([])
  })
})
