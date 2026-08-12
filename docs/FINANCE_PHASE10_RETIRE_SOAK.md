# Finance Phase 10 — Journal retire readiness + engine soak

**Status:** Guards and soak tooling only. Does **not** delete live `deed_journalEntries` and does **not** enable `ACCOUNTING_POSTING_ENGINE` by default.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Retire checklist | `lib/accounting/journal-retire-readiness.ts` | Blockers while store still blob-writes |
| Parity API | `GET /api/admin/journal-parity` | Includes `retireReadiness` |
| Retire gate | `POST /api/admin/blob-cutover` `retire` | Journals → 409 unless readiness passes |
| Soak report | `lib/accounting/posting-soak.ts` + `GET /api/admin/posting-engine-soak` | Surfaces + builder self-check; read-only |

## Journal retire

Today `storeStillBlobWrites=true` and `writersMigratedOffBlob=false` are hardcoded, so **`retireReady` stays false**. Typed `RETIRE deed_journalEntries` alone cannot delete the live key.

Future writer cutover must flip those flags (and preferably soak the engine) before retire can succeed.

## Engine soak (staging)

1. `GET /api/admin/posting-engine-soak` — confirm `enabled: false` and builder self-check OK.
2. Staging only: set `ACCOUNTING_POSTING_ENGINE=true` in process env, restart app.
3. Smoke invoice / payment / expense / POS; `GET /api/admin/journal-parity`.
4. Disable flag and restart if drift appears.
5. Never commit secrets; never change `.env.example` default to on.

## Tests

```bash
npm test -- --run __tests__/journal-retire-soak.test.ts __tests__/journal-parity.test.ts
```

## Not in this phase

- Deleting Contabo (or any) live `deed_journalEntries`
- Migrating `store.tsx` journal writers off blob
- Default-on posting engine
- Removing blob report toggles
