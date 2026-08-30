import 'server-only'

import fs from 'node:fs'
import path from 'node:path'

function isSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value.trim())
}

export function readDeploymentProvenance(root = process.cwd()): {
  commitSha: string | null
  gitRef: string | null
} {
  const gitDir = path.join(root, '.git')
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
    if (isSha(head)) return { commitSha: head.toLowerCase(), gitRef: null }
    if (!head.startsWith('ref: ')) return { commitSha: null, gitRef: null }

    const gitRef = head.slice(5).trim()
    if (!/^refs\/[A-Za-z0-9._\/-]+$/.test(gitRef) || gitRef.includes('..')) {
      return { commitSha: null, gitRef: null }
    }

    const looseRef = path.join(gitDir, ...gitRef.split('/'))
    try {
      const sha = fs.readFileSync(looseRef, 'utf8').trim()
      if (isSha(sha)) return { commitSha: sha.toLowerCase(), gitRef }
    } catch {}

    try {
      const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8')
      for (const line of packed.split(/\r?\n/)) {
        if (!line || line.startsWith('#') || line.startsWith('^')) continue
        const [sha, ref] = line.trim().split(/\s+/, 2)
        if (ref === gitRef && isSha(sha)) return { commitSha: sha.toLowerCase(), gitRef }
      }
    } catch {}

    return { commitSha: null, gitRef }
  } catch {
    return { commitSha: null, gitRef: null }
  }
}
