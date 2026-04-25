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

This application is optimized for deployment on **Vercel**.

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
