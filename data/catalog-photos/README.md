# Catalog photo pack

Fallback hero + detail JPEGs for Partner API, Operations, and POS when a SKU has no staff upload.

- Sources are Wikimedia Commons / Openverse product photos (see `lib/catalog-photos.ts`).
- Every JPEG is cut out and composited onto the same studio field (`#F3F5F8`).
- Regenerated with `npx tsx scripts/download-catalog-photos.ts` (add `--force` to re-download).
- Staff uploads on the product form always win.
- Software licences (Kaspersky, McAfee, Microsoft 365) stay as placeholders — there is no honest CC product shot to show.
