# Validation rules (prototype checklist)

Prototypes surface warnings but do not block production data.

| Gate | Prototype treatment | Production requirement |
|------|---------------------|------------------------|
| Customer required | Pre-filled demo | Hard fail |
| ≥1 line | Demo lines present | Hard fail |
| Expiry | Valid-until shown | Hard fail if past |
| Stock shortage | Amber banner on quote | Confirm dialog lists shortages |
| Duplicate confirm | Toast only | Idempotent server check |
| Serial duplicate / invalid | Toast on scan | Hard fail |
| Over-pick | Not interactive beyond toast | Hard fail |
| Over-invoice | Qty columns shown | Hard fail |
| Duplicate delivery post | Toast only | Hard fail |

See also `lib/odoo-sales-flow.ts` for live transition rules.
