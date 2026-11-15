import type { DocumentLayoutId } from './document-layout'

/**
 * What actually makes one document layout different from another.
 *
 * The seven choices used to differ only in the ornament on the letterhead and
 * the colour of the table rules — the document underneath was the same in all
 * of them, so picking a template changed very little. These are the levers a
 * designer would reach for instead: where the customer and the reference sit
 * relative to each other, how the table is ruled, how the totals are framed,
 * and how much air the whole thing is given.
 */

/** How the line table is ruled. */
export type TableStyle =
  | 'hairline' // a rule under each row, nothing vertical
  | 'grid'     // fully ruled cells
  | 'zebra'    // alternating row fills
  | 'solid'    // filled heading, fully ruled
  | 'open'     // one rule under the heading and nothing else

/** How the totals are framed. */
export type TotalsStyle =
  | 'column' // right-hand column, rules only
  | 'card'   // framed panel
  | 'band'   // full content width

/** Where the customer sits relative to the document's own references. */
export type PartyStyle =
  | 'split'    // customer left, references right
  | 'card'     // both inside one panel
  | 'mirrored' // references left, customer right
  | 'stacked'  // customer across the top, references in a row beneath

export interface DocumentLayoutSpec {
  party: PartyStyle
  table: TableStyle
  totals: TotalsStyle
  density: 'compact' | 'regular' | 'airy'
  /** Corner radius on panels; 0 is square. */
  radius: number
}

export const DOCUMENT_LAYOUT_SPECS: Record<DocumentLayoutId, DocumentLayoutSpec> = {
  // The classic: customer left, references right, quiet rules, totals in a column.
  standard: { party: 'split', table: 'hairline', totals: 'column', density: 'regular', radius: 0 },
  // Everything framed, for readers who want each field in its own cell.
  boxed: { party: 'card', table: 'grid', totals: 'card', density: 'regular', radius: 3 },
  // Loud: the accent carries the heading and the totals run the full width.
  bold: { party: 'split', table: 'solid', totals: 'band', density: 'regular', radius: 3 },
  // Dense, for long itemised documents: tighter rows, banded for tracking.
  striped: { party: 'split', table: 'zebra', totals: 'column', density: 'compact', radius: 0 },
  // Soft and roomy, for short customer-facing documents.
  bubble: { party: 'card', table: 'open', totals: 'card', density: 'airy', radius: 12 },
  // Editorial: the customer runs across the top, the page breathes.
  wave: { party: 'stacked', table: 'open', totals: 'column', density: 'airy', radius: 0 },
  // Mirrored, for filing: the reference reads first, down the left edge.
  folder: { party: 'mirrored', table: 'grid', totals: 'card', density: 'regular', radius: 3 },
}

export const LAYOUT_DENSITY = {
  compact: { cellPadding: 5, fontSize: 7.4, totalsRow: 16, blockGap: 20 },
  regular: { cellPadding: 7, fontSize: 7.8, totalsRow: 19, blockGap: 28 },
  airy: { cellPadding: 10, fontSize: 8.2, totalsRow: 22, blockGap: 36 },
} as const

export const layoutSpec = (id: DocumentLayoutId): DocumentLayoutSpec => DOCUMENT_LAYOUT_SPECS[id]
export const layoutDensity = (id: DocumentLayoutId) => LAYOUT_DENSITY[DOCUMENT_LAYOUT_SPECS[id].density]
