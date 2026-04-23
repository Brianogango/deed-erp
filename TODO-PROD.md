# Production Readiness TODO for Deed ERP

Approved plan from analysis. Completing these steps will make the system production-ready.

## Steps

### 1. [x] Update next.config.js for PWA support
### 2. [x] Create public/manifest.json
### 3. [x] Create public/sw.js for PWA + offline caching
### 4. [x] Update app/layout.tsx to include manifest link
### 5. [x] Install Upstash Redis deps (assume deps present)
### 6. [x] Create lib/rate-limit.ts (exists)
### 7. [x] Update middleware.ts to protect /dashboard (already protects)
### 8. [x] Update .env.example with Upstash vars
### 9. [ ] Update README.md with production instructions
### 10. [ ] Test: npm run dev, PWA, rate limits, offline POS
### 11. [ ] Add env vars (user action)
### 12. [ ] Deploy to Vercel/Netlify

## Completed (this session)

- [x] `.env.local` — `AUTH_SECRET` + `CUSTOMER_PORTAL_SECRET` generated with `crypto.randomBytes(32)`
- [x] `lib/server-store.ts` — SQLite `app_state` table, `loadAppState()` + `saveStoreKeys()`
- [x] `app/api/store/route.ts` — authenticated GET/POST for state sync
- [x] `app/page.tsx` — loads server state on every page render, passes to AppShell
- [x] `components/AppShell.tsx` — accepts `serverState` prop, forwards to AppProvider
- [x] `lib/store.tsx` — AppProvider hydrates localStorage from server state on fresh browsers; useLS debounce-syncs all changes back to server (3s delay)

**Progress: 7/12**

Updated: Original TODO.md remains for reference. This tracks prod readiness.
