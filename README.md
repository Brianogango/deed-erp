# Deed ERP — Next.js 14

A full Odoo-18-inspired ERP built with Next.js 14, TypeScript, and Tailwind CSS.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run development server
npm run dev

# 3. Open in browser
http://localhost:3000
```

## Tech Stack

- **Next.js 14** — App Router
- **TypeScript** — Type safety
- **Tailwind CSS** — Styling
- **Recharts** — Charts
- **Lucide React** — Icons
- **DM Sans / DM Mono** — Fonts

## Modules Included

### Sales
- CRM — Kanban pipeline (Lead → Qualified → Proposal → Negotiation → Won → Lost)
- Sales — Orders with salesperson, margin, status
- Point of Sale — Interactive till with VAT calculation
- Subscriptions — Recurring revenue plans
- eCommerce — Online store analytics

### Operations
- Inventory — Stock levels with visual progress bars
- Purchase — PO management
- Repairs — Job tracking with technician assignment
- Trade-in — Device exchange valuations
- Logistics — Delivery tracking

### Finance
- Accounting — P&L, journal entries, bar chart
- Invoicing — Invoice lifecycle management
- Financing — Loan & credit plans

### People
- Employees — Staff directory with avatars
- Payroll — Salary, allowances, deductions
- Time Off — Leave requests
- Recruitment — Job postings & applicants

### Service
- Helpdesk — Support tickets with SLA
- Project — Kanban task board
- Field Service — Dispatch & tracking

### Marketing
- Email Marketing — Campaign performance
- Social Marketing — Scheduled posts
- Events — Event management

### Productivity
- Discuss — Real-time team chat (functional)
- Calendar — April 2026 with event dots
- To-do — Interactive checklist
- Documents — File manager
- Sign — e-Signature tracking
- Settings — Company config, modules, users

## Deployment (Production)

### Hosted deployment

This application can be deployed on **Vercel**.

1. **Database Setup:** 
   Provision a PostgreSQL database (e.g., Vercel Postgres, Supabase, Neon) and an Upstash Redis database (for rate-limiting).
2. **Environment Variables:**
   Add the following variables to your Vercel project settings:
   - `DATABASE_URL` (PostgreSQL connection string)
   - `AUTH_SECRET` (Random 32-char string for sessions)
   - `CUSTOMER_PORTAL_SECRET` (Random 32-char string)
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. **Deploy:**
   Connect your GitHub repository to Vercel. The `vercel.json` file will automatically handle the build command (`npx prisma generate && next build`).

### Self-hosted deployment safety

The self-hosted production scripts assume the application is at
`/var/www/deed-erp`, with production secrets in `/var/www/deed-erp/.env`.
They never print `DATABASE_URL` and never pass its password-bearing URL as a
PostgreSQL command argument.

Install or replace the root-owned production copies after reviewing the diff:

```bash
sudo install -m 0750 -o root -g root scripts/backup-db.sh /usr/local/bin/deed-erp-backup.sh
sudo install -m 0750 -o root -g root scripts/verify-backup.sh /usr/local/bin/deed-erp-verify-backup.sh
sudo install -m 0750 -o root -g root scripts/deploy/deed-erp-deploy.sh /usr/local/bin/deed-erp-deploy.sh
```

The backup defaults to `/var/backups/deed-erp`. It detects the connected
database name, creates one custom PostgreSQL dump, archives
`/var/lib/deed-erp/blobs` and `/var/www/deed-erp/.uploads`, and writes a JSON
manifest containing UTC timestamps, methods, paths, byte sizes, SHA-256
digests, the source commit, and PostgreSQL client/server versions. Override
locations with `BACKUP_DIR`, `BLOB_STORE_DIR`, and `UPLOADS_DIR`.

Run a backup manually:

```bash
sudo /usr/local/bin/deed-erp-backup.sh
```

A successful run validates the dump listing and archives, restores into a new
temporary database, checks that database, removes it, and records
`restore_status: "success"` and `verified: true`. If temporary database
creation is not permitted, verification fails closed and deployment does not
continue. `BACKUP_RESTORE_MODE=skip` is available for artifact-only collection,
but returns nonzero and explicitly records the backup as unverified.

Run the deployment only after both backup tools are installed:

```bash
sudo /usr/local/bin/deed-erp-deploy.sh
```

The deploy refuses a dirty source tree or missing current `.next`, requires a
fresh successfully restored backup before Git source sync, builds into
`.next-staging`, and retains the prior build as `.next-previous`. A failed PM2
reload or health check automatically resets to the previous commit, restores
the previous build, and restarts PM2. Database state is never changed during
deployment rollback. Deployment logs are mode `0600` and pass through secret
redaction.

#### Rollback and restore notes

The most recent rollback metadata is stored under
`/var/lib/deed-erp/deploy-rollback` by default:

- `previous-commit` identifies the source revision before deployment.
- `pre-deploy-backup-manifest` identifies the proven backup.
- `/var/www/deed-erp/.next-previous` is the matching previous build after a
  successful deployment.

Automatic rollback handles reload and health failures. For a manual
source/build rollback, first confirm the worktree has no local changes, save
the currently failed `.next` for investigation, reset to the commit recorded
in `previous-commit`, and move `.next-previous` back to `.next`:

```bash
cd /var/www/deed-erp
git status --short
previous_commit="$(sudo sed -n '1p' /var/lib/deed-erp/deploy-rollback/previous-commit)"
sudo mv .next ".next.failed.$(date -u +%Y%m%dT%H%M%SZ)"
sudo git reset --hard "$previous_commit"
sudo mv .next-previous .next
sudo pm2 startOrReload ecosystem.config.js --update-env
sudo pm2 save
```

Do not restore a backup over the production database. Create a new empty
database, restore `database.dump` into it with `pg_restore --exit-on-error
--no-owner --no-privileges`, validate application data and archived files in
a staging location, and schedule any production replacement as a separate
maintenance operation. Use libpq environment variables or a protected password
file rather than putting a credential-bearing URL on the command line.

### PWA Support
The app is configured as a Progressive Web App (PWA). Once deployed, users can install the ERP directly to their mobile devices or desktops for an app-like experience with offline caching capabilities for the Point of Sale module.

## Structure

```
deed-erp/
├── app/
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Main page + module router
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx    # Collapsible sidebar
│   │   └── Topbar.tsx     # Top navigation bar
│   ├── modules/
│   │   ├── Home.tsx       # Dashboard
│   │   ├── Apps.tsx       # App launcher + CRM
│   │   ├── Sales.tsx      # Sales, POS, eCommerce, Subscriptions
│   │   ├── Operations.tsx # Inventory, Purchase, Repairs, Trade-in, Logistics
│   │   ├── Finance.tsx    # Accounting, Invoicing, Financing
│   │   └── People.tsx     # All remaining modules
│   └── ui/
│       └── index.tsx      # Shared UI components (Badge, StatCard, etc.)
└── lib/
    ├── data.ts            # Mock data
    └── store.tsx          # App state (Context API)
```

## Key Features

- **Collapsible sidebar** — Click the D logo to collapse/expand
- **28 modules** — All fully navigable
- **Live POS** — Click products to add to cart, VAT auto-calculated
- **Live Discuss** — Type and send messages in chat
- **Interactive To-do** — Click tasks to toggle completion
- **Revenue chart** — Recharts AreaChart on Home dashboard
- **Accounting chart** — Recharts BarChart for P&L visualization
- **Dark theme** — Consistent dark UI throughout

## Customization

All data lives in `lib/data.ts` — replace with real API calls.

State management is in `lib/store.tsx` — extend with `useReducer` or Zustand for production.
