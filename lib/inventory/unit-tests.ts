/**
 * Test bench: one test record per unit, every time it is tested.
 *
 * A serialised unit waits in Inbound (pending_testing), is tested at the
 * bench, and its result decides where it may go. The result is worked out
 * from the record (any blocking issue, or a battery below the threshold,
 * fails it) — the tester never picks pass or fail by hand.
 *
 * Only a passing test that has not been "used" yet lets a unit into Ready
 * for Sale. Moving the unit out of Inbound uses it up (placed), so a unit
 * that later goes to With Issues or Refurbishment is tested again before it
 * can sell. Units already in Ready for Sale with no test stay sellable
 * (untested — legacy).
 *
 * Pure: shared by the screens, the label and the server.
 */

export type CheckResult = 'pass' | 'fail' | 'na'
export type UnitGrade = 'A' | 'B' | 'C'

export interface ChecklistItem {
  id: string
  label: string
  /** Shown in the tick strip on the label ("Boot", "Keys"). */
  short: string
  /** Laptops only (keyboard & touchpad on a desktop is N/A). */
  laptopOnly?: boolean
  /** Taken out of the checklist; kept so old tests still read. */
  inactive?: boolean
}

export const DEFAULT_UNIT_TEST_CHECKLIST: ChecklistItem[] = [
  { id: 'power_boot', label: 'Power & boot', short: 'Boot' },
  { id: 'display', label: 'Display (dead pixels, lines, brightness)', short: 'Display' },
  { id: 'keyboard', label: 'Keyboard & touchpad', short: 'Keys', laptopOnly: true },
  { id: 'ports', label: 'Ports & charging', short: 'Ports' },
  { id: 'wireless', label: 'Wi-Fi & Bluetooth', short: 'WiFi' },
  { id: 'av', label: 'Webcam, mic & speakers', short: 'Cam/Audio' },
  { id: 'casing', label: 'Hinges & casing', short: 'Hinge' },
  { id: 'storage', label: 'Storage health', short: 'SSD' },
  { id: 'ram', label: 'RAM test', short: 'RAM' },
  { id: 'bios', label: 'BIOS unlocked, no remote lock', short: 'BIOS' },
]

/** Fail below this battery health (%). Settings can change it. */
export const DEFAULT_BATTERY_FAIL_BELOW = 60
/** Passes, but the label calls it out, below this (%). */
export const DEFAULT_BATTERY_NOTE_BELOW = 80

export interface UnitTestSettings {
  checklist: ChecklistItem[]
  batteryFailBelow: number
  batteryNoteBelow: number
}

/** The test settings from system settings, with the defaults filled in. */
export function unitTestSettings(system: Record<string, unknown> | null | undefined): UnitTestSettings {
  const s = system ?? {}
  const list = Array.isArray(s.invUnitTestChecklist) ? (s.invUnitTestChecklist as ChecklistItem[]) : []
  const clean = list
    .filter(i => i && typeof i.id === 'string' && i.id && typeof i.label === 'string' && i.label.trim())
    .map(i => ({ id: i.id, label: i.label.trim(), short: String(i.short || i.label).trim().slice(0, 12), laptopOnly: !!i.laptopOnly, inactive: !!i.inactive }))
  const failBelow = Number(s.invBatteryFailBelow)
  const noteBelow = Number(s.invBatteryNoteBelow)
  const fail = Number.isFinite(failBelow) && failBelow >= 0 && failBelow <= 100 && s.invBatteryFailBelow !== '' && s.invBatteryFailBelow != null ? failBelow : DEFAULT_BATTERY_FAIL_BELOW
  const note = Number.isFinite(noteBelow) && noteBelow >= 0 && noteBelow <= 100 && s.invBatteryNoteBelow !== '' && s.invBatteryNoteBelow != null ? noteBelow : DEFAULT_BATTERY_NOTE_BELOW
  return {
    checklist: clean.length ? clean : DEFAULT_UNIT_TEST_CHECKLIST,
    batteryFailBelow: fail,
    batteryNoteBelow: Math.max(note, fail),
  }
}

