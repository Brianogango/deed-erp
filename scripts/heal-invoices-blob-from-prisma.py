#!/usr/bin/env python3
"""One-shot heal: merge Prisma invoices into app_state.deed_invoices by id.

Safe: never deletes blob-only rows; only adds missing Prisma ids and refreshes
amountPaid / empty lines. Writes a timestamped backup key before mutating.

Uses json_agg so invoice notes with newlines cannot break parsing.
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


def psql_json(url: str, sql: str):
    out = subprocess.check_output(["psql", url, "-t", "-A", "-c", sql], text=True).strip()
    return json.loads(out) if out else []


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

    raw_blob = subprocess.check_output(
        ["psql", url, "-t", "-A", "-c", "SELECT value FROM app_state WHERE key='deed_invoices'"],
        text=True,
    ).strip()
    blob = json.loads(raw_blob) if raw_blob else []
    if not isinstance(blob, list):
        raise SystemExit("deed_invoices is not an array")

    invoices = psql_json(
        url,
        """
        SELECT COALESCE(json_agg(row_to_json(t) ORDER BY created_at), '[]'::json) FROM (
          SELECT i.id, i.invoice_number, i.status::text AS status, i.client_id,
                 c.name AS client_name, i.invoice_date::text AS invoice_date,
                 i.due_date::text AS due_date, i.subtotal, i.tax_amount, i.total_amount,
                 i.amount_paid, i.sale_order_id, i.repair_id, i.quote_id, i.notes,
                 i.invoice_address, i.delivery_address, i.payment_blocked,
                 i.currency_code, i.base_currency_code, i.exchange_rate_to_base,
                 i.approved_by, i.approved_at::text AS approved_at, i.created_at
          FROM invoices i
          JOIN clients c ON c.id = i.client_id
        ) t;
        """,
    )
    items = psql_json(
        url,
        """
        SELECT COALESCE(json_agg(row_to_json(t) ORDER BY invoice_id, sort_order), '[]'::json) FROM (
          SELECT id, invoice_id, description, qty, unit_price, tax_rate, discount_pct,
                 line_subtotal, product_id, sort_order
          FROM invoice_items
        ) t;
        """,
    )

    items_by: dict[str, list] = defaultdict(list)
    for it in items:
        qty = num(it.get("qty"))
        unit = num(it.get("unit_price"))
        product_id = it.get("product_id")
        is_section = (not product_id) and qty == 0 and unit == 0
        line = {
            "id": it["id"],
            "description": it.get("description") or "",
            "qty": qty,
            "unitPrice": unit,
            "taxRate": num(it.get("tax_rate")),
            "subtotal": num(it.get("line_subtotal")),
            "lineType": "section" if is_section else "item",
        }
        if num(it.get("discount_pct")) > 0:
            line["discountPct"] = num(it.get("discount_pct"))
        if product_id:
            line["productId"] = product_id
        items_by[it["invoice_id"]].append(line)

    by_id = {str(r.get("id")): dict(r) for r in blob if isinstance(r, dict) and r.get("id")}
    added = 0
    refreshed = 0

    for inv in invoices:
        ref = inv["invoice_number"]
        total = num(inv.get("total_amount"))
        paid = min(max(0.0, num(inv.get("amount_paid"))), total)
        mapped = {
            "id": inv["id"],
            "ref": ref,
            "type": invoice_type(ref),
            "status": map_status(inv["status"]),
            "partnerId": inv["client_id"],
            "partnerName": inv.get("client_name") or "",
            "date": date_only(inv.get("invoice_date")),
            "dueDate": date_only(inv.get("due_date") or inv.get("invoice_date")),
            "lines": items_by.get(inv["id"], []),
            "subtotal": num(inv.get("subtotal")),
            "taxTotal": num(inv.get("tax_amount")),
            "total": total,
            "amountPaid": paid,
            "notes": inv.get("notes") or "",
        }
        if inv.get("sale_order_id"):
            mapped["saleOrderId"] = inv["sale_order_id"]
        if inv.get("repair_id"):
            mapped["repairId"] = inv["repair_id"]
        if inv.get("quote_id"):
            mapped["quoteId"] = inv["quote_id"]
        if inv.get("invoice_address"):
            mapped["invoiceAddress"] = inv["invoice_address"]
        if inv.get("delivery_address"):
            mapped["deliveryAddress"] = inv["delivery_address"]
        if inv.get("payment_blocked"):
            mapped["paymentBlocked"] = True
        if inv.get("currency_code"):
            mapped["currencyCode"] = inv["currency_code"]
        if inv.get("base_currency_code"):
            mapped["baseCurrencyCode"] = inv["base_currency_code"]
        if inv.get("exchange_rate_to_base") is not None:
            mapped["exchangeRateToBase"] = num(inv.get("exchange_rate_to_base"))
        if inv.get("approved_by"):
            mapped["postedByUserId"] = inv["approved_by"]
        if inv.get("approved_at"):
            mapped["postedAt"] = date_only(inv["approved_at"])

        existing = by_id.get(inv["id"])
        if not existing:
            by_id[inv["id"]] = mapped
            added += 1
            continue
        changed = False
        if num(existing.get("amountPaid")) != paid:
            existing["amountPaid"] = paid
            changed = True
        if (not existing.get("lines")) and mapped["lines"]:
            existing["lines"] = mapped["lines"]
            existing["subtotal"] = mapped["subtotal"]
            existing["taxTotal"] = mapped["taxTotal"]
            existing["total"] = mapped["total"]
            changed = True
        if mapped["status"] == "cancelled" and existing.get("status") != "cancelled":
            existing["status"] = "cancelled"
            changed = True
        if changed:
            refreshed += 1

    merged = list(by_id.values())
    cust = sum(1 for r in merged if r.get("type") == "customer_invoice")
    vend = sum(1 for r in merged if r.get("type") == "vendor_bill")
    print(json.dumps({
        "blobBefore": len(blob),
        "blobAfter": len(merged),
        "prismaCount": len(invoices),
        "added": added,
        "refreshed": refreshed,
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
    now = datetime.now(timezone.utc).isoformat()
    new_json = json.dumps(merged, separators=(",", ":"))
    subprocess.check_call([
        "psql", url, "-v", "ON_ERROR_STOP=1", "-c",
        (
            "INSERT INTO app_state(key, value, updated_at) VALUES ("
            f"'{backup_key}', $blob${raw_blob}$blob$, '{now}'"
            ") ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;"
        ),
    ])
    subprocess.check_call([
        "psql", url, "-v", "ON_ERROR_STOP=1", "-c",
        f"UPDATE app_state SET value = $blob${new_json}$blob$, updated_at = '{now}' WHERE key = 'deed_invoices';",
    ])
    print(f"backed up to {backup_key} and wrote deed_invoices")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
