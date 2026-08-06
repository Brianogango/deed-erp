#!/usr/bin/env python3
"""One-shot heal: merge Prisma invoices into app_state.deed_invoices by id.

Safe: never deletes blob-only rows; only adds missing Prisma ids and refreshes
amountPaid. Writes a timestamped backup key before mutating.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone


def database_url() -> str:
    env_path = os.environ.get("ENV_FILE", "/var/www/deed-erp/.env")
    text = open(env_path).read()
    m = re.search(r"^DATABASE_URL=(.*)$", text, re.M)
    if not m:
        raise SystemExit("DATABASE_URL not found")
    return m.group(1).strip().strip('"')


def psql(url: str, sql: str) -> str:
    return subprocess.check_output(["psql", url, "-t", "-A", "-c", sql], text=True)


def map_status(status: str) -> str:
    if status in ("draft", "pending_approval", "rejected"):
        return "draft"
    if status in ("cancelled", "voided", "void"):
        return "cancelled"
    return "posted"


def invoice_type(ref: str) -> str:
    u = (ref or "").upper()
    if u.startswith("BILL") or u.startswith("DRAFT/BILL"):
        return "vendor_bill"
    return "customer_invoice"


def num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def date_only(v) -> str:
    s = str(v or "")
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def main() -> int:
    url = database_url()
    dry = "--dry-run" in sys.argv

    raw_blob = psql(url, "SELECT value FROM app_state WHERE key='deed_invoices'").strip()
    blob = json.loads(raw_blob) if raw_blob else []
    if not isinstance(blob, list):
        raise SystemExit("deed_invoices is not an array")

    # invoices + clients
    inv_rows = psql(
        url,
        """
        SELECT i.id, i.invoice_number, i.status::text, i.client_id, COALESCE(c.name,''),
               i.invoice_date::text, COALESCE(i.due_date::text,''),
               i.subtotal::text, i.tax_amount::text, i.total_amount::text, i.amount_paid::text,
               COALESCE(i.sale_order_id::text,''), COALESCE(i.repair_id::text,''),
               COALESCE(i.quote_id::text,''), COALESCE(i.notes,''),
               COALESCE(i.invoice_address,''), COALESCE(i.delivery_address,''),
               i.payment_blocked::text, i.currency_code, i.base_currency_code,
               i.exchange_rate_to_base::text,
               COALESCE(i.approved_by::text,''), COALESCE(i.approved_at::text,'')
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        ORDER BY i.created_at ASC
        """,
    ).strip().split("\n")

    items_raw = psql(
        url,
        """
        SELECT invoice_id::text, id::text, COALESCE(description,''), qty::text, unit_price::text,
               tax_rate::text, discount_pct::text, line_subtotal::text,
               COALESCE(product_id::text,''), sort_order::text
        FROM invoice_items
        ORDER BY invoice_id, sort_order
        """,
    ).strip().split("\n")

    items_by_inv: dict[str, list] = defaultdict(list)
    for line in items_raw:
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 10:
            continue
        inv_id, item_id, desc, qty, unit, tax, disc, sub, product_id, sort = parts[:10]
        qty_n, unit_n = num(qty), num(unit)
        is_section = (not product_id) and qty_n == 0 and unit_n == 0
        line_obj = {
            "id": item_id,
            "description": desc,
            "qty": qty_n,
            "unitPrice": unit_n,
            "taxRate": num(tax),
            "subtotal": num(sub),
            "lineType": "section" if is_section else "item",
        }
        if num(disc) > 0:
            line_obj["discountPct"] = num(disc)
        if product_id:
            line_obj["productId"] = product_id
        items_by_inv[inv_id].append(line_obj)

    by_id = {str(r.get("id")): dict(r) for r in blob if isinstance(r, dict) and r.get("id")}
    added = 0
    refreshed = 0

    for line in inv_rows:
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 22:
            continue
        (
            iid, ref, status, client_id, client_name, inv_date, due_date,
            subtotal, tax, total, paid, so_id, repair_id, quote_id, notes,
            inv_addr, del_addr, blocked, currency, base_currency, fx, approved_by, approved_at,
        ) = parts[:23] if len(parts) >= 23 else (*parts, "")[:23]

        mapped = {
            "id": iid,
            "ref": ref,
            "type": invoice_type(ref),
            "status": map_status(status),
            "partnerId": client_id,
            "partnerName": client_name,
            "date": date_only(inv_date),
            "dueDate": date_only(due_date or inv_date),
            "lines": items_by_inv.get(iid, []),
            "subtotal": num(subtotal),
            "taxTotal": num(tax),
            "total": num(total),
            "amountPaid": min(max(0.0, num(paid)), num(total)),
            "notes": notes or "",
        }
        if so_id:
            mapped["saleOrderId"] = so_id
        if repair_id:
            mapped["repairId"] = repair_id
        if quote_id:
            mapped["quoteId"] = quote_id
        if inv_addr:
            mapped["invoiceAddress"] = inv_addr
        if del_addr:
            mapped["deliveryAddress"] = del_addr
        if blocked.lower() in ("t", "true", "1"):
            mapped["paymentBlocked"] = True
        if currency:
            mapped["currencyCode"] = currency
        if base_currency:
            mapped["baseCurrencyCode"] = base_currency
        if fx:
            mapped["exchangeRateToBase"] = num(fx)
        if approved_by:
            mapped["postedByUserId"] = approved_by
        if approved_at:
            mapped["postedAt"] = date_only(approved_at)

        existing = by_id.get(iid)
        if not existing:
            by_id[iid] = mapped
            added += 1
            continue
        if num(existing.get("amountPaid")) != num(mapped["amountPaid"]):
            existing["amountPaid"] = mapped["amountPaid"]
            refreshed += 1
        if mapped["status"] == "cancelled" and existing.get("status") != "cancelled":
            existing["status"] = "cancelled"

    merged = list(by_id.values())
    cust = sum(1 for r in merged if r.get("type") == "customer_invoice")
    vend = sum(1 for r in merged if r.get("type") == "vendor_bill")
    print(json.dumps({
        "blobBefore": len(blob),
        "blobAfter": len(merged),
        "prismaCount": len([l for l in inv_rows if l]),
        "added": added,
        "refreshedPaid": refreshed,
        "customerInvoices": cust,
        "vendorBills": vend,
        "dryRun": dry,
    }, indent=2))

    if dry:
        return 0
    if added == 0 and refreshed == 0:
        print("nothing to write")
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    backup_key = f"archive:deed_invoices:heal-{stamp}"
    # escape for dollar-quoting
    backup_sql = (
        "INSERT INTO app_state(key, value, updated_at) VALUES ("
        f"'{backup_key}', "
        f"$blob${raw_blob}$blob$, "
        f"'{datetime.now(timezone.utc).isoformat()}'"
        ") ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;"
    )
    new_json = json.dumps(merged, separators=(",", ":"))
    write_sql = (
        "UPDATE app_state SET "
        f"value = $blob${new_json}$blob$, "
        f"updated_at = '{datetime.now(timezone.utc).isoformat()}' "
        "WHERE key = 'deed_invoices';"
    )
    subprocess.check_call(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", backup_sql])
    subprocess.check_call(["psql", url, "-v", "ON_ERROR_STOP=1", "-c", write_sql])
    print(f"backed up to {backup_key} and wrote deed_invoices")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
