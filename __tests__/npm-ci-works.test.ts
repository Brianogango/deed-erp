import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `npm ci` is how this project installs (AGENTS.md, scripts/deploy.sh). It
// fails on this dependency set without the flag below: nodemailer 9 does not
// satisfy next-auth's optional peer range of ^7, and npm treats that as a
// conflict. The lockfile was already resolved this way, so the setting records
// what is true rather than changing anything.
describe('npm install settings', () => {
  it('lets npm ci install this dependency set', () => {
    expect(readFileSync('.npmrc', 'utf8')).toMatch(/^legacy-peer-deps=true$/m)
  })
})
