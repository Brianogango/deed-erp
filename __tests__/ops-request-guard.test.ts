import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The ops workflows run scripts against the production server, and their
 * trigger is "this request file changed". That makes a merge, a revert, a
 * rebase or a conflict resolution enough to replay whatever payload the file
 * holds — which is how a `dryRun: false` request naming a real customer order
 * came to be sitting armed in the repository.
 *
 * Two invariants keep that shut, and both are easy to undo by accident when
 * adding the next op, so they are asserted here rather than left to review.
 */

const WORKFLOWS = '.github/workflows'
const OPS = 'ops'

const GATE = "if: steps.guard.outputs.armed == 'true'"

function workflowFiles() {
  return readdirSync(WORKFLOWS).filter(f => f.startsWith('ops-') && f.endsWith('.yml'))
}
function read(dir: string, f: string) {
  return readFileSync(join(dir, f), 'utf8')
}
/** Workflows fired by a commit, as opposed to the manual dispatch ones. */
function pushTriggered() {
  return workflowFiles().filter(f => /^on:\s*\n\s*push:/m.test(read(WORKFLOWS, f)))
}
/** Step blocks, split on `      - name:` / `      - uses:` at step indentation. */
function steps(src: string): string[] {
  const body = src.slice(src.indexOf('    steps:'))
  return body.split(/\n(?=      - (?:name|uses):)/).slice(1)
}

describe('ops request files are disarmed in the repository', () => {
  const requests = readdirSync(OPS).filter(f => f.endsWith('-request.json'))

  it('there are request files to check', () => {
    expect(requests.length).toBeGreaterThan(0)
  })

  it.each(requests)('%s is not armed', file => {
    const body = JSON.parse(read(OPS, file))
    // Absent counts as disarmed; present-and-true does not.
    expect(body.armed === true || body.armed === 'true').toBe(false)
  })

  it.each(requests)('%s does not carry a committed secret', file => {
    const body = JSON.parse(read(OPS, file))
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== 'string') continue
      if (/pass|secret|token|key|credential/i.test(k)) {
        expect(v, `${file}.${k} must stay empty in the repository`).toBe('')
      }
    }
  })
})

describe('ops workflows refuse a disarmed request', () => {
  const pushWorkflows = pushTriggered()

  it('every ops workflow is either push-triggered or manual dispatch', () => {
    expect(pushWorkflows.length).toBeGreaterThan(0)
    for (const f of workflowFiles()) {
      const src = read(WORKFLOWS, f)
      expect(/workflow_dispatch:|push:/.test(src), `${f} has no recognised trigger`).toBe(true)
    }
  })

  it.each(pushTriggered())('%s has the armed guard as its first real step', file => {
    const src = read(WORKFLOWS, file)
    expect(src).toContain('id: guard')
    expect(src).toMatch(/jq -r '\.armed \/\/ false'/)
    const blocks = steps(src)
    // Checkout, then the guard — nothing may precede it but the checkout.
    expect(blocks[0]).toMatch(/actions\/checkout/)
    expect(blocks[1]).toContain('id: guard')
  })

  it.each(pushTriggered())('%s gates every step after the guard', file => {
    const blocks = steps(read(WORKFLOWS, file))
    const gi = blocks.findIndex(b => b.includes('id: guard'))
    expect(gi).toBeGreaterThanOrEqual(0)
    for (const block of blocks.slice(gi + 1)) {
      const name = block.split('\n')[0].trim()
      expect(block, `${file}: ${name} is not gated on the guard`).toContain(GATE)
    }
  })

  it.each(pushTriggered())('%s never reaches the server before the guard', file => {
    const blocks = steps(read(WORKFLOWS, file))
    const gi = blocks.findIndex(b => b.includes('id: guard'))
    for (const block of blocks.slice(0, gi)) {
      expect(block).not.toMatch(/ssh-action|scp-action/)
    }
  })

  it('the guard reads the same request file the trigger watches', () => {
    for (const file of pushTriggered()) {
      const src = read(WORKFLOWS, file)
      const triggered = src.match(/paths:\s*\n\s*- '([^']+)'/)?.[1]
      const guarded = src.match(/REQUEST=(\S+)/)?.[1]
      expect(guarded, `${file}: guard reads no request`).toBeTruthy()
      expect(guarded, `${file}: guard checks ${guarded} but the trigger watches ${triggered}`)
        .toBe(triggered)
    }
  })
})

describe('the worktree janitor covers every ops artifact', () => {
  it('each file an ops workflow copies to the server is in OPS_PATHS', () => {
    const janitor = read(WORKFLOWS, 'ops-clean-worktree.yml')
    const listed = new Set(
      [...janitor.matchAll(/^\s+((?:scripts|ops)\/[\w.-]+\.(?:mjs|json))$/gm)].map(m => m[1]),
    )
    const copied = new Set<string>()
    for (const f of workflowFiles()) {
      if (f === 'ops-clean-worktree.yml') continue
      for (const m of read(WORKFLOWS, f).matchAll(/source:\s*([^\n]+)/g)) {
        for (const part of m[1].split(',')) if (part.trim()) copied.add(part.trim())
      }
    }
    // A missing entry leaves the production checkout dirty, and the deploy's
    // dirty-check then refuses to pull.
    const missing = [...copied].filter(p => !listed.has(p)).sort()
    expect(missing).toEqual([])
  })
})
