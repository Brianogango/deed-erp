# Deed ERP — API Reference

| | |
|---|---|
| **Document** | ERP API Reference (supporting document to [`DEED_ERP_SYSTEM_DOCUMENTATION.md`](./DEED_ERP_SYSTEM_DOCUMENTATION.md)) |
| **Repository / branch / commit reviewed** | `brianogango/deed-erp` · `claude/focused-einstein-lqo6u8` · `1713b7bf39c24703b8f5ab986104868d9de89b87` |
| **Review date** | 2026-10-01 |
| **Scope** | Every `app/api/**/route.ts` file: **270 route files, 410 method-level handlers** (plus the NextAuth catch-all `app/api/auth/[...nextauth]/route.ts`, which exports `GET`/`POST` through `NextAuth(authOptions)`). |

> **How this reference was produced.** The endpoint inventory (route, HTTP methods, gate, persistence touched, in-repo caller) was extracted by static analysis of the route files and then spot-verified by reading the handlers named in the "Verified detail" section. The *gate* column reflects the check found **inside the handler (or its shared helper)**; the global middleware checks described in §1 apply to all of them in addition. Where the table says `(file-level)` the gate was found in the same file but not inside that exact method body — read the source before relying on it. "In-repo caller: **none found**" means a static string search of `components/`, `lib/`, `hooks/` and `app/**/*.tsx` found no reference to the path; it does **not** prove the route is unused (cron, webhook, operator and external callers are not searched). Request/response payload shapes are documented in full only for the endpoints in §3; for all others the handler source linked in the last column is authoritative (**payload detail not individually verified**).

Abbreviations in the *Gate* column: `DIR` director · `ADM` admin_officer · `FIN` finance_officer · `INV` inventory_officer · `TL` technical_lead · `TECH` technician · `SALES` sales_rep · `KIL` kilimall_officer. `DIR*` = director including the `super_admin` alias. `perm:<name>` refers to `roleMatrix` in `lib/auth/authorization.ts` (see [`ERP_ROLES_AND_PERMISSIONS.md`](./ERP_ROLES_AND_PERMISSIONS.md)).

## 1. Cross-cutting behaviour (applies to every route)

| Concern | Behaviour | Evidence |
|---|---|---|
| Authentication | Session is a signed JWT in the `deed-session` cookie (`httpOnly`, `sameSite=lax`, `secure` when the configured app URL is https). Middleware rejects `/api/*` requests without a valid token with `401 {"error":"Unauthorized"}`. | `middleware.ts`, `lib/auth/auth-options.ts` |
| Public paths | `/login`, `/track*`, `/portal*`, `/api/portal/repair*`, `/api/portal/quotes*`, `/api/portal/intake*`, `/api/webhooks/notifications*`, `/sales-prototype*`, `/api/auth/login`, `/api/auth/logout`, `/api/setup-admin`, `/api/mpesa/callback`, `/api/version`, `POST /api/metrics/http`, `/api/public/*` (partner API key). Each public route is expected to authenticate itself. | `middleware.ts` (`PUBLIC_*`) |
| Internal-secret paths | `x-internal-secret: <INTERNAL_API_SECRET>` bypasses the session check **only** for the 7 paths in `INTERNAL_SECRET_API_PATHS` (`/api/admin/backfill-repairs`, `/backfill-accounting`, `/journal-mirror-failures`, `/blob-cleanup`, `/blob-transfer`, `/api/accounting/orphaned-invoice-journals`, `/api/notifications/send`). The route must re-check the header. | `middleware.ts` |
| Cron | `/api/cron/*` accepts `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`; the handlers fall back to a DIR/ADM session. | `middleware.ts`, `app/api/cron/*/route.ts` |
| Session revocation | Middleware evaluates `evaluateSessionAccess` (shared validity cache, per-user `sessionVersion`); revoked/inactive users get `401`. Cache miss fails open to a DB check in `getServerSession`. | `lib/auth/session-validity.ts` |
| MFA | When `MFA_ENFORCE_PRIVILEGED=true`, `director`, `admin_officer`, `finance_officer` tokens without `mfaVerified` receive `401 {"code":"MFA_REQUIRED"}`. | `lib/auth/mfa-policy.ts`, `middleware.ts` |
| CSRF / origin | Authenticated writes: `Sec-Fetch-Site: cross-site` → `403 cross_site_write`; an `Origin` header that does not match the forwarded host → `403 origin_mismatch`. A request with **no** `Origin` header is allowed. No CSRF token. | `lib/input-security.ts` `assertSameOriginBrowserWrite` |
| Input envelope | `assertSafeRequestEnvelope` validates URL/query and inspects write bodies for every request before routing (size/depth/key limits via `readSafeJson`). | `lib/input-security.ts`, `middleware.ts` |
| Rate limits | Login 10/min/IP (120 under `E2E_RELAX_RATE_LIMIT`); `/api/store` writes 60/min; `/api/store/stream` 360/min; other writes 240/min; reads 1200/min; `/api/admin/reset` and `/blob-cutover` 3/hour; Jarvis chat 20/min, ingest 5/hour; partner API 120/min (images 600/min). Backing store is Upstash Redis when `UPSTASH_REDIS_REST_*` is set, **otherwise per-process memory** (not shared across the two PM2 workers). | `middleware.ts` `rateLimitPolicy`, `lib/rate-limit.ts` |
| Error shape | Handlers wrapped in `withApiErrorHandling` return `{"error": "<message>"}` with the thrown `status` (4xx message passed through; 5xx masked as `Internal server error`). `401` from `getRequiredSession`, `403` from `requireRole`/`assertPermission`, `409` for conflicts (fiscal lock, optimistic lock, immutability), `422` for validation, `429` from rate limits. Several older routes return their own ad-hoc `{"error": ...}` bodies. | `lib/auth/api.ts` |
| Optimistic locking | `Invoice`, `SaleOrder`, `PurchaseOrder` carry `lockVersion`; `PUT/PATCH` with a stale version → `409 Record was modified by another user`. `/api/store` supports `If-Match`/`_version` (`409 conflict`). | `lib/optimistic-lock.ts`, `app/api/store/route.ts` |
| Fiscal lock | Any journal creation checks `FiscalLock.lockDate` and closed/locked `FiscalPeriod`s → `409`. Several routes also pre-check with `checkFiscalLock`. | `lib/accounting/journal-service.ts`, `lib/fiscal-lock.server.ts` |
| Pagination | List routes backed by Prisma use `parsePaginationParams` (`page`, `limit`, `sort`, `order`); blob-backed collection routes paginate in memory (`makeCollectionHandlers`). `GET /api/store` returns whole collections (no pagination). | `lib/api-pagination.ts`, `lib/server-store-crud.ts` |

## 2. Endpoint inventory by module

### Authentication & platform

9 route files · 10 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| (auth lib) | `/api/auth/[...nextauth]` | ? | — | `c/AppShell.tsx`, `c/auth/PasswordChangeScreen.tsx` | NextAuth catch-all (session/csrf/providers endpoints) — `app/api/auth/[...nextauth]/route.ts` |
| POST | `/api/auth/login` | public (rate-limited) | — | `c/auth/PasswordChangeScreen.tsx`, `c/auth/SecureLogin.tsx` | Create — auth / login — `app/api/auth/login/route.ts` |
| POST | `/api/auth/logout` | public | raw SQL | `lib/auth/client.ts`, `lib/store.tsx` | Create — auth / logout — `app/api/auth/logout/route.ts` |
| POST | `/api/auth/mfa/enroll` | MFA challenge cookie | — | `c/auth/SecureLogin.tsx`, `cm/Login.tsx` | Create — auth / mfa / enroll — `app/api/auth/mfa/enroll/route.ts` |
| POST | `/api/auth/mfa/verify` | MFA challenge cookie | — | `c/auth/SecureLogin.tsx`, `cm/Login.tsx` | Action: verify (auth) — `app/api/auth/mfa/verify/route.ts` |
| GET | `/api/auth/session-status` | session-only (no role check) | raw SQL | `c/AppShell.tsx` | List / read — auth / session status — `app/api/auth/session-status/route.ts` |
| POST | `/api/auth/session-status` | session + inline role/module logic (verify in source) | raw SQL | `c/AppShell.tsx` | Create — auth / session status — `app/api/auth/session-status/route.ts` |
| GET | `/api/metrics/http` | role:[DIR,ADM] | — | `c/Http404Beacon.tsx` | List / read — metrics / http — `app/api/metrics/http/route.ts` |
| POST | `/api/metrics/http` | public beacon (rate-limited in middleware) | — | `c/Http404Beacon.tsx` | Create — metrics / http — `app/api/metrics/http/route.ts` |
| POST | `/api/setup-admin` | secret:setup | raw SQL | **none found** | Create — setup admin — `app/api/setup-admin/route.ts` |
| GET | `/api/version` | public | — | `c/layout/VersionDriftBanner.tsx` | List / read — version — `app/api/version/route.ts` |

### Administration & users

25 route files · 36 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| GET | `/api/admin/audit` | role:DIR | app_state/store | **none found** | Read: audit (admin) — `app/api/admin/audit/route.ts` |
| POST | `/api/admin/backfill-accounting` | role:DIR + secret:internal | app_state/store | **none found** | Create — admin / backfill accounting — `app/api/admin/backfill-accounting/route.ts` |
| POST | `/api/admin/backfill-repair-parts-cogs` | role:DIR | app_state/store | **none found** | POST /api/admin/backfill-repair-parts-cogs — `app/api/admin/backfill-repair-parts-cogs/route.ts` |
| POST | `/api/admin/backfill-repairs` | role:DIR + secret:internal | app_state/store | **none found** | POST /api/admin/backfill-repairs — `app/api/admin/backfill-repairs/route.ts` |
| GET | `/api/admin/blob-cleanup` | role:[DIR] (file-level) + secret:internal (file-level) | — | **none found** | List / read — admin / blob cleanup — `app/api/admin/blob-cleanup/route.ts` |
| POST | `/api/admin/blob-cleanup` | role:[DIR] (file-level) + secret:internal (file-level) | — | **none found** | Create — admin / blob cleanup — `app/api/admin/blob-cleanup/route.ts` |
| GET | `/api/admin/blob-cutover` | role:[DIR] (file-level) | — | `cm/settings/CurrencyPricelistCutover.tsx` | List / read — admin / blob cutover — `app/api/admin/blob-cutover/route.ts` |
| POST | `/api/admin/blob-cutover` | role:[DIR] (file-level) | — | `cm/settings/CurrencyPricelistCutover.tsx` | Create — admin / blob cutover — `app/api/admin/blob-cutover/route.ts` |
| GET | `/api/admin/blob-transfer` | role:[DIR] (file-level) + secret:internal (file-level) | — | `lib/domain-source-of-truth.ts` | List / read — admin / blob transfer — `app/api/admin/blob-transfer/route.ts` |
| POST | `/api/admin/blob-transfer` | role:[DIR] (file-level) + secret:internal (file-level) | — | `lib/domain-source-of-truth.ts` | Create — admin / blob transfer — `app/api/admin/blob-transfer/route.ts` |
| POST | `/api/admin/invalidate-sessions` | role:[DIR,ADM] | — | **none found** | POST /api/admin/invalidate-sessions — `app/api/admin/invalidate-sessions/route.ts` |
| GET | `/api/admin/journal-mirror-failures` | role:DIR (file-level) + secret:internal (file-level) | app_state/store | **none found** | List / read — admin / journal mirror failures — `app/api/admin/journal-mirror-failures/route.ts` |
| POST | `/api/admin/journal-mirror-failures` | session-only (no role check) | app_state/store | **none found** | Create — admin / journal mirror failures — `app/api/admin/journal-mirror-failures/route.ts` |
| GET | `/api/admin/journal-parity` | role:[DIR,FIN] | — | `cm/Accounting.tsx`, `lib/accounting/posting-soak.ts` | GET /api/admin/journal-parity — `app/api/admin/journal-parity/route.ts` |
| GET | `/api/admin/notifications/policies` | role:[DIR,ADM,DIR*] | — | `cm/settings/NotificationOperationsPanel.tsx` | List / read — admin / notifications / policies — `app/api/admin/notifications/policies/route.ts` |
| GET | `/api/admin/notifications` | role:[DIR,ADM,DIR*] | notificationDelivery, notificationDeadLetter, notificationOutbox, notificationEvent, notificationTemplate | `cm/settings/NotificationOperationsPanel.tsx` | List / read — admin / notifications — `app/api/admin/notifications/route.ts` |
| POST | `/api/admin/notifications` | role:[DIR,ADM,DIR*] | notificationDelivery, notificationDeadLetter, notificationOutbox, notificationEvent, notificationTemplate | `cm/settings/NotificationOperationsPanel.tsx` | Create — admin / notifications — `app/api/admin/notifications/route.ts` |
| GET | `/api/admin/notifications/templates` | role:[DIR,ADM,DIR*] | notificationTemplate | `cm/settings/NotificationOperationsPanel.tsx` | List / read — admin / notifications / templates — `app/api/admin/notifications/templates/route.ts` |
| POST | `/api/admin/notifications/templates` | role:[DIR,ADM,DIR*] | notificationTemplate | `cm/settings/NotificationOperationsPanel.tsx` | Create — admin / notifications / templates — `app/api/admin/notifications/templates/route.ts` |
| GET | `/api/admin/posting-engine-soak` | role:[DIR,FIN] | — | **none found** | GET /api/admin/posting-engine-soak — `app/api/admin/posting-engine-soak/route.ts` |
| POST | `/api/admin/reset` | role:[DIR] | raw SQL | `cm/Settings.tsx` | Create — admin / reset — `app/api/admin/reset/route.ts` |
| GET | `/api/admin/security/env` | role:DIR (file-level) | — | `cm/settings/ProductionEnvSettings.tsx`, `cm/settings/SecuritySettingsDashboard.tsx` | List / read — admin / security / env — `app/api/admin/security/env/route.ts` |
| PUT | `/api/admin/security/env` | role:DIR (file-level) | — | `cm/settings/ProductionEnvSettings.tsx`, `cm/settings/SecuritySettingsDashboard.tsx` | Replace / update — admin / security / env — `app/api/admin/security/env/route.ts` |
| GET | `/api/admin/security/overview` | role:[DIR,ADM,FIN] | raw SQL | `cm/settings/SecuritySettingsDashboard.tsx` | List / read — admin / security / overview — `app/api/admin/security/overview/route.ts` |
| GET | `/api/admin/security/provenance` | role:DIR | — | **none found** | Read: provenance (admin) — `app/api/admin/security/provenance/route.ts` |
| DELETE | `/api/admin/security/sessions/[id]` | role:DIR | raw SQL | `cm/settings/SecuritySettingsDashboard.tsx` | Delete / void — admin / security / sessions — `app/api/admin/security/sessions/[id]/route.ts` |
| DELETE | `/api/admin/security/sessions` | role:DIR | raw SQL | `cm/settings/SecuritySettingsDashboard.tsx` | Delete / void — admin / security / sessions — `app/api/admin/security/sessions/route.ts` |
| GET | `/api/admin/sms/messages` | role (allowedRoles, see source) | communicationThread, notificationDelivery | `cm/settings/SmsMessageCenter.tsx` | List / read — admin / sms / messages — `app/api/admin/sms/messages/route.ts` |
| POST | `/api/admin/sms/messages` | role (allowedRoles, see source) | communicationThread, notificationDelivery | `cm/settings/SmsMessageCenter.tsx` | Create — admin / sms / messages — `app/api/admin/sms/messages/route.ts` |
| DELETE | `/api/admin/users/[id]/mfa` | perm:manageUsers | — | **none found** | Delete / void — admin / users / mfa — `app/api/admin/users/[id]/mfa/route.ts` |
| POST | `/api/users/[id]/resend-credentials` | perm:manageUsers | — | `lib/store.tsx` | POST /api/users/[id]/resend-credentials — `app/api/users/[id]/resend-credentials/route.ts` |
| PATCH | `/api/users/[id]` | perm:manageUsers | — | `c/auth/PasswordChangeScreen.tsx`, `lib/auth/client-users.ts` | Update — users — `app/api/users/[id]/route.ts` |
| DELETE | `/api/users/[id]` | perm:manageUsers | — | `c/auth/PasswordChangeScreen.tsx`, `lib/auth/client-users.ts` | Delete / void — users — `app/api/users/[id]/route.ts` |
| POST | `/api/users/[id]` | perm:manageUsers | — | `c/auth/PasswordChangeScreen.tsx`, `lib/auth/client-users.ts` | Create child / action on — users — `app/api/users/[id]/route.ts` |
| GET | `/api/users` | perm:viewUsers | employee | `c/auth/PasswordChangeScreen.tsx`, `lib/auth/client-users.ts` | List / read — users — `app/api/users/route.ts` |
| POST | `/api/users` | perm:manageUsers | employee | `c/auth/PasswordChangeScreen.tsx`, `lib/auth/client-users.ts` | Create — users — `app/api/users/route.ts` |

