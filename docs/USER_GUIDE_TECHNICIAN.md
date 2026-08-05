# Technician — Quick-start guide

**Role:** `technician` · Assigned repair jobs: diagnosis, parts requests, and status updates. You focus on workshop work, not sales or accounting.

---

## What you can access

| Area | Route | Typical use |
|------|-------|-------------|
| Dashboard | `/` | Assigned work cues |
| Repairs | `/repairs` | **Your assigned** jobs |
| Reconfiguration | `/reconfiguration` | Component work when assigned |
| Self-service | `/hr`, `/expenses`, `/documents`, `/sops`, `/sop-documents` | Leave, expenses, SOPs, payslips |

**Not available by default:** Sales, Finance, Purchases, Inventory administration, POS, Settings, Delivery boards.

You normally see only repairs **assigned to you**, and repair-linked invoice context when billing is in play — you do not create sale orders or record general sales.

---

## Common tasks

### 1. Open an assigned job

1. Go to **Repairs**.
2. Filter to your name / assigned status.
3. Open the job card: customer, device, reported fault, accessories, and history.

### 2. Record diagnosis

1. Move the job to **diagnosed** when findings are ready.
2. Enter findings, fault description, recommended action, and time estimate.
3. Save — Admin / Technical Lead use this for customer quotes and approvals.

Do not skip diagnosis notes; the customer portal and quotes depend on them.

### 3. Work the repair after approval

Typical status path (simplified):

`assigned` → `diagnosed` → (awaiting approval) → `approved` → `in_repair` → `qc` → `ready` → … → `collected`

1. Start work only after the job is **approved** (or your lead confirms a no-charge / direct path).
2. Request parts through the repair workflow — do not quietly remove serial stock without a parts line.
3. Update status when you finish so QC and front desk can proceed.

### 4. QC and ready for collection

1. Complete internal QC checks required by your workshop.
2. Move to **ready** when the device can leave.
3. Collection / outbound release is usually completed by front desk or Admin — follow local procedure.

### 5. Customer communication

1. Use the repair’s communication / notes fields as directed by your lead.
2. Never paste passwords, payment card data, or internal credentials into repair notes (customers may see portal content).

---

## Tips

- Read **Standards & SOPs** (`/sop-documents`) for bench procedures before unusual jobs.
- If a job is not on your list, ask Technical Lead / Admin to assign it — do not work off-system.
- Photo evidence: follow intake photo rules; avoid embedding huge files in notes when uploads exist.

## Limitations

| You cannot | Escalate to |
|------------|-------------|
| Create / confirm sales orders | Sales / Admin |
| Post invoices or take payments | Finance / Admin / Director |
| Validate GRNs or edit catalogue stock | Inventory / Admin / Director |
| See all workshop jobs (only assigned) | Technical Lead / Admin / Director |
| Manage users or settings | Director |

If parts are missing, escalate early — do not hold a job in `in_repair` without a parts request or status note.
