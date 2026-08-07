# Agent Instructions

## Cursor Cloud specific instructions

- Install the locked dependencies with `npm ci`. `prisma generate` runs during postinstall and does not require a database.
- Build and most unit tests run without `DATABASE_URL`. Use `npm run build` and focused `npm test -- --run <test-file>`.
- For UI work that does not require persisted records, start the real application shell with:

  ```bash
  VISREG_BYPASS_AUTH=true npm run dev
  ```

  Then test the production route (for example, `/sales`), not the static `/sales-prototype` look-alike. Bypass mode supplies the standard visual-regression user and intentionally skips database hydration.
- Authenticated or data-dependent testing requires a disposable, non-production PostgreSQL database supplied through a Cursor secret. Set `DATABASE_URL`, run `npx prisma db push`, and use test-only credentials. Never point a Cloud Agent at the Contabo production database or copy production customer data into Cloud.
- The production deployment is under `/var/www/deed-erp`, managed by PM2 behind Nginx, with PostgreSQL bound to localhost. Treat it as read-only for investigation unless the user explicitly requests a deployment or server mutation.
- Never write SSH passwords, database URLs, application secrets, or login credentials into tracked files, terminal logs, screenshots, PR descriptions, or test fixtures.
