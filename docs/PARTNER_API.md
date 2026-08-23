# Deed ERP Partner API — Integration Guide

**Version:** 1.2  
**Audience:** Reseller partners integrating Deed Technologies’ product catalog into their own websites or apps  
**Scope:** Read-only catalog (products, prices, stock). Orders are not placed through this API.

---

## Table of contents

1. [What this API provides](#1-what-this-api-provides)
2. [Getting your API key](#2-getting-your-api-key)
3. [Storing and using the key safely](#3-storing-and-using-the-key-safely)
4. [Base URL and authentication](#4-base-url-and-authentication)
5. [Endpoint reference](#5-endpoint-reference)
6. [Response fields](#6-response-fields)
7. [Implementation walkthrough](#7-implementation-walkthrough)
8. [Sample code](#8-sample-code)
9. [Pagination, caching, and rate limits](#9-pagination-caching-and-rate-limits)
10. [Errors](#10-errors)
11. [Go-live checklist](#11-go-live-checklist)
12. [Support](#12-support)

---

## 1. What this API provides

Deed’s Partner API lets approved resellers **pull the sellable catalog** — active products with wholesale / reseller price and live stock availability — and display them on their own storefront.

| Included | Never included |
|---|---|
| Product name, SKU, barcode, description | Cost / purchase prices |
| Category | Supplier details |
| Wholesale / reseller price (KES) | Walk-in retail / sale price |
| Warranty months (when set) | Internal accounts or users |
| Live warehouse quantity, including 0 | Draft / inactive products |
| Two public product photos when available | Hidden partner categories |
| | Order placement |

This API is **read-only**. To place purchase orders with Deed Technologies, contact your Deed account contact — do not attempt write calls against this API.

---

## 2. Getting your API key

Keys are issued by Deed staff (director or admin officer) from the ERP:

1. Sign in to Deed ERP.
2. Open **Settings → Partner API**.
3. Click **New Partner Key**.
4. Enter a clear partner/site name (example: `Acme Electronics — Web Store`).
5. Click **Create Key**.
6. **Copy the key immediately** — it is shown only once.
7. Send the key to the partner over a secure channel (password manager share, encrypted email, or in-person). Do not post it in chat groups or tickets that many people can see.

Keys look like:

```text
deed_pk_<32 url-safe characters>
```

Example shape (not a real key):

```text
deed_pk_AbCdEfGhIjKlMnOpQrStUvWx
```

If a key is lost, revoke it in **Settings → Partner API** and create a new one. Revocation takes effect immediately.

---

## 3. Storing and using the key safely

Treat the API key like a password.

### Do

- Store it in a **server environment variable** (e.g. `DEED_PARTNER_API_KEY`).
- Call the Partner API **only from your backend** (Node, PHP, Python, Laravel, WordPress server-side, etc.).
- Use **one key per site/integration** so Deed can revoke a single partner without affecting others.
- Rotate the key if anyone who should not have it may have seen it.

### Do not

- Put the key in frontend JavaScript, React/Vue bundles, mobile apps, or public Git repos.
- Commit `.env` files that contain the key.
- Share one key across multiple unrelated partners.
- Log the full key in application logs or analytics.

### Recommended pattern

```text
Browser / mobile app  →  Your backend  →  Deed Partner API
                              ↑
                     API key lives only here
```

Your backend fetches the catalog, caches it, and serves product data to your storefront.

---

## 4. Base URL and authentication

**Base URL**

```text
https://<your-deed-erp-host>
```

Replace `<your-deed-erp-host>` with the hostname Deed gives you (for example `erp.deedtechnologies.com`).

**Send the key on every request** using either header:

```http
Authorization: Bearer deed_pk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

or

```http
X-API-Key: deed_pk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Both are equivalent. Prefer `Authorization: Bearer` unless your stack makes custom headers awkward.

**CORS:** Public endpoints allow browser `OPTIONS`/`GET` for development, but production integrations must still proxy through your backend so the key never reaches the browser.

---

## 5. Endpoint reference

### `GET /api/public/v1/products`

Returns the sellable catalog (active products with a wholesale / reseller price), **including items with warehouse quantity 0** so partners can display vendor-sourced SKUs. Categories the merchant hid in Settings → Partner API are omitted. With Issues and Repair Unit never increment `quantityAvailable`. Services are omitted unless they have a saved wholesale price. `inStock=all` is ignored because zero-qty SKUs are already included.

`price` is **not** the walk-in sale price. It is:

1. The product’s saved **wholesale / reseller** price, when that field is greater than zero.
2. Otherwise the margin-policy **min GP band** computed from cost (same spreadsheet Inventory uses for list price — list/sale uses the **max** band).
3. SKUs with no saved wholesale and no computable min band (no cost, unmapped category, or services) are omitted. Retail is never used as a fallback.

| Query param | Default | Description |
|---|---|---|
| `page` | `1` | 1-based page number |
| `pageSize` | `50` | Items per page (maximum `100`) |
| `category` | — | Exact category name (case-insensitive), e.g. `Laptops`, `Accessories` |
| `q` | — | Free-text search across name, SKU, and description |

**Example**

```bash
curl -sS \
  -H "Authorization: Bearer $DEED_PARTNER_API_KEY" \
  "https://<deed-erp-host>/api/public/v1/products?category=Laptops&page=1&pageSize=50"
```

**Example response**

```json
{
  "items": [
    {
      "id": "0b0e8b9e-aaaa-bbbb-cccc-ddddeeeeffff",
      "sku": "HP-EB830-G5",
      "barcode": null,
      "name": "HP EliteBook 830 G5 - 8th Gen Intel Core i5, 8GB RAM, 256GB SSD",
      "description": "HP EliteBook 830 G5 configured with 8th Gen Intel Core i5, 8GB RAM, 256GB SSD.",
      "category": "Laptops",
      "price": 26500,
      "currency": "KES",
      "warrantyMonths": 6,
      "quantityAvailable": 4,
      "inStock": true,
      "images": [
        { "url": "https://<deed-erp-host>/api/public/v1/products/0b0e8b9e-aaaa-bbbb-cccc-ddddeeeeffff/images/1", "role": "hero" },
        { "url": "https://<deed-erp-host>/api/public/v1/products/0b0e8b9e-aaaa-bbbb-cccc-ddddeeeeffff/images/2", "role": "detail" }
      ],
      "updatedAt": "2026-07-22T08:12:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 34,
    "totalPages": 1
  },
  "meta": {
    "currency": "KES",
    "generatedAt": "2026-07-22T09:00:00.000Z"
  }
}
```

Responses may be cached at the edge/server for up to **60 seconds** (`Cache-Control: private, max-age=60`).

---

## 6. Response fields

### Product item

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable product ID (use as your sync key) |
| `sku` | string | Stock-keeping unit |
| `barcode` | string \| null | Barcode when present |
| `name` | string | Display name |
| `description` | string | May be empty |
| `category` | string \| null | Category display name |
| `price` | number | Wholesale / reseller price (KES). Saved wholesale if set; otherwise min GP band from cost. Never cost, never walk-in retail. |
| `currency` | string | Always `KES` today |
| `warrantyMonths` | number \| null | Warranty in months when configured |
| `quantityAvailable` | number | Warehouse (Main) units only (available serials, or bulk at warehouse). May be `0`. |
| `inStock` | boolean | `true` when `quantityAvailable >= 1` |
| `images` | array | Zero, one, or two public photos. Each item is `{ url, role }` where `role` is `hero` or `detail`. Empty when no photo is on file. |
| `updatedAt` | string (ISO 8601) | Last product update timestamp |

Image URLs are public (no API key). Use them in `<img src>`. Do not put your partner key on those requests. Missing photos return HTTP 404; the catalog item is still listed.

### Pagination object

| Field | Type | Notes |
|---|---|---|
| `page` | number | Current page |
| `pageSize` | number | Page size used |
| `total` | number | Total matching items |
| `totalPages` | number | Total pages (`ceil(total / pageSize)`, minimum 1) |

### Meta object

| Field | Type | Notes |
|---|---|---|
| `currency` | string | Catalog currency |
| `generatedAt` | string (ISO 8601) | When this response was built |

---

## 7. Implementation walkthrough

### Step 1 — Receive and store the key

1. Get your `deed_pk_…` key from Deed.
2. Add it to your server secrets:

```bash
# .env (never commit this file)
DEED_ERP_BASE_URL=https://<deed-erp-host>
DEED_PARTNER_API_KEY=deed_pk_your_real_key_here
```

### Step 2 — Fetch the catalog from your backend

Create a server route or cron job that:

1. Calls `GET /api/public/v1/products` with your key.
2. Walks all pages until `page >= totalPages`.
3. Upserts products into your CMS/database by `id` or `sku`.
4. Marks products missing from the latest sync as unavailable (optional but recommended).

### Step 3 — Render on your storefront

- Show `name`, `description`, `price`, `images`, and stock status from **your** database/cache.
- Use `inStock` / `quantityAvailable` on your storefront. `inStock: false` means Deed can still list the SKU (vendor-sourced) but does not have it in Warehouse (Main) today. Do not show those as “in stock”.
- Treat products missing from the latest sync as removed or blocked (usually a hidden category).
- Do not invent cost or margin fields from this API — they are not provided.

### Step 4 — Keep stock fresh

- Poll every few minutes (for example every 5–15 minutes), or on a schedule that matches how often your storefront needs accuracy.
- Respect the 60-second server cache and your own cache (see [§9](#9-pagination-caching-and-rate-limits)).
- On `429`, wait for `Retry-After` seconds before trying again.

### Step 5 — Handle key rotation

If Deed revokes your key:

1. Catalog requests return `401`.
2. Stop using the old key.
3. Install the new key in your environment variables and redeploy/restart.

---

## 8. Sample code

### cURL (smoke test)

```bash
export DEED_ERP_BASE_URL="https://<deed-erp-host>"
export DEED_PARTNER_API_KEY="deed_pk_..."

curl -sS \
  -H "Authorization: Bearer $DEED_PARTNER_API_KEY" \
  -H "Accept: application/json" \
  "$DEED_ERP_BASE_URL/api/public/v1/products?page=1&pageSize=50" | jq .
```

### Node.js (fetch all pages)

```js
const BASE = process.env.DEED_ERP_BASE_URL
const KEY = process.env.DEED_PARTNER_API_KEY

async function fetchCatalog() {
  const items = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const url = new URL('/api/public/v1/products', BASE)
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', '100')

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${KEY}`,
        Accept: 'application/json',
      },
    })

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || 60)
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      continue
    }

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Deed API ${res.status}: ${body}`)
    }

    const data = await res.json()
    items.push(...data.items)
    totalPages = data.pagination.totalPages
    page += 1
  }

  return items
}

fetchCatalog()
  .then(products => {
    console.log(`Synced ${products.length} products`)
    // upsert into your DB / CMS here
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
```

### Python

```python
import os
import time
import requests

BASE = os.environ["DEED_ERP_BASE_URL"].rstrip("/")
KEY = os.environ["DEED_PARTNER_API_KEY"]
HEADERS = {"Authorization": f"Bearer {KEY}", "Accept": "application/json"}

def fetch_catalog():
    items = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        r = requests.get(
            f"{BASE}/api/public/v1/products",
            headers=HEADERS,
            params={"page": page, "pageSize": 100},
            timeout=30,
        )
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", "60")))
            continue
        r.raise_for_status()
        data = r.json()
        items.extend(data["items"])
        total_pages = data["pagination"]["totalPages"]
        page += 1
    return items

if __name__ == "__main__":
    products = fetch_catalog()
    print(f"Synced {len(products)} products")
```

### PHP

```php
<?php
$base = rtrim(getenv('DEED_ERP_BASE_URL'), '/');
$key  = getenv('DEED_PARTNER_API_KEY');

function deed_fetch_page(string $base, string $key, int $page): array {
    $url = $base . '/api/public/v1/products?page=' . $page . '&pageSize=100';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $key,
            'Accept: application/json',
        ],
        CURLOPT_TIMEOUT => 30,
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status === 429) {
        sleep(60);
        return deed_fetch_page($base, $key, $page);
    }
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("Deed API error $status: $body");
    }
    return json_decode($body, true, 512, JSON_THROW_ON_ERROR);
}

$items = [];
$page = 1;
do {
    $data = deed_fetch_page($base, $key, $page);
    $items = array_merge($items, $data['items']);
    $totalPages = (int)$data['pagination']['totalPages'];
    $page++;
} while ($page <= $totalPages);

echo 'Synced ' . count($items) . " products\n";
```

---

## 9. Pagination, caching, and rate limits

### Pagination

- Always read `pagination.totalPages` and fetch until done when you need the full catalog.
- Prefer `pageSize=100` for sync jobs to minimize round-trips.
- Product order is by name ascending.

### Caching (your side)

- Cache catalog responses for **at least 60 seconds**.
- For storefront rendering, caching **5–15 minutes** is usually enough; tighten only if stock turns over very quickly.
- Prefer syncing into your own database over hitting Deed on every page view.

### Rate limits

- **120 requests per minute per API key**.
- When exceeded, the API returns **HTTP 429** with:
  - `Retry-After` — seconds to wait
  - `X-RateLimit-Remaining: 0`
  - `X-RateLimit-Reset` — epoch millis when the window resets
- Successful responses also include `X-RateLimit-Remaining` and `X-RateLimit-Reset`.

---

## 10. Errors

| Status | Meaning | What to do |
|---|---|---|
| `200` | Success | Use `items` / `pagination` |
| `401` | Missing, invalid, or revoked key | Check env var; ask Deed to re-issue if revoked |
| `429` | Rate limit exceeded | Wait `Retry-After` seconds, then retry |
| `5xx` | Temporary server error | Retry with backoff; contact Deed if persistent |

Example error body:

```json
{ "error": "Invalid or revoked API key." }
```

Missing-key style message:

```json
{
  "error": "A valid API key is required. Send it as \"Authorization: Bearer <key>\" or \"X-API-Key: <key>\"."
}
```

---

## 11. Go-live checklist

- [ ] Received a unique `deed_pk_…` key for this site only
- [ ] Key stored in server secrets / env vars (not in the browser)
- [ ] Smoke-tested with cURL and confirmed JSON products return
- [ ] Backend syncs all pages (`page` through `totalPages`)
- [ ] Storefront shows price in KES; products missing from the latest sync are treated as unavailable
- [ ] Client-side cache ≥ 60 seconds; sync job is not hammering the API
- [ ] `401` / `429` handling implemented
- [ ] Know who at Deed to contact for key rotation and orders
- [ ] Downloaded this guide for your engineering team

---

## 12. Support

- **API access / key issues:** Deed ERP admin (Settings → Partner API) or your Deed account contact  
- **Orders & commercial terms:** Contact Deed Technologies — not available through this API  
- **Guide downloads (from ERP):** Settings → Partner API → Download guide  
- **Public downloads (no login):**  
  - Markdown: `/api/public/v1/guide`  
  - HTML (print / Save as PDF): `/docs/partner-api-guide.html`

---

*© Deed Technologies — Partner API Integration Guide*
