import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

// A file marked "@ts-nocheck" is never type-checked, so a name used without being
// declared (e.g. `userCan(currentUser, …)` with no `currentUser`) compiles and only
// crashes in the browser when that code runs. Every file is type-checked now; this
// keeps it that way.
describe('@ts-nocheck', () => {
  it('is not used by any app file', () => {
    let files: string[] = []
    try {
      files = execSync('git grep -l -E "^// @ts-nocheck" -- app components lib hooks', { encoding: 'utf8' }).split('\n').filter(Boolean)
    } catch {
      // git grep exits 1 when nothing matches
    }
    expect(files).toEqual([])
  })
})
