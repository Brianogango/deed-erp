/** A scan failure as staff should read it. */
export function ocrErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  // tesseract.js downloads its English language data on first use and caches it.
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|traineddata/i.test(msg)) {
    return 'The text reader could not download its language data (no internet from the server). Fill in the details manually.'
  }
  return msg || fallback
}
