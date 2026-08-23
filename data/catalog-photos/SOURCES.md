# Photo sources

All fallback catalog photos are Wikimedia Commons files, downloaded and
normalized to JPEG (longest side 1600px). Staff uploads on the product form
replace these.

See `lib/catalog-photos.ts` for pack ids, match phrases, and file URLs.

Regenerate with:

```bash
npx tsx scripts/download-catalog-photos.ts
```