### Shared store (legacy sync) & numbering

6 route files · 8 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| POST | `/api/doc-numbers` | session-only (no role check) | — | `lib/doc-numbers.ts` | Create — doc numbers — `app/api/doc-numbers/route.ts` |
| GET | `/api/store/[key]` | session + store ACL (canReadStoreKey / canWriteStoreKey, row slicing) | app_state/store | `cm/HRSettings.tsx`, `cm/Settings.tsx` | Read one — store — `app/api/store/[key]/route.ts` |
| PUT | `/api/store/[key]` | session + store ACL (canReadStoreKey / canWriteStoreKey, row slicing) | app_state/store | `cm/HRSettings.tsx`, `cm/Settings.tsx` | Replace / update — store — `app/api/store/[key]/route.ts` |
| GET | `/api/store/provenance` | session + store ACL (canReadStoreKey / canWriteStoreKey, row slicing) | app_state/store | **none found** | Read: provenance (store) — `app/api/store/provenance/route.ts` |
| GET | `/api/store/restore-preview` | session + store ACL (canReadStoreKey / canWriteStoreKey, row slicing) | app_state/store | **none found** | List / read — store / restore preview — `app/api/store/restore-preview/route.ts` |
| GET | `/api/store` | session + store ACL (canReadStoreKey / canWriteStoreKey, row slicing) | app_state/store | `cm/HRSettings.tsx`, `cm/Settings.tsx` | List / read — store — `app/api/store/route.ts` |
| POST | `/api/store` | session + store ACL (canReadStoreKey / canWriteStoreKey, row slicing) | app_state/store | `cm/HRSettings.tsx`, `cm/Settings.tsx` | Create — store — `app/api/store/route.ts` |
| GET | `/api/store/stream` | session + store ACL (canReadStoreKey / canWriteStoreKey, row slicing) | app_state/store | `lib/store.tsx` | GET /api/store/stream — `app/api/store/stream/route.ts` |

### Contacts, CRM, quotations & sales orders

36 route files · 73 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| GET | `/api/activities` | = /api/opportunity-activities (re-export) | → /api/opportunity-activities | `lib/api-pagination.ts`, `lib/store.tsx` | List / read — activities — `app/api/activities/route.ts` |
| POST | `/api/activities` | = /api/opportunity-activities (re-export) | → /api/opportunity-activities | `lib/api-pagination.ts`, `lib/store.tsx` | Create — activities — `app/api/activities/route.ts` |
| GET | `/api/chatter` | session-only (no role check) | documentMessage, documentActivity | `c/erp/Chatter.tsx` | List / read — chatter — `app/api/chatter/route.ts` |
| POST | `/api/chatter` | session-only (no role check) | documentMessage, documentActivity | `c/erp/Chatter.tsx` | Create — chatter — `app/api/chatter/route.ts` |
| PUT | `/api/companies/[id]` | session-only (no role check) | client; app_state/store | `lib/hooks/index.ts`, `lib/store.tsx` | Replace / update — companies — `app/api/companies/[id]/route.ts` |
| DELETE | `/api/companies/[id]` | session-only (no role check) | client; app_state/store | `lib/hooks/index.ts`, `lib/store.tsx` | Delete / void — companies — `app/api/companies/[id]/route.ts` |
| GET | `/api/companies` | session-only (no role check) | client; app_state/store | `lib/hooks/index.ts`, `lib/store.tsx` | List / read — companies — `app/api/companies/route.ts` |
| POST | `/api/companies` | session-only (no role check) | client; app_state/store | `lib/hooks/index.ts`, `lib/store.tsx` | Create — companies — `app/api/companies/route.ts` |
| GET | `/api/contact-persons/[id]` | session-only (no role check) | client | **none found** | Read one — contact persons — `app/api/contact-persons/[id]/route.ts` |
| PUT | `/api/contact-persons/[id]` | session-only (no role check) | client | **none found** | Replace / update — contact persons — `app/api/contact-persons/[id]/route.ts` |
| PATCH | `/api/contact-persons/[id]` | session-only (no role check) | client | **none found** | Update — contact persons — `app/api/contact-persons/[id]/route.ts` |
| DELETE | `/api/contact-persons/[id]` | session-only (no role check) | client | **none found** | Delete / void — contact persons — `app/api/contact-persons/[id]/route.ts` |
| GET | `/api/contact-persons` | session-only (no role check) | client | **none found** | List / read — contact persons — `app/api/contact-persons/route.ts` |
| POST | `/api/contact-persons` | session-only (no role check) | client | **none found** | Create — contact persons — `app/api/contact-persons/route.ts` |
| POST | `/api/contacts/[id]/archive` | role:[DIR,ADM] | client | `cm/Contacts.tsx`, `lib/store.tsx` | Action: archive (contacts) — `app/api/contacts/[id]/archive/route.ts` |
| POST | `/api/contacts/[id]/restore` | role:[DIR,ADM] | client | `cm/Contacts.tsx`, `lib/store.tsx` | Action: restore (contacts) — `app/api/contacts/[id]/restore/route.ts` |
| GET | `/api/contacts/[id]` | session-only (no role check) | client | `cm/Contacts.tsx`, `lib/hooks/index.ts` | Read one — contacts — `app/api/contacts/[id]/route.ts` |
| PATCH | `/api/contacts/[id]` | role:[DIR,ADM,FIN,SALES] | client | `cm/Contacts.tsx`, `lib/hooks/index.ts` | Update — contacts — `app/api/contacts/[id]/route.ts` |
| PUT | `/api/contacts/[id]` | role:[DIR,ADM,FIN,SALES] | client | `cm/Contacts.tsx`, `lib/hooks/index.ts` | Replace / update — contacts — `app/api/contacts/[id]/route.ts` |
| DELETE | `/api/contacts/[id]` | role:[DIR,ADM,FIN,SALES] | client | `cm/Contacts.tsx`, `lib/hooks/index.ts` | Delete / void — contacts — `app/api/contacts/[id]/route.ts` |
| POST | `/api/contacts/merge` | role:[DIR] | client | **none found** | Action: merge (contacts) — `app/api/contacts/merge/route.ts` |
| GET | `/api/contacts` | session-only (no role check) | — | `cm/Contacts.tsx`, `lib/hooks/index.ts` | List / read — contacts — `app/api/contacts/route.ts` |
| POST | `/api/contacts` | role:[DIR,ADM,FIN,SALES] | — | `cm/Contacts.tsx`, `lib/hooks/index.ts` | Create — contacts — `app/api/contacts/route.ts` |
| GET | `/api/crm/duplicate-contacts` | role:[DIR,ADM,SALES,sales,FIN,super_admin] | — | `c/crm/DuplicateContactsPanel.tsx` | List / read — crm / duplicate contacts — `app/api/crm/duplicate-contacts/route.ts` |
| POST | `/api/crm/duplicate-contacts` | role:[DIR,ADM,super_admin] | — | `c/crm/DuplicateContactsPanel.tsx` | Create — crm / duplicate contacts — `app/api/crm/duplicate-contacts/route.ts` |
| GET | `/api/crm/email-review` | session-only (no role check) | salesInboundEmail, lead, user; app_state/store | `c/crm/EmailReviewPanel.tsx` | List / read — crm / email review — `app/api/crm/email-review/route.ts` |
| POST | `/api/crm/email-review` | role:[DIR,ADM,SALES,sales] | salesInboundEmail, lead, user; app_state/store | `c/crm/EmailReviewPanel.tsx` | Create — crm / email review — `app/api/crm/email-review/route.ts` |
| GET | `/api/leads/[id]/attachments` | session-only (no role check) | lead | `c/crm/LeadsPanel.tsx` | GET /api/leads/[id]/attachments — `app/api/leads/[id]/attachments/route.ts` |
| GET | `/api/leads/[id]` | session-only (no role check) | opportunity, lead, client, contactPerson; app_state/store | `c/crm/LeadsPanel.tsx` | Read one — leads — `app/api/leads/[id]/route.ts` |
| PUT | `/api/leads/[id]` | role:[DIR,ADM,SALES,FIN] | opportunity, lead, client, contactPerson; app_state/store | `c/crm/LeadsPanel.tsx` | Replace / update — leads — `app/api/leads/[id]/route.ts` |
| DELETE | `/api/leads/[id]` | role:[DIR,ADM,SALES,FIN] | opportunity, lead, client, contactPerson; app_state/store | `c/crm/LeadsPanel.tsx` | Delete / void — leads — `app/api/leads/[id]/route.ts` |
| POST | `/api/leads/[id]` | role:[DIR,ADM,SALES,FIN] | opportunity, lead, client, contactPerson; app_state/store | `c/crm/LeadsPanel.tsx` | Create child / action on — leads — `app/api/leads/[id]/route.ts` |
| GET | `/api/leads` | session-only (no role check) | lead, user; app_state/store | `c/crm/LeadsPanel.tsx` | List / read — leads — `app/api/leads/route.ts` |
| POST | `/api/leads` | role:[DIR,ADM,SALES,FIN] | lead, user; app_state/store | `c/crm/LeadsPanel.tsx` | Create — leads — `app/api/leads/route.ts` |
| GET | `/api/opportunities/[id]` | session + inline role/module logic (verify in source) | opportunity; app_state/store | `c/crm/LeadsPanel.tsx`, `lib/store.tsx` | Read one — opportunities — `app/api/opportunities/[id]/route.ts` |
| PUT | `/api/opportunities/[id]` | role:[DIR,ADM,SALES] | opportunity; app_state/store | `c/crm/LeadsPanel.tsx`, `lib/store.tsx` | Replace / update — opportunities — `app/api/opportunities/[id]/route.ts` |
| PATCH | `/api/opportunities/[id]` | role:[DIR,ADM,SALES] (file-level) | opportunity; app_state/store | `c/crm/LeadsPanel.tsx`, `lib/store.tsx` | Update — opportunities — `app/api/opportunities/[id]/route.ts` |
| DELETE | `/api/opportunities/[id]` | role:[DIR,ADM,SALES] | opportunity; app_state/store | `c/crm/LeadsPanel.tsx`, `lib/store.tsx` | Delete / void — opportunities — `app/api/opportunities/[id]/route.ts` |
| GET | `/api/opportunities` | role:[DIR,ADM,FIN,KIL,TL,SALES] | opportunity; app_state/store | `c/crm/LeadsPanel.tsx`, `lib/store.tsx` | List / read — opportunities — `app/api/opportunities/route.ts` |
| POST | `/api/opportunities` | role:[DIR,ADM,SALES] | opportunity; app_state/store | `c/crm/LeadsPanel.tsx`, `lib/store.tsx` | Create — opportunities — `app/api/opportunities/route.ts` |
| PUT | `/api/opportunity-activities/[id]` | role:[DIR,ADM,SALES] | opportunityActivity; app_state/store | `lib/api-pagination.ts`, `lib/store.tsx` | Replace / update — opportunity activities — `app/api/opportunity-activities/[id]/route.ts` |
| PATCH | `/api/opportunity-activities/[id]` | role:[DIR,ADM,SALES] (file-level) | opportunityActivity; app_state/store | `lib/api-pagination.ts`, `lib/store.tsx` | Update — opportunity activities — `app/api/opportunity-activities/[id]/route.ts` |
| DELETE | `/api/opportunity-activities/[id]` | role:[DIR,ADM,SALES] | opportunityActivity; app_state/store | `lib/api-pagination.ts`, `lib/store.tsx` | Delete / void — opportunity activities — `app/api/opportunity-activities/[id]/route.ts` |
| GET | `/api/opportunity-activities` | session-only (no role check) | opportunityActivity, opportunity; app_state/store | `lib/api-pagination.ts`, `lib/store.tsx` | List / read — opportunity activities — `app/api/opportunity-activities/route.ts` |
| POST | `/api/opportunity-activities` | session-only (no role check) | opportunityActivity, opportunity; app_state/store | `lib/api-pagination.ts`, `lib/store.tsx` | Create — opportunity activities — `app/api/opportunity-activities/route.ts` |
| GET | `/api/quotes/[id]` | session-only (no role check) | quote; app_state/store | `lib/jarvis/tools/draft-quotation.ts`, `lib/store.tsx` | Read one — quotes — `app/api/quotes/[id]/route.ts` |
| PUT | `/api/quotes/[id]` | session + inline role/module logic (verify in source) | quote; app_state/store | `lib/jarvis/tools/draft-quotation.ts`, `lib/store.tsx` | Replace / update — quotes — `app/api/quotes/[id]/route.ts` |
| PATCH | `/api/quotes/[id]` | role:[DIR,ADM,FIN,SALES,TL] (file-level) | quote; app_state/store | `lib/jarvis/tools/draft-quotation.ts`, `lib/store.tsx` | Update — quotes — `app/api/quotes/[id]/route.ts` |
| DELETE | `/api/quotes/[id]` | role:[DIR,ADM,FIN,SALES,TL] | quote; app_state/store | `lib/jarvis/tools/draft-quotation.ts`, `lib/store.tsx` | Delete / void — quotes — `app/api/quotes/[id]/route.ts` |
| GET | `/api/quotes` | session-only (no role check) | quote; app_state/store | `lib/jarvis/tools/draft-quotation.ts`, `lib/store.tsx` | List / read — quotes — `app/api/quotes/route.ts` |
| POST | `/api/quotes` | session + inline role/module logic (verify in source) | quote; app_state/store | `lib/jarvis/tools/draft-quotation.ts`, `lib/store.tsx` | Create — quotes — `app/api/quotes/route.ts` |
| POST | `/api/quotes/send` | session-only (JWT via middleware; no role check) ⚠ | — | **none found** | POST /api/quotes/send — `app/api/quotes/send/route.ts` |
| GET | `/api/sale-order-attachments/[soId]` | session-only (no role check) | app_state/store | `cm/Sales.tsx` | Read one — sale order attachments — `app/api/sale-order-attachments/[soId]/route.ts` |
| POST | `/api/sale-order-attachments/[soId]` | session-only (no role check) | app_state/store | `cm/Sales.tsx` | Create child / action on — sale order attachments — `app/api/sale-order-attachments/[soId]/route.ts` |
| DELETE | `/api/sale-order-attachments/[soId]` | session-only (no role check) | app_state/store | `cm/Sales.tsx` | Delete / void — sale order attachments — `app/api/sale-order-attachments/[soId]/route.ts` |
| POST | `/api/sale-orders/[id]/create-invoice` | role:[DIR,FIN,ADM] | saleOrder, repair, invoice, product, saleOrderItem; app_state/store | `lib/sales/create-invoice-request.ts`, `lib/store.tsx` | Action: create invoice (sale-orders) — `app/api/sale-orders/[id]/create-invoice/route.ts` |
| POST | `/api/sale-orders/[id]/credit-note` | role:[DIR,FIN] | saleOrder, invoice | `lib/store.tsx` | Action: credit note (sale-orders) — `app/api/sale-orders/[id]/credit-note/route.ts` |
| POST | `/api/sale-orders/[id]/deliver-lines` | role:[DIR,ADM,INV,SALES] | saleOrder, saleOrderItem; app_state/store | `cm/Sales.tsx`, `lib/store.tsx` | POST /api/sale-orders/:id/deliver-lines — `app/api/sale-orders/[id]/deliver-lines/route.ts` |
| POST | `/api/sale-orders/[id]/new-version` | role:[DIR,ADM,FIN,SALES] | saleOrder; app_state/store | `lib/store.tsx` | Action: new version (sale-orders) — `app/api/sale-orders/[id]/new-version/route.ts` |
| GET | `/api/sale-orders/[id]/reconfiguration` | session-only (no role check) | — | `cm/Sales.tsx`, `lib/reconfiguration/sales-bridge.ts` | List / read — sale orders / reconfiguration — `app/api/sale-orders/[id]/reconfiguration/route.ts` |
| POST | `/api/sale-orders/[id]/reconfiguration` | role:[DIR,ADM,SALES,TL,INV] | — | `cm/Sales.tsx`, `lib/reconfiguration/sales-bridge.ts` | Create — sale orders / reconfiguration — `app/api/sale-orders/[id]/reconfiguration/route.ts` |
| GET | `/api/sale-orders/[id]` | session + inline role/module logic (verify in source) | saleOrder, invoice, stockReservation; app_state/store | `cm/Sales.tsx`, `lib/api-pagination.ts` | Read one — sale orders — `app/api/sale-orders/[id]/route.ts` |
| PUT | `/api/sale-orders/[id]` | role:[…WRITE_ROLES] | saleOrder, invoice, stockReservation; app_state/store | `cm/Sales.tsx`, `lib/api-pagination.ts` | Replace / update — sale orders — `app/api/sale-orders/[id]/route.ts` |
| PATCH | `/api/sale-orders/[id]` | role:[DIR,ADM,FIN,SALES,TL] (file-level) + role:[DIR,ADM,FIN,SALES,TL] (file-level) + role:DIR (file-level) | saleOrder, invoice, stockReservation; app_state/store | `cm/Sales.tsx`, `lib/api-pagination.ts` | Update — sale orders — `app/api/sale-orders/[id]/route.ts` |
| DELETE | `/api/sale-orders/[id]` | session + inline role/module logic (verify in source) | saleOrder, invoice, stockReservation; app_state/store | `cm/Sales.tsx`, `lib/api-pagination.ts` | Delete / void — sale orders — `app/api/sale-orders/[id]/route.ts` |
| GET | `/api/sale-orders/[id]/versions` | session-only (no role check) | saleOrder | `cm/Sales.tsx` | Read: versions (sale-orders) — `app/api/sale-orders/[id]/versions/route.ts` |
| GET | `/api/sale-orders` | role:[DIR,ADM,FIN,SALES,TL] | saleOrder, product; app_state/store | `cm/Sales.tsx`, `lib/api-pagination.ts` | List / read — sale orders — `app/api/sale-orders/route.ts` |
| POST | `/api/sale-orders` | role:[DIR,ADM,FIN,SALES,TL] | saleOrder, product; app_state/store | `cm/Sales.tsx`, `lib/api-pagination.ts` | Create — sale orders — `app/api/sale-orders/route.ts` |
| GET | `/api/sales-commissions` | role:[DIR,FIN,ADM] | user, salesCommission | `cm/RepPerformance.tsx`, `cm/accounting/CommissionsTab.tsx` | List / read — sales commissions — `app/api/sales-commissions/route.ts` |
| GET | `/api/sales` | = /api/sale-orders (re-export) | → /api/sale-orders | `cm/RepPerformance.tsx`, `cm/accounting/CommissionsTab.tsx` | List / read — sales — `app/api/sales/route.ts` |
| POST | `/api/sales` | = /api/sale-orders (re-export) | → /api/sale-orders | `cm/RepPerformance.tsx`, `cm/accounting/CommissionsTab.tsx` | Create — sales — `app/api/sales/route.ts` |
| GET | `/api/salespeople` | role:[DIR,ADM,FIN,SALES,TL,KIL] | — | `c/sales/SalespersonCloserField.tsx` | List / read — salespeople — `app/api/salespeople/route.ts` |
| GET | `/api/salesperson-sales` | session + inline role/module logic (verify in source) | user, salesCommission; app_state/store | `cm/accounting/CommissionsTab.tsx` | List / read — salesperson sales — `app/api/salesperson-sales/route.ts` |