export interface UnitTestCheck {
  itemId: string
  label: string
  short: string
  result: CheckResult | null
  /** What is wrong, when it fails ("3 dead keys (E, R, T)"). */
  note?: string
  /** A failed check blocks the sale unless the tester marks it cosmetic. */
  cosmetic?: boolean
}

export interface UnitTestIssue {
  id: string
  text: string
  severity: 'blocks_sale' | 'cosmetic'
}

export interface UnitTestOverride {
  byId: string
  byName: string
  reason: string
  at: string
}

export type UnitTestStatus = 'in_progress' | 'completed' | 'placed' | 'cancelled'

export interface UnitTest {
  id: string
  serialId: string
  serialNumber: string
  assetId?: string
  productId: string
  productName: string
  /** Test #1, #2 … for this unit. */
  number: number
  status: UnitTestStatus
  /** Why it is being tested: first time, or back after a repair. */
  source?: 'first' | 'retest_after_repair' | 'retest'
  refurbJobRef?: string
  isLaptop: boolean
  startedAt: string
  startedById?: string
  startedByName?: string
  completedAt?: string
  testedById?: string
  testedByName?: string
  checks: UnitTestCheck[]
  batteryHealth?: number | null
  batteryCycles?: number | null
  storageHealth?: number | null
  grade?: UnitGrade | null
  installs: { os?: string; osActivated?: boolean; drivers?: boolean; office?: boolean }
  spec: { cpu?: string; ramGb?: number | null; storageGb?: number | null; matches?: boolean | null; note?: string }
  issues: UnitTestIssue[]
  result?: 'passed' | 'failed'
  failReasons?: string[]
  override?: UnitTestOverride
  placedAt?: string
  placedByName?: string
  placedTo?: string
  cancelledAt?: string
  cancelReason?: string
}

/** A laptop needs a battery reading and a keyboard check. */
export function isLaptopProduct(category?: string | null, productName?: string | null): boolean {
  return /laptop|notebook|macbook|ultrabook|chromebook/i.test(`${category ?? ''} ${productName ?? ''}`)
}

/** A blank test for a unit, from the current checklist. */
export function newUnitTest(input: {
  id: string
  serial: { id: string; serial: string; productId: string; productName: string; assetId?: string }
  isLaptop: boolean
  checklist: ChecklistItem[]
  previous: UnitTest[]
  startedAt: string
  startedById?: string
  startedByName?: string
  source?: UnitTest['source']
  refurbJobRef?: string
}): UnitTest {
  const prior = input.previous.filter(t => t.serialId === input.serial.id && t.status !== 'cancelled')
  return {
    id: input.id,
    serialId: input.serial.id,
    serialNumber: input.serial.serial,
    ...(input.serial.assetId ? { assetId: input.serial.assetId } : {}),
    productId: input.serial.productId,
    productName: input.serial.productName,
    number: prior.reduce((n, t) => Math.max(n, t.number || 0), 0) + 1,
    status: 'in_progress',
    source: input.source ?? (prior.length ? 'retest' : 'first'),
    ...(input.refurbJobRef ? { refurbJobRef: input.refurbJobRef } : {}),
    isLaptop: input.isLaptop,
    startedAt: input.startedAt,
    startedById: input.startedById,
    startedByName: input.startedByName,
    checks: input.checklist
      .filter(i => !i.inactive)
      .map(i => ({ itemId: i.id, label: i.label, short: i.short, result: !input.isLaptop && i.laptopOnly ? 'na' as const : null })),
    batteryHealth: null,
    batteryCycles: null,
    storageHealth: null,
    grade: null,
    installs: {},
    spec: {},
    issues: [],
  }
}

const pct = (n: unknown): number | null => {
  if (n === null || n === undefined || n === '') return null
  const v = Number(n)
  return Number.isFinite(v) ? v : null
}

