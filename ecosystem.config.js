// pm2 production process config for the Deed ERP Next.js app.
//
// - cluster mode with 2 workers: one blocked or crashing worker no longer
//   takes the whole ERP down, and load spreads across CPU cores. Safe because
//   sessions are JWTs and all state lives in Postgres / the filesystem.
// - max_memory_restart: a leaking worker is recycled gracefully instead of
//   being OOM-killed by the kernel.
// - `next start` is invoked directly (cluster mode needs a node script, and
//   `prisma generate` already runs during the build step of the deploy).
module.exports = {
  apps: [
    {
      name: 'deed-erp',
      cwd: '/var/www/deed-erp',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      exec_mode: 'cluster',
      instances: 2,
      max_memory_restart: '1536M',
      node_args: '--max-old-space-size=2048',
      kill_timeout: 10000,
      min_uptime: '30s',
      max_restarts: 50,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
  ],
}
