# Permission matrix (prototype note)

Prototypes are **public** (`/sales-prototype` in middleware) and do not enforce roles.

Production integration must reuse `lib/auth/authorization.ts`:

| Capability | Typical roles |
|------------|---------------|
| Create / edit draft quotation | sales_rep, admin_officer, director |
| Send quotation | sales_rep, admin_officer, director |
| Confirm quotation | sales_rep, admin_officer, director |
| Confirm without reservation | director, inventory_officer (proposed) |
| Reserve / release stock | inventory_officer, director |
| Validate delivery | inventory_officer, technical_lead, director |
| Create / post invoice | finance_officer, admin_officer, director |
| Record payment | finance_officer, admin_officer, director |
| View cost / margin | director, finance_officer |

Backend checks remain authoritative — never UI-only.