### Purchasing

8 route files · 17 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| GET | `/api/purchase-orders/[id]` | session-only (no role check) | purchaseOrder, grnItem | `lib/api-pagination.ts`, `lib/auth/authorization.ts` | Read one — purchase orders — `app/api/purchase-orders/[id]/route.ts` |
| PATCH | `/api/purchase-orders/[id]` | role:[DIR,ADM,FIN,INV,TL] (imported) | purchaseOrder, grnItem | `lib/api-pagination.ts`, `lib/auth/authorization.ts` | Update — purchase orders — `app/api/purchase-orders/[id]/route.ts` |
| PUT | `/api/purchase-orders/[id]` | role:[DIR,ADM,FIN,INV,TL] (file-level) | purchaseOrder, grnItem | `lib/api-pagination.ts`, `lib/auth/authorization.ts` | Replace / update — purchase orders — `app/api/purchase-orders/[id]/route.ts` |
| DELETE | `/api/purchase-orders/[id]` | role:[DIR,ADM,FIN,INV,TL] (imported) | purchaseOrder, grnItem | `lib/api-pagination.ts`, `lib/auth/authorization.ts` | Delete / void — purchase orders — `app/api/purchase-orders/[id]/route.ts` |
| GET | `/api/purchase-orders` | session-only (no role check) | purchaseOrder | `lib/api-pagination.ts`, `lib/auth/authorization.ts` | List / read — purchase orders — `app/api/purchase-orders/route.ts` |
| POST | `/api/purchase-orders` | role:[DIR,ADM,FIN,INV,TL] (imported) | purchaseOrder | `lib/api-pagination.ts`, `lib/auth/authorization.ts` | Create — purchase orders — `app/api/purchase-orders/route.ts` |
| GET | `/api/purchase` | = /api/purchase-orders (re-export) | → /api/purchase-orders | `lib/api-pagination.ts`, `lib/auth/authorization.ts` | List / read — purchase — `app/api/purchase/route.ts` |
| POST | `/api/purchase` | = /api/purchase-orders (re-export) | → /api/purchase-orders | `lib/api-pagination.ts`, `lib/auth/authorization.ts` | Create — purchase — `app/api/purchase/route.ts` |
| GET | `/api/purchases` | = /api/purchase-orders (re-export) | → /api/purchase-orders | `lib/api-pagination.ts` | List / read — purchases — `app/api/purchases/route.ts` |
| POST | `/api/purchases` | = /api/purchase-orders (re-export) | → /api/purchase-orders | `lib/api-pagination.ts` | Create — purchases — `app/api/purchases/route.ts` |
| PATCH | `/api/receipts/[id]` | role:[DIR,ADM,FIN,INV,TL] | app_state/store | `lib/store.tsx` | Update — receipts — `app/api/receipts/[id]/route.ts` |
| PUT | `/api/receipts/[id]` | role:[DIR,ADM,FIN,INV,TL] (file-level) | app_state/store | `lib/store.tsx` | Replace / update — receipts — `app/api/receipts/[id]/route.ts` |
| DELETE | `/api/receipts/[id]` | role:[DIR,ADM,FIN,INV,TL] | app_state/store | `lib/store.tsx` | Delete / void — receipts — `app/api/receipts/[id]/route.ts` |
| GET | `/api/receipts` | session | store:deed_receipts | `lib/store.tsx` | List / read — receipts — `app/api/receipts/route.ts` |
| POST | `/api/receipts` | role:[DIR,ADM,FIN,INV,TL] | store:deed_receipts | `lib/store.tsx` | Create — receipts — `app/api/receipts/route.ts` |
| POST | `/api/scan-purchase-document` | session-only (no role check) | — | `cm/Purchase.tsx` | Create — scan purchase document — `app/api/scan-purchase-document/route.ts` |
| POST | `/api/scan-receipt` | session-only (no role check) | — | `cm/Expenses.tsx` | Create — scan receipt — `app/api/scan-receipt/route.ts` |

### Inventory, products & serials

28 route files · 42 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| GET | `/api/categories` | session-only (no role check) | category | `cm/settings/CommissionRatesSettings.tsx` | List / read — categories — `app/api/categories/route.ts` |
| PUT | `/api/categories` | role:[DIR,ADM,FIN] | category | `cm/settings/CommissionRatesSettings.tsx` | Replace / update — categories — `app/api/categories/route.ts` |
| POST | `/api/import` | role:DIR | app_state/store | `cm/Accounting.tsx` | Create — import — `app/api/import/route.ts` |
| POST | `/api/inventory/apply-adjustment-stock` | role:[DIR,ADM,INV,TL] | — | `lib/store.tsx` | Create — inventory / apply adjustment stock — `app/api/inventory/apply-adjustment-stock/route.ts` |
| POST | `/api/inventory/apply-customer-return-stock` | session + inline role/module logic (verify in source) | — | `lib/store.tsx` | Create — inventory / apply customer return stock — `app/api/inventory/apply-customer-return-stock/route.ts` |
| POST | `/api/inventory/apply-pos-stock` | session + inline role/module logic (verify in source) | — | `lib/store.tsx` | Create — inventory / apply pos stock — `app/api/inventory/apply-pos-stock/route.ts` |
| POST | `/api/inventory/apply-transfer-stock` | session + inline role/module logic (verify in source) | — | `lib/store.tsx` | Create — inventory / apply transfer stock — `app/api/inventory/apply-transfer-stock/route.ts` |
| POST | `/api/inventory/apply-vendor-return-stock` | session + inline role/module logic (verify in source) | — | `lib/store.tsx` | Create — inventory / apply vendor return stock — `app/api/inventory/apply-vendor-return-stock/route.ts` |
| GET | `/api/inventory/computer-aid` | session-only (no role check) | app_state/store | `c/inventory/ComputerAidCustodyPanel.tsx` | List / read — inventory / computer aid — `app/api/inventory/computer-aid/route.ts` |
| POST | `/api/inventory/computer-aid` | session-only (no role check) | app_state/store | `c/inventory/ComputerAidCustodyPanel.tsx` | Create — inventory / computer aid — `app/api/inventory/computer-aid/route.ts` |
| POST | `/api/inventory/consignments/[id]` | role:CONSIGNMENT_WRITE_ROLES (imported) | consignmentDevice, product | `c/inventory/VendorStockPanel.tsx` | Create child / action on — inventory / consignments — `app/api/inventory/consignments/[id]/route.ts` |
| GET | `/api/inventory/consignments` | role:CONSIGNMENT_READ_ROLES (imported) | consignmentDevice, client, product, purchaseOrder | `c/inventory/VendorStockPanel.tsx` | List / read — inventory / consignments — `app/api/inventory/consignments/route.ts` |
| POST | `/api/inventory/consignments` | role:CONSIGNMENT_WRITE_ROLES (imported) | consignmentDevice, client, product, purchaseOrder | `c/inventory/VendorStockPanel.tsx` | Create — inventory / consignments — `app/api/inventory/consignments/route.ts` |
| POST | `/api/inventory/intake-serials` | session + inline role/module logic (verify in source) | product, serialNumber; app_state/store | `lib/store.tsx` | POST /api/inventory/intake-serials — `app/api/inventory/intake-serials/route.ts` |
| POST | `/api/inventory/normalize-tags` | role:[DIR,ADM,INV,TL] | — | `lib/store.tsx` | Create — inventory / normalize tags — `app/api/inventory/normalize-tags/route.ts` |
| POST | `/api/inventory/post-opening-valuation` | role:[DIR,ADM,INV,TL] | — | `lib/store.tsx` | Create — inventory / post opening valuation — `app/api/inventory/post-opening-valuation/route.ts` |
| GET | `/api/inventory/stock-checkouts` | session + inline role/module logic (verify in source) | app_state/store | `c/inventory/StockCheckoutPanel.tsx` | List / read — inventory / stock checkouts — `app/api/inventory/stock-checkouts/route.ts` |
| POST | `/api/inventory/stock-checkouts` | session-only (no role check) | app_state/store | `c/inventory/StockCheckoutPanel.tsx` | Create — inventory / stock checkouts — `app/api/inventory/stock-checkouts/route.ts` |
| POST | `/api/inventory/validate-opening-stock` | session + inline role/module logic (verify in source) | app_state/store | `lib/store.tsx` | Create — inventory / validate opening stock — `app/api/inventory/validate-opening-stock/route.ts` |
| POST | `/api/inventory/validate-receipt` | perm:validatePurchaseReceipt | goodsReceivedNote; app_state/store | `lib/store.tsx` | Create — inventory / validate receipt — `app/api/inventory/validate-receipt/route.ts` |
| GET | `/api/inventory/valuation-report` | role:[DIR,FIN,ADM,INV] | productValuation; app_state/store | `cm/Inventory.tsx` | List / read — inventory / valuation report — `app/api/inventory/valuation-report/route.ts` |
| GET | `/api/products/[id]/images` | role:[DIR,ADM,INV,TL,FIN] | product | `c/inventory/ProductPhotoFields.tsx`, `cm/Inventory.tsx` | List / read — products / images — `app/api/products/[id]/images/route.ts` |
| POST | `/api/products/[id]/images` | role:[DIR,ADM,INV,TL,FIN] | product | `c/inventory/ProductPhotoFields.tsx`, `cm/Inventory.tsx` | Create — products / images — `app/api/products/[id]/images/route.ts` |
| DELETE | `/api/products/[id]/images` | role:[DIR,ADM,INV,TL,FIN] | product | `c/inventory/ProductPhotoFields.tsx`, `cm/Inventory.tsx` | Delete / void — products / images — `app/api/products/[id]/images/route.ts` |
| PUT | `/api/products/[id]` | role:DIR,ADM,INV,TL,FIN | product, stockLevel, serialNumber, stockMovement, purchaseOrderItem… | `c/inventory/ProductDuplicatesPanel.tsx`, `c/inventory/ProductPhotoFields.tsx` | Replace / update — products — `app/api/products/[id]/route.ts` |
| PATCH | `/api/products/[id]` | role:DIR,ADM,INV,TL,FIN | product, stockLevel, serialNumber, stockMovement, purchaseOrderItem… | `c/inventory/ProductDuplicatesPanel.tsx`, `c/inventory/ProductPhotoFields.tsx` | Update — products — `app/api/products/[id]/route.ts` |
| DELETE | `/api/products/[id]` | role:[DIR,ADM,INV,TL,FIN] | product, stockLevel, serialNumber, stockMovement, purchaseOrderItem… | `c/inventory/ProductDuplicatesPanel.tsx`, `c/inventory/ProductPhotoFields.tsx` | Delete / void — products — `app/api/products/[id]/route.ts` |
| POST | `/api/products/bulk` | role:[DIR,ADM,INV,TL] | — | `lib/input-security.ts`, `lib/store.tsx` | Create — products / bulk — `app/api/products/bulk/route.ts` |
| GET | `/api/products/duplicates` | role:[DIR,ADM,INV,TL] | — | `c/inventory/ProductDuplicatesPanel.tsx` | List / read — products / duplicates — `app/api/products/duplicates/route.ts` |
| POST | `/api/products/duplicates` | role:[DIR,ADM,INV,TL] | — | `c/inventory/ProductDuplicatesPanel.tsx` | Create — products / duplicates — `app/api/products/duplicates/route.ts` |
| POST | `/api/products/normalize-device-config` | role:[DIR,ADM,INV,TL] | — | `lib/catalog-boot-heal.ts` | Create — products / normalize device config — `app/api/products/normalize-device-config/route.ts` |
| POST | `/api/products/normalize-serial-tracking` | role:[DIR,ADM,INV,TL] | — | `lib/catalog-boot-heal.ts` | Create — products / normalize serial tracking — `app/api/products/normalize-serial-tracking/route.ts` |
| GET | `/api/products` | session-only (no role check) | product | `c/inventory/ProductDuplicatesPanel.tsx`, `c/inventory/ProductPhotoFields.tsx` | List / read — products — `app/api/products/route.ts` |
| POST | `/api/products` | role:[DIR,ADM,INV,TL] | product | `c/inventory/ProductDuplicatesPanel.tsx`, `c/inventory/ProductPhotoFields.tsx` | Create — products — `app/api/products/route.ts` |
| PATCH | `/api/serials/[id]` | perm:editSerialNumber (file-level) | serialNumber; app_state/store | `c/inventory/SerialManageDrawer.tsx`, `lib/inventory/stock-transactions.ts` | Update — serials — `app/api/serials/[id]/route.ts` |
| PUT | `/api/serials/[id]` | perm:editSerialNumber (file-level) | serialNumber; app_state/store | `c/inventory/SerialManageDrawer.tsx`, `lib/inventory/stock-transactions.ts` | Replace / update — serials — `app/api/serials/[id]/route.ts` |
| DELETE | `/api/serials/[id]` | perm:editSerialNumber (file-level) | serialNumber; app_state/store | `c/inventory/SerialManageDrawer.tsx`, `lib/inventory/stock-transactions.ts` | Delete / void — serials — `app/api/serials/[id]/route.ts` |
| POST | `/api/serials/bulk` | role:[DIR,ADM,FIN,INV,TL] | app_state/store | **none found** | Create — serials / bulk — `app/api/serials/bulk/route.ts` |
| GET | `/api/serials` | session | store:deed_serials | `c/inventory/SerialManageDrawer.tsx`, `lib/inventory/stock-transactions.ts` | List / read — serials — `app/api/serials/route.ts` |
| POST | `/api/serials` | role:[DIR,ADM,FIN,INV,TL] | store:deed_serials | `c/inventory/SerialManageDrawer.tsx`, `lib/inventory/stock-transactions.ts` | Create — serials — `app/api/serials/route.ts` |
| GET | `/api/stock-moves` | session | store:deed_stockMoves | `lib/store.tsx` | List / read — stock moves — `app/api/stock-moves/route.ts` |
| POST | `/api/stock-moves` | role:[DIR,ADM,FIN,INV,TL] | store:deed_stockMoves | `lib/store.tsx` | Create — stock moves — `app/api/stock-moves/route.ts` |

