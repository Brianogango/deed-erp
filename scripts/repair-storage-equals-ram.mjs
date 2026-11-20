#!/usr/bin/env node
/**
 * One-time repair: device configurations saved with the RAM as the drive.
 *
 * The specs reader used to read "8GB RAM 256GB SSD" as an 8GB drive, and saved
 * configurations (device_configuration_snapshots) kept it: reconfiguration
 * screens showed an 8GB drive and labels printed "8GB 8GB". This finds every
 * configuration whose drive size equals its RAM, reads the drive again from
 * its own saved specs text with the fixed rule, and corrects the ones whose
 * text names a different drive size. Anything else is listed and left alone.
 *
 * Shows what it would change; nothing is written without --apply.
 *
 *   node scripts/repair-storage-equals-ram.mjs            # preview
 *   node scripts/repair-storage-equals-ram.mjs --apply    # write the fixes
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const APPLY = process.argv.includes('--apply')

// Same rule as parseSpecsString (lib/reconfiguration/display-name.ts): a size
// followed by its drive type, the words between being neither RAM nor a size.
const STORAGE = /(\d+(?:\.\d+)?)\s*(TB|GB)\s*(?:(?!(?:RAM|DDR\d*|SO-?DIMM|\d+(?:\.\d+)?\s*(?:TB|GB))\b)(?:M\.?2|PCI-?E|PCIe|NVMe|SATA|[\w.-]+)\s+){0,6}(SSD|HDD|NVMe|Storage)\b/i
const SCREEN = /\b\d+(?:\.\d+)?\s*(?:["”]|inch(?:es)?)\b/gi

export function driveFromText(text) {
  const m = String(text || '').replace(SCREEN, ' ').match(STORAGE)
  if (!m) return null
  const gb = Math.round(Number(m[1]) * (m[2].toUpperCase() === 'TB' ? 1024 : 1))
  const type = /hdd/i.test(m[0]) ? 'HDD' : /nvme/i.test(m[0]) ? 'NVMe' : 'SSD'
  return { gb, type }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.display_name, c.total_ram_gb, c.primary_storage_gb, c.storage_type, c.is_current,
             s.serial_number
      FROM device_configuration_snapshots c
      JOIN serial_numbers s ON s.id = c.serial_id
      WHERE c.total_ram_gb > 0 AND c.primary_storage_gb = c.total_ram_gb
      ORDER BY s.serial_number, c.created_at`)
    const fixes = []
    const left = []
    for (const r of rows) {
      const drive = driveFromText(r.display_name)
      if (drive && drive.gb !== Number(r.total_ram_gb)) fixes.push({ ...r, drive })
      else left.push(r)
    }
    console.log(`${rows.length} configuration(s) with the drive size equal to the RAM.`)
    console.log(`\nTo correct (${fixes.length}):`)
    for (const f of fixes) console.log(`  ${f.serial_number}${f.is_current ? '' : ' (older)'}: drive ${f.primary_storage_gb}GB -> ${f.drive.gb}GB ${f.drive.type}   [${f.display_name}]`)
    console.log(`\nLeft alone — their text names no other drive size (${left.length}):`)
    for (const r of left) console.log(`  ${r.serial_number}: ${r.primary_storage_gb}GB   [${r.display_name}]`)

    if (!APPLY) {
      console.log('\nPreview only. Run again with --apply to write the corrections.')
      return
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const f of fixes) {
        await client.query(
          'UPDATE device_configuration_snapshots SET primary_storage_gb = $1, storage_type = COALESCE(storage_type, $2) WHERE id = $3 AND primary_storage_gb = total_ram_gb',
          [f.drive.gb, f.drive.type, f.id],
        )
      }
      await client.query('COMMIT')
      console.log(`\nCorrected ${fixes.length} configuration(s).`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
}
