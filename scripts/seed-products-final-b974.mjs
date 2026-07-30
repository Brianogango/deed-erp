#!/usr/bin/env node
/**
 * Idempotent seed for Final_b974.pdf product list into Prisma products table.
 * Skips products that already exist by name (case-insensitive). Creates missing categories.
 *
 * Usage (from app root with DATABASE_URL / POSTGRES_URL set, or .env present):
 *   node scripts/seed-products-final-b974.mjs
 *   node scripts/seed-products-final-b974.mjs --dry-run
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA = resolve(ROOT, "data/seed-products-final-b974.json");
const DRY = process.argv.includes("--dry-run");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(ROOT, ".env"));
loadEnvFile(resolve(ROOT, ".env.local"));

const connectionString =
  process.env.deed_erp_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;
if (!connectionString?.trim()) {
  console.error("DATABASE_URL (or POSTGRES_URL) is required");
  process.exit(1);
}

function skuSeed(value) {
  return (
    String(value || "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase()
      .slice(0, 24) || "PRODUCT"
  );
}

function buildSku(name, used) {
  const base = skuSeed(name);
  let candidate = `${base}-${Date.now().toString(36).toUpperCase().slice(-6)}`.slice(0, 60);
  let suffix = 1;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${Date.now().toString(36).toUpperCase().slice(-6)}-${suffix++}`.slice(0, 60);
  }
  return candidate;
}

function resolveTracking(item) {
  const method = String(item.trackingMethod || "").toUpperCase();
  if (method === "SERIAL" || method === "BATCH" || method === "QUANTITY" || method === "NONE") {
    return method;
  }
  if (item.productKind === "service") return "NONE";
  return "QUANTITY";
}

const products = JSON.parse(readFileSync(DATA, "utf8"));
if (!Array.isArray(products) || products.length === 0) {
  console.error("No products in", DATA);
  process.exit(1);
}

const pool = new Pool({ connectionString: connectionString.trim(), ssl: false });
const client = await pool.connect();

async function ensureTrackingMethodColumn() {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tracking_method') THEN
        CREATE TYPE tracking_method AS ENUM ('NONE', 'QUANTITY', 'BATCH', 'SERIAL');
      END IF;
    END
    $$;
  `);
  await client.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS tracking_method tracking_method
  `);
  await client.query(`
    UPDATE products
    SET tracking_method = CASE
      WHEN track_stock IS FALSE THEN 'NONE'::tracking_method
      ELSE COALESCE(tracking_method, 'QUANTITY'::tracking_method)
    END
    WHERE tracking_method IS NULL
  `);
  await client.query(`
    ALTER TABLE products
      ALTER COLUMN tracking_method SET DEFAULT 'QUANTITY'::tracking_method
  `);
}

try {
  // Production may lag Prisma schema; ensure SERIAL/QUANTITY column exists first.
  if (!DRY) {
    console.log("Ensuring products.tracking_method column…");
    await ensureTrackingMethodColumn();
  }

  await client.query("BEGIN");

  const categoryIdByName = new Map();
  const { rows: existingCategories } = await client.query(
    `SELECT id, name FROM categories`
  );
  for (const row of existingCategories) {
    categoryIdByName.set(String(row.name).trim().toLowerCase(), row.id);
  }

  async function ensureCategory(name) {
    const key = String(name || "Uncategorized").trim().toLowerCase() || "uncategorized";
    const label = String(name || "Uncategorized").trim() || "Uncategorized";
    if (categoryIdByName.has(key)) return categoryIdByName.get(key);
    if (DRY) {
      const fake = `dry-cat-${key}`;
      categoryIdByName.set(key, fake);
      console.log(`  + category: ${label}`);
      return fake;
    }
    const { rows } = await client.query(
      `INSERT INTO categories (id, name, is_active, sort_order)
       VALUES (gen_random_uuid(), $1, true, 0)
       RETURNING id`,
      [label.slice(0, 100)]
    );
    const id = rows[0].id;
    categoryIdByName.set(key, id);
    console.log(`  + category: ${label}`);
    return id;
  }

  const { rows: existingProducts } = await client.query(
    `SELECT id, name, sku FROM products`
  );
  const existingNames = new Set(
    existingProducts.map((r) => String(r.name).trim().toLowerCase())
  );
  const existingSkus = new Set(
    existingProducts.map((r) => String(r.sku || "").trim().toLowerCase()).filter(Boolean)
  );

  let taxRateId = null;
  const { rows: taxRows } = await client.query(
    `SELECT id FROM tax_rates
     WHERE is_active = true AND rate = 16
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`
  );
  if (taxRows[0]?.id) taxRateId = taxRows[0].id;

  let created = 0;
  let skipped = 0;

  for (const item of products) {
    const name = String(item.name || "").trim().slice(0, 200);
    if (!name) continue;
    if (existingNames.has(name.toLowerCase())) {
      skipped += 1;
      continue;
    }

    const categoryId = await ensureCategory(item.category || "Uncategorized");
    const trackingMethod = resolveTracking(item);
    const trackStock = item.productKind !== "service";
    const salePrice = Number(item.salePrice) || 0;
    const costPrice = Number(item.costPrice) || 0;
    const minStock = Number.isFinite(Number(item.minStock)) ? Number(item.minStock) : 1;
    const sku = buildSku(name, existingSkus);
    const specs = {
      seedSource: "Final_b974",
      unit: item.unit || "pcs",
      productKind: item.productKind || "storable",
      warrantyMonths: Number(item.warrantyMonths) || 0,
      taxRatePct: Number(item.taxRate) || 16,
    };

    if (DRY) {
      created += 1;
      existingNames.add(name.toLowerCase());
      existingSkus.add(sku.toLowerCase());
      console.log(`  + ${trackingMethod} ${name} (${sku}) @ ${salePrice}`);
      continue;
    }

    await client.query(
      `INSERT INTO products (
         id, sku, name, description, category_id,
         cost_price, selling_price, tax_rate_id,
         track_stock, tracking_method, invoice_policy,
         reorder_level, reorder_qty, is_active, product_type, specs,
         created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4,
         $5, $6, $7,
         $8, $9::tracking_method, 'order',
         $10, 5, true, 'new'::product_type, $11::jsonb,
         NOW(), NOW()
       )`,
      [
        sku,
        name,
        item.description || null,
        categoryId,
        costPrice,
        salePrice,
        taxRateId,
        trackStock,
        trackingMethod,
        minStock,
        JSON.stringify(specs),
      ]
    );

    existingNames.add(name.toLowerCase());
    existingSkus.add(sku.toLowerCase());
    created += 1;
    console.log(`  + ${trackingMethod} ${name} (${sku}) @ ${salePrice}`);
  }

  if (DRY) {
    await client.query("ROLLBACK");
  } else {
    await client.query("COMMIT");
  }
  console.log(
    `${DRY ? "[DRY RUN] " : ""}Done. created=${created} skipped=${skipped} total=${products.length}`
  );
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* ignore */
  }
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