### Delivery & outbound release

11 route files · 16 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| POST | `/api/deliveries/[id]/reverse` | role:[DIR,INV,ADM] | app_state/store | `lib/store.tsx` | POST /api/deliveries/:id/reverse — `app/api/deliveries/[id]/reverse/route.ts` |
| PATCH | `/api/deliveries/[id]` | role:[DIR,ADM,FIN,SALES,INV,TL] | store:deed_deliveries | `lib/store.tsx` | Update — deliveries — `app/api/deliveries/[id]/route.ts` |
| PUT | `/api/deliveries/[id]` | role:[DIR,ADM,FIN,SALES,INV,TL] | store:deed_deliveries | `lib/store.tsx` | Replace / update — deliveries — `app/api/deliveries/[id]/route.ts` |
| DELETE | `/api/deliveries/[id]` | role:[DIR,ADM,FIN,SALES,INV,TL] | store:deed_deliveries | `lib/store.tsx` | Delete / void — deliveries — `app/api/deliveries/[id]/route.ts` |
| POST | `/api/deliveries/[id]/validate` | session-only (no role check) | app_state/store | `lib/store.tsx` | Action: validate (deliveries) — `app/api/deliveries/[id]/validate/route.ts` |
| GET | `/api/deliveries` | session | store:deed_deliveries; saleOrder | `lib/store.tsx` | List / read — deliveries — `app/api/deliveries/route.ts` |
| POST | `/api/deliveries` | role:[DIR,ADM,FIN,SALES,INV] | store:deed_deliveries; saleOrder | `lib/store.tsx` | Create — deliveries — `app/api/deliveries/route.ts` |
| POST | `/api/outbound-releases/[id]/audit-log` | role:[DIR,ADM,FIN,INV,SALES] | outboundRelease, outboundReleaseLog; app_state/store | `lib/store.tsx` | Create — outbound releases / audit log — `app/api/outbound-releases/[id]/audit-log/route.ts` |
| PATCH | `/api/outbound-releases/[id]/pick` | role:DIR,ADM,FIN,SALES,TL | — | `lib/store.tsx` | Action: pick (outbound-releases) — `app/api/outbound-releases/[id]/pick/route.ts` |
| PATCH | `/api/outbound-releases/[id]/release` | role:DIR,ADM | — | `lib/store.tsx` | Action: release (outbound-releases) — `app/api/outbound-releases/[id]/release/route.ts` |
| GET | `/api/outbound-releases/[id]` | session-only | outboundRelease, outboundReleaseItem, repair; app_state/store | `lib/store.tsx` | Read one — outbound releases — `app/api/outbound-releases/[id]/route.ts` |
| PATCH | `/api/outbound-releases/[id]` | session-only ⚠ (writes request body straight to OutboundRelease) | outboundRelease, outboundReleaseItem, repair; app_state/store | `lib/store.tsx` | Update — outbound releases — `app/api/outbound-releases/[id]/route.ts` |
| PATCH | `/api/outbound-releases/[id]/verify` | role:DIR,ADM | — | `lib/store.tsx` | Action: verify (outbound-releases) — `app/api/outbound-releases/[id]/verify/route.ts` |
| PATCH | `/api/outbound-releases/[id]/void` | role:DIR,ADM,FIN,SALES,TL (DIR only after verified) | — | `lib/store.tsx` | Action: void (outbound-releases) — `app/api/outbound-releases/[id]/void/route.ts` |
| GET | `/api/outbound-releases` | session-only | outboundRelease, repair, invoice | `lib/store.tsx` | List / read — outbound releases — `app/api/outbound-releases/route.ts` |
| POST | `/api/outbound-releases` | role:[DIR,ADM,FIN,SALES,TL] | outboundRelease, repair, invoice | `lib/store.tsx` | Create — outbound releases — `app/api/outbound-releases/route.ts` |

### Repair & customer portal

29 route files · 35 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| GET | `/api/portal/company-info` | public: customer verification (phone on file / signed token) + rate limit | app_state/store | `app/portal/repair/[...ref]/page.tsx`, `app/portal/repair/[ref]/page.tsx` | GET /api/portal/company-info — `app/api/portal/company-info/route.ts` |
| GET | `/api/portal/intake/next-ref` | public: customer verification (phone on file / signed token) + rate limit | — | **none found** | GET /api/portal/intake/next-ref — `app/api/portal/intake/next-ref/route.ts` |
| POST | `/api/portal/intake` | public: customer verification (phone on file / signed token) + rate limit | app_state/store | `app/portal/repair/new/page.tsx` | Create — portal / intake — `app/api/portal/intake/route.ts` |
| POST | `/api/portal/quotes/[id]/accept` | public: customer verification (phone on file / signed token) + rate limit | saleOrder | `app/portal/quotes/[id]/page.tsx` | POST /api/portal/quotes/[id]/accept?token=<signed-token> — `app/api/portal/quotes/[id]/accept/route.ts` |
| GET | `/api/portal/quotes/[id]/pdf` | public: customer verification (phone on file / signed token) + rate limit | app_state/store | `app/portal/quotes/[id]/page.tsx` | GET /api/portal/quotes/[id]/pdf?token=<signed-token> — `app/api/portal/quotes/[id]/pdf/route.ts` |
| POST | `/api/portal/quotes/[id]/reject` | public: customer verification (phone on file / signed token) + rate limit | — | `app/portal/quotes/[id]/page.tsx` | POST /api/portal/quotes/[id]/reject?token=<signed-token> — `app/api/portal/quotes/[id]/reject/route.ts` |
| GET | `/api/portal/quotes/[id]` | public: customer verification (phone on file / signed token) + rate limit | — | `app/portal/quotes/[id]/page.tsx` | GET /api/portal/quotes/[id]?token=<signed-token> — `app/api/portal/quotes/[id]/route.ts` |
| POST | `/api/portal/repair/[ref]/approve` | public: customer verification (phone on file / signed token) + rate limit | invoice, client, user, saleOrder; app_state/store | `lib/portal-repairs.ts`, `lib/store.tsx` | Action: approve (portal) — `app/api/portal/repair/[ref]/approve/route.ts` |
| GET | `/api/portal/repair/[ref]/diagnosis-report/[id]` | public: customer verification (phone on file / signed token) + rate limit | app_state/store | `app/track/[...ref]/page.tsx` | GET /api/portal/repair/[ref]/diagnosis-report/[id] — `app/api/portal/repair/[ref]/diagnosis-report/[id]/route.ts` |
| GET | `/api/portal/repair/[ref]/invoice-pdf` | staff session or customer verification (phone on file) | app_state/store | `app/portal/repair/[...ref]/page.tsx`, `app/portal/repair/[ref]/page.tsx` | GET /api/portal/repair/[ref]/invoice-pdf — `app/api/portal/repair/[ref]/invoice-pdf/route.ts` |
| GET | `/api/portal/repair/[ref]/messages` | public: customer verification (phone on file / signed token) + rate limit | — | `cm/repair/MessageThread.tsx`, `lib/portal-repairs.ts` | List / read — portal / repair / messages — `app/api/portal/repair/[ref]/messages/route.ts` |
| POST | `/api/portal/repair/[ref]/messages` | public: customer verification (phone on file / signed token) + rate limit | — | `cm/repair/MessageThread.tsx`, `lib/portal-repairs.ts` | Create — portal / repair / messages — `app/api/portal/repair/[ref]/messages/route.ts` |
| POST | `/api/portal/repair/[ref]/payment-confirmation` | public: customer verification (phone on file / signed token) + rate limit | app_state/store | `app/portal/repair/[...ref]/page.tsx`, `app/portal/repair/[ref]/page.tsx` | Create — portal / repair / payment confirmation — `app/api/portal/repair/[ref]/payment-confirmation/route.ts` |
| GET | `/api/portal/repair/[ref]/payment-proof` | staff session or customer verification (phone on file) | app_state/store | **none found** | GET /api/portal/repair/[ref]/payment-proof — `app/api/portal/repair/[ref]/payment-proof/route.ts` |
| GET | `/api/portal/repair/[ref]/photos/[index]` | staff session or customer verification (phone on file) | app_state/store | `lib/store.tsx`, `app/portal/repair/[...ref]/page.tsx` | Read one — portal / repair / photos — `app/api/portal/repair/[ref]/photos/[index]/route.ts` |
| GET | `/api/portal/repair/[ref]/qc-report/[id]` | public: customer verification (phone on file / signed token) + rate limit | app_state/store | `app/track/[...ref]/page.tsx` | Read one — portal / repair / qc report — `app/api/portal/repair/[ref]/qc-report/[id]/route.ts` |
| GET | `/api/portal/repair/[ref]/quote-pdf` | staff session or customer verification (phone on file) | app_state/store | `app/portal/repair/[...ref]/page.tsx`, `app/portal/repair/[ref]/page.tsx` | GET /api/portal/repair/[ref]/quote-pdf — `app/api/portal/repair/[ref]/quote-pdf/route.ts` |
| GET | `/api/portal/repair/[ref]/receipt-pdf` | staff session or customer verification (phone on file) | app_state/store | `app/portal/repair/[...ref]/page.tsx`, `app/portal/repair/[ref]/page.tsx` | List / read — portal / repair / receipt pdf — `app/api/portal/repair/[ref]/receipt-pdf/route.ts` |
| GET | `/api/portal/repair/[ref]` | public: customer verification (phone on file / signed token) + rate limit | — | `cm/repair/MessageThread.tsx`, `lib/portal-repairs.ts` | Read one — portal / repair — `app/api/portal/repair/[ref]/route.ts` |
| POST | `/api/portal/repair/sync` | public: customer verification (phone on file / signed token) + rate limit | app_state/store | `lib/portal-repairs.ts`, `lib/store.tsx` | Create — portal / repair / sync — `app/api/portal/repair/sync/route.ts` |
| POST | `/api/repair-diagnosis-reports/[repairRef]` | role:DIR,ADM,TL,TECH + repair module | app_state/store | `cm/Repair.tsx` | POST /api/repair-diagnosis-reports/[repairRef] — `app/api/repair-diagnosis-reports/[repairRef]/route.ts` |
| GET | `/api/repair-photos/[repairRef]` | staff session or customer phone verification | app_state/store | `cm/repair/RepairDetailView.tsx` | Read one — repair photos — `app/api/repair-photos/[repairRef]/route.ts` |
| POST | `/api/repair-photos/[repairRef]` | role:DIR,ADM,TL,TECH + repair module | app_state/store | `cm/repair/RepairDetailView.tsx` | Create child / action on — repair photos — `app/api/repair-photos/[repairRef]/route.ts` |
| DELETE | `/api/repair-photos/[repairRef]` | role:DIR,ADM,TL,TECH + repair module | app_state/store | `cm/repair/RepairDetailView.tsx` | Delete / void — repair photos — `app/api/repair-photos/[repairRef]/route.ts` |
| POST | `/api/repair-qc-reports/[repairRef]` | role:DIR,ADM,TL,TECH + repair module | app_state/store | `cm/Repair.tsx` | Create child / action on — repair qc reports — `app/api/repair-qc-reports/[repairRef]/route.ts` |
| POST | `/api/repairs/[id]/parts-cogs` | role:[DIR,ADM,TL,TECH] | app_state/store | `lib/repair/parts-cogs-lines.ts`, `lib/store.tsx` | POST /api/repairs/[id]/parts-cogs — `app/api/repairs/[id]/parts-cogs/route.ts` |
| POST | `/api/repairs/[id]/reissue-invoice` | role:INVOICE_REISSUE_ROLES (imported) | invoice, creditNoteLine, product, saleOrder; app_state/store | `c/repair/InvoiceReissuePanel.tsx` | POST /api/repairs/[id]/reissue-invoice — `app/api/repairs/[id]/reissue-invoice/route.ts` |
| DELETE | `/api/repairs/[id]` | session + inline role/module logic (verify in source) | store:deed_repairs_v2 | `cm/Repair.tsx`, `c/repair/InvoiceReissuePanel.tsx` | Delete / void — repairs — `app/api/repairs/[id]/route.ts` |
| PATCH | `/api/repairs/[id]` | session + inline role/module logic (verify in source) | store:deed_repairs_v2 | `cm/Repair.tsx`, `c/repair/InvoiceReissuePanel.tsx` | Update — repairs — `app/api/repairs/[id]/route.ts` |
| GET | `/api/repairs/[id]` | session + inline role/module logic (verify in source) | store:deed_repairs_v2 | `cm/Repair.tsx`, `c/repair/InvoiceReissuePanel.tsx` | Read one — repairs — `app/api/repairs/[id]/route.ts` |
| POST | `/api/repairs/[id]/verify` | role:[DIR,ADM,TL] | app_state/store | `cm/Repair.tsx`, `lib/store.tsx` | Action: verify (repairs) — `app/api/repairs/[id]/verify/route.ts` |
| GET | `/api/repairs/next-ref` | session-only (no role check) | — | **none found** | GET /api/repairs/next-ref — `app/api/repairs/next-ref/route.ts` |
| GET | `/api/repairs` | session + inline role/module logic (verify in source) | repair; app_state/store | `cm/Repair.tsx`, `c/repair/InvoiceReissuePanel.tsx` | List / read — repairs — `app/api/repairs/route.ts` |
| POST | `/api/repairs` | session + inline role/module logic (verify in source) | repair; app_state/store | `cm/Repair.tsx`, `c/repair/InvoiceReissuePanel.tsx` | Create — repairs — `app/api/repairs/route.ts` |
| GET | `/api/technicians` | role:[DIR,ADM,TL] | employee | `lib/store.tsx` | List / read — technicians — `app/api/technicians/route.ts` |

