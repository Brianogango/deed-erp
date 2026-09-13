export const DOCUMENT_LAYOUT_IDS = [
  'standard',
  'boxed',
  'bold',
  'striped',
  'bubble',
  'wave',
  'folder',
] as const

export type DocumentLayoutId = typeof DOCUMENT_LAYOUT_IDS[number]

export const DOCUMENT_FONT_IDS = [
  'lato',
  'roboto',
  'open_sans',
  'montserrat',
  'raleway',
  'times',
  'courier',
] as const

export type DocumentFontId = typeof DOCUMENT_FONT_IDS[number]
export type DocumentBackgroundId = 'blank' | 'demo_logo'
export type DocumentPaperFormat = 'a4' | 'letter'

export interface DocumentLayoutOption {
  id: DocumentLayoutId
  label: string
  description: string
}

export const DOCUMENT_LAYOUT_OPTIONS: readonly DocumentLayoutOption[] = [
  { id: 'standard', label: 'Standard', description: 'Open header with a clean document body.' },
  { id: 'boxed', label: 'Boxed', description: 'Company, address, and totals in framed blocks.' },
  { id: 'bold', label: 'Bold', description: 'Strong colour fields and prominent headings.' },
  { id: 'striped', label: 'Striped', description: 'Alternating line rows for quick scanning.' },
  { id: 'bubble', label: 'Bubble', description: 'Rounded brand shapes and soft content panels.' },
  { id: 'wave', label: 'Wave', description: 'Flowing brand bands across header and footer.' },
  { id: 'folder', label: 'Folder', description: 'A tabbed document header inspired by a file folder.' },
] as const

export const DOCUMENT_FONT_OPTIONS: ReadonlyArray<{ id: DocumentFontId; label: string }> = [
  { id: 'lato', label: 'Lato' },
  { id: 'roboto', label: 'Roboto' },
  { id: 'open_sans', label: 'Open Sans' },
  { id: 'montserrat', label: 'Montserrat' },
  { id: 'raleway', label: 'Raleway' },
  { id: 'times', label: 'Times' },
  { id: 'courier', label: 'Courier' },
]

const LEGACY_LAYOUTS: Record<string, DocumentLayoutId> = {
  classic: 'standard',
  light: 'standard',
  modern: 'bold',
  compact: 'striped',
}

export function normalizeDocumentLayout(value: unknown): DocumentLayoutId {
  const normalized = String(value ?? '').trim().toLowerCase()
  if ((DOCUMENT_LAYOUT_IDS as readonly string[]).includes(normalized)) {
    return normalized as DocumentLayoutId
  }
  return LEGACY_LAYOUTS[normalized] ?? 'standard'
}

export function normalizeDocumentFont(value: unknown): DocumentFontId {
  const normalized = String(value ?? '').trim().toLowerCase()
  return (DOCUMENT_FONT_IDS as readonly string[]).includes(normalized)
    ? normalized as DocumentFontId
    : 'lato'
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim()
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback
}

export function normalizeDocumentBackground(value: unknown): DocumentBackgroundId {
  return value === 'demo_logo' ? 'demo_logo' : 'blank'
}

export function normalizePaperFormat(value: unknown): DocumentPaperFormat {
  return value === 'letter' ? 'letter' : 'a4'
}