/** What still has to be filled in before the test can be saved as done. */
export function missingForCompletion(t: UnitTest): string[] {
  const missing: string[] = []
  const open = t.checks.filter(c => c.result === null)
  if (open.length) missing.push(`Tick every check (${open.map(c => c.short).join(', ')})`)
  const noNote = t.checks.filter(c => c.result === 'fail' && !String(c.note ?? '').trim())
  if (noNote.length) missing.push(`Say what is wrong: ${noNote.map(c => c.short).join(', ')}`)
  const bat = pct(t.batteryHealth)
  if (t.isLaptop && bat === null) missing.push('Battery health %')
  if (bat !== null && (bat < 0 || bat > 100)) missing.push('Battery health must be 0–100%')
  const ssd = pct(t.storageHealth)
  if (ssd !== null && (ssd < 0 || ssd > 100)) missing.push('Storage health must be 0–100%')
  if (!t.grade) missing.push('Grade (A, B or C)')
  if (t.spec.matches === false) missing.push('Spec does not match the product: move it to the right product (Set model & specs), then confirm the spec')
  if (t.spec.matches == null) missing.push('Confirm the spec (CPU, RAM, storage) matches the product')
  return missing
}

/** Why a finished test fails; empty means it passes. */
export function failReasonsFor(t: UnitTest, settings: Pick<UnitTestSettings, 'batteryFailBelow'>): string[] {
  const reasons: string[] = []
  const bat = pct(t.batteryHealth)
  if (bat !== null && bat < settings.batteryFailBelow) reasons.push(`Battery ${bat}%`)
  for (const c of t.checks) {
    if (c.result === 'fail' && !c.cosmetic) reasons.push(c.note?.trim() ? `${c.short}: ${c.note.trim()}` : c.label)
  }
  for (const i of t.issues) if (i.severity === 'blocks_sale' && i.text.trim()) reasons.push(i.text.trim())
  return reasons
}

/** The result as it stands on the form (before it is saved). */
export function computeResult(t: UnitTest, settings: Pick<UnitTestSettings, 'batteryFailBelow'>): { result: 'passed' | 'failed'; reasons: string[] } {
  const reasons = failReasonsFor(t, settings)
  return { result: reasons.length ? 'failed' : 'passed', reasons }
}

/** Cosmetic notes: failed checks marked cosmetic, and cosmetic issues. */
export function cosmeticNotes(t: UnitTest): string[] {
  return [
    ...t.checks.filter(c => c.result === 'fail' && c.cosmetic).map(c => (c.note?.trim() ? `${c.short}: ${c.note.trim()}` : c.label)),
    ...t.issues.filter(i => i.severity === 'cosmetic' && i.text.trim()).map(i => i.text.trim()),
  ]
}

export type EffectiveResult = 'passed' | 'passed_override' | 'failed' | 'pending'

export function effectiveResult(t: UnitTest | null | undefined): EffectiveResult {
  if (!t || t.status === 'in_progress' || t.status === 'cancelled' || !t.result) return 'pending'
  if (t.result === 'passed') return 'passed'
  return t.override ? 'passed_override' : 'failed'
}

export const isPassing = (t: UnitTest | null | undefined) => {
  const r = effectiveResult(t)
  return r === 'passed' || r === 'passed_override'
}

/** This unit's tests, newest first (cancelled left out). */
export function testsForSerial(tests: UnitTest[], serialId: string): UnitTest[] {
  return tests
    .filter(t => t.serialId === serialId && t.status !== 'cancelled')
    .sort((a, b) => (b.number || 0) - (a.number || 0) || String(b.startedAt).localeCompare(String(a.startedAt)))
}

/** The newest finished test (done or placed). */
export function latestFinishedTest(tests: UnitTest[], serialId: string): UnitTest | null {
  return testsForSerial(tests, serialId).find(t => t.status === 'completed' || t.status === 'placed') ?? null
}

export type InboundStage = 'awaiting' | 'on_bench' | 'tested'

/** Where a unit in Inbound is: waiting, on the bench, or tested and waiting to be placed. */
export function inboundStage(tests: UnitTest[], serialId: string): InboundStage {
  const mine = testsForSerial(tests, serialId)
  if (mine.some(t => t.status === 'in_progress')) return 'on_bench'
  if (mine.some(t => t.status === 'completed')) return 'tested'
  return 'awaiting'
}

/** The open test on the bench, or the finished one waiting for placement. */
export function openTest(tests: UnitTest[], serialId: string): UnitTest | null {
  const mine = testsForSerial(tests, serialId)
  return mine.find(t => t.status === 'in_progress') ?? mine.find(t => t.status === 'completed') ?? null
}