### Device reconfiguration

17 route files · 20 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| POST | `/api/reconfiguration/[id]/apply-target` | perm:editReconfigurationDraft | — | **none found** | POST /api/reconfiguration/[id]/apply-target — `app/api/reconfiguration/[id]/apply-target/route.ts` |
| POST | `/api/reconfiguration/[id]/approve` | perm:approveReconfiguration + perm:overrideReconfigCompatibility + perm:overrideMinimumMargin | — | `cm/Reconfiguration.tsx`, `lib/reconfiguration/state-machine.ts` | POST /api/reconfiguration/[id]/approve — `app/api/reconfiguration/[id]/approve/route.ts` |
| POST | `/api/reconfiguration/[id]/calculate-cost` | perm:viewReconfigComponentCosts | product | **none found** | POST /api/reconfiguration/[id]/calculate-cost — `app/api/reconfiguration/[id]/calculate-cost/route.ts` |
| POST | `/api/reconfiguration/[id]/calculate-diff` | perm:viewReconfiguration | — | **none found** | POST /api/reconfiguration/[id]/calculate-diff — `app/api/reconfiguration/[id]/calculate-diff/route.ts` |
| POST | `/api/reconfiguration/[id]/cancel` | perm:editReconfigurationDraft | — | `cm/Reconfiguration.tsx`, `lib/reconfiguration/schemas.ts` | POST /api/reconfiguration/[id]/cancel — `app/api/reconfiguration/[id]/cancel/route.ts` |
| POST | `/api/reconfiguration/[id]/complete` | perm:completeReconfiguration | — | `cm/Reconfiguration.tsx`, `lib/reconfiguration/schemas.ts` | POST /api/reconfiguration/[id]/complete — `app/api/reconfiguration/[id]/complete/route.ts` |
| POST | `/api/reconfiguration/[id]/record-installation` | perm:performReconfigInstallation + perm:overrideReconfigStock | — | `cm/Reconfiguration.tsx` | POST /api/reconfiguration/[id]/record-installation — `app/api/reconfiguration/[id]/record-installation/route.ts` |
| POST | `/api/reconfiguration/[id]/record-removal` | perm:performReconfigRemoval | — | `cm/Reconfiguration.tsx` | POST /api/reconfiguration/[id]/record-removal — `app/api/reconfiguration/[id]/record-removal/route.ts` |
| POST | `/api/reconfiguration/[id]/reject` | perm:approveReconfiguration | — | `cm/Reconfiguration.tsx`, `lib/reconfiguration/state-machine.ts` | POST /api/reconfiguration/[id]/reject — `app/api/reconfiguration/[id]/reject/route.ts` |
| POST | `/api/reconfiguration/[id]/reserve` | perm:reserveReconfigurationComponents | — | `cm/Reconfiguration.tsx`, `lib/reconfiguration/schemas.ts` | POST /api/reconfiguration/[id]/reserve — `app/api/reconfiguration/[id]/reserve/route.ts` |
| GET | `/api/reconfiguration/[id]` | perm:viewReconfiguration | reconfigurationWorkOrder | `cm/Reconfiguration.tsx`, `lib/inventory/serial-device-label.ts` | Read one — reconfiguration — `app/api/reconfiguration/[id]/route.ts` |
| PATCH | `/api/reconfiguration/[id]` | perm:editReconfigurationDraft | reconfigurationWorkOrder | `cm/Reconfiguration.tsx`, `lib/inventory/serial-device-label.ts` | Update — reconfiguration — `app/api/reconfiguration/[id]/route.ts` |
| POST | `/api/reconfiguration/[id]/start` | perm:performReconfigInstallation | — | `cm/Reconfiguration.tsx`, `lib/reconfiguration/state-machine.ts` | POST /api/reconfiguration/[id]/start — `app/api/reconfiguration/[id]/start/route.ts` |
| POST | `/api/reconfiguration/[id]/submit-approval` | perm:editReconfigurationDraft | — | `cm/Reconfiguration.tsx` | POST /api/reconfiguration/[id]/submit-approval — `app/api/reconfiguration/[id]/submit-approval/route.ts` |
| POST | `/api/reconfiguration/[id]/submit-qa` | perm:completeReconfigQa | — | `cm/Reconfiguration.tsx` | POST /api/reconfiguration/[id]/submit-qa — `app/api/reconfiguration/[id]/submit-qa/route.ts` |
| POST | `/api/reconfiguration/bench` | perm:createReconfiguration | — | `cm/Reconfiguration.tsx`, `lib/reconfiguration/schemas.ts` | POST /api/reconfiguration/bench — `app/api/reconfiguration/bench/route.ts` |
| GET | `/api/reconfiguration/device/[serialId]/configuration` | perm:viewReconfiguration | — | `cm/Reconfiguration.tsx`, `lib/inventory/serial-device-label.ts` | List / read — reconfiguration / device / configuration — `app/api/reconfiguration/device/[serialId]/configuration/route.ts` |
| POST | `/api/reconfiguration/device/[serialId]/configuration` | perm:editReconfigurationDraft | — | `cm/Reconfiguration.tsx`, `lib/inventory/serial-device-label.ts` | Create — reconfiguration / device / configuration — `app/api/reconfiguration/device/[serialId]/configuration/route.ts` |
| GET | `/api/reconfiguration` | perm:viewReconfiguration | — | `cm/Reconfiguration.tsx`, `lib/inventory/serial-device-label.ts` | List / read — reconfiguration — `app/api/reconfiguration/route.ts` |
| POST | `/api/reconfiguration` | perm:createReconfiguration | — | `cm/Reconfiguration.tsx`, `lib/inventory/serial-device-label.ts` | Create — reconfiguration — `app/api/reconfiguration/route.ts` |

### Invoices, payments, M-Pesa, deposits & expenses

19 route files · 31 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| POST | `/api/deposits/[id]/cancel` | role:[DIR,FIN] | — | `lib/store.tsx` | Action: cancel (deposits) — `app/api/deposits/[id]/cancel/route.ts` |
| POST | `/api/deposits/[id]/complete` | role:[DIR,FIN] | — | `lib/store.tsx` | Action: complete (deposits) — `app/api/deposits/[id]/complete/route.ts` |
| POST | `/api/deposits/[id]/payments` | session-only (no role check) | — | `lib/store.tsx` | Action: payments (deposits) — `app/api/deposits/[id]/payments/route.ts` |
| GET | `/api/deposits/[id]` | session-only (no role check) | deposit | `lib/store.tsx` | Read one — deposits — `app/api/deposits/[id]/route.ts` |
| PATCH | `/api/deposits/[id]` | role:[DIR,ADM,FIN] | deposit | `lib/store.tsx` | Update — deposits — `app/api/deposits/[id]/route.ts` |
| GET | `/api/deposits` | session-only (no role check) | deposit | `lib/store.tsx` | List / read — deposits — `app/api/deposits/route.ts` |
| POST | `/api/deposits` | role:[DIR,ADM,FIN] | deposit | `lib/store.tsx` | Create — deposits — `app/api/deposits/route.ts` |
| GET | `/api/expense-receipts/[expenseId]` | session-only (no role check) | app_state/store | `cm/Expenses.tsx`, `lib/store.tsx` | Read one — expense receipts — `app/api/expense-receipts/[expenseId]/route.ts` |
| POST | `/api/expense-receipts/[expenseId]` | session-only (no role check) | app_state/store | `cm/Expenses.tsx`, `lib/store.tsx` | Create child / action on — expense receipts — `app/api/expense-receipts/[expenseId]/route.ts` |
| DELETE | `/api/expense-receipts/[expenseId]` | session-only (no role check) | app_state/store | `cm/Expenses.tsx`, `lib/store.tsx` | Delete / void — expense receipts — `app/api/expense-receipts/[expenseId]/route.ts` |
| POST | `/api/expenses/post-journal` | role:[DIR,FIN] | — | `lib/store.tsx` | POST /api/expenses/post-journal — `app/api/expenses/post-journal/route.ts` |
| POST | `/api/invoices/[id]/payments` | role:[DIR,FIN,ADM] | invoice, bankAccount, accountCode, payment; app_state/store | `cm/Dashboard.tsx`, `cm/InvoiceDetail.tsx` | Action: payments (invoices) — `app/api/invoices/[id]/payments/route.ts` |
| GET | `/api/invoices/[id]/payments` | role:[…WRITE_ROLES] | invoice, bankAccount, accountCode, payment; app_state/store | `cm/Dashboard.tsx`, `cm/InvoiceDetail.tsx` | Read: payments (invoices) — `app/api/invoices/[id]/payments/route.ts` |
| GET | `/api/invoices/[id]` | session-only (no role check) | invoice, invoiceItem, client, taxTransaction | `cm/Dashboard.tsx`, `cm/InvoiceDetail.tsx` | Read one — invoices — `app/api/invoices/[id]/route.ts` |
| PUT | `/api/invoices/[id]` | role:[DIR,FIN,ADM,TL,TECH] | invoice, invoiceItem, client, taxTransaction | `cm/Dashboard.tsx`, `cm/InvoiceDetail.tsx` | Replace / update — invoices — `app/api/invoices/[id]/route.ts` |
| PATCH | `/api/invoices/[id]` | role:[DIR,FIN,ADM,TL,TECH] (file-level) + role:[DIR,FIN,ADM,TL] (file-level) | invoice, invoiceItem, client, taxTransaction | `cm/Dashboard.tsx`, `cm/InvoiceDetail.tsx` | Update — invoices — `app/api/invoices/[id]/route.ts` |
| DELETE | `/api/invoices/[id]` | role:[DIR,FIN,ADM,TL] | invoice, invoiceItem, client, taxTransaction | `cm/Dashboard.tsx`, `cm/InvoiceDetail.tsx` | Delete / void — invoices — `app/api/invoices/[id]/route.ts` |
| POST | `/api/invoices/[id]/send` | role:[DIR,FIN,ADM] | invoice | `cm/InvoiceDetail.tsx`, `lib/invoice-persist.ts` | POST /api/invoices/[id]/send — `app/api/invoices/[id]/send/route.ts` |
| GET | `/api/invoices` | session-only (no role check; returns all invoices) ⚠ | invoice | `cm/Dashboard.tsx`, `cm/InvoiceDetail.tsx` | List / read — invoices — `app/api/invoices/route.ts` |
| POST | `/api/invoices` | role:DIR,FIN,ADM,TL (+TECH when repair-linked; +POS roles for POS invoices) | invoice | `cm/Dashboard.tsx`, `cm/InvoiceDetail.tsx` | Create — invoices — `app/api/invoices/route.ts` |
| GET | `/api/invoices/stats` | session-only (no role check) | — | `cm/Dashboard.tsx` | GET /api/invoices/stats — `app/api/invoices/stats/route.ts` |
| POST | `/api/mpesa/callback` | NONE (public; matched by CheckoutRequestID only) ⚠ | — | `cm/middleware.ts`, `lib/mpesa/config.ts` | Action: callback (mpesa) — `app/api/mpesa/callback/route.ts` |
| GET | `/api/mpesa/status` | session-only (no role check) | — | `lib/mpesa/client.ts` | Read: status (mpesa) — `app/api/mpesa/status/route.ts` |
| POST | `/api/mpesa/stk-push` | session-only (no role check) | — | `lib/mpesa/client.ts` | Action: stk push (mpesa) — `app/api/mpesa/stk-push/route.ts` |
| POST | `/api/mpesa/stk-query` | session-only (no role check) | — | `lib/mpesa/client.ts` | Action: stk query (mpesa) — `app/api/mpesa/stk-query/route.ts` |
| POST | `/api/payments/[id]/allocations` | role:[DIR,FIN,ADM] | payment, invoice | **none found** | POST /api/payments/[id]/allocations — `app/api/payments/[id]/allocations/route.ts` |
| PATCH | `/api/payments/[id]` | role:[DIR,FIN,ADM] | store:deed_payments | `lib/store.tsx` | Action: payments (payments) — `app/api/payments/[id]/route.ts` |
| PUT | `/api/payments/[id]` | role:[DIR,FIN,ADM] | store:deed_payments | `lib/store.tsx` | Action: payments (payments) — `app/api/payments/[id]/route.ts` |
| DELETE | `/api/payments/[id]` | role:[DIR,FIN,ADM] | store:deed_payments | `lib/store.tsx` | Action: payments (payments) — `app/api/payments/[id]/route.ts` |
| GET | `/api/payments` | role:[DIR,FIN,ADM] | store:deed_payments; payment | `lib/store.tsx` | List / read — payments — `app/api/payments/route.ts` |
| POST | `/api/payments` | role:[DIR,FIN,ADM] | store:deed_payments; payment | `lib/store.tsx` | Create — payments — `app/api/payments/route.ts` |

