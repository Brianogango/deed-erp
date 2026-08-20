#!/usr/bin/env node
/**
 * One-shot: merge RFQ-titled / identical-name CRM client duplicates.
 * Prints counts only — no customer names or emails.
 *
 *   npx tsx scripts/merge-obvious-duplicate-contacts.ts
 *   npx tsx scripts/merge-obvious-duplicate-contacts.ts --dry-run
 */
import 'dotenv/config'
import { mergeObviousDuplicateContacts } from '../lib/crm/inbox/duplicate-contacts'

const dryRun = process.argv.includes('--dry-run')

const result = await mergeObviousDuplicateContacts({ dryRun })
console.log(JSON.stringify(result))
