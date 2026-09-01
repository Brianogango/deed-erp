# Pagination rollout

Standardize large operational lists on the Sales-style pagination contract:

- 10 rows by default for large operational lists.
- 10 / 25 / 50 rows-per-page choices.
- Previous / numbered pages / Next controls.
- Visible `x–y of n` record range.
- Mobile-safe touch targets and wrapping.
- Page resets when search/filter/sort context changes.
- Page clamps when the filtered result set becomes smaller.
- Detail/form sub-tables and intentionally small dashboard widgets keep their explicit page size.

The shared DataTable is the rollout point so Repair, Accounting invoices, Purchases, Inventory, Contacts, Expenses, HR, CRM and other migrated large lists inherit the same behaviour instead of maintaining bespoke pagination.
