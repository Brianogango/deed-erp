/**
 * "was ADJ/0001" under a renumbered document's number. Its old number
 * repeated another record's (numbers used to be counted per browser); its
 * journals and stock moves still carry the old one, so it stays visible.
 */
export function FormerRefNote({ formerRef }: { formerRef?: string | null }) {
  if (!formerRef) return null
  return (
    <span className="block text-[10px] font-normal text-text-3" title="Renumbered: the old number repeated another record's. Its journals and stock moves carry the old number.">
      was {formerRef}
    </span>
  )
}

/** For search and export: the number, and the old one when it was renumbered. */
export const refWithFormer = (r: { ref: string; formerRef?: string | null }) => (r.formerRef ? `${r.ref} (was ${r.formerRef})` : r.ref)
