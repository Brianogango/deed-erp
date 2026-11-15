import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `npm ci` is how this project installs (AGENTS.md, scripts/deploy.sh), and it
// fails on this dependency set without both of these. Losing either one wipes
// node_modules on the server and leaves the install half-done, so they are
// held here rather than left for whoever is deploying to rediscover.
describe('npm install settings', () => {
  const npmrc = () => readFileSync('.npmrc', 'utf8')

  // nodemailer 9 does not satisfy next-auth's optional peer range of ^7, and
  // npm calls that a conflict. The lockfile is already resolved past it.
  it('accepts the nodemailer / next-auth peer conflict', () => {
    expect(npmrc()).toMatch(/^legacy-peer-deps=true$/m)
  })

  // xlsx comes from the SheetJS CDN rather than the npm registry, so npm
  // classes it as a "remote" package; npm 12 made the default for those
  // "none". "root" covers this project's own dependencies and nothing deeper.
  it('allows the one dependency that is not on the registry', () => {
    const xlsx = JSON.parse(readFileSync('package.json', 'utf8')).dependencies.xlsx
    expect(xlsx).toMatch(/^https:\/\//)
    expect(npmrc()).toMatch(/^allow-remote=root$/m)
  })
})