### Accounting, bank reconciliation & POS

32 route files · 43 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| GET | `/api/accounting/ageing` | role:[DIR,FIN,ADM] | — | `cm/accounting/AgeingTab.tsx` | List / read — accounting / ageing — `app/api/accounting/ageing/route.ts` |
| GET | `/api/accounting/analytic-accounts` | role:[DIR,FIN,ADM] | analyticAccount | `cm/accounting/AnalyticBudgetsTab.tsx` | List / read — accounting / analytic accounts — `app/api/accounting/analytic-accounts/route.ts` |
| POST | `/api/accounting/analytic-accounts` | role:[DIR,FIN] | analyticAccount | `cm/accounting/AnalyticBudgetsTab.tsx` | Create — accounting / analytic accounts — `app/api/accounting/analytic-accounts/route.ts` |
| GET | `/api/accounting/analytic-budgets` | role:[DIR,FIN,ADM] | analyticBudget, analyticAccount, accountCode | `cm/accounting/AnalyticBudgetsTab.tsx` | List / read — accounting / analytic budgets — `app/api/accounting/analytic-budgets/route.ts` |
| POST | `/api/accounting/analytic-budgets` | role:[DIR,FIN] | analyticBudget, analyticAccount, accountCode | `cm/accounting/AnalyticBudgetsTab.tsx` | Create — accounting / analytic budgets — `app/api/accounting/analytic-budgets/route.ts` |
| GET | `/api/accounting/balance-sheet` | role:[DIR,FIN,ADM] | — | `hooks/usePrismaAccountingReports.ts` | List / read — accounting / balance sheet — `app/api/accounting/balance-sheet/route.ts` |
| GET | `/api/accounting/bank-statements/[id]` | role:[DIR,FIN,ADM] | bankStatement, bankStatementLine, bankReconciliationMatch, journalEntry | **none found** | Read one — accounting / bank statements — `app/api/accounting/bank-statements/[id]/route.ts` |
| POST | `/api/accounting/bank-statements/[id]` | role:[DIR,FIN] | bankStatement, bankStatementLine, bankReconciliationMatch, journalEntry | **none found** | Create child / action on — accounting / bank statements — `app/api/accounting/bank-statements/[id]/route.ts` |
| GET | `/api/accounting/bank-statements` | role:[DIR,FIN,ADM] | bankStatement, bankStatementLine | **none found** | List / read — accounting / bank statements — `app/api/accounting/bank-statements/route.ts` |
| POST | `/api/accounting/bank-statements` | role:[DIR,FIN] | bankStatement, bankStatementLine | **none found** | Create — accounting / bank statements — `app/api/accounting/bank-statements/route.ts` |
| POST | `/api/accounting/bootstrap-coa` | role:[DIR,FIN,ADM] | accountCode; app_state/store | `hooks/usePrismaAccountingReports.ts` | Create — accounting / bootstrap coa — `app/api/accounting/bootstrap-coa/route.ts` |
| GET | `/api/accounting/bootstrap-coa` | role:[DIR,FIN,ADM,SALES] | accountCode; app_state/store | `hooks/usePrismaAccountingReports.ts` | List / read — accounting / bootstrap coa — `app/api/accounting/bootstrap-coa/route.ts` |
| GET | `/api/accounting/budget-vs-actual` | role:[DIR,FIN,ADM] | analyticBudget, journalEntryLine, accountCode | `cm/accounting/AnalyticBudgetsTab.tsx` | List / read — accounting / budget vs actual — `app/api/accounting/budget-vs-actual/route.ts` |
| GET | `/api/accounting/cash-flow` | role:[DIR,FIN,ADM] | — | `cm/accounting/CashFlowPanel.tsx` | List / read — accounting / cash flow — `app/api/accounting/cash-flow/route.ts` |
| GET | `/api/accounting/dashboard` | role:[DIR,FIN,ADM] | journalEntryLine, companySetting, productValuation, payrollRun, bankAccount… | `cm/accounting/AccountingDashboard.tsx` | List / read — accounting / dashboard — `app/api/accounting/dashboard/route.ts` |
| GET | `/api/accounting/financial-report` | role:[DIR,FIN,ADM] | — | `cm/accounting/FinancialReportTab.tsx` | GET /api/accounting/financial-report?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD — `app/api/accounting/financial-report/route.ts` |
| GET | `/api/accounting/fiscal-lock` | role:[DIR,FIN] | fiscalLock | **none found** | List / read — accounting / fiscal lock — `app/api/accounting/fiscal-lock/route.ts` |
| PUT | `/api/accounting/fiscal-lock` | role:[DIR,FIN] | fiscalLock | **none found** | Replace / update — accounting / fiscal lock — `app/api/accounting/fiscal-lock/route.ts` |
| POST | `/api/accounting/fiscal-periods/[id]/close` | role:[DIR,FIN] | fiscalPeriod | **none found** | Action: close (accounting) — `app/api/accounting/fiscal-periods/[id]/close/route.ts` |
| POST | `/api/accounting/fiscal-periods/[id]/reopen` | role:[DIR] | fiscalPeriod | **none found** | Action: reopen (accounting) — `app/api/accounting/fiscal-periods/[id]/reopen/route.ts` |
| GET | `/api/accounting/fiscal-periods` | role:[DIR,FIN,ADM] | fiscalPeriod | **none found** | List / read — accounting / fiscal periods — `app/api/accounting/fiscal-periods/route.ts` |
| POST | `/api/accounting/fiscal-periods` | role:[DIR,FIN] | fiscalPeriod | **none found** | Create — accounting / fiscal periods — `app/api/accounting/fiscal-periods/route.ts` |
| POST | `/api/accounting/fixed-assets/depreciate` | role:[DIR,FIN] | — | **none found** | Action: depreciate (accounting) — `app/api/accounting/fixed-assets/depreciate/route.ts` |
| GET | `/api/accounting/fixed-assets` | role:[DIR,FIN,ADM] | — | **none found** | List / read — accounting / fixed assets — `app/api/accounting/fixed-assets/route.ts` |
| POST | `/api/accounting/fixed-assets` | role:[DIR,FIN] | — | **none found** | Create — accounting / fixed assets — `app/api/accounting/fixed-assets/route.ts` |
| POST | `/api/accounting/fx-revaluation` | role:[DIR,FIN] | — | `cm/Accounting.tsx`, `cm/settings/CurrencyPricelistCutover.tsx` | Create — accounting / fx revaluation — `app/api/accounting/fx-revaluation/route.ts` |
| GET | `/api/accounting/general-ledger` | role:[DIR,FIN,ADM] | — | `cm/accounting/GeneralLedgerTab.tsx` | List / read — accounting / general ledger — `app/api/accounting/general-ledger/route.ts` |
| GET | `/api/accounting/integrity` | role:[DIR,FIN,ADM] | — | `cm/accounting/IntegrityDashboard.tsx` | List / read — accounting / integrity — `app/api/accounting/integrity/route.ts` |
| GET | `/api/accounting/journals` | role:[DIR,FIN,ADM] | journalEntry | `cm/accounting/JournalsTab.tsx`, `lib/store.tsx` | List / read — accounting / journals — `app/api/accounting/journals/route.ts` |
| POST | `/api/accounting/journals` | role:[DIR,FIN] | journalEntry | `cm/accounting/JournalsTab.tsx`, `lib/store.tsx` | Create — accounting / journals — `app/api/accounting/journals/route.ts` |
| GET | `/api/accounting/month-end` | role:[DIR,FIN,ADM] | financialReconciliation | `cm/accounting/IntegrityDashboard.tsx` | List / read — accounting / month end — `app/api/accounting/month-end/route.ts` |
| POST | `/api/accounting/month-end` | role:[DIR,FIN] + role:DIR | financialReconciliation | `cm/accounting/IntegrityDashboard.tsx` | Create — accounting / month end — `app/api/accounting/month-end/route.ts` |
| GET | `/api/accounting/orphaned-invoice-journals` | secret:internal (file-level) | — | **none found** | List / read — accounting / orphaned invoice journals — `app/api/accounting/orphaned-invoice-journals/route.ts` |
| POST | `/api/accounting/orphaned-invoice-journals` | secret:internal (file-level) | — | **none found** | Create — accounting / orphaned invoice journals — `app/api/accounting/orphaned-invoice-journals/route.ts` |
| GET | `/api/accounting/profit-loss` | role:[DIR,FIN,ADM] | — | `hooks/usePrismaAccountingReports.ts` | GET /api/accounting/profit-loss — `app/api/accounting/profit-loss/route.ts` |
| POST | `/api/accounting/system-journals` | store-key write policy (STORE_WRITE_POLICIES[governing key]) | — | `lib/store.tsx` | POST /api/accounting/system-journals — `app/api/accounting/system-journals/route.ts` |
| GET | `/api/accounting/trial-balance` | role:[DIR,FIN,ADM] | — | `hooks/usePrismaAccountingReports.ts` | List / read — accounting / trial balance — `app/api/accounting/trial-balance/route.ts` |
| GET | `/api/accounting/vat-control` | role:[DIR,FIN,ADM] | companySetting | `hooks/usePrismaAccountingReports.ts` | GET /api/accounting/vat-control — `app/api/accounting/vat-control/route.ts` |
| POST | `/api/bank-recon/adjustments` | role:[DIR,FIN] | — | **none found** | POST /api/bank-recon/adjustments — `app/api/bank-recon/adjustments/route.ts` |
| POST | `/api/bank-recon/suggest-outstanding` | role:[DIR,FIN] | payment | **none found** | POST /api/bank-recon/suggest-outstanding — `app/api/bank-recon/suggest-outstanding/route.ts` |
| POST | `/api/pos/charge` | role:[DIR,FIN,ADM,SALES,KIL] | — | **none found** | Create — pos / charge — `app/api/pos/charge/route.ts` |
| POST | `/api/pos/post-sale-journal` | role:[DIR,FIN,ADM,SALES,KIL] | — | `lib/accounting/pos-journal-gaps.ts`, `lib/store.tsx` | POST /api/pos/post-sale-journal — `app/api/pos/post-sale-journal/route.ts` |
| POST | `/api/pos/record-order` | role:[DIR,FIN,ADM,SALES,KIL] | app_state/store | `lib/store.tsx` | POST /api/pos/record-order — `app/api/pos/record-order/route.ts` |

### HR, payroll & KPI files

11 route files · 21 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| PUT | `/api/employees/[id]` | role:[DIR,ADM,FIN] | department, employee | `lib/hooks/index.ts`, `lib/store.tsx` | Replace / update — employees — `app/api/employees/[id]/route.ts` |
| GET | `/api/employees` | perm:viewEmployeeSensitive | department, employee | `lib/hooks/index.ts`, `lib/store.tsx` | List / read — employees — `app/api/employees/route.ts` |
| POST | `/api/employees` | role:[DIR,ADM] | department, employee | `lib/hooks/index.ts`, `lib/store.tsx` | Create — employees — `app/api/employees/route.ts` |
| PUT | `/api/leave-requests/[id]` | role:[DIR,ADM,FIN,TL] | leaveRequest, employee | `lib/auth/authorization.ts`, `lib/hr/leave-store.ts` | Replace / update — leave requests — `app/api/leave-requests/[id]/route.ts` |
| PATCH | `/api/leave-requests/[id]` | role:[DIR,ADM,FIN,TL] (file-level) | leaveRequest, employee | `lib/auth/authorization.ts`, `lib/hr/leave-store.ts` | Update — leave requests — `app/api/leave-requests/[id]/route.ts` |
| DELETE | `/api/leave-requests/[id]` | role:[DIR,ADM,FIN,TL] | leaveRequest, employee | `lib/auth/authorization.ts`, `lib/hr/leave-store.ts` | Delete / void — leave requests — `app/api/leave-requests/[id]/route.ts` |
| PUT | `/api/leave-requests/balances` | role:[DIR,ADM] | employee, leaveBalance | `hooks/useHrStore.ts` | PUT /api/leave-requests/balances — `app/api/leave-requests/balances/route.ts` |
| GET | `/api/leave-requests` | role:[DIR,ADM,FIN,TL] | leaveRequest, leaveBalance, employee | `lib/auth/authorization.ts`, `lib/hr/leave-store.ts` | List / read — leave requests — `app/api/leave-requests/route.ts` |
| POST | `/api/leave-requests` | role:[DIR,ADM,FIN,TL] | leaveRequest, leaveBalance, employee | `lib/auth/authorization.ts`, `lib/hr/leave-store.ts` | Create — leave requests — `app/api/leave-requests/route.ts` |
| POST | `/api/payroll/[id]/pay` | role:[DIR,FIN] | payrollRun | `lib/store.tsx` | Create — payroll / pay — `app/api/payroll/[id]/pay/route.ts` |
| PUT | `/api/payroll/[id]` | role:[DIR,FIN,ADM] | payrollRun | `lib/store.tsx` | Replace / update — payroll — `app/api/payroll/[id]/route.ts` |
| PATCH | `/api/payroll/[id]` | role:[DIR,FIN,ADM] (file-level) | payrollRun | `lib/store.tsx` | Update — payroll — `app/api/payroll/[id]/route.ts` |
| GET | `/api/payroll` | role:[DIR,ADM,FIN] | payrollRun, payslip | `lib/store.tsx` | List / read — payroll — `app/api/payroll/route.ts` |
| POST | `/api/payroll` | role:[DIR,ADM,FIN] | payrollRun, payslip | `lib/store.tsx` | Create — payroll — `app/api/payroll/route.ts` |
| PUT | `/api/salary-advances/[id]` | role:[DIR,FIN] + role:[DIR,FIN] | salaryAdvance | `lib/store.tsx` | Replace / update — salary advances — `app/api/salary-advances/[id]/route.ts` |
| PATCH | `/api/salary-advances/[id]` | role:[DIR,FIN] (file-level) + role:[DIR,FIN] (file-level) | salaryAdvance | `lib/store.tsx` | Update — salary advances — `app/api/salary-advances/[id]/route.ts` |
| GET | `/api/salary-advances` | role:[DIR,FIN] | salaryAdvance, employee | `lib/store.tsx` | List / read — salary advances — `app/api/salary-advances/route.ts` |
| POST | `/api/salary-advances` | role:[DIR,FIN] | salaryAdvance, employee | `lib/store.tsx` | Create — salary advances — `app/api/salary-advances/route.ts` |
| GET | `/api/sop-files/[sopId]` | session-only (no role check) | app_state/store | `cm/SOPDocuments.tsx`, `lib/store.tsx` | Read one — sop files — `app/api/sop-files/[sopId]/route.ts` |
| POST | `/api/sop-files/[sopId]` | role:[DIR,ADM,TL] | app_state/store | `cm/SOPDocuments.tsx`, `lib/store.tsx` | Create child / action on — sop files — `app/api/sop-files/[sopId]/route.ts` |
| DELETE | `/api/sop-files/[sopId]` | role:[DIR,ADM,TL] | app_state/store | `cm/SOPDocuments.tsx`, `lib/store.tsx` | Delete / void — sop files — `app/api/sop-files/[sopId]/route.ts` |

