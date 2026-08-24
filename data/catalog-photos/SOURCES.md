# Photo sources

All fallback catalog photos are Wikimedia Commons (or Openverse CC) files.
They are downloaded, background-removed, and composited onto a uniform
studio field (`#F3F5F8`, square, longest side 1600px). Staff uploads on
the product form replace these. The Latitude 2-in-1 pack is cropped to
the laptop (the Commons source also shows a docking base). Software
licences are left unmatched on purpose.

See `lib/catalog-photos.ts` for pack ids, match phrases, and file URLs.

Regenerate with:

```bash
npx tsx scripts/download-catalog-photos.ts
npx tsx scripts/download-catalog-photos.ts --force
```
