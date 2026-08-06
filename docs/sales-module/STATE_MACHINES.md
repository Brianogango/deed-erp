# State machines / permissions / validation (prototype docs)

See also production SSoT: `lib/odoo-sales-flow.ts`, `lib/auth/authorization.ts`.

## State machines (target vocabulary)

Documented in the audit brief; prototypes display labels without mutating production enums.

## Permission matrix (prototype display only)

Buttons are visible for demo; production must keep backend checks for confirm, reserve, validate delivery, post invoice, register payment, view margin.

## Validation rules (demo messaging)

Confirm dialog lists customer/lines/expiry/stock/delivery checks. Serial picking blocks invalid/duplicate scans in UI state only.
