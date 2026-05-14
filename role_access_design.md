# Role Access Design

This implementation will replace the legacy five-role model with the requested operational role catalog while preserving existing legacy role aliases during normalization so older stored users continue to work after deployment.

| Requested role | Internal role key | Operational access | Common employee self-service baseline |
|---|---|---|---|
| Director | `director` | Full access to every module, approvals, settings, user management, and audit trail. | Leave application, performance targets, payslip, account settings, and expense application. |
| Admin Officer | `admin_officer` | Process, master-data, workflow control, invoicing, quotations, sales orders, customer records, and purchasing. | Leave application, performance targets, payslip, account settings, and expense application. |
| Finance Officer | `finance_officer` | Invoicing, bills, payments, bank/cash, tax, reconciliation, financial reports, CRM, quotations, sales orders, customer records, settlement uploads, purchase, process, master-data, and workflow control. | Leave application, performance targets, payslip, account settings, and expense application. |
| Inventory Officer | `inventory_officer` | Physical stock control only: receives goods, transfers stock, and counts stock. No accounting. | Leave application, performance targets, payslip, account settings, and expense application. |
| Kilimall Officer | `kilimall_officer` | Processes Kilimall orders, allocates stock, and manages returns. | Leave application, performance targets, payslip, account settings, and expense application. |
| Sales Rep | `sales_rep` | CRM, quotations, sales orders, and customer records. No purchasing or stock edits. | Leave application, performance targets, payslip, account settings, and expense application. |
| Technical Lead | `technical_lead` | Assigns repair jobs, QA sign-off, and refurbishment oversight. No accounting. | Leave application, performance targets, payslip, account settings, and expense application. |
| Technician | `technician` | Assigned repair jobs only, including diagnosis, parts requests, and status updates. | Leave application, performance targets, payslip, account settings, and expense application. |

The common baseline will be enforced through the central module access helper so every authenticated active user can reach HR self-service, leave, performance targets, documents/payslips, expenses, and account settings. Operational screens remain role-gated through each user's modules and server-side permission actions.

The settings user-creation flow will be changed so new system users are created from active HR employees only. The server will derive the name and username from the selected employee, generate a temporary password, require password reset on first login, link the user back to the employee, and send the credentials to the employee email address. Manual username/name/password entry for new accounts will be removed from the client flow.
