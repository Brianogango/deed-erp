# Implementation plan — prototypes only

1. Isolated branch `cursor/sales-module-prototypes-ddc8`
2. Public prefix `/sales-prototype` (middleware allowlist)
3. Seven high-fidelity pages with demo data
4. Screenshot pack desktop / tablet / mobile
5. Discrepancy + a11y + interaction report
6. **Stop** — no production Sales.tsx / schema / accounting changes until approval

## Production integration (future, not this PR)

- Map statuses onto `lib/odoo-sales-flow.ts`
- Reuse `erp/*` + `data-table` components
- Resolve accent: purple vs Direction B navy/cyan
- Wire confirm/reserve/pick/invoice to existing APIs with permission checks
