import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const sqlPath = resolve(process.cwd(), 'database/migrations/20260828_notification_platform_safe.sql')
const helper = resolve(process.cwd(), 'scripts/apply-sql-as-postgres.sh')

console.log('Applying notification platform SQL as OS postgres via psql.')
console.log('NON-DESTRUCTIVE: legacy app_state notifications remain intact for backfill/rollback.')
console.log(`  bash ${helper} ${sqlPath}`)

const child = spawn('bash', [helper, sqlPath], { stdio: 'inherit' })
child.on('exit', (code) => {
  if (code === 0) {
    console.log('Notification platform foundation applied successfully.')
  } else {
    console.error('Notification platform migration failed.')
    console.error('On Contabo, apply as the postgres OS role:')
    console.error(`  bash ${helper} ${sqlPath}`)
  }
  process.exit(code ?? 1)
})
