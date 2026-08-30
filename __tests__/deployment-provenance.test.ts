import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readDeploymentProvenance } from '@/lib/deployment-provenance'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deed-provenance-'))
  dirs.push(root)
  fs.mkdirSync(path.join(root, '.git', 'refs', 'heads'), { recursive: true })
  return root
}

describe('deployment provenance', () => {
  it('resolves a loose branch ref to the exact commit SHA', () => {
    const root = tempRepo()
    const sha = '1234567890abcdef1234567890abcdef12345678'
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/master\n')
    fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'master'), `${sha}\n`)
    expect(readDeploymentProvenance(root)).toEqual({ commitSha: sha, gitRef: 'refs/heads/master' })
  })

  it('supports detached HEAD', () => {
    const root = tempRepo()
    const sha = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), `${sha}\n`)
    expect(readDeploymentProvenance(root)).toEqual({ commitSha: sha, gitRef: null })
  })

  it('fails closed on missing or malformed git metadata', () => {
    const root = tempRepo()
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: ../../etc/passwd\n')
    expect(readDeploymentProvenance(root).commitSha).toBeNull()
  })
})