### Notifications, integrations, cron & AI

28 route files · 38 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| POST | `/api/cron/infra` | secret:CRON_SECRET or role:DIR,ADM (super_admin) | — | **none found** | Create — cron / infra — `app/api/cron/infra/route.ts` |
| GET | `/api/cron/infra` | secret:CRON_SECRET or role:DIR,ADM | — | **none found** | List / read — cron / infra — `app/api/cron/infra/route.ts` |
| POST | `/api/cron/jarvis-knowledge-ingest` | secret:CRON_SECRET or role:DIR,ADM (super_admin) | — | **none found** | Create — cron / jarvis knowledge ingest — `app/api/cron/jarvis-knowledge-ingest/route.ts` |
| POST | `/api/cron/notifications` | secret:CRON_SECRET or role:DIR,ADM (super_admin) | — | `lib/notifications/business-events.ts` | Create — cron / notifications — `app/api/cron/notifications/route.ts` |
| GET | `/api/cron/notifications` | secret:CRON_SECRET or role:DIR,ADM | — | `lib/notifications/business-events.ts` | List / read — cron / notifications — `app/api/cron/notifications/route.ts` |
| POST | `/api/cron/sales-inbox-dry-run` | secret:CRON_SECRET or role:DIR,ADM (super_admin) | — | `c/crm/EmailReviewPanel.tsx` | Create — cron / sales inbox dry run — `app/api/cron/sales-inbox-dry-run/route.ts` |
| GET | `/api/cron/sales-inbox-dry-run` | secret:CRON_SECRET or role:DIR,ADM (super_admin) | — | `c/crm/EmailReviewPanel.tsx` | List / read — cron / sales inbox dry run — `app/api/cron/sales-inbox-dry-run/route.ts` |
| POST | `/api/cron/sales-inbox-leads` | secret:CRON_SECRET or role:DIR,ADM (super_admin) | — | **none found** | Create — cron / sales inbox leads — `app/api/cron/sales-inbox-leads/route.ts` |
| GET | `/api/cron/sales-inbox-leads` | secret:CRON_SECRET or role:DIR,ADM (super_admin) | — | **none found** | List / read — cron / sales inbox leads — `app/api/cron/sales-inbox-leads/route.ts` |
| GET | `/api/document-email-sends` | session-only (no role check) | — | `c/email/DocumentEmailSendHistory.tsx` | GET /api/document-email-sends?documentId=&documentType=&limit= — `app/api/document-email-sends/route.ts` |
| POST | `/api/integrations/calendar` | session-only (no role check) | — | **none found** | POST /api/integrations/calendar — `app/api/integrations/calendar/route.ts` |
| GET | `/api/integrations/email-status` | role:[DIR,ADM] | — | `cm/Settings.tsx` | GET /api/integrations/email-status — `app/api/integrations/email-status/route.ts` |
| POST | `/api/integrations/send-quote` | session-only (no role check) | app_state/store | `cm/Sales.tsx`, `lib/store.tsx` | POST /api/integrations/send-quote — `app/api/integrations/send-quote/route.ts` |
| POST | `/api/integrations/send-rfq` | session-only (no role check) | — | `cm/purchase/POFormView.tsx` | POST /api/integrations/send-rfq — `app/api/integrations/send-rfq/route.ts` |
| POST | `/api/integrations/test-email` | role:[DIR,ADM] | — | `cm/Settings.tsx` | POST /api/integrations/test-email — `app/api/integrations/test-email/route.ts` |
| POST | `/api/jarvis/chat` | session + module `jarvis` (hasModuleAccess) | aiConversation, aiMessage | `c/jarvis/JarvisPanel.tsx` | POST /api/jarvis/chat — `app/api/jarvis/chat/route.ts` |
| GET | `/api/jarvis/conversations/[id]` | session + module `jarvis` (hasModuleAccess) | aiConversation | **none found** | Read one — jarvis / conversations — `app/api/jarvis/conversations/[id]/route.ts` |
| DELETE | `/api/jarvis/conversations/[id]` | session + module `jarvis` (hasModuleAccess) | aiConversation | **none found** | Delete / void — jarvis / conversations — `app/api/jarvis/conversations/[id]/route.ts` |
| GET | `/api/jarvis/conversations` | session + module `jarvis` (hasModuleAccess) | aiConversation | **none found** | GET /api/jarvis/conversations — `app/api/jarvis/conversations/route.ts` |
| POST | `/api/jarvis/ingest/documents` | session + module `jarvis` (hasModuleAccess) | — | **none found** | POST /api/jarvis/ingest/documents — `app/api/jarvis/ingest/documents/route.ts` |
| GET | `/api/jarvis/voice/status` | session + module `jarvis` (hasModuleAccess) | — | **none found** | GET /api/jarvis/voice/status — `app/api/jarvis/voice/status/route.ts` |
| POST | `/api/notifications/bridge` | session-only (no role check) | user | `lib/store.tsx` | Action: bridge (notifications) — `app/api/notifications/bridge/route.ts` |
| GET | `/api/notifications/endpoints` | session (rows scoped to the caller) | notificationEndpoint | `c/layout/Topbar.tsx` | Read: endpoints (notifications) — `app/api/notifications/endpoints/route.ts` |
| POST | `/api/notifications/endpoints` | session (rows scoped to the caller) | notificationEndpoint | `c/layout/Topbar.tsx` | Action: endpoints (notifications) — `app/api/notifications/endpoints/route.ts` |
| DELETE | `/api/notifications/endpoints` | session (rows scoped to the caller) | notificationEndpoint | `c/layout/Topbar.tsx` | Action: endpoints (notifications) — `app/api/notifications/endpoints/route.ts` |
| GET | `/api/notifications/preferences` | session (rows scoped to the caller) | notificationPreference | `c/layout/Topbar.tsx`, `cm/settings/NotificationOperationsPanel.tsx` | Read: preferences (notifications) — `app/api/notifications/preferences/route.ts` |
| PUT | `/api/notifications/preferences` | session (rows scoped to the caller) | notificationPreference | `c/layout/Topbar.tsx`, `cm/settings/NotificationOperationsPanel.tsx` | Action: preferences (notifications) — `app/api/notifications/preferences/route.ts` |
| POST | `/api/notifications/push-test` | session-only (no role check) | notificationEndpoint | `c/layout/Topbar.tsx` | Create — notifications / push test — `app/api/notifications/push-test/route.ts` |
| GET | `/api/notifications` | session (rows scoped to the caller) | notificationRecipient | `c/layout/Topbar.tsx`, `cm/settings/NotificationOperationsPanel.tsx` | List / read — notifications — `app/api/notifications/route.ts` |
| PATCH | `/api/notifications` | session (rows scoped to the caller) | notificationRecipient | `c/layout/Topbar.tsx`, `cm/settings/NotificationOperationsPanel.tsx` | Update — notifications — `app/api/notifications/route.ts` |
| POST | `/api/notifications/send` | secret:internal | repair, notificationDelivery | `lib/store.tsx` | Action: send (notifications) — `app/api/notifications/send/route.ts` |
| GET | `/api/notifications/stream` | session (rows scoped to the caller) | — | `c/layout/Topbar.tsx` | Read: stream (notifications) — `app/api/notifications/stream/route.ts` |
| POST | `/api/webhooks/notifications/sendgrid` | provider-verify | — | **none found** | Create — webhooks / notifications / sendgrid — `app/api/webhooks/notifications/sendgrid/route.ts` |
| POST | `/api/webhooks/notifications/ses` | provider-verify (AWS SNS signature) | — | **none found** | Create — webhooks / notifications / ses — `app/api/webhooks/notifications/ses/route.ts` |
| POST | `/api/webhooks/notifications/telerivet` | provider-verify | — | **none found** | Create — webhooks / notifications / telerivet — `app/api/webhooks/notifications/telerivet/route.ts` |
| POST | `/api/webhooks/notifications/twilio` | provider-verify | — | `lib/integrations/notifications.ts` | Create — webhooks / notifications / twilio — `app/api/webhooks/notifications/twilio/route.ts` |
| GET | `/api/webhooks/notifications/whatsapp` | provider-verify (verify token) | — | **none found** | List / read — webhooks / notifications / whatsapp — `app/api/webhooks/notifications/whatsapp/route.ts` |
| POST | `/api/webhooks/notifications/whatsapp` | provider-verify | — | **none found** | Create — webhooks / notifications / whatsapp — `app/api/webhooks/notifications/whatsapp/route.ts` |

### Partner (public) API

6 route files · 11 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| DELETE | `/api/partner-keys/[id]` | role:[DIR,ADM] | partnerApiKey | `cm/settings/PartnerApiKeys.tsx` | Delete / void — partner keys — `app/api/partner-keys/[id]/route.ts` |
| GET | `/api/partner-keys` | role:[DIR,ADM] | partnerApiKey | `cm/settings/PartnerApiKeys.tsx` | List / read — partner keys — `app/api/partner-keys/route.ts` |
| POST | `/api/partner-keys` | role:[DIR,ADM] | partnerApiKey | `cm/settings/PartnerApiKeys.tsx` | Create — partner keys — `app/api/partner-keys/route.ts` |
| OPTIONS | `/api/public/v1/catalog-photos/[packId]/[slot]` | public/token | — | `lib/product-images.ts` | CORS preflight — public / v1 / catalog photos — `app/api/public/v1/catalog-photos/[packId]/[slot]/route.ts` |
| GET | `/api/public/v1/catalog-photos/[packId]/[slot]` | public/token | — | `lib/product-images.ts` | Read one — public / v1 / catalog photos — `app/api/public/v1/catalog-photos/[packId]/[slot]/route.ts` |
| OPTIONS | `/api/public/v1/guide` | public/token | — | `cm/settings/PartnerApiKeys.tsx` | CORS preflight — public / v1 / guide — `app/api/public/v1/guide/route.ts` |
| GET | `/api/public/v1/guide` | public/token | — | `cm/settings/PartnerApiKeys.tsx` | List / read — public / v1 / guide — `app/api/public/v1/guide/route.ts` |
| OPTIONS | `/api/public/v1/products/[id]/images/[slot]` | public/token | product | `lib/product-images.ts` | CORS preflight — public / v1 / products / images — `app/api/public/v1/products/[id]/images/[slot]/route.ts` |
| GET | `/api/public/v1/products/[id]/images/[slot]` | public/token | product | `lib/product-images.ts` | Read one — public / v1 / products / images — `app/api/public/v1/products/[id]/images/[slot]/route.ts` |
| OPTIONS | `/api/public/v1/products` | partner-key | product; app_state/store | `cm/settings/PartnerApiKeys.tsx`, `lib/product-images.ts` | CORS preflight — public / v1 / products — `app/api/public/v1/products/route.ts` |
| GET | `/api/public/v1/products` | partner-key | product; app_state/store | `cm/settings/PartnerApiKeys.tsx`, `lib/product-images.ts` | List / read — public / v1 / products — `app/api/public/v1/products/route.ts` |

### Settings & audit

5 route files · 9 method-level endpoints

| Method | Route | Gate (server-side) | Persistence touched | In-repo caller | Purpose / source |
|---|---|---|---|---|---|
| POST | `/api/audit/commercial` | perm:appendAuditLog | — | `lib/store.tsx` | Create — audit / commercial — `app/api/audit/commercial/route.ts` |
| GET | `/api/settings/approval-rules` | role:[DIR,FIN,ADM,SALES,TL] | approvalRule | `cm/settings/ApprovalRulesEditor.tsx`, `lib/store.tsx` | List / read — settings / approval rules — `app/api/settings/approval-rules/route.ts` |
| PUT | `/api/settings/approval-rules` | role:[DIR,FIN] | approvalRule | `cm/settings/ApprovalRulesEditor.tsx`, `lib/store.tsx` | Replace / update — settings / approval rules — `app/api/settings/approval-rules/route.ts` |
| GET | `/api/settings/exchange-rates` | session-only (no role check) | exchangeRate | `cm/settings/CurrencyPricelistCutover.tsx` | List / read — settings / exchange rates — `app/api/settings/exchange-rates/route.ts` |
| POST | `/api/settings/exchange-rates` | role:[DIR,FIN] | exchangeRate | `cm/settings/CurrencyPricelistCutover.tsx` | Create — settings / exchange rates — `app/api/settings/exchange-rates/route.ts` |
| GET | `/api/settings/pricelists` | session-only (no role check) | priceList | `cm/Sales.tsx`, `cm/settings/CurrencyPricelistCutover.tsx` | List / read — settings / pricelists — `app/api/settings/pricelists/route.ts` |
| POST | `/api/settings/pricelists` | role:[DIR,FIN] | priceList | `cm/Sales.tsx`, `cm/settings/CurrencyPricelistCutover.tsx` | Create — settings / pricelists — `app/api/settings/pricelists/route.ts` |
| GET | `/api/settings` | session-only (no role check) | companySetting, auditLog | `cm/Sales.tsx`, `cm/settings/ApprovalRulesEditor.tsx` | List / read — settings — `app/api/settings/route.ts` |
| POST | `/api/settings` | role:[DIR,FIN] | companySetting, auditLog | `cm/Sales.tsx`, `cm/settings/ApprovalRulesEditor.tsx` | Create — settings — `app/api/settings/route.ts` |


## 3. Verified detail for the money-critical and security-critical endpoints

The following were read end-to-end. Payload names are exactly as parsed by the handler.

### 3.1 `POST /api/auth/login`
- **Auth:** none (rate-limited by middleware *and* `loginRatelimit` in the handler).
- **Request:** `{ username, password }` validated by `loginSchema` (`lib/validation.ts`).
- **Flow:** lookup user (`users` table via raw SQL repository) → reject inactive (`401 Invalid credentials`) → reject if `lockedUntil` in the future (`403 Account locked`) → bcrypt compare (legacy SHA-256 hashes accepted and silently re-hashed) → `recordFailedLogin` (5 failures → 15-minute lock) / `clearFailedLogin` → if role is `director`/`admin_officer`/`finance_officer`, a challenge cookie is set and the response is `{mfaRequired:true, mfaEnrollmentRequired}` unless a trusted-browser token is presented → otherwise `issueSessionResponse` (12-hour JWT).
- **Side effects:** `publishSessionStatus` (session validity cache).
- **Errors:** 400 invalid payload, 401 invalid credentials, 403 locked, 429 too many attempts, 500 missing secret, 503 MFA init failure.
- **Caller:** `components/auth/SecureLogin.tsx`, `components/modules/Login.tsx`.

