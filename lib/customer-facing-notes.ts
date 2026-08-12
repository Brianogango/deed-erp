/**
 * Strip internal workflow / audit lines from notes before printing on
 * customer-facing quotation and invoice PDFs.
 */

const INTERNAL_NOTE_PATTERNS: RegExp[] = [
  /^reset to draft by\b/i,
  /^auto-created from\b/i,
  /^cancelled by\b/i,
  /^cancelled —/i,
  /^cancelled - /i,
  /^applied customer credit\b/i,
  /^applied deposit\b/i,
  /^credit .+ applied:/i,
  /^reduced by purchase return\b/i,
  /^\[direct repair consent\]/i,
  /^\[workflow path changed/i,
  /^\[customer (accepted|rejected)/i,
  /^\[diagnosis fee waived/i,
  /^\[no-charge/i,
  /^\[stopped at diagnosis\]/i,
  /^workflow path changed\b/i,
  /^repair invoice for\b/i,
  /^orc release:/i,
  /^pos\s+/i,
]

/**
 * Keep human / commercial notes; drop system audit breadcrumbs that get
 * appended into `invoice.notes` / `quote.notes` during workflow actions.
 */
export function customerFacingNotes(raw: unknown): string {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').trim()
  if (!text) return ''

  const kept = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !INTERNAL_NOTE_PATTERNS.some(re => re.test(line)))

  return kept.join('\n').trim()
}
