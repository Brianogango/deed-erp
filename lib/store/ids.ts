/** Record ids and today's date as the store writes them. */

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const uid = () => crypto.randomUUID()

export const now = () => new Date().toISOString().slice(0, 10)