/** Locations a unit cannot go from straight into Ready for Sale without a passing test. */
export const TEST_GATED_FROM = ['pending_testing', 'shop', 'repair_unit', 'quarantine'] as const

/**
 * May this unit move into Ready for Sale now? Only with a passing test that
 * has not been placed yet (that is, from Inbound after its test).
 */
export function readyForSaleCheck(tests: UnitTest[], serialId: string, fromLocation: string, label = 'This unit'): { ok: true; test: UnitTest } | { ok: false; error: string } {
  const mine = testsForSerial(tests, serialId)
  if (mine.some(t => t.status === 'in_progress')) return { ok: false, error: `${label} is still on the test bench: finish its test first.` }
  const open = mine.find(t => t.status === 'completed')
  if (!open || fromLocation !== 'pending_testing') {
    return { ok: false, error: `${label} has no passing test — send it to Inbound and test it at the test bench first.` }
  }
  if (!isPassing(open)) {
    return { ok: false, error: `${label} failed its test (${(open.failReasons ?? []).join(', ') || 'see the test'}): move it to With Issues, or ask the Technical lead to pass it anyway.` }
  }
  return { ok: true, test: open }
}

/** The repair to-do list a refurbishment job gets from a failed test. */
export function refurbTasksFromTest(t: UnitTest | null | undefined): string[] {
  if (!t) return []
  return (t.failReasons && t.failReasons.length ? t.failReasons : failReasonsFor(t, { batteryFailBelow: DEFAULT_BATTERY_FAIL_BELOW }))
}

/** "Win 11 Pro ✔ · Drivers · Office" */
export function installsText(t: UnitTest): string {
  const parts: string[] = []
  if (t.installs.os?.trim()) parts.push(`${t.installs.os.trim()}${t.installs.osActivated ? ' (activated)' : ''}`)
  if (t.installs.drivers) parts.push('Drivers')
  if (t.installs.office) parts.push('Office')
  return parts.join(' · ')
}

export interface UnitTestSummary {
  headline: 'PASSED' | 'PASSED (OVERRIDE)' | 'FAILED' | 'IN PROGRESS'
  battery: string
  grade: string
  readings: string[]
  ticks: Array<{ short: string; result: CheckResult | null }>
  passedCount: number
  checkedCount: number
  failures: string[]
  cosmetic: string[]
  installs: string
  spec: string
  dateTester: string
  overrideReason?: string
}

function dayMonth(iso?: string): string {
  const d = new Date(String(iso ?? ''))
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Africa/Nairobi' })
}

/** Everything a label, row or report shows about a test. */
export function summarizeTest(t: UnitTest): UnitTestSummary {
  const r = effectiveResult(t)
  const bat = pct(t.batteryHealth)
  const ssd = pct(t.storageHealth)
  const ram = t.checks.find(c => c.itemId === 'ram')
  const battery = bat === null ? '' : `Battery ${bat}%${t.batteryCycles ? ` (${t.batteryCycles} cyc)` : ''}`
  const readings = [
    ssd !== null ? `SSD ${ssd}%` : '',
    ram?.result === 'pass' ? 'RAM OK' : '',
  ].filter(Boolean)
  const counted = t.checks.filter(c => c.result === 'pass' || c.result === 'fail')
  const spec = [t.spec.cpu, t.spec.ramGb ? `${t.spec.ramGb} GB` : '', t.spec.storageGb ? `${t.spec.storageGb} GB` : ''].filter(Boolean).join(' / ')
  return {
    headline: r === 'passed' ? 'PASSED' : r === 'passed_override' ? 'PASSED (OVERRIDE)' : r === 'failed' ? 'FAILED' : 'IN PROGRESS',
    battery,
    grade: t.grade ? `Grade ${t.grade}` : '',
    readings,
    ticks: t.checks.filter(c => c.result !== 'na').map(c => ({ short: c.short, result: c.result })),
    passedCount: counted.filter(c => c.result === 'pass').length,
    checkedCount: counted.length,
    failures: t.failReasons ?? [],
    cosmetic: cosmeticNotes(t),
    installs: installsText(t),
    spec,
    dateTester: [dayMonth(t.completedAt || t.startedAt), t.testedByName || t.startedByName].filter(Boolean).join(' · '),
    ...(t.override ? { overrideReason: t.override.reason } : {}),
  }
}

