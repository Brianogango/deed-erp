export const DOCUMENT_LAYOUT_IDS = [
  'light',
  'boxed',
  'bold',
  'striped',
  'bubble',
  'wave',
] as const

export type DocumentLayoutId = typeof DOCUMENT_LAYOUT_IDS[number]

export interface DocumentLayoutOption {
  id: DocumentLayoutId
  label: string
  description: string
  accent: string
}

export const DOCUMENT_LAYOUT_OPTIONS: readonly DocumentLayoutOption[] = [
  { id: 'light', label: 'Light', description: 'Clean header and open white space.', accent: '#714B67' },
  { id: 'boxed', label: 'Boxed', description: 'Framed information and table blocks.', accent: '#714B67' },
  { id: 'bold', label: 'Bold', description: 'Strong colour band and prominent title.', accent: '#017E84' },
  { id: 'striped', label: 'Striped', description: 'Alternating rows for dense documents.', accent: '#875A7B' },
  { id: 'bubble', label: 'Bubble', description: 'Rounded colour accents and softer blocks.', accent: '#017E84' },
  { id: 'wave', label: 'Wave', description: 'Flowing branded header and footer accents.', accent: '#714B67' },
] as const

const LEGACY_LAYOUTS: Record<string, DocumentLayoutId> = {
  classic: 'light',
  modern: 'bold',
  compact: 'striped',
}

export function normalizeDocumentLayout(value: unknown): DocumentLayoutId {
  const normalized = String(value ?? '').trim().toLowerCase()
  if ((DOCUMENT_LAYOUT_IDS as readonly string[]).includes(normalized)) {
    return normalized as DocumentLayoutId
  }
  return LEGACY_LAYOUTS[normalized] ?? 'light'
}
