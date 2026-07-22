# Deed ERP Partner API

Read-only API for approved partners who resell Deed Technologies products on
their own sites. It exposes the **sellable catalog only** — active, priced
products with live stock availability. Cost prices, supplier data, and any
internal records are never exposed.

## Authentication

Every request needs a partner API key, issued from **Settings → Partner API**
by a director or admin officer. Keys look like `deed_pk_…` and are shown once
at creation.

Send the key on every request in either header:

```
Authorization: Bearer deed_pk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

or

```
X-API-Key: deed_pk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Keep the key on your server.** Call this API from your backend and render the
results on your site — never embed the key in browser JavaScript or mobile
apps, where anyone can read it. If a key leaks, ask Deed to revoke it and issue
a new one (revocation is immediate).

## Endpoint

### `GET /api/public/v1/products`

Base URL: `https://<deed-erp-host>`

| Query param | Default | Description |
|---|---|---|
| `page` | `1` | 1-based page number |
| `pageSize` | `50` | Items per page (max 100) |
| `category` | – | Exact category name, e.g. `Laptops`, `Accessories` |
| `q` | – | Free-text search across name, SKU, and description |
| `inStock` | in-stock only | Pass `inStock=all` to include out-of-stock items |

Example:

```bash
curl -H "Authorization: Bearer $DEED_API_KEY" \
  "https://<deed-erp-host>/api/public/v1/products?category=Laptops&page=1&pageSize=50"
```

Response:

```json
{
  "items": [
    {
      "id": "0b0e8b9e-…",
      "sku": "HP-EB830-G5",
      "barcode": null,
      "name": "HP EliteBook 830 G5 - 8th Gen Intel Core i5, 8GB RAM, 256GB SSD",
      "description": "HP EliteBook 830 G5 configured with 8th Gen Intel Core i5, 8GB RAM, 256GB SSD.",
      "category": "Laptops",
      "price": 30000,
      "currency": "KES",
      "warrantyMonths": 6,
      "quantityAvailable": 4,
      "inStock": true,
      "updatedAt": "2026-07-22T08:12:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 34, "totalPages": 1 },
  "meta": { "currency": "KES", "generatedAt": "2026-07-22T09:00:00.000Z" }
}
```

`price` is the retail selling price in Kenyan Shillings. `quantityAvailable`
is live availability — poll periodically (responses may be cached for up to a
minute) and hide or mark items that go out of stock.

## Limits and errors

- **Rate limit:** 120 requests per minute per key. `429` with a `Retry-After`
  header when exceeded — back off and retry.
- `401` — missing, invalid, or revoked key.
- Standard `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers on every
  response.

## Good citizenship

- Cache responses on your side for at least 60 seconds.
- Use one key per site/integration so access can be managed per partner.
- To place orders, contact Deed Technologies — this API is read-only.