### 3.2 `GET/POST /api/store`, `GET/PUT /api/store/[key]`, `GET /api/store/stream`
- **Purpose:** the generic "shared store" used by `lib/store.tsx` to hydrate and persist legacy collections (`deed_*` keys). This is the largest single write surface in the system.
- **GET:** `?keys=deed_a,deed_b` required (`400 keys query required`); each key filtered through `canReadStoreKey` and `filterStoreValueForRole` (row slices for invoices, expenses, sale orders, repairs, opportunities); returns `{ <key>: value, version }` with a weak `ETag`.
- **POST:** body is an object of `deed_*` keys (max 12 MB / 150 000 nodes / 30 000 array items). Unknown keys → `400 Unknown app-state key`; keys in `CLIENT_IMMUTABLE_STORE_KEYS` and the REST-SoT keys (`deed_quotes`, `deed_opportunities`, `deed_oppActivities`, `deed_leaveRequests`, `deed_leaveBalances`, `deed_payrollRuns`, `deed_contacts`, `deed_companies`, `deed_contactPersons`) are **silently dropped**; remaining keys must pass `canWriteStoreKey` (role + module grant) or the whole call is `403`.
- **Server-side merges before persisting:** role-sliced writers are merged by id into the full ledger (`mergeFilteredStoreWrite`); `deed_journalEntries` goes through `mergeAppendOnlyJournals`; empty-array writes over non-empty protected keys are skipped (`skippedKeys`); `deed_products`, `deed_posOrders`, `deed_posSessions`, `deed_saleOrders`, `deed_repairs_v2` use dedicated merge functions; `deed_repairs_v2` additionally passes `observeRepairTransitions` and honours repair tombstones.
- **Persistence:** `saveStoreKeys` → `app_state` and/or `erp_state_keys`/`erp_state_records` depending on `STORE_BACKEND`; bulk-delete guard (>5 removals refused); fire-and-forget Prisma mirrors for repairs, accounts, journals, reservations, deposits, holdovers, deliveries, purchase orders, serials, stock moves, receipts (`lib/server-store.ts`).
- **Audit:** `appendStoreAudit` appends `{actor, savedKeys, skippedKeys, deniedKeys}` to `deed_audit_timeline_v1` (capped at 600 rows; displaced rows archived to `store_audit_archive`).
- **Response:** `{ok, savedKeys, skippedKeys, deniedKeys, …}`; `403` when every key was denied; `409` on version conflict.

### 3.3 `POST /api/invoices` and `PUT|PATCH /api/invoices/[id]`, `DELETE /api/invoices/[id]`
- **Gate:** `requireRole` with `WRITE_ROLES = [DIR, FIN, ADM, TL]`; `TECH` only for invoices linked to a persisted `Repair`; POS roles for `isPosInvoiceWrite` bodies.
- **Totals:** recomputed server-side from lines (`computeInvoiceTotals`); header totals and `amountPaid` from the client are ignored.
- **Posted invoices are immutable:** `postedInvoicePutDecision` returns `already_posted` for stale "confirm" payloads, `reversal` only when `resetToDraft:true` (or a cancel/void status) is sent by FIN/ADM/DIR and `amountPaid = 0`; any economic key or status change on a posted invoice otherwise → `409 Posted invoices are immutable. Use a credit/debit note…`.
- **Posting (draft → posted):** requires tax category on every line (`409`); official number allocated from `doc_ref_counter` if the chosen number clashes; vendor bills linked to a PO pass a 3-way match (`assertVendorBillThreeWayMatchServer` then `…InTx`); the status update runs in a `Serializable` transaction with `postingStatus='posting'` and a `post_invoice` audit row; **after commit** the journal (`buildInvoiceJournalInput` → `createJournalEntry`), `TaxTransaction` rows and `postingStatus='posted'` are written best-effort. If journal creation fails the invoice **stays posted with `postingStatus='unposted'`** and the error is only logged (see Known Issue KI-02).
- **DELETE:** never hard-deletes; sets `status='voided'` (blocked when `amountPaid > 0`), reverses the posting journal, writes a `void_invoice` audit row. No fiscal-lock check on this path.
- **Callers:** `lib/store.tsx` (`sync('/api/invoices', …)`), `components/modules/InvoiceDetail.tsx`, `components/modules/Dashboard.tsx`.

### 3.4 `POST /api/invoices/[id]/payments`
- **Gate:** `requireRole([DIR, FIN, ADM])`; `canPostOrPayCustomerInvoice` and `canPayOwnPostedInvoice` (segregation of duties for ADM above `accAdminOfficerInvoiceLimitKes`, default KES 1,000,000 via `DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES`).
- **Request:** `{ amount, paymentMethod='cash', reference, paidAt, bankAccountId, idempotencyKey }`.
- **Validation:** `amount > 0`; fiscal lock on `paidAt`; invoice must be posted (a draft Prisma row is promoted to `approved` if the blob mirror says posted); `paymentBlocked` → 409; amount capped at the open balance; bank account must exist, be active and map to an active GL account.
- **Writes (one transaction via `recordPaymentWithAllocations`):** `Payment`, `PaymentAllocation`, `JournalEntry` `JRN/PAY/<invoiceNo>/<paymentId>` (Dr cash/bank/customer-credits, Cr 1800 AR), `AuditLog` + `FinancialAuditEvent` (`record_invoice_payment`); idempotent on `idempotencyKey` (unique column).
- **After commit:** customer receipt notification, business-event notification.
- **Known limitation:** the journal built here has **no vendor-bill branch** (always Dr cash / Cr AR) although the UI calls it for vendor bills too (`components/modules/Accounting.tsx` bulk pay) — see KI-03.

### 3.5 `POST /api/payments`
- **Gate:** `requireRole([DIR, FIN, ADM])`.
- **Two paths:** (a) no `allocations`/`outstanding` key → legacy blob path (`makeCollectionHandlers` on `deed_payments`; builds `PAY/<first 8 chars of uuid>` reference, status `pending`); (b) with `allocations` array or `outstanding:true` → Prisma path: validates amount ≤ 9 999 999 999.99, Σ allocations ≤ amount, fiscal lock on `paidAt`, `idempotencyKey`, `direction` (`inbound`/`outbound`), then records payment + allocations and posts `buildPaymentWithOutstandingLines` (unallocated remainder parked on 1933 Outstanding Receipts / 3202 Outstanding Payments).
- **Follow-up:** `POST /api/payments/[id]/allocations` clears outstanding balances onto invoices (`postAllocateOutstanding`; journal ref `JRN/PAYALC/<ref>/<base36 timestamp>`). No in-repo UI caller was found for this route.

### 3.6 `POST /api/accounting/journals`
- **Gate:** `requireRole([DIR, FIN])`. **Request (zod `.strict()`):** `{ ref(≤80), description, date?, journalCode?, lines[2..500]{account|accountLabel, description|label, debit, credit, analyticAccountId?} }`.
- **Rules:** fiscal-lock check; `sourceType` is forced to `manual`; `skipIfExists:false` so a duplicate `ref` → `409`; lines validated (≥2, no negative, no both-sides, balanced within 0.009, account code must exist and be active, analytic account must be active). Entries are immutable thereafter; correction is `reverseJournalEntry` (`REV/<ref>`).
- **`GET`:** posted, non-reversed entries only (`isReversed=false`), `limit` ≤ 500.

### 3.7 `POST /api/accounting/system-journals`
- **Gate:** `getRequiredSession` + `canWriteStoreKey(user, governingKey)` where `kind ∈ {fixed_asset→deed_companyAssets, pos_session→deed_posSessions, rma_refund→deed_returnOrders, buyback_credit→deed_buyBacks, sale_order_credit_note→deed_customerCredits, invoice_adjustment→deed_invoices}`.
- **Request (zod `.strict()`):** `{kind, id?, ref, date, description?, invoiceId?, paymentId?, lines[2..100]{account, description?, debit, credit}}`. The **lines and accounts are client-supplied**; the server only checks balance, account validity and fiscal lock (KI-06).

### 3.8 `POST /api/accounting/month-end`, `POST /api/accounting/fiscal-periods/[id]/close|reopen`, `GET|PUT /api/accounting/fiscal-lock`
- **month-end (DIR/FIN):** runs `runIntegritySuite(periodEnd)`; if any gate fails → `409` unless `force:true` **and** actor is DIR; upserts one `FinancialReconciliation` per gate plus a `month_end_certification` row (`certified` or `certified_with_exceptions`); `month_end_certify` audit event. Gates (18, `lib/accounting/integrity-suite.ts`): `tb_balanced, ar_vs_gl, ap_vs_gl, inventory_vs_gl, vat_vs_tax_txns, deposits_vs_gl, credits_vs_gl, grni_vs_gl, unposted_journals, invoices_without_journal, pos_sales_without_journal, unbalanced_journals, journal_mirror_backlog, journal_parity_posted, fiscal_period, payroll_liabilities, outstanding_receipts, outstanding_payments`. Two gates cannot fail: `grni_vs_gl` compares the TB balance to itself and `journal_parity_posted` is hard-coded `passed:true`; gate display names quote superseded account numbers (3102, 3110, 1805, 3005) while the logic uses the live role codes.
- **close (DIR/FIN):** integrity suite must pass; sets `FiscalPeriod.state='closed'` and **raises `FiscalLock.lockDate` to the period end** in one transaction; `close_fiscal_period` audit.
- **reopen (DIR):** requires `reason`; sets `state='open'`; `reopen_fiscal_period` audit. **It does not lower `FiscalLock.lockDate`**, and `journal-service` checks the lock date first — a reopened period therefore still rejects postings until the lock date is moved (KI-09).
- **fiscal-lock `PUT` (DIR/FIN):** sets any `lockDate` (including earlier than the current one); **no audit event is written** by this handler.
- **UI:** only `month-end` and `integrity` have a UI caller (`IntegrityDashboard.tsx`); fiscal periods and fiscal lock have none (API-only).

### 3.9 `POST /api/inventory/validate-receipt` (GRN validation)
- **Gate:** `hasPermission(user,'validatePurchaseReceipt')` (DIR, ADM, INV).
- **Request:** `{ lines[{productId, qtyReceived, requiresSerial, serials[], serialRecords[]}], applyStock?, destination?, receiptId, receiptRef, purchaseOrderId, supplierInvoiceNo?, notes? }`.
- **Rules:** serial uniqueness against `deed_serials`; receipt must be `draft` and linked to a PO; a `receiptRef` already linked to a different PO → `409`; an already-validated receipt returns `alreadyApplied:true` without duplicating stock; stock mutation and valuation (`processStockReceipt`: Dr 1200 Inventory, Cr 3201 GRNI) are applied server-side.

### 3.10 `POST /api/deliveries/[id]/validate`
- **Gate:** session only — **any authenticated role** (KI-04).
- **Rules:** runs under `withAppStateKeyLock('deed_deliveries')`; on first transition to `done` requires delivered quantity > 0, applies `applyDeliveryStockMutation` (serial status/location, stock moves) and `postDeliveryValuationFromPayload` (COGS Dr 6001 / Cr 1200). A valuation failure **after** stock deduction is caught and returned as `valuation:{ok:false}` — the delivery is still saved `done`.
- **Mirror:** `mirrorDeliveryToPrisma` (fire-and-forget).

### 3.11 `POST /api/sale-orders/[id]/create-invoice`
- **Gate:** `requireRole([DIR, FIN, ADM])`. Transactional; invoiceable quantity derived from delivered/ordered quantities per line policy (`resolveInvoicePolicy`: stockable hardware is delivery-first; services bill on order); supports down-payment modes (`lib/sales/down-payment.ts`). Source: `app/api/sale-orders/[id]/create-invoice/route.ts`, `lib/odoo-sales-flow.ts`.

### 3.12 `POST /api/pos/record-order`, `POST /api/pos/post-sale-journal`, `POST /api/inventory/apply-pos-stock`, `POST /api/pos/charge`
- **Gate:** `requireRole([DIR, FIN, ADM, SALES, KIL])` (apply-pos-stock: the same set via an inline `Set`).
- **record-order:** appends one ticket to `deed_posOrders` under an advisory lock (union-merge).
- **post-sale-journal:** parses client-supplied `{orderId, orderRef, invoiceId, total, subtotal, tax, pointsRedeemed, customerCreditAmount, paymentMethod, bankAccountId, revenueLines[]}` (no server recomputation from lines), checks fiscal lock, then in a `Serializable` transaction `postPosSale` (`JRN/<orderRef>`, journal `CSH`/`BNK`/`SAL`) + `post_pos_sale_engine` audit.
- **charge:** writes a `PosTransaction` with `sessionId:'default-session'` (not a UUID, FK to `pos_sessions`) — **cannot succeed against the schema and has no caller** (KI-26).

### 3.13 `PATCH /api/outbound-releases/[id]`
- **Gate:** session only; writes the **raw request body** into `OutboundRelease` (`prisma.outboundRelease.update({data: body})`). The UI never calls this route (it uses `/pick`, `/verify`, `/release`, `/void`, whose gates are in the table), but it is reachable by any logged-in user (KI-05).

### 3.14 `POST /api/mpesa/stk-push`, `POST /api/mpesa/callback`
- **stk-push:** session only; creates an `MpesaStkRequest` through `startStkPush` (Daraja). **Callback:** public; body parsed by `parseStkCallback`; updates the matching `MpesaStkRequest` by `CheckoutRequestID` (status/result/receipt) and always answers `200 {ResultCode:0}`. It does **not** create a `Payment` or journal; a user must register the payment separately (KI-18).

### 3.15 `POST /api/users`, `PATCH|DELETE|POST /api/users/[id]`
- **Gate:** `requirePermission('manageUsers')` (DIR) / `viewUsers` (DIR, ADM). New users are created from an HR employee, with a server-generated temporary password, `mustChangePassword`, and credentials e-mailed (`resend-credentials`). Audit objects are returned in the response (`audit:{action, actor, targetId}`); persistent user-management audit rows were **not** verified.

### 3.16 `POST /api/setup-admin`
- Public to middleware; requires `x-setup-secret` equal to `SETUP_ADMIN_SECRET` (timing-safe) and refuses when any user exists; password must satisfy `isStrongBootstrapPassword`; never returns the password. `verify-production-config.mjs` fails the deploy check if `SETUP_ADMIN_SECRET` is still set.

## 4. Route-file counts by gate classification

| Gate class (method-level endpoints) | Count |
|---|---|
| role-gated (inline role list / requireRole) | 200 |
| permission-gated (roleMatrix) | 33 |
| store-key ACL (session + store policy) | 8 |
| session, rows scoped to the caller | 8 |
| session + inline role/module logic | 25 |
| session-only (no role check) | 68 |
| secret / provider-verified | 19 |
| public or self-authenticated | 33 |
| re-export of another route | 8 |
| other / see source | 9 |
| **Total** | **411** |

_Counts are derived from the static gate detection described in the API reference header; the "session-only (no role check)" row includes endpoints explicitly marked ⚠ in the table._
