import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const sqlPath = resolve(process.cwd(), 'database/migrations/20260828_coa_alignment_safe.sql')
const sqlPath2 = resolve(process.cwd(), 'database/migrations/20260828_official_coa_alignment_safe.sql')
const helper = resolve(process.cwd(), 'scripts/apply-sql-as-postgres.sh')
const blobScript = resolve(process.cwd(), 'scripts/fix-coa-blob-alignment.mjs')

console.log('Applying CoA alignment as OS postgres via psql, then aligning the blob chart.')
console.log('NON-DESTRUCTIVE: type/name corrections + insert-if-missing accounts only.')
console.log(`  bash ${helper} ${sqlPath}`)
console.log(`  bash ${helper} ${sqlPath2}`)
console.log(`  node ${blobScript}`)

const child = spawn('bash', ['-c', `bash "${helper}" "${sqlPath}" && bash "${helper}" "${sqlPath2}" && node "${blobScript}"`], { stdio: 'inherit' })
child.on('exit', (code) => {
  if (code === 0) {
    console.log('CoA alignment applied successfully.')
  } else {
    console.error('CoA alignment failed.')
    console.error('On Contabo, apply as the postgres OS role:')
    console.error(`  bash ${helper} ${sqlPath}`)
    console.error(`  node ${blobScript}`)
  }
  process.exit(code ?? 1)
})
