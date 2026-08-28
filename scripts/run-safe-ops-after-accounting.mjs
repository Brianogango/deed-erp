import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const sqlPath = resolve(process.cwd(), 'database/migrations/20260828_ops_after_accounting_safe.sql')
const helper = resolve(process.cwd(), 'scripts/apply-sql-as-postgres.sh')

console.log('Applying snapshot column widths + inventory CoA 6200/6205/6210 as OS postgres.')
console.log('NON-DESTRUCTIVE: widens columns and inserts missing accounts only.')
console.log(`  bash ${helper} ${sqlPath}`)

const child = spawn('bash', [helper, sqlPath], { stdio: 'inherit' })
child.on('exit', (code) => {
  if (code === 0) {
    console.log('Ops-after-accounting migration applied successfully.')
  } else {
    console.error('Ops-after-accounting migration failed.')
    console.error('On Contabo, apply as the postgres OS role:')
    console.error(`  bash ${helper} ${sqlPath}`)
  }
  process.exit(code ?? 1)
})
