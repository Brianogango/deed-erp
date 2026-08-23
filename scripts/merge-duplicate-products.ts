#!/usr/bin/env node
/**
 * Merge product masters that share name, SKU, or barcode.
 *
 *   npx tsx scripts/merge-duplicate-products.ts --dry-run
 *   npx tsx scripts/merge-duplicate-products.ts
 */
import 'dotenv/config'
import { mergeObviousDuplicateProducts } from '../lib/inventory/merge-duplicate-products'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const result = await mergeObviousDuplicateProducts({ dryRun })
  console.log(JSON.stringify(result))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Merge failed')
  process.exitCode = 1
})