/** One short line for a unit's row: "Grade B · Battery 87% · 10/10 passed". */
export function testRowLine(t: UnitTest | null | undefined): string {
  if (!t) return ''
  const s = summarizeTest(t)
  return [s.grade, s.battery, s.checkedCount ? `${s.passedCount}/${s.checkedCount} passed` : ''].filter(Boolean).join(' · ')
}

export interface TestChange { what: string; before: string; after: string; fixed: boolean }

/** What changed between two tests of the same unit (a retest after repair). */
export function compareTests(before: UnitTest, after: UnitTest): TestChange[] {
  const out: TestChange[] = []
  const b1 = pct(before.batteryHealth)
  const b2 = pct(after.batteryHealth)
  if (b1 !== b2 && (b1 !== null || b2 !== null)) {
    out.push({ what: 'Battery', before: b1 === null ? '—' : `${b1}%`, after: b2 === null ? '—' : `${b2}%`, fixed: (b2 ?? 0) > (b1 ?? 0) })
  }
  for (const c2 of after.checks) {
    const c1 = before.checks.find(c => c.itemId === c2.itemId)
    if (!c1 || c1.result === c2.result) continue
    const show = (c: UnitTestCheck) => (c.result === 'fail' ? `✖ ${c.note?.trim() || 'failed'}` : c.result === 'pass' ? '✔' : c.result === 'na' ? 'N/A' : '—')
    out.push({ what: c2.label, before: show(c1), after: show(c2), fixed: c1.result === 'fail' && c2.result === 'pass' })
  }
  if (before.grade !== after.grade && (before.grade || after.grade)) {
    out.push({ what: 'Grade', before: before.grade || '—', after: after.grade || '—', fixed: false })
  }
  return out
}

/** Apply a form patch from the screen to an open test (only what a tester may change). */
export function applyTestPatch(t: UnitTest, patch: Partial<UnitTest>): UnitTest {
  const num = (v: unknown) => {
    const n = pct(v)
    return n === null ? null : n
  }
  const next: UnitTest = { ...t }
  if (Array.isArray(patch.checks)) {
    next.checks = t.checks.map(c => {
      const p = patch.checks!.find(x => x.itemId === c.itemId)
      if (!p) return c
      const result = p.result === 'pass' || p.result === 'fail' || p.result === 'na' ? p.result : null
      return {
        ...c,
        result,
        note: result === 'fail' ? String(p.note ?? '').slice(0, 200) : undefined,
        cosmetic: result === 'fail' ? !!p.cosmetic : undefined,
      }
    })
  }
  if ('batteryHealth' in patch) next.batteryHealth = num(patch.batteryHealth)
  if ('batteryCycles' in patch) next.batteryCycles = num(patch.batteryCycles)
  if ('storageHealth' in patch) next.storageHealth = num(patch.storageHealth)
  if ('grade' in patch) next.grade = patch.grade === 'A' || patch.grade === 'B' || patch.grade === 'C' ? patch.grade : null
  if (patch.installs && typeof patch.installs === 'object') {
    next.installs = {
      os: String(patch.installs.os ?? '').slice(0, 60) || undefined,
      osActivated: !!patch.installs.osActivated,
      drivers: !!patch.installs.drivers,
      office: !!patch.installs.office,
    }
  }
  if (patch.spec && typeof patch.spec === 'object') {
    next.spec = {
      cpu: String(patch.spec.cpu ?? '').slice(0, 60) || undefined,
      ramGb: num(patch.spec.ramGb),
      storageGb: num(patch.spec.storageGb),
      matches: patch.spec.matches === true ? true : patch.spec.matches === false ? false : null,
      note: String(patch.spec.note ?? '').slice(0, 200) || undefined,
    }
  }
  if (Array.isArray(patch.issues)) {
    next.issues = patch.issues
      .filter(i => i && String(i.text ?? '').trim())
      .slice(0, 30)
      .map((i, n) => ({ id: String(i.id || `issue-${n + 1}`), text: String(i.text).trim().slice(0, 200), severity: i.severity === 'cosmetic' ? 'cosmetic' : 'blocks_sale' }))
  }
  return next
}
