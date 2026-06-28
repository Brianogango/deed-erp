# AGENTS.md

## Cursor Cloud specific instructions

Deed ERP is a single Next.js 14 (App Router) + TypeScript app. It needs **PostgreSQL** to run.
Dependencies are refreshed automatically on startup via `npm install` (its `postinstall` runs `prisma generate`).

### Services / how to run
- **Web app (dev):** `npm run dev` → http://localhost:3000 (the only long-running service). Standard scripts live in `package.json`.
- **PostgreSQL:** required, and **not auto-started** in this environment. Start it with `sudo pg_ctlcluster 16 main start` before running the app or `prisma`. The dev database `deed_erp` and a working `.env` already exist in the VM snapshot.
- **Tests:** `npm test` (Vitest). There is **no lint script / ESLint config** in this repo, so "run lint" is a no-op here.

### Environment / DB setup (already done in the snapshot; redo only on a fresh DB)
- `.env` is gitignored and lives in the workspace. Required vars: `DATABASE_URL`, `AUTH_SECRET`/`NEXTAUTH_SECRET`, `CUSTOMER_PORTAL_SECRET`, `NEXT_PUBLIC_APP_URL`. `DATABASE_URL` points at `postgresql://postgres:postgres@localhost:5432/deed_erp`.
- Schema is applied with `npx prisma db push` (not `migrate`).

### Non-obvious gotcha: the `users` table is a hybrid schema
The auth layer (`lib/auth/users-repository.ts`, `lib/auth/db.ts`) talks to the `users` table with **raw SQL**, not Prisma, and expects legacy columns (`name`, `modules_json`, `active`) plus the Prisma columns. A fresh `prisma db push` does **not** create those legacy columns, and the built-in `seedUsersIfEmpty` auto-seed inserts non-UUID ids (e.g. `u_brian`) that fail against the Prisma `uuid` id column. So on a brand-new DB you must, after `prisma db push`: add the legacy columns (`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT; modules_json TEXT DEFAULT '[]'; active INTEGER DEFAULT 1`) and seed users with valid UUID ids (`gen_random_uuid()`), bcrypt password hashes (cost 12), `email`, and a valid `role` enum value. These users are already seeded in the snapshot.

### Dev login credentials (seeded)
`brian` / `Og@835408` (director), `director` / `admin123`, `finance1` / `finance123`, `leadtech1` / `leadtech123`, `tech1` / `tech123`, `sales1` / `sales123`.

### Optional integrations (off by default, degrade gracefully)
Anthropic (JARVIS AI), email (SendGrid/SES/SMTP), WhatsApp/Twilio, Google Calendar, Upstash Redis rate-limiting (falls back to in-memory). None are needed for local development.
