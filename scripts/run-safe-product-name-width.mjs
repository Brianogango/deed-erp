import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const sqlPath = resolve(process.cwd(), 'database/migrations/20260828_product_name_width_safe.sql')
const helper = resolve(process.cwd(), 'scripts/apply-sql-as-postgres.sh')

console.log('Applying products.name varchar(500) as OS postgres via psql.')
console.log('NON-DESTRUCTIVE: widens column only; no app_state or row deletes.')
console.log(`  bash ${helper} ${sqlPath}`)

const child = spawn('bash', [helper, sqlPath], { stdio: 'inherit' })
child.on('exit', (code) => {
  if (code === 0) {
    console.log('Product name width migration applied successfully.')
  } else {
    console.error('Product name width migration failed.')
    console.error('On Contabo, apply as the postgres OS role:')
    console.error(`  bash ${helper} ${sqlPath}`)
  }
  process.exit(code ?? 1)
})
