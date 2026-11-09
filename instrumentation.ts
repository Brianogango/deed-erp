/**
 * Runs once when each server worker starts (Next.js instrumentation hook).
 * Production workers build their read-model caches before PM2 sends them
 * traffic (lib/warmup.server.ts). Set DEED_WARMUP=0 to skip.
 */
export async function register() {
  // The import must sit inside this check so the edge build leaves it out.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWarmup } = await import('./lib/warmup.server')
    startWarmup()
  }
}
